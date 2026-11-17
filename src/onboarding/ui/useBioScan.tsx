import { useCallback, useEffect, useRef, useState } from 'react';
import * as LocalAuthentication from 'expo-local-authentication';
import { t } from '../../i18n';
import type { Bio, ScanPhase } from './types';

/**
 * Device biometric capability for the Bio noun and the enrolment gate.
 * null when the device has no usable biometrics; the PIN path alone must
 * always work (losing biometrics must never lose funds).
 */
export async function detectBio(): Promise<Bio | null> {
  try {
    const [hasHardware, enrolled, types] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
      LocalAuthentication.supportedAuthenticationTypesAsync(),
    ]);
    if (!hasHardware || !enrolled || types.length === 0) return null;
    const face = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
    return face ? 'face' : 'finger';
  } catch {
    return null;
  }
}

export type BioScan = {
  phase: ScanPhase;
  /** True when the device cannot prompt for biometrics at all. */
  unavailable: boolean;
  /** Failed prompt attempts since mount; drives the PIN fallback copy. */
  failures: number;
  start: () => void;
};

/**
 * Real biometric prompt over expo-local-authentication (M0 shipped this as a
 * simulated scan). Resolves to the ok phase only when the OS-level check
 * succeeds; failures drop back to idle with the failure count for the PIN
 * fallback copy. Device credential (PIN/pattern) stays enabled as the OS
 * fallback; the in-app PIN fallback lives in usePinEntry.
 */
export function useBioScan(onDone: () => void, onFail?: () => void): BioScan {
  const [phase, setPhase] = useState<ScanPhase>('idle');
  const [unavailable, setUnavailable] = useState(false);
  const [failures, setFailures] = useState(0);
  // Latest-callback refs: the chain below keeps running across re-renders
  // and still calls the callbacks the screen passed in last.
  const doneRef = useRef(onDone);
  const failRef = useRef(onFail);
  useEffect(() => {
    doneRef.current = onDone;
    failRef.current = onFail;
  });
  const busy = useRef(false);

  useEffect(() => {
    detectBio().then((bio) => setUnavailable(bio === null));
  }, []);

  const start = useCallback(() => {
    if (busy.current || unavailable) return;
    busy.current = true;
    setPhase('scan');
    LocalAuthentication.authenticateAsync({
      promptMessage: t('onboarding.unlock.bioReason'),
      cancelLabel: t('common.cancel'),
      // The OS-level device credential stays available; the in-app PIN
      // fallback after two failures is a separate, always-working path.
      disableDeviceFallback: false,
    })
      .then((result) => {
        if (result.success) {
          setPhase('ok');
          setTimeout(() => doneRef.current(), 400);
        } else {
          setPhase('idle');
          setFailures((n) => n + 1);
          failRef.current?.();
        }
      })
      .catch(() => {
        setPhase('idle');
        setFailures((n) => n + 1);
      })
      .finally(() => {
        busy.current = false;
      });
  }, [unavailable]);

  return { phase, unavailable, start, failures };
}
