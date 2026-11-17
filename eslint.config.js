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
      // React Compiler rules, new in eslint-config-expo 57. They model plain
      // React state and flag the Animated/PanResponder idioms this app is
      // built on: Animated.Value held in a useRef and read during render,
      // lazily-created pan responders, PIN retry state settled in an effect.
      // ponytail: off wholesale rather than restructuring working animation
      // code during a dependency bump; revisit per-rule if we adopt the
      // React Compiler for real.
      'react-hooks/refs': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
]);
