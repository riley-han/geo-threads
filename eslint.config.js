// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    // Edge Functions run on Deno, with their own globals and jsr: imports.
    ignores: ["dist/*", "supabase/functions/*"],
  }
]);
