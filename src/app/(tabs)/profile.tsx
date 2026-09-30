import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppearancePicker } from '@/components/appearance-picker';
import { AvatarDot } from '@/components/avatar-dot';
import { FriendRow } from '@/components/friend-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Fonts, Radius, Spacing } from '@/constants/theme';
import type { Person } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';
import { openSystemSettings } from '@/lib/location-permissions';
import { requestNotificationAccess } from '@/lib/notifications';
import { useAuth } from '@/store/auth-store';
import { useLocation } from '@/store/location-store';
import { useMessageActions } from '@/store/messages-store';
import {
  useFriendStatusMap,
  useFriends,
  usePendingRequests,
  useSocialActions,
  useSocialState,
} from '@/store/social-store';

const ACCESS_COPY = {
  none: { label: 'Not enabled', detail: 'Messages tied to a place stay locked.' },
  foreground: { label: 'While using the app', detail: 'Messages unlock when you are in range.' },
  background: { label: 'Always', detail: 'You also get notified when you arrive somewhere.' },
  denied: { label: 'Turned off', detail: 'Enable location for Geo Threads in Settings.' },
} as const;

export default function ProfileScreen() {
  const router = useRouter();
  const theme = useTheme();

  const { signOut, profile, updateProfile, refreshProfile } = useAuth();
  const friends = useFriends();
  const requests = usePendingRequests();
  const statuses = useFriendStatusMap();
  const { acceptRequest, declineRequest, sendRequest } = useSocialActions();
  const { createConversation } = useMessageActions();
  const { access, requestForeground, requestBackground } = useLocation();
  const { state: socialState } = useSocialState();

  const [editing, setEditing] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftHandle, setDraftHandle] = useState('');
  const [saving, setSaving] = useState(false);

  const beginEdit = () => {
    setDraftName(profile?.name ?? '');
    setDraftHandle(profile?.handle ?? '');
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!profile || saving) return;

    const name = draftName.trim();
    // The column is lowercase and bare, checked against ^[a-z0-9_]{3,30}$.
    // Normalising here means a typed '@' or a capital is fixed rather than
    // rejected by the server with a check-constraint message.
    const handle = draftHandle.trim().replace(/^@+/, '').toLowerCase();

    if (!name) {
      Alert.alert('Enter a name');
      return;
    }
    if (!/^[a-z0-9_]{3,30}$/.test(handle)) {
      Alert.alert('That handle will not work', 'Use 3 to 30 letters, numbers or underscores.');
      return;
    }

    setSaving(true);
    const { error } = await updateProfile({ name, handle });
    setSaving(false);

    if (error) {
      Alert.alert('Could not save', error);
      return;
    }
    await refreshProfile();
    setEditing(false);
  };

  const enableArrivalAlerts = async () => {
    const granted = await requestNotificationAccess();
    if (granted) await requestBackground();
  };

  const [opening, setOpening] = useState<string | null>(null);

  const openConversation = async (person: Person) => {
    if (opening) return;
    setOpening(person.id);
    const { id, error } = await createConversation([person.id]);
    setOpening(null);

    if (!id) {
      Alert.alert('Could not open the conversation', error ?? 'Please try again.');
      return;
    }
    router.push({ pathname: '/conversation/[id]', params: { id } });
  };

  const accessCopy = ACCESS_COPY[access];

  const confirmSignOut = () => {
    Alert.alert('Sign out?', 'You will need to sign in again to see your threads.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void runSignOut() },
    ]);
  };

  const runSignOut = async () => {
    setSigningOut(true);
    const { error } = await signOut();
    // On success the route guard unmounts this screen, so only the failure path
    // has a component left to restore. Leaving the spinner up through the
    // unmount frame is also the right transition.
    if (error) {
      setSigningOut(false);
      Alert.alert('Could not sign out', error);
    }
  };

  return (
    <ThemedView style={styles.root}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <SafeAreaView edges={['top']}>
          <View style={styles.account}>
            {profile == null ? (
              <ActivityIndicator style={styles.accountLoading} />
            ) : (
              <>
                <AvatarDot id={profile.id} name={profile.name} size={72} />
                {editing ? (
                  <View style={styles.editFields}>
                    <TextInput
                      value={draftName}
                      onChangeText={setDraftName}
                      placeholder="Your name"
                      placeholderTextColor={theme.textSecondary}
                      style={[
                        styles.input,
                        { color: theme.text, backgroundColor: theme.backgroundSelected },
                      ]}
                    />
                    <TextInput
                      value={draftHandle}
                      onChangeText={setDraftHandle}
                      placeholder="@handle"
                      placeholderTextColor={theme.textSecondary}
                      autoCapitalize="none"
                      autoCorrect={false}
                      style={[
                        styles.input,
                        { color: theme.text, backgroundColor: theme.backgroundSelected },
                      ]}
                    />
                    <View style={styles.editActions}>
                      <Pressable onPress={() => setEditing(false)} hitSlop={8}>
                        <ThemedText type="small" themeColor="textSecondary">
                          Cancel
                        </ThemedText>
                      </Pressable>
                      <Pressable onPress={() => void saveEdit()} disabled={saving} hitSlop={8}>
                        <ThemedText type="linkPrimary">{saving ? 'Saving…' : 'Save'}</ThemedText>
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  <>
                    <ThemedText type="subtitle">{profile.name}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      @{profile.handle}
                    </ThemedText>
                    <Pressable onPress={beginEdit} hitSlop={8}>
                      <ThemedText type="linkPrimary">Edit profile</ThemedText>
                    </Pressable>
                  </>
                )}
              </>
            )}
          </View>
        </SafeAreaView>

        <View style={styles.section}>
          <ThemedText type="heading">Appearance</ThemedText>
          <AppearancePicker />
        </View>

        <View style={styles.section}>
          <ThemedText type="heading">Location</ThemedText>
          <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText type="default">{accessCopy.label}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {accessCopy.detail}
            </ThemedText>

            {access === 'none' ? (
              <Pressable
                onPress={() => void requestForeground()}
                style={[styles.cardButton, { backgroundColor: theme.primary }]}>
                <ThemedText
                  type="small"
                  style={[styles.cardButtonText, { color: theme.onPrimary }]}>
                  Enable location
                </ThemedText>
              </Pressable>
            ) : null}

            {access === 'foreground' ? (
              <Pressable
                onPress={() => void enableArrivalAlerts()}
                style={[styles.cardButton, { backgroundColor: theme.primary }]}>
                <ThemedText
                  type="small"
                  style={[styles.cardButtonText, { color: theme.onPrimary }]}>
                  Turn on arrival alerts
                </ThemedText>
              </Pressable>
            ) : null}

            {access === 'denied' ? (
              <Pressable
                onPress={openSystemSettings}
                style={[styles.cardButton, { backgroundColor: theme.primary }]}>
                <ThemedText
                  type="small"
                  style={[styles.cardButtonText, { color: theme.onPrimary }]}>
                  Open Settings
                </ThemedText>
              </Pressable>
            ) : null}
          </View>
        </View>

        {requests.length > 0 ? (
          <View style={styles.section}>
            <ThemedText type="heading">Requests</ThemedText>
            {requests.map((c) => (
              <FriendRow
                key={c.id}
                contact={c}
                status={statuses.get(c.id)}
                onAdd={() => void sendRequest(c.id)}
                onAccept={() => void acceptRequest(c.id)}
                onDecline={() => void declineRequest(c.id)}
                onMessage={() => void openConversation(c)}
                busy={opening === c.id}
              />
            ))}
          </View>
        ) : null}

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <ThemedText type="heading">Friends · {friends.length}</ThemedText>
            <Pressable onPress={() => router.push('/people')} hitSlop={8}>
              <ThemedText type="linkPrimary">Find people</ThemedText>
            </Pressable>
          </View>

          {friends.length === 0 ? (
            socialState === 'loading' || socialState === 'idle' ? (
              <ActivityIndicator style={styles.sectionLoading} />
            ) : (
              <ThemedText type="small" themeColor="textSecondary">
                No friends yet. You can only message people you have added.
              </ThemedText>
            )
          ) : (
            friends.map((c) => (
              <FriendRow
                key={c.id}
                contact={c}
                status={statuses.get(c.id)}
                onAdd={() => void sendRequest(c.id)}
                onAccept={() => void acceptRequest(c.id)}
                onDecline={() => void declineRequest(c.id)}
                onMessage={() => void openConversation(c)}
                busy={opening === c.id}
              />
            ))
          )}
        </View>

        <Pressable
          onPress={confirmSignOut}
          disabled={signingOut}
          style={({ pressed }) => [
            styles.signOutButton,
            {
              backgroundColor: theme.backgroundElement,
              opacity: pressed || signingOut ? 0.85 : 1,
            },
          ]}>
          {signingOut ? (
            <ActivityIndicator color={theme.danger} />
          ) : (
            <ThemedText type="defaultBold" themeColor="danger">
              Sign out
            </ThemedText>
          )}
        </Pressable>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.six,
    gap: Spacing.four,
  },
  sectionLoading: {
    alignSelf: 'flex-start',
  },
  accountLoading: {
    paddingVertical: Spacing.five,
  },
  account: {
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.four,
  },
  editFields: {
    alignSelf: 'stretch',
    gap: Spacing.two,
  },
  input: {
    fontFamily: Fonts.body,
    fontSize: 16,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    borderRadius: Radius.medium,
  },
  editActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.one,
  },
  section: {
    gap: Spacing.two,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  card: {
    padding: Spacing.three,
    borderRadius: Radius.large,
    gap: Spacing.one,
  },
  cardButton: {
    alignSelf: 'flex-start',
    marginTop: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 999,
  },
  cardButtonText: {
    fontFamily: Fonts.bodyBold,
  },
  signOutButton: {
    paddingVertical: Spacing.three - 2,
    borderRadius: Radius.medium,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
});
