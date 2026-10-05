import { Pressable, StyleSheet, View } from 'react-native';

import { GlassPanel } from '@/components/glass-panel';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { REACTIONS, type Reaction } from '@/data/reactions';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  mine: Reaction | null;
  /** Called with the tapped emoji; the caller decides set vs remove. */
  onPick: (emoji: Reaction) => void;
  /** Shown above the row, e.g. "Tell Ada you found it". */
  prompt?: string;
  align: 'start' | 'end';
};

/** The fixed reaction set as one tappable row. */
export function ReactionPicker({ mine, onPick, prompt, align }: Props) {
  const theme = useTheme();

  return (
    <View style={[styles.wrap, align === 'end' ? styles.end : styles.start]}>
      {prompt ? (
        <ThemedText type="caption" themeColor="textSecondary" style={styles.prompt}>
          {prompt}
        </ThemedText>
      ) : null}
      <GlassPanel variant="regular" style={styles.panel}>
        {REACTIONS.map((emoji) => {
          const selected = emoji === mine;
          return (
            <Pressable
              key={emoji}
              onPress={() => onPick(emoji)}
              hitSlop={4}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={selected ? `Remove ${emoji}` : `React ${emoji}`}
              style={[
                styles.option,
                selected ? { backgroundColor: theme.backgroundSelected } : null,
              ]}>
              <ThemedText style={styles.emoji}>{emoji}</ThemedText>
            </Pressable>
          );
        })}
      </GlassPanel>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: Spacing.one,
    gap: Spacing.half,
  },
  start: {
    alignItems: 'flex-start',
  },
  end: {
    alignItems: 'flex-end',
  },
  prompt: {
    paddingHorizontal: Spacing.two,
  },
  panel: {
    flexDirection: 'row',
    padding: Spacing.half,
    gap: Spacing.half,
    borderRadius: Radius.pill,
  },
  option: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
  },
  emoji: {
    fontSize: 22,
    lineHeight: 28,
  },
});
