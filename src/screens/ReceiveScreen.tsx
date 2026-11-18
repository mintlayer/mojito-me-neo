import React, { useEffect, useRef, useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import QRCodeSvg from 'react-native-qrcode-svg';
import type { Sheet } from './types';
import { Alert, ScrollView, Share, View } from 'react-native';
import { t, type I18nKey } from '../i18n';
import { useData, useDataState } from '../data/providers/context';
import { C, CHAINS, type ChainName } from '../theme';
import { Btn, Callout, Card, Label, Screen, Segmented, SheetHeader, Txt } from '../ui';

/** Chain segment labels from i18n; unknown chains fall back to the raw key. */
const CHAIN_LABELS: Partial<Record<ChainName, I18nKey>> = {
  Mintlayer: 'receive.chain.ml',
  Bitcoin: 'receive.chain.btc',
};

export function ReceiveScreen({ onClose }: Sheet) {
  const addresses = useDataState((d) => d.getAddresses(), 0);
  const chainGlyphs = useData((d) => d.getChainGlyphs());
  const [chain, setChain] = useState<ChainName>('Mintlayer');
  const [copied, setCopied] = useState(false);
  /** Pending copied-flag reset; cancelled on unmount so the label timer
   *  never fires against a gone screen. */
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Pending clipboard wipe (M3 spec security note): the address is
   *  scrubbed 60 seconds after a copy so a leftover value cannot be pasted
   *  elsewhere. The wipe has no state dependency, so it survives unmount
   *  on purpose: cancelling it on sheet close would silently drop the
   *  wipe on the common copy-then-close flow. A re-copy resets the timer. */
  const wipeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
    },
    [],
  );
  const addr = addresses.data?.[chain] ?? '';
  const accent = CHAINS[chain];
  const label = (name: ChainName): string => {
    const key = CHAIN_LABELS[name];
    return key ? t(key) : name;
  };

  // Write first, confirm second: the label must never claim a copy that failed.
  const copy = async () => {
    try {
      await Clipboard.setStringAsync(addr);
      setCopied(true);
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 1500);
      if (wipeTimer.current !== null) clearTimeout(wipeTimer.current);
      wipeTimer.current = setTimeout(() => {
        wipeTimer.current = null;
        // The installed expo-clipboard (57) ships no clear API, so the wipe
        // is the supported equivalent: an empty string write leaves nothing
        // readable to paste.
        Clipboard.setStringAsync('').catch(() => {
          // A failed wipe (rare OS refusal) must not surface as an error
          // dialog after a successful copy.
        });
      }, 60_000);
    } catch {
      Alert.alert(t('receive.copyError.title'), t('receive.copyError.body'));
    }
  };

  const share = () => {
    Share.share({ message: addr }).catch(() => {
      /* user dismissed the share sheet */
    });
  };

  if (!chainGlyphs) return <Screen />;
  const chainKeys = addresses.data ? (Object.keys(addresses.data) as ChainName[]) : ['Mintlayer', 'Bitcoin'] as ChainName[];

  // Not-ready window: while getAddresses() is in flight (vault open + gap
  // scan in real mode) there is no address yet. The QR, address card, and
  // copy/share actions are all gated on addressReady so an empty string
  // never reaches the QR encoder (qrcode.create('') throws) and a button
  // never claims a copy it did not make.
  const addressReady = addresses.data !== null && addr !== '';
  const addressMissing = addresses.error !== null || (addresses.data !== null && addr === '');

  return (
    <Screen>
      <SheetHeader title={t('receive.title')} onClose={onClose} />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8 }}>
        <Segmented
          options={chainKeys}
          value={chain}
          onChange={setChain}
          variant="pill"
          accents={Object.fromEntries(chainKeys.map((k) => [k, CHAINS[k]]))}
          labels={Object.fromEntries(chainKeys.map((k) => [k, label(k)]))}
        />
      </ScrollView>

      {addressMissing ? (
        // Derivation unavailable (locked vault, missing keys): honest state
        // instead of a QR for an address that does not exist yet.
        <View className="px-6 pt-8">
          <Callout tone={C.amber} glyph="!">
            <Txt className="text-[11.5px] text-text1 leading-[17px]">{t('receive.address.none')}</Txt>
          </Callout>
        </View>
      ) : !addressReady ? (
        // Derivation still in flight: syncing state until the address
        // exists, never a QR for an empty string.
        <View className="px-6 pt-8">
          <Callout tone={accent} glyph="ⓘ">
            <Txt className="text-[11.5px] text-text1 leading-[17px]">{t('common.syncing')}</Txt>
          </Callout>
        </View>
      ) : (
        <>
          {/* QR */}
          <View className="px-6 pt-6">
            <View className="p-6 rounded-[24px] items-center justify-center" style={{ backgroundColor: C.text0 }}>
              {/* The funds-transfer path renders a scannable QR in both
                  modes (M3 retired the decorative grid): the demo flow must
                  scan exactly like the real one. The card padding is the
                  quiet zone; ECC level H keeps the code decodable under the
                  centered chain badge. */}
              <QRCodeSvg value={addr} size={240} color={C.ink} backgroundColor="transparent" ecl="H" quietZone={0} />
              <View
                className="absolute w-14 h-14 rounded-[14px] items-center justify-center border-4 border-white"
                style={{ backgroundColor: accent }}>
                <Txt className="text-[18px] font-extrabold" style={{ color: C.ink }}>
                  {chainGlyphs[chain]}
                </Txt>
              </View>
            </View>
          </View>

          {/* Address */}
          <View className="px-6 pt-6">
            <Label className="mb-2 text-center">{t('receive.address.label', { chain: label(chain) })}</Label>
            <Card className="px-4 py-3.5 rounded-[14px]">
              <Txt mono className="text-[12px]">
                {addr}
              </Txt>
            </Card>
            <View className="flex-row gap-2 mt-2.5">
              <View className="flex-1">
                <Btn tone={copied ? 'green' : 'default'} onPress={copy}>
                  {copied ? t('common.copied') : t('common.copy')}
                </Btn>
              </View>
              <View className="flex-1">
                <Btn onPress={share}>{t('common.share')}</Btn>
              </View>
            </View>
          </View>

          {/* Request-specific amounts land with the payment-request flow;
              the row was a dead end, so it stays hidden until it works. */}

          {/* Warning */}
          <View className="px-6 pt-5">
            <Callout tone={accent} glyph="ⓘ">
              <Txt className="text-[11px] text-text1 leading-[17px]">
                {t('receive.warning', { chain: label(chain) })}
              </Txt>
            </Callout>
            <Txt className="text-[11px] text-text2 mt-2 leading-[16px]">{t('receive.freshNote')}</Txt>
          </View>
        </>
      )}
    </Screen>
  );
}
