import type { Message } from '@/data/types';

/** Where tapping a message elsewhere in the app should land: a trail stop opens its trail. */
export function messageRoute(message: Message) {
  return message.trail
    ? ({
        pathname: '/trail/[id]',
        params: { id: message.trail.id, conversationId: message.conversationId },
      } as const)
    : ({ pathname: '/conversation/[id]', params: { id: message.conversationId } } as const);
}
