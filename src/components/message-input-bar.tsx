import { useState } from 'react';
import { Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { FenceChip } from '@/components/fence-chip';
import { FencePicker } from '@/components/fence-picker';
import { GlassPanel } from '@/components/glass-panel';
import { ThemedText } from '@/components/themed-text';
import { Accent, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Geofence } from '@/lib/geo';

type Props = {
  onSend: (body: string, fence?: Geofence) => void;
  disabled?: boolean;
  placeholder?: string;
};

export function MessageInputBar({ onSend, disabled, placeholder = 'Message' }: Props) {
  const theme = useTheme();
  const [body, setBody] = useState('');
  const [fence, setFence] = useState<Geofence | undefined>();
  const [pickerOpen, setPickerOpen] = useState(false);

  const canSend = body.trim().length > 0 && !disabled;

  const send = () => {
    if (!canSend) return;
    onSend(body.trim(), fence);
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
              { backgroundColor: fence ? Accent : theme.backgroundSelected },
            ]}>
            <ThemedText style={styles.fenceGlyph}>📍</ThemedText>
          </Pressable>

          <TextInput
            value={body}
            onChangeText={setBody}
            placeholder={placeholder}
            placeholderTextColor={theme.textSecondary}
            multiline
            style={[
              styles.input,
              { color: theme.text, backgroundColor: theme.backgroundSelected },
            ]}
          />

          <Pressable
            onPress={send}
            disabled={!canSend}
            hitSlop={8}
            style={[styles.sendButton, { opacity: canSend ? 1 : 0.4 }]}>
            <ThemedText style={styles.sendGlyph}>↑</ThemedText>
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
  input: {
    flex: 1,
    maxHeight: 120,
    minHeight: 34,
    fontSize: 16,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 17,
  },
  sendButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendGlyph: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 20,
  },
});
