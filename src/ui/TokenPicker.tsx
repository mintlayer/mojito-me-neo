import React from 'react';
import { PickerSheet } from './PickerSheet';
import { TokenIcon } from './TokenIcon';

export function TokenPicker({
  open,
  onClose,
  symbols,
  value,
  onSelect,
  balances,
}: {
  open: boolean;
  onClose: () => void;
  symbols: readonly string[];
  value?: string;
  onSelect: (s: string) => void;
  balances?: Record<string, string>;
}) {
  return (
    <PickerSheet
      open={open}
      onClose={onClose}
      title="Select asset"
      options={symbols}
      value={value}
      onSelect={onSelect}
      renderLeading={(s) => <TokenIcon symbol={s} size={34} />}
      subtitleFor={(s) => balances?.[s]}
    />
  );
}

/* ── Chrome ─────────────────────────────────────────────────── */

/** Radial wash behind the whole app — the `.app` background in styles.css. */
