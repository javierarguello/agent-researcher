import { Alert, Stack, Title } from '@mantine/core';

/** Stub for pages built in later phases (Jobs, Users, Apps, New job). */
export function Placeholder({ title }: { title: string }) {
  return (
    <Stack>
      <Title order={2}>{title}</Title>
      <Alert color="blue" variant="light">Coming in a later phase.</Alert>
    </Stack>
  );
}
