import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import type { Person, Trail, TrailFinisher } from '@/data/types';
import { useNow } from '@/hooks/use-now';
import { useTheme } from '@/hooks/use-theme';
import type { TrailProgress } from '@/lib/trail-progress';
import { useAuth } from '@/store/auth-store';
import { useCurrentPosition } from '@/store/location-store';
import { useMessageActions, useTrailFinishers } from '@/store/messages-store';

const ordinal = (n: number) => {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
};

/** "3 h" or "25 min": how long until a hint unlocks. */
function formatWait(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.ceil(minutes / 60)} h`;
}

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

  const nameOf = (id: string) => participants.find((p) => p.id === id)?.name ?? 'Someone';

  if (progress.kind === 'creator') {
    const finishedCount = progress.people.filter((p) => p.finished).length;
    return (
      <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText type="smallBold">{trail.title}</ThemedText>
        {progress.people.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            No stops found yet.
          </ThemedText>
        ) : (
          progress.people.map((p) => {
            const hinted = trail.hints.some((h) => h.personId === p.personId);
            return (
              <ThemedText key={p.personId} type="small" themeColor="textSecondary">
                {nameOf(p.personId)} ·{' '}
                {p.finished ? 'finished' : `${p.found} of ${progress.total}`}
                {hinted ? ' · used a hint' : ''}
              </ThemedText>
            );
          })
        )}
        {finishedCount > 0 ? (
          <FinishOrder trailId={trail.id} version={finishedCount} nameOf={nameOf} />
        ) : null}
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
        <FinishOrder trailId={trail.id} version={progress.found} nameOf={nameOf} />
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

/**
 * Finishing order as everyone in the thread sees it. People who turned off
 * receipts are not listed (except to themselves), and places are counted
 * among those listed.
 */
function FinishOrder({
  trailId,
  version,
  nameOf,
}: {
  trailId: string;
  version: number;
  nameOf: (id: string) => string;
}) {
  const myId = useAuth().user?.id ?? null;
  const finishers: TrailFinisher[] = useTrailFinishers(trailId, version);
  if (finishers.length === 0) return null;

  const mine = finishers.find((f) => f.personId === myId);
  return (
    <View style={styles.order}>
      {mine && finishers.length > 1 ? (
        <ThemedText type="small">You finished {ordinal(mine.place)}.</ThemedText>
      ) : null}
      {finishers.slice(0, 5).map((f) => (
        <ThemedText key={f.personId} type="small" themeColor="textSecondary">
          {ordinal(f.place)} · {f.personId === myId ? 'You' : nameOf(f.personId)}
        </ThemedText>
      ))}
    </View>
  );
}

const CHECK_IN_COPY = {
  not_here: 'Not quite. Keep looking.',
  too_many: 'That is a lot of tries. Give it a little while.',
  not_open: 'Right place. This stop has not opened yet.',
  closed: 'Right place, but this stop has closed.',
} as const;

const HINT_COPY = {
  too_soon: 'Not yet. Try again a little later.',
  disabled: 'This trail has no hints.',
  not_needed: 'You already found this one.',
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
  const myId = useAuth().user?.id ?? null;
  const now = useNow();
  const { checkInTrailStep, requestTrailHint } = useMessageActions();
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  // When the hint opens: the creator's delay, counted from when you found the
  // previous stop. The server checks this again with its own clock.
  const foundPrevious = trail.stops
    .find((s) => s.step === step - 1)
    ?.unlocks.find((u) => u.personId === myId)?.at;
  const hintAt =
    trail.hintAfterMinutes != null && foundPrevious != null
      ? foundPrevious + trail.hintAfterMinutes * 60_000
      : null;
  const hintReady = hintAt != null && now >= hintAt;

  const revealHint = async () => {
    if (checking) return;
    setChecking(true);
    setStatus(null);
    const { result, error } = await requestTrailHint(trail.id, step);
    setChecking(false);
    if (error) setStatus(error);
    else if (result && result !== 'revealed') setStatus(HINT_COPY[result]);
    // 'revealed': the stop's pin appears and this card gives way to it.
  };

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
      {hintAt != null ? (
        hintReady ? (
          <Pressable
            onPress={() => void revealHint()}
            disabled={checking}
            hitSlop={6}
            accessibilityRole="button">
            <ThemedText type="linkPrimary">Show me the pin</ThemedText>
          </Pressable>
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            Stuck? A hint opens in {formatWait(hintAt - now)}.
          </ThemedText>
        )
      ) : null}
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
  order: {
    marginTop: Spacing.one,
    gap: 2,
  },
});
