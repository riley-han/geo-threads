import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { FenceBadge } from '@/components/fence-chip';
import { FoundReceipt } from '@/components/found-receipt';
import { GlassPanel } from '@/components/glass-panel';
import { ReactionBar } from '@/components/reaction-bar';
import { ReactionPicker } from '@/components/reaction-picker';
import { ThemedText } from '@/components/themed-text';
import { Fonts, Spacing } from '@/constants/theme';
import type { Reaction } from '@/data/reactions';
import type { Message } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';
import { formatMoment } from '@/lib/format-moment';
import { formatDistance, formatRadius } from '@/lib/geo';
import { messageVisibility } from '@/lib/message-visibility';
import { useAuth } from '@/store/auth-store';
import { useCurrentPosition } from '@/store/location-store';
import { useMessageActions } from '@/store/messages-store';

type Props = {
  message: Message;
  isMine: boolean;
  isLastInRun: boolean;
  showSender: boolean;
  /** Everyone in the thread but you; sizes the "Found by N of M" receipt. */
  recipientCount: number;
  /** Offer the background/notification opt-in from a locked bubble. */
  onRequestArrivalAlerts?: () => void;
};

export function MessageBubble({
  message,
  isMine,
  isLastInRun,
  showSender,
  recipientCount,
  onRequestArrivalAlerts,
}: Props) {
  const theme = useTheme();
  const position = useCurrentPosition();
  const { unlockMessage, reactToMessage } = useMessageActions();
  const myId = useAuth().user?.id ?? null;
  const [pickerOpen, setPickerOpen] = useState(false);
  // Set when this viewer unlocks the message here, so the "tell them you found
  // it" prompt appears once, in the moment, and not on every later visit.
  const [justUnlocked, setJustUnlocked] = useState(false);

  const fence = message.fence;
  const visibility = messageVisibility(message, position);

  // You react to what you have read: only open, delivered messages.
  const canReact = visibility.kind === 'open' && message.status === 'sent';
  const mine: Reaction | null =
    message.reactions.find((r) => r.personId === myId)?.emoji ?? null;
  const align = isMine ? 'end' : 'start';
  const showNudge = canReact && justUnlocked && !isMine && mine == null;

  const pick = (emoji: Reaction) => {
    setPickerOpen(false);
    void reactToMessage(message.id, emoji === mine ? null : emoji);
  };

  const bubbleRadius = {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderBottomLeftRadius: !isMine && isLastInRun ? 4 : 18,
    borderBottomRightRadius: isMine && isLastInRun ? 4 : 18,
  };

  return (
    <View style={[styles.row, isMine ? styles.rowMine : styles.rowTheirs]}>
      {showSender && !isMine ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.senderName}>
          {message.sender.name}
        </ThemedText>
      ) : null}

      {message.trail ? (
        <ThemedText type="caption" themeColor="textSecondary" style={styles.trailLabel}>
          {message.trail.title} · Stop {message.trail.step} of {message.trail.total}
        </ThemedText>
      ) : null}

      {visibility.kind === 'unlockable' ? (
        <Pressable
          onPress={() => {
            setJustUnlocked(true);
            void unlockMessage(message.id);
          }}>
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
            <ThemedText type="small" style={[styles.lockDistance, { color: theme.accentText }]}>
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
            <ThemedText type="small" style={[styles.lockDistance, { color: theme.accentText }]}>
              {formatDistance(visibility.distanceMeters)} away
            </ThemedText>
          ) : null}
          {onRequestArrivalAlerts ? (
            <Pressable onPress={onRequestArrivalAlerts} hitSlop={6} style={styles.alertsLink}>
              <ThemedText type="small" style={[styles.lockDistance, { color: theme.accentText }]}>
                Notify me when I&apos;m nearby
              </ThemedText>
            </Pressable>
          ) : null}
        </GlassPanel>
      ) : visibility.kind === 'scheduled' || visibility.kind === 'closed' ? (
        <GlassPanel variant="regular" style={[styles.bubble, styles.lockedBubble, bubbleRadius]}>
          <View style={styles.lockHeader}>
            <ThemedText style={styles.lockGlyph}>🔒</ThemedText>
            <ThemedText type="smallBold">
              {visibility.kind === 'scheduled' ? 'Not open yet' : 'This stop has closed'}
            </ThemedText>
          </View>
          <ThemedText type="small" themeColor="textSecondary" style={styles.lockHint}>
            At {visibility.fence.label}
          </ThemedText>
          <ThemedText
            type="small"
            style={[
              styles.lockDistance,
              visibility.kind === 'scheduled'
                ? { color: theme.accentText }
                : { color: theme.textSecondary },
            ]}>
            {visibility.kind === 'scheduled'
              ? `Opens ${formatMoment(visibility.opensAt)}`
              : `Closed ${formatMoment(visibility.closedAt)}`}
          </ThemedText>
        </GlassPanel>
      ) : (
        <Pressable
          onLongPress={canReact ? () => setPickerOpen((open) => !open) : undefined}
          delayLongPress={300}
          accessibilityHint={canReact ? 'Long press to react' : undefined}
          style={styles.bubbleWidth}>
          <View
            style={[
              styles.bubble,
              styles.bubbleFill,
              bubbleRadius,
              isMine
                ? { backgroundColor: theme.primary }
                : { backgroundColor: theme.backgroundElement },
            ]}>
            <ThemedText
              type="default"
              style={[styles.body, isMine && { color: theme.onPrimary }]}>
              {message.body}
            </ThemedText>
            {fence ? <FenceBadge fence={fence} tone={isMine ? 'onPrimary' : 'muted'} /> : null}
          </View>
        </Pressable>
      )}

      {canReact ? (
        <ReactionBar
          reactions={message.reactions}
          mine={mine}
          onToggle={pick}
          align={align}
        />
      ) : null}

      {pickerOpen || showNudge ? (
        <ReactionPicker
          mine={mine}
          onPick={pick}
          align={align}
          prompt={
            showNudge && !pickerOpen
              ? `Tell ${message.sender.name.split(' ')[0]} you found it`
              : undefined
          }
        />
      ) : null}

      {isMine && fence && message.status === 'sent' ? (
        <FoundReceipt foundBy={message.foundBy} recipientCount={recipientCount} />
      ) : null}
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
  trailLabel: {
    marginTop: Spacing.two,
    marginBottom: 2,
    marginHorizontal: Spacing.two,
  },
  senderName: {
    marginLeft: Spacing.three,
    marginBottom: 2,
    marginTop: Spacing.two,
  },
  // The long-press target carries the width cap; the bubble inside fills it.
  bubbleWidth: {
    maxWidth: '78%',
  },
  bubbleFill: {
    maxWidth: '100%',
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
    fontFamily: Fonts.bodyBold,
  },
  alertsLink: {
    marginTop: Spacing.one,
  },
  body: {
    fontSize: 16,
    lineHeight: 21,
  },
});
