import { Text, type TextProps } from '@mantine/core';
import type { ReactNode } from 'react';

/** Tabular monospace for data (ids, money, timings) — the app's signature. */
export function Mono({ children, ...props }: TextProps & { children: ReactNode }) {
  return (
    <Text component="span" ff="monospace" style={{ fontVariantNumeric: 'tabular-nums' }} {...props}>
      {children}
    </Text>
  );
}
