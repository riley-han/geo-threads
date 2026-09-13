import { Pressable, StyleSheet, View } from 'react-native';

import { FenceBadge } from '@/components/fence-chip';
import { GlassPanel } from '@/components/glass-panel';
import { ThemedText } from '@/components/themed-text';
import { Accent, Spacing } from '@/constants/theme';
import { contactById } from '@/data/contacts';
import type { Message } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';
import { formatDistance, formatRadius } from '@/lib/geo';
import { messageVisibility } from '@/lib/message-visibility';
import { useCurrentPosition } from '@/store/location-store';
import { useMessageActions } from '@/store/messages-store';

type Props = {
  message: Message;
  isMine: boolean;
  isLastInRun: boolean;
  showSender: boolean;
  /** Offer the background/notification opt-in from a locked bubble. */
  onRequestArrivalAlerts?: () => void;
};

export function MessageBubble({
  message,
  isMine,
  isLastInRun,
  showSender,
  onRequestArrivalAlerts,
}: Props) {
  const theme = useTheme();
  const position = useCurrentPosition();
  const { unlockMessage } = useMessageActions();

  const fence = message.fence;
  const visibility = messageVisibility(message, position);

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

      {visibility.kind === 'unlockable' ? (
        <Pressable onPress={() => unlockMessage(message.id)}>
          <GlassPanel
            variant="regular"
            interactive
            style={[styles.bubble, styles.lockedBubble, bubbleRadius]}>
            <View style={styles.lockHeader}>
              <ThemedText style={styles.lockGlyph}>🔓</ThemedText>
              <ThemedText type="smallBold">You&apos;re here</ThemedText>
            </View>
            <ThemedText type="small" themeColor="textSecondary" style={styles.lockHint}>
              At {visibility.fence.label}
            </ThemedText>
            <ThemedText type="small" style={styles.lockDistance}>
              Tap to unlock
            </ThemedText>
          </GlassPanel>
        </Pressable>
      ) : visibility.kind === 'locked' ? (
        <GlassPanel variant="regular" style={[styles.bubble, styles.lockedBubble, bubbleRadius]}>
          <View style={styles.lockHeader}>
            <ThemedText style={styles.lockGlyph}>🔒</ThemedText>
            <ThemedText type="smallBold">Locked message</ThemedText>
          </View>
          <ThemedText type="small" themeColor="textSecondary" style={styles.lockHint}>
            Unlock within {formatRadius(visibility.fence.radiusMeters)} of {visibility.fence.label}
          </ThemedText>
          {Number.isFinite(visibility.distanceMeters) ? (
            <ThemedText type="small" style={styles.lockDistance}>
              {formatDistance(visibility.distanceMeters)} away
            </ThemedText>
          ) : null}
          {onRequestArrivalAlerts ? (
            <Pressable onPress={onRequestArrivalAlerts} hitSlop={6} style={styles.alertsLink}>
              <ThemedText type="small" style={styles.lockDistance}>
                Notify me when I&apos;m nearby
              </ThemedText>
            </Pressable>
          ) : null}
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
  alertsLink: {
    marginTop: Spacing.one,
  },
  body: {
    fontSize: 16,
    lineHeight: 21,
  },
  bodyMine: {
    color: '#ffffff',
  },
});
