/** Props the overlay screens receive from App. */
export type Sheet = { onClose?: () => void };

/** Props the tab screens receive from App. Only Home consumes them all. */
export type Nav = {
  onOpenSend?: () => void;
  onOpenReceive?: () => void;
  onOpenSettings?: () => void;
  onGoto?: (tab: string) => void;
  /** Onboarding finished without verifying the phrase — Receive stays locked. */
  deferred?: boolean;
  onBackUp?: () => void;
  /** Locks the app and shows the unlock screen. */
  onLock?: () => void;
};
