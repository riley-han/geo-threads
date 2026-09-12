import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Accent, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { GeocodeError, isGeocodingSupported, searchAddress, type GeocodeResult } from '@/lib/geocode';

type Props = {
  onSelect: (result: GeocodeResult) => void;
};

type SearchState =
  | { kind: 'idle' }
  | { kind: 'searching' }
  | { kind: 'results'; results: GeocodeResult[] }
  | { kind: 'empty'; query: string }
  | { kind: 'error'; message: string };

export function AddressSearch({ onSelect }: Props) {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const [state, setState] = useState<SearchState>({ kind: 'idle' });

  const run = async () => {
    const trimmed = query.trim();
    if (!trimmed) return;

    setState({ kind: 'searching' });
    try {
      const found = await searchAddress(trimmed);
      setState(
        found.length === 0 ? { kind: 'empty', query: trimmed } : { kind: 'results', results: found },
      );
    } catch (e) {
      setState({
        kind: 'error',
        message: e instanceof GeocodeError ? e.message : 'Address search failed.',
      });
    }
  };

  const choose = (result: GeocodeResult) => {
    onSelect(result);
    setQuery(result.label);
    setState({ kind: 'idle' });
  };

  return (
    <View style={styles.root}>
      <View style={[styles.field, { backgroundColor: theme.backgroundSelected }]}>
        <ThemedText themeColor="textSecondary" style={styles.glyph}>
          ⌕
        </ThemedText>
        <TextInput
          value={query}
          onChangeText={(t) => {
            setQuery(t);
            setState({ kind: 'idle' });
          }}
          onSubmitEditing={run}
          editable={isGeocodingSupported}
          placeholder={
            isGeocodingSupported ? 'Search an address or place' : 'Search unavailable on web'
          }
          placeholderTextColor={theme.textSecondary}
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="search"
          style={[styles.input, { color: theme.text }]}
        />
        {state.kind === 'searching' ? (
          <ActivityIndicator size="small" />
        ) : query.length > 0 ? (
          <Pressable
            onPress={() => {
              setQuery('');
              setState({ kind: 'idle' });
            }}
            hitSlop={10}>
            <ThemedText type="small" themeColor="textSecondary">
              ✕
            </ThemedText>
          </Pressable>
        ) : null}
      </View>

      {state.kind === 'empty' ? (
        <ThemedText type="small" themeColor="textSecondary">
          No matches for “{state.query}”.
        </ThemedText>
      ) : null}

      {state.kind === 'error' ? (
        <ThemedText type="small" style={styles.error}>
          {state.message}
        </ThemedText>
      ) : null}

      {state.kind === 'results' ? (
        <View style={[styles.results, { borderColor: theme.backgroundSelected }]}>
          {state.results.map((result, i) => (
            <Pressable
              key={`${result.latitude},${result.longitude},${i}`}
              onPress={() => choose(result)}
              style={({ pressed }) => [
                styles.resultRow,
                i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.backgroundSelected },
                pressed && { backgroundColor: theme.backgroundElement },
              ]}>
              <ThemedText style={styles.resultPin}>📍</ThemedText>
              <View style={styles.resultText}>
                <ThemedText type="small" numberOfLines={1} style={styles.resultLabel}>
                  {result.label}
                </ThemedText>
                {result.sublabel ? (
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                    {result.sublabel}
                  </ThemedText>
                ) : null}
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: Spacing.two,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    height: 38,
    paddingHorizontal: Spacing.three,
    borderRadius: 999,
  },
  glyph: {
    fontSize: 18,
    lineHeight: 20,
  },
  input: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 0,
  },
  error: {
    color: '#ef6f6c',
  },
  results: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Spacing.three,
    overflow: 'hidden',
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  resultPin: {
    fontSize: 13,
  },
  resultText: {
    flex: 1,
  },
  resultLabel: {
    fontWeight: '600',
    color: Accent,
  },
});
