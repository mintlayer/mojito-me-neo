import React from 'react';
import { View } from 'react-native';
import { C } from '../theme';

export const Divider = ({ className = '' }: { className?: string }) => (
  <View className={className} style={{ height: 1, backgroundColor: C.lineSoft }} />
);

/** Resolve a fixture's `tone` string to a palette colour. Falls back visibly
 *  instead of handing `undefined` to a style prop on a typo. */
