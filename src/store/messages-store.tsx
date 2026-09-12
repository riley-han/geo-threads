import { createContext, useContext, useReducer, type ReactNode } from 'react';

import { ME_ID, contactById } from '@/data/contacts';
import { SEED_CONVERSATIONS, SEED_MESSAGES } from '@/data/seed-conversations';
import type { Conversation, Message } from '@/data/types';
import { isInsideFence, type Geofence, type LatLng } from '@/lib/geo';

type State = {
  conversations: Conversation[];
  messages: Message[];
};

type Action =
  | { type: 'send'; message: Message }
  | { type: 'createConversation'; conversation: Conversation }
  | { type: 'markRead'; conversationId: string };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'send':
      return { ...state, messages: [...state.messages, action.message] };
    case 'createConversation':
      return { ...state, conversations: [action.conversation, ...state.conversations] };
    case 'markRead':
      return {
        ...state,
        conversations: state.conversations.map((c) =>
          c.id === action.conversationId && c.unread ? { ...c, unread: false } : c,
        ),
      };
  }
}

type MessagesApi = {
  state: State;
  sendMessage: (conversationId: string, body: string, fence?: Geofence) => void;
  createConversation: (participantIds: string[], title?: string) => string;
  markRead: (conversationId: string) => void;
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

/**
 * A fenced message is readable only from inside its fence. Every surface that
 * renders message text must ask this — bubbles, inbox previews, and search.
 */
export function isMessageLocked(message: Message, position: LatLng): boolean {
  return message.fence ? !isInsideFence(position, message.fence) : false;
}

export function MessagesProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, {
    conversations: SEED_CONVERSATIONS,
    messages: SEED_MESSAGES,
  });

  const sendMessage = (conversationId: string, body: string, fence?: Geofence) => {
    dispatch({
      type: 'send',
      message: {
        id: nextId('m'),
        conversationId,
        senderId: ME_ID,
        body,
        sentAt: Date.now(),
        fence,
      },
    });
  };

  const createConversation = (participantIds: string[], title?: string) => {
    const existing = state.conversations.find((c) =>
      sameParticipants(c.participantIds, participantIds),
    );
    if (existing) return existing.id;

    const id = nextId('c');
    dispatch({
      type: 'createConversation',
      conversation: {
        id,
        participantIds,
        isGroup: participantIds.length > 1,
        title,
        unread: false,
      },
    });
    return id;
  };

  const markRead = (conversationId: string) => dispatch({ type: 'markRead', conversationId });

  return (
    <MessagesContext.Provider value={{ state, sendMessage, createConversation, markRead }}>
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
  const { state } = useMessagesApi();

  const latest = new Map<string, Message>();
  for (const m of state.messages) {
    const current = latest.get(m.conversationId);
    if (!current || m.sentAt > current.sentAt) latest.set(m.conversationId, m);
  }

  return state.conversations
    .map((c) => ({ ...c, title: conversationTitle(c), lastMessage: latest.get(c.id) }))
    .sort((a, b) => (b.lastMessage?.sentAt ?? 0) - (a.lastMessage?.sentAt ?? 0));
}

export function useConversation(id: string): Conversation | undefined {
  const { state } = useMessagesApi();
  return state.conversations.find((c) => c.id === id);
}

/** Messages for a conversation, oldest first. */
export function useMessages(conversationId: string): Message[] {
  const { state } = useMessagesApi();
  return state.messages
    .filter((m) => m.conversationId === conversationId)
    .sort((a, b) => a.sentAt - b.sentAt);
}

export function useMessageActions() {
  const { sendMessage, createConversation, markRead } = useMessagesApi();
  return { sendMessage, createConversation, markRead };
}
