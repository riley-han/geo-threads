import { StyleSheet, Text, type TextProps } from 'react-native';

import { Fonts, ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ThemedTextProps = TextProps & {
  type?:
    | 'default'
    | 'defaultBold'
    | 'title'
    | 'subtitle'
    | 'heading'
    | 'small'
    | 'smallBold'
    | 'caption'
    | 'link'
    | 'linkPrimary'
    | 'code';
  themeColor?: ThemeColor;
};

export function ThemedText({ style, type = 'default', themeColor, ...rest }: ThemedTextProps) {
  const theme = useTheme();

  return (
    <Text
      style={[
        { color: theme[themeColor ?? (type === 'linkPrimary' ? 'tint' : 'text')] },
        styles[type],
        style,
      ]}
      {...rest}
    />
  );
}

/**
 * The type scale. Mincho (display) is for names and section titles only; every
 * other role is Gothic. Weight comes from the family, so no `fontWeight` here.
 */
const styles = StyleSheet.create({
  title: {
    fontFamily: Fonts.display,
    fontSize: 40,
    lineHeight: 48,
  },
  subtitle: {
    fontFamily: Fonts.display,
    fontSize: 28,
    lineHeight: 36,
  },
  heading: {
    fontFamily: Fonts.display,
    fontSize: 20,
    lineHeight: 28,
  },
  default: {
    fontFamily: Fonts.body,
    fontSize: 16,
    lineHeight: 24,
  },
  defaultBold: {
    fontFamily: Fonts.bodyBold,
    fontSize: 16,
    lineHeight: 24,
  },
  small: {
    fontFamily: Fonts.bodyMedium,
    fontSize: 14,
    lineHeight: 20,
  },
  smallBold: {
    fontFamily: Fonts.bodyBold,
    fontSize: 14,
    lineHeight: 20,
  },
  caption: {
    fontFamily: Fonts.bodyMedium,
    fontSize: 12,
    lineHeight: 16,
  },
  link: {
    fontFamily: Fonts.bodyMedium,
    lineHeight: 30,
    fontSize: 14,
  },
  linkPrimary: {
    fontFamily: Fonts.bodyBold,
    lineHeight: 30,
    fontSize: 14,
  },
  code: {
    fontFamily: Fonts.mono,
    fontSize: 12,
  },
});
