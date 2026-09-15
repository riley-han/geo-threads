import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MessageInputBar } from '@/components/message-input-bar';
import { ContactRow, RecipientField } from '@/components/recipient-field';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { searchWithin, type Contact } from '@/data/contacts';
import { useTheme } from '@/hooks/use-theme';
import { useMessageActions } from '@/store/messages-store';
import { useFriendIds } from '@/store/social-store';
import type { Geofence } from '@/lib/geo';

export default function ComposeScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { createConversation, sendMessage } = useMessageActions();

  const [selected, setSelected] = useState<Contact[]>([]);
  const [query, setQuery] = useState('');

  const friendIds = useFriendIds();
  const selectedIds = useMemo(() => selected.map((c) => c.id), [selected]);
  // Compose is friends-only; strangers are added from the people screen first.
  const results = useMemo(
    () => searchWithin(friendIds, query, selectedIds),
    [friendIds, query, selectedIds],
  );

  const isGroup = selected.length > 1;
  const showResults = query.length > 0 || selected.length === 0;

  const addContact = (contact: Contact) => {
    setSelected((prev) => [...prev, contact]);
    setQuery('');
  };

  const removeContact = (id: string) => {
    setSelected((prev) => prev.filter((c) => c.id !== id));
  };

  const handleSend = (body: string, fence?: Geofence) => {
    if (selected.length === 0) return;
    const title = isGroup ? selected.map((c) => c.name.split(' ')[0]).join(', ') : undefined;
    const conversationId = createConversation(selectedIds, title);
    sendMessage(conversationId, body, fence);
    router.replace({ pathname: '/conversation/[id]', params: { id: conversationId } });
  };

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={[styles.header, { borderBottomColor: theme.backgroundSelected }]}>
          <Pressable onPress={() => router.back()} hitSlop={10}>
            <ThemedText type="linkPrimary">Cancel</ThemedText>
          </Pressable>
          <ThemedText type="smallBold">New Message</ThemedText>
          <View style={styles.headerSpacer}>
            {isGroup ? (
              <View style={[styles.groupPill, { backgroundColor: theme.backgroundSelected }]}>
                <ThemedText type="small" themeColor="textSecondary">
                  Group
                </ThemedText>
              </View>
            ) : null}
          </View>
        </View>

        <RecipientField
          selected={selected}
          query={query}
          onQueryChange={setQuery}
          onRemove={removeContact}
        />

        <KeyboardAvoidingView
          style={styles.body}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {showResults ? (
            <FlatList
              data={results}
              keyExtractor={(c) => c.id}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <ContactRow contact={item} onPress={() => addContact(item)} />
              )}
              ListEmptyComponent={
                <View style={styles.emptyWrap}>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
                    {friendIds.length === 0
                      ? 'You can only message friends. Add someone first.'
                      : `No friends match “${query}”`}
                  </ThemedText>
                  <Pressable onPress={() => router.push('/people')} hitSlop={8}>
                    <ThemedText type="linkPrimary">Find people</ThemedText>
                  </Pressable>
                </View>
              }
            />
          ) : (
            <View style={styles.hintWrap}>
              <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
                {isGroup
                  ? `Group with ${selected.length} people. Add a geofence to lock your message to a place.`
                  : 'Add a geofence to lock your message to a place.'}
              </ThemedText>
            </View>
          )}

          <MessageInputBar
            onSend={handleSend}
            disabled={selected.length === 0}
            placeholder={selected.length === 0 ? 'Add someone first' : 'Message'}
          />
        </KeyboardAvoidingView>
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
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerSpacer: {
    minWidth: 54,
    alignItems: 'flex-end',
  },
  groupPill: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: 999,
  },
  body: {
    flex: 1,
  },
  emptyWrap: {
    alignItems: 'center',
    gap: Spacing.two,
    paddingTop: Spacing.four,
  },
  empty: {
    textAlign: 'center',
  },
  hintWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.six,
  },
  hint: {
    textAlign: 'center',
  },
});
