import React from 'react';
import { View } from 'react-native';
import { C } from '../theme';
import { t } from '../i18n';
import { Enter } from './motion';
import { Btn } from './Btn';
import type { BtnTone } from './Btn';
import { Screen } from './Screen';
import { SuccessMark } from './SuccessMark';
import { Txt } from './Txt';

export function SuccessScreen({
  title,
  summary,
  description,
  tone = C.green,
  btnTone = 'primary',
  doneLabel = t('common.done'),
  onDone,
  header,
  children,
  secondary,
}: {
  title: string;
  summary?: React.ReactNode;
  description?: string;
  tone?: string;
  btnTone?: BtnTone;
  doneLabel?: string;
  onDone?: () => void;
  /** Rendered above the mark, outside the centred column (e.g. a SheetHeader). */
  header?: React.ReactNode;
  /** Extra detail between the blurb and the primary action. */
  children?: React.ReactNode;
  secondary?: React.ReactNode;
}) {
  return (
    <Screen>
      {header}
      <Enter duration={500} offset={0}>
        <View className="px-6 pt-10 items-center">
          <SuccessMark size={104} color={tone} />
          <Txt className="text-[26px] font-bold tracking-tightest mt-6">{title}</Txt>
          {summary ? (
            <Txt mono className="text-[13px] text-text2 mt-2 text-center">
              {summary}
            </Txt>
          ) : null}
          {description ? (
            <Txt className="text-[12px] text-text2 mt-3 text-center leading-[18px] max-w-[280px]">{description}</Txt>
          ) : null}
          {children}
          <Btn tone={btnTone} className="w-full mt-8" onPress={onDone}>
            {doneLabel}
          </Btn>
          {secondary}
        </View>
      </Enter>
    </Screen>
  );
}

/** Chain initial on its accent colour. One implementation, one fallback. */
