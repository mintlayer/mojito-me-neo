import React from 'react';
import { C, white } from '../../theme';
import { Txt } from '../../ui';
import { View } from 'react-native';

export function Striped({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <View
      className={`rounded-[14px] items-center justify-center p-5 min-h-[140px] ${className}`}
      style={{ borderWidth: 1, borderStyle: 'dashed', borderColor: C.line, backgroundColor: white(0.02) }}>
      <Txt mono className="text-[11px] text-text3 text-center">
        {children}
      </Txt>
    </View>
  );
}

/* ── PIN ────────────────────────────────────────────────────── */
