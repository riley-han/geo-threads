import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassPanel } from '@/components/glass-panel';
import { MessageInputBar } from '@/components/message-input-bar';
import { AvatarDot } from '@/components/avatar-dot';
import { MessageBubble } from '@/components/message-bubble';
import { TrailCard } from '@/components/trail-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import type { Message, Trail, TrailInfo } from '@/data/types';
import { LocationPrimingSheet, type PrimingVariant } from '@/components/location-priming-sheet';
import { useTheme } from '@/hooks/use-theme';
import { isInsideFence, type Geofence } from '@/lib/geo';
import { openSystemSettings } from '@/lib/location-permissions';
import { messageVisibility } from '@/lib/message-visibility';
import { requestNotificationAccess } from '@/lib/notifications';
import { registerPushToken } from '@/lib/push';
import { useAuth } from '@/store/auth-store';
import { useLocation } from '@/store/location-store';
import {
  conversationTitle,
  useConversation,
  useConversationTrails,
  useMessageActions,
  useMessages,
} from '@/store/messages-store';

const RUN_GAP_MS = 30 * 60_000;
const HEADER_HEIGHT = 52;

type Row =
  | { kind: 'message'; message: Message; index: number }
  | { kind: 'trail'; message: Message; info: TrailInfo; trail: Trail | undefined };

/**
 * The thread as rows. A trail's stops never appear here one by one: the trail
 * shows as a single card where its first stop was sent, and everything else
 * happens on the trail's own screen. `index` points into `plain`, the
 * messages that are not trail stops, so runs group as if the stops were absent.
 */
function buildRows(messages: Message[], trails: Trail[]): { rows: Row[]; plain: Message[] } {
  const rows: Row[] = [];
  const plain: Message[] = [];
  const shown = new Set<string>();

  for (const message of messages) {
    if (message.trail) {
      if (shown.has(message.trail.id)) continue;
      shown.add(message.trail.id);
      const trail = trails.find((t) => t.id === message.trail!.id);
      rows.push({ kind: 'trail', message, info: message.trail, trail });
    } else {
      rows.push({ kind: 'message', message, index: plain.length });
      plain.push(message);
    }
  }
  return { rows, plain };
}

function latestFenceIn(messages: Message[]): Geofence | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].fence) return messages[i].fence;
  }
  return undefined;
}

