import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AvatarDot } from '@/components/avatar-dot';
import { GlassPanel } from '@/components/glass-panel';
import { HomeMapHero } from '@/components/home-map-hero';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Accent, BottomTabInset, Spacing } from '@/constants/theme';
import { DEFAULT_POSITION } from '@/data/places';
import type { Message } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';
import { formatDistance, type Geofence } from '@/lib/geo';
import { messageVisibility } from '@/lib/message-visibility';
import { useAuth } from '@/store/auth-store';
import { useCurrentPosition } from '@/store/location-store';
import {
  useConversations,
  useInboxState,
  usePendingFencedMessages,
} from '@/store/messages-store';
import { useFriends, usePendingRequests, useSocialState } from '@/store/social-store';

const MAP_HEIGHT = 200;

type WaitingItem = {
  message: Message;
  fence: Geofence;
  distanceMeters: number;
};

export default function HomeScreen() {
  const router = useRouter();
  const theme = useTheme();
  const position = useCurrentPosition();
  const { profile } = useAuth();
  const conversations = useConversations();
  const pendingFenced = usePendingFencedMessages();
  const friends = useFriends();
  const requests = usePendingRequests();
  const { state: inboxState } = useInboxState();
  const { state: socialState } = useSocialState();

  const inboxLoading = inboxState === 'loading' || inboxState === 'idle';
  const socialLoading = socialState === 'loading' || socialState === 'idle';

  const waiting: WaitingItem[] = pendingFenced
    .map((message) => {
      const v = messageVisibility(message, position);
      return v.kind === 'locked' && Number.isFinite(v.distanceMeters)
        ? { message, fence: v.fence, distanceMeters: v.distanceMeters }
        : null;
    })
    .filter((x): x is WaitingItem => x !== null)
    .sort((a, b) => a.distanceMeters - b.distanceMeters);

  const recent = conversations.slice(0, 3);

  return (
    <ThemedView style={styles.root}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <SafeAreaView edges={['top']}>
          <View style={styles.header}>
            <View style={styles.headerText}>
              <ThemedText type="small" themeColor="textSecondary">
                Welcome back
              </ThemedText>
              <ThemedText type="subtitle" style={styles.headerName}>
                {profile?.name ?? ''}
              </ThemedText>
            </View>
            <Pressable onPress={() => router.push('/profile')} hitSlop={8}>
              {/* Omitted rather than shown with a placeholder name: an avatar
                  that changes colour once the profile lands looks like a bug. */}
              {profile ? <AvatarDot id={profile.id} name={profile.name} size={40} /> : null}
            </Pressable>
          </View>

          <Pressable
            onPress={() => router.push('/people')}
            style={[styles.searchChip, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText themeColor="textSecondary" style={styles.searchGlyph}>
              ⌕
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Find people
            </ThemedText>
          </Pressable>
        </SafeAreaView>

        <Pressable onPress={() => router.push('/map')} style={styles.mapCard}>
          <HomeMapHero
            position={position ?? DEFAULT_POSITION}
            fences={waiting.map((w) => w.fence)}
          />
          <GlassPanel variant="regular" style={styles.mapBadge}>
            <ThemedText type="small" style={styles.mapBadgeText}>
              {waiting.length > 0
                ? `${waiting.length} waiting nearby`
                : 'Nothing waiting nearby'}
            </ThemedText>
          </GlassPanel>
        </Pressable>

        <Section title="Waiting for you">
          {waiting.length === 0 ? (
            <View style={[styles.empty, { backgroundColor: theme.backgroundElement }]}>
              {inboxLoading ? (
                <ActivityIndicator />
              ) : (
                <>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
                    Nothing waiting nearby. Leave a message somewhere for someone to find.
                  </ThemedText>
                  <Pressable onPress={() => router.push('/compose')} style={styles.emptyButton}>
                    <ThemedText type="small" style={styles.emptyButtonText}>
                      New message
                    </ThemedText>
                  </Pressable>
                </>
              )}
            </View>
          ) : (
            waiting.slice(0, 4).map(({ message, fence, distanceMeters }) => (
              <Pressable
                key={message.id}
                onPress={() =>
                  router.push({
                    pathname: '/conversation/[id]',
                    params: { id: message.conversationId },
                  })
                }
                style={({ pressed }) => [
                  styles.row,
                  { backgroundColor: theme.backgroundElement },
                  pressed && { opacity: 0.8 },
                ]}>
                <ThemedText style={styles.rowGlyph}>🔒</ThemedText>
                <View style={styles.rowBody}>
                  <ThemedText type="default" numberOfLines={1}>
                    {message.sender.name}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                    {fence.label}
                  </ThemedText>
                </View>
                <ThemedText type="small" style={styles.rowDistance}>
                  {formatDistance(distanceMeters)}
                </ThemedText>
              </Pressable>
            ))
          )}
        </Section>

        <Section
          title="Recent"
          action={{ label: 'See all', onPress: () => router.push('/messages') }}>
          {recent.length === 0 ? (
            inboxLoading ? (
              <ActivityIndicator style={styles.sectionLoading} />
            ) : (
              <ThemedText type="small" themeColor="textSecondary">
                No conversations yet — start one from the inbox.
              </ThemedText>
            )
          ) : null}

          {recent.map((c) => (
            <Pressable
              key={c.id}
              onPress={() => router.push({ pathname: '/conversation/[id]', params: { id: c.id } })}
              style={({ pressed }) => [
                styles.row,
                { backgroundColor: theme.backgroundElement },
                pressed && { opacity: 0.8 },
              ]}>
              <AvatarDot id={c.participants[0]?.id ?? c.id} name={c.title} size={34} />
              <View style={styles.rowBody}>
                <ThemedText type="default" numberOfLines={1}>
                  {c.title}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                  {c.lastMessage
                    ? messageVisibility(c.lastMessage, position).kind === 'open'
                      ? c.lastMessage.body
                      : 'Locked message'
                    : 'No messages yet'}
                </ThemedText>
              </View>
            </Pressable>
          ))}
        </Section>

        <Section
          title="Friends"
          action={{ label: 'Find people', onPress: () => router.push('/people') }}>
          {requests.length > 0 ? (
            <Pressable
              onPress={() => router.push('/people')}
              style={[styles.requestBanner, { borderColor: Accent }]}>
              <ThemedText type="small" style={styles.requestText}>
                {requests.length} friend request{requests.length === 1 ? '' : 's'}
              </ThemedText>
            </Pressable>
          ) : null}

          {friends.length === 0 ? (
            socialLoading ? (
              <ActivityIndicator style={styles.sectionLoading} />
            ) : (
              <ThemedText type="small" themeColor="textSecondary">
                No friends yet — find people to message.
              </ThemedText>
            )
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.friendRow}>
                {friends.map((f) => (
                  <View key={f.id} style={styles.friendItem}>
                    <AvatarDot id={f.id} name={f.name} size={52} />
                    <ThemedText type="small" numberOfLines={1} style={styles.friendName}>
                      {f.name.split(' ')[0]}
                    </ThemedText>
                  </View>
                ))}
              </View>
            </ScrollView>
          )}
        </Section>
      </ScrollView>
    </ThemedView>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: { label: string; onPress: () => void };
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <ThemedText type="smallBold">{title}</ThemedText>
        {action ? (
          <Pressable onPress={action.onPress} hitSlop={8}>
            <ThemedText type="linkPrimary">{action.label}</ThemedText>
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Spacing.three,
    paddingBottom: Spacing.three,
  },
  headerText: {
    flex: 1,
  },
  headerName: {
    fontSize: 26,
    lineHeight: 32,
  },
  searchChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    height: 40,
    paddingHorizontal: Spacing.three,
    borderRadius: 999,
  },
  searchGlyph: {
    fontSize: 18,
    lineHeight: 20,
  },
  mapCard: {
    height: MAP_HEIGHT,
    borderRadius: Spacing.four,
    overflow: 'hidden',
  },
  mapBadge: {
    position: 'absolute',
    left: Spacing.three,
    bottom: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: 999,
  },
  mapBadgeText: {
    fontWeight: '600',
  },
  section: {
    gap: Spacing.two,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
  sectionLoading: {
    alignSelf: 'flex-start',
  },
  empty: {
    padding: Spacing.four,
    borderRadius: Spacing.three,
    alignItems: 'center',
    gap: Spacing.three,
  },
  emptyText: {
    textAlign: 'center',
  },
  emptyButton: {
    backgroundColor: Accent,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderRadius: 999,
  },
  emptyButtonText: {
    color: '#ffffff',
    fontWeight: '600',
  },
  requestBanner: {
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  requestText: {
    color: Accent,
    fontWeight: '600',
  },
  friendRow: {
    flexDirection: 'row',
    gap: Spacing.three,
    paddingVertical: Spacing.one,
  },
  friendItem: {
    alignItems: 'center',
    gap: Spacing.one,
    width: 60,
  },
  friendName: {
    fontSize: 12,
  },
});
