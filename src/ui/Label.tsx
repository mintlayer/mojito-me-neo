import React from 'react';
import { Txt } from './Txt';

export function Label({ children, className = '' }: { children: string; className?: string }) {
  return <Txt className={`text-[11px] text-text3 tracking-label ${className}`}>{children.toUpperCase()}</Txt>;
}

/** Stacked mono key/value cell — swap stats, bridge fee grid. */
