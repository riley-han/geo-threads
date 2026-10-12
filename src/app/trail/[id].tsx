import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FoundReceipt } from '@/components/found-receipt';
import { MessageBubble } from '@/components/message-bubble';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TrailMap } from '@/components/trail-map';
import type { TrailMapStop, TrailMapStopState } from '@/components/trail-map.types';
import { TrailFollowers, TrailNextStep } from '@/components/trail-status';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { fenceKey, type Message, type TrailRevealMode } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';
import { formatMoment } from '@/lib/format-moment';
import { formatDistance, routeMeters } from '@/lib/geo';
import { trailProgress } from '@/lib/trail-progress';
import { useAuth } from '@/store/auth-store';
import {
  conversationTitle,
  useConversation,
  useConversationTrails,
  useMessages,
} from '@/store/messages-store';

type StopState = TrailMapStopState | 'hidden';

/**
 * One trail, on its own screen: the route so far on a map, the one thing to do
 * next, and every stop in order. Stops you have not earned are listed by
 * number only; the server never sent them, so there is nothing else to show.
 *
 * Params: `id` (the trail) and `conversationId` (its thread).
 */
export default function TrailScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { id, conversationId } = useLocalSearchParams<{ id: string; conversationId: string }>();
  const myId = useAuth().user?.id ?? null;
  const trail = useConversationTrails(conversationId).find((t) => t.id === id);
  const { conversation, state: conversationState } = useConversation(conversationId);
  const { messages, state: messagesState } = useMessages(conversationId);

  const scrollRef = useRef<ScrollView>(null);
  const stopOffsets = useRef(new Map<number, number>());
  const listOffset = useRef(0);

  if (!trail || !myId) {
    const loading =
      conversationState === 'loading' ||
      conversationState === 'idle' ||
      messagesState === 'loading' ||
      messagesState === 'idle';
    return (
      <ThemedView style={styles.root}>
        <SafeAreaView style={styles.missing}>
          {loading ? (
            <ActivityIndicator />
          ) : (
            <>
              <ThemedText type="default">This trail is not here any more.</ThemedText>
              <Pressable onPress={() => router.back()} hitSlop={10}>
                <ThemedText type="linkPrimary">Go back</ThemedText>
              </Pressable>
            </>
          )}
        </SafeAreaView>
      </ThemedView>
    );
  }

  const participants = conversation?.participants ?? [];
  const nameOf = (personId: string) =>
    personId === myId ? 'You' : (participants.find((p) => p.id === personId)?.name ?? 'Someone');
  const creatorName = nameOf(trail.creatorId);

  const progress = trailProgress(trail, myId);
  const stopMessages = new Map<number, Message>();
  for (const m of messages) {
    if (m.trail?.id === trail.id) stopMessages.set(m.trail.step, m);
  }

  const stateOf = (step: number): StopState => {
    if (!stopMessages.has(step)) return 'hidden';
    if (progress.kind === 'creator') return 'ahead';
    if (step <= progress.found) return 'found';
    if (progress.next?.step === step) return 'next';
    return 'ahead';
  };

  const steps = Array.from({ length: trail.total }, (_, i) => i + 1);
  const mapStops: TrailMapStop[] = steps.flatMap((step) => {
    const fence = stopMessages.get(step)?.fence;
    const state = stateOf(step);
    return fence && state !== 'hidden' ? [{ step, fence, state }] : [];
  });
  const hiddenCount = trail.total - mapStops.length;

  const scrollToStop = (step: number) => {
    const y = stopOffsets.current.get(step);
    if (y != null) scrollRef.current?.scrollTo({ y: listOffset.current + y - Spacing.three });
  };

  const makeTrail = () =>
    router.push({ pathname: '/trail-builder', params: { conversationId } });

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={styles.headerSide}>
            <ThemedText type="linkPrimary" style={styles.backGlyph}>
              ‹
            </ThemedText>
          </Pressable>
          <ThemedText type="smallBold" numberOfLines={1} style={styles.headerTitle}>
            {conversation ? conversationTitle(conversation) : 'Trail'}
          </ThemedText>
          <View style={styles.headerSide} />
        </View>
      </SafeAreaView>

      <ScrollView ref={scrollRef} contentContainerStyle={styles.content}>
        <View style={styles.titleBlock}>
          <ThemedText type="small" themeColor="textSecondary">
            {progress.kind === 'creator' ? 'Your trail' : `From ${creatorName}`} ·{' '}
            {MODE_LABEL[trail.revealMode]}
          </ThemedText>
          <ThemedText type="title">{trail.title}</ThemedText>
        </View>

        <View style={[styles.mapCard, { backgroundColor: theme.backgroundElement }]}>
          <TrailMap stops={mapStops} onSelectStop={scrollToStop} />
        </View>
        <ThemedText type="small" themeColor="textSecondary" style={styles.mapCaption}>
          {routeCaption(mapStops, hiddenCount, trail.total)}
        </ThemedText>

        {progress.kind === 'creator' ? (
          <TrailFollowers trail={trail} progress={progress} nameOf={nameOf} />
        ) : (
          <TrailNextStep
            trail={trail}
            stopMessages={stopMessages}
            progress={progress}
            creatorName={creatorName}
            nameOf={nameOf}
            onMakeTrail={makeTrail}
          />
        )}

        <View
          style={styles.stops}
          onLayout={(e) => {
            listOffset.current = e.nativeEvent.layout.y;
          }}>
          <ThemedText type="heading">Stops</ThemedText>
          {steps.map((step) => (
            <View
              key={step}
              onLayout={(e) => stopOffsets.current.set(step, e.nativeEvent.layout.y)}>
              <StopRow
                step={step}
                last={step === trail.total}
                state={stateOf(step)}
                message={stopMessages.get(step)}
                revealMode={trail.revealMode}
                recipientCount={participants.length}
              />
            </View>
          ))}
        </View>
      </ScrollView>
    </ThemedView>
  );
}

