import { useState } from 'react';
import {
  Badge, Button, Divider, Group, Loader, NumberInput, Popover, SegmentedControl,
  Stack, Table, Text, TextInput, Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { Mono } from './Mono';
import { JobStatusBadge, LedgerTypeBadge } from './StatusBadge';
import { useBalance, useGrantCredits, useJobs, useTransactions } from '../api/hooks';
import { ApiError } from '../api/client';
import { int, relative, shortDateTime, usd } from '../lib/format';
import type { LedgerEntry } from '../api/types';

/** The provenance of a ledger entry, rendered per its source. */
function Provenance({ e }: { e: LedgerEntry }) {
  if (e.type === 'purchase') {
    return (
      <Text size="xs" c="dimmed">
        {e.plan && <>plan <b>{e.plan}</b> · </>}
        {e.amountUsd != null && <>{usd(e.amountUsd)} · </>}
        {e.paymentId && <>Stripe <Mono size="xs">{e.paymentId}</Mono></>}
      </Text>
    );
  }
  if (e.type === 'grant') {
    return (
      <Text size="xs" c="dimmed">
        by <b>{e.grantedBy ?? 'system'}</b>{e.reason ? <> — {e.reason}</> : null}
      </Text>
    );
  }
  return <Text size="xs" c="dimmed">{e.jobId ? <>job <Mono size="xs">{e.jobId}</Mono></> : e.note ?? '—'}</Text>;
}

function GrantCredits({ appId, userId }: { appId: string; userId: string }) {
  const grant = useGrantCredits();
  const [opened, setOpened] = useState(false);
  const [credits, setCredits] = useState<number | ''>(5);
  const [reason, setReason] = useState('');

  async function submit() {
    if (!reason.trim() || credits === '' || credits <= 0) return;
    try {
      const res = await grant.mutateAsync({ appId, userId, credits: Number(credits), reason: reason.trim() });
      notifications.show({ message: `Granted ${res.granted} — balance ${res.balance}`, color: 'teal' });
      setOpened(false);
      setReason('');
    } catch (err) {
      notifications.show({ message: err instanceof ApiError ? err.message : 'Failed', color: 'red' });
    }
  }

  return (
    <Popover opened={opened} onChange={setOpened} position="bottom-end" withArrow trapFocus>
      <Popover.Target>
        <Button size="compact-sm" onClick={() => setOpened((o) => !o)}>Grant credits</Button>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="xs" w={260}>
          <NumberInput label="Credits" min={1} max={1_000_000} value={credits} onChange={(v) => setCredits(typeof v === 'number' ? v : '')} />
          <TextInput label="Reason" placeholder="promo, comp, testing…" maxLength={500} required value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
          <Button onClick={submit} loading={grant.isPending} disabled={!reason.trim()}>Grant</Button>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

export function UserDetail({ appId, userId }: { appId: string; userId: string }) {
  const balance = useBalance(appId, userId);
  const [type, setType] = useState('all');
  const tx = useTransactions(appId, userId, type === 'all' ? undefined : type);
  const jobs = useJobs({ appId, userId });

  return (
    <Stack>
      <Group justify="space-between" align="flex-start">
        <Stack gap={2}>
          <Mono fw={600}>{userId}</Mono>
          <Text size="xs" c="dimmed">app <Mono size="xs">{appId}</Mono></Text>
        </Stack>
        <Group gap="sm" align="center">
          <Badge size="lg" variant="light" color="violet">{balance.data ? int(balance.data.balance) : '…'} credits</Badge>
          <GrantCredits appId={appId} userId={userId} />
        </Group>
      </Group>

      <Divider label="Credit audit trail" labelPosition="left" />
      <SegmentedControl
        size="xs"
        value={type}
        onChange={setType}
        data={['all', 'grant', 'purchase', 'consumption', 'refund']}
      />
      {tx.isLoading ? <Loader size="sm" /> : (
        <Table striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Type</Table.Th>
              <Table.Th>Credits</Table.Th>
              <Table.Th>Provenance</Table.Th>
              <Table.Th>When</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(tx.data?.transactions ?? []).map((e) => (
              <Table.Tr key={e.id}>
                <Table.Td><LedgerTypeBadge type={e.type} /></Table.Td>
                <Table.Td><Mono>{e.type === 'consumption' ? '−' : '+'}{e.credits}</Mono></Table.Td>
                <Table.Td><Provenance e={e} /></Table.Td>
                <Table.Td><Tooltip label={shortDateTime(e.createdAt)}><Text size="xs" c="dimmed">{relative(e.createdAt)}</Text></Tooltip></Table.Td>
              </Table.Tr>
            ))}
            {tx.data && tx.data.transactions.length === 0 && (
              <Table.Tr><Table.Td colSpan={4}><Text size="sm" c="dimmed">No entries.</Text></Table.Td></Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      )}

      <Divider label="Recent jobs" labelPosition="left" />
      {jobs.isLoading ? <Loader size="sm" /> : (
        <Table>
          <Table.Tbody>
            {(jobs.data?.jobs ?? []).map((j) => (
              <Table.Tr key={j.jobId}>
                <Table.Td><Mono size="xs">{j.jobId}</Mono></Table.Td>
                <Table.Td><Text size="sm">{j.template}</Text></Table.Td>
                <Table.Td><JobStatusBadge status={j.status} /></Table.Td>
                <Table.Td><Text size="xs" c="dimmed">{relative(j.createdAt)}</Text></Table.Td>
              </Table.Tr>
            ))}
            {jobs.data && jobs.data.jobs.length === 0 && (
              <Table.Tr><Table.Td><Text size="sm" c="dimmed">No jobs.</Text></Table.Td></Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      )}
    </Stack>
  );
}
