import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FriendRow } from '@/components/friend-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { searchAllContacts, type Contact } from '@/data/contacts';
import { useTheme } from '@/hooks/use-theme';
import { useMessageActions } from '@/store/messages-store';
import { useFriendStatusMap, useSocialActions } from '@/store/social-store';

export default function PeopleScreen() {
  const router = useRouter();
  const theme = useTheme();
  const [query, setQuery] = useState('');

  const statuses = useFriendStatusMap();
  const { sendRequest, acceptRequest, declineRequest } = useSocialActions();
  const { createConversation } = useMessageActions();

  const results = searchAllContacts(query);
  // Incoming requests first — they need an answer, not to be scrolled past.
  const incoming = results.filter((c) => statuses.get(c.id) === 'pending_in');
  const others = results.filter((c) => statuses.get(c.id) !== 'pending_in');

  const openConversation = (contact: Contact) => {
    const id = createConversation([contact.id]);
    router.push({ pathname: '/conversation/[id]', params: { id } });
  };

  const renderRow = (contact: Contact) => (
    <FriendRow
      key={contact.id}
      contact={contact}
      status={statuses.get(contact.id)}
      onAdd={() => sendRequest(contact.id)}
      onAccept={() => acceptRequest(contact.id)}
      onDecline={() => declineRequest(contact.id)}
      onMessage={() => openConversation(contact)}
    />
  );

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={10}>
            <ThemedText type="linkPrimary">Done</ThemedText>
          </Pressable>
          <ThemedText type="smallBold">Find people</ThemedText>
          <View style={styles.headerSpacer} />
        </View>

        <View style={styles.searchWrap}>
          <View style={[styles.searchChip, { backgroundColor: theme.backgroundSelected }]}>
            <ThemedText themeColor="textSecondary" style={styles.searchGlyph}>
              ⌕
            </ThemedText>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Name or handle"
              placeholderTextColor={theme.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              style={[styles.searchInput, { color: theme.text }]}
            />
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive">
          {incoming.length > 0 ? (
            <View style={styles.section}>
              <ThemedText type="small" themeColor="textSecondary">
                Requests
              </ThemedText>
              {incoming.map(renderRow)}
            </View>
          ) : null}

          {others.length > 0 ? (
            <View style={styles.section}>
              {incoming.length > 0 ? (
                <ThemedText type="small" themeColor="textSecondary">
                  Everyone
                </ThemedText>
              ) : null}
              {others.map(renderRow)}
            </View>
          ) : null}

          {results.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
              No one matches “{query.trim()}”.
            </ThemedText>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  headerSpacer: {
    minWidth: 44,
  },
  searchWrap: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.three,
  },
  searchChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    height: 38,
    paddingHorizontal: Spacing.three,
    borderRadius: 999,
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
  list: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.six,
    gap: Spacing.four,
  },
  section: {
    gap: Spacing.one,
  },
  empty: {
    textAlign: 'center',
    paddingTop: Spacing.four,
  },
});
