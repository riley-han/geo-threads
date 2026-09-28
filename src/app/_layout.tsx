import * as Notifications from 'expo-notifications';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { SQLiteProvider, useSQLiteContext } from 'expo-sqlite';
import { Suspense, useCallback, useEffect, type ReactNode } from 'react';
import { ActivityIndicator, useColorScheme, View } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { clearMirror } from '@/db/fence-mirror';
import { DATABASE_NAME, migrateDb } from '@/db/schema';
import { AuthProvider, useAuth } from '@/store/auth-store';
import { GeofenceSync } from '@/store/geofence-sync';
import { LocationProvider } from '@/store/location-store';
import { MessagesProvider } from '@/store/messages-store';
import { SocialProvider } from '@/store/social-store';

// Side-effect import: the task must be registered at module scope, because the
// OS can relaunch a terminated app straight into it.
import '@/lib/geofence-task';

SplashScreen.preventAutoHideAsync();

/** Routes a tapped arrival notification to the thread it refers to. */
function useNotificationRouting() {
  const router = useRouter();
  const { session } = useAuth();
  const lastResponse = Notifications.useLastNotificationResponse();

  useEffect(() => {
    // Routing into a thread while signed out would be bounced by the guard
    // below and lose the notification, so wait for the session to land.
    if (!session) return;

    const data = lastResponse?.notification.request.content.data as
      | { conversationId?: string }
      | undefined;
    if (data?.conversationId) {
      router.push({ pathname: '/conversation/[id]', params: { id: data.conversationId } });
    } else if (lastResponse) {
      router.push('/messages');
    }
  }, [lastResponse, router, session]);
}

function RootNavigator() {
  const { session } = useAuth();
  const isSignedIn = session != null;

  useNotificationRouting();

  // Stack.Protected is declarative: a guarded screen cannot be navigated to at
  // all, including via a deep link, so there is no redirect effect to race and
  // no window where a signed-out deep link renders a thread before bouncing.
  // `index` stays unguarded as the anchor the router falls back to.
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />

      <Stack.Protected guard={!isSignedIn}>
        <Stack.Screen name="login" />
      </Stack.Protected>

      <Stack.Protected guard={isSignedIn}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="compose" options={{ presentation: 'modal' }} />
        <Stack.Screen name="people" options={{ presentation: 'modal' }} />
        <Stack.Screen name="map" />
        <Stack.Screen name="conversation/[id]" />
      </Stack.Protected>
    </Stack>
  );
}

/**
 * AuthProvider plus the one piece of teardown that needs the database handle:
 * the fenced-message mirror, which must not outlive the session that filled it.
 * Split out because SQLiteProvider sits above AuthProvider, so useSQLiteContext
 * is only available in a child.
 */
function AuthGate({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const clear = useCallback(async () => {
    await clearMirror(db).catch(() => {});
  }, [db]);

  return <AuthProvider onSignOut={clear}>{children}</AuthProvider>;
}

/**
 * Mounts the data providers under a key tied to the signed-in account.
 *
 * Switching accounts must not leave the previous user's threads in memory. Doing
 * that by remount rather than by a reset path means there is no bespoke cleanup
 * to forget a field in — React discards the state, and every effect (including,
 * later, realtime subscriptions) tears down through its normal cleanup.
 *
 * LocationProvider stays outside: it holds permission state and the GPS watch,
 * neither of which belongs to an account.
 */
function SignedInData({ children }: { children: ReactNode }) {
  const { session } = useAuth();

  return (
    <MessagesProvider key={session?.user.id ?? 'signed-out'}>
      <SocialProvider>{children}</SocialProvider>
    </MessagesProvider>
  );
}

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Suspense fallback={<DatabaseFallback />}>
        <SQLiteProvider databaseName={DATABASE_NAME} onInit={migrateDb} useSuspense>
          <AuthGate>
            <LocationProvider>
              <SignedInData>
                <GeofenceSync>
                  <AnimatedSplashOverlay />
                  <RootNavigator />
                </GeofenceSync>
              </SignedInData>
            </LocationProvider>
          </AuthGate>
        </SQLiteProvider>
      </Suspense>
    </ThemeProvider>
  );
}

function DatabaseFallback() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator />
    </View>
  );
}
