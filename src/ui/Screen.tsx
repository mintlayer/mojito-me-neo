import React from 'react';
import { ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function Screen({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      className={`flex-1 ${className}`}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: 140 }}>
      {children}
    </ScrollView>
  );
}

/** Back/close + centred title. Shared by Send, Receive and Settings. */
