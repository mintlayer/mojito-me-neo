import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { t } from '../../i18n';
import { generateMnemonic, mixEntropy } from '../../keys/bip39';
import { VaultAuthRequiredError } from '../../../modules/mojito-core';
import { walletVault } from '../../storage/walletVault';
import { C, alpha, white } from '../../theme';
import { Btn, Card, Chip, Enter, Icon, ListRow, Sheet, Txt, tint } from '../../ui';
import { Body, Column, LinkBtn, SCREENSHOT_BLOCKING, SeedGrid, StepHeader, useSeedProtection, stepUpDeviceAuth } from '../ui';
import type { Ctx } from '../context';

/**
 * The recovery phrase. Create mode generates real entropy (device secure
 * random, optionally mixed with the drawn-entropy pool) over the full BIP39
 * list; backup re-entry reveals the phrase already sealed in the vault. The
 * words land in onboarding state only and are sealed at finish; nothing else
 * sees them.
 */
export function Seed({ ctx, backup }: { ctx: Ctx; backup?: boolean }) {
  useSeedProtection();
  const [revealed, setRevealed] = useState(false);
  const [skipSheet, setSkipSheet] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [count, setCount] = useState<12 | 24>(24);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Backup re-entry: show the stored phrase, never generate or re-seal.
  // The native key gate can refuse the decrypt without a fresh biometric:
  // one device step-up prompt, then a single retry, before the load error.
  useEffect(() => {
    if (!backup) return;
    let alive = true;
    const load = async (): Promise<void> => {
      try {
        const words = await walletVault.openWords();
        if (alive) ctx.setSeedWords(words);
      } catch (e) {
        if (!(e instanceof VaultAuthRequiredError)) throw e;
        if (!(await stepUpDeviceAuth())) throw e;
        const words = await walletVault.openWords();
        if (alive) ctx.setSeedWords(words);
      }
    };
    load().catch(() => alive && setError(t('onboarding.seed.loadError')));
    return () => {
      alive = false;
    };
  }, [backup, ctx]);

  // Create mode: generate once on entry, and again whenever the word count
  // changes or the Entropy screen hands back mixed entropy.
  useEffect(() => {
    if (backup) return;
    if (ctx.seedWords && !ctx.seedEntropy) return;
    let alive = true;
    setBusy(true);
    setError(null);
    const entropy = ctx.seedEntropy;
    void (async () => {
      const strength = count === 12 ? 128 : 256;
      // The drawn pool is mixed with fresh secure random, then truncated to
      // the strength's byte length, so the 12-word choice still applies when
      // a drawing exists; generateMnemonic uses the mixed bytes verbatim.
      const mixed = entropy ? (await mixEntropy(entropy)).slice(0, strength / 8) : undefined;
      const words = await generateMnemonic(strength, mixed);
      if (!alive) return;
      ctx.setSeedEntropy(null);
      ctx.setSeedWords(words);
    })()
      .catch(() => alive && setError(t('onboarding.seed.generateError')))
      .finally(() => alive && setBusy(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backup, count, ctx.seedEntropy]);

  const words = ctx.seedWords ?? [];

  const regenerate = () => {
    ctx.setSeedWords(null);
    setRevealed(false);
  };

  return (
    <Column>
      {/* Backing out of the backup is the decision the sheet exists for. */}
      <StepHeader onBack={() => setSkipSheet(true)} step={3} />
      <Body className="px-[22px] pt-4 pb-7">
        <Txt className="text-[24px] font-bold tracking-tightest">{t('onboarding.seed.title')}</Txt>
        <Txt className="text-[13px] text-text2 mt-1.5 leading-[19px]">
          {t('onboarding.seed.sub')}
        </Txt>

        {/* Only Android can actually enforce this, so only Android claims it. */}
        {SCREENSHOT_BLOCKING && (
          <View className="self-start mt-3">
            <Chip tone={C.teal} icon="lock">
              {t('onboarding.seed.screenshotBlocked')}
            </Chip>
          </View>
        )}

        {/* Word count: 24 words is the default; 12 stays available for
            import-compatible habits. A switch regenerates immediately. */}
        {!backup && (
          <View className="flex-row gap-2 mt-3">
            {([24, 12] as const).map((option) => {
              const on = count === option;
              return (
                <Pressable
                  key={option}
                  onPress={() => {
                    setCount(option);
                    ctx.setSeedWords(null);
                  }}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel={option === 24 ? t('onboarding.seed.count24') : t('onboarding.seed.count12')}
                  accessibilityState={{ selected: on }}
                  className="px-3 py-1.5 rounded-full"
                  style={{
                    backgroundColor: on ? alpha(C.amber, 0.12) : white(0.04),
                    borderWidth: 1,
                    borderColor: on ? alpha(C.amber, 0.5) : C.lineSoft,
                  }}>
                  <Txt className="text-[11px] font-semibold" style={{ color: on ? C.amber : C.text2 }}>
                    {option === 24 ? t('onboarding.seed.count24') : t('onboarding.seed.count12')}
                  </Txt>
                </Pressable>
              );
            })}
          </View>
        )}

        <Card variant="inset" accent={C.line} className="mt-3.5 p-2.5 rounded-2xl overflow-hidden">
          {words.length > 0 ? (
            <>
              <SeedGrid words={words} columns={3} hidden={!revealed} />
              {!revealed && (
                <Pressable onPress={() => setRevealed(true)} className="absolute inset-0 items-center justify-center">
                  {/* Opaque scrim, not a blur: the words aren't rendered at all
                      until revealed, so there is nothing left to obscure. */}
                  <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: alpha(C.bg1, 0.72) }} />
                  <View
                    className="w-12 h-12 rounded-full items-center justify-center"
                    style={tint(C.amber, 0.14, 0.4)}>
                    <Icon name="eye" size={19} color={C.amber} />
                  </View>
                  <Txt className="text-[13px] font-semibold mt-2.5">{t('onboarding.seed.reveal')}</Txt>
                  <Txt className="text-[11px] text-text2 mt-1">{t('onboarding.seed.revealHint')}</Txt>
                </Pressable>
              )}
            </>
          ) : (
            <View className="items-center justify-center py-8">
              <Txt className="text-[12px] text-text3">
                {busy ? t('onboarding.seed.generating') : (error ?? '')}
              </Txt>
            </View>
          )}
        </Card>

        {!backup && words.length > 0 && (
          <LinkBtn className="mt-2" onPress={regenerate}>
            {t('onboarding.seed.regenerate')}
          </LinkBtn>
        )}

        {/* The button carries the commitment instead of a separate tick-box:
            the verify quiz on the next step is the real check, so a checkbox
            would only add a tap and a dead button. Still gated on `revealed`:
            you can't have written down words you haven't seen. */}
        <Btn tone="primary" className="mt-5" disabled={!revealed} onPress={() => ctx.push('verify')}>
          {t('onboarding.seed.writtenCta')}
        </Btn>
        <LinkBtn className="mt-4" onPress={() => setSkipSheet(true)}>
          {t('onboarding.seed.later')}
        </LinkBtn>

        {/* Progressive disclosure: collapsed by default so the device RNG reads
            as the answer, not as one of two choices the user must weigh. The
            drawn entropy belongs to a fresh phrase only; a backup reveal must
            not mutate the stored wallet. */}
        {!backup && (
          <>
            <LinkBtn className="mt-5" onPress={() => setAdvanced((a) => !a)}>
              {advanced ? t('onboarding.advanced.hide') : t('onboarding.advanced.show')}
            </LinkBtn>

            {advanced && (
              <Enter duration={200} offset={6}>
                <Card className="mt-3 rounded-[14px]">
                  <ListRow
                    icon="flash"
                    iconColor={C.text2}
                    label={t('onboarding.entropy.row')}
                    sub={t('onboarding.entropy.rowSub')}
                    trailing={<Icon name="chevron_r" size={14} color={C.text2} />}
                    onPress={() => ctx.push('entropy')}
                  />
                </Card>
              </Enter>
            )}
          </>
        )}
      </Body>

      <Sheet open={skipSheet} onClose={() => setSkipSheet(false)}>
        <Txt className="text-[18px] font-bold tracking-tightest">{t('onboarding.seed.skipTitle')}</Txt>
        <Txt className="text-[13px] text-text2 mt-2 leading-[20px]">
          {t('onboarding.seed.skipBody')}
        </Txt>
        <Btn tone="primary" className="mt-[18px]" onPress={() => setSkipSheet(false)}>
          {t('onboarding.seed.skipCta')}
        </Btn>
        <Btn className="mt-2.5" onPress={() => ctx.finish(true)}>
          {t('onboarding.seed.skipContinue')}
        </Btn>
      </Sheet>
    </Column>
  );
}

/* ══ 4a · Verify ════════════════════════════════════════════ */
