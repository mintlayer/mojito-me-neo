import React from 'react';
import { View } from 'react-native';
import { Card } from './Card';
import { Label } from './Label';

export function Section({
  title,
  children,
  className = '',
  padded,
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <View className={`px-5 pt-5 ${className}`}>
      {title && <Label className="mb-2 pl-1">{title}</Label>}
      <Card className={`overflow-hidden ${padded ? 'p-3.5' : ''}`}>{children}</Card>
    </View>
  );
}
