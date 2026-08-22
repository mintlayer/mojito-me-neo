import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { ASKS, BIDS, MARKET, TIMEFRAMES } from '../data';
import { C, G, alpha, black, white } from '../theme';
import { Btn, Candles, Card, Chip, Enter, Field, IconBtn, KVRow, Label, LivePill, PctButtons, Screen, Segmented, Txt } from '../ui';

export function DexScreen() {
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [book, setBook] = useState<'book' | 'trades' | 'depth'>('book');
  const [orderType, setOrderType] = useState<'Limit' | 'Market' | 'Stop'>('Limit');
  const [tf, setTf] = useState('1h');
  const [amount, setAmount] = useState('250');

  const maxAsk = Math.max(...ASKS.map((r) => r.t));
  const maxBid = Math.max(...BIDS.map((r) => r.t));
  const total = (parseFloat(amount || '0') * MARKET.price).toFixed(4);

  return (
    <Screen>
      <View className="px-5 flex-row items-center justify-between">
        <View>
          <View className="flex-row items-center gap-2">
            <Txt className="text-[18px] font-bold">{MARKET.pair}</Txt>
            <Chip tone={C.teal} dot={false}>
              MINTLAYER DEX
            </Chip>
          </View>
          <Txt mono className="text-[11px] text-text2 mt-0.5">
            {MARKET.volume}
          </Txt>
        </View>
        <IconBtn name="chart" label="Full chart" />
      </View>

      {/* Price + candles */}
      <View className="px-5 pt-5">
        <Card grad={G.raisedTeal} className="p-4">
          <View className="flex-row justify-between items-end">
            <View>
              <Label>Last price</Label>
              <View className="flex-row items-baseline gap-2 mt-0.5">
                <Txt mono className="text-[28px] font-bold">
                  ${MARKET.last}
                </Txt>
                <LivePill value={MARKET.change} />
              </View>
              <Txt mono className="text-[11px] text-text2 mt-0.5">
                {MARKET.btc}
              </Txt>
            </View>
            <View className="items-end">
              <Txt className="text-[10px] text-text3">24H HIGH</Txt>
              <Txt mono className="text-[12px]" style={{ color: C.green }}>
                {MARKET.high}
              </Txt>
              <Txt className="text-[10px] text-text3 mt-1">24H LOW</Txt>
              <Txt mono className="text-[12px]" style={{ color: C.red }}>
                {MARKET.low}
              </Txt>
            </View>
          </View>

          <View className="mt-3">
            <Candles />
          </View>
          <Segmented options={TIMEFRAMES} value={tf} onChange={setTf} variant="ghost" accent={C.teal} className="mt-2" />
        </Card>
      </View>

      <View className="px-5 pt-4">
        <Segmented
          options={['book', 'trades', 'depth'] as const}
          value={book}
          onChange={setBook}
          variant="tabs"
          labels={{ book: 'Order book', trades: 'Trades', depth: 'Depth' }}
        />
      </View>

      {/* Order book */}
      <View className="pt-3">
        <View className="flex-row px-4 py-1">
          <Txt className="flex-1 text-[10px] text-text3 tracking-label">PRICE (USDT)</Txt>
          <Txt className="flex-1 text-[10px] text-text3 tracking-label text-center">SIZE (ML)</Txt>
          <Txt className="flex-1 text-[10px] text-text3 tracking-label text-right">TOTAL</Txt>
        </View>

        {ASKS.map((r, i) => (
          <BookRow key={`a${i}`} row={r} max={maxAsk} tone={C.red} delay={i * 30} />
        ))}

        <View
          className="mx-4 my-2 px-3 py-2 rounded-[10px] flex-row justify-between items-center"
          style={{ backgroundColor: white(0.04), borderWidth: 1, borderColor: C.lineSoft }}>
          <Txt mono className="text-[12px] text-text2">
            Spread
          </Txt>
          <Txt mono className="text-[12px] font-semibold">
            0.0006 · 0.17%
          </Txt>
          <Txt mono className="text-[12px]" style={{ color: C.teal }}>
            ↕
          </Txt>
        </View>

        {BIDS.map((r, i) => (
          <BookRow key={`b${i}`} row={r} max={maxBid} tone={C.green} delay={200 + i * 30} />
        ))}
      </View>

      {/* Order ticket */}
      <View className="px-5 pt-5">
        <Card className="p-4">
          <View className="flex-row gap-1 p-[3px] rounded-[10px] mb-3.5" style={{ backgroundColor: black(0.3) }}>
            {(['buy', 'sell'] as const).map((s) => {
              const on = side === s;
              const c = s === 'buy' ? C.green : C.red;
              return (
                <Pressable
                  key={s}
                  onPress={() => setSide(s)}
                  className="flex-1 py-2 rounded-lg items-center"
                  style={{
                    backgroundColor: on ? alpha(c, 0.18) : 'transparent',
                    borderWidth: 1,
                    borderColor: on ? alpha(c, 0.4) : 'transparent',
                  }}>
                  <Txt className="text-[13px] font-semibold capitalize" style={{ color: on ? c : C.text2 }}>
                    {s}
                  </Txt>
                </Pressable>
              );
            })}
          </View>

          <Segmented options={['Limit', 'Market', 'Stop'] as const} value={orderType} onChange={setOrderType} variant="tabs" className="mb-3.5" />

          <View className="gap-2">
            <Field label="Price" value={MARKET.price.toFixed(4)} unit="USDT" />
            <Field label="Amount" value={amount} unit="ML" onChangeText={setAmount} />
            <PctButtons onPick={(f) => setAmount(String(Math.round(12480.5 * f)))} />
            <Field label="Total" value={total} unit="USDT" tone={C.text1} />
          </View>

          <Btn tone={side === 'buy' ? 'green' : 'red'} className="mt-3.5">
            {side === 'buy' ? 'Place buy order' : 'Place sell order'} · {amount} ML
          </Btn>

          <View className="mt-3 gap-1">
            <KVRow k="Network fee" v="0.00012 ML · ~$0.00" />
            <KVRow k="Onchain settlement" v="~12s" tone={C.teal} />
          </View>
        </Card>
      </View>
    </Screen>
  );
}

/** Order-book line with a depth bar filling from the right. */

function BookRow({ row, max, tone, delay }: { row: { p: number; s: number; t: number }; max: number; tone: string; delay: number }) {
  return (
    <Enter delay={delay} duration={400} offset={6}>
      <View className="flex-row items-center px-4 py-1.5">
        <View className="absolute right-0 top-0 bottom-0" style={{ width: `${(row.t / max) * 100}%`, backgroundColor: alpha(tone, 0.18) }} />
        <Txt mono className="flex-1 text-[12px]" style={{ color: tone }}>
          {row.p.toFixed(4)}
        </Txt>
        <Txt mono className="flex-1 text-[12px] text-text1 text-center">
          {row.s.toLocaleString()}
        </Txt>
        <Txt mono className="flex-1 text-[12px] text-text2 text-right">
          {row.t.toLocaleString()}
        </Txt>
      </View>
    </Enter>
  );
}
