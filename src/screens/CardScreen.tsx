import React, { useState } from 'react';
import { TextInput, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, LinearGradient as SvgGrad, Path, Stop } from 'react-native-svg';
import { t } from '../i18n';
import { CARD_FEATURES, CARD_TIERS, WAITLIST } from '../data';
import { C, G, alpha, black } from '../theme';
import { Btn, Card, Chip, Divider, Enter, Float, Icon, IconTile, Label, ProgressBar, Screen, ScreenIntro, Txt, gradColors, toneColor } from '../ui';

export function CardScreen() {
  const [email, setEmail] = useState('');
  const [registered, setRegistered] = useState(false);
  const pct = (WAITLIST.taken / WAITLIST.total) * 100;

  return (
    <Screen>
      <ScreenIntro title={t('card.title')} chip={t('card.chip')} tone={C.amber} blurb={t('card.blurb')} />

      <View className="px-5 pt-8">
        <CardHero />
      </View>

      {/* Waitlist */}
      <View className="px-5 pt-2 items-center">
        <Label>{t('card.waitlist.title')}</Label>
        <View className="flex-row items-baseline gap-1.5 mt-1">
          <Txt mono className="text-[28px] font-bold tracking-tightest" style={{ color: C.amber }}>
            {WAITLIST.taken.toLocaleString()}
          </Txt>
          <Txt className="text-[12px] text-text2">{t('card.waitlist.spots', { total: WAITLIST.total.toLocaleString() })}</Txt>
        </View>
        <View className="w-full mt-2.5">
          <ProgressBar pct={pct} />
        </View>
      </View>

      {/* Pre-register */}
      <View className="px-5 pt-6">
        {registered ? (
          <Enter>
            <Card grad={G.raisedGreen} accent={alpha(C.green, 0.4)} className="p-[18px] items-center rounded-[18px]">
              <View
                className="w-[52px] h-[52px] rounded-full items-center justify-center"
                style={{ backgroundColor: alpha(C.green, 0.18), borderWidth: 1, borderColor: alpha(C.green, 0.5) }}>
                <Icon name="check" size={24} color={C.green} stroke={2.4} />
              </View>
              <Txt className="text-[16px] font-semibold mt-3">{t('card.waitlist.successTitle')}</Txt>
              <Txt className="text-[12px] text-text2 mt-1 text-center">
                {t('card.waitlist.successBody', { position: (WAITLIST.taken + 1).toLocaleString(), email })}
              </Txt>
              <View className="mt-3.5">
                <Chip tone={C.amber} dot={false}>
                  {t('card.waitlist.eta')}
                </Chip>
              </View>
            </Card>
          </Enter>
        ) : (
          <Card className="p-4 rounded-[18px]">
            <Txt className="text-[13px] font-semibold">{t('card.waitlist.formTitle')}</Txt>
            <Txt className="text-[11px] text-text2 mt-1">{t('card.waitlist.formSub')}</Txt>
            <View
              className="flex-row items-center gap-2 mt-3 px-3.5 py-3 rounded-xl"
              style={{ backgroundColor: black(0.3), borderWidth: 1, borderColor: C.lineSoft }}>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder={t('card.waitlist.email.placeholder')}
                accessibilityLabel={t('card.waitlist.email.a11y')}
                placeholderTextColor={C.text3}
                keyboardType="email-address"
                autoCapitalize="none"
                className="flex-1 text-[14px] text-text0 p-0"
              />
              <Txt mono className="text-[11px] text-text3">
                ↵
              </Txt>
            </View>
            <Btn tone="primary" className="mt-3" disabled={!email.trim()} onPress={() => setRegistered(true)}>
              {t('card.waitlist.submit', { position: (WAITLIST.taken + 1).toLocaleString() })}
            </Btn>
            <View className="flex-row justify-between mt-2.5">
              <Txt mono className="text-[10px] text-text3">
                {t('card.waitlist.perk1')}
              </Txt>
              <Txt mono className="text-[10px] text-text3">
                {t('card.waitlist.perk2')}
              </Txt>
            </View>
          </Card>
        )}
      </View>

      {/* Features */}
      <View className="px-5 pt-5">
        <Label className="mb-2.5">{t('card.features.title')}</Label>
        <View className="flex-row flex-wrap -m-1">
          {CARD_FEATURES.map((f, i) => (
            <Enter key={f.title} delay={i * 70} style={{ width: '50%' }}>
              <Card className="m-1 p-3.5 rounded-[14px]">
                <IconTile name={f.icon} color={toneColor(f.tone)} size={30} />
                <Txt className="text-[13px] font-semibold mt-2.5">{f.title}</Txt>
                <Txt className="text-[11px] text-text2 mt-0.5">{f.detail}</Txt>
              </Card>
            </Enter>
          ))}
        </View>
      </View>

      {/* Tiers */}
      <View className="px-5 pt-5">
        <Label className="mb-2.5">{t('card.tiers.title')}</Label>
        <Card className="p-1 rounded-2xl">
          {CARD_TIERS.map((tier, i) => {
            const tone = tier.name === 'Black' ? C.cream : tier.name === 'Gold' ? C.amber : C.text1;
            const swatch = tier.name === 'Black' ? G.cardBlack.slice(1) : tier.name === 'Gold' ? G.chipGold : G.chipSteel;
            return (
              <View key={tier.name} className="flex-row items-center gap-2.5 px-2.5 py-3">
                {i > 0 && <Divider className="absolute left-2.5 right-2.5 top-0" />}
                <LinearGradient
                  colors={gradColors(swatch)}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={{ width: 28, height: 18, borderRadius: 3, borderWidth: 1, borderColor: alpha(tone, 0.25) }}
                />
                <View className="flex-1">
                  <Txt className="text-[13px] font-semibold" style={{ color: tone }}>
                    {tier.name}
                  </Txt>
                  <Txt mono className="text-[10px] text-text3 mt-0.5">
                    {t('card.tiers.stake', { stake: tier.stake })}
                  </Txt>
                </View>
                <Txt mono className="text-[12px] font-semibold" style={{ color: tone }}>
                  {tier.cashback}
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
 *  tilt needs a gesture handler and reads as noise on touch. */

function CardHero() {
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

        <View className="flex-row justify-between items-start">
          <View>
            <Txt className="text-[10px] font-semibold tracking-widest" style={{ color: C.amber }}>
              MOJITO
            </Txt>
            <Txt className="text-[22px] font-extrabold tracking-tightest mt-0.5" style={{ color: C.cream }}>
              Black
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
