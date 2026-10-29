import { useEffect, useState } from 'react';
import {
  Alert, Badge, Button, Card, Group, Loader, Modal, NumberInput, Progress, SimpleGrid, Stack, Switch, Table, TagsInput, Text, Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { PageHeader } from '../components/PageHeader';
import { Mono } from '../components/Mono';
import { useSpend, useUpdateApp, useUpdateSettings } from '../api/hooks';
import { ApiError } from '../api/client';
import { int, usd } from '../lib/format';
import type { GeneralSettings, SpendBlock, SpendView } from '../api/types';

/** A NumberInput's value as the API wants it: empty clears (null). */
const numOrNull = (v: number | string): number | null => (v === '' || v == null ? null : Number(v));
const fail = (err: unknown) =>
  notifications.show({ message: err instanceof ApiError ? err.message : 'Failed', color: 'red' });

function blockText(b: SpendBlock): string {
  if (b.scope === 'paused') return 'Paused by an admin';
  return `${b.scope === 'global' ? 'Global' : 'App'} cap reached — ${usd(b.spentUsd)} of ${usd(b.capUsd)}`;
}

/**
 * Every limit that bounds what the deployment spends, in one place: the monthly
 * caps (global and per app), their alerts, the kill switch, the hourly rate
 * limits, and the Postmark plan the mail estimate is built from.
 *
 * The spend shown is what the app BOOKED (LLM + search, as each job dispatch and
 * each request runs) — real time, per app. It is not the GCP invoice: infra is not
 * in it, and the billing-account budget covers that separately.
 */
export function Limits() {
  const spend = useSpend();
  const data = spend.data;

  return (
    <Stack>
      <PageHeader
        eyebrow="Money"
        title="Limits"
        subtitle={`Spend this UTC month${data ? ` (${data.spend.month})` : ''} against the caps. Reaching a cap refuses new reports (nothing is charged) and holds queued ones as they start.`}
      />
      {spend.isLoading && <Loader />}
      {spend.error && <Alert color="red">{(spend.error as Error).message}</Alert>}
      {data && (
        <>
          <GlobalCard data={data} />
          <AppsCard data={data} />
          <RateCard settings={data.settings} />
          <PostmarkCard data={data} />
          <Text size="xs" c="dimmed">
            Not here: the per-job cost ceiling (derived from price — see Pricing) and infrastructure cost, which the
            GCP budget on the billing account alerts on by email.
          </Text>
        </>
      )}
    </Stack>
  );
}

function GlobalCard({ data }: { data: SpendView }) {
  const update = useUpdateSettings();
  const s = data.settings;
  const [cap, setCap] = useState<number | string>(s.globalMonthlySpendCapUsd ?? '');
  const [alertAt, setAlertAt] = useState<number | string>(s.globalMonthlySpendAlertUsd ?? '');
  const [emails, setEmails] = useState<string[]>(s.spendAlertEmails);
  const [confirmPause, setConfirmPause] = useState(false);
  useEffect(() => {
    setCap(s.globalMonthlySpendCapUsd ?? '');
    setAlertAt(s.globalMonthlySpendAlertUsd ?? '');
    setEmails(s.spendAlertEmails);
  }, [s.globalMonthlySpendCapUsd, s.globalMonthlySpendAlertUsd, s.spendAlertEmails]);

  const total = data.spend.totalUsd;
  const capUsd = s.globalMonthlySpendCapUsd;
  const pct = capUsd ? Math.min(100, (total / capUsd) * 100) : 0;
  const capped = capUsd != null && total >= capUsd;

  async function save() {
    try {
      await update.mutateAsync({ globalMonthlySpendCapUsd: numOrNull(cap), globalMonthlySpendAlertUsd: numOrNull(alertAt), spendAlertEmails: emails });
      notifications.show({ message: 'Global limits saved', color: 'teal' });
    } catch (err) {
      fail(err);
    }
  }
  async function setPaused(jobsPaused: boolean) {
    try {
      await update.mutateAsync({ jobsPaused });
      notifications.show({ message: jobsPaused ? 'Jobs paused' : 'Jobs resumed', color: jobsPaused ? 'orange' : 'teal' });
    } catch (err) {
      fail(err);
    } finally {
      setConfirmPause(false);
    }
  }

  return (
    <Card withBorder>
      <Group justify="space-between" mb="xs">
        <Title order={4}>Whole deployment</Title>
        {s.jobsPaused ? <Badge color="orange">paused</Badge> : capped ? <Badge color="red">capped</Badge> : <Badge color="teal">accepting jobs</Badge>}
      </Group>
      <Group align="baseline" gap="xs">
        <Text fz={28} fw={700} data-testid="global-spent">{usd(total)}</Text>
        <Text c="dimmed">of {capUsd != null ? usd(capUsd) : 'no cap'} this month</Text>
      </Group>
      {capUsd != null && <Progress value={pct} color={capped ? 'red' : pct >= ((s.globalMonthlySpendAlertUsd ?? Infinity) / capUsd) * 100 ? 'orange' : 'teal'} mt={6} mb="md" />}

      <Group align="flex-end" wrap="wrap">
        <NumberInput label="Monthly cap (USD)" description="empty = no cap" min={0.01} decimalScale={2} prefix="$" w={180} value={cap} onChange={setCap} />
        <NumberInput label="Alert at (USD)" description="one email per month" min={0.01} decimalScale={2} prefix="$" w={180} value={alertAt} onChange={setAlertAt} />
        <TagsInput
          label="Alert recipients"
          description="empty = the admin app's admin emails"
          placeholder="email, Enter"
          value={emails}
          onChange={setEmails}
          w={360}
        />
        <Button onClick={save} loading={update.isPending}>Save</Button>
      </Group>

      <Group mt="lg" justify="space-between">
        <Stack gap={0}>
          <Text fw={600}>Pause all jobs</Text>
          <Text size="sm" c="dimmed">Kill switch. New reports are refused without charging; queued ones are held as they start.</Text>
        </Stack>
        <Switch
          size="lg"
          color="orange"
          checked={s.jobsPaused}
          onChange={(e) => (e.currentTarget.checked ? setConfirmPause(true) : setPaused(false))}
          aria-label="Pause all jobs"
        />
      </Group>
      <Modal opened={confirmPause} onClose={() => setConfirmPause(false)} title="Pause all jobs?">
        <Text size="sm" mb="md">
          Buyers will be told no new reports are being accepted right now. Jobs already running finish under their per-job
          ceiling; queued ones are held until you resume and continue them from Jobs.
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={() => setConfirmPause(false)}>Cancel</Button>
          <Button color="orange" onClick={() => setPaused(true)} loading={update.isPending}>Pause</Button>
        </Group>
      </Modal>
    </Card>
  );
}

function AppRow({ row }: { row: SpendView['apps'][number] }) {
  const update = useUpdateApp();
  const [cap, setCap] = useState<number | string>(row.monthlySpendCapUsd ?? '');
  const [alertAt, setAlertAt] = useState<number | string>(row.monthlySpendAlertUsd ?? '');
  useEffect(() => {
    setCap(row.monthlySpendCapUsd ?? '');
    setAlertAt(row.monthlySpendAlertUsd ?? '');
  }, [row.monthlySpendCapUsd, row.monthlySpendAlertUsd]);
  const dirty = numOrNull(cap) !== row.monthlySpendCapUsd || numOrNull(alertAt) !== row.monthlySpendAlertUsd;

  async function save() {
    try {
      await update.mutateAsync({ appId: row.appId, patch: { monthlySpendCapUsd: numOrNull(cap), monthlySpendAlertUsd: numOrNull(alertAt) } });
      notifications.show({ message: `Limits saved for ${row.appId}`, color: 'teal' });
    } catch (err) {
      fail(err);
    }
  }

  return (
    <Table.Tr>
      <Table.Td>
        <Text fw={600}>{row.name}</Text>
        <Mono>{row.appId}</Mono>
      </Table.Td>
      <Table.Td>{usd(row.spentUsd)}</Table.Td>
      <Table.Td>
        <NumberInput aria-label={`Monthly cap for ${row.appId}`} placeholder="no cap" min={0.01} decimalScale={2} prefix="$" w={130} value={cap} onChange={setCap} />
      </Table.Td>
      <Table.Td>
        <NumberInput aria-label={`Alert for ${row.appId}`} placeholder="no alert" min={0.01} decimalScale={2} prefix="$" w={130} value={alertAt} onChange={setAlertAt} />
      </Table.Td>
      <Table.Td>{row.blocked ? <Badge color="red" tt="none">{blockText(row.blocked)}</Badge> : <Badge color="teal">ok</Badge>}</Table.Td>
      <Table.Td>
        <Button size="xs" variant={dirty ? 'filled' : 'default'} disabled={!dirty} onClick={save} loading={update.isPending}>Save</Button>
      </Table.Td>
    </Table.Tr>
  );
}

function AppsCard({ data }: { data: SpendView }) {
  return (
    <Card withBorder>
      <Title order={4} mb={4}>Per app</Title>
      <Text size="sm" c="dimmed" mb="sm">An app's cap counts only its own spend. The global cap above still applies to every app.</Text>
      <Table.ScrollContainer minWidth={720}>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>App</Table.Th>
              <Table.Th>Spent this month</Table.Th>
              <Table.Th>Monthly cap</Table.Th>
              <Table.Th>Alert at</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {data.apps.map((row) => <AppRow key={row.appId} row={row} />)}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Card>
  );
}

function RateCard({ settings }: { settings: GeneralSettings }) {
  const update = useUpdateSettings();
  const [appRate, setAppRate] = useState<number | string>(settings.appRateLimitPerHour ?? '');
  const [userRate, setUserRate] = useState<number | string>(settings.userRateLimitPerHour ?? '');
  useEffect(() => {
    setAppRate(settings.appRateLimitPerHour ?? '');
    setUserRate(settings.userRateLimitPerHour ?? '');
  }, [settings.appRateLimitPerHour, settings.userRateLimitPerHour]);

  async function save() {
    try {
      await update.mutateAsync({ appRateLimitPerHour: numOrNull(appRate), userRateLimitPerHour: numOrNull(userRate) });
      notifications.show({ message: 'Rate limits saved', color: 'teal' });
    } catch (err) {
      fail(err);
    }
  }
  return (
    <Card withBorder>
      <Title order={4} mb={4}>Reports per hour</Title>
      <Text size="sm" c="dimmed" mb="sm">Defaults. An app's own Rate/h (Apps) overrides the per-app default.</Text>
      <Group align="flex-end">
        <NumberInput label="Per app" description="empty = unlimited" min={1} allowDecimal={false} w={160} value={appRate} onChange={setAppRate} />
        <NumberInput label="Per user" description="empty = unlimited" min={1} allowDecimal={false} w={160} value={userRate} onChange={setUserRate} />
        <Button onClick={save} loading={update.isPending}>Save</Button>
      </Group>
    </Card>
  );
}

function PostmarkCard({ data }: { data: SpendView }) {
  const update = useUpdateSettings();
  const s = data.settings;
  const [plan, setPlan] = useState<number | string>(s.postmarkPlanUsd ?? '');
  const [included, setIncluded] = useState<number | string>(s.postmarkIncludedEmails ?? '');
  const [overage, setOverage] = useState<number | string>(s.postmarkOveragePer1000Usd ?? '');
  useEffect(() => {
    setPlan(s.postmarkPlanUsd ?? '');
    setIncluded(s.postmarkIncludedEmails ?? '');
    setOverage(s.postmarkOveragePer1000Usd ?? '');
  }, [s.postmarkPlanUsd, s.postmarkIncludedEmails, s.postmarkOveragePer1000Usd]);
  const pm = data.postmark;

  async function save() {
    try {
      await update.mutateAsync({ postmarkPlanUsd: numOrNull(plan), postmarkIncludedEmails: numOrNull(included), postmarkOveragePer1000Usd: numOrNull(overage) });
      notifications.show({ message: 'Postmark plan saved', color: 'teal' });
    } catch (err) {
      fail(err);
    }
  }
  return (
    <Card withBorder>
      <Title order={4} mb={4}>Email (Postmark)</Title>
      <Text size="sm" c="dimmed" mb="sm">
        Counts read live from Postmark for {data.spend.month}. Postmark has no billing API, so the cost is an estimate from
        the plan below. Mail is not counted toward the caps.
      </Text>
      {'error' in pm ? (
        <Alert color="yellow" mb="sm">Could not read Postmark: {pm.error}</Alert>
      ) : (
        <SimpleGrid cols={{ base: 2, sm: 4 }} mb="md">
          <Stat label="Sent" value={int(pm.sent)} />
          <Stat label="Bounced" value={`${int(pm.bounced)} (${pm.bounceRate.toFixed(2)}%)`} />
          <Stat label="Spam complaints" value={int(pm.spamComplaints)} />
          <Stat label="Estimated cost" value={pm.estimatedUsd == null ? 'set a plan' : usd(pm.estimatedUsd)} />
        </SimpleGrid>
      )}
      <Group align="flex-end">
        <NumberInput label="Plan fee / month" min={0} decimalScale={2} prefix="$" w={160} value={plan} onChange={setPlan} />
        <NumberInput label="Emails included" min={0} allowDecimal={false} thousandSeparator="," w={160} value={included} onChange={setIncluded} />
        <NumberInput label="Overage per 1,000" min={0} decimalScale={2} prefix="$" w={160} value={overage} onChange={setOverage} />
        <Button onClick={save} loading={update.isPending}>Save</Button>
      </Group>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Stack gap={0}>
      <Text size="xs" c="dimmed" tt="uppercase">{label}</Text>
      <Text fw={700} fz="lg">{value}</Text>
    </Stack>
  );
}
