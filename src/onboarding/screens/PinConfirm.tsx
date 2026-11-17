import React from 'react';
import { t } from '../../i18n';
import type { Ctx } from '../context';
import { PinPad } from './PinPad';
import { usePinEntry } from '../ui';

export function PinConfirm({ ctx }: { ctx: Ctx }) {
  const { val, setValue, err, msg, lockLeft, locked } = usePinEntry({
    target: ctx.pin,
    onMatch: () => (ctx.pinOnly ? ctx.finish(false) : ctx.push(ctx.flow === 'create' ? 'seed' : 'import')),
  });

  return (
    <PinPad
      ctx={ctx}
      title={t('onboarding.pin.confirm')}
      subtitle={t('onboarding.pin.confirmSub')}
      value={val}
      setValue={setValue}
      message={locked ? t('onboarding.pin.locked', { seconds: lockLeft }) : msg}
      error={err}
      disabled={locked}
    />
  );
}
