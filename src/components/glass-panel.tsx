import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { forwardRef } from 'react';
import { Platform, StyleSheet, View, type ViewProps } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

export type GlassPanelProps = ViewProps & {
  variant?: 'regular' | 'clear';
  tint?: string;
  interactive?: boolean;
};

const canUseLiquidGlass = Platform.OS === 'ios' && isLiquidGlassAvailable();

export const GlassPanel = forwardRef<View, GlassPanelProps>(function GlassPanel(
  { variant = 'regular', tint, interactive, style, children, ...rest },
  ref,
) {
  const theme = useTheme();

  if (canUseLiquidGlass) {
    return (
      <GlassView
        ref={ref}
        glassEffectStyle={variant}
        tintColor={tint}
        isInteractive={interactive}
        style={style}
        {...rest}>
        {children}
      </GlassView>
    );
  }

  return (
    <View
      ref={ref}
      style={[
        {
          backgroundColor: theme.backgroundElement,
          borderColor: theme.backgroundSelected,
        },
        styles.fallback,
        style,
      ]}
      {...rest}>
      {children}
    </View>
  );
});

const styles = StyleSheet.create({
  fallback: {
    borderWidth: StyleSheet.hairlineWidth,
  },
});
