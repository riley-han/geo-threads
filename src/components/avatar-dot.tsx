import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { colorForId, initialsFor } from '@/data/contacts';

type Props = {
  id: string;
  name: string;
  size?: number;
};

export function AvatarDot({ id, name, size = 28 }: Props) {
  return (
    <View
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: colorForId(id) },
      ]}>
      <ThemedText style={[styles.avatarText, { fontSize: size * 0.38 }]}>
        {initialsFor(name)}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#ffffff',
    fontWeight: '600',
    letterSpacing: 0.5,
  },
});
