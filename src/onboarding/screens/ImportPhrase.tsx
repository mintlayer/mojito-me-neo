import React, { useEffect, useState, useRef } from 'react';
import { TextInput, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { t } from '../../i18n';
import { PHRASE_LENGTHS } from '../data';
import { validateMnemonic } from '../../keys/bip39';
import { BIP39_WORDS } from '../../keys/bip39Words';
import { C, alpha } from '../../theme';
import { Btn, Callout, hairlineTop, Txt } from '../../ui';
import { Body, Column, StepHeader, WordChip, WordSlot, useSeedProtection } from '../ui';
import type { Ctx } from '../context';

const EMPTY_PHRASE: string[] = Array(24).fill('');

const WORDLIST: readonly string[] = BIP39_WORDS;
const WORD_SET = new Set(WORDLIST);

/**
 * Import with real BIP39 validation: per-word membership over the complete
 * 2048-word list and the actual entropy checksum. A pasted phrase is scrubbed
 * from the clipboard the moment it lands. A validated phrase hands straight
 * over to onboarding state; the vault seal happens at finish.
 */
export function ImportPhrase({ ctx }: { ctx: Ctx }) {
  // Whatever is typed or pasted here is the user's real wallet: same
  // FLAG_SECURE/screenshot-alert guard as the Seed and Verify screens.
  useSeedProtection();
  const [len, setLen] = useState(24);
  const [words, setWords] = useState<string[]>(EMPTY_PHRASE);
  const [active, setActive] = useState(0);
  const [sumState, setSumState] = useState<'pending' | 'ok' | 'bad'>('pending');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const refs = useRef<(TextInput | null)[]>([]);

  const slice = words.slice(0, len);
  const filled = slice.filter(Boolean).length;
  const complete = filled === len && slice.every((w) => WORD_SET.has(w));

  // Real checksum per keystroke batch: cheap (no PBKDF2), exact.
  useEffect(() => {
    const current = words.slice(0, len);
    if (!(current.length > 0 && current.every((w) => WORD_SET.has(w)))) {
      setSumState('pending');
      return;
    }
    let alive = true;
    validateMnemonic(current)
      .then((ok) => alive && setSumState(ok ? 'ok' : 'bad'))
      .catch(() => alive && setSumState('bad'));
    return () => {
      alive = false;
    };
  }, [words, len]);

  const sumOK = complete && sumState === 'ok';

  const cur = words[active] || '';
  const suggestions = cur.length >= 1 ? WORDLIST.filter((w) => w.startsWith(cur) && w !== cur).slice(0, 8) : [];

  const applyPaste = (text: string) => {
    const parts = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const L = PHRASE_LENGTHS.includes(parts.length) ? parts.length : 24;
    setLen(L);
    setWords(EMPTY_PHRASE.map((_, i) => parts[i] ?? ''));
    setActive(Math.min(parts.length, L - 1));
    // A pasted phrase must not linger in the clipboard, where keyboards and
    // clipboard managers can read it, so scrub it as soon as the words land.
    Clipboard.setStringAsync('').catch(() => undefined);
  };

  const setWord = (i: number, raw: string) => {
    // Whitespace in a single slot can only have arrived by paste.
    if (/\s/.test(raw) && raw.trim().split(/\s+/).length > 1) return applyPaste(raw);
    const v = raw.toLowerCase().replace(/[^a-z]/g, '');
    setWords((ws) => ws.map((w, j) => (j === i ? v : w)));
  };

  const focusNext = (from: number) => {
    const gap = words.findIndex((w, j) => j > from && j < len && !w);
    const target = gap === -1 ? Math.min(from + 1, len - 1) : gap;
    setActive(target);
    refs.current[target]?.focus();
  };

  const badWords = slice.some((w, i) => w && i !== active && !WORD_SET.has(w));

  /** Specific rejection copy: wrong count, unknown word, or bad checksum. */
  const submit = () => {
    if (!complete || sumState !== 'ok') return;
    const check = validateMnemonic(slice);
    void check
      .then((ok) => {
        if (!ok) {
          setSubmitError(t('onboarding.import.sumError'));
          return;
        }
        setSubmitError(null);
        ctx.setSeedWords(slice);
        ctx.push('discovery');
      })
      .catch((e: { kind?: string; message?: string }) => {
        if (e.kind === 'length') {
          setSubmitError(t('onboarding.import.wrongcount', { counts: PHRASE_LENGTHS.join(', ') }));
        } else if (e.kind === 'word') {
          const word = (e.message ?? '').split(': ')[1] ?? '';
          setSubmitError(t('onboarding.import.badword', { word }));
        } else {
          setSubmitError(t('onboarding.import.sumError'));
        }
      });
  };

  return (
    <Column>
      <StepHeader onBack={ctx.pop} step={3} />
      <Body className="px-5 pt-4 pb-2.5">
        <Txt className="text-[24px] font-bold tracking-tightest">{t('onboarding.import.title')}</Txt>
        <Txt className="text-[13px] text-text2 mt-1.5 leading-[19px]">
          {t('onboarding.import.sub')}
        </Txt>

        <View className="flex-row flex-wrap -m-[3px] mt-4">
          {slice.map((w, i) => {
            const isActive = i === active;
            const bad = !!w && (isActive ? !WORDLIST.some((b) => b.startsWith(w)) : !WORD_SET.has(w));
            return (
              <View key={i} style={{ width: '33.333%', padding: 3 }}>
                <WordSlot
                  ref={(el) => {
                    refs.current[i] = el;
                  }}
                  index={i}
                  value={w}
                  active={isActive}
                  bad={bad}
                  // Committed words are masked; only the word being edited is
                  // legible, so the full phrase is never on screen at once.
                  masked={!isActive}
                  onChangeText={(t) => setWord(i, t)}
                  onFocus={() => setActive(i)}
                  onSubmit={() => w && focusNext(i)}
                />
              </View>
            );
          })}
        </View>

        <View className="flex-row justify-between mt-3">
          <Txt mono className="text-[11px] text-text3">
            {t('onboarding.import.progress', { filled, len })}
          </Txt>
          <Txt mono className="text-[11px]" style={{ color: !complete ? C.text3 : sumOK ? C.green : C.red }}>
            {!complete
              ? t('onboarding.import.checksumPending')
              : sumOK
                ? t('onboarding.import.checksumOk')
                : t('onboarding.import.checksumBad')}
          </Txt>
        </View>

        {complete && sumState === 'bad' && (
          <Callout tone={C.red} className="mt-2.5">
            {t('onboarding.import.sumError')}
          </Callout>
        )}
        {badWords && (
          <Txt className="text-[11.5px] mt-2" style={{ color: C.red }}>
            {t('onboarding.import.badWords')}
          </Txt>
        )}
        {submitError && (
          <Txt className="text-[11.5px] mt-2" style={{ color: C.red }}>
            {submitError}
          </Txt>
        )}
      </Body>

      {/* Suggestion rail pinned above the keyboard. */}
      <View className="px-5 pt-2" style={[hairlineTop, { backgroundColor: alpha(C.bg0, 0.7) }]}>
        <View className="flex-row flex-wrap gap-1.5 min-h-[34px] mb-2 items-center">
          {suggestions.length > 0 ? (
            suggestions.map((w) => (
              <WordChip
                key={w}
                word={w}
                onPress={() => {
                  setWords((ws) => ws.map((x, j) => (j === active ? w : x)));
                  focusNext(active);
                }}
              />
            ))
          ) : (
            <Txt mono className="text-[10px] text-text3">
              {cur ? t('onboarding.import.noMatch') : t('onboarding.import.suggestHint')}
            </Txt>
          )}
        </View>
        <Btn tone="primary" disabled={!sumOK} onPress={submit}>
          {t('common.continue')}
        </Btn>
      </View>
    </Column>
  );
}

/* ══ 4b · Account discovery ═════════════════════════════════ */
