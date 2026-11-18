import React from 'react';
import { RefreshControl, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C } from '../theme';

export function Screen({
  children = null,
  className = '',
  refreshing,
  refreshTitle,
  onRefresh,
}: {
  children?: React.ReactNode;
  className?: string;
  /** Pull-to-refresh wiring for data screens (Home); absent means no control. */
  refreshing?: boolean;
  /** RefreshControl label (iOS spinner text, accessibility on Android). */
  refreshTitle?: string;
  onRefresh?: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      className={`flex-1 ${className}`}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing ?? false}
            onRefresh={onRefresh}
            tintColor={C.text2}
            title={refreshTitle}
            titleColor={C.text2}
          />
        ) : undefined
      }
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: 140 }}>
      {children}
    </ScrollView>
  );
}

/** Back/close + centred title. Shared by Send, Receive and Settings. */
