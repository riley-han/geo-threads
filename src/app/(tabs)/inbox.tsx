import { useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ListRenderItem,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassPanel } from '@/components/glass-panel';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type InboxThread = {
  id: string;
  name: string;
  initials: string;
  preview: string;
  timestamp: string;
  unread: boolean;
};

const AVATAR_COLORS = [
  '#3c87f7',
  '#e0668a',
  '#f2a94b',
  '#57c07f',
  '#a373e6',
  '#4bc0c0',
  '#ef6f6c',
  '#7a8b99',
];

const THREADS: InboxThread[] = [
  {
    id: '1',
    name: 'Ada Okafor',
    initials: 'AO',
    preview: 'Sending over the map now — new pin dropped near the pier.',
    timestamp: '9:41 AM',
    unread: true,
  },
  {
    id: '2',
    name: 'Miguel Santos',
    initials: 'MS',
    preview: 'You: on my way, ETA 10',
    timestamp: '9:12 AM',
    unread: false,
  },
  {
    id: '3',
    name: 'Priya Balachandran',
    initials: 'PB',
    preview: 'Wait — is Overlook Point closed today?',
    timestamp: '8:03 AM',
    unread: true,
  },
  {
    id: '4',
    name: 'Jonas Weber',
    initials: 'JW',
    preview: 'Got the photos, thank you 🙏',
    timestamp: 'Yesterday',
    unread: false,
  },
  {
    id: '5',
    name: 'Naomi Reyes',
    initials: 'NR',
    preview: 'Let me know when you land in Osaka',
    timestamp: 'Yesterday',
    unread: false,
  },
  {
    id: '6',
    name: 'Fenwick Trail Crew',
    initials: 'FT',
    preview: 'New thread stitched together for the ridge loop.',
    timestamp: 'Mon',
    unread: true,
  },
  {
    id: '7',
    name: 'Chidera Umeh',
    initials: 'CU',
    preview: 'You: sounds good — send coords',
    timestamp: 'Sun',
    unread: false,
  },
  {
    id: '8',
    name: 'Elena Kováč',
    initials: 'EK',
    preview: 'Rain moved in, might have to move the meetup',
    timestamp: 'Sun',
    unread: false,
  },
  {
    id: '9',
    name: 'Theo Marchetti',
    initials: 'TM',
    preview: 'The waypoint you dropped works — thanks',
    timestamp: 'Sat',
    unread: false,
  },
  {
    id: '10',
    name: 'Amara Boateng',
    initials: 'AB',
    preview: 'Draft of the itinerary is in the shared thread.',
    timestamp: 'Aug 24',
    unread: false,
  },
  {
    id: '11',
    name: 'Ren Takahashi',
    initials: 'RT',
    preview: 'Camera roll synced. Let me know what to keep.',
    timestamp: 'Aug 22',
    unread: false,
  },
  {
    id: '12',
    name: 'Sana Iqbal',
    initials: 'SI',
    preview: 'Signal is spotty here — will reply properly tonight.',
    timestamp: 'Aug 20',
    unread: false,
  },
];

const HEADER_HEIGHT = 140;
const FAB_SIZE = 56;

