import React, { useState, useEffect } from 'react';
import { TextInput, View } from 'react-native';
import { t } from '../../i18n';
import { deriveMlAccount, mlReceiveAddresses, type MlAccount } from '../../keys/mlAccounts';
import { deriveBtcAccount, btcReceiveAddresses, type BtcAccount } from '../../keys/BtcKeyring';
import { CustomPathError, deriveCustomScan } from '../../keys/customPath';
import { createFixtureAddressProbe, type AddressProbe } from '../AddressProbe';
import { C, alpha, black, white } from '../../theme';
import { Btn, Callout, Sheet, Ticker, Txt } from '../../ui';
import { BigBadge, Body, Column, LinkBtn, StepHeader } from '../ui';
import type { Ctx } from '../context';

/** Receiving addresses shown per chain during discovery. */
const ADDRESS_COUNT = 5;

// Network probing is mocked until M2 (AddressProbe contract); the derivation
// itself is real.
const probe: AddressProbe = createFixtureAddressProbe();

type Derived = {
  mlAddresses: string[];
  btcAddresses: string[];
  funded: Set<string>;
};

/**
 * Real account discovery: derive Mintlayer account 0 and the BTC account
 * from the phrase held in onboarding state, list five receiving addresses
 * per chain, and let the AddressProbe seam decide found versus none.
 * Balances and history arrive in M2 behind the same interface.
 */
