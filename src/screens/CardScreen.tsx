import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, LinearGradient as SvgGrad, Path, Stop } from 'react-native-svg';
import { t, type I18nKey } from '../i18n';
import { currentNetwork, endpointsFor } from '../config/endpoints';
import { devFallbackAllowed } from '../config/runtime';
import { useData, useDataState, useProviders } from '../data/providers/context';
import type { WaitlistPhase } from '../waitlist/WaitlistForm';
import { WaitlistForm, maskEmail } from '../waitlist/WaitlistForm';
import { C, G, alpha, black } from '../theme';
import { Btn, Callout, Card, Chip, Divider, Enter, Float, IconTile, Label, ProgressBar, Screen, ScreenIntro, SuccessScreen, Txt, gradColors, toneColor } from '../ui';

export function CardScreen() {
  const providers = useProviders();
  const cardFeatures = useData((d) => d.getCardFeatures());
  const cardTiers = useData((d) => d.getCardTiers());
  // One machine per screen instance, rebuilt if the provider handle swaps
  // (network switch rebuilds the provider set without remounting screens).
  // The machine starts fresh on a swap, so the effect below resets the
  // screen-local mirror with it; the sealed store itself persists.
  const form = useMemo(() => new WaitlistForm(providers.waitlist), [providers.waitlist]);
  const [email, setEmailDraft] = useState('');
  const [phase, setPhase] = useState<WaitlistPhase>('idle');
  const [busy, setBusy] = useState(false);
  /** The full-screen confirmation view (SuccessScreen); the card view stays
   *  underneath it so Done returns to the same screen state. */
  const [view, setView] = useState<'card' | 'confirm'>('card');
  // Bumped after a successful join so the counter gauge re-reads with the
  // new local slot instead of going stale until the next remount.
  const [counterRefresh, setCounterRefresh] = useState(0);
  const { data: waitlistCount } = useDataState((d) => d.getWaitlist(), counterRefresh);

  // The useStates above survive a provider swap while the machine does not:
  // without this reset the field would show a draft the fresh machine never
  // saw, and a stale duplicate callout or confirmation view could survive
  // the swap.
  useEffect(() => {
    setEmailDraft('');
    setPhase('idle');
    setBusy(false);
    setView('card');
  }, [providers.waitlist]);

  if (!waitlistCount || !cardFeatures || !cardTiers) return <Screen />;
  const blackTier = cardTiers.find((tier) => tier.id === 'black');

  // The confirmation copy names the address the submit sent (frozen in the
  // machine at submit time, so a mid-flight edit cannot rename the join)
  // and is masked everywhere per the M5 redaction rule.
  const confirmationEmail = form.duplicateEmail ?? form.submittedEmail ?? form.email;
  const openConfirmation = () => setView('confirm');
  const finishPhase = (next: WaitlistPhase) => {
    setBusy(false);
    setPhase(next);
    if (next === 'done') {
      setCounterRefresh((k) => k + 1);
      openConfirmation();
    }
  };
  // Same handler for the primary button and the email field's return key.
  const submit = () => {
    if (busy) return;
    setBusy(true);
    void form.submit().then(finishPhase);
  };
  const retry = () => {
    if (busy) return;
    setBusy(true);
    void form.retry().then(finishPhase);
  };
  const onEmailChange = (draft: string) => {
    form.setEmail(draft);
    setEmailDraft(draft);
    setPhase(form.currentPhase);
  };

  if (view === 'confirm') {
    const position = form.joinedPosition;
    return (
      <SuccessScreen
        title={t('card.waitlist.success.title')}
        description={
          position !== null
            ? t('card.waitlist.success.body', { position: position.toLocaleString(), email: maskEmail(confirmationEmail) })
            : t('card.waitlist.success.noPosition', { email: maskEmail(confirmationEmail) })
        }
        onDone={() => setView('card')}
      />
    );
  }

  // Spec M5 risk note: the taken counter implies scarcity the local store
  // cannot honestly track, so the gauge row is hidden in release builds
  // while the backend is unconfigured (waitlistBase null) and shown only
  // where devFallbackAllowed holds (the single __DEV__ spelling).
  const counterVisible = endpointsFor(currentNetwork()).waitlistBase !== null || devFallbackAllowed();
  const pct = counterVisible ? (waitlistCount.taken / waitlistCount.total) * 100 : 0;

  return (
    <Screen>
      <ScreenIntro title={t('card.hero.title')} chip={t('card.chip')} tone={C.amber} blurb={t('card.hero.subtitle')} />

      <View className="px-5 pt-8">
        <CardHero tierName={t(`card.tiers.${blackTier?.id ?? 'black'}` as I18nKey)} />
      </View>

      {/* Waitlist counter (provider state; release-hidden while local-only) */}
      {counterVisible && (
        <View className="px-5 pt-2 items-center">
          <Label>{t('card.waitlist.title')}</Label>
          <Txt mono className="text-[28px] font-bold tracking-tightest mt-1" style={{ color: C.amber }}>
            {t('card.waitlist.counter', { taken: waitlistCount.taken.toLocaleString(), total: waitlistCount.total.toLocaleString() })}
          </Txt>
          <View className="w-full mt-2.5">
            <ProgressBar pct={pct} />
          </View>
        </View>
      )}

      {/* Pre-register form (WaitlistForm machine) */}
      <View className="px-5 pt-6">
        <Card className="p-4 rounded-[18px]">
          <Txt className="text-[13px] font-semibold">{t('card.waitlist.email.label')}</Txt>
          <View
            className="flex-row items-center gap-2 mt-3 px-3.5 py-3 rounded-xl"
            style={{ backgroundColor: black(0.3), borderWidth: 1, borderColor: C.lineSoft }}>
            <TextInput
              value={email}
              onChangeText={onEmailChange}
              placeholder={t('card.waitlist.email.placeholder')}
              accessibilityLabel={t('card.waitlist.email.label')}
              placeholderTextColor={C.text3}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={254}
              onSubmitEditing={submit}
              className="flex-1 text-[14px] text-text0 p-0"
            />
            <Txt mono className="text-[11px] text-text3">
              ↵
            </Txt>
          </View>
          <Btn tone="primary" className="mt-3" disabled={busy || !email.trim()} onPress={submit}>
            {busy ? t('card.waitlist.submitting') : t('card.waitlist.submit')}
          </Btn>
          {phase === 'invalid' && (
            <Callout tone={C.red} icon="close" accessibilityRole="alert" className="mt-3">
              {t('card.waitlist.email.error')}
            </Callout>
          )}
          {phase === 'duplicate' && (
            <Callout
              tone={C.amber}
              icon="close"
              className="mt-3"
              action={
                <Pressable onPress={openConfirmation} accessibilityRole="button" hitSlop={8}>
                  <Txt className="text-[11px] font-bold" style={{ color: C.amber }}>
                    {t('card.waitlist.duplicate.view')}
                  </Txt>
                </Pressable>
              }>
              <View className="flex-1">
                <Txt className="text-[11.5px] font-bold text-text1">{t('card.waitlist.duplicate.title')}</Txt>
                <Txt className="text-[11.5px] text-text1 leading-[17px]">
                  {t('card.waitlist.duplicate.body', { email: maskEmail(form.duplicateEmail ?? '') })}
                </Txt>
              </View>
            </Callout>
          )}
          {phase === 'unavailable' && (
            <View className="mt-3">
              <Callout tone={C.amber} glyph="!" accessibilityRole="alert">
                {t('card.waitlist.unavailable')}
              </Callout>
              <Btn tone="default" className="mt-2" disabled={busy} onPress={retry}>
                {t('card.waitlist.retry')}
              </Btn>
            </View>
          )}
        </Card>
      </View>

      {/* Features */}
      <View className="px-5 pt-5">
        <Label className="mb-2.5">{t('card.features.title')}</Label>
        <View className="flex-row flex-wrap -m-1">
          {cardFeatures.map((f, i) => (
            <Enter key={f.id} delay={i * 70} style={{ width: '50%' }}>
              <Card className="m-1 p-3.5 rounded-[14px]">
                <IconTile name={f.icon} color={toneColor(f.tone)} size={30} />
                <Txt className="text-[13px] font-semibold mt-2.5">{t(`card.features.${f.id}.title` as I18nKey)}</Txt>
                <Txt className="text-[11px] text-text2 mt-0.5">{t(`card.features.${f.id}.detail` as I18nKey)}</Txt>
              </Card>
            </Enter>
          ))}
        </View>
      </View>

      {/* Tiers */}
      <View className="px-5 pt-5">
        <Label className="mb-2.5">{t('card.tiers.title')}</Label>
        <Card className="p-1 rounded-2xl">
          {cardTiers.map((tier, i) => {
            const tone = tier.id === 'black' ? C.cream : tier.id === 'gold' ? C.amber : C.text1;
            const swatch = tier.id === 'black' ? G.cardBlack.slice(1) : tier.id === 'gold' ? G.chipGold : G.chipSteel;
            return (
              <View key={tier.id} className="flex-row items-center gap-2.5 px-2.5 py-3">
                {i > 0 && <Divider className="absolute left-2.5 right-2.5 top-0" />}
                <LinearGradient
                  colors={gradColors(swatch)}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={{ width: 28, height: 18, borderRadius: 3, borderWidth: 1, borderColor: alpha(tone, 0.25) }}
                />
                <View className="flex-1">
                  <Txt className="text-[13px] font-semibold" style={{ color: tone }}>
                    {t(`card.tiers.${tier.id}` as I18nKey)}
                  </Txt>
                  <Txt mono className="text-[10px] text-text3 mt-0.5">
                    {t('card.tiers.stake', { amount: tier.stake })}
                  </Txt>
                </View>
                <Txt mono className="text-[12px] font-semibold" style={{ color: tone }}>
                  {t('card.tiers.cashback', { pct: tier.cashback })}
                </Txt>
                {tier.active ? (
                  <Chip tone={C.amber} dot={false}>
                    {t('card.tiers.you')}
                  </Chip>
                ) : (
                  <View className="w-6" />
                )}
              </View>
            );
          })}
        </Card>
      </View>
    </Screen>
  );
}

