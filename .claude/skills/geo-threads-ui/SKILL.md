---
name: geo-threads-ui
description: Geo Threads visual rules (Indigo Lake palette, Mincho & Gothic type, dark by default). Use whenever building or changing any screen, component, style, color, font, spacing, icon or copy in src/app or src/components, or reviewing UI code.
---

# Geo Threads UI

The app's look is **Indigo Lake**: aizome indigo (primary), glacial-lake teal
(secondary) and ginkgo gold (the one bright accent), with type set in **Zen Old
Mincho** (display) and **Zen Kaku Gothic New** (everything else). Dark is the
default theme; people can pick Light or System in Profile → Appearance.

The full reference, with a usage note for every token, type style and component,
is the design system: https://claude.ai/artifact/RQwLt2m7D1ZFR5a8gjaCpn
(read its `project/README.md` with the Artifact tool when a rule below is not
enough). Code is the source of truth for values: `src/constants/theme.ts`.

## Rules

1. **No color literals in components.** Read colors with `const theme = useTheme()`
   (`@/hooks/use-theme`) and use tokens: `theme.primary`, `theme.accentText`, …
   Theme-independent values (GT mark, labels over maps) come from `Brand` in
   `@/constants/theme`; avatar colors from `AVATAR_COLORS` in `@/lib/avatar`.
   Because tokens change with the theme, apply them inline (`[styles.x, { color: theme.tint }]`),
   not inside `StyleSheet.create`.
2. **Pick the token by job:**
   - filled button / your bubble / selected segment → `primary` + `onPrimary`
   - link or text button → `tint`
   - fence ring, pin, active fence toggle, slider fill, single empty-state CTA → `accent` (+ `onAccent` for text on it, never white)
   - gold *text or small mark* (distance, "Tap to unlock", unread dot) → `accentText` (plain `accent` is 2.1:1 on the light ground)
   - quiet gold ground → `accentSoft`; fence interior → `accentFill`
   - place name chip → `secondary` on `secondarySoft`
   - cards/rows → `backgroundElement`; inputs, neutral chips, tracks → `backgroundSelected`
   - errors, Sign out → `danger` (always with words); sheet backdrop → `scrim`
3. **Text goes through `<ThemedText type=…>`**: `title`, `subtitle`, `heading` (Mincho,
   names and section titles only), `default`, `defaultBold`, `small`, `smallBold`,
   `caption`, `linkPrimary`, `code`. Color with `themeColor="textSecondary" | "danger" | …`.
4. **Never set `fontWeight`.** Each weight is its own family: use
   `fontFamily: Fonts.body | Fonts.bodyMedium | Fonts.bodyBold | Fonts.display`.
   Every `TextInput` sets `fontFamily: Fonts.body` itself.
5. **Scheme:** `useColorScheme` from `@/hooks/use-color-scheme` (honours the
   Appearance choice), never from `react-native`. The choice lives in
   `src/store/appearance-store.tsx`.
6. **Shape:** `Spacing` for gaps/padding (gutter `four`, row padding `three`),
   `Radius.large` for cards/rows/map, `Radius.medium` for inputs/buttons,
   `Radius.pill` for chips. Separate surfaces by ground color, not shadows;
   floating chrome uses `GlassPanel`.
7. **Gold is scarce.** One gold element per region. If it's not something waiting
   in the world or the one thing to do next, it isn't gold.
8. **Copy:** plain, warm, sentence case. "a note", "a place", "arrive", "unlock";
   no "geofence" in UI text. Emoji only as functional glyphs (📍 🔒 🔓).
9. **Contrast:** any new text/ground pair must reach 4.5:1 in **both** themes
   (3:1 for marks, borders and text ≥24px). Check the dark and light values.

## When adding a token

Add it to both `Colors.dark` and `Colors.light` in `src/constants/theme.ts` with a
one-line doc comment, then add it (with a usage note) to the design system's
`project/tokens.json` so the two stay in step.

## Before finishing UI work

```bash
grep -rnE "'#[0-9a-fA-F]{3,8}'|rgba\(|fontWeight" src --include='*.tsx' | grep -v constants/theme
```

Only `login.tsx`'s Google glyph (a third-party brand color) should match.
