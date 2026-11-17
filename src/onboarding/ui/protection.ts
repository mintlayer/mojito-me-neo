import { useEffect } from 'react';
import { Alert, Platform } from 'react-native';
import { addScreenshotListener, usePreventScreenCapture } from 'expo-screen-capture';
import { t } from '../../i18n';

export const SCREENSHOT_BLOCKING = Platform.OS === 'android';

/**
 * Guards whichever screen shows the recovery phrase.
 *
 * Android: FLAG_SECURE, so the screenshot fails, screen recording records black,
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
        t('onboarding.seed.screenshotAlertTitle'),
        t('onboarding.seed.screenshotAlertBody'),
        [{ text: t('onboarding.seed.screenshotAlertOk') }],
      );
    });
    return () => sub.remove();
  }, []);
}

/* ── Words ──────────────────────────────────────────────────── */

/** Tappable mnemonic word. Used by the verify quiz and the import suggestions. */
