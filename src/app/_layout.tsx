import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { LocationProvider } from '@/store/location-store';
import { MessagesProvider } from '@/store/messages-store';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <LocationProvider>
        <MessagesProvider>
          <AnimatedSplashOverlay />
          <Stack initialRouteName="login" screenOptions={{ headerShown: false }}>
            <Stack.Screen name="login" />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="compose" options={{ presentation: 'modal' }} />
            <Stack.Screen name="conversation/[id]" />
          </Stack>
        </MessagesProvider>
      </LocationProvider>
    </ThemeProvider>
  );
}
