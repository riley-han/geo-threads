import type { Geofence } from '@/lib/geo';

export type Message = {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  sentAt: number;
  fence?: Geofence;
};

export type Conversation = {
  id: string;
  participantIds: string[];
  isGroup: boolean;
  title?: string;
  unread: boolean;
};
