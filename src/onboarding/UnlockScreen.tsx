import React, { useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { C } from '../theme';
import { Btn, MojitoLogo, Txt } from '../ui';
import { Bio, BioCircle, BioGlyph, Column, Keypad, LinkBtn, PinDots, useBioScan, usePinEntry } from './ui';
import { bioName } from './context';

export function UnlockScreen({ bio, pin, onUnlock }: { bio: Bio; pin: string; onUnlock: () => void }) {
  const [mode, setMode] = useState<'bio' | 'pin'>('bio');
  const scan = useBioScan(onUnlock);
  const onUnlockRef = useRef(onUnlock);
  onUnlockRef.current = onUnlock;

  const { val, setValue, err, msg, lockLeft, locked } = usePinEntry({
    target: pin,
    settle: 200,
    onMatch: () => onUnlockRef.current(),
    onMismatch: (left) => (left <= 0 ? '' : `Wrong PIN · ${left} attempt${left === 1 ? '' : 's'} left`),
  });

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
              if (val.length < 6) setValue(val + k);
            }}
            onDelete={() => setValue(val.slice(0, -1))}
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
