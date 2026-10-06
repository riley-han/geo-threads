import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FenceChip } from '@/components/fence-chip';
import { FencePicker } from '@/components/fence-picker';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import type { TrailRevealMode } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';
import { formatRadius, type Geofence } from '@/lib/geo';
import { useConversation, useMessageActions } from '@/store/messages-store';

/** Must match trails.step_count's check in the trails migration. */
const MIN_STOPS = 2;
const MAX_STOPS = 10;

type StopDraft = { key: string; fence?: Geofence; body: string; nextClue: string };

const MODES: { value: TrailRevealMode; label: string; detail: string }[] = [
  {
    value: 'pin',
    label: 'Show the pin',
    detail: 'Finding a stop puts the next one on the map.',
  },
  {
    value: 'clue',
    label: 'Give a clue',
    detail: 'Finding a stop reveals only your clue. They work out where to go, then check in there.',
  },
];

let nextKey = 0;
const blankStop = (): StopDraft => ({ key: `stop-${nextKey++}`, body: '', nextClue: '' });

/**
 * Builds a trail: an ordered set of places, each with a note to find there and
 * a clue to the next. Everyone in the thread can follow it, each at their own
 * pace; the server keeps later stops hidden until each person earns them.
 *
 * Params: `conversationId`, and `from=compose` when opened from the compose
 * screen, where there is no thread underneath to go back to.
 */
