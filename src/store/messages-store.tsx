import * as Crypto from 'expo-crypto';
import { useSQLiteContext } from 'expo-sqlite';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import * as repo from '@/data/repository';
import { conversationTitle } from '@/data/repository';
import type { Conversation, Message, Person } from '@/data/types';
import { fenceKey } from '@/data/types';
import { clearMirror, mirrorOwner, replaceMirror, type MirroredMessage } from '@/db/fence-mirror';
import type { Geofence } from '@/lib/geo';
import { useAuth } from '@/store/auth-store';

export type LoadState = 'idle' | 'loading' | 'ready' | 'error';

export type SendResult = { error: string | null };
export type CreateResult = { id: string | null; error: string | null };

type Entry = { messages: Message[]; state: LoadState; error: string | null };

type MessagesApi = {
  conversations: Conversation[];
  pendingFenced: Message[];
  inbox: { state: LoadState; error: string | null };
  entryFor: (conversationId: string) => Entry;
  refreshInbox: () => Promise<void>;
  sendMessage: (conversationId: string, body: string, fence?: Geofence) => Promise<SendResult>;
  createConversation: (participantIds: string[], title?: string) => Promise<CreateResult>;
  markRead: (conversationId: string) => Promise<void>;
  unlockMessage: (messageId: string) => Promise<void>;
  requestMessages: (conversationId: string) => void;
};

const MessagesContext = createContext<MessagesApi | null>(null);

const EMPTY_ENTRY: Entry = { messages: [], state: 'idle', error: null };

export { conversationTitle };

