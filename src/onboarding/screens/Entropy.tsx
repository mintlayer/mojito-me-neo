import React, { useState, useRef } from 'react';
import { PanResponder, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { t } from '../../i18n';
import { C, alpha, black } from '../../theme';
import { Btn, Callout, Icon, ProgressBar, Txt } from '../../ui';
import { Body, Column, StepHeader } from '../ui';
import type { Ctx } from '../context';

const BITS_NEEDED = 256;

/**
 * Deliberately pessimistic. Successive touch points on a drawn line are highly
 * correlated, so the true entropy per sample is far below the number of bits
 * the coordinates occupy. Two bits per accepted sample keeps the meter honest;
 * a real implementation should measure min-entropy over the input distribution
 * rather than assume a constant.
 */

const BITS_PER_SAMPLE = 2;

/** Cheap FNV-1a over the pool, shown so the user sees their input mattered. */

const fingerprint = (xs: number[]) => {
  let h = 0x811c9dc5;
  for (const v of xs) {
    h ^= v;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
};

function useDrawnEntropy() {
  const pool = useRef<number[]>([]);
  const last = useRef<{ x: number; y: number; t: number } | null>(null);
  const strokes = useRef<string[]>([]);
  const [paths, setPaths] = useState<string[]>([]);
  const [bits, setBits] = useState(0);

  const reset = () => {
    pool.current = [];
    last.current = null;
    strokes.current = [];
    setPaths([]);
    setBits(0);
  };

  // useRef(expr) still evaluates expr on every render and discards the result,
  // so build the responder lazily: this hook re-renders on every touch sample.
  const responderRef = useRef<ReturnType<typeof PanResponder.create> | null>(null);
  if (!responderRef.current) {
    responderRef.current = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        const { locationX: x, locationY: y } = e.nativeEvent;
        strokes.current = [...strokes.current, `M${x.toFixed(1)},${y.toFixed(1)}`];
        last.current = { x, y, t: Date.now() };
        setPaths([...strokes.current]);
      },
      onPanResponderMove: (e) => {
        const { locationX: x, locationY: y } = e.nativeEvent;
        const prev = last.current;
        if (!prev) return;
        const dx = x - prev.x;
        const dy = y - prev.y;
        // Ignore jitter, so a resting finger can't inflate the meter.
        if (dx * dx + dy * dy < 9) return;

        const t = Date.now();
        // Low-order position bits plus inter-sample timing, the parts a
        // human can't reproduce. The high bits are just "where on screen".
        pool.current.push((Math.round(x) & 7) ^ ((Math.round(y) & 7) << 3) ^ ((t - prev.t) & 15));
        last.current = { x, y, t };

        const i = strokes.current.length - 1;
        strokes.current[i] += ` L${x.toFixed(1)},${y.toFixed(1)}`;
        setPaths([...strokes.current]);
        setBits(pool.current.length * BITS_PER_SAMPLE);
      },
    });
  }
  const responder = responderRef.current;

  return { responder, paths, bits, reset, pool };
}

export function Entropy({ ctx }: { ctx: Ctx }) {
  const { responder, paths, bits, reset, pool } = useDrawnEntropy();
  const pct = Math.min(100, (bits / BITS_NEEDED) * 100);
  const done = bits >= BITS_NEEDED;

  return (
    <Column>
      <StepHeader onBack={ctx.pop} />
      <Body className="px-6 pt-5 pb-7">
        <Txt className="text-[24px] font-bold tracking-tightest">{t('onboarding.entropy.title')}</Txt>
        <Txt className="text-[13px] text-text2 mt-2 leading-[20px]">
          {t('onboarding.entropy.sub')}
        </Txt>

        <View
          {...responder.panHandlers}
          className="mt-4 rounded-[18px] overflow-hidden"
          style={{ height: 300, backgroundColor: black(0.3), borderWidth: 1, borderColor: done ? alpha(C.green, 0.5) : C.line }}>
          <Svg width="100%" height="100%">
            {paths.map((d, i) => (
              <Path key={i} d={d} stroke={done ? C.green : C.amber} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
            ))}
          </Svg>
          {paths.length === 0 && (
            <View className="absolute inset-0 items-center justify-center" pointerEvents="none">
              <Icon name="plus" size={22} color={C.text3} />
              <Txt className="text-[12px] text-text3 mt-2">{t('onboarding.entropy.drawHere')}</Txt>
            </View>
          )}
        </View>

        <View className="flex-row justify-between items-center mt-3.5 mb-2">
          <Txt mono className="text-[11px] text-text3">
            {t('onboarding.entropy.bits', { bits: Math.min(bits, BITS_NEEDED), total: BITS_NEEDED })}
          </Txt>
          {done && (
            <Txt mono className="text-[11px]" style={{ color: C.green }}>
              ✓ {fingerprint(pool.current)}
            </Txt>
          )}
        </View>
        <ProgressBar pct={pct} color={done ? C.green : C.amber} />

        <Callout tone={C.teal} icon="shield" className="mt-4">
          {t('onboarding.entropy.callout')}
        </Callout>

        <View className="flex-row gap-2.5 mt-4">
          <View className="flex-1">
            <Btn onPress={reset}>{t('onboarding.entropy.clear')}</Btn>
          </View>
          <View className="flex-1">
            <Btn tone="primary" disabled={!done} onPress={ctx.pop}>
              {t('onboarding.entropy.cta')}
            </Btn>
          </View>
        </View>
      </Body>
    </Column>
  );
}
