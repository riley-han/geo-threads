import { StyleSheet, View } from 'react-native';

import { FenceBadge } from '@/components/fence-chip';
import { GlassPanel } from '@/components/glass-panel';
import { ThemedText } from '@/components/themed-text';
import { Accent, Spacing } from '@/constants/theme';
import { contactById } from '@/data/contacts';
import type { Message } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';
import { distanceMeters, formatDistance, formatRadius } from '@/lib/geo';
import { useCurrentPosition } from '@/store/location-store';
import { isMessageLocked } from '@/store/messages-store';

type Props = {
  message: Message;
  isMine: boolean;
  isLastInRun: boolean;
  showSender: boolean;
};

export function MessageBubble({ message, isMine, isLastInRun, showSender }: Props) {
  const theme = useTheme();
  const position = useCurrentPosition();

  const fence = message.fence;
  const locked = isMessageLocked(message, position);

  const bubbleRadius = {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderBottomLeftRadius: !isMine && isLastInRun ? 4 : 18,
    borderBottomRightRadius: isMine && isLastInRun ? 4 : 18,
  };

  const sender = contactById(message.senderId);

  return (
    <View style={[styles.row, isMine ? styles.rowMine : styles.rowTheirs]}>
      {showSender && !isMine && sender ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.senderName}>
          {sender.name}
        </ThemedText>
      ) : null}

      {locked && fence ? (
        <GlassPanel variant="regular" style={[styles.bubble, styles.lockedBubble, bubbleRadius]}>
          <View style={styles.lockHeader}>
            <ThemedText style={styles.lockGlyph}>🔒</ThemedText>
            <ThemedText type="smallBold">Locked message</ThemedText>
          </View>
          <ThemedText type="small" themeColor="textSecondary" style={styles.lockHint}>
            Unlock within {formatRadius(fence.radiusMeters)} of {fence.label}
          </ThemedText>
          <ThemedText type="small" style={styles.lockDistance}>
            {formatDistance(distanceMeters(position, fence))} away
          </ThemedText>
        </GlassPanel>
      ) : (
        <View
          style={[
            styles.bubble,
            bubbleRadius,
            isMine
              ? { backgroundColor: Accent }
              : { backgroundColor: theme.backgroundElement },
          ]}>
          <ThemedText
            type="default"
            style={[styles.body, isMine && styles.bodyMine]}>
            {message.body}
          </ThemedText>
          {fence ? <FenceBadge fence={fence} tone={isMine ? 'onAccent' : 'muted'} /> : null}
        </View>
      )}
    </View>
  );
}


const styles = StyleSheet.create({
  row: {
    paddingHorizontal: Spacing.three,
    marginTop: 2,
  },
  rowMine: {
    alignItems: 'flex-end',
  },
  rowTheirs: {
    alignItems: 'flex-start',
  },
  senderName: {
    marginLeft: Spacing.three,
    marginBottom: 2,
    marginTop: Spacing.two,
  },
  bubble: {
    maxWidth: '78%',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
  },
  lockedBubble: {
    minWidth: 200,
    gap: 2,
  },
  lockHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  lockGlyph: {
    fontSize: 13,
  },
  lockHint: {
    marginTop: 2,
  },
  lockDistance: {
    color: Accent,
    fontWeight: '600',
  },
  body: {
    fontSize: 16,
    lineHeight: 21,
  },
  bodyMine: {
    color: '#ffffff',
  },
});
