import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { useAuth } from '@/store/auth-store';

const ACCENT = '#3c87f7';
const FORM_MAX_WIDTH = 360;

type Mode = 'sign-in' | 'sign-up';

export default function LoginScreen() {
  const router = useRouter();
  const theme = useTheme();
  const isDark = theme === Colors.dark;
  const { signIn, signUp, sendPasswordReset } = useAuth();

  const [mode, setMode] = useState<Mode>('sign-in');
  // Supabase password auth is keyed on email, so this is an email field rather
  // than the username the mock screen collected.
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSignUp = mode === 'sign-up';

  const submit = async () => {
    if (busy) return;
    setError(null);

    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    if (isSignUp && !name.trim()) {
      setError('Enter your name.');
      return;
    }

    setBusy(true);
    try {
      if (isSignUp) {
        const { error: signUpError, needsEmailConfirmation } = await signUp({
          email,
          password,
          name,
        });
        if (signUpError) {
          setError(signUpError);
          return;
        }
        if (needsEmailConfirmation) {
          Alert.alert(
            'Confirm your email',
            `We sent a confirmation link to ${email.trim()}. Open it to finish signing up.`,
          );
          setMode('sign-in');
          setPassword('');
          return;
        }
      } else {
        const { error: signInError } = await signIn(email, password);
        if (signInError) {
          setError(signInError);
          return;
        }
      }
      // On success the session lands, the route guard opens the app screens,
      // and this screen unmounts. Replacing explicitly keeps the transition
      // immediate rather than waiting a frame for the guard.
      router.replace('/home');
    } finally {
      setBusy(false);
    }
  };

  const forgotPassword = async () => {
    if (!email.trim()) {
      setError('Enter your email first, then tap “Forgot password?”.');
      return;
    }
    setError(null);
    setBusy(true);
    const { error: resetError } = await sendPasswordReset(email);
    setBusy(false);

    if (resetError) {
      setError(resetError);
      return;
    }
    Alert.alert('Check your email', `We sent a password reset link to ${email.trim()}.`);
  };

  const continueWithGoogle = () => {
    // Google sign-in needs an OAuth provider configured in the Supabase
    // dashboard plus a deep link back into the app. See supabase/README.md —
    // until that is set up, say so rather than pretending to sign in.
    Alert.alert(
      'Not set up yet',
      'Google sign-in needs an OAuth provider configured in Supabase. See supabase/README.md.',
    );
  };

  const inputStyle = [
    styles.input,
    { color: theme.text, backgroundColor: theme.backgroundSelected },
  ];

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
              {isSignUp ? (
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="Name"
                  placeholderTextColor={theme.textSecondary}
                  autoCapitalize="words"
                  autoComplete="name"
                  textContentType="name"
                  returnKeyType="next"
                  editable={!busy}
                  style={inputStyle}
                />
              ) : null}

              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="Email"
                placeholderTextColor={theme.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                textContentType="emailAddress"
                keyboardType="email-address"
                returnKeyType="next"
                editable={!busy}
                style={inputStyle}
              />

              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="Password"
                placeholderTextColor={theme.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete={isSignUp ? 'new-password' : 'password'}
                textContentType={isSignUp ? 'newPassword' : 'password'}
                secureTextEntry
                returnKeyType="go"
                onSubmitEditing={submit}
                editable={!busy}
                style={inputStyle}
              />

              {error ? (
                <ThemedText type="small" style={styles.error}>
                  {error}
                </ThemedText>
              ) : null}

              {isSignUp ? null : (
                <Pressable onPress={forgotPassword} disabled={busy} hitSlop={8} style={styles.forgotWrap}>
                  <ThemedText type="linkPrimary">Forgot password?</ThemedText>
                </Pressable>
              )}

              <Pressable
                onPress={submit}
                disabled={busy}
                style={({ pressed }) => [
                  styles.primaryButton,
                  { opacity: pressed || busy ? 0.85 : 1 },
                ]}>
                {busy ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <ThemedText type="default" style={styles.primaryLabel}>
                    {isSignUp ? 'Create account' : 'Sign in'}
                  </ThemedText>
                )}
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
              onPress={continueWithGoogle}
              disabled={busy}
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
                {isSignUp ? 'Already have an account? ' : "Don't have an account? "}
              </ThemedText>
              <Pressable
                onPress={() => {
                  setMode(isSignUp ? 'sign-in' : 'sign-up');
                  setError(null);
                }}
                disabled={busy}
                hitSlop={6}>
                <ThemedText type="linkPrimary">{isSignUp ? 'Sign in' : 'Sign up'}</ThemedText>
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
  error: {
    color: '#ef6f6c',
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
    minHeight: 44,
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
