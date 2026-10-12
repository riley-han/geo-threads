import { Pressable, StyleSheet, View } from 'react-native';

import { ProgressDots } from '@/components/trail-status';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import type { Trail, TrailInfo } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';
import { trailProgress } from '@/lib/trail-progress';

type Props = {
  /** Null until the trail itself has loaded; the card falls back to `info`. */
  trail: Trail | undefined;
  /** From the stop's message, so the card can render before the trail loads. */
  info: TrailInfo;
  myId: string | null;
  isMine: boolean;
  creatorName: string;
  onOpen: () => void;
};

/**
 * A trail as it sits in the thread: one card where it was sent, in place of
 * its stops. Everything else (the route, each stop, check-ins) lives on the
 * trail's own screen, which this opens.
 */
export function TrailCard({ trail, info, myId, isMine, creatorName, onOpen }: Props) {
  const theme = useTheme();
  const progress = trail && myId ? trailProgress(trail, myId) : null;

  let status = 'Open to see the first stop';
  let found = 0;
  let showNext = false;
  if (progress?.kind === 'creator') {
    // The dots follow whoever is furthest along.
    found = Math.max(0, ...progress.people.map((p) => p.found));
    const finished = progress.people.filter((p) => p.finished).length;
    status =
      progress.people.length === 0
        ? 'No one has found a stop yet'
        : `${progress.people.length} following${finished ? ` · ${finished} finished` : ''}`;
  } else if (progress?.kind === 'finder') {
    found = progress.found;
    showNext = !progress.finished;
    status = progress.finished
      ? 'You finished'
      : progress.next?.visible
        ? `Next: stop ${progress.next.step}`
        : 'A clue is waiting';
  }

  return (
    <View style={[styles.row, isMine ? styles.rowMine : styles.rowTheirs]}>
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityHint="Opens the trail"
        style={({ pressed }) => [
          styles.card,
          { backgroundColor: theme.backgroundElement, borderColor: theme.border },
          pressed && styles.pressed,
        ]}>
        <ThemedText type="caption" themeColor="textSecondary">
          {isMine ? 'You left a trail' : `${creatorName} left you a trail`} · {info.total} stops
        </ThemedText>
        <ThemedText type="heading" numberOfLines={2}>
          {info.title}
        </ThemedText>
        <ProgressDots total={info.total} found={found} showNext={showNext} />
        <View style={styles.footer}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.flex} numberOfLines={1}>
            {status}
          </ThemedText>
          <ThemedText type="linkPrimary">Open ›</ThemedText>
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: Spacing.three,
    marginTop: Spacing.two,
  },
  rowMine: {
    alignItems: 'flex-end',
  },
  rowTheirs: {
    alignItems: 'flex-start',
  },
  card: {
    width: '78%',
    padding: Spacing.three,
    borderRadius: Radius.large,
    borderWidth: StyleSheet.hairlineWidth,
    gap: Spacing.two,
  },
  pressed: {
    opacity: 0.8,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  flex: {
    flex: 1,
  },
});
