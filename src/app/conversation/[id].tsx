import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassPanel } from '@/components/glass-panel';
import { MessageInputBar } from '@/components/message-input-bar';
import { AvatarDot } from '@/components/avatar-dot';
import { MessageBubble } from '@/components/message-bubble';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { ME_ID, contactById } from '@/data/contacts';
import type { Message } from '@/data/types';
import { LocationPrimingSheet, type PrimingVariant } from '@/components/location-priming-sheet';
import { useTheme } from '@/hooks/use-theme';
import { isInsideFence, type Geofence } from '@/lib/geo';
import { openSystemSettings } from '@/lib/location-permissions';
import { messageVisibility } from '@/lib/message-visibility';
import { requestNotificationAccess } from '@/lib/notifications';
import { useLocation } from '@/store/location-store';
import {
  conversationTitle,
  useConversation,
  useMessageActions,
  useMessages,
} from '@/store/messages-store';

const RUN_GAP_MS = 30 * 60_000;
const HEADER_HEIGHT = 52;

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

  const conversation = useConversation(id);
  const messages = useMessages(id);
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
      if (granted) await requestBackground();
    }
  };

  const participants = (conversation?.participantIds ?? [])
    .map(contactById)
    .filter((c) => c !== undefined);

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
          <ThemedText type="default">Conversation not found.</ThemedText>
          <Pressable onPress={() => router.back()} hitSlop={10}>
            <ThemedText type="linkPrimary">Go back</ThemedText>
          </Pressable>
        </SafeAreaView>
      </ThemedView>
    );
  }

  const renderItem = ({ item, index }: { item: Message; index: number }) => {
    const isMine = item.senderId === ME_ID;
    const next = messages[index + 1];
    const prev = messages[index - 1];

    const isLastInRun =
      !next || next.senderId !== item.senderId || next.sentAt - item.sentAt > RUN_GAP_MS;
    const showSender =
      conversation.isGroup &&
      (!prev || prev.senderId !== item.senderId || item.sentAt - prev.sentAt > RUN_GAP_MS);

    return (
      <MessageBubble
        message={item}
        isMine={isMine}
        isLastInRun={isLastInRun}
        showSender={showSender}
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
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={renderItem}
          contentContainerStyle={{
            paddingTop: HEADER_HEIGHT + insets.top,
            paddingBottom: Spacing.three,
          }}
          keyboardDismissMode="interactive"
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

              {latestFence ? (
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
          <MessageInputBar onSend={(body, fence) => sendMessage(id, body, fence)} />
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
