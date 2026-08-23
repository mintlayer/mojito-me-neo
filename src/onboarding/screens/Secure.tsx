import React from 'react';
import { View } from 'react-native';
import { Btn, Txt } from '../../ui';
import { BioCircle, Column, LinkBtn, StepHeader, useBioScan } from '.././ui';
import { bioName } from '../context';
import type { Ctx } from '../context';

export function Secure({ ctx }: { ctx: Ctx }) {
  const scan = useBioScan(() => ctx.push('pin-set'));
  const name = bioName(ctx.bio);
  const status = scan.phase === 'scan' ? 'Scanning…' : scan.phase === 'ok' ? 'Verified' : `Tap to enable ${name}`;

  return (
    <Column>
      <StepHeader onBack={ctx.pop} step={1} />
      <View className="flex-1 px-6 pt-6">
        <Txt className="text-[24px] font-bold tracking-tightest">Secure your wallet</Txt>
        <Txt className="text-[13px] text-text2 mt-2 leading-[20px]">
          Your recovery phrase is encrypted on this device the moment it exists.{' '}
          {ctx.bio === 'face' ? 'Face ID' : 'Your fingerprint'} guards the key — nothing leaves the phone.
        </Txt>

        <View className="flex-1 items-center justify-center gap-3.5">
          <BioCircle bio={ctx.bio} phase={scan.phase} onPress={scan.start} />
          <Txt className="text-[12px] text-text2">{status}</Txt>
        </View>

        <Btn tone="primary" onPress={scan.start}>
          {scan.phase === 'idle' ? `Enable ${name}` : scan.phase === 'scan' ? 'Scanning…' : 'Verified ✓'}
        </Btn>
        <LinkBtn className="mt-3.5" onPress={() => ctx.push('pin-set')}>
          Use PIN instead
        </LinkBtn>
      </View>
    </Column>
  );
}

/* ══ 2 · PIN ════════════════════════════════════════════════ */

/** Both PIN screens are title + dots + keypad; only the verdict differs. */
