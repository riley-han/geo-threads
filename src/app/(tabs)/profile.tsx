import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AvatarDot } from '@/components/avatar-dot';
import { FriendRow } from '@/components/friend-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Accent, BottomTabInset, Spacing } from '@/constants/theme';
import { ME_ID, type Contact } from '@/data/contacts';
import { useTheme } from '@/hooks/use-theme';
import { openSystemSettings } from '@/lib/location-permissions';
import { requestNotificationAccess } from '@/lib/notifications';
import { useLocation } from '@/store/location-store';
import { useMessageActions } from '@/store/messages-store';
import {
  useFriendStatusMap,
  useFriends,
  useMyProfile,
  usePendingRequests,
  useSocialActions,
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

  const profile = useMyProfile();
  const friends = useFriends();
  const requests = usePendingRequests();
  const statuses = useFriendStatusMap();
  const { updateProfile, acceptRequest, declineRequest, sendRequest } = useSocialActions();
  const { createConversation } = useMessageActions();
  const { access, requestForeground, requestBackground } = useLocation();

  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(profile.name);
  const [draftHandle, setDraftHandle] = useState(profile.handle);

  const beginEdit = () => {
    setDraftName(profile.name);
    setDraftHandle(profile.handle);
    setEditing(true);
  };

  const saveEdit = () => {
    updateProfile({
      name: draftName.trim() || 'You',
      handle: draftHandle.trim() || '@you',
    });
    setEditing(false);
  };

  const enableArrivalAlerts = async () => {
    const granted = await requestNotificationAccess();
    if (granted) await requestBackground();
  };

  const openConversation = (contact: Contact) => {
    const id = createConversation([contact.id]);
    router.push({ pathname: '/conversation/[id]', params: { id } });
  };

  const accessCopy = ACCESS_COPY[access];

  return (
    <ThemedView style={styles.root}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <SafeAreaView edges={['top']}>
          <View style={styles.account}>
            <AvatarDot id={ME_ID} name={profile.name} size={72} />
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
                  <Pressable onPress={saveEdit} hitSlop={8}>
                    <ThemedText type="linkPrimary" style={styles.save}>
                      Save
                    </ThemedText>
                  </Pressable>
                </View>
              </View>
            ) : (
              <>
                <ThemedText type="subtitle" style={styles.name}>
                  {profile.name}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {profile.handle}
                </ThemedText>
                <Pressable onPress={beginEdit} hitSlop={8}>
                  <ThemedText type="linkPrimary">Edit profile</ThemedText>
                </Pressable>
              </>
            )}
          </View>
        </SafeAreaView>

        <View style={styles.section}>
          <ThemedText type="smallBold">Location</ThemedText>
          <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText type="default">{accessCopy.label}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {accessCopy.detail}
            </ThemedText>

            {access === 'none' ? (
              <Pressable onPress={() => void requestForeground()} style={styles.cardButton}>
                <ThemedText type="small" style={styles.cardButtonText}>
                  Enable location
                </ThemedText>
              </Pressable>
            ) : null}

            {access === 'foreground' ? (
              <Pressable onPress={() => void enableArrivalAlerts()} style={styles.cardButton}>
                <ThemedText type="small" style={styles.cardButtonText}>
                  Turn on arrival alerts
                </ThemedText>
              </Pressable>
            ) : null}

            {access === 'denied' ? (
              <Pressable onPress={openSystemSettings} style={styles.cardButton}>
                <ThemedText type="small" style={styles.cardButtonText}>
                  Open Settings
                </ThemedText>
              </Pressable>
            ) : null}
          </View>
        </View>

        {requests.length > 0 ? (
          <View style={styles.section}>
            <ThemedText type="smallBold">Requests</ThemedText>
            {requests.map((c) => (
              <FriendRow
                key={c.id}
                contact={c}
                status={statuses.get(c.id)}
                onAdd={() => sendRequest(c.id)}
                onAccept={() => acceptRequest(c.id)}
                onDecline={() => declineRequest(c.id)}
                onMessage={() => openConversation(c)}
              />
            ))}
          </View>
        ) : null}

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <ThemedText type="smallBold">Friends · {friends.length}</ThemedText>
            <Pressable onPress={() => router.push('/people')} hitSlop={8}>
              <ThemedText type="linkPrimary">Find people</ThemedText>
            </Pressable>
          </View>

          {friends.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              No friends yet. You can only message people you have added.
            </ThemedText>
          ) : (
            friends.map((c) => (
              <FriendRow
                key={c.id}
                contact={c}
                status={statuses.get(c.id)}
                onAdd={() => sendRequest(c.id)}
                onAccept={() => acceptRequest(c.id)}
                onDecline={() => declineRequest(c.id)}
                onMessage={() => openConversation(c)}
              />
            ))
          )}
        </View>
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
  account: {
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.four,
  },
  name: {
    fontSize: 26,
    lineHeight: 32,
  },
  editFields: {
    alignSelf: 'stretch',
    gap: Spacing.two,
  },
  input: {
    fontSize: 16,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    borderRadius: Spacing.two,
  },
  editActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.one,
  },
  save: {
    fontWeight: '700',
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
    borderRadius: Spacing.three,
    gap: Spacing.one,
  },
  cardButton: {
    alignSelf: 'flex-start',
    marginTop: Spacing.two,
    backgroundColor: Accent,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 999,
  },
  cardButtonText: {
    color: '#ffffff',
    fontWeight: '600',
  },
});
