// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', '.expo-export/*'],
  },
  {
    rules: {
      // Web-only concern: it guards against ambiguous entities in HTML. React
      // Native <Text> renders the character literally, so escaping apostrophes
      // here would only make the copy harder to read.
      'react/no-unescaped-entities': 'off',
    },
  },
]);