export function Discovery({ ctx }: { ctx: Ctx }) {
  const [phase, setPhase] = useState<'deriving' | 'done' | 'error'>('deriving');
  const [derived, setDerived] = useState<Derived | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const [path, setPath] = useState("m/84'/0'/3'");
  /** null = the default accounts; otherwise the entered account path. */
  const [scanPath, setScanPath] = useState<string | null>(null);

  useEffect(() => {
    if (phase !== 'deriving') return;
    const words = ctx.seedWords;
    // No phrase in memory (deep re-entry after state loss): a dedicated
    // error phase with real copy instead of the progress label wedging.
    if (!words) {
      setError(t('onboarding.discovery.missingPhrase'));
      setPhase('error');
      return;
    }
    let alive = true;
    void (async () => {
      let mlAddresses: string[];
      let btcAddresses: string[];
      if (scanPath === null) {
        const ml = await deriveMlAccount(words, 'testnet');
        mlAddresses = await mlReceiveAddresses(ml.xpub, 'testnet', ADDRESS_COUNT);
        const btc = await deriveBtcAccount(words, 'testnet');
        btcAddresses = await btcReceiveAddresses(btc, ADDRESS_COUNT);
      } else {
        // The custom scan derives the chain the path names (purpose 44 ML,
        // purpose 84 BTC) and lists its first receiving addresses.
        const scan = await deriveCustomScan(words, scanPath);
        if (scan.chain === 'ml') {
          mlAddresses = await mlReceiveAddresses((scan.account as MlAccount).xpub, scan.network, ADDRESS_COUNT);
          btcAddresses = [];
        } else {
          mlAddresses = [];
          btcAddresses = await btcReceiveAddresses(scan.account as BtcAccount, ADDRESS_COUNT);
        }
      }
      const { funded } = await probe.probe([...mlAddresses, ...btcAddresses]);
      if (!alive) return;
      setDerived({ mlAddresses, btcAddresses, funded: new Set(funded) });
      setPhase('done');
    })().catch((e) => {
      if (!alive) return;
      setError(
        e instanceof CustomPathError
          ? t('onboarding.discovery.pathInvalid')
          : t('common.error.generic'),
      );
      setPhase('error');
    });
    return () => {
      alive = false;
    };
  }, [phase, ctx, scanPath]);

  const found = (derived?.funded.size ?? 0) > 0;

  return (
    <Column>
      <StepHeader onBack={ctx.pop} step={4} />

      {phase === 'error' ? (
        <View className="flex-1 items-center justify-center px-6">
          <BigBadge icon="history" size={72} square />
          <Txt className="text-[15px] font-semibold mt-5 text-center leading-[21px]" style={{ color: C.red }}>
            {error}
          </Txt>
        </View>
      ) : phase === 'deriving' ? (
        <View className="flex-1 items-center justify-center px-6">
          <BigBadge icon="scan" pulsing />
          <Txt className="text-[20px] font-bold tracking-tightest mt-6">{t('onboarding.discovery.deriving')}</Txt>
          <Txt className="text-[13px] text-text2 mt-2 text-center leading-[19px]">
            {t('onboarding.discovery.scanningSub')}
          </Txt>
          <Ticker>
            {/* Locale-neutral technical literal (deliberate): derivation
                paths are identical in every locale, so it stays outside t(). */}
            <Txt mono className="text-[11px] text-text3 mt-[18px]">
              m/44'/1'/0'/0/…
            </Txt>
          </Ticker>
          {error && <Txt className="text-[12px] mt-3" style={{ color: C.red }}>{error}</Txt>}
        </View>
      ) : found ? (
        <Body className="px-[22px] pt-4 pb-7">
          <Txt className="text-[24px] font-bold tracking-tightest">{t('onboarding.discovery.title')}</Txt>
          <Txt className="text-[13px] text-text2 mt-1.5">{t('onboarding.discovery.sub')}</Txt>

          <View className="gap-2.5 mt-[18px]">
            {derived!.mlAddresses.map((address, i) => (
              <View
                key={address}
                className="flex-row items-center gap-3 px-3.5 py-3 rounded-[14px]"
                style={{
                  backgroundColor: derived!.funded.has(address) ? alpha(C.amber, 0.07) : white(0.03),
                  borderWidth: 1,
                  borderColor: derived!.funded.has(address) ? alpha(C.amber, 0.4) : C.lineSoft,
                }}>
                <View className="flex-1">
                  <Txt mono className="text-[10px] text-text3">
                    {t('onboarding.discovery.addressN', { n: i + 1 })}
                  </Txt>
                  <Txt mono className="text-[11.5px] text-text1 mt-1" numberOfLines={1} ellipsizeMode="middle">
                    {address}
                  </Txt>
                </View>
                {derived!.funded.has(address) && (
                  <Txt mono className="text-[10px]" style={{ color: C.amber }}>
                    {t('onboarding.discovery.funded')}
                  </Txt>
                )}
              </View>
            ))}
            {derived!.btcAddresses.map((address, i) => (
              <View
                key={address}
                className="flex-row items-center gap-3 px-3.5 py-3 rounded-[14px]"
                style={{
                  backgroundColor: derived!.funded.has(address) ? alpha(C.amber, 0.07) : white(0.03),
                  borderWidth: 1,
                  borderColor: derived!.funded.has(address) ? alpha(C.amber, 0.4) : C.lineSoft,
                }}>
                <View className="flex-1">
                  {/* Locale-neutral chain prefix (deliberate): BTC is the same
                      ticker in every locale, so it stays outside t(). */}
                  <Txt mono className="text-[10px] text-text3">
                    BTC · {t('onboarding.discovery.addressN', { n: i + 1 })}
                  </Txt>
                  <Txt mono className="text-[11.5px] text-text1 mt-1" numberOfLines={1} ellipsizeMode="middle">
                    {address}
                  </Txt>
                </View>
                {derived!.funded.has(address) && (
                  <Txt mono className="text-[10px]" style={{ color: C.amber }}>
                    {t('onboarding.discovery.funded')}
                  </Txt>
                )}
              </View>
            ))}
          </View>

          <Callout tone={C.teal} className="mt-4">
            {t('onboarding.discovery.fixtureNote')}
          </Callout>

          <Btn tone="primary" className="mt-5" onPress={() => ctx.finish(false)}>
            {t('common.continue')}
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
              {scanPath === null ? t('onboarding.discovery.noneSub') : t('onboarding.discovery.customNone')}
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
            // The entered path really drives the derivation: the scan effect
            // re-runs against it, and an unsupported path lands in the error
            // phase with dedicated copy instead of a silent default scan.
            const entered = path.trim();
            setSheet(false);
            setDerived(null);
            setError(null);
            setScanPath(entered);
            setPhase('deriving');
          }}>
          {t('onboarding.discovery.scanCta')}
        </Btn>
      </Sheet>
    </Column>
  );
}
