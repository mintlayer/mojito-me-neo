import React from 'react';
import { ScrollView, View } from 'react-native';

export function Body({
  children,
  className = '',
  scroll = true,
}: {
  children: React.ReactNode;
  className?: string;
  scroll?: boolean;
}) {
  if (!scroll) return <View className={`flex-1 ${className}`}>{children}</View>;
  return (
    <ScrollView
      className="flex-1"
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerClassName={className}>
      {children}
    </ScrollView>
  );
}

/** Back chevron + segmented progress + `n/total`. Omit `step` for back only. */
