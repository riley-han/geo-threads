import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import type { Message, Trail, TrailFinisher } from '@/data/types';
import { useNow } from '@/hooks/use-now';
import { useTheme } from '@/hooks/use-theme';
import { formatMoment } from '@/lib/format-moment';
import { formatDistance } from '@/lib/geo';
import { messageVisibility, UNLOCK_REFUSED_COPY } from '@/lib/message-visibility';
import type { CreatorProgress, FinderProgress } from '@/lib/trail-progress';
import { useAuth } from '@/store/auth-store';
import { useCurrentPosition } from '@/store/location-store';
import { useMessageActions, useTrailFinishers } from '@/store/messages-store';

export const ordinal = (n: number) => {
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
  /** The trail's stops that this viewer can see, by step. */
  stopMessages: Map<number, Message>;
  progress: FinderProgress;
  creatorName: string;
  nameOf: (id: string) => string;
  onMakeTrail: () => void;
};

/**
 * The one thing to do next on a trail, for a finder:
 * - pin mode: where the next stop is, how far, and an unlock once you're there;
 * - clue mode: the clue, an "I'm here" check-in, and a hint once you've been stuck;
 * - finished: the finishing order and an invitation to make a trail back.
 */
export function TrailNextStep({
  trail,
  stopMessages,
  progress,
  creatorName,
  nameOf,
  onMakeTrail,
}: Props) {
  const theme = useTheme();

  if (progress.finished) {
    return (
      <View style={[styles.panel, { backgroundColor: theme.accentSoft }]}>
        <ThemedText type="heading" style={{ color: theme.accentText }}>
          You finished
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          All {progress.total} stops found
          {progress.finishedAt ? ` · ${formatMoment(progress.finishedAt)}` : ''}.
        </ThemedText>
        <FinishOrder trailId={trail.id} version={progress.found} nameOf={nameOf} />
        <Pressable
          onPress={onMakeTrail}
          accessibilityRole="button"
          style={[styles.button, { backgroundColor: theme.primary }]}>
          <ThemedText type="small" style={[styles.buttonText, { color: theme.onPrimary }]}>
            Make a trail for {creatorName.split(' ')[0]}
          </ThemedText>
        </Pressable>
      </View>
    );
  }

  const next = progress.next;
  if (!next) return null;
  const message = stopMessages.get(next.step);
  if (next.visible && message) {
    return <PinStep trail={trail} step={next.step} message={message} clue={next.clue} />;
  }
  return <ClueStep trail={trail} step={next.step} clue={next.clue} />;
}

