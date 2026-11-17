import React, { useCallback, useState } from 'react';
import { Enter } from '../ui';
import type { Bio } from './ui';
import type { Ctx, ScreenId } from './context';
import { walletVault, type VaultMeta } from '../storage/walletVault';
import { SUPPORTED_COUNTS, type WordCount } from '../keys/bip39';
import { VaultAuthRequiredError } from '../../modules/mojito-core';
import { stepUpDeviceAuth } from './ui';
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

/** What onboarding hands back: handles and flags, never seed bytes. */
export type OnboardingResult = { deferred: boolean; bio: Bio; biometrics: boolean };

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
  pinOnly = false,
  /** Backup re-entry: screens read the vault phrase instead of generating. */
  backup = false,
  onDone,
}: {
  /** 'seed' re-enters just the backup flow from the deferred-backup banner. */
  initial?: ScreenId;
  bio?: Bio;
  /** Run only the PIN set/confirm pair, used by Settings > Change PIN. */
  pinOnly?: boolean;
  /** Settings > Recovery phrase: reveal the stored phrase, never re-seal. */
  backup?: boolean;
  onDone: (r: OnboardingResult) => void;
}) {
  const [stack, setStack] = useState<ScreenId[]>([initial]);
  const [pin, setPin] = useState('');
  const [flow, setFlow] = useState<'create' | 'import'>('create');
  const [biometrics, setBiometrics] = useState(false);
  const [seedWords, setSeedWords] = useState<string[] | null>(null);
  const [seedEntropy, setSeedEntropy] = useState<Uint8Array | null>(null);

  const finish = useCallback(
    (deferred: boolean) => {
      void (async () => {
        // Deviation from spec M1-keys (recorded in decisions.md): the PIN
        // change flow swaps only the verifier; it does not re-key or re-seal
        // the vault. The vault key is independent of the PIN, so re-sealing
        // on a PIN change adds no security; the seed.v2 re-key stays
        // specified for future portability (export/migration).
        //
        // Fresh flows seal the phrase before the session exists; the backup
        // and change-PIN re-entries must not touch the stored wallet. A
        // failed seal must fail loudly: the wallet would otherwise not
        // survive a relaunch.
        if (!backup && !pinOnly) {
          const words = seedWords ?? [];
          if (words.length === 0) throw new Error('finish without a seed phrase');
          // Membership guard: imports accept 15/18/21-word phrases, so the
          // stored count is the real length, never collapsed to 12 or 24.
          const count = SUPPORTED_COUNTS.includes(words.length as WordCount)
            ? (words.length as WordCount)
            : 24;
          const meta: VaultMeta = {
            v: 1,
            createdAt: Date.now(),
            network: 'mainnet',
            wordCount: count,
            hasPassphrase: false,
          };
          try {
            await walletVault.save(words, meta);
          } catch (e) {
            // The native key gate can refuse the first seal without a fresh
            // biometric: one device step-up prompt, then a single retry.
            // Anything else fails loudly: the wallet would otherwise not
            // survive a relaunch.
            if (!(e instanceof VaultAuthRequiredError)) throw e;
            if (!(await stepUpDeviceAuth())) throw e;
            await walletVault.save(words, meta);
          }
        }
        onDone({ deferred, bio, biometrics });
      })();
    },
    [backup, pinOnly, seedWords, bio, biometrics, onDone],
  );

  const screen = stack[stack.length - 1];
  const ctx: Ctx = {
    push: (s) => setStack((st) => [...st, s]),
    pop: () => setStack((st) => (st.length > 1 ? st.slice(0, -1) : st)),
    finish,
    bio,
    pin,
    setPin,
    flow,
    setFlow,
    biometrics,
    setBiometrics,
    seedWords,
    setSeedWords,
    seedEntropy,
    setSeedEntropy,
    pinOnly,
  };

  const Current = SCREENS[screen];
  // Keyed so each screen replays its entrance on navigation.
  return (
    <Enter key={screen} duration={240} offset={0} style={{ flex: 1 }}>
      {screen === 'seed' ? <Seed ctx={ctx} backup={backup} /> : <Current ctx={ctx} />}
    </Enter>
  );
}
