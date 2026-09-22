import { Redirect } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useAuth } from '@/store/auth-store';

/**
 * The unguarded anchor route. It holds the app while the persisted session is
 * read, so a returning user goes straight to the tabs instead of seeing the
 * login screen flash past.
 */
export default function Index() {
  const { initializing, session } = useAuth();

  if (initializing) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return <Redirect href={session ? '/home' : '/login'} />;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
