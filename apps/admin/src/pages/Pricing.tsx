import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Divider, Group, Loader, NumberInput, Select, Stack, Table, Text, Tooltip } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { PageHeader } from '../components/PageHeader';
import { Mono } from '../components/Mono';
import { useApps, usePricing, useRefreshCreditFloor, useSetPricing, useTemplates } from '../api/hooks';
import { CreditPacks } from '../components/CreditPacks';
import { ApiError } from '../api/client';

const usd = (n: number) => `$${n.toFixed(2)}`;

function PricingCard({ templateId, name, appId }: { templateId: string; name: string; appId: string | undefined }) {
  const pricing = usePricing(templateId);
  const save = useSetPricing();
  const refresh = useRefreshCreditFloor();
  const [modes, setModes] = useState<Record<string, number>>({});
  const [addons, setAddons] = useState<Record<string, number>>({});
  const [floor, setFloor] = useState<number | undefined>();
  const [profit, setProfit] = useState<number | undefined>();

  useEffect(() => {
    if (pricing.data) {
      setModes(Object.fromEntries(pricing.data.modes.map((m) => [m.key, m.credits])));
      setAddons(Object.fromEntries(pricing.data.addons.map((a) => [a.key, a.credits])));
      setFloor(pricing.data.economics.creditFloorUsd);
      setProfit(pricing.data.economics.expectedProfitPct);
    }
  }, [pricing.data]);

  async function onSave() {
    try {
      await save.mutateAsync({
        templateId,
        body: {
          modes,
          addons,
          ...(floor !== undefined ? { creditFloorUsd: floor } : {}),
          ...(profit !== undefined ? { expectedProfitPct: profit } : {}),
        },
      });
      notifications.show({ message: `Pricing saved for ${templateId}`, color: 'teal' });
    } catch (err) {
      notifications.show({ message: err instanceof ApiError ? err.message : 'Failed', color: 'red' });
    }
  }

  /**
   * Read the packs off Stripe and store the floor they imply.
   *
   * The catalog read is the SELECTED app's: credits are sold per app, and a model
   * offered through two apps has two floors. Reading it off the app picker rather
   * than assuming the first app is what makes the second one reachable.
   */
  async function onReadStripe() {
    if (!appId) {
      notifications.show({ message: 'Pick the app whose credit catalog to read.', color: 'red' });
      return;
    }
    try {
      const res = await refresh.mutateAsync({ templateId, appId, apply: true });
      setFloor(res.creditFloorUsd);
      const cheapest = res.packs.reduce((a, b) => (a.perCredit <= b.perCredit ? a : b));
      notifications.show({
        color: 'teal',
        message: `Credit floor ${usd(res.creditFloorUsd)} — cheapest pack "${cheapest.planId}" (${usd(cheapest.priceUsd)} / ${cheapest.credits} credits).`,
      });
    } catch (err) {
      // A 409 here is the useful one: an empty or unusable catalog. It changes
      // nothing on purpose — a floor of zero would derive a ceiling of zero and
      // hold every job of this model.
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
            onChange={(v) => setModes({ ...modes, [m.key]: typeof v === 'number' ? v : m.credits })}
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
        <NumberInput
          label="Credit floor (USD)"
          description={data.economics.creditFloorSource === 'stored' ? 'set for this model' : 'code default — never read from Stripe'}
          min={0.0001}
          max={1000}
          step={0.01}
          decimalScale={4}
          w={220}
          value={floor ?? data.economics.creditFloorUsd}
          onChange={(v) => setFloor(typeof v === 'number' ? v : undefined)}
        />
        <Stack gap={4} pt={26}>
          <Button size="compact-sm" variant="light" onClick={onReadStripe} loading={refresh.isPending}>
            Read from Stripe
          </Button>
          <Text size="xs" c="dimmed">cheapest pack, live</Text>
        </Stack>
        <NumberInput
          label="Expected profit (%)"
          description="margin a job must leave on its report"
          min={0}
          max={99}
          w={220}
          value={profit ?? data.economics.expectedProfitPct}
          onChange={(v) => setProfit(typeof v === 'number' ? v : undefined)}
        />
      </Group>

      {/* The point of the whole section: what those two numbers DO. Read off the
          API rather than recomputed here — it returns the figure the engine
          enforces, clamp included, and a second implementation of the formula in
          the admin would be one that can disagree with the one that bills. */}
      <Table mt="sm" withTableBorder>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Tier</Table.Th>
            <Table.Th>Earns</Table.Th>
            <Table.Th>A job may spend</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {data.economics.ceilings.map((c) => {
            const credits = modes[c.key] ?? data.modes.find((m) => m.key === c.key)?.credits ?? 0;
            const earns = credits * data.economics.creditFloorUsd;
            const clamped = c.ceilingUsd >= data.economics.maxJobCostUsd;
            return (
              <Table.Tr key={c.key}>
                <Table.Td><Mono size="xs">{c.key}</Mono></Table.Td>
                <Table.Td>{usd(earns)}</Table.Td>
                <Table.Td>
                  <Group gap={6}>
                    {usd(c.ceilingUsd)}
                    {clamped && (
                      <Tooltip label={`Capped by the deployment-wide MAX_JOB_COST_USD of ${usd(data.economics.maxJobCostUsd)}.`}>
                        <Badge size="xs" color="orange" variant="light">capped</Badge>
                      </Tooltip>
                    )}
                  </Group>
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
      <Text size="xs" c="dimmed" mt={6}>
        A job that reaches its ceiling is HELD for review, not failed — the credits stay spent and the
        checkpoint intact. The figures above update on save.
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
  const selected = appId ?? apps.data?.apps?.[0]?.appId;

  return (
    <Stack>
      <PageHeader eyebrow="Billing" title="Pricing" subtitle="Credit cost per model — tiers, add-ons, the packs that sell credits, and what a job may spend." />
      <Select
        label="Credit catalog"
        description="Packs are sold per app; a model offered through two apps has two of everything below."
        w={280}
        data={(apps.data?.apps ?? []).map((a) => ({ value: a.appId, label: `${a.name} (${a.appId})` }))}
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