export default function InboxScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');

  const listTopInset = HEADER_HEIGHT + insets.top;
  const listBottomInset = BottomTabInset + Spacing.four + FAB_SIZE + Spacing.three;

  const renderItem: ListRenderItem<InboxThread> = ({ item, index }) => (
    <InboxRow thread={item} colorIndex={index} isLast={index === THREADS.length - 1} />
  );

  return (
    <ThemedView style={styles.root}>
      <FlatList
        data={THREADS}
        keyExtractor={(t) => t.id}
        renderItem={renderItem}
        contentContainerStyle={{
          paddingTop: listTopInset,
          paddingBottom: listBottomInset,
        }}
        scrollIndicatorInsets={{ top: listTopInset, bottom: BottomTabInset }}
        showsVerticalScrollIndicator
      />

      <GlassPanel variant="regular" style={[styles.header, { paddingTop: insets.top }]}>
        <View style={styles.headerInner}>
          <ThemedText type="title" style={styles.headerTitle}>
            Inbox
          </ThemedText>
          <GlassPanel variant="clear" style={styles.searchChip}>
            <ThemedText themeColor="textSecondary" style={styles.searchGlyph}>
              ⌕
            </ThemedText>
            <TextInput
              value={query}
              onChangeText={(t) => {
                setQuery(t);
                console.log('search', t);
              }}
              onFocus={() => console.log('search-focus')}
              placeholder="Search"
              placeholderTextColor={theme.textSecondary}
              style={[styles.searchInput, { color: theme.text }]}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
            />
          </GlassPanel>
        </View>
      </GlassPanel>

      <SafeAreaView edges={['bottom']} style={styles.fabWrap} pointerEvents="box-none">
        <Pressable
          onPress={() => console.log('compose')}
          style={({ pressed }) => [styles.fabPress, pressed && styles.fabPressed]}
          hitSlop={8}>
          <GlassPanel variant="regular" interactive style={styles.fab}>
            <Text style={[styles.fabGlyph, { color: theme.text }]}>✎</Text>
          </GlassPanel>
        </Pressable>
      </SafeAreaView>
    </ThemedView>
  );
}

function InboxRow({
  thread,
  colorIndex,
  isLast,
}: {
  thread: InboxThread;
  colorIndex: number;
  isLast: boolean;
}) {
  const theme = useTheme();
  const avatarColor = AVATAR_COLORS[colorIndex % AVATAR_COLORS.length];

  return (
    <Pressable
      onPress={() => console.log('open-thread', thread.id)}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.backgroundElement }]}>
      <View style={styles.unreadColumn}>
        {thread.unread ? <View style={styles.unreadDot} /> : null}
      </View>
      <View style={[styles.avatar, { backgroundColor: avatarColor }]}>
        <Text style={styles.avatarText}>{thread.initials}</Text>
      </View>
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <ThemedText
            type="default"
            numberOfLines={1}
            style={[styles.name, thread.unread && styles.nameUnread]}>
            {thread.name}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.timestamp}>
            {thread.timestamp}
          </ThemedText>
        </View>
        <ThemedText
          type="small"
          themeColor="textSecondary"
          numberOfLines={1}
          style={[styles.preview, thread.unread && styles.previewUnread]}>
          {thread.preview}
        </ThemedText>
        {!isLast ? (
          <View style={[styles.separator, { backgroundColor: theme.backgroundSelected }]} />
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  headerInner: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.three,
    gap: Spacing.two,
  },
  headerTitle: {
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '700',
  },
  searchChip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    height: 36,
    gap: Spacing.two,
  },
  searchGlyph: {
    fontSize: 18,
    lineHeight: 20,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingLeft: Spacing.two,
    paddingRight: Spacing.four,
    paddingVertical: Spacing.two + 2,
  },
  unreadColumn: {
    width: Spacing.three,
    alignItems: 'center',
    paddingTop: 20,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#3c87f7',
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.three,
  },
  avatarText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  rowBody: {
    flex: 1,
    paddingBottom: Spacing.two,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.two,
  },
  name: {
    flex: 1,
    fontSize: 16,
  },
  nameUnread: {
    fontWeight: '700',
  },
  timestamp: {
    marginLeft: 'auto',
  },
  preview: {
    marginTop: 2,
    fontSize: 14,
  },
  previewUnread: {
    fontWeight: '600',
  },
  separator: {
    position: 'absolute',
    left: 0,
    right: -Spacing.four,
    bottom: -(Spacing.two + 2),
    height: StyleSheet.hairlineWidth,
  },
  fabWrap: {
    position: 'absolute',
    right: 0,
    bottom: BottomTabInset + Spacing.three,
    paddingRight: Spacing.four,
  },
  fabPress: {
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
  },
  fabPressed: {
    opacity: 0.8,
  },
  fab: {
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabGlyph: {
    fontSize: 22,
    lineHeight: 24,
    fontWeight: '600',
  },
});
