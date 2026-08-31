import { StyleSheet, Text, View, type ViewStyle, type StyleProp } from 'react-native';

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
    backgroundColor: '#3c87f7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    color: '#ffffff',
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