export default function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const { conversation, state: conversationState } = useConversation(id);
  const { messages, state: messagesState, error: messagesError } = useMessages(id);
  const trails = useConversationTrails(id);
  const myId = useAuth().user?.id ?? null;
  const { sendMessage, markRead } = useMessageActions();
  const {
    position,
    access,
    requestForeground,
    requestBackground,
    simulated,
    jumpInside,
    jumpFarAway,
    stopSimulating,
  } = useLocation();
  const [manualPriming, setManualPriming] = useState<PrimingVariant | null>(null);
  const [autoDismissed, setAutoDismissed] = useState(false);

  useEffect(() => {
    if (conversation?.unread) markRead(id);
  }, [conversation?.unread, id, markRead]);

  const hasLockedMessage = messages.some(
    (m) => messageVisibility(m, position).kind === 'locked',
  );

  // Ask in context: only once this thread actually holds something locked.
  const autoPriming: PrimingVariant | null =
    autoDismissed || !hasLockedMessage
      ? null
      : access === 'none'
        ? 'foreground'
        : access === 'denied'
          ? 'denied'
          : null;
  const priming = manualPriming ?? autoPriming;

  const dismissPriming = () => {
    setManualPriming(null);
    setAutoDismissed(true);
  };

  const handleAllow = async () => {
    const variant = priming;
    dismissPriming();
    if (variant === 'foreground') await requestForeground();
    if (variant === 'denied') openSystemSettings();
    if (variant === 'background') {
      const granted = await requestNotificationAccess();
      if (granted) {
        void registerPushToken();
        await requestBackground();
      }
    }
  };

  const participants = conversation?.participants ?? [];

  const title = conversation ? conversationTitle(conversation) : '';

  /** The most recent fence in the thread — what the dev toggle jumps to. */
  const latestFence = latestFenceIn(messages);
  const insideFence =
    latestFence != null && position != null && isInsideFence(position, latestFence);

  /** Dev-only: real GPS → inside the fence → far away → back to GPS. */
  const cycleSimulation = () => {
    if (!latestFence) return;
    if (!simulated) jumpInside(latestFence);
    else if (insideFence) jumpFarAway();
    else stopSimulating();
  };

  if (!conversation) {
    return (
      <ThemedView style={styles.root}>
        <SafeAreaView style={styles.missing}>
          {conversationState === 'loading' || conversationState === 'idle' ? (
            <ActivityIndicator />
          ) : (
            <>
              <ThemedText type="default">
                {conversationState === 'error'
                  ? 'Could not load this conversation.'
                  : 'Conversation not found.'}
              </ThemedText>
              <Pressable onPress={() => router.back()} hitSlop={10}>
                <ThemedText type="linkPrimary">Go back</ThemedText>
              </Pressable>
            </>
          )}
        </SafeAreaView>
      </ThemedView>
    );
  }

  const { rows, plain } = buildRows(messages, trails);

  const renderRow = ({ item: row }: { item: Row }) => {
    if (row.kind === 'trail') {
      return (
        <TrailCard
          trail={row.trail}
          info={row.info}
          myId={myId}
          isMine={row.message.isMine}
          creatorName={row.message.sender.name}
          onOpen={() =>
            router.push({
              pathname: '/trail/[id]',
              params: { id: row.info.id, conversationId: id },
            })
          }
        />
      );
    }
    return renderItem({ item: row.message, index: row.index });
  };

  const renderItem = ({ item, index }: { item: Message; index: number }) => {
    const isMine = item.isMine;
    const next = plain[index + 1];
    const prev = plain[index - 1];

    const isLastInRun =
      !next || next.sender.id !== item.sender.id || next.sentAt - item.sentAt > RUN_GAP_MS;
    const showSender =
      conversation.isGroup &&
      (!prev || prev.sender.id !== item.sender.id || item.sentAt - prev.sentAt > RUN_GAP_MS);

    return (
      <MessageBubble
        message={item}
        isMine={isMine}
        isLastInRun={isLastInRun}
        showSender={showSender}
        recipientCount={participants.length}
        onRequestArrivalAlerts={
          access === 'foreground' ? () => setManualPriming('background') : undefined
        }
      />
    );
  };

  return (
    <ThemedView style={styles.root}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <FlatList
          data={rows}
          keyExtractor={(row) => (row.kind === 'message' ? row.message.id : `trail-${row.info.id}`)}
          renderItem={renderRow}
          contentContainerStyle={{
            paddingTop: HEADER_HEIGHT + insets.top,
            paddingBottom: Spacing.three,
          }}
          keyboardDismissMode="interactive"
          ListEmptyComponent={
            messagesState === 'loading' || messagesState === 'idle' ? (
              <ActivityIndicator style={styles.listEmpty} />
            ) : messagesState === 'error' ? (
              <ThemedText type="small" themeColor="textSecondary" style={styles.listEmpty}>
                {messagesError ?? 'Could not load these messages.'}
              </ThemedText>
            ) : (
              <ThemedText type="small" themeColor="textSecondary" style={styles.listEmpty}>
                No messages yet. Say something.
              </ThemedText>
            )
          }
        />

        <GlassPanel variant="regular" style={styles.header}>
          <SafeAreaView edges={['top']}>
            <View style={styles.headerInner}>
              <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back}>
                <ThemedText type="linkPrimary" style={styles.backGlyph}>
                  ‹
                </ThemedText>
              </Pressable>

              <View style={styles.headerCenter}>
                {participants[0] ? (
                  <AvatarDot id={participants[0].id} name={participants[0].name} size={26} />
                ) : null}
                <ThemedText type="smallBold" numberOfLines={1} style={styles.headerTitle}>
                  {title}
                </ThemedText>
              </View>

              {/* Dev-only: teleports the position to test unlock states. */}
              {__DEV__ && latestFence ? (
                <Pressable
                  onPress={() => cycleSimulation()}
                  hitSlop={8}
                  style={[styles.devPill, { backgroundColor: theme.backgroundSelected }]}>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.devText}>
                    {!simulated ? 'GPS' : insideFence ? 'Inside' : 'Away'}
                  </ThemedText>
                </Pressable>
              ) : (
                <View style={styles.back} />
              )}
            </View>
          </SafeAreaView>
        </GlassPanel>

        <SafeAreaView edges={['bottom']}>
          <MessageInputBar
            onSend={async (body, fence) => {
              const { error } = await sendMessage(id, body, fence);
              return error == null;
            }}
            onStartTrail={() =>
              router.push({ pathname: '/trail-builder', params: { conversationId: id } })
            }
          />
        </SafeAreaView>
      </KeyboardAvoidingView>

      <LocationPrimingSheet
        visible={priming !== null}
        variant={priming ?? 'foreground'}
        onAllow={handleAllow}
        onDismiss={dismissPriming}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  listEmpty: {
    textAlign: 'center',
    paddingTop: Spacing.six,
  },
  missing: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  headerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
    gap: Spacing.two,
  },
  back: {
    minWidth: 44,
  },
  backGlyph: {
    fontSize: 30,
    lineHeight: 34,
  },
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
  headerTitle: {
    flexShrink: 1,
    fontSize: 15,
  },
  devPill: {
    minWidth: 44,
    alignItems: 'center',
    paddingVertical: Spacing.half + 1,
    paddingHorizontal: Spacing.two,
    borderRadius: 999,
  },
  devText: {
    fontSize: 11,
  },
});
