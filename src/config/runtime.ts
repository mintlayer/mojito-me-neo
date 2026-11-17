// One policy gate for "may this runtime silently fall back to an in-memory
// or unverified implementation?": dev builds (__DEV__), Expo Go and non-RN
// tooling (Node tests, tsx) may; a release build must fail loudly instead of
// degrading persistence or key generation. The storage and keys modules
// share this single spelling so the policy cannot drift apart per file.
declare const __DEV__: boolean | undefined;

/** True only where dev/memory fallbacks are allowed (see the module note). */
export function devFallbackAllowed(): boolean {
  return typeof __DEV__ === 'undefined' || __DEV__ === true;
}
