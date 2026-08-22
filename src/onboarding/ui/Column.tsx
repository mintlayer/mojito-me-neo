import React from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function Column({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      className={`flex-1 ${className}`}
      style={{ paddingTop: insets.top + 8, paddingBottom: Math.max(insets.bottom, 16) + 8 }}>
      {children}
    </View>
  );
}
