import type { Bio } from '../onboarding';

/** Props the overlay screens receive from App. Most sheets consume a subset. */
export type Sheet = {
  onClose?: () => void;
  /** Re-enters the seed/verify backup flow (Settings only). */
  onBackup?: () => void;
  /** Opens the change-PIN flow (Settings only). */
  onChangePin?: () => void;
  /** Locks the app (Settings only). */
  onLock?: () => void;
  /** Signs out: wipes the vault, the PIN and the session (Settings only). */
  onSignOut?: () => void;
  /** Session biometric mode; SendScreen reads it for the auth copy. */
  bio?: Bio;
  /** Recovery-phrase length from the vault meta (Settings only). */
  wordCount?: number;
};

/** Props the tab screens receive from App. Only Home consumes them all. */
export type Nav = {
  onOpenSend?: () => void;
  onOpenReceive?: () => void;
  onOpenSettings?: () => void;
  onGoto?: (tab: string) => void;
  /** Onboarding finished without verifying the phrase, so Receive stays locked. */
  deferred?: boolean;
  onBackUp?: () => void;
  /** Locks the app and shows the unlock screen. */
  onLock?: () => void;
};
