// Scoped storage key ids. Versioned so future re-encryption needs no migration
// scripts; do not rename these without a migration spec.
export const STORAGE_KEYS = {
  seed: 'seed.v1',
  pinMeta: 'pin.meta.v1',
  waitlistEmail: 'waitlist.email.v1',
  // Not a sealed-store key: the plain settings JSON read by appSettings.
  settings: 'settings.v1',
} as const;

export type StorageKeyId = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];
