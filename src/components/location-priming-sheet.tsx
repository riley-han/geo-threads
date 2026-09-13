import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Accent, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type PrimingVariant = 'foreground' | 'background' | 'denied';

const COPY: Record<PrimingVariant, { glyph: string; title: string; body: string; cta: string }> = {
  foreground: {
    glyph: '📍',
    title: 'Unlock messages where you are',
    body: 'Some messages are tied to a place and only open when you are there. Geo Threads checks your location to know when that is — only while the app is open.',
    cta: 'Use my location',
  },
  background: {
    glyph: '🔔',
    title: 'Know when something is waiting',
    body: 'Get a notification when you walk into a place where a message is waiting for you. This needs Always access so we can check while the app is closed. We never share where you are.',
    cta: 'Notify me on arrival',
  },
  denied: {
    glyph: '⚙️',
    title: 'Location is turned off',
    body: 'Messages tied to a place stay locked until Geo Threads can tell you are there. You can turn location back on for this app in Settings.',
    cta: 'Open Settings',
  },
};

type Props = {
  visible: boolean;
  variant: PrimingVariant;
  onAllow: () => void;
  onDismiss: () => void;
};

export function LocationPrimingSheet({ visible, variant, onAllow, onDismiss }: Props) {
  const theme = useTheme();
  const copy = COPY[variant];

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onDismiss}>
      <View style={styles.backdrop}>
        <ThemedView style={styles.sheet}>
          <SafeAreaView edges={['bottom']}>
            <View style={styles.content}>
              <View style={[styles.glyphWrap, { backgroundColor: theme.backgroundElement }]}>
                <ThemedText style={styles.glyph}>{copy.glyph}</ThemedText>
              </View>

              <ThemedText type="subtitle" style={styles.title}>
                {copy.title}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.body}>
                {copy.body}
              </ThemedText>

              <Pressable
                onPress={onAllow}
                style={({ pressed }) => [styles.primary, { opacity: pressed ? 0.85 : 1 }]}>
                <ThemedText type="default" style={styles.primaryLabel}>
                  {copy.cta}
                </ThemedText>
              </Pressable>

              <Pressable onPress={onDismiss} hitSlop={8} style={styles.secondary}>
                <ThemedText type="small" themeColor="textSecondary">
                  Not now
                </ThemedText>
              </Pressable>
            </View>
          </SafeAreaView>
        </ThemedView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    borderTopLeftRadius: Spacing.five,
    borderTopRightRadius: Spacing.five,
  },
  content: {
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.five,
    paddingBottom: Spacing.four,
    gap: Spacing.three,
  },
  glyphWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyph: {
    fontSize: 28,
  },
  title: {
    textAlign: 'center',
    fontSize: 24,
    lineHeight: 30,
  },
  body: {
    textAlign: 'center',
  },
  primary: {
    alignSelf: 'stretch',
    backgroundColor: Accent,
    paddingVertical: Spacing.three - 2,
    borderRadius: Spacing.two,
    alignItems: 'center',
    marginTop: Spacing.two,
  },
  primaryLabel: {
    color: '#ffffff',
    fontWeight: '600',
  },
  secondary: {
    paddingVertical: Spacing.two,
  },
});
