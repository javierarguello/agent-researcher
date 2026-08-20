import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Divider, Group, Loader, NumberInput, Select, Stack, Table, Text, Tooltip } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { PageHeader } from '../components/PageHeader';
import { Mono } from '../components/Mono';
import { useApps, usePreviewPricing, usePricing, useSetPricing, useTemplates } from '../api/hooks';
import { CreditPacks } from '../components/CreditPacks';
import type { PricingView } from '../api/types';
import { ApiError } from '../api/client';

const usd = (n: number) => `$${n.toFixed(2)}`;

function PricingCard({ templateId, name, appId }: { templateId: string; name: string; appId: string | undefined }) {
  const pricing = usePricing(templateId, appId);
  const save = useSetPricing();
  const preview = usePreviewPricing();
  /**
   * The tier table, recomputed by the API for whatever is on screen.
   *
   * Without it every number below describes the SAVED pricing while the inputs
   * above show something else — which is the shape of screen where someone changes
   * a price, reads a ceiling that has not moved, and concludes it did not matter.
   */
  const [live, setLive] = useState<PricingView['economics'] | null>(null);
  const shown = live ?? pricing.data?.economics;

  function repreview(next: { modes?: Record<string, number>; creditFloorUsd?: number; expectedProfitPct?: number }) {
    preview
      .mutateAsync({ templateId, body: { modes, expectedProfitPct: profit, ...next } })
      .then((v) => setLive(v.economics))
      // A failed preview leaves the last good figures rather than blanking the
      // table: stale-but-labelled beats empty, and the SAVE is what is authoritative.
      .catch(() => {});
  }
  const [modes, setModes] = useState<Record<string, number>>({});
  const [addons, setAddons] = useState<Record<string, number>>({});
  const [profit, setProfit] = useState<number | undefined>();

  useEffect(() => {
    if (pricing.data) {
      setModes(Object.fromEntries(pricing.data.modes.map((m) => [m.key, m.credits])));
      setAddons(Object.fromEntries(pricing.data.addons.map((a) => [a.key, a.credits])));
      setProfit(pricing.data.economics.expectedProfitPct);
      setLive(null); // the freshly loaded view IS the truth; drop any preview
    }
  }, [pricing.data]);

  async function onSave() {
    try {
      await save.mutateAsync({
        templateId,
        body: {
          modes,
          addons,
          ...(profit !== undefined ? { expectedProfitPct: profit } : {}),
        },
      });
      notifications.show({ message: `Pricing saved for ${templateId}`, color: 'teal' });
    } catch (err) {
      notifications.show({ message: err instanceof ApiError ? err.message : 'Failed', color: 'red' });
    }
  }

  if (pricing.isLoading) return <Card padding="lg"><Loader size="sm" /></Card>;
  if (pricing.error) return <Card padding="lg"><Alert color="red">{(pricing.error as Error).message}</Alert></Card>;

  const data = pricing.data!;

  return (
    <Card padding="lg">
      <Group justify="space-between" mb="xs">
        <div>
          <Text fw={650}>{name}</Text>
          <Mono size="xs" c="dimmed">{templateId}</Mono>
        </div>
        <Button size="compact-sm" onClick={onSave} loading={save.isPending}>Save</Button>
      </Group>

      <Divider label="Report tiers (credits)" labelPosition="left" my="sm" />
      <Group>
        {data.modes.map((m) => (
          <NumberInput
            key={m.key}
            label={m.key}
            description={`default ${m.defaultCredits}`}
            min={1}
            max={1_000_000}
            w={180}
            value={modes[m.key] ?? m.credits}
            onChange={(v) => {
              const next = { ...modes, [m.key]: typeof v === 'number' ? v : m.credits };
              setModes(next);
              repreview({ modes: next });
            }}
          />
        ))}
      </Group>

      <Divider label="Add-ons (credits)" labelPosition="left" my="sm" />
      {data.addons.length === 0 ? (
        <Text size="sm" c="dimmed">This model defines no add-ons.</Text>
      ) : (
        <Group align="flex-start">
          {data.addons.map((a) => (
            <NumberInput
              key={a.key}
              label={a.label}
              description={a.description ? `${a.description} · default ${a.defaultCredits}` : `default ${a.defaultCredits}`}
              min={1}
              max={1_000_000}
              w={240}
              value={addons[a.key] ?? a.credits}
              onChange={(v) => setAddons({ ...addons, [a.key]: typeof v === 'number' ? v : a.credits })}
            />
          ))}
        </Group>
      )}
      <Text size="xs" c="dimmed" mt="sm">Add-ons are defined in the model; here you only set their price. Generators ship later.</Text>

      <Divider label="Credit packs (Stripe)" labelPosition="left" my="sm" />
      <CreditPacks appId={appId} templateId={templateId} />

      <Divider label="Economics — what a job may spend" labelPosition="left" my="sm" />
      <Group align="flex-start">
        {/* Read-only, and that is the point: the floor is `min(price / credits)`
            over this model's packs, so it is a consequence of the table above and
            not a number anyone types. A hand-typed one decides every ceiling on
            this page and matches nothing anybody is sold. The API recomputes it on
            every pack write and when this page is read. */}
        <Stack gap={2} w={220}>
          <Text size="xs" fw={500}>Credit floor</Text>
          <Text size="xl" fw={700}>{usd(data.economics.creditFloorUsd)}</Text>
          <Text size="xs" c="dimmed">
            {data.economics.creditFloorSource === 'stored'
              ? 'the cheapest credit in the packs above'
              : 'no packs yet — the deployment default stands'}
          </Text>
        </Stack>
        <NumberInput
          label="Expected profit (%)"
          description="margin a job must leave on its report"
          min={0}
          max={99}
          w={220}
          value={profit ?? data.economics.expectedProfitPct}
          onChange={(v) => {
            const n = typeof v === 'number' ? v : undefined;
            setProfit(n);
            if (n !== undefined) repreview({ expectedProfitPct: n });
          }}
        />
      </Group>

      {/* The point of the whole section: what those two numbers DO. Read off the
          API rather than recomputed here — it returns the figure the engine
          enforces, clamp included, and a second implementation of the formula in
          the admin would be one that can disagree with the one that bills. */}
      <Group gap={6} mt="sm" mb={4}>
        <Text size="xs" c="dimmed">What each tier costs, earns and buys</Text>
        {live && <Badge size="xs" color="blue" variant="light">unsaved</Badge>}
      </Group>
      <Table withTableBorder data-testid="tiers">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Tier</Table.Th>
            <Table.Th>Credits</Table.Th>
            <Table.Th>Earns</Table.Th>
            <Table.Th>A job may spend</Table.Th>
            <Table.Th>Max turns</Table.Th>
            <Table.Th>Runs</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {(shown?.ceilings ?? []).map((c) => {
            const clamped = c.ceilingUsd >= (shown?.maxJobCostUsd ?? Infinity);
            return (
              <Table.Tr key={c.key}>
                <Table.Td>
                  <Mono size="xs">{c.key}</Mono>
                  <Text size="xs" c="dimmed">{c.depth} · ×{c.budgetScale}</Text>
                </Table.Td>
                <Table.Td>{c.credits}</Table.Td>
                <Table.Td>{usd(c.earnsUsd)}</Table.Td>
                <Table.Td>
                  <Group gap={6}>
                    {usd(c.ceilingUsd)}
                    {clamped && (
                      <Tooltip label={`Capped by the deployment-wide MAX_JOB_COST_USD of ${usd(shown!.maxJobCostUsd)}.`}>
                        <Badge size="xs" color="orange" variant="light">capped</Badge>
                      </Tooltip>
                    )}
                  </Group>
                </Table.Td>
                {/* The half that was invisible: what the money buys. Turns come from
                    the engine's own per-agent budget line, so this is the number a
                    job of this tier will actually get. */}
                <Table.Td>{c.maxTurns}</Table.Td>
                <Table.Td>
                  <Text size="xs">{c.researchers} researching / {c.agents} agents</Text>
                  <Text size="xs" c="dimmed">{c.sections} sections</Text>
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
      <Text size="xs" c="dimmed" mt={6}>
        A job that reaches its ceiling is HELD for review, not failed — the credits stay spent and the
        checkpoint intact. Turns and sections are what the mode’s own `budgetScale` and `exclude`
        produce; change them in the model, not here.
      </Text>
    </Card>
  );
}

export function Pricing() {
  const templates = useTemplates();
  const apps = useApps();
  const [appId, setAppId] = useState<string | undefined>();
  // The first app until someone picks another. Packs are sold per app, so every
  // catalog on this page is one app's — saying WHICH beats implying it.
  const selected = appId ?? apps.data?.apps?.find((a) => a.role !== 'admin')?.appId;

  return (
    <Stack>
      <PageHeader eyebrow="Billing" title="Pricing" subtitle="Credit cost per model — tiers, add-ons, the packs that sell credits, and what a job may spend." />
      <Select
        label="Credit catalog"
        description="Packs are sold per app; a model offered through two apps has two of everything below."
        w={280}
        // The backoffice is not a storefront: it has no credit packs and nothing to
        // price, so listing it here only offers a choice that answers nothing.
        data={(apps.data?.apps ?? []).filter((a) => a.role !== 'admin').map((a) => ({ value: a.appId, label: `${a.name} (${a.appId})` }))}
        value={selected ?? null}
        onChange={(v) => setAppId(v ?? undefined)}
      />
      {templates.isLoading && <Loader />}
      {templates.error && <Alert color="red">{(templates.error as Error).message}</Alert>}
      {(templates.data?.templates ?? []).map((t) => (
        <PricingCard key={t.id} templateId={t.id} name={t.name} appId={selected} />
      ))}
    </Stack>
  );
}
