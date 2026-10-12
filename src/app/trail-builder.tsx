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

import { DateTimeField } from '@/components/date-time-field';
import { FenceChip } from '@/components/fence-chip';
import { FencePicker } from '@/components/fence-picker';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TrailMap } from '@/components/trail-map';
import type { TrailMapStop } from '@/components/trail-map.types';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { TRAIL_TEMPLATES, type TrailTemplate } from '@/data/trail-templates';
import type { TrailRevealMode } from '@/data/types';
import { useNow } from '@/hooks/use-now';
import { useTheme } from '@/hooks/use-theme';
import { formatDistance, routeMeters, type Geofence } from '@/lib/geo';
import { useConversation, useMessageActions } from '@/store/messages-store';

/** Must match trails.step_count's check in the trails migration. */
const MIN_STOPS = 2;
const MAX_STOPS = 10;

type StopDraft = {
  key: string;
  fence?: Geofence;
  body: string;
  nextClue: string;
  opensAt: Date | null;
  closesAt: Date | null;
  /** The time window fields are tucked away until asked for. */
  showWindow: boolean;
  /** From a template: placeholders and a tip, never text the creator didn't write. */
  bodyPrompt?: string;
  cluePrompt?: string;
  timeTip?: string;
};

const MODES: { value: TrailRevealMode; label: string; detail: string }[] = [
  {
    value: 'pin',
    label: 'Show the next pin',
    detail: 'Finding a stop puts the next one on their map.',
  },
  {
    value: 'clue',
    label: 'Give a clue',
    detail: 'Finding a stop reveals only your clue. They work out where to go, then check in there.',
  },
];

/** Choices for how long a clue-mode finder must be stuck before a hint. */
const HINT_DELAYS: { minutes: number | null; label: string }[] = [
  { minutes: null, label: 'Never' },
  { minutes: 60, label: '1 h' },
  { minutes: 360, label: '6 h' },
  { minutes: 1440, label: '24 h' },
];

let nextKey = 0;
const blankStop = (prompts: Partial<StopDraft> = {}): StopDraft => ({
  key: `stop-${nextKey++}`,
  body: '',
  nextClue: '',
  opensAt: null,
  closesAt: null,
  showWindow: false,
  ...prompts,
});

/** A starting time for a new window: the next whole hour, tomorrow. */
const tomorrowOnTheHour = () => {
  const d = new Date(Date.now() + 86_400_000);
  d.setMinutes(0, 0, 0);
  return d;
};