function PinStep({
  trail,
  step,
  message,
  clue,
}: {
  trail: Trail;
  step: number;
  message: Message;
  clue: string | null;
}) {
  const theme = useTheme();
  const position = useCurrentPosition();
  const now = useNow();
  const { unlockMessage } = useMessageActions();
  const [unlocking, setUnlocking] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const visibility = messageVisibility(message, position, now);
  const label = message.fence?.label ?? 'the next stop';

  const unlock = async () => {
    if (!position || unlocking) return;
    setUnlocking(true);
    setStatus(null);
    const { result, error } = await unlockMessage(message.id, position);
    setUnlocking(false);
    if (error) setStatus(error);
    else if (result && result !== 'unlocked') setStatus(UNLOCK_REFUSED_COPY[result]);
  };

  return (
    <View style={[styles.panel, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText type="caption" themeColor="textSecondary">
        Next · Stop {step} of {trail.total}
      </ThemedText>
      <ThemedText type="heading">📍 {label}</ThemedText>
      {clue ? (
        <ThemedText type="default" themeColor="textSecondary">
          {clue}
        </ThemedText>
      ) : null}

      {visibility.kind === 'unlockable' ? (
        <Pressable
          onPress={() => void unlock()}
          disabled={unlocking}
          accessibilityRole="button"
          style={[styles.button, { backgroundColor: theme.accent }]}>
          {unlocking ? (
            <ActivityIndicator color={theme.onAccent} />
          ) : (
            <ThemedText type="small" style={[styles.buttonText, { color: theme.onAccent }]}>
              🔓 You&apos;re here. Unlock it
            </ThemedText>
          )}
        </Pressable>
      ) : visibility.kind === 'locked' ? (
        <ThemedText type="small" style={[styles.strong, { color: theme.accentText }]}>
          {Number.isFinite(visibility.distanceMeters)
            ? `${formatDistance(visibility.distanceMeters)} away`
            : 'Turn on location to see how far'}
        </ThemedText>
      ) : visibility.kind === 'scheduled' ? (
        <ThemedText type="small" style={[styles.strong, { color: theme.accentText }]}>
          Opens {formatMoment(visibility.opensAt)}
        </ThemedText>
      ) : visibility.kind === 'closed' ? (
        <ThemedText type="small" themeColor="textSecondary">
          This stop closed {formatMoment(visibility.closedAt)}.
        </ThemedText>
      ) : null}

      {status ? <ThemedText type="small">{status}</ThemedText> : null}
    </View>
  );
}

const HINT_COPY = {
  too_soon: 'Not yet. Try again a little later.',
  disabled: 'This trail has no hints.',
  not_needed: 'You already found this one.',
} as const;

function ClueStep({ trail, step, clue }: { trail: Trail; step: number; clue: string | null }) {
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
    // 'revealed': the stop's pin appears and this panel becomes the pin step.
  };

  const checkIn = async () => {
    if (!position || checking) return;
    setChecking(true);
    setStatus(null);
    const { result, error } = await checkInTrailStep(trail.id, step, position);
    setChecking(false);
    if (error) setStatus(error);
    else if (result && result !== 'unlocked') setStatus(UNLOCK_REFUSED_COPY[result]);
    // 'unlocked': the store refetches, the stop appears and this panel moves on.
  };

  return (
    <View style={[styles.panel, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText type="caption" themeColor="textSecondary">
        Your clue · Stop {step} of {trail.total}
      </ThemedText>
      <ThemedText type="heading">{clue ?? 'Find the next stop.'}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Work out where it points, go there, then check in.
      </ThemedText>

      {position ? (
        <Pressable
          onPress={() => void checkIn()}
          disabled={checking}
          accessibilityRole="button"
          style={[styles.button, { backgroundColor: theme.accent }]}>
          {checking ? (
            <ActivityIndicator color={theme.onAccent} />
          ) : (
            <ThemedText type="small" style={[styles.buttonText, { color: theme.onAccent }]}>
              I&apos;m here
            </ThemedText>
          )}
        </Pressable>
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          Turn on location to check in.
        </ThemedText>
      )}

      {status ? <ThemedText type="small">{status}</ThemedText> : null}

      {hintAt != null ? (
        hintReady ? (
          <Pressable
            onPress={() => void revealHint()}
            disabled={checking}
            hitSlop={6}
            accessibilityRole="button">
            <ThemedText type="linkPrimary">Stuck? Show me the pin</ThemedText>
          </Pressable>
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            Stuck? A hint opens in {formatWait(hintAt - now)}.
          </ThemedText>
        )
      ) : null}
    </View>
  );
}

/** The creator's view: who is following and how far each has got. */
export function TrailFollowers({
  trail,
  progress,
  nameOf,
}: {
  trail: Trail;
  progress: CreatorProgress;
  nameOf: (id: string) => string;
}) {
  const theme = useTheme();
  const finishedCount = progress.people.filter((p) => p.finished).length;

  return (
    <View style={[styles.panel, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText type="caption" themeColor="textSecondary">
        Following
      </ThemedText>
      {progress.people.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          No one has found a stop yet. You&apos;ll hear when they do.
        </ThemedText>
      ) : (
        progress.people.map((p) => {
          const hinted = trail.hints.some((h) => h.personId === p.personId);
          return (
            <View key={p.personId} style={styles.followerRow}>
              <ThemedText type="default" numberOfLines={1} style={styles.flex}>
                {nameOf(p.personId)}
              </ThemedText>
              <ProgressDots total={progress.total} found={p.found} />
              <ThemedText type="small" themeColor="textSecondary" style={styles.followerCount}>
                {p.finished ? 'Done' : `${p.found}/${progress.total}`}
                {hinted ? ' · hint' : ''}
              </ThemedText>
            </View>
          );
        })
      )}
      {finishedCount > 0 ? (
        <FinishOrder trailId={trail.id} version={finishedCount} nameOf={nameOf} />
      ) : null}
    </View>
  );
}

/** One segment per stop: found in teal, the next in gold, the rest empty. */
export function ProgressDots({
  total,
  found,
  showNext = false,
}: {
  total: number;
  found: number;
  showNext?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={styles.dots} accessibilityLabel={`${found} of ${total} stops found`}>
      {Array.from({ length: total }, (_, i) => (
        <View
          key={i}
          style={[
            styles.dot,
            {
              backgroundColor:
                i < found
                  ? theme.secondary
                  : showNext && i === found
                    ? theme.accent
                    : theme.backgroundSelected,
            },
          ]}
        />
      ))}
    </View>
  );
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
        <ThemedText type="smallBold">You finished {ordinal(mine.place)}.</ThemedText>
      ) : null}
      {finishers.slice(0, 5).map((f) => (
        <ThemedText key={f.personId} type="small" themeColor="textSecondary">
          {ordinal(f.place)} · {f.personId === myId ? 'You' : nameOf(f.personId)}
        </ThemedText>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    padding: Spacing.three,
    borderRadius: Radius.large,
    gap: Spacing.two,
  },
  button: {
    alignSelf: 'stretch',
    marginTop: Spacing.one,
    paddingVertical: Spacing.two + 4,
    borderRadius: Radius.medium,
    alignItems: 'center',
  },
  buttonText: {
    fontFamily: Fonts.bodyBold,
  },
  strong: {
    fontFamily: Fonts.bodyBold,
  },
  order: {
    marginTop: Spacing.one,
    gap: 2,
  },
  followerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  followerCount: {
    minWidth: 52,
    textAlign: 'right',
  },
  flex: {
    flex: 1,
  },
  dots: {
    flexDirection: 'row',
    gap: 3,
  },
  dot: {
    width: 14,
    height: 6,
    borderRadius: 3,
  },
});
