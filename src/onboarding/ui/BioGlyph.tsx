import React from 'react';
import type { Bio } from './types';
import { Icon } from '../../ui';

export const BioGlyph = ({ bio, size = 24, color, stroke = 1.4 }: { bio: Bio; size?: number; color?: string; stroke?: number }) => (
  <Icon name={bio === 'face' ? 'face' : 'fingerprint'} size={size} color={color} stroke={stroke} />
);

/** Fake biometric read: idle -> scan (1.4s) -> ok -> onDone. */
