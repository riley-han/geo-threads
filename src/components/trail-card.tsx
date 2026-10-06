import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import type { Person, Trail } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';
import type { TrailProgress } from '@/lib/trail-progress';
import { useCurrentPosition } from '@/store/location-store';
import { useMessageActions } from '@/store/messages-store';

type Props = {
  trail: Trail;
  progress: TrailProgress;
  /** Everyone else in the thread, to name finders on the creator's card. */
  participants: Person[];
  creatorName: string;
  onMakeTrail: () => void;
};

/**
 * The trail's state in the thread, below its latest visible stop.
 *
 * - Finder, clue mode, next stop hidden: the clue and an "I'm here" check-in.
 * - Finder, finished: a completion card that invites a trail back.
 * - Creator: how far each finder has got.
 *
 * In pin mode a finder needs no card mid-trail: the next stop is an ordinary
 * locked bubble with its distance.
 */
export function TrailCard({ trail, progress, participants, creatorName, onMakeTrail }: Props) {
  const theme = useTheme();

  if (progress.kind === 'creator') {
    const nameOf = (id: string) => participants.find((p) => p.id === id)?.name ?? 'Someone';
    return (
      <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText type="smallBold">{trail.title}</ThemedText>
        {progress.people.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            No stops found yet.
          </ThemedText>
        ) : (
          progress.people.map((p) => (
            <ThemedText key={p.personId} type="small" themeColor="textSecondary">
              {nameOf(p.personId)} ·{' '}
              {p.finished ? 'finished' : `${p.found} of ${progress.total}`}
            </ThemedText>
          ))
        )}
      </View>
    );
  }

  if (progress.finished) {
    return (
      <View style={[styles.card, { backgroundColor: theme.accentSoft }]}>
        <ThemedText type="smallBold" style={{ color: theme.accentText }}>
          You finished {trail.title}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          All {progress.total} stops found.
        </ThemedText>
        <Pressable
          onPress={onMakeTrail}
          style={[styles.button, { backgroundColor: theme.primary }]}>
          <ThemedText type="small" style={[styles.buttonText, { color: theme.onPrimary }]}>
            Make a trail for {creatorName.split(' ')[0]}
          </ThemedText>
        </Pressable>
      </View>
    );
  }

  const next = progress.next;
  if (!next || next.visible) return null;
  return <ClueCard trail={trail} step={next.step} total={progress.total} clue={next.clue} />;
}

const CHECK_IN_COPY = {
  not_here: 'Not quite. Keep looking.',
  too_many: 'That is a lot of tries. Give it a little while.',
} as const;

function ClueCard({
  trail,
  step,
  total,
  clue,
}: {
  trail: Trail;
  step: number;
  total: number;
  clue: string | null;
}) {
  const theme = useTheme();
  const position = useCurrentPosition();
  const { checkInTrailStep } = useMessageActions();
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const checkIn = async () => {
    if (!position || checking) return;
    setChecking(true);
    setStatus(null);
    const { result, error } = await checkInTrailStep(trail.id, step, position);
    setChecking(false);
    if (error) setStatus(error);
    else if (result && result !== 'unlocked') setStatus(CHECK_IN_COPY[result]);
    // 'unlocked': the store refetches, the stop appears and this card moves on.
  };

  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText type="caption" themeColor="textSecondary">
        {trail.title} · Stop {step} of {total}
      </ThemedText>
      <View style={styles.clueRow}>
        <ThemedText style={styles.glyph}>🔒</ThemedText>
        <ThemedText type="default" style={styles.clue}>
          {clue ?? 'Find the next stop.'}
        </ThemedText>
      </View>
      {position ? (
        <Pressable
          onPress={() => void checkIn()}
          disabled={checking}
          accessibilityRole="button"
          style={[styles.button, { backgroundColor: theme.primary }]}>
          {checking ? (
            <ActivityIndicator color={theme.onPrimary} />
          ) : (
            <ThemedText type="small" style={[styles.buttonText, { color: theme.onPrimary }]}>
              I&apos;m here
            </ThemedText>
          )}
        </Pressable>
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          Turn on location to check in.
        </ThemedText>
      )}
      {status ? (
        <ThemedText type="small" themeColor="textSecondary">
          {status}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: Spacing.three,
    marginTop: Spacing.two,
    padding: Spacing.three,
    borderRadius: Radius.large,
    gap: Spacing.one,
  },
  clueRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
  },
  glyph: {
    fontSize: 14,
  },
  clue: {
    flex: 1,
  },
  button: {
    alignSelf: 'flex-start',
    marginTop: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.pill,
    minWidth: 96,
    alignItems: 'center',
  },
  buttonText: {
    fontFamily: Fonts.bodyBold,
  },
});
