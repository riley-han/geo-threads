import { useAppearance, type ResolvedScheme } from '@/store/appearance-store';

/** The scheme the app is drawn in: the person's appearance choice, or the OS when they follow it. */
export function useColorScheme(): ResolvedScheme {
  return useAppearance().scheme;
}
