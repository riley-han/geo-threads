import { Pressable, StyleSheet, View } from 'react-native';

import { AvatarDot } from '@/components/avatar-dot';
import { ThemedText } from '@/components/themed-text';
import { Accent, Spacing } from '@/constants/theme';
import type { Contact } from '@/data/contacts';
import type { FriendStatus } from '@/db/social-repository';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  contact: Contact;
  status?: FriendStatus;
  onAdd: () => void;
  onAccept: () => void;
  onDecline: () => void;
  onMessage: () => void;
};

export function FriendRow({ contact, status, onAdd, onAccept, onDecline, onMessage }: Props) {
  const theme = useTheme();

  return (
    <View style={styles.row}>
      <AvatarDot id={contact.id} name={contact.name} size={44} />
      <View style={styles.body}>
        <ThemedText type="default" numberOfLines={1}>
          {contact.name}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {contact.handle}
        </ThemedText>
      </View>

      {status === 'accepted' ? (
        <Pressable onPress={onMessage} style={[styles.action, styles.actionFilled]}>
          <ThemedText type="small" style={styles.actionFilledText}>
            Message
          </ThemedText>
        </Pressable>
      ) : status === 'pending_out' ? (
        <View style={[styles.action, { backgroundColor: theme.backgroundSelected }]}>
          <ThemedText type="small" themeColor="textSecondary">
            Requested
          </ThemedText>
        </View>
      ) : status === 'pending_in' ? (
        <View style={styles.pair}>
          <Pressable onPress={onAccept} style={[styles.action, styles.actionFilled]}>
            <ThemedText type="small" style={styles.actionFilledText}>
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
          style={[styles.action, { borderWidth: 1, borderColor: Accent }]}>
          <ThemedText type="small" style={styles.addText}>
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
  actionFilled: {
    backgroundColor: Accent,
  },
  actionFilledText: {
    color: '#ffffff',
    fontWeight: '600',
  },
  addText: {
    color: Accent,
    fontWeight: '600',
  },
});
