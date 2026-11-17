import React, { useState } from 'react';
import { Enter } from '../ui';
import type { Bio } from './ui';
import type { Ctx, ScreenId } from './context';
import { Welcome } from './screens/Welcome';
import { Secure } from './screens/Secure';
import { PinSet } from './screens/PinSet';
import { PinConfirm } from './screens/PinConfirm';
import { Seed } from './screens/Seed';
import { Verify } from './screens/Verify';
import { ImportPhrase } from './screens/ImportPhrase';
import { Discovery } from './screens/Discovery';
import { Entropy } from './screens/Entropy';

export type { Bio } from './ui';
export type { ScreenId } from './context';
export { UnlockScreen } from './UnlockScreen';
export type OnboardingResult = { deferred: boolean; bio: Bio; pin: string };

const SCREENS: Record<ScreenId, React.ComponentType<{ ctx: Ctx }>> = {
  welcome: Welcome,
  secure: Secure,
  'pin-set': PinSet,
  'pin-confirm': PinConfirm,
  seed: Seed,
  verify: Verify,
  import: ImportPhrase,
  discovery: Discovery,
  entropy: Entropy,
};

/* Unlock: the app lock, reached after onboarding */

export function Onboarding({
  initial = 'welcome',
  bio = 'face',
  discovery = 'found',
  pinOnly = false,
  onDone,
}: {
  /** 'seed' re-enters just the backup flow from the deferred-backup banner. */
  initial?: ScreenId;
  bio?: Bio;
  discovery?: 'found' | 'none';
  /** Run only the PIN set/confirm pair, used by Settings > Change PIN. */
  pinOnly?: boolean;
  onDone: (r: OnboardingResult) => void;
}) {
  const [stack, setStack] = useState<ScreenId[]>([initial]);
  const [pin, setPin] = useState('');
  const [flow, setFlow] = useState<'create' | 'import'>('create');

  const screen = stack[stack.length - 1];
  const ctx: Ctx = {
    push: (s) => setStack((st) => [...st, s]),
    pop: () => setStack((st) => (st.length > 1 ? st.slice(0, -1) : st)),
    finish: (deferred) => onDone({ deferred, bio, pin }),
    bio,
    pin,
    setPin,
    flow,
    setFlow,
    discovery,
    pinOnly,
  };

  const Current = SCREENS[screen];
  // Keyed so each screen replays its entrance on navigation.
  return (
    <Enter key={screen} duration={240} offset={0} style={{ flex: 1 }}>
      <Current ctx={ctx} />
    </Enter>
  );
}

/* ══ 0 · Welcome ════════════════════════════════════════════ */
