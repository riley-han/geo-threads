import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { REACTIONS, type Reaction } from '@/data/reactions';
import type { MessageReaction } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  reactions: MessageReaction[];
  /** This viewer's reaction, if any. Its chip is shown selected. */
  mine: Reaction | null;
  /** Tapping a chip sets that reaction, or removes it if it is already yours. */
  onToggle: (emoji: Reaction) => void;
  align: 'start' | 'end';
};

/** Compact counts under a bubble: "❤️ 2  😂 1", in the fixed reaction order. */
export function ReactionBar({ reactions, mine, onToggle, align }: Props) {
  const theme = useTheme();
  if (reactions.length === 0) return null;

  const counts = REACTIONS.map((emoji) => ({
    emoji,
    count: reactions.filter((r) => r.emoji === emoji).length,
  })).filter((c) => c.count > 0);

  return (
    <View style={[styles.row, align === 'end' ? styles.end : styles.start]}>
      {counts.map(({ emoji, count }) => {
        const selected = emoji === mine;
        return (
          <Pressable
            key={emoji}
            onPress={() => onToggle(emoji)}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={`${emoji} ${count}${selected ? ', yours' : ''}`}
            style={[
              styles.chip,
              { backgroundColor: selected ? theme.primary : theme.backgroundSelected },
            ]}>
            <ThemedText type="caption" style={styles.emoji}>
              {emoji}
            </ThemedText>
            <ThemedText
              type="caption"
              style={[styles.count, { color: selected ? theme.onPrimary : theme.textSecondary }]}>
              {count}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.one,
    marginTop: Spacing.one,
  },
  start: {
    justifyContent: 'flex-start',
  },
  end: {
    justifyContent: 'flex-end',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.half,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: Radius.pill,
  },
  emoji: {
    fontSize: 13,
  },
  count: {
    fontFamily: Fonts.bodyBold,
  },
});