/** The physical card mock. ponytail: floats instead of pointer-tilting, since
 * tilt needs a gesture handler and reads as noise on touch. */

function CardHero({ tierName }: { tierName: string }) {
  return (
    <Float duration={5000} amount={5}>
      <LinearGradient
        colors={gradColors(G.cardBlack)}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          aspectRatio: 1.585,
          borderRadius: 22,
          borderWidth: 1,
          borderColor: alpha(C.amber, 0.35),
          overflow: 'hidden',
          padding: 22,
          justifyContent: 'space-between',
        }}>
        <Svg width="100%" height="100%" viewBox="0 0 320 200" style={{ position: 'absolute', opacity: 0.5 }}>
          <Defs>
            <SvgGrad id="cardLine" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={C.amber} stopOpacity={0.7} />
              <Stop offset="1" stopColor={C.amber} stopOpacity={0.05} />
            </SvgGrad>
          </Defs>
          {Array.from({ length: 6 }, (_, i) => (
            <Path
              key={i}
              d={`M ${-20 + i * 20} 220 Q ${160 + i * 10} ${100 - i * 10} ${340 + i * 10} ${-20 + i * 12}`}
              stroke="url(#cardLine)"
              strokeWidth={0.6}
              fill="none"
              opacity={0.7 - i * 0.08}
            />
          ))}
        </Svg>

        {/* Card face print (wordmark, number, expiry, cardholder): deliberately
            untranslated (i18n exemption), same convention as the Welcome wordmark. */}
        <View className="flex-row justify-between items-start">
          <View>
            <Txt className="text-[10px] font-semibold tracking-widest" style={{ color: C.amber }}>
              MOJITO
            </Txt>
            <Txt className="text-[22px] font-extrabold tracking-tightest mt-0.5" style={{ color: C.cream }}>
              {tierName}
            </Txt>
          </View>
          <LinearGradient
            colors={gradColors(G.emvChip)}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ width: 40, height: 30, borderRadius: 6, flexDirection: 'row', flexWrap: 'wrap', padding: 3, gap: 1 }}>
            {Array.from({ length: 9 }, (_, i) => (
              <View key={i} style={{ width: '30%', height: '30%', backgroundColor: 'rgba(90,80,66,1)' }} />
            ))}
          </LinearGradient>
        </View>

        <View className="flex-row justify-between items-end">
          <View>
            <Txt mono className="text-[13px] tracking-wider" style={{ color: C.cream }}>
              •••• •••• •••• 0021
            </Txt>
            <View className="flex-row gap-3.5 mt-2">
              <Txt className="text-[9px] tracking-label" style={{ color: alpha(C.amber, 0.8) }}>
                VALID THRU 12/29
              </Txt>
              <Txt className="text-[9px] tracking-label" style={{ color: alpha(C.amber, 0.8) }}>
                SATOSHI N.
              </Txt>
            </View>
          </View>
          <Svg width={38} height={38} viewBox="0 0 64 64">
            <Path
              d="M16 46 L16 18 L32 36 L48 18 L48 46"
              fill="none"
              stroke={C.amber}
              strokeWidth={3.5}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </Svg>
        </View>
      </LinearGradient>
    </Float>
  );
}
