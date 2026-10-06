import { useState } from 'react';
import { Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { FenceChip } from '@/components/fence-chip';
import { FencePicker } from '@/components/fence-picker';
import { GlassPanel } from '@/components/glass-panel';
import { ThemedText } from '@/components/themed-text';
import { Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Geofence } from '@/lib/geo';

type Props = {
  /**
   * Return false (or a promise of it) to keep the draft — a send that failed
   * should not silently discard what the user typed.
   */
  onSend: (body: string, fence?: Geofence) => void | boolean | Promise<void | boolean>;
  disabled?: boolean;
  placeholder?: string;
  /** Shows a Trail button that opens the trail builder. */
  onStartTrail?: () => void;
};

export function MessageInputBar({
  onSend,
  disabled,
  placeholder = 'Message',
  onStartTrail,
}: Props) {
  const theme = useTheme();
  const [body, setBody] = useState('');
  const [fence, setFence] = useState<Geofence | undefined>();
  const [pickerOpen, setPickerOpen] = useState(false);

  const canSend = body.trim().length > 0 && !disabled;

  const send = async () => {
    if (!canSend) return;
    const result = await onSend(body.trim(), fence);
    if (result === false) return;
    setBody('');
    setFence(undefined);
  };

  return (
    <>
      <GlassPanel variant="regular" style={styles.bar}>
        {fence ? (
          <View style={styles.chipRow}>
            <FenceChip fence={fence} onRemove={() => setFence(undefined)} />
          </View>
        ) : null}

        <View style={styles.inputRow}>
          <Pressable
            onPress={() => setPickerOpen(true)}
            hitSlop={8}
            style={[
              styles.fenceButton,
              { backgroundColor: fence ? theme.accent : theme.backgroundSelected },
            ]}>
            <ThemedText style={styles.fenceGlyph}>📍</ThemedText>
          </Pressable>

          {onStartTrail ? (
            <Pressable
              onPress={onStartTrail}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel="Make a trail"
              style={[styles.trailButton, { backgroundColor: theme.backgroundSelected }]}>
              <ThemedText type="caption" style={styles.trailText}>
                Trail
              </ThemedText>
            </Pressable>
          ) : null}

          <TextInput
            value={body}
            onChangeText={setBody}
            placeholder={placeholder}
            placeholderTextColor={theme.textSecondary}
            multiline
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundSelected }]}
          />

          <Pressable
            onPress={send}
            disabled={!canSend}
            hitSlop={8}
            style={[
              styles.sendButton,
              { backgroundColor: theme.primary, opacity: canSend ? 1 : 0.4 },
            ]}>
            <ThemedText style={[styles.sendGlyph, { color: theme.onPrimary }]}>↑</ThemedText>
          </Pressable>
        </View>
      </GlassPanel>

      <Modal
        visible={pickerOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setPickerOpen(false)}>
        <FencePicker
          initialFence={fence}
          onCancel={() => setPickerOpen(false)}
          onConfirm={(next) => {
            setFence(next);
            setPickerOpen(false);
          }}
        />
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  bar: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.two,
    gap: Spacing.two,
  },
  chipRow: {
    flexDirection: 'row',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
  },
  fenceButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fenceGlyph: {
    fontSize: 16,
  },
  trailButton: {
    height: 34,
    paddingHorizontal: Spacing.two + 2,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trailText: {
    fontFamily: Fonts.bodyBold,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    minHeight: 34,
    fontFamily: Fonts.body,
    fontSize: 16,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 17,
  },
  sendButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendGlyph: {
    fontSize: 18,
    fontFamily: Fonts.bodyBold,
    lineHeight: 20,
  },
});
