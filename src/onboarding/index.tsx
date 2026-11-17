import React, { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { Enter } from '../ui';
import { t } from '../i18n';
import type { Bio } from './ui';
import type { Ctx, ScreenId } from './context';
import { walletVault, type VaultMeta } from '../storage/walletVault';
import { SUPPORTED_COUNTS, type WordCount } from '../keys/bip39';
import { detectBio } from './ui/useBioScan';
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
  bio: bioProp,
  pinOnly = false,
  /** Backup re-entry: screens read the vault phrase instead of generating. */
  backup = false,
  /** Whether the app lock is armed; backup re-entry renders under the lock
   *  layer, and the stored phrase must not decrypt until the user has
   *  re-unlocked. */
  locked = false,
  onDone,
}: {
  /** 'seed' re-enters just the backup flow from the deferred-backup banner. */
  initial?: ScreenId;
  bio?: Bio;
  /** Run only the PIN set/confirm pair, used by Settings > Change PIN. */
  pinOnly?: boolean;
  /** Settings > Recovery phrase: reveal the stored phrase, never re-seal. */
  backup?: boolean;
  /** Lock layer state; Seed defers the stored-phrase decrypt until false. */
  locked?: boolean;
  onDone: (r: OnboardingResult) => void;
}) {
  const [stack, setStack] = useState<ScreenId[]>([initial]);
  const [pin, setPin] = useState('');
  const [flow, setFlow] = useState<'create' | 'import'>('create');
  const [biometrics, setBiometrics] = useState(false);
  const [seedWords, setSeedWords] = useState<string[] | null>(null);
  const [seedEntropy, setSeedEntropy] = useState<Uint8Array | null>(null);
  /** The biometric noun for copy and glyphs; null until the mount probe
   *  lands (re-entries get the real value from the app session up front). */
  const [bioState, setBioState] = useState<Bio | null>(bioProp ?? null);
  /** Device capability, probed once per mount; drives the PIN-only copy. */
  const [bioAvailable, setBioAvailable] = useState(false);
  const bio = bioState ?? 'face';

  // One capability probe per mount: the Secure and PinSet copy and glyphs
  // must match the device (a fingerprint-only phone must never read
  // "Face ID", and a device without biometrics must not be offered a bio
  // fallback at all). Backup and change-PIN re-entries re-probe cheaply and
  // converge on the same value the app session detected.
  useEffect(() => {
    let alive = true;
    void detectBio().then((detected) => {
      if (!alive) return;
      if (detected) setBioState(detected);
      setBioAvailable(detected !== null);
    });
    return () => {
      alive = false;
    };
  }, []);

  const finish = useCallback(
    (deferred: boolean) => {
      void (async () => {
        // Deviation from spec M1-keys (recorded in decisions.md): the PIN
        // change flow swaps only the verifier; it does not re-key or re-seal
        // the vault. The vault key is independent of the PIN, so re-sealing
        // on a PIN change adds no security; the seed.v2 slot exists for the
        // biometrics gating flip at unlock (walletVault slot lifecycle),
        // not for PIN changes.
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
            // Discovery probes the testnet fixtures in this build (the
            // mainnet indexer is live-verified but the wallet defaults to
            // testnet derivation), so the stored meta names what the
            // addresses actually are.
            network: 'testnet',
            wordCount: count,
            hasPassphrase: false,
          };
          try {
            // The gate choice rides the seal: the vault key is created
            // auth-gated only when the Secure screen enrolled biometrics
            // (the persisted user choice, never hardware detection).
            await walletVault.save(words, meta, biometrics);
          } catch {
            // The native gate prompts inside the module; a declined or
            // failed seal must fail loudly yet not throw into the void
            // (this IIFE is async: an unhandled rejection would surface
            // nothing and onboarding would silently stall). Nothing was
            // sealed, so the wallet would not survive a relaunch: stay on
            // the flow and let the user retry.
            Alert.alert(t('onboarding.seed.sealErrorTitle'), t('onboarding.seed.sealErrorBody'));
            return;
          }
        }
        // The phrase leaves onboarding state exactly when the backup layer
        // closes: the reveal and verify UI never outlives the layer.
        if (backup && !pinOnly) setSeedWords(null);
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
    bioAvailable,
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
      {screen === 'seed' ? <Seed ctx={ctx} backup={backup} locked={locked} /> : <Current ctx={ctx} />}
    </Enter>
  );
}
