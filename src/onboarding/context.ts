import { t } from '../i18n';
import type { Bio } from './ui';

export type ScreenId =
  | 'welcome'
  | 'secure'
  | 'pin-set'
  | 'pin-confirm'
  | 'seed'
  | 'verify'
  | 'import'
  | 'discovery'
  | 'entropy';

/** Everything a screen needs: the nav stack plus the flow's accumulated state. */

export type Ctx = {
  push: (s: ScreenId) => void;
  pop: () => void;
  /** Ends onboarding and hands the result back to the app. */
  finish: (deferred: boolean) => void;
  bio: Bio;
  pin: string;
  setPin: (p: string) => void;
  flow: 'create' | 'import';
  setFlow: (f: 'create' | 'import') => void;
  /** Whether biometric enrolment succeeded on the Secure screen. */
  biometrics: boolean;
  setBiometrics: (b: boolean) => void;
  /** The real generated or imported phrase; null until it exists. This is
   *  onboarding-time state only: finish() seals it into the vault and the
   *  app session never sees the words. */
  seedWords: string[] | null;
  setSeedWords: (words: string[] | null) => void;
  /** Externally drawn entropy (Entropy screen) mixed into the next generation. */
  seedEntropy: Uint8Array | null;
  setSeedEntropy: (bytes: Uint8Array | null) => void;
  /** Change-PIN reuse: verify the old PIN, stop after confirming the new. */
  pinOnly: boolean;
};

export { LOCK_ATTEMPTS, LOCK_SECONDS } from '../storage/pinStore';

/** The biometric noun as copy, so locales control the wording. */
export const bioName = (bio: Bio) => t(bio === 'face' ? 'onboarding.bio.face' : 'onboarding.bio.touch');

/** The guarding variant used inside sentences, e.g. Your fingerprint. */
export const bioGuard = (bio: Bio) => (bio === 'face' ? bioName(bio) : t('onboarding.bio.touchGuard'));
