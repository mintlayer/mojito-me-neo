import React, { useState, useEffect, useRef } from 'react';
import { Pressable, View } from 'react-native';
import { C } from '../theme';
import { Btn, MojitoLogo, Txt } from '../ui';
import { Bio, BioCircle, BioGlyph, Column, Keypad, LinkBtn, PinDots, useBioScan } from '././ui';
import { LOCK_ATTEMPTS, LOCK_SECONDS, bioName } from './context';

export function UnlockScreen({ bio, pin, onUnlock }: { bio: Bio; pin: string; onUnlock: () => void }) {
  const [mode, setMode] = useState<'bio' | 'pin'>('bio');
  const [val, setVal] = useState('');
  const [attempts, setAttempts] = useState(LOCK_ATTEMPTS);
  const [err, setErr] = useState(false);
  const [msg, setMsg] = useState('');
  const [lockLeft, setLockLeft] = useState(0);
  const scan = useBioScan(onUnlock);
  const locked = lockLeft > 0;
  const onUnlockRef = useRef(onUnlock);
  onUnlockRef.current = onUnlock;

  // Real countdown. Without this the "locked for 30s" copy is a lie and the
  // wallet stays bricked until the JS context restarts.
  useEffect(() => {
    if (lockLeft <= 0) return;
    const t = setTimeout(() => {
      const next = lockLeft - 1;
      setLockLeft(next);
      if (next === 0) {
        setAttempts(LOCK_ATTEMPTS);
        setMsg('');
      }
    }, 1000);
    return () => clearTimeout(t);
  }, [lockLeft]);

  useEffect(() => {
    if (val.length !== 6 || locked) return;
    if (val === pin) {
      const t = setTimeout(() => onUnlockRef.current(), 200);
      return () => clearTimeout(t);
    }
    const left = attempts - 1;
    setErr(true);
    setMsg(left <= 0 ? '' : `Wrong PIN · ${left} attempt${left === 1 ? '' : 's'} left`);
    const t = setTimeout(() => {
      setVal('');
      setErr(false);
      setAttempts(left);
      if (left <= 0) setLockLeft(LOCK_SECONDS);
    }, 650);
    return () => clearTimeout(t);
  }, [val, locked, pin, attempts]);

  return (
    <Column>
      <View className="items-center mt-8">
        <MojitoLogo size={52} animate={false} />
        <Txt className="text-[22px] font-bold tracking-tightest mt-3.5">Welcome back</Txt>
      </View>

      {mode === 'bio' ? (
        <>
          <View className="flex-1 items-center justify-center gap-3.5">
            <BioCircle bio={bio} phase={scan.phase} onPress={scan.start} />
            <Txt className="text-[12px] text-text2">
              {scan.phase === 'scan' ? 'Scanning…' : scan.phase === 'ok' ? 'Unlocked' : `Tap to unlock with ${bioName(bio)}`}
            </Txt>
          </View>
          <View className="px-6">
            <Btn onPress={() => setMode('pin')}>Use PIN</Btn>
          </View>
        </>
      ) : (
        <>
          <Txt className="text-[13px] text-text2 text-center mt-2">Enter your 6-digit PIN</Txt>
          <View className="mt-9">
            <PinDots value={val} error={err} />
          </View>
          <Txt className="text-[12px] text-center mt-4 h-4" style={{ color: err || locked ? C.red : C.text3 }}>
            {locked ? `Too many attempts — try again in ${lockLeft}s` : msg}
          </Txt>
          {/* Rendered outside <Keypad> so the PIN lockout can't disable the
              only way back in. */}
          {locked && (
            <LinkBtn className="mt-3" onPress={() => setMode('bio')}>
              Unlock with {bioName(bio)} instead
            </LinkBtn>
          )}
          <View className="flex-1" />
          <Keypad
            disabled={locked}
            onKey={(k) => {
              if (val.length < 6) {
                setMsg('');
                setVal(val + k);
              }
            }}
            onDelete={() => setVal(val.slice(0, -1))}
            corner={
              <Pressable onPress={() => setMode('bio')} className="p-2">
                <BioGlyph bio={bio} size={26} color={C.text2} />
              </Pressable>
            }
          />
        </>
      )}
    </Column>
  );
}
