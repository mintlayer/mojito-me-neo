import React, { useState, useEffect } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { t } from '../../i18n';
import { ACCOUNTS } from '../data';
import { C, alpha, black, white } from '../../theme';
import { Btn, Sheet, Ticker, Txt } from '../../ui';
import { BigBadge, Body, Checkbox, Column, LinkBtn, StepHeader } from '../ui';
import type { Ctx } from '../context';

export function Discovery({ ctx }: { ctx: Ctx }) {
  const [phase, setPhase] = useState<'scan' | 'done'>('scan');
  const [checked, setChecked] = useState<Record<number, boolean>>({ 0: true, 1: true, 2: false });
  const [sheet, setSheet] = useState(false);
  const [path, setPath] = useState("m/84'/0'/3'");

  useEffect(() => {
    if (phase !== 'scan') return;
    const t = setTimeout(() => setPhase('done'), 2000);
    return () => clearTimeout(t);
  }, [phase]);

  const selected = Object.values(checked).filter(Boolean).length;
  const found = ctx.discovery === 'found';

  return (
    <Column>
      <StepHeader onBack={ctx.pop} step={4} />

      {phase === 'scan' ? (
        <View className="flex-1 items-center justify-center px-6">
          <BigBadge icon="scan" pulsing />
          <Txt className="text-[20px] font-bold tracking-tightest mt-6">{t('onboarding.discovery.scanning')}</Txt>
          <Txt className="text-[13px] text-text2 mt-2 text-center leading-[19px]">
            {t('onboarding.discovery.scanningSub')}
          </Txt>
          <Ticker>
            <Txt mono className="text-[11px] text-text3 mt-[18px]">
              m/84'/0'/…
            </Txt>
          </Ticker>
        </View>
      ) : found ? (
        <Body className="px-[22px] pt-4 pb-7">
          <Txt className="text-[24px] font-bold tracking-tightest">{t('onboarding.discovery.title')}</Txt>
          <Txt className="text-[13px] text-text2 mt-1.5">{t('onboarding.discovery.sub')}</Txt>

          <View className="gap-2.5 mt-[18px]">
            {ACCOUNTS.map((a, i) => (
              <Pressable
                key={a.name}
                onPress={() => setChecked((c) => ({ ...c, [i]: !c[i] }))}
                className="flex-row items-center gap-3 px-3.5 py-3 rounded-[14px]"
                style={{
                  backgroundColor: checked[i] ? alpha(C.amber, 0.07) : white(0.03),
                  borderWidth: 1,
                  borderColor: checked[i] ? alpha(C.amber, 0.4) : C.lineSoft,
                }}>
                <Checkbox checked={!!checked[i]} onToggle={() => setChecked((c) => ({ ...c, [i]: !c[i] }))} size={21}>
                  <View />
                </Checkbox>
                <View className="flex-1">
                  <View className="flex-row items-baseline gap-2">
                    <Txt className="text-[14px] font-semibold">{a.name}</Txt>
                    <Txt mono className="text-[10px] text-text3">
                      {a.path}
                    </Txt>
                  </View>
                  <View className="flex-row gap-3 mt-1">
                    <Txt mono className="text-[11.5px] text-text1">
                      {a.btc} BTC
                    </Txt>
                    <Txt mono className="text-[11.5px] text-text1">
                      {a.ml} ML
                    </Txt>
                  </View>
                </View>
                <Txt mono className="text-[11px] text-text2">
                  {a.usd}
                </Txt>
              </Pressable>
            ))}
          </View>

          <Btn tone="primary" className="mt-5" disabled={selected === 0} onPress={() => ctx.finish(false)}>
            {t('onboarding.discovery.restore', { count: selected, plural: selected === 1 ? '' : 's' })}
          </Btn>
          <LinkBtn className="mt-3.5" onPress={() => setSheet(true)}>
            {t('onboarding.discovery.custom')}
          </LinkBtn>
        </Body>
      ) : (
        <View className="flex-1 px-6 pt-4 pb-7">
          <View className="flex-1 items-center justify-center">
            <BigBadge icon="history" size={72} square />
            <Txt className="text-[20px] font-bold tracking-tightest mt-5">{t('onboarding.discovery.none')}</Txt>
            <Txt className="text-[13px] text-text2 mt-2 text-center leading-[20px] max-w-[270px]">
              {t('onboarding.discovery.noneSub')}
            </Txt>
          </View>
          <Btn tone="primary" onPress={() => ctx.finish(false)}>
            {t('common.continue')}
          </Btn>
          <LinkBtn className="mt-3.5" onPress={() => setSheet(true)}>
            {t('onboarding.discovery.custom')}
          </LinkBtn>
        </View>
      )}

      <Sheet open={sheet} onClose={() => setSheet(false)}>
        <Txt className="text-[18px] font-bold tracking-tightest">{t('onboarding.discovery.customTitle')}</Txt>
        <Txt className="text-[13px] text-text2 mt-2 leading-[19px]">
          {t('onboarding.discovery.customSub')}
        </Txt>
        <TextInput
          value={path}
          onChangeText={setPath}
          accessibilityLabel={t('onboarding.discovery.pathA11y')}
          autoCapitalize="none"
          autoCorrect={false}
          className="font-mono text-[13px] text-text0 h-[46px] rounded-xl px-3.5 mt-4"
          style={{ backgroundColor: black(0.3), borderWidth: 1, borderColor: C.line }}
        />
        <Btn
          tone="primary"
          className="mt-3.5"
          onPress={() => {
            setSheet(false);
            setPhase('scan');
          }}>
          {t('onboarding.discovery.scanCta')}
        </Btn>
      </Sheet>
    </Column>
  );
}

/* ══ Own entropy (the design marks this WIP) ════════════════ */

/** 24 words needs 256 bits of seed material. */
