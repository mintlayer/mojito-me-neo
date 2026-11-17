import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { t } from '../../i18n';
import { BIP39_WORDS } from '../../keys/bip39Words';
import { C, alpha, white } from '../../theme';
import { Btn, Icon, Txt } from '../../ui';
import { Body, Column, StepHeader, WordChip, useSeedProtection } from '../ui';
import type { Ctx } from '../context';

/**
 * Backup quiz over the real generated or imported phrase, with distractors
 * drawn from the full 2048-word list. A wrong pick re-shuffles on the next
 * render via the wrong-chip flash; the answer key stays in one lazy state.
 */
export function Verify({ ctx }: { ctx: Ctx }) {
  // The chips and filled slots expose 3 of the words, so protect it too.
  useSeedProtection();
  const words = ctx.seedWords ?? [];

  // Lazy useState, not useMemo: React treats useMemo as a performance hint it
  // may discard, which would reshuffle the answer key mid-quiz. useState's
  // initialiser is guaranteed to run exactly once.
  const [quiz] = useState(() => {
    const shuffle = <T,>(xs: T[]) => [...xs].sort(() => Math.random() - 0.5);
    const idx = shuffle([...Array(words.length).keys()])
      .slice(0, 3)
      .sort((a, b) => a - b);
    const distractors = shuffle(BIP39_WORDS.filter((w) => !words.includes(w))).slice(0, 6);
    return { idx, chips: shuffle([...idx.map((i) => words[i]), ...distractors]) };
  });

  const [fills, setFills] = useState<Record<number, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [wrongChip, setWrongChip] = useState<string | null>(null);

  const active = quiz.idx.find((i) => fills[i] === undefined);
  const done = active === undefined && words.length > 0;

  const pick = (w: string) => {
    if (done || active === undefined || Object.values(fills).includes(w)) return;
    if (w === words[active]) {
      setFills((f) => ({ ...f, [active]: w }));
      setErr(null);
      return;
    }
    setErr(t('onboarding.verify.wrong', { position: active + 1 }));
    setWrongChip(w);
    setTimeout(() => setWrongChip(null), 500);
  };

  return (
    <Column>
      <StepHeader onBack={ctx.pop} step={4} />
      <Body className="px-[22px] pt-4 pb-7">
        <Txt className="text-[24px] font-bold tracking-tightest">{t('onboarding.verify.title')}</Txt>
        <Txt className="text-[13px] text-text2 mt-1.5">{t('onboarding.verify.sub')}</Txt>

        <View className="gap-2.5 mt-5">
          {quiz.idx.map((i) => {
            const filled = fills[i] !== undefined;
            const isActive = i === active;
            return (
              <View
                key={i}
                className="flex-row items-center gap-2.5 px-3.5 py-3 rounded-xl"
                accessibilityLabel={t('onboarding.verify.pickN', { n: i + 1 })}
                style={{
                  backgroundColor: white(0.03),
                  borderWidth: 1,
                  borderColor: filled ? alpha(C.green, 0.4) : isActive ? (err ? C.red : C.amber) : C.lineSoft,
                }}>
                <Txt mono className="text-[11px] text-text3 min-w-[52px]">
                  {t('onboarding.verify.word', { n: i + 1 })}
                </Txt>
                <Txt mono className="flex-1 text-[14px] font-medium" style={{ color: filled ? C.text0 : C.text3 }}>
                  {fills[i] ?? '· · ·'}
                </Txt>
                {filled && <Icon name="check" size={14} color={C.green} stroke={2.5} />}
                {filled && (
                  <Pressable
                    onPress={() =>
                      setFills((f) => {
                        const n = { ...f };
                        delete n[i];
                        return n;
                      })
                    }
                    accessibilityRole="button"
                    accessibilityLabel={t('onboarding.verify.clearWord', { position: i + 1 })}>
                    <Icon name="close" size={12} color={C.text3} />
                  </Pressable>
                )}
              </View>
            );
          })}
        </View>

        <Txt className="text-[12px] text-center mt-3 h-4" style={{ color: C.red }}>
          {err ?? ''}
        </Txt>

        <View className="flex-row flex-wrap gap-[7px] justify-center mt-2.5">
          {quiz.chips.map((w) => (
            <WordChip key={w} word={w} used={Object.values(fills).includes(w)} wrong={wrongChip === w} onPress={() => pick(w)} />
          ))}
        </View>

        <Btn tone="primary" className="mt-6" disabled={!done} onPress={() => ctx.finish(false)}>
          {done ? t('onboarding.verify.doneCta') : t('common.continue')}
        </Btn>
      </Body>
    </Column>
  );
}

/* ══ 3b · Import ════════════════════════════════════════════ */
