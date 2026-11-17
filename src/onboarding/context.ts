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
  /** Whether account discovery turns anything up (import path). */
  discovery: 'found' | 'none';
  /** Change-PIN reuse: stop after confirming instead of continuing into setup. */
  pinOnly: boolean;
};

export const LOCK_ATTEMPTS = 5;

export const LOCK_SECONDS = 30;

/** The biometric noun as copy, so locales control the wording. */
export const bioName = (bio: Bio) => t(bio === 'face' ? 'onboarding.bio.face' : 'onboarding.bio.touch');

/** The guarding variant used inside sentences, e.g. Your fingerprint. */
export const bioGuard = (bio: Bio) => (bio === 'face' ? bioName(bio) : t('onboarding.bio.touchGuard'));
