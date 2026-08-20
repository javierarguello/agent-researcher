import { Alert, Card, Group, Loader, SimpleGrid, Stack, Table, Text } from '@mantine/core';
import type { AdminHealth } from '../api/types';
import { PageHeader } from '../components/PageHeader';
import { Mono } from '../components/Mono';
import { useAdminStats } from '../api/hooks';
import { int, relative, secs, shortDateTime, usd, usdFine } from '../lib/format';

function Kpi({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: string }) {
  return (
    <Card padding="md">
      <Text size="xs" c="dimmed" tt="uppercase" fw={700} style={{ letterSpacing: '0.06em' }}>{label}</Text>
      <Mono fw={700} fz={28} c={accent}>{value}</Mono>
      {hint && <Text size="xs" c="dimmed">{hint}</Text>}
    </Card>
  );
}

/**
 * The state of the layers that decide whether a request runs at all — first thing
 * on the page, because the failure it reports is SILENT everywhere else.
 *
 * Round 10 (R10-10) reproduced two shipping paths on which the moderation
 * classifier does not run: `MODERATION_LLM=false`, which is a separate flag from
 * `VALIDATION_LLM`, so the assisted review still prompts a model with the buyer's
 * free text; and any admin caller, for whom the whole moderation block is skipped.
 * The pre-screen behind it lets 61 of 95 known injection strings through by
 * design — §K decided that is the classifier's job. This strip is what makes the
 * classifier's absence visible instead of assumed.
 *
 * It renders in all four states, including the good one. A health panel that only
 * appears when something is wrong is indistinguishable from a health panel that
 * has stopped working — and `health` really can be absent here, from an API
 * deployed before the field existed, which is why that case says so rather than
 * showing green.
 */
function Health({ health, days }: { health?: AdminHealth; days: number }) {
  if (!health) {
    return (
      <Alert color="gray" title="Moderation health not reported">
        <Text size="sm">
          This API build predates the health block, so the dashboard cannot say whether the moderation
          classifier is running. That is not the same as “it is”.
        </Text>
      </Alert>
    );
  }
  const { classifierEnabled, moderationFailOpenRecent: recent, moderationFailOpenLastAt: lastAt } = health;
  const bypass = health.adminBypassesModeration
    ? ' Your own requests, as an admin, skip moderation entirely on both routes.'
    : '';

  if (!classifierEnabled) {
    return (
      <Alert color="red" title="The moderation classifier is OFF">
        <Text size="sm">
          <Mono>MODERATION_LLM=false</Mono>, so the deterministic pre-screen is the only layer running.
          It is tuned for precision and lets roughly two thirds of known injection phrasings through on
          purpose — the classifier is what was supposed to catch those. Note that this flag is independent
          of <Mono>VALIDATION_LLM</Mono>: with that one on, the assisted review still sends the buyer’s
          free text to a model.{bypass}
        </Text>
      </Alert>
    );
  }
  if (recent > 0) {
    return (
      <Alert color="orange" title={`Moderation failed open ${int(recent)}× in the last ${days} days`}>
        <Text size="sm">
          The classifier threw or answered with something unparsable, and those requests were allowed
          through — which is the designed behaviour, and is only safe while it stays rare.
          {lastAt ? ` Most recent: ${shortDateTime(lastAt)} (${relative(lastAt)}).` : ''}
          {bypass}
        </Text>
      </Alert>
    );
  }
  return (
    <Alert color="teal" title="Moderation is running">
      <Text size="sm">
        Classifier on, and no fail-open in the last {days} days
        {health.moderationFailOpen > 0 && lastAt ? `; last one ever was ${shortDateTime(lastAt)}` : ''}.
        {bypass}
      </Text>
    </Alert>
  );
}

