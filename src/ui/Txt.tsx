import React from 'react';
import { Text } from 'react-native';

export function Txt({
  children,
  className = '',
  mono,
  ...rest
}: React.ComponentProps<typeof Text> & { mono?: boolean }) {
  return (
    <Text className={`${mono ? 'font-mono' : 'font-sans'} text-text0 ${className}`} {...rest}>
      {children}
    </Text>
  );
}

/** The 11px uppercase tracked caption that sits above almost every section. */
