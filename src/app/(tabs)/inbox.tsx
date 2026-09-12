import { useRouter } from 'expo-router';
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

import { AvatarDot } from '@/components/avatar-dot';
import { GlassPanel } from '@/components/glass-panel';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Accent, BottomTabInset, Spacing } from '@/constants/theme';
import { ME_ID } from '@/data/contacts';
import { useTheme } from '@/hooks/use-theme';
import type { LatLng } from '@/lib/geo';
import { useCurrentPosition } from '@/store/location-store';
import { isMessageLocked, useConversations, type ConversationSummary } from '@/store/messages-store';

const HEADER_HEIGHT = 140;
const FAB_SIZE = 56;
const DAY_MS = 24 * 60 * 60 * 1000;

const TIME_FORMAT = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const WEEKDAY_FORMAT = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const DATE_FORMAT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

function formatTimestamp(ts: number, now: Date): string {
  const then = new Date(ts);
  if (now.toDateString() === then.toDateString()) return TIME_FORMAT.format(then);

  const daysAgo = Math.floor((now.getTime() - ts) / DAY_MS);
  if (daysAgo <= 1) return 'Yesterday';
  if (daysAgo < 7) return WEEKDAY_FORMAT.format(then);
  return DATE_FORMAT.format(then);
}

function previewFor(conversation: ConversationSummary, position: LatLng): string {
  const last = conversation.lastMessage;
  if (!last) return 'No messages yet';
  if (isMessageLocked(last, position)) return 'Locked message';
  return `${last.senderId === ME_ID ? 'You: ' : ''}${last.body}`;
}

export default function InboxScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const position = useCurrentPosition();
  const [query, setQuery] = useState('');
  const conversations = useConversations();

  const q = query.trim().toLowerCase();
  const filtered = !q
    ? conversations
    : conversations.filter((c) => {
        if (c.title.toLowerCase().includes(q)) return true;
        // Locked bodies must not be searchable — matching one would leak it.
        const last = c.lastMessage;
        return last != null && !isMessageLocked(last, position) && last.body.toLowerCase().includes(q);
      });

  const now = new Date();
  const listTopInset = HEADER_HEIGHT + insets.top;
  const listBottomInset = BottomTabInset + Spacing.four + FAB_SIZE + Spacing.three;

  const renderItem: ListRenderItem<ConversationSummary> = ({ item, index }) => (
    <InboxRow
      conversation={item}
      preview={previewFor(item, position)}
      timestamp={item.lastMessage ? formatTimestamp(item.lastMessage.sentAt, now) : ''}
      isLast={index === filtered.length - 1}
      onPress={() => router.push({ pathname: '/conversation/[id]', params: { id: item.id } })}
    />
  );

  return (
    <ThemedView style={styles.root}>
      <FlatList
        data={filtered}
        keyExtractor={(c) => c.id}
        renderItem={renderItem}
        contentContainerStyle={{
          paddingTop: listTopInset,
          paddingBottom: listBottomInset,
        }}
        scrollIndicatorInsets={{ top: listTopInset, bottom: BottomTabInset }}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
            No conversations match “{query}”
          </ThemedText>
        }
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
              onChangeText={setQuery}
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
          onPress={() => router.push('/compose')}
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
  conversation,
  preview,
  timestamp,
  isLast,
  onPress,
}: {
  conversation: ConversationSummary;
  preview: string;
  timestamp: string;
  isLast: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const avatarSeed = conversation.participantIds[0] ?? conversation.id;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.backgroundElement }]}>
      <View style={styles.unreadColumn}>
        {conversation.unread ? <View style={styles.unreadDot} /> : null}
      </View>
      <View style={styles.avatarSlot}>
        <AvatarDot id={avatarSeed} name={conversation.title} size={44} />
      </View>
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <ThemedText
            type="default"
            numberOfLines={1}
            style={[styles.name, conversation.unread && styles.nameUnread]}>
            {conversation.title}
          </ThemedText>
          {conversation.lastMessage?.fence ? (
            <ThemedText style={styles.rowPin}>📍</ThemedText>
          ) : null}
          <ThemedText type="small" themeColor="textSecondary" style={styles.timestamp}>
            {timestamp}
          </ThemedText>
        </View>
        <ThemedText
          type="small"
          themeColor="textSecondary"
          numberOfLines={1}
          style={[styles.preview, conversation.unread && styles.previewUnread]}>
          {preview}
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
  empty: {
    textAlign: 'center',
    paddingTop: Spacing.four,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingLeft: Spacing.two,
    paddingRight: Spacing.four,
    paddingVertical: Spacing.two + 2,
  },
  avatarSlot: {
    marginRight: Spacing.three,
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
    backgroundColor: Accent,
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
  rowPin: {
    fontSize: 11,
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
