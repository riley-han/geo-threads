import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GlassPanel } from '@/components/glass-panel';
import { MapCanvas } from '@/components/map-canvas';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Accent, Spacing } from '@/constants/theme';
import { contactById } from '@/data/contacts';
import { DEFAULT_POSITION } from '@/data/places';
import { useTheme } from '@/hooks/use-theme';
import { distanceMeters, formatDistance } from '@/lib/geo';
import { useCurrentPosition } from '@/store/location-store';
import { usePendingFencedMessages } from '@/store/messages-store';

export default function MapScreen() {
  const router = useRouter();
  const theme = useTheme();
  const position = useCurrentPosition();
  const pending = usePendingFencedMessages();

  const origin = position ?? DEFAULT_POSITION;

  const pins = pending
    .filter((m) => m.fence != null)
    .map((m) => ({
      message: m,
      fence: m.fence!,
      distance: distanceMeters(origin, m.fence!),
    }))
    .sort((a, b) => a.distance - b.distance);

  const open = (conversationId: string) =>
    router.push({ pathname: '/conversation/[id]', params: { id: conversationId } });

  return (
    <ThemedView style={styles.root}>
      <MapCanvas
        position={origin}
        fences={pins.map((p) => p.fence)}
        onSelectFence={(index) => open(pins[index].message.conversationId)}
      />

      <GlassPanel variant="regular" style={styles.header}>
        <SafeAreaView edges={['top']}>
          <View style={styles.headerInner}>
            <Pressable onPress={() => router.back()} hitSlop={12}>
              <ThemedText type="linkPrimary" style={styles.backGlyph}>
                ‹
              </ThemedText>
            </Pressable>
            <ThemedText type="smallBold">Nearby</ThemedText>
            <View style={styles.headerSpacer} />
          </View>
        </SafeAreaView>
      </GlassPanel>

      <GlassPanel variant="regular" style={styles.sheet}>
        <SafeAreaView edges={['bottom']}>
          <View style={styles.handle} />
          <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetContent}>
            {pins.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
                No locked messages anywhere yet.
              </ThemedText>
            ) : (
              pins.map(({ message, fence, distance }) => (
                <Pressable
                  key={message.id}
                  onPress={() => open(message.conversationId)}
                  style={({ pressed }) => [
                    styles.row,
                    { backgroundColor: theme.backgroundElement },
                    pressed && { opacity: 0.8 },
                  ]}>
                  <ThemedText style={styles.rowGlyph}>🔒</ThemedText>
                  <View style={styles.rowBody}>
                    <ThemedText type="default" numberOfLines={1}>
                      {contactById(message.senderId)?.name ?? 'Someone'}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                      {fence.label}
                    </ThemedText>
                  </View>
                  <ThemedText type="small" style={styles.rowDistance}>
                    {formatDistance(distance)}
                  </ThemedText>
                </Pressable>
              ))
            )}
          </ScrollView>
        </SafeAreaView>
      </GlassPanel>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  headerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
  },
  backGlyph: {
    fontSize: 30,
    lineHeight: 34,
    minWidth: 44,
  },
  headerSpacer: {
    minWidth: 44,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '45%',
    borderTopLeftRadius: Spacing.four,
    borderTopRightRadius: Spacing.four,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(128,128,128,0.5)',
    marginTop: Spacing.two,
  },
  sheetScroll: {
    marginTop: Spacing.two,
  },
  sheetContent: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.four,
    gap: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  rowGlyph: {
    fontSize: 20,
  },
  rowBody: {
    flex: 1,
  },
  rowDistance: {
    color: Accent,
    fontWeight: '600',
  },
  empty: {
    textAlign: 'center',
    paddingVertical: Spacing.four,
  },
});
