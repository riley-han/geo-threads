import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FriendRow } from '@/components/friend-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { searchProfiles } from '@/data/repository';
import type { Person } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';
import { useMessageActions } from '@/store/messages-store';
import { useAuth } from '@/store/auth-store';
import { useFriendStatusMap, usePendingRequests, useSocialActions } from '@/store/social-store';

/** Long enough that a name has settled, short enough not to feel laggy. */
const SEARCH_DEBOUNCE_MS = 250;
/** Matches the repository's floor — below this it would match half the table. */
const MIN_QUERY_LENGTH = 2;

export default function PeopleScreen() {
  const router = useRouter();
  const theme = useTheme();
  const [query, setQuery] = useState('');

  const statuses = useFriendStatusMap();
  const pendingRequests = usePendingRequests();
  const { sendRequest, acceptRequest, declineRequest } = useSocialActions();
  const { createConversation } = useMessageActions();
  const { user } = useAuth();
  const myId = user?.id ?? null;

  const [opening, setOpening] = useState<string | null>(null);

  const trimmed = query.trim();
  const isSearching = trimmed.length >= MIN_QUERY_LENGTH;

  /**
   * The last completed search, tagged with the query it answered.
   *
   * Tagging means everything else is derived rather than stored: results are
   * shown only when they answer the query on screen, which makes "still
   * searching" a comparison rather than a flag, and makes a slow early response
   * landing after a fast later one simply not match — no sequence counter, and
   * no state to clear when the box is emptied.
   */
  const [answered, setAnswered] = useState<{
    query: string;
    people: Person[];
    error: string | null;
  }>({ query: '', people: [], error: null });

  const isCurrent = answered.query === trimmed;
  const results = isCurrent ? answered.people : [];
  const searchError = isCurrent ? answered.error : null;
  const searching = isSearching && !isCurrent;

  // Finding a stranger is a query against profiles now, not a filter over a
  // bundled array, so it is debounced.
  useEffect(() => {
    if (!myId || !isSearching) return;

    const timer = setTimeout(() => {
      void searchProfiles(trimmed, myId).then(({ people, error }) =>
        setAnswered({ query: trimmed, people, error }),
      );
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [trimmed, isSearching, myId]);

  // Before there is a query, show the requests waiting on an answer — they are
  // why most people open this screen.
  const incoming = isSearching
    ? results.filter((c) => statuses.get(c.id) === 'pending_in')
    : pendingRequests;
  const others = isSearching ? results.filter((c) => statuses.get(c.id) !== 'pending_in') : [];

  const openConversation = async (person: Person) => {
    if (opening) return;
    setOpening(person.id);
    const { id, error } = await createConversation([person.id]);
    setOpening(null);

    if (!id) {
      Alert.alert('Could not open the conversation', error ?? 'Please try again.');
      return;
    }
    router.push({ pathname: '/conversation/[id]', params: { id } });
  };

  const renderRow = (person: Person) => (
    <FriendRow
      key={person.id}
      contact={person}
      status={statuses.get(person.id)}
      busy={opening === person.id}
      onAdd={() => void sendRequest(person.id)}
      onAccept={() => void acceptRequest(person.id)}
      onDecline={() => void declineRequest(person.id)}
      onMessage={() => void openConversation(person)}
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

          {searching ? (
            <ActivityIndicator style={styles.loading} />
          ) : searchError ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
              Could not search right now.
            </ThemedText>
          ) : !isSearching && incoming.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
              Search for someone by name or handle.
            </ThemedText>
          ) : isSearching && results.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
              No one matches “{trimmed}”.
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
  loading: {
    paddingTop: Spacing.four,
  },
  empty: {
    textAlign: 'center',
    paddingTop: Spacing.four,
  },
});
