import { StyleSheet, Text, View, type ViewStyle, type StyleProp } from 'react-native';

import { Brand, Fonts } from '@/constants/theme';

type Props = {
  size?: number;
  style?: StyleProp<ViewStyle>;
};

export function GeoThreadsMark({ size = 64, style }: Props) {
  return (
    <View
      style={[
        styles.tile,
        {
          width: size,
          height: size,
          borderRadius: size * 0.22,
        },
        style,
      ]}>
      <Text style={[styles.label, { fontSize: size * 0.42, lineHeight: size * 0.5 }]}>GT</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    backgroundColor: Brand.indigo,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    color: Brand.gold,
    fontFamily: Fonts.display,
    letterSpacing: 0.5,
  },
});
