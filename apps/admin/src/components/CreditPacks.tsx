/**
 * The credit packs one app sells for one research model — read from Stripe,
 * written back to Stripe, edited here.
 *
 * The catalog stays in Stripe (reporting, refunds, review); what changes is that
 * `appId`, `templateId`, `planId` and `credits` are written by the API rather than
 * typed into the Stripe dashboard. A pack created there with `credits` missing
 * takes someone's money and grants nothing, and it is invisible until it does.
 *
 * Two rules of this screen are about money and are enforced by the SERVER, not
 * here — this UI only makes them legible:
 *   - a price change needs `expectedPriceUsd`, the amount the editor was shown, so
 *     a stale screen cannot overwrite a change someone else made;
 *   - retiring is `active: false`, never a delete.
 */
import { useState } from 'react';
import {
  ActionIcon, Alert, Badge, Button, Group, Loader, Modal, NumberInput, Stack, Switch,
  Table, TagsInput, Text, TextInput, Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { Mono } from './Mono';
import { useArchivePlan, usePlans, useSavePlan } from '../api/hooks';
import { ApiError } from '../api/client';
import type { CreditPack } from '../api/types';

const usd = (n: number) => `$${n.toFixed(2)}`;
const perCredit = (p: { priceUsd: number; credits: number }) => p.priceUsd / p.credits;

interface Draft {
  planId: string;
  name: string;
  credits: number;
  priceUsd: number;
  popular: boolean;
  sub: string;
  features: string[];
  /** The price this draft was OPENED with — null for a new pack. */
  openedAtPriceUsd: number | null;
}

const emptyDraft = (): Draft => ({ planId: '', name: '', credits: 20, priceUsd: 29, popular: false, sub: '', features: [], openedAtPriceUsd: null });
const draftOf = (p: CreditPack): Draft => ({
  planId: p.planId, name: p.name, credits: p.credits, priceUsd: p.priceUsd,
  popular: !!p.popular, sub: p.sub ?? '', features: p.features ?? [], openedAtPriceUsd: p.priceUsd,
});

export function CreditPacks({ appId, templateId }: { appId: string | undefined; templateId: string }) {
  const plans = usePlans(appId, templateId);
  const save = useSavePlan();
  const archive = useArchivePlan();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirming, setConfirming] = useState(false);

  const priceChanged = !!draft && draft.openedAtPriceUsd !== null && draft.priceUsd !== draft.openedAtPriceUsd;

  async function write(d: Draft) {
    if (!appId) return;
    try {
      await save.mutateAsync({
        planId: d.planId,
        body: {
          appId,
          templateId,
          name: d.name,
          credits: d.credits,
          priceUsd: d.priceUsd,
          popular: d.popular,
          ...(d.sub ? { sub: { en: d.sub } } : {}),
          ...(d.features.length ? { features: { en: d.features } } : {}),
          // Only when it actually moves. Sent always, the server would treat every
          // save as a reprice and the confirmation would stop meaning anything.
          ...(d.openedAtPriceUsd !== null && d.priceUsd !== d.openedAtPriceUsd ? { expectedPriceUsd: d.openedAtPriceUsd } : {}),
        },
      });
      notifications.show({ message: `Saved "${d.planId}"`, color: 'teal' });
      setDraft(null);
      setConfirming(false);
    } catch (err) {
      // 409 is the one worth reading: someone else repriced it while this screen
      // was open. The server's sentence names both figures.
      notifications.show({ message: err instanceof ApiError ? err.message : 'Failed', color: 'red', autoClose: 8000 });
      setConfirming(false);
    }
  }

  function onSave() {
    if (!draft) return;
    if (priceChanged) { setConfirming(true); return; }
    void write(draft);
  }

  if (plans.isLoading) return <Loader size="sm" />;
  if (plans.error) return <Alert color="red">{(plans.error as Error).message}</Alert>;
  const list = plans.data?.plans ?? [];

  return (
    <>
      <Group justify="space-between" mb={6}>
        <Text size="sm" c="dimmed">
          Sold in Stripe. The cheapest credit here is what this model’s cost ceilings derive from.
        </Text>
        <Button size="compact-xs" variant="light" onClick={() => setDraft(emptyDraft())}>New pack</Button>
      </Group>

      {list.length === 0 ? (
        <Text size="sm" c="dimmed">No packs for this model yet.</Text>
      ) : (
        <Table withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Pack</Table.Th>
              <Table.Th>Price</Table.Th>
              <Table.Th>Credits</Table.Th>
              <Table.Th>Per credit</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {list.map((p) => {
              const cheapest = Math.min(...list.map(perCredit));
              return (
                <Table.Tr key={p.planId}>
                  <Table.Td>
                    <Group gap={6}>
                      <Mono size="xs">{p.planId}</Mono>
                      {p.popular && <Badge size="xs" variant="light">popular</Badge>}
                      {/* A pack from before packs were per-model: it sells for every
                          model this app offers, which is not obvious from its row. */}
                      {!p.templateId && (
                        <Tooltip label="No model tag — sells for every model this app offers.">
                          <Badge size="xs" color="gray" variant="outline">all models</Badge>
                        </Tooltip>
                      )}
                    </Group>
                    <Text size="xs" c="dimmed">{p.name}</Text>
                  </Table.Td>
                  <Table.Td>{usd(p.priceUsd)}</Table.Td>
                  <Table.Td>{p.credits}</Table.Td>
                  <Table.Td>
                    <Group gap={6}>
                      {usd(perCredit(p))}
                      {perCredit(p) === cheapest && (
                        <Tooltip label="The floor: this model’s cost ceilings derive from it.">
                          <Badge size="xs" color="teal" variant="light">floor</Badge>
                        </Tooltip>
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4} justify="flex-end">
                      <Button size="compact-xs" variant="subtle" onClick={() => setDraft(draftOf(p))}>Edit</Button>
                      <Tooltip label="Retire it — Stripe keeps every payment attached to it.">
                        <ActionIcon
                          size="sm" variant="subtle" color="red" loading={archive.isPending}
                          onClick={async () => {
                            if (!appId) return;
                            await archive.mutateAsync({ planId: p.planId, appId });
                            notifications.show({ message: `Retired "${p.planId}"`, color: 'teal' });
                          }}
                        >
                          ×
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      )}

      <Modal opened={!!draft} onClose={() => setDraft(null)} title={draft?.openedAtPriceUsd === null ? 'New credit pack' : `Edit ${draft?.planId}`}>
        {draft && (
          <Stack>
            <TextInput
              label="Plan id"
              description="Stable slug — every session, webhook and stat is attributed by it."
              value={draft.planId}
              disabled={draft.openedAtPriceUsd !== null}
              onChange={(e) => setDraft({ ...draft, planId: e.currentTarget.value })}
            />
            <TextInput label="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.currentTarget.value })} />
            <Group grow>
              <NumberInput label="Price (USD)" min={0.5} max={100000} decimalScale={2} value={draft.priceUsd}
                onChange={(v) => setDraft({ ...draft, priceUsd: typeof v === 'number' ? v : draft.priceUsd })} />
              <NumberInput label="Credits" min={1} max={1000000} value={draft.credits}
                onChange={(v) => setDraft({ ...draft, credits: typeof v === 'number' ? v : draft.credits })} />
            </Group>
            <Text size="xs" c="dimmed">{usd(draft.priceUsd / Math.max(draft.credits, 1))} per credit</Text>
            <TextInput label="Subtitle" value={draft.sub} onChange={(e) => setDraft({ ...draft, sub: e.currentTarget.value })} />
            <TagsInput label="Features" value={draft.features} onChange={(v) => setDraft({ ...draft, features: v })} />
            <Switch label="Recommended (popular)" checked={draft.popular} onChange={(e) => setDraft({ ...draft, popular: e.currentTarget.checked })} />
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setDraft(null)}>Cancel</Button>
              <Button onClick={onSave} loading={save.isPending}>Save</Button>
            </Group>
          </Stack>
        )}
      </Modal>

      {/* The price confirmation. The server refuses without `expectedPriceUsd`
          anyway; this is what makes the refusal something an admin never meets by
          accident — and it names both figures, because "are you sure?" without
          them is the dialog everyone clicks through. */}
      <Modal opened={confirming} onClose={() => setConfirming(false)} title="Change what customers are charged?">
        {draft && (
          <Stack>
            <Text>
              <Mono size="sm">{draft.planId}</Mono> goes from <b>{usd(draft.openedAtPriceUsd ?? 0)}</b> to{' '}
              <b>{usd(draft.priceUsd)}</b> — {usd((draft.openedAtPriceUsd ?? 0) / Math.max(draft.credits, 1))} to{' '}
              {usd(draft.priceUsd / Math.max(draft.credits, 1))} per credit.
            </Text>
            <Text size="sm" c="dimmed">
              A new Stripe price is created; the old one stays active, so a checkout link someone is
              already holding still charges what they were quoted.
            </Text>
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setConfirming(false)}>Keep {usd(draft.openedAtPriceUsd ?? 0)}</Button>
              <Button color="orange" onClick={() => void write(draft)} loading={save.isPending}>Change the price</Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </>
  );
}
