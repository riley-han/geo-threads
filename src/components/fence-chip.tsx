import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Accent, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatRadius, type Geofence } from '@/lib/geo';

export function FenceChip({ fence, onRemove }: { fence: Geofence; onRemove?: () => void }) {
  const theme = useTheme();

  return (
    <View style={[styles.chip, { backgroundColor: theme.backgroundSelected }]}>
      <ThemedText style={styles.pin}>📍</ThemedText>
      <ThemedText type="small" numberOfLines={1} style={styles.label}>
        {fence.label}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {formatRadius(fence.radiusMeters)}
      </ThemedText>
      {onRemove ? (
        <Pressable onPress={onRemove} hitSlop={10} style={styles.remove}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.removeGlyph}>
            ✕
          </ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Compact inline badge for an already-sent geofenced message. */
export function FenceBadge({ fence, tone = 'muted' }: { fence: Geofence; tone?: 'muted' | 'onAccent' }) {
  const onAccent = tone === 'onAccent';
  return (
    <View style={styles.badge}>
      <ThemedText style={[styles.badgePin, onAccent && styles.badgeOnAccent]}>📍</ThemedText>
      <ThemedText
        type="small"
        themeColor={onAccent ? undefined : 'textSecondary'}
        numberOfLines={1}
        style={[styles.badgeLabel, onAccent && styles.badgeOnAccent]}>
        {fence.label} · {formatRadius(fence.radiusMeters)}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: Spacing.one,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
    borderRadius: 999,
    maxWidth: '100%',
  },
  pin: {
    fontSize: 12,
  },
  label: {
    flexShrink: 1,
    fontWeight: '600',
    color: Accent,
  },
  remove: {
    marginLeft: Spacing.half,
  },
  removeGlyph: {
    fontSize: 13,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.half,
    marginTop: Spacing.half,
  },
  badgePin: {
    fontSize: 10,
  },
  badgeLabel: {
    fontSize: 11,
    lineHeight: 16,
    flexShrink: 1,
  },
  badgeOnAccent: {
    color: 'rgba(255,255,255,0.85)',
  },
});
