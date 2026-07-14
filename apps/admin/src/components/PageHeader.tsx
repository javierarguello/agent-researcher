import { Group, Stack, Text, Title } from '@mantine/core';
import type { ReactNode } from 'react';

/** Consistent page header: an eyebrow that names the section, a title, and
 *  optional right-aligned actions. Used on every page for a shared rhythm. */
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <Group justify="space-between" align="flex-end" mb="lg" wrap="nowrap">
      <Stack gap={2}>
        <Text size="xs" fw={700} tt="uppercase" c="violet" style={{ letterSpacing: '0.08em' }}>
          {eyebrow}
        </Text>
        <Title order={2}>{title}</Title>
        {subtitle && <Text size="sm" c="dimmed">{subtitle}</Text>}
      </Stack>
      {actions && <Group gap="sm">{actions}</Group>}
    </Group>
  );
}
