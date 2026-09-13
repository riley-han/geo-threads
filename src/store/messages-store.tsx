import { useSQLiteContext } from 'expo-sqlite';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { ME_ID, contactById } from '@/data/contacts';
import type { Conversation, Message } from '@/data/types';
import * as repo from '@/db/messages-repository';
import type { Geofence } from '@/lib/geo';

type MessagesApi = {
  conversations: Conversation[];
  messages: Message[];
  ready: boolean;
  sendMessage: (conversationId: string, body: string, fence?: Geofence) => void;
  createConversation: (participantIds: string[], title?: string) => string;
  markRead: (conversationId: string) => void;
  unlockMessage: (messageId: string) => void;
};

const MessagesContext = createContext<MessagesApi | null>(null);

let idCounter = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${idCounter++}`;

const sameParticipants = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join() === [...b].sort().join();

/** The display name for a thread — an explicit group title, else the participants. */
export function conversationTitle(conversation: Conversation): string {
  if (conversation.title) return conversation.title;
  return conversation.participantIds.map((id) => contactById(id)?.name ?? id).join(', ');
}

export function MessagesProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [c, m] = await Promise.all([repo.loadConversations(db), repo.loadMessages(db)]);
      if (cancelled) return;
      setConversations(c);
      setMessages(m);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [db]);

  const sendMessage = (conversationId: string, body: string, fence?: Geofence) => {
    const message = {
      id: nextId('m'),
      conversationId,
      senderId: ME_ID,
      body,
      sentAt: Date.now(),
      fence,
    };
    setMessages((prev) => [...prev, { ...message, unlockedAt: null }]);
    void repo.insertMessage(db, message);
  };

  const createConversation = (participantIds: string[], title?: string) => {
    const existing = conversations.find((c) => sameParticipants(c.participantIds, participantIds));
    if (existing) return existing.id;

    const conversation: Conversation = {
      id: nextId('c'),
      participantIds,
      isGroup: participantIds.length > 1,
      title,
      unread: false,
    };
    setConversations((prev) => [conversation, ...prev]);
    void repo.insertConversation(db, conversation);
    return conversation.id;
  };

  const markRead = (conversationId: string) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === conversationId && c.unread ? { ...c, unread: false } : c)),
    );
    void repo.markConversationRead(db, conversationId);
  };

  const unlockMessage = (messageId: string) => {
    const at = Date.now();
    setMessages((prev) =>
      prev.map((m) => (m.id === messageId && m.unlockedAt == null ? { ...m, unlockedAt: at } : m)),
    );
    void repo.markMessageUnlocked(db, messageId, at);
  };

  return (
    <MessagesContext.Provider
      value={{
        conversations,
        messages,
        ready,
        sendMessage,
        createConversation,
        markRead,
        unlockMessage,
      }}>
      {children}
    </MessagesContext.Provider>
  );
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

/** Conversations ordered newest-activity first, each with its latest message attached. */
export function useConversations(): ConversationSummary[] {
  const { conversations, messages } = useMessagesApi();

  const latest = new Map<string, Message>();
  for (const m of messages) {
    const current = latest.get(m.conversationId);
    if (!current || m.sentAt > current.sentAt) latest.set(m.conversationId, m);
  }

  return conversations
    .map((c) => ({ ...c, title: conversationTitle(c), lastMessage: latest.get(c.id) }))
    .sort((a, b) => (b.lastMessage?.sentAt ?? 0) - (a.lastMessage?.sentAt ?? 0));
}

export function useConversation(id: string): Conversation | undefined {
  return useMessagesApi().conversations.find((c) => c.id === id);
}

/** Messages for a conversation, oldest first. */
export function useMessages(conversationId: string): Message[] {
  return useMessagesApi()
    .messages.filter((m) => m.conversationId === conversationId)
    .sort((a, b) => a.sentAt - b.sentAt);
}

/** Fenced messages the reader has not unlocked — the set worth monitoring. */
export function usePendingFencedMessages(): Message[] {
  return useMessagesApi().messages.filter(
    (m) => m.fence != null && m.unlockedAt == null && m.senderId !== ME_ID,
  );
}

export function useMessageActions() {
  const { sendMessage, createConversation, markRead, unlockMessage } = useMessagesApi();
  return { sendMessage, createConversation, markRead, unlockMessage };
}
