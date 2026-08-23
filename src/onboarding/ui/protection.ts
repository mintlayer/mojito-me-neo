import { useEffect } from 'react';
import { Alert, Platform } from 'react-native';
import { addScreenshotListener, usePreventScreenCapture } from 'expo-screen-capture';

export const SCREENSHOT_BLOCKING = Platform.OS === 'android';

/**
 * Guards whichever screen shows the recovery phrase.
 *
 * Android: FLAG_SECURE — the screenshot fails, screen recording records black,
 * and the app's recents thumbnail is blanked.
 * iOS: the OS exposes no way to prevent a screenshot, only to be told after the
 * fact. So we detect it and tell the user what to do about it.
 */

export function useSeedProtection() {
  usePreventScreenCapture();

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const sub = addScreenshotListener(() => {
      Alert.alert(
        'Screenshot taken',
        "Screenshots of a recovery phrase are strongly discouraged — photos sync to iCloud and can be read by any app you grant photo access.\n\nDelete it, write the phrase down on paper instead, and if this wallet has held funds, move them to a freshly generated phrase.",
        [{ text: 'I understand' }],
      );
    });
    return () => sub.remove();
  }, []);
}

/* ── Words ──────────────────────────────────────────────────── */

/** Tappable mnemonic word. Used by the verify quiz and the import suggestions. */