export default function TrailBuilderScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { conversationId, from } = useLocalSearchParams<{ conversationId: string; from?: string }>();
  const { conversation } = useConversation(conversationId);
  const { createTrail } = useMessageActions();

  const [title, setTitle] = useState('');
  const [mode, setMode] = useState<TrailRevealMode>('pin');
  const [stops, setStops] = useState<StopDraft[]>(() => [blankStop(), blankStop()]);
  const [pickingFor, setPickingFor] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const update = (key: string, patch: Partial<StopDraft>) =>
    setStops((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));

  const remove = (key: string) => setStops((prev) => prev.filter((s) => s.key !== key));

  /** The first thing stopping a send, in the order a person would fix it. */
  const problem = (): string | null => {
    if (!title.trim()) return 'Give the trail a name.';
    for (const [i, s] of stops.entries()) {
      if (!s.fence) return `Choose a place for stop ${i + 1}.`;
      if (!s.body.trim()) return `Write what they find at stop ${i + 1}.`;
      if (mode === 'clue' && i < stops.length - 1 && !s.nextClue.trim()) {
        return `Write a clue from stop ${i + 1} to stop ${i + 2}.`;
      }
    }
    return null;
  };

  const send = async () => {
    if (sending) return;
    const issue = problem();
    if (issue) {
      Alert.alert('Almost there', issue);
      return;
    }

    setSending(true);
    const { id, error } = await createTrail({
      conversationId,
      title: title.trim(),
      revealMode: mode,
      stops: stops.map((s, i) => ({
        fence: s.fence!,
        body: s.body.trim(),
        // The last stop has nowhere to point; the server ignores it anyway.
        nextClue: i < stops.length - 1 ? s.nextClue.trim() : '',
      })),
    });
    setSending(false);

    if (!id) {
      Alert.alert('Could not send the trail', error ?? 'Please try again.');
      return;
    }
    if (from === 'compose') {
      router.replace({ pathname: '/conversation/[id]', params: { id: conversationId } });
    } else {
      router.back();
    }
  };

  const picking = stops.find((s) => s.key === pickingFor);

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <View style={[styles.header, { borderBottomColor: theme.backgroundSelected }]}>
          <Pressable onPress={() => router.back()} hitSlop={10} disabled={sending}>
            <ThemedText type="linkPrimary">Cancel</ThemedText>
          </Pressable>
          <ThemedText type="smallBold">New trail</ThemedText>
          <Pressable onPress={() => void send()} hitSlop={10} disabled={sending}>
            {sending ? <ActivityIndicator /> : <ThemedText type="linkPrimary">Send</ThemedText>}
          </Pressable>
        </View>

        <KeyboardAvoidingView
          style={styles.root}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="Name your trail"
              placeholderTextColor={theme.textSecondary}
              maxLength={80}
              style={[styles.titleInput, { color: theme.text }]}
            />
            {conversation?.isGroup ? (
              <ThemedText type="small" themeColor="textSecondary">
                Everyone in this thread can follow it, each at their own pace.
              </ThemedText>
            ) : null}

            <View style={styles.section}>
              <ThemedText type="small" themeColor="textSecondary">
                After each stop
              </ThemedText>
              <View
                accessibilityRole="radiogroup"
                style={[styles.track, { backgroundColor: theme.backgroundSelected }]}>
                {MODES.map((m) => {
                  const selected = m.value === mode;
                  return (
                    <Pressable
                      key={m.value}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      onPress={() => setMode(m.value)}
                      style={[styles.segment, selected && { backgroundColor: theme.primary }]}>
                      <ThemedText
                        type={selected ? 'smallBold' : 'small'}
                        style={{ color: selected ? theme.onPrimary : theme.textSecondary }}>
                        {m.label}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </View>
              <ThemedText type="small" themeColor="textSecondary">
                {MODES.find((m) => m.value === mode)!.detail} The first stop always shows its pin.
              </ThemedText>
            </View>

            {stops.map((s, i) => {
              const last = i === stops.length - 1;
              return (
                <View
                  key={s.key}
                  style={[styles.stopCard, { backgroundColor: theme.backgroundElement }]}>
                  <View style={styles.stopHeader}>
                    <ThemedText type="heading">Stop {i + 1}</ThemedText>
                    {stops.length > MIN_STOPS ? (
                      <Pressable onPress={() => remove(s.key)} hitSlop={8}>
                        <ThemedText type="small" themeColor="textSecondary">
                          Remove
                        </ThemedText>
                      </Pressable>
                    ) : null}
                  </View>

                  <Pressable onPress={() => setPickingFor(s.key)} style={styles.placeRow}>
                    {s.fence ? (
                      <>
                        <FenceChip fence={s.fence} />
                        <ThemedText type="small" themeColor="textSecondary">
                          {formatRadius(s.fence.radiusMeters)} · Change
                        </ThemedText>
                      </>
                    ) : (
                      <View style={[styles.choose, { backgroundColor: theme.backgroundSelected }]}>
                        <ThemedText type="small">📍 Choose a place</ThemedText>
                      </View>
                    )}
                  </Pressable>

                  <TextInput
                    value={s.body}
                    onChangeText={(t) => update(s.key, { body: t })}
                    placeholder="What they find here"
                    placeholderTextColor={theme.textSecondary}
                    multiline
                    maxLength={4000}
                    style={[
                      styles.input,
                      { color: theme.text, backgroundColor: theme.backgroundSelected },
                    ]}
                  />

                  {!last ? (
                    <TextInput
                      value={s.nextClue}
                      onChangeText={(t) => update(s.key, { nextClue: t })}
                      placeholder={
                        mode === 'clue'
                          ? `Clue to stop ${i + 2}`
                          : `Clue to stop ${i + 2} (optional)`
                      }
                      placeholderTextColor={theme.textSecondary}
                      maxLength={280}
                      style={[
                        styles.input,
                        { color: theme.text, backgroundColor: theme.backgroundSelected },
                      ]}
                    />
                  ) : null}
                </View>
              );
            })}

            {stops.length < MAX_STOPS ? (
              <Pressable
                onPress={() => setStops((prev) => [...prev, blankStop()])}
                style={[styles.addStop, { borderColor: theme.backgroundSelected }]}>
                <ThemedText type="linkPrimary">Add a stop</ThemedText>
              </Pressable>
            ) : (
              <ThemedText type="small" themeColor="textSecondary" style={styles.centered}>
                A trail can have up to {MAX_STOPS} stops.
              </ThemedText>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>

      <Modal
        visible={picking != null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setPickingFor(null)}>
        {picking ? (
          <FencePicker
            initialFence={picking.fence}
            onCancel={() => setPickingFor(null)}
            onConfirm={(fence) => {
              update(picking.key, { fence });
              setPickingFor(null);
            }}
          />
        ) : null}
      </Modal>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  content: {
    padding: Spacing.four,
    gap: Spacing.four,
  },
  titleInput: {
    fontFamily: Fonts.display,
    fontSize: 26,
    paddingVertical: Spacing.one,
  },
  section: {
    gap: Spacing.two,
  },
  track: {
    flexDirection: 'row',
    padding: Spacing.half + 1,
    borderRadius: Radius.medium,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.two,
    borderRadius: Radius.medium - 3,
  },
  stopCard: {
    padding: Spacing.three,
    borderRadius: Radius.large,
    gap: Spacing.two,
  },
  stopHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  placeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flexWrap: 'wrap',
  },
  choose: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.pill,
  },
  input: {
    fontFamily: Fonts.body,
    fontSize: 16,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    borderRadius: Radius.medium,
    maxHeight: 140,
  },
  addStop: {
    alignItems: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Radius.large,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  centered: {
    textAlign: 'center',
  },
});