export function MessagesProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const { user } = useAuth();
  const myId = user?.id ?? null;

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [pendingFenced, setPendingFenced] = useState<Message[]>([]);
  // 'loading' from the start: the provider always fetches on mount, so saying so
  // up front avoids a synchronous setState inside the effect.
  const [inbox, setInbox] = useState<{ state: LoadState; error: string | null }>({
    state: 'loading',
    error: null,
  });
  // Per conversation, not one flat array. The old store loaded every message in
  // the database at startup, which is fine against a local file and not against
  // a server.
  const [entries, setEntries] = useState<Map<string, Entry>>(new Map());

  const inFlight = useRef(new Set<string>());
  // Read by the realtime and foreground handlers, which must not resubscribe
  // every time a message lands.
  const entriesRef = useRef(entries);
  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  /**
   * The single place `pendingFenced` is assigned, so the SQLite mirror the
   * background task reads cannot drift from it. Every path — first load,
   * refresh, realtime — goes through here.
   */
  const applyPendingFenced = useCallback(
    (messages: Message[], ownerId: string) => {
      setPendingFenced(messages);

      const rows: MirroredMessage[] = messages
        .filter((m) => m.fence != null)
        .map((m) => ({
          messageId: m.id,
          conversationId: m.conversationId,
          senderName: m.sender.name,
          fenceKey: fenceKey(m.fence!),
          fenceLabel: m.fence!.label,
          sentAt: new Date(m.sentAt).toISOString(),
        }));

      void replaceMirror(db, ownerId, rows).catch(() => {
        // A failed mirror write costs a background notification, never a crash
        // in the foreground. The next refresh rewrites it wholesale.
      });
    },
    [db],
  );

  /**
   * Applies a fetch result. Split from the fetch so the mount effect and a
   * manual retry share one reducer, and so these setState calls sit after an
   * awaited boundary rather than synchronously inside an effect body.
   */
  const applyInbox = useCallback(
    (
      ownerId: string,
      convos: Awaited<ReturnType<typeof repo.fetchConversations>>,
      fenced: Awaited<ReturnType<typeof repo.fetchPendingFenced>>,
    ) => {
      if (convos.error) {
        setInbox({ state: 'error', error: convos.error });
        return;
      }
      setConversations(convos.conversations);
      if (!fenced.error) applyPendingFenced(fenced.messages, ownerId);
      setInbox({ state: 'ready', error: null });
    },
    [applyPendingFenced],
  );

  const loadInbox = useCallback(async () => {
    if (!myId) return;
    const [convos, fenced] = await Promise.all([
      repo.fetchConversations(myId),
      repo.fetchPendingFenced(myId),
    ]);
    applyInbox(myId, convos, fenced);
  }, [myId, applyInbox]);

  /** Manual retry: show the spinner, then reload. Never called from an effect body. */
  const refreshInbox = useCallback(async () => {
    setInbox((prev) => (prev.state === 'ready' ? prev : { state: 'loading', error: null }));
    await loadInbox();
  }, [loadInbox]);

  // Clear a mirror left behind by a different account before anything reads it.
  useEffect(() => {
    if (!myId) return;
    void (async () => {
      const owner = await mirrorOwner(db).catch(() => null);
      if (owner && owner !== myId) await clearMirror(db).catch(() => {});
    })();
  }, [db, myId]);

  useEffect(() => {
    if (!myId) return;
    let active = true;
    void (async () => {
      const [convos, fenced] = await Promise.all([
        repo.fetchConversations(myId),
        repo.fetchPendingFenced(myId),
      ]);
      if (active) applyInbox(myId, convos, fenced);
    })();
    return () => {
      active = false;
    };
  }, [myId, applyInbox]);

  const loadMessages = useCallback(
    async (conversationId: string) => {
      if (!myId || inFlight.current.has(conversationId)) return;
      inFlight.current.add(conversationId);

      setEntries((prev) => {
        const next = new Map(prev);
        const existing = next.get(conversationId) ?? EMPTY_ENTRY;
        next.set(conversationId, { ...existing, state: 'loading', error: null });
        return next;
      });

      const { messages, error } = await repo.fetchMessages(conversationId, myId);
      inFlight.current.delete(conversationId);

      setEntries((prev) => {
        const next = new Map(prev);
        next.set(
          conversationId,
          error
            ? { messages: [], state: 'error', error }
            : { messages, state: 'ready', error: null },
        );
        return next;
      });
    },
    [myId],
  );

  // Realtime only delivers while the socket is up, so anything that landed
  // while the app was backgrounded — including the message a push was about —
  // is picked up here: the inbox, plus every thread already on screen or cached.
  useEffect(() => {
    const onChange = (state: AppStateStatus) => {
      if (state !== 'active') return;
      void loadInbox();
      for (const [cid, entry] of entriesRef.current) {
        if (entry.state === 'ready' || entry.state === 'error') void loadMessages(cid);
      }
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [loadInbox, loadMessages]);

  const entryFor = useCallback(
    (conversationId: string) => entries.get(conversationId) ?? EMPTY_ENTRY,
    [entries],
  );

  /** Inserts or replaces by id, keeping the list ordered oldest first. */
  const upsertMessage = useCallback((message: Message) => {
    setEntries((prev) => {
      const next = new Map(prev);
      const existing = next.get(message.conversationId) ?? EMPTY_ENTRY;
      const without = existing.messages.filter((m) => m.id !== message.id);
      next.set(message.conversationId, {
        ...existing,
        state: existing.state === 'idle' ? 'ready' : existing.state,
        messages: [...without, message].sort((a, b) => a.sentAt - b.sentAt),
      });
      return next;
    });
  }, []);

  /** Applies `update` to one message wherever it is cached. */
  const patchMessage = useCallback(
    (messageId: string, update: (m: Message) => Message) => {
      setEntries((prev) => {
        let changed = false;
        const next = new Map(prev);
        for (const [cid, entry] of next) {
          if (!entry.messages.some((m) => m.id === messageId)) continue;
          changed = true;
          next.set(cid, {
            ...entry,
            messages: entry.messages.map((m) => (m.id === messageId ? update(m) : m)),
          });
        }
        return changed ? next : prev;
      });
    },
    [],
  );

  // Live updates. RLS applies to realtime, so this receives new messages in
  // your threads, your own unlocks, and receipts for your messages from
  // finders who share them — nothing else.
  const onRemoteMessage = useCallback(
    async (row: Record<string, unknown>) => {
      if (!myId) return;
      const conversationId = row.conversation_id as string;
      const entry = entriesRef.current.get(conversationId);

      // Only splice into a thread already fetched in full. Inserting into an
      // idle one would mark it loaded with a single message in it.
      if (entry && entry.state === 'ready') {
        const sender = await repo.fetchProfile(row.sender_id as string);
        if (sender) {
          const incoming = repo.messageFromRealtimeRow(row, sender, myId);
          const known = entry.messages.find((m) => m.id === incoming.id);
          // Our own send already upserted the real row; keep its local state.
          upsertMessage(known ? { ...incoming, unlockedAt: known.unlockedAt, foundBy: known.foundBy } : incoming);
        }
      }
      // Previews, unread state and pendingFenced (and so the geofences).
      void loadInbox();
    },
    [myId, upsertMessage, loadInbox],
  );

  const onRemoteUnlock = useCallback(
    async (row: Record<string, unknown>) => {
      if (!myId) return;
      const messageId = row.message_id as string;
      const finderId = row.user_id as string;
      const at = repo.toEpochMs(row.unlocked_at as string) ?? Date.now();

      if (finderId === myId) {
        // This account unlocked it, possibly on another device.
        patchMessage(messageId, (m) => (m.unlockedAt == null ? { ...m, unlockedAt: at } : m));
        void loadInbox();
        return;
      }

      const finder: Person | null = await repo.fetchProfile(finderId);
      if (!finder) return;
      patchMessage(messageId, (m) =>
        !m.isMine || m.foundBy.some((f) => f.person.id === finderId)
          ? m
          : { ...m, foundBy: [...m.foundBy, { person: finder, at }].sort((a, b) => a.at - b.at) },
      );
    },
    [myId, patchMessage, loadInbox],
  );

  // Handlers go through a ref so the channel subscribes once per account rather
  // than on every render that changes a callback's identity.
  const realtimeHandlers = useRef({ onRemoteMessage, onRemoteUnlock });
  useEffect(() => {
    realtimeHandlers.current = { onRemoteMessage, onRemoteUnlock };
  }, [onRemoteMessage, onRemoteUnlock]);

  // The provider is keyed by user id, so switching account tears this down.
  useEffect(() => {
    if (!myId) return;
    return repo.subscribeToMessageEvents(myId, {
      onMessage: (row) => void realtimeHandlers.current.onRemoteMessage(row),
      onUnlock: (row) => void realtimeHandlers.current.onRemoteUnlock(row),
    });
  }, [myId]);

  const sendMessage = useCallback(
    async (conversationId: string, body: string, fence?: Geofence): Promise<SendResult> => {
      if (!myId || !user) return { error: 'Not signed in.' };

      // Generated here so the optimistic row, the inserted row and the
      // realtime echo all share one identity — every path is then an
      // idempotent upsert by id rather than a guess at which rows match.
      const id = Crypto.randomUUID();
      const me = meAsPerson(myId, user.email ?? null);

      upsertMessage({
        id,
        conversationId,
        sender: me,
        isMine: true,
        body,
        sentAt: Date.now(),
        fence,
        unlockedAt: null,
        foundBy: [],
        status: 'sending',
      });

      const { message, error } = await repo.createMessage({
        id,
        conversationId,
        body,
        fence,
        myId,
      });

      if (error || !message) {
        // Keep the row so the text is not lost, but mark it so the bubble can
        // show it did not land.
        setEntries((prev) => {
          const next = new Map(prev);
          const existing = next.get(conversationId) ?? EMPTY_ENTRY;
          next.set(conversationId, {
            ...existing,
            messages: existing.messages.map((m) =>
              m.id === id ? { ...m, status: 'failed' as const } : m,
            ),
          });
          return next;
        });
        return { error: error ?? 'Message not sent.' };
      }

      upsertMessage(message);
      void loadInbox();
      return { error: null };
    },
    [myId, user, upsertMessage, loadInbox],
  );

  const createConversation = useCallback(
    async (participantIds: string[], title?: string): Promise<CreateResult> => {
      if (!myId) return { id: null, error: 'Not signed in.' };
      const result = await repo.createConversation(participantIds, title);
      if (result.id) void loadInbox();
      return result;
    },
    [myId, loadInbox],
  );

  const markRead = useCallback(
    async (conversationId: string) => {
      if (!myId) return;
      const conversation = conversations.find((c) => c.id === conversationId);
      if (!conversation?.unread) return;

      setConversations((prev) =>
        prev.map((c) => (c.id === conversationId ? { ...c, unread: false } : c)),
      );
      await repo.markConversationRead(conversationId, myId);
    },
    [myId, conversations],
  );

  const unlockMessage = useCallback(
    async (messageId: string) => {
      if (!myId) return;

      const at = Date.now();
      setEntries((prev) => {
        const next = new Map(prev);
        for (const [cid, entry] of next) {
          if (!entry.messages.some((m) => m.id === messageId)) continue;
          next.set(cid, {
            ...entry,
            messages: entry.messages.map((m) =>
              m.id === messageId && m.unlockedAt == null ? { ...m, unlockedAt: at } : m,
            ),
          });
        }
        return next;
      });
      // Drop it from the monitored set immediately; this also rewrites the
      // mirror, so the background task stops alerting for a place already
      // visited even before the next refresh.
      applyPendingFenced(
        pendingFenced.filter((m) => m.id !== messageId),
        myId,
      );

      const { error } = await repo.unlockMessage(messageId, myId);
      if (error) void loadInbox();
    },
    [myId, pendingFenced, applyPendingFenced, loadInbox],
  );

  // Screens ask for a conversation's messages by rendering; fetch on demand.
  const requestMessages = useCallback(
    (conversationId: string) => {
      const entry = entries.get(conversationId);
      if (!entry || entry.state === 'idle') void loadMessages(conversationId);
    },
    [entries, loadMessages],
  );

  const api = useMemo<MessagesApi>(
    () => ({
      conversations,
      pendingFenced,
      inbox,
      entryFor,
      refreshInbox,
      sendMessage,
      createConversation,
      markRead,
      unlockMessage,
      requestMessages,
    }),
    [
      conversations,
      pendingFenced,
      inbox,
      entryFor,
      refreshInbox,
      sendMessage,
      createConversation,
      markRead,
      unlockMessage,
      requestMessages,
    ],
  );

  return <MessagesContext.Provider value={api}>{children}</MessagesContext.Provider>;
}

/** A placeholder profile for the optimistic row; the inserted row replaces it. */
function meAsPerson(id: string, email: string | null) {
  return {
    id,
    name: email?.split('@')[0] ?? 'You',
    handle: email?.split('@')[0] ?? 'you',
    avatarUrl: null,
  };
}

function useMessagesApi(): MessagesApi {
  const ctx = useContext(MessagesContext);
  if (!ctx) throw new Error('MessagesProvider is missing');
  return ctx;
}

export type ConversationSummary = Conversation & {
  title: string;
  lastMessage?: Message;
};

/**
 * Conversations newest-activity first.
 *
 * The sort stays client-side: Postgres cannot order parents by an embedded
 * resource without a denormalised last_message_at on the conversation row.
 */
export function useConversations(): ConversationSummary[] {
  const { conversations } = useMessagesApi();

  return useMemo(
    () =>
      conversations
        .map((c) => ({ ...c, title: conversationTitle(c) }))
        .sort((a, b) => (b.lastMessage?.sentAt ?? 0) - (a.lastMessage?.sentAt ?? 0)),
    [conversations],
  );
}

export function useInboxState() {
  const { inbox, refreshInbox } = useMessagesApi();
  return { state: inbox.state, error: inbox.error, refresh: refreshInbox };
}

export function useConversation(id: string): {
  conversation: Conversation | undefined;
  state: LoadState;
  error: string | null;
} {
  const { conversations, inbox } = useMessagesApi();
  const conversation = conversations.find((c) => c.id === id);
  // Not-found is only meaningful once the inbox has actually loaded. Reporting
  // it while loading is what made this screen say "Conversation not found."
  // during every cold start.
  return { conversation, state: inbox.state, error: inbox.error };
}

/** Messages for a conversation, oldest first. Fetches on first use. */
export function useMessages(conversationId: string): {
  messages: Message[];
  state: LoadState;
  error: string | null;
} {
  const { entryFor, requestMessages } = useMessagesApi();
  const entry = entryFor(conversationId);

  useEffect(() => {
    requestMessages(conversationId);
  }, [conversationId, requestMessages]);

  return { messages: entry.messages, state: entry.state, error: entry.error };
}

/** Fenced messages this viewer has not unlocked — the set worth monitoring. */
export function usePendingFencedMessages(): Message[] {
  return useMessagesApi().pendingFenced;
}

export function useMessageActions() {
  const { sendMessage, createConversation, markRead, unlockMessage } = useMessagesApi();
  return useMemo(
    () => ({ sendMessage, createConversation, markRead, unlockMessage }),
    [sendMessage, createConversation, markRead, unlockMessage],
  );
}
