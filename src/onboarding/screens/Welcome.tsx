import React from 'react';
import { View } from 'react-native';
import { t } from '../../i18n';
import { Btn, MojitoLogo, Txt } from '../../ui';
import { Column } from '../ui';
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
          {t('onboarding.welcome.tagline')}
        </Txt>
      </View>
      <View className="gap-2.5">
        <Btn tone="primary" onPress={() => start('create')}>
          {t('onboarding.welcome.create')}
        </Btn>
        <Btn onPress={() => start('import')}>{t('onboarding.welcome.import')}</Btn>
      </View>
      <Txt className="text-[11px] text-text3 text-center mt-4">{t('onboarding.welcome.footer')}</Txt>
    </Column>
  );
}

/* ══ 1 · Secure ═════════════════════════════════════════════ */
