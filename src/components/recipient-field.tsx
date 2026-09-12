import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AvatarDot } from '@/components/avatar-dot';
import { ThemedText } from '@/components/themed-text';
import { Accent, Spacing } from '@/constants/theme';
import type { Contact } from '@/data/contacts';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  selected: Contact[];
  query: string;
  onQueryChange: (next: string) => void;
  onRemove: (id: string) => void;
};

export function RecipientField({ selected, query, onQueryChange, onRemove }: Props) {
  const theme = useTheme();

  const handleKeyPress = (key: string) => {
    if (key === 'Backspace' && query.length === 0 && selected.length > 0) {
      onRemove(selected[selected.length - 1].id);
    }
  };

  return (
    <View style={[styles.root, { borderBottomColor: theme.backgroundSelected }]}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.toLabel}>
        To:
      </ThemedText>
      <View style={styles.tokens}>
        {selected.map((contact) => (
          <Pressable
            key={contact.id}
            onPress={() => onRemove(contact.id)}
            style={[styles.token, { backgroundColor: theme.backgroundSelected }]}>
            <ThemedText type="small" style={styles.tokenText}>
              {contact.name}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              ✕
            </ThemedText>
          </Pressable>
        ))}
        <TextInput
          value={query}
          onChangeText={onQueryChange}
          onKeyPress={(e) => handleKeyPress(e.nativeEvent.key)}
          placeholder={selected.length === 0 ? 'Name or handle' : ''}
          placeholderTextColor={theme.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          style={[styles.input, { color: theme.text }]}
        />
      </View>
    </View>
  );
}

export function ContactRow({ contact, onPress }: { contact: Contact; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.contactRow,
        pressed && { backgroundColor: theme.backgroundElement },
      ]}>
      <AvatarDot id={contact.id} name={contact.name} size={36} />
      <View style={styles.contactText}>
        <ThemedText type="default">{contact.name}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {contact.handle}
        </ThemedText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  toLabel: {
    paddingTop: 6,
  },
  tokens: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.one,
  },
  token: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.half + 2,
    paddingHorizontal: Spacing.two,
    borderRadius: 999,
  },
  tokenText: {
    color: Accent,
    fontWeight: '600',
  },
  input: {
    flexGrow: 1,
    minWidth: 120,
    fontSize: 16,
    paddingVertical: 4,
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
  },
  contactText: {
    flex: 1,
  },
});
