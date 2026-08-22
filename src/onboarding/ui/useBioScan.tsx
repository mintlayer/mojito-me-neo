import { useState } from 'react';
import type { ScanPhase } from './types';

export function useBioScan(onDone: () => void) {
  const [phase, setPhase] = useState<ScanPhase>('idle');
  const start = () => {
    if (phase !== 'idle') return;
    setPhase('scan');
    setTimeout(() => {
      setPhase('ok');
      setTimeout(onDone, 500);
    }, 1400);
  };
  return { phase, start };
}