const MODE_LABEL: Record<TrailRevealMode, string> = {
  pin: 'Each stop shows the next pin',
  clue: 'Each stop gives a clue',
};

function routeCaption(stops: TrailMapStop[], hidden: number, total: number): string {
  const length = routeMeters(stops.map((s) => s.fence));
  // A loop shows itself once its last stop does: the route closes on stop 1.
  const first = stops[0]?.fence;
  const end = stops[stops.length - 1]?.fence;
  const loop =
    stops.length >= 3 &&
    stops[stops.length - 1].step === total &&
    first != null &&
    end != null &&
    fenceKey(first) === fenceKey(end);
  const shown =
    stops.length > 1
      ? `${loop ? 'A loop, about' : 'About'} ${formatDistance(length)} between stops as the crow flies`
      : '';
  if (hidden === 0) return shown || `${total} stops`;
  const rest = `${hidden} more ${hidden === 1 ? 'stop appears' : 'stops appear'} as you go`;
  return shown ? `${shown}. ${rest}.` : `${rest}.`;
}

function StopRow({
  step,
  last,
  state,
  message,
  revealMode,
  recipientCount,
}: {
  step: number;
  last: boolean;
  state: StopState;
  message: Message | undefined;
  revealMode: TrailRevealMode;
  recipientCount: number;
}) {
  const theme = useTheme();

  const marker = {
    found: { ground: theme.secondary, ink: theme.secondarySoft },
    next: { ground: theme.accent, ink: theme.onAccent },
    ahead: { ground: theme.primary, ink: theme.onPrimary },
    hidden: { ground: theme.backgroundSelected, ink: theme.textSecondary },
  }[state];

  const window =
    message && (message.opensAt || message.closesAt)
      ? [
          message.opensAt ? `Opens ${formatMoment(message.opensAt)}` : null,
          message.closesAt ? `closes ${formatMoment(message.closesAt)}` : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : null;

  return (
    <View style={styles.stopRow}>
      <View style={styles.rail}>
        <View style={[styles.marker, { backgroundColor: marker.ground }]}>
          <ThemedText type="small" style={[styles.markerText, { color: marker.ink }]}>
            {state === 'found' ? '✓' : step}
          </ThemedText>
        </View>
        {!last ? <View style={[styles.railLine, { backgroundColor: theme.backgroundSelected }]} /> : null}
      </View>

      <View style={styles.stopBody}>
        {message && state !== 'hidden' ? (
          <>
            <ThemedText type="defaultBold" numberOfLines={1}>
              {message.fence?.label ?? `Stop ${step}`}
            </ThemedText>
            {window ? (
              <ThemedText type="small" themeColor="textSecondary">
                {window}
              </ThemedText>
            ) : null}

            {message.isMine ? (
              <>
                <View style={[styles.note, { backgroundColor: theme.backgroundElement }]}>
                  <ThemedText type="default">{message.body}</ThemedText>
                </View>
                {message.trail?.nextClue ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    Clue to stop {step + 1}: {message.trail.nextClue}
                  </ThemedText>
                ) : null}
                {message.status === 'sent' ? (
                  <FoundReceipt foundBy={message.foundBy} recipientCount={recipientCount} />
                ) : null}
              </>
            ) : (
              <>
                <View style={styles.bubble}>
                  <MessageBubble
                    message={message}
                    isMine={false}
                    isLastInRun
                    showSender={false}
                    recipientCount={recipientCount}
                  />
                </View>
                {state === 'found' && message.trail?.nextClue ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    Clue to stop {step + 1}: {message.trail.nextClue}
                  </ThemedText>
                ) : null}
              </>
            )}
          </>
        ) : (
          <>
            <ThemedText type="defaultBold" themeColor="textSecondary">
              Stop {step}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {revealMode === 'clue'
                ? 'Revealed when you check in with the clue.'
                : `Appears when you find stop ${step - 1}.`}
            </ThemedText>
          </>
        )}
      </View>
    </View>
  );
}

const MARKER = 28;

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  missing: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
  },
  headerSide: {
    minWidth: 44,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
  },
  backGlyph: {
    fontSize: 30,
    lineHeight: 34,
  },
  content: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.six,
    gap: Spacing.three,
  },
  titleBlock: {
    gap: Spacing.one,
  },
  mapCard: {
    height: 260,
    borderRadius: Radius.large,
    overflow: 'hidden',
  },
  mapCaption: {
    marginTop: -Spacing.two,
  },
  stops: {
    marginTop: Spacing.two,
    gap: Spacing.two,
  },
  stopRow: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  rail: {
    alignItems: 'center',
    width: MARKER,
  },
  marker: {
    width: MARKER,
    height: MARKER,
    borderRadius: MARKER / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    lineHeight: 18,
  },
  railLine: {
    flex: 1,
    width: 2,
    marginTop: Spacing.one,
    minHeight: Spacing.four,
  },
  stopBody: {
    flex: 1,
    gap: Spacing.one,
    paddingBottom: Spacing.three,
    paddingTop: Spacing.half,
  },
  note: {
    padding: Spacing.three,
    borderRadius: Radius.large,
    marginTop: Spacing.one,
  },
  // MessageBubble carries the thread's side gutter; the timeline has its own.
  bubble: {
    marginHorizontal: -Spacing.three,
  },
});
