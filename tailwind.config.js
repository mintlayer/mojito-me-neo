const { C } = require('./src/theme');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./App.tsx', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      // One source of truth: src/theme.js. Never re-declare a colour here.
      colors: C,
      borderColor: { DEFAULT: C.lineSoft },
      fontFamily: {
        // ponytail: system font instead of bundling Inter — SF Pro / Roboto are
        // near-identical here and cost 0 KB. Swap in expo-font if brand-exact.
        sans: ['System'],
        mono: ['Menlo', 'monospace'],
      },
      letterSpacing: {
        tightest: '-0.025em',
        label: '0.08em',
        wider: '0.06em',
        widest: '0.18em',
      },
    },
  },
  plugins: [],
};
