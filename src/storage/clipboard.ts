// Clipboard scrub for secrets: the installed expo-clipboard (57) ships no
// clear API, so the wipe is the supported equivalent, an empty-string
// write: nothing readable remains to paste. A failed wipe (rare OS
// refusal) resolves silently; callers never surface it as an error.
import * as Clipboard from 'expo-clipboard';

export function scrubClipboard(): void {
  Clipboard.setStringAsync('').catch(() => undefined);
}
