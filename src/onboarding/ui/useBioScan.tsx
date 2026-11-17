import { useEffect, useRef, useState } from 'react';
import type { ScanPhase } from './types';

export function useBioScan(onDone: () => void) {
  const [phase, setPhase] = useState<ScanPhase>('idle');
  // Latest-callback ref: the chain below keeps running across re-renders and
  // still calls the callback the screen passed in last.
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  });
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  // If the screen unmounts mid-scan, drop pending timers so neither the phase
  // update nor onDone fires against a dead screen.
  useEffect(
    () => () => {
      timers.current.forEach((t) => clearTimeout(t));
    },
    [],
  );
  const start = () => {
    if (phase !== 'idle') return;
    setPhase('scan');
    timers.current.push(
      setTimeout(() => {
        setPhase('ok');
        timers.current.push(setTimeout(() => doneRef.current(), 500));
      }, 1400),
    );
  };
  return { phase, start };
}
