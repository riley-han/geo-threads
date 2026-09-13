import * as Notifications from 'expo-notifications';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { SQLiteProvider } from 'expo-sqlite';
import { Suspense, useEffect } from 'react';
import { ActivityIndicator, useColorScheme, View } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { DATABASE_NAME, migrateDb } from '@/db/schema';
import { GeofenceSync } from '@/store/geofence-sync';
import { LocationProvider } from '@/store/location-store';
import { MessagesProvider } from '@/store/messages-store';

// Side-effect import: the task must be registered at module scope, because the
// OS can relaunch a terminated app straight into it.
import '@/lib/geofence-task';

SplashScreen.preventAutoHideAsync();

/** Routes a tapped arrival notification to the thread it refers to. */
function useNotificationRouting() {
  const router = useRouter();
  const lastResponse = Notifications.useLastNotificationResponse();

  useEffect(() => {
    const data = lastResponse?.notification.request.content.data as
      | { conversationId?: string }
      | undefined;
    if (data?.conversationId) {
      router.push({ pathname: '/conversation/[id]', params: { id: data.conversationId } });
    } else if (lastResponse) {
      router.push('/inbox');
    }
  }, [lastResponse, router]);
}

function RootNavigator() {
  useNotificationRouting();

  return (
    <Stack initialRouteName="login" screenOptions={{ headerShown: false }}>
      <Stack.Screen name="login" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="compose" options={{ presentation: 'modal' }} />
      <Stack.Screen name="conversation/[id]" />
    </Stack>
  );
}

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Suspense fallback={<DatabaseFallback />}>
        <SQLiteProvider databaseName={DATABASE_NAME} onInit={migrateDb} useSuspense>
          <LocationProvider>
            <MessagesProvider>
              <GeofenceSync>
                <AnimatedSplashOverlay />
                <RootNavigator />
              </GeofenceSync>
            </MessagesProvider>
          </LocationProvider>
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
