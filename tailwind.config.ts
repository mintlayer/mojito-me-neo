import type { Config } from 'tailwindcss';
import nativewindPreset from 'nativewind/preset';
import { C } from './src/theme';

// One source of truth: src/theme.ts. Never re-declare a colour here.
export default {
  content: ['./App.tsx', './src/**/*.{ts,tsx}'],
  presets: [nativewindPreset],
  theme: {
    extend: {
      colors: C,
      borderColor: { DEFAULT: C.lineSoft },
      fontFamily: {
        // ponytail: system font instead of bundling Inter. SF Pro / Roboto are
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
} satisfies Config;
