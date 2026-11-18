// Scoped storage key ids. Versioned so future re-encryption needs no migration
// scripts; do not rename these without a migration spec.
export const STORAGE_KEYS = {
  seed: 'seed.v1',
  // Second fixed vault slot: the gating upgrade re-seals into the slot the
  // live one is not, so a legacy seed.v1 wallet lands here first (see the
  // slot lifecycle note in the walletVault module header).
  seedUpgrade: 'seed.v2',
  pinMeta: 'pin.meta.v1',
  waitlistEmail: 'waitlist.email.v1',
  // Public per-chain derivation indexes (receiving/change); never secrets.
  addressIndex: 'address.index.v1',
  // Not a sealed-store key: the plain settings JSON read by appSettings.
  settings: 'settings.v1',
} as const;

export type StorageKeyId = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];
