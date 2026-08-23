import React, { useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import type { Sheet } from './types';
import { Alert, ScrollView, Share, View } from 'react-native';
import { ADDRESSES, CHAIN_GLYPH } from '../data';
import { C, CHAINS } from '../theme';
import { Btn, Callout, Card, FakeQR, Icon, Label, ListRow, Screen, Segmented, SheetHeader, Txt } from '../ui';

export function ReceiveScreen({ onClose }: Sheet) {
  const [chain, setChain] = useState<(typeof CHAIN_KEYS)[number]>('Mintlayer');
  const [copied, setCopied] = useState(false);
  const addr = ADDRESSES[chain];
  const accent = CHAINS[chain as keyof typeof CHAINS];

  // Write first, confirm second: the label must never claim a copy that failed.
  const copy = async () => {
    try {
      await Clipboard.setStringAsync(addr);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      Alert.alert('Could not copy', 'Copy the address manually — it is shown in full above.');
    }
  };

  const share = () => {
    Share.share({ message: addr }).catch(() => {
      /* user dismissed the share sheet */
    });
  };

  return (
    <Screen>
      <SheetHeader title="Receive" onClose={onClose} />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8 }}>
        <Segmented
          options={CHAIN_KEYS}
          value={chain}
          onChange={setChain}
          variant="pill"
          accents={Object.fromEntries(CHAIN_KEYS.map((k) => [k, CHAINS[k as keyof typeof CHAINS]]))}
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
              {CHAIN_GLYPH[chain as keyof typeof CHAIN_GLYPH]}
            </Txt>
          </View>
        </View>
      </View>

      {/* Address */}
      <View className="px-6 pt-6">
        <Label className="mb-2 text-center">{`${chain} address`}</Label>
        <Card className="px-4 py-3.5 rounded-[14px]">
          <Txt mono className="text-[12px]">
            {addr}
          </Txt>
        </Card>
        <View className="flex-row gap-2 mt-2.5">
          <View className="flex-1">
            <Btn tone={copied ? 'green' : 'default'} onPress={copy}>
              {copied ? '✓ Copied' : 'Copy'}
            </Btn>
          </View>
          <View className="flex-1">
            <Btn onPress={share}>Share</Btn>
          </View>
        </View>
      </View>

      {/* Request amount */}
      <View className="px-6 pt-5">
        <Card className="rounded-[14px]">
          <ListRow
            icon="plus"
            iconColor={C.amber}
            label="Request specific amount"
            sub="Encode the amount in your QR code"
            trailing={<Icon name="chevron_r" size={14} color={C.text2} />}
          />
        </Card>
      </View>

      {/* Warning */}
      <View className="px-6 pt-5">
        <Callout tone={accent} glyph="ⓘ">
          <Txt className="text-[11px] text-text1 leading-[17px]">
            Send only{' '}
            <Txt className="text-[11px] font-semibold" style={{ color: accent }}>
              {chain}
            </Txt>{' '}
            assets to this address. Sending other assets may result in permanent loss.
          </Txt>
        </Callout>
      </View>
    </Screen>
  );
}

/* ══ Settings ═══════════════════════════════════════════════ */

const CHAIN_KEYS = Object.keys(ADDRESSES) as (keyof typeof ADDRESSES)[];
