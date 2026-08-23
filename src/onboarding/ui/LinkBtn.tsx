import React from 'react';
import { Pressable } from 'react-native';
import { Txt } from '../../ui';

export function LinkBtn({ children, onPress, className = '' }: { children: React.ReactNode; onPress?: () => void; className?: string }) {
  return (
    <Pressable onPress={onPress} className={`self-center ${className}`}>
      <Txt className="text-[12px] font-medium text-text2 underline">{children}</Txt>
    </Pressable>
  );
}

/** Dashed "drawing board" placeholder for unfinished screens. */
