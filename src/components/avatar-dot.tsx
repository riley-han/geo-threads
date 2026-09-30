import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Fonts } from '@/constants/theme';
import { AVATAR_TEXT, colorForId, initialsFor } from '@/lib/avatar';

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
    color: AVATAR_TEXT,
    fontFamily: Fonts.bodyBold,
    letterSpacing: 0.5,
  },
});