export function Dashboard() {
  const { data, isLoading, error } = useAdminStats(30);

  if (isLoading) return <Loader />;
  if (error) return <Alert color="red">{(error as Error).message}</Alert>;
  if (!data) return null;
  const t = data.totals;

  return (
    <Stack>
      <PageHeader eyebrow="Overview" title="Dashboard" subtitle="Last 30 days across all apps." />

      <Health health={data.health} days={30} />

      <SimpleGrid cols={{ base: 2, sm: 3, lg: 4 }}>
        <Kpi label="Reports" value={int(t.reports)} hint={`${int(t.reportsCompleted)} completed`} />
        <Kpi
          label="Users"
          value={int(t.users)}
          hint={`${int(t.payingUsers)} paying · ${int(Math.max(0, t.users - t.payingUsers))} never bought`}
        />
        <Kpi
          label="Errors"
          value={int(t.reportsFailed)}
          hint={t.budgetStoppedReports > 0 ? `${int(t.budgetStoppedReports)} hit the cost ceiling` : 'failed reports'}
          accent={t.reportsFailed > 0 ? 'red' : undefined}
        />
        <Kpi label="Degraded" value={int(t.degradedReports)} hint="partial delivery" accent={t.degradedReports > 0 ? 'yellow' : undefined} />
        <Kpi label="Revenue" value={usd(t.revenueUsd)} hint={`${int(t.purchases)} purchases`} accent="teal" />
        {/* Jobs are not the whole bill: moderation and the assisted review run on
            every preview, so the headline is job + request-path spend. */}
        <Kpi
          label="Cost"
          value={usd(t.costUsd + t.requestLlmUsd)}
          hint={`${usd(t.costUsd)} jobs · ${usdFine(t.requestLlmUsd)} pre-flight`}
        />
        {/* Every failed job is refunded, so this is spend with no report and no
            revenue behind it. Inside `Cost` it is invisible; on its own it is the
            number that says whether the ceiling is set right. */}
        <Kpi
          label="Refunded spend"
          value={usd(t.failedCostUsd)}
          hint={`spent on ${int(t.reportsFailed)} failed reports`}
          accent={t.failedCostUsd > 0 ? 'orange' : undefined}
        />
        <Kpi label="Avg gen" value={secs(t.avgGenMs)} hint={`${secs(t.genTimeMsMin)}–${secs(t.genTimeMsMax)}`} />
      </SimpleGrid>

      <Card padding="md">
        <Group justify="space-between" mb="sm">
          <Text fw={650}>By app</Text>
          <Text size="sm" c="dimmed">{data.apps.length} apps</Text>
        </Group>
        <Table.ScrollContainer minWidth={640}>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>App</Table.Th>
                <Table.Th ta="right">Reports</Table.Th>
                <Table.Th ta="right">Errors</Table.Th>
                <Table.Th ta="right">Refunded</Table.Th>
                <Table.Th ta="right">Users</Table.Th>
                <Table.Th ta="right">Revenue</Table.Th>
                <Table.Th ta="right">Avg gen</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.apps.map((a) => (
                <Table.Tr key={a.appId}>
                  <Table.Td><Mono size="sm">{a.appId}</Mono></Table.Td>
                  <Table.Td ta="right"><Mono size="sm">{int(a.reports)}</Mono></Table.Td>
                  <Table.Td ta="right"><Mono size="sm" c={a.reportsFailed > 0 ? 'red' : undefined}>{int(a.reportsFailed)}</Mono></Table.Td>
                  <Table.Td ta="right"><Mono size="sm" c={a.failedCostUsd > 0 ? 'orange' : undefined}>{usd(a.failedCostUsd)}</Mono></Table.Td>
                  <Table.Td ta="right"><Mono size="sm">{int(a.users)}</Mono></Table.Td>
                  <Table.Td ta="right"><Mono size="sm">{usd(a.revenueUsd)}</Mono></Table.Td>
                  <Table.Td ta="right"><Mono size="sm">{secs(a.avgGenMs)}</Mono></Table.Td>
                </Table.Tr>
              ))}
              {data.apps.length === 0 && (
                <Table.Tr><Table.Td colSpan={7}><Text c="dimmed" size="sm">No activity yet.</Text></Table.Td></Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Card>
    </Stack>
  );
}
