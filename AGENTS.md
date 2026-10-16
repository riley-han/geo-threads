# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# UI

Follow `.claude/skills/geo-threads-ui/SKILL.md` for any visual change: colors come from theme tokens (`useTheme()`), text from `ThemedText`, fonts from `Fonts` (never `fontWeight`). Dark is the default theme.

# Coding

Follow `.claude/skills/geo-threads-coding/SKILL.md` for any code change: ask before assuming, write the least code that works, keep diffs surgical, and prove it with `npm run db:test`, `npx tsc --noEmit`, `npm run lint` and (for UI) the simulator.
