import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { SEED } from '.././data';
import { C, alpha } from '../../theme';
import { Btn, Card, Chip, Enter, Icon, ListRow, Sheet, Txt } from '../../ui';
import { Body, Column, LinkBtn, SCREENSHOT_BLOCKING, SeedGrid, StepHeader, useSeedProtection } from '.././ui';
import type { Ctx } from '../context';

export function Seed({ ctx }: { ctx: Ctx }) {
  useSeedProtection();
  const [revealed, setRevealed] = useState(false);
  const [skipSheet, setSkipSheet] = useState(false);
  const [advanced, setAdvanced] = useState(false);

  return (
    <Column>
      {/* Backing out of the backup is the decision the sheet exists for. */}
      <StepHeader onBack={() => setSkipSheet(true)} step={3} />
      <Body className="px-[22px] pt-4 pb-7">
        <Txt className="text-[24px] font-bold tracking-tightest">Your recovery phrase</Txt>
        <Txt className="text-[13px] text-text2 mt-1.5 leading-[19px]">
          24 words, one secret. It backs up every account in this wallet.
        </Txt>

        {/* Only Android can actually enforce this, so only Android claims it. */}
        {SCREENSHOT_BLOCKING && (
          <View className="self-start mt-3">
            <Chip tone={C.teal} icon="lock">
              Screenshots are blocked on this screen
            </Chip>
          </View>
        )}

        <Card variant="inset" accent={C.line} className="mt-3.5 p-2.5 rounded-2xl overflow-hidden">
          <SeedGrid words={SEED} columns={3} hidden={!revealed} />
          {!revealed && (
            <Pressable onPress={() => setRevealed(true)} className="absolute inset-0 items-center justify-center">
              {/* Opaque scrim, not a blur: the words aren't rendered at all
                  until revealed, so there is nothing left to obscure. */}
              <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: alpha(C.bg1, 0.72) }} />
              <View
                className="w-12 h-12 rounded-full items-center justify-center"
                style={{ backgroundColor: alpha(C.amber, 0.14), borderWidth: 1, borderColor: alpha(C.amber, 0.4) }}>
                <Icon name="eye" size={19} color={C.amber} />
              </View>
              <Txt className="text-[13px] font-semibold mt-2.5">Tap to reveal</Txt>
              <Txt className="text-[11px] text-text2 mt-1">Make sure no one's watching</Txt>
            </Pressable>
          )}
        </Card>

        {/* The button carries the commitment instead of a separate tick-box:
            the verify quiz on the next step is the real check, so a checkbox
            would only add a tap and a dead button. Still gated on `revealed`
            — you can't have written down words you haven't seen. */}
        <Btn tone="primary" className="mt-5" disabled={!revealed} onPress={() => ctx.push('verify')}>
          I've written it down
        </Btn>
        <LinkBtn className="mt-4" onPress={() => setSkipSheet(true)}>
          I'll back up later
        </LinkBtn>

        {/* Progressive disclosure: collapsed by default so the device RNG reads
            as the answer, not as one of two choices the user must weigh. */}
        <LinkBtn className="mt-5" onPress={() => setAdvanced((a) => !a)}>
          {advanced ? 'Hide advanced' : 'Advanced'}
        </LinkBtn>

        {advanced && (
          <Enter duration={200} offset={6}>
            <Card className="mt-3 rounded-[14px]">
              <ListRow
                icon="flash"
                iconColor={C.text2}
                label="Bring your own entropy"
                sub="Draw a picture to add your own randomness to the phrase"
                trailing={<Icon name="chevron_r" size={14} color={C.text2} />}
                onPress={() => ctx.push('entropy')}
              />
            </Card>
          </Enter>
        )}
      </Body>

      <Sheet open={skipSheet} onClose={() => setSkipSheet(false)}>
        <Txt className="text-[18px] font-bold tracking-tightest">Skip backup for now?</Txt>
        <Txt className="text-[13px] text-text2 mt-2 leading-[20px]">
          <Txt className="text-[13px] font-semibold">Receive stays locked</Txt> until your phrase is verified — so funds can't
          land in a wallet you could lose. If this phone breaks before you back up, the wallet is unrecoverable.
        </Txt>
        <Btn tone="primary" className="mt-[18px]" onPress={() => setSkipSheet(false)}>
          Back up now
        </Btn>
        <Btn className="mt-2.5" onPress={() => ctx.finish(true)}>
          Continue without backup
        </Btn>
      </Sheet>
    </Column>
  );
}

/* ══ 4a · Verify ════════════════════════════════════════════ */
