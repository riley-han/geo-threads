import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { FoundBy } from '@/data/types';

const TIME_FORMAT = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const DAY_TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

/** "2:14 PM" today, "Sep 28, 2:14 PM" otherwise. Receipts are minute-precise. */
function formatFoundAt(ts: number): string {
  const then = new Date(ts);
  return new Date().toDateString() === then.toDateString()
    ? TIME_FORMAT.format(then)
    : DAY_TIME_FORMAT.format(then);
}

type Props = {
  foundBy: FoundBy[];
  /** Everyone in the thread but you: 1 in a 1:1, more in a group. */
  recipientCount: number;
};

/**
 * The sender's view of who has found their message at its place.
 *
 * Only finders who share receipts appear (RLS hides the rest), so in a group
 * "N of M" counts the people who have both found it and allowed you to know.
 */
export function FoundReceipt({ foundBy, recipientCount }: Props) {
  const [expanded, setExpanded] = useState(false);

  if (foundBy.length === 0) {
    return (
      <ThemedText type="caption" themeColor="textSecondary" style={styles.line}>
        Not found yet
      </ThemedText>
    );
  }

  if (recipientCount <= 1) {
    return (
      <ThemedText type="caption" themeColor="textSecondary" style={styles.line}>
        Found · {formatFoundAt(foundBy[0].at)}
      </ThemedText>
    );
  }

  return (
    <View style={styles.group}>
      <Pressable
        onPress={() => setExpanded((v) => !v)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityState={{ expanded }}>
        <ThemedText type="caption" themeColor="tint" style={styles.line}>
          Found by {foundBy.length} of {recipientCount} {expanded ? '▴' : '▾'}
        </ThemedText>
      </Pressable>
      {expanded
        ? foundBy.map((f) => (
            <ThemedText key={f.person.id} type="caption" themeColor="textSecondary">
              {f.person.name} · {formatFoundAt(f.at)}
            </ThemedText>
          ))
        : null}
    </View>
  );
}

const styles = StyleSheet.create({
  line: {
    marginTop: Spacing.half,
  },
  group: {
    alignItems: 'flex-end',
    gap: 2,
  },
});
