import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AvatarDot } from '@/components/avatar-dot';
import { ThemedText } from '@/components/themed-text';
import { Fonts, Spacing } from '@/constants/theme';
import type { Person } from '@/data/types';
import type { FriendStatus } from '@/data/repository';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  contact: Person;
  status?: FriendStatus;
  /** Opening a conversation is now a round trip; show it on the row that started it. */
  busy?: boolean;
  onAdd: () => void;
  onAccept: () => void;
  onDecline: () => void;
  onMessage: () => void;
};

export function FriendRow({ contact, status, busy, onAdd, onAccept, onDecline, onMessage }: Props) {
  const theme = useTheme();

  return (
    <View style={styles.row}>
      <AvatarDot id={contact.id} name={contact.name} size={44} />
      <View style={styles.body}>
        <ThemedText type="default" numberOfLines={1}>
          {contact.name}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          @{contact.handle}
        </ThemedText>
      </View>

      {status === 'accepted' ? (
        <Pressable
          onPress={onMessage}
          disabled={busy}
          style={[styles.action, { backgroundColor: theme.primary }, busy && styles.actionBusy]}>
          {busy ? (
            <ActivityIndicator color={theme.onPrimary} size="small" />
          ) : (
            <ThemedText type="small" style={[styles.actionText, { color: theme.onPrimary }]}>
              Message
            </ThemedText>
          )}
        </Pressable>
      ) : status === 'pending_out' ? (
        <View style={[styles.action, { backgroundColor: theme.backgroundSelected }]}>
          <ThemedText type="small" themeColor="textSecondary">
            Requested
          </ThemedText>
        </View>
      ) : status === 'pending_in' ? (
        <View style={styles.pair}>
          <Pressable onPress={onAccept} style={[styles.action, { backgroundColor: theme.primary }]}>
            <ThemedText type="small" style={[styles.actionText, { color: theme.onPrimary }]}>
              Accept
            </ThemedText>
          </Pressable>
          <Pressable
            onPress={onDecline}
            style={[styles.action, { backgroundColor: theme.backgroundSelected }]}>
            <ThemedText type="small" themeColor="textSecondary">
              Decline
            </ThemedText>
          </Pressable>
        </View>
      ) : (
        <Pressable
          onPress={onAdd}
          style={[styles.action, { borderWidth: 1, borderColor: theme.tint }]}>
          <ThemedText type="small" style={[styles.actionText, { color: theme.tint }]}>
            Add
          </ThemedText>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
  },
  body: {
    flex: 1,
  },
  pair: {
    flexDirection: 'row',
    gap: Spacing.one,
  },
  action: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one + 2,
    borderRadius: 999,
  },
  actionBusy: {
    opacity: 0.85,
  },
  actionText: {
    fontFamily: Fonts.bodyBold,
  },
});
