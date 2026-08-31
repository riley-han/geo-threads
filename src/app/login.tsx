import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GeoThreadsMark } from '@/components/geo-threads-mark';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const ACCENT = '#3c87f7';
const FORM_MAX_WIDTH = 360;

export default function LoginScreen() {
  const router = useRouter();
  const theme = useTheme();
  const isDark = theme === Colors.dark;
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const canSubmit = username.trim().length > 0 && password.length > 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    console.log('sign-in', { username });
    router.replace('/home');
  };

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          style={styles.keyboardAvoider}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.column}>
            <View style={styles.hero}>
              <GeoThreadsMark size={64} />
              <ThemedText type="subtitle" style={styles.title}>
                Geo Threads
              </ThemedText>
            </View>

            <ThemedView type="backgroundElement" style={styles.card}>
              <TextInput
                value={username}
                onChangeText={setUsername}
                placeholder="Username"
                placeholderTextColor={theme.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="username"
                textContentType="username"
                returnKeyType="next"
                style={[
                  styles.input,
                  { color: theme.text, backgroundColor: theme.backgroundSelected },
                ]}
              />
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="Password"
                placeholderTextColor={theme.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="password"
                textContentType="password"
                secureTextEntry
                returnKeyType="go"
                onSubmitEditing={handleSubmit}
                style={[
                  styles.input,
                  { color: theme.text, backgroundColor: theme.backgroundSelected },
                ]}
              />

              <Pressable
                onPress={() => console.log('forgot-password')}
                hitSlop={8}
                style={styles.forgotWrap}>
                <ThemedText type="linkPrimary">Forgot password?</ThemedText>
              </Pressable>

              <Pressable
                onPress={handleSubmit}
                disabled={!canSubmit}
                style={({ pressed }) => [
                  styles.primaryButton,
                  { opacity: !canSubmit ? 0.5 : pressed ? 0.85 : 1 },
                ]}>
                <ThemedText type="default" style={styles.primaryLabel}>
                  Sign in
                </ThemedText>
              </Pressable>
            </ThemedView>

            <View style={styles.dividerRow}>
              <View style={[styles.dividerLine, { backgroundColor: theme.backgroundSelected }]} />
              <ThemedText type="small" themeColor="textSecondary">
                or
              </ThemedText>
              <View style={[styles.dividerLine, { backgroundColor: theme.backgroundSelected }]} />
            </View>

            <Pressable
              onPress={() => console.log('gmail')}
              style={({ pressed }) => [
                styles.gmailButton,
                {
                  borderColor: theme.backgroundSelected,
                  backgroundColor: isDark ? theme.backgroundElement : theme.background,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}>
              <GmailGlyph />
              <ThemedText type="default">Continue with Gmail</ThemedText>
            </Pressable>

            <View style={styles.footer}>
              <ThemedText type="small" themeColor="textSecondary">
                Don&apos;t have an account?{' '}
              </ThemedText>
              <Pressable onPress={() => console.log('sign-up')} hitSlop={6}>
                <ThemedText type="linkPrimary">Sign up</ThemedText>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

function GmailGlyph() {
  return (
    <View style={styles.gmailGlyph}>
      <ThemedText type="smallBold" style={styles.gmailGlyphText}>
        G
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  keyboardAvoider: {
    flex: 1,
  },
  column: {
    flex: 1,
    width: '100%',
    maxWidth: FORM_MAX_WIDTH,
    alignSelf: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.four,
    justifyContent: 'center',
    gap: Spacing.four,
  },
  hero: {
    alignItems: 'center',
    gap: Spacing.two,
  },
  title: {
    textAlign: 'center',
  },
  card: {
    padding: Spacing.four,
    borderRadius: Spacing.four,
    gap: Spacing.three,
  },
  input: {
    fontSize: 16,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    borderRadius: Spacing.two,
  },
  forgotWrap: {
    alignSelf: 'flex-end',
    marginTop: -Spacing.one,
  },
  primaryButton: {
    backgroundColor: ACCENT,
    paddingVertical: Spacing.three - 2,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryLabel: {
    color: '#ffffff',
    fontWeight: '600',
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  gmailButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.three - 2,
    borderRadius: Spacing.two,
    borderWidth: 1,
  },
  gmailGlyph: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#ea4335',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gmailGlyphText: {
    color: '#ffffff',
    fontSize: 12,
    lineHeight: 14,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
