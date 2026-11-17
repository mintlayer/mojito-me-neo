import React, { useState, useEffect } from 'react';
import { Pressable, TextInput, View } from 'react-native';
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
          <Txt className="text-[20px] font-bold tracking-tightest mt-6">Scanning your accounts</Txt>
          <Txt className="text-[13px] text-text2 mt-2 text-center leading-[19px]">
            Checking BTC and ML derivation paths{'\n'}for balances and history…
          </Txt>
          <Ticker>
            <Txt mono className="text-[11px] text-text3 mt-[18px]">
              m/84'/0'/…
            </Txt>
          </Ticker>
        </View>
      ) : found ? (
        <Body className="px-[22px] pt-4 pb-7">
          <Txt className="text-[24px] font-bold tracking-tightest">Accounts found</Txt>
          <Txt className="text-[13px] text-text2 mt-1.5">These accounts have on-chain history. Pick the ones to restore.</Txt>

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
            {`Restore ${selected} account${selected === 1 ? '' : 's'}`}
          </Btn>
          <LinkBtn className="mt-3.5" onPress={() => setSheet(true)}>
            Use a custom derivation path
          </LinkBtn>
        </Body>
      ) : (
        <View className="flex-1 px-6 pt-4 pb-7">
          <View className="flex-1 items-center justify-center">
            <BigBadge icon="history" size={72} square />
            <Txt className="text-[20px] font-bold tracking-tightest mt-5">No extra accounts found</Txt>
            <Txt className="text-[13px] text-text2 mt-2 text-center leading-[20px] max-w-[270px]">
              Only the first account has history. Account 1 will be restored — you can add more accounts any time.
            </Txt>
          </View>
          <Btn tone="primary" onPress={() => ctx.finish(false)}>
            Continue
          </Btn>
          <LinkBtn className="mt-3.5" onPress={() => setSheet(true)}>
            Use a custom derivation path
          </LinkBtn>
        </View>
      )}

      <Sheet open={sheet} onClose={() => setSheet(false)}>
        <Txt className="text-[18px] font-bold tracking-tightest">Custom derivation path</Txt>
        <Txt className="text-[13px] text-text2 mt-2 leading-[19px]">
          Scan a specific path if your accounts were created by another wallet.
        </Txt>
        <TextInput
          value={path}
          onChangeText={setPath}
          accessibilityLabel="Derivation path"
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
          Scan this path
        </Btn>
      </Sheet>
    </Column>
  );
}

/* ══ Own entropy (the design marks this WIP) ════════════════ */

/** 24 words needs 256 bits of seed material. */