/**
 * Builds a trail: an ordered set of places, each with a note to find there and
 * a clue to the next. The route draws itself on the map as stops are placed,
 * so the shape of the walk is visible before it is sent. Everyone in the
 * thread can follow it, each at their own pace; the server keeps later stops
 * hidden until each person earns them.
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
  const [hintAfter, setHintAfter] = useState<number | null>(1440);
  const [stops, setStops] = useState<StopDraft[]>(() => [blankStop(), blankStop()]);
  const [openKey, setOpenKey] = useState<string | null>(() => stops[0].key);
  const [pickingFor, setPickingFor] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const now = useNow();

  const update = (key: string, patch: Partial<StopDraft>) =>
    setStops((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));

  const remove = (key: string) => {
    setStops((prev) => prev.filter((s) => s.key !== key));
    if (openKey === key) setOpenKey(null);
  };

  const move = (key: string, by: -1 | 1) =>
    setStops((prev) => {
      const i = prev.findIndex((s) => s.key === key);
      const j = i + by;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const addStop = () => {
    const stop = blankStop();
    setStops((prev) => [...prev, stop]);
    setOpenKey(stop.key);
  };

  // Templates are offered only before anything has been entered, so choosing
  // one can never overwrite someone's work.
  const pristine = !title.trim() && stops.every((s) => !s.fence && !s.body.trim() && !s.nextClue.trim());

  const applyTemplate = (t: TrailTemplate) => {
    const next = t.stops.map((p) => blankStop({ ...p, showWindow: false }));
    setTitle(t.title);
    setMode(t.revealMode);
    setHintAfter(t.hintAfterMinutes ?? (t.revealMode === 'clue' ? 1440 : null));
    setStops(next);
    setOpenKey(next[0].key);
  };

  /** The first thing stopping a send, in the order a person would fix it. */
  const problem = (): { text: string; key?: string } | null => {
    if (!title.trim()) return { text: 'Give the trail a name.' };
    for (const [i, s] of stops.entries()) {
      if (!s.fence) return { text: `Choose a place for stop ${i + 1}.`, key: s.key };
      if (!s.body.trim()) return { text: `Write what they find at stop ${i + 1}.`, key: s.key };
      if (mode === 'clue' && i < stops.length - 1 && !s.nextClue.trim()) {
        return { text: `Write a clue from stop ${i + 1} to stop ${i + 2}.`, key: s.key };
      }
      if (s.opensAt && s.closesAt && s.closesAt <= s.opensAt) {
        return { text: `Stop ${i + 1} closes before it opens.`, key: s.key };
      }
      if (s.closesAt && s.closesAt.getTime() <= now) {
        return { text: `Stop ${i + 1} would already be closed.`, key: s.key };
      }
    }
    return null;
  };
  const issue = problem();

  const send = async () => {
    if (sending) return;
    if (issue) {
      if (issue.key) setOpenKey(issue.key);
      Alert.alert('Almost there', issue.text);
      return;
    }

    setSending(true);
    const { id, error } = await createTrail({
      conversationId,
      title: title.trim(),
      revealMode: mode,
      hintAfterMinutes: mode === 'clue' ? hintAfter : null,
      stops: stops.map((s, i) => ({
        fence: s.fence!,
        body: s.body.trim(),
        // The last stop has nowhere to point; the server ignores it anyway.
        nextClue: i < stops.length - 1 ? s.nextClue.trim() : '',
        opensAt: s.opensAt,
        closesAt: s.closesAt,
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

  const pickingIndex = stops.findIndex((s) => s.key === pickingFor);
  const picking = pickingIndex >= 0 ? stops[pickingIndex] : undefined;

  const mapStops: TrailMapStop[] = stops.flatMap((s, i) =>
    s.fence ? [{ step: i + 1, fence: s.fence, state: s.key === openKey ? 'next' : 'ahead' }] : [],
  );
  const placed = mapStops.length;
  const length = routeMeters(mapStops.map((s) => s.fence));

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <View style={[styles.header, { borderBottomColor: theme.backgroundSelected }]}>
          <Pressable onPress={() => router.back()} hitSlop={10} disabled={sending}>
            <ThemedText type="linkPrimary">Cancel</ThemedText>
          </Pressable>
          <ThemedText type="smallBold">New trail</ThemedText>
          <View style={styles.headerSpacer} />
        </View>

        <KeyboardAvoidingView
          style={styles.root}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <View style={styles.section}>
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
            </View>

            <View>
              <View
                style={[
                  styles.mapCard,
                  placed === 0 && styles.mapCardEmpty,
                  { backgroundColor: theme.backgroundElement },
                ]}>
                {placed > 0 ? (
                  <TrailMap
                    stops={mapStops}
                    onSelectStop={(step) => setOpenKey(stops[step - 1]?.key ?? null)}
                  />
                ) : (
                  <View style={styles.mapEmpty}>
                    <ThemedText style={styles.mapEmptyGlyph}>📍</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" style={styles.centered}>
                      Your route draws here as you choose a place for each stop.
                    </ThemedText>
                  </View>
                )}
              </View>
              <ThemedText type="small" themeColor="textSecondary" style={styles.mapCaption}>
                {placed === 0
                  ? `${stops.length} stops, none placed yet`
                  : `${placed} of ${stops.length} placed${
                      placed > 1 ? ` · about ${formatDistance(length)} as the crow flies` : ''
                    }`}
              </ThemedText>
            </View>

            {pristine ? (
              <View style={styles.section}>
                <ThemedText type="small" themeColor="textSecondary">
                  Or start from an idea
                </ThemedText>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.templateRow}>
                  {TRAIL_TEMPLATES.map((t) => (
                    <Pressable
                      key={t.id}
                      onPress={() => applyTemplate(t)}
                      style={({ pressed }) => [
                        styles.templateCard,
                        { backgroundColor: theme.backgroundElement },
                        pressed && styles.pressed,
                      ]}>
                      <ThemedText type="smallBold">{t.name}</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary" numberOfLines={3}>
                        {t.description}
                      </ThemedText>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            ) : null}

            <View style={styles.section}>
              <ThemedText type="heading">Stops</ThemedText>
              {stops.map((s, i) => (
                <StopEditor
                  key={s.key}
                  stop={s}
                  index={i}
                  count={stops.length}
                  mode={mode}
                  open={s.key === openKey}
                  onToggle={() => setOpenKey(s.key === openKey ? null : s.key)}
                  onChange={(patch) => update(s.key, patch)}
                  onPickPlace={() => setPickingFor(s.key)}
                  onMove={(by) => move(s.key, by)}
                  onRemove={stops.length > MIN_STOPS ? () => remove(s.key) : undefined}
                />
              ))}
              {stops.length < MAX_STOPS ? (
                <Pressable
                  onPress={addStop}
                  style={[styles.addStop, { borderColor: theme.backgroundSelected }]}>
                  <ThemedText type="linkPrimary">Add a stop</ThemedText>
                </Pressable>
              ) : (
                <ThemedText type="small" themeColor="textSecondary" style={styles.centered}>
                  A trail can have up to {MAX_STOPS} stops.
                </ThemedText>
              )}
            </View>

            <View style={styles.section}>
              <ThemedText type="heading">After each stop</ThemedText>
              <Segmented
                options={MODES.map((m) => ({ key: m.value, label: m.label }))}
                selected={mode}
                onSelect={(v) => setMode(v as TrailRevealMode)}
              />
              <ThemedText type="small" themeColor="textSecondary">
                {MODES.find((m) => m.value === mode)!.detail} The first stop always shows its pin.
              </ThemedText>

              {mode === 'clue' ? (
                <>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.subLabel}>
                    Show the pin to someone stuck for
                  </ThemedText>
                  <Segmented
                    options={HINT_DELAYS.map((d) => ({ key: String(d.minutes), label: d.label }))}
                    selected={String(hintAfter)}
                    onSelect={(v) => setHintAfter(v === 'null' ? null : Number(v))}
                  />
                </>
              ) : null}
            </View>
          </ScrollView>

          <View style={[styles.footer, { borderTopColor: theme.backgroundSelected }]}>
            {issue ? (
              <ThemedText type="small" themeColor="textSecondary" style={styles.centered}>
                {issue.text}
              </ThemedText>
            ) : null}
            <Pressable
              onPress={() => void send()}
              disabled={sending}
              accessibilityRole="button"
              accessibilityState={{ disabled: issue != null }}
              style={[
                styles.sendButton,
                { backgroundColor: issue ? theme.backgroundSelected : theme.primary },
              ]}>
              {sending ? (
                <ActivityIndicator color={theme.onPrimary} />
              ) : (
                <ThemedText
                  type="defaultBold"
                  style={{ color: issue ? theme.textSecondary : theme.onPrimary }}>
                  Send trail
                </ThemedText>
              )}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>

      <Modal
        visible={picking != null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setPickingFor(null)}>
        {picking ? (
          <FencePicker
            title={`Stop ${pickingIndex + 1}`}
            confirmLabel="Done"
            initialFence={picking.fence ?? previousFence(stops, pickingIndex)}
            route={{ stops: stops.map((s) => s.fence), index: pickingIndex }}
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

/**
 * Where a new stop's picker opens: next to the previous stop, so a route is
 * built outward from where it already is. Copied, not shared: the label is
 * cleared so the new stop gets its own name.
 */
function previousFence(stops: StopDraft[], index: number): Geofence | undefined {
  for (let i = index - 1; i >= 0; i--) {
    const f = stops[i].fence;
    if (f) return { ...f, label: '' };
  }
  return undefined;
}

function StopEditor({
  stop: s,
  index: i,
  count,
  mode,
  open,
  onToggle,
  onChange,
  onPickPlace,
  onMove,
  onRemove,
}: {
  stop: StopDraft;
  index: number;
  count: number;
  mode: TrailRevealMode;
  open: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<StopDraft>) => void;
  onPickPlace: () => void;
  onMove: (by: -1 | 1) => void;
  onRemove?: () => void;
}) {
  const theme = useTheme();
  const last = i === count - 1;
  const clueRequired = mode === 'clue' && !last;
  const complete = s.fence != null && s.body.trim() !== '' && (!clueRequired || s.nextClue.trim() !== '');

  const inputStyle = [styles.input, { color: theme.text, backgroundColor: theme.backgroundSelected }];

  return (
    <View style={[styles.stopCard, { backgroundColor: theme.backgroundElement }]}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={styles.stopHeader}>
        <View
          style={[
            styles.stopNumber,
            { backgroundColor: open ? theme.accent : s.fence ? theme.primary : theme.backgroundSelected },
          ]}>
          <ThemedText
            type="small"
            style={[
              styles.stopNumberText,
              { color: open ? theme.onAccent : s.fence ? theme.onPrimary : theme.textSecondary },
            ]}>
            {i + 1}
          </ThemedText>
        </View>
        <View style={styles.stopSummary}>
          <ThemedText type="defaultBold" numberOfLines={1}>
            {s.fence?.label || (i === 0 ? 'Where it starts' : last ? 'Where it ends' : `Stop ${i + 1}`)}
          </ThemedText>
          {!open ? (
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {s.body.trim() || (s.fence ? 'No note yet' : 'No place yet')}
            </ThemedText>
          ) : null}
        </View>
        <ThemedText type="small" themeColor="textSecondary">
          {open ? 'Done' : complete ? '✓' : 'Edit'}
        </ThemedText>
      </Pressable>

      {open ? (
        <View style={styles.stopFields}>
          {s.fence ? (
            <View style={styles.placeRow}>
              <FenceChip fence={s.fence} />
              <Pressable onPress={onPickPlace} hitSlop={8}>
                <ThemedText type="small" themeColor="tint">
                  Change
                </ThemedText>
              </Pressable>
            </View>
          ) : (
            <Pressable
              onPress={onPickPlace}
              style={[styles.choose, { backgroundColor: theme.backgroundSelected }]}>
              <ThemedText type="small">📍 Choose a place</ThemedText>
            </Pressable>
          )}

          <TextInput
            value={s.body}
            onChangeText={(t) => onChange({ body: t })}
            placeholder={s.bodyPrompt ?? 'What they find here'}
            placeholderTextColor={theme.textSecondary}
            multiline
            maxLength={4000}
            style={inputStyle}
          />

          {!last ? (
            <TextInput
              value={s.nextClue}
              onChangeText={(t) => onChange({ nextClue: t })}
              placeholder={
                s.cluePrompt ??
                (clueRequired ? `Clue to stop ${i + 2}` : `Clue to stop ${i + 2} (optional)`)
              }
              placeholderTextColor={theme.textSecondary}
              maxLength={280}
              style={inputStyle}
            />
          ) : null}

          {s.showWindow || s.opensAt || s.closesAt ? (
            <View style={styles.windowFields}>
              <DateTimeField
                label="Opens"
                setLabel="Set an opening time"
                value={s.opensAt}
                onChange={(d) => onChange({ opensAt: d })}
                suggest={tomorrowOnTheHour}
              />
              <DateTimeField
                label="Closes"
                setLabel="Set a closing time"
                value={s.closesAt}
                onChange={(d) => onChange({ closesAt: d })}
                suggest={() => new Date((s.opensAt ?? tomorrowOnTheHour()).getTime() + 3 * 3_600_000)}
                minimumDate={s.opensAt ?? new Date()}
              />
            </View>
          ) : (
            <View style={styles.windowFields}>
              {s.timeTip ? (
                <ThemedText type="small" themeColor="textSecondary">
                  {s.timeTip}
                </ThemedText>
              ) : null}
              <Pressable onPress={() => onChange({ showWindow: true })} hitSlop={6} style={styles.link}>
                <ThemedText type="small" themeColor="tint">
                  Only open at certain times
                </ThemedText>
              </Pressable>
            </View>
          )}

          <View style={[styles.stopActions, { borderTopColor: theme.backgroundSelected }]}>
            {i > 0 ? (
              <Pressable onPress={() => onMove(-1)} hitSlop={8}>
                <ThemedText type="small" themeColor="tint">
                  Move earlier
                </ThemedText>
              </Pressable>
            ) : null}
            {!last ? (
              <Pressable onPress={() => onMove(1)} hitSlop={8}>
                <ThemedText type="small" themeColor="tint">
                  Move later
                </ThemedText>
              </Pressable>
            ) : null}
            <View style={styles.flex} />
            {onRemove ? (
              <Pressable onPress={onRemove} hitSlop={8}>
                <ThemedText type="small" themeColor="danger">
                  Remove stop
                </ThemedText>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function Segmented({
  options,
  selected,
  onSelect,
}: {
  options: { key: string; label: string }[];
  selected: string;
  onSelect: (key: string) => void;
}) {
  const theme = useTheme();
  return (
    <View accessibilityRole="radiogroup" style={[styles.track, { backgroundColor: theme.backgroundSelected }]}>
      {options.map((o) => {
        const on = o.key === selected;
        return (
          <Pressable
            key={o.key}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            onPress={() => onSelect(o.key)}
            style={[styles.segment, on && { backgroundColor: theme.primary }]}>
            <ThemedText
              type={on ? 'smallBold' : 'small'}
              style={{ color: on ? theme.onPrimary : theme.textSecondary }}>
              {o.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
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
  headerSpacer: {
    minWidth: 52,
  },
  content: {
    padding: Spacing.four,
    gap: Spacing.five,
  },
  mapCard: {
    height: 220,
    borderRadius: Radius.large,
    overflow: 'hidden',
  },
  mapCardEmpty: {
    height: 140,
  },
  mapEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.five,
  },
  mapEmptyGlyph: {
    fontSize: 28,
    lineHeight: 34,
  },
  mapCaption: {
    marginTop: Spacing.two,
  },
  titleInput: {
    fontFamily: Fonts.display,
    fontSize: 26,
    paddingVertical: Spacing.one,
  },
  section: {
    gap: Spacing.two,
  },
  subLabel: {
    marginTop: Spacing.two,
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
  templateRow: {
    gap: Spacing.two,
  },
  templateCard: {
    width: 168,
    padding: Spacing.three,
    borderRadius: Radius.large,
    gap: Spacing.one,
  },
  pressed: {
    opacity: 0.8,
  },
  stopCard: {
    borderRadius: Radius.large,
    overflow: 'hidden',
  },
  stopHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
  },
  stopNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopNumberText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 13,
    lineHeight: 18,
  },
  stopSummary: {
    flex: 1,
    gap: 2,
  },
  stopFields: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.three,
    gap: Spacing.two,
  },
  placeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  choose: {
    alignSelf: 'flex-start',
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
  windowFields: {
    gap: Spacing.two,
    paddingVertical: Spacing.one,
  },
  link: {
    alignSelf: 'flex-start',
  },
  stopActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.four,
    paddingTop: Spacing.three,
    marginTop: Spacing.one,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  flex: {
    flex: 1,
  },
  addStop: {
    alignItems: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Radius.large,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  footer: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
    gap: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  sendButton: {
    alignItems: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Radius.medium,
  },
  centered: {
    textAlign: 'center',
  },
});
