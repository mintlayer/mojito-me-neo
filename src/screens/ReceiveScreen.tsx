import React, { useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import type { Sheet } from './types';
import { Alert, ScrollView, Share, View } from 'react-native';
import { t } from '../i18n';
import { ADDRESSES, CHAIN_GLYPH } from '../data';
import { C, CHAINS } from '../theme';
import { Btn, Callout, Card, FakeQR, Icon, Label, ListRow, Screen, Segmented, SheetHeader, Txt } from '../ui';

export function ReceiveScreen({ onClose }: Sheet) {
  const [chain, setChain] = useState<(typeof CHAIN_KEYS)[number]>('Mintlayer');
  const [copied, setCopied] = useState(false);
  const addr = ADDRESSES[chain];
  const accent = CHAINS[chain];

  // Write first, confirm second: the label must never claim a copy that failed.
  const copy = async () => {
    try {
      await Clipboard.setStringAsync(addr);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      Alert.alert(t('receive.copyError.title'), t('receive.copyError.body'));
    }
  };

  const share = () => {
    Share.share({ message: addr }).catch(() => {
      /* user dismissed the share sheet */
    });
  };

  return (
    <Screen>
      <SheetHeader title={t('receive.title')} onClose={onClose} />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8 }}>
        <Segmented
          options={CHAIN_KEYS}
          value={chain}
          onChange={setChain}
          variant="pill"
          accents={Object.fromEntries(CHAIN_KEYS.map((k) => [k, CHAINS[k]]))}
        />
      </ScrollView>

      {/* QR */}
      <View className="px-6 pt-6">
        <View className="p-6 rounded-[24px] items-center justify-center" style={{ backgroundColor: C.text0 }}>
          <FakeQR seed={addr} />
          <View
            className="absolute w-14 h-14 rounded-[14px] items-center justify-center border-4 border-white"
            style={{ backgroundColor: accent }}>
            <Txt className="text-[18px] font-extrabold" style={{ color: C.ink }}>
              {CHAIN_GLYPH[chain]}
            </Txt>
          </View>
        </View>
      </View>

      {/* Address */}
      <View className="px-6 pt-6">
        <Label className="mb-2 text-center">{t('receive.address.label', { chain })}</Label>
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

      {/* Request amount */}
      <View className="px-6 pt-5">
        <Card className="rounded-[14px]">
          <ListRow
            icon="plus"
            iconColor={C.amber}
            label={t('receive.request')}
            sub={t('receive.requestSub')}
            trailing={<Icon name="chevron_r" size={14} color={C.text2} />}
          />
        </Card>
      </View>

      {/* Warning */}
      <View className="px-6 pt-5">
        <Callout tone={accent} glyph="ⓘ">
          <Txt className="text-[11px] text-text1 leading-[17px]">
            {t('receive.warning.pre')}{' '}
            <Txt className="text-[11px] font-semibold" style={{ color: accent }}>
              {chain}
            </Txt>{' '}
            {t('receive.warning.post')}
          </Txt>
        </Callout>
      </View>
    </Screen>
  );
}

/* ══ Settings ═══════════════════════════════════════════════ */

const CHAIN_KEYS = Object.keys(ADDRESSES) as (keyof typeof ADDRESSES)[];
