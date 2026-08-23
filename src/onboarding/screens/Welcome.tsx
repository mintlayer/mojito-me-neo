import React from 'react';
import { View } from 'react-native';
import { Btn, MojitoLogo, Txt } from '../../ui';
import { Column } from '.././ui';
import type { Ctx } from '../context';

export function Welcome({ ctx }: { ctx: Ctx }) {
  const start = (flow: 'create' | 'import') => {
    ctx.setFlow(flow);
    ctx.push('secure');
  };
  return (
    <Column className="px-6">
      <View className="flex-1 items-center justify-center">
        <MojitoLogo size={92} />
        <Txt className="text-[34px] font-bold tracking-tightest mt-6">mojito</Txt>
        <Txt className="text-[14px] text-text2 mt-2.5 text-center leading-[22px] max-w-[270px]">
          One recovery phrase, every account.{'\n'}Bitcoin and Mintlayer, self-custody.
        </Txt>
      </View>
      <View className="gap-2.5">
        <Btn tone="primary" onPress={() => start('create')}>
          Create a new wallet
        </Btn>
        <Btn onPress={() => start('import')}>I already have a wallet</Btn>
      </View>
      <Txt className="text-[11px] text-text3 text-center mt-4">Non-custodial · Open source</Txt>
    </Column>
  );
}

/* ══ 1 · Secure ═════════════════════════════════════════════ */
