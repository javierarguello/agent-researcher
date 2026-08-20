import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from './client';
import type {
  AdminJob,
  AdminStats,
  AdminUser,
  AppPublic,
  JobDetail,
  LedgerEntry,
  PricingView,
  CreditPack,
  CreditPackWrite,
  TemplateManifest,
} from './types';

// `held` is deliberately absent: it changes only when an admin acts, and that
// happens in this very UI, which invalidates the query itself. Polling it would be
// a request every 3s for a state waiting on a human.
const LIVE_STATUSES = new Set(['queued', 'running', 'incomplete']);

// --- Queries ---------------------------------------------------------------

export function useAdminStats(days = 30) {
  return useQuery({ queryKey: ['admin-stats', days], queryFn: () => api<AdminStats>(`/admin/stats?days=${days}`) });
}

export function useTemplates() {
  return useQuery({
    queryKey: ['templates'],
    queryFn: () => api<{ templates: TemplateManifest[] }>('/templates'),
    staleTime: 5 * 60_000,
  });
}

export function useTemplate(id: string | null) {
  return useQuery({
    queryKey: ['template', id],
    enabled: !!id,
    queryFn: () => api<TemplateManifest>(`/templates/${encodeURIComponent(id!)}`),
    staleTime: 5 * 60_000,
  });
}

export function useJobReport(jobId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['job-report', jobId],
    enabled,
    staleTime: Infinity,
    queryFn: () => api<import('./types').JobReport>(`/research/${encodeURIComponent(jobId)}/report`),
  });
}

export function useJob(jobId: string) {
  return useQuery({
    queryKey: ['job', jobId],
    queryFn: () => api<JobDetail>(`/research/${encodeURIComponent(jobId)}`),
    // Poll while the job is still running; stop once terminal.
    refetchInterval: (query) => (LIVE_STATUSES.has((query.state.data as JobDetail | undefined)?.status ?? '') ? 3000 : false),
  });
}

export function useApps() {
  return useQuery({ queryKey: ['apps'], queryFn: () => api<{ apps: AppPublic[] }>('/admin/apps') });
}

/** The credit packs an app sells for one model (plus the untagged, all-model ones). */
export function usePlans(appId: string | undefined, templateId: string) {
  return useQuery({
    enabled: !!appId,
    queryKey: ['plans', appId, templateId],
    queryFn: () =>
      api<{ plans: CreditPack[] }>(`/admin/plans?appId=${encodeURIComponent(appId!)}&templateId=${encodeURIComponent(templateId)}`),
  });
}

export function useSavePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ planId, body }: { planId: string; body: CreditPackWrite }) =>
      api<{ plan: CreditPack; priceChanged: boolean; previousPriceUsd: number | null }>(
        `/admin/plans/${encodeURIComponent(planId)}`,
        { method: 'PUT', body },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['plans'] }),
  });
}

export function useArchivePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ planId, appId }: { planId: string; appId: string }) =>
      api<{ archived: boolean }>(`/admin/plans/${encodeURIComponent(planId)}/archive`, { method: 'POST', body: { appId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['plans'] }),
  });
}

export function usePricing(templateId: string) {
  return useQuery({
    queryKey: ['pricing', templateId],
    queryFn: () => api<PricingView>(`/admin/pricing/${encodeURIComponent(templateId)}`),
  });
}

/**
 * What the pricing WOULD be for an unsaved edit — computed by the API.
 *
 * A mutation rather than a query because it is a POST, and because the caller
 * decides when to ask (on change, debounced). Recomputing the ceilings in the
 * browser instead would be a second implementation of the formula that bills.
 */
export function usePreviewPricing() {
  return useMutation({
    mutationFn: ({ templateId, body }: {
      templateId: string;
      body: { modes?: Record<string, number>; creditFloorUsd?: number; expectedProfitPct?: number };
    }) => api<PricingView>(`/admin/pricing/${encodeURIComponent(templateId)}/preview`, { method: 'POST', body }),
  });
}

export function useSetPricing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ templateId, body }: {
      templateId: string;
      body: {
        modes?: Record<string, number>;
        addons?: Record<string, number>;
        creditFloorUsd?: number;
        expectedProfitPct?: number;
      };
    }) =>
      api<PricingView>(`/admin/pricing/${encodeURIComponent(templateId)}`, { method: 'PUT', body }),
    onSuccess: (_res, { templateId }) => {
      qc.invalidateQueries({ queryKey: ['pricing', templateId] });
      qc.invalidateQueries({ queryKey: ['templates'] });
      qc.invalidateQueries({ queryKey: ['template', templateId] });
    },
  });
}

export function useUsers(filter: { appId?: string; q?: string; neverPurchased?: boolean; blocked?: boolean }) {
  return useQuery({
    queryKey: ['users', filter.appId ?? '', filter.q ?? '', filter.neverPurchased ? 'np' : '', filter.blocked ? 'bl' : ''],
    queryFn: () => api<{ users: AdminUser[] }>(`/admin/users${qs({ appId: filter.appId, q: filter.q, neverPurchased: filter.neverPurchased ? 'true' : undefined, blocked: filter.blocked ? 'true' : undefined })}`),
  });
}

export function useJobs(filter: { appId?: string; userId?: string; status?: string; template?: string }) {
  return useQuery({
    queryKey: ['jobs', filter],
    queryFn: () => api<{ jobs: AdminJob[] }>(`/admin/jobs${qs(filter)}`),
  });
}

export function useBalance(appId?: string, userId?: string) {
  return useQuery({
    queryKey: ['balance', appId, userId],
    enabled: !!appId && !!userId,
    queryFn: () => api<{ appId: string; userId: string; balance: number }>(`/credits/balance${qs({ appId, userId })}`),
  });
}

export function useTransactions(appId?: string, userId?: string, type?: string) {
  return useQuery({
    queryKey: ['transactions', appId, userId, type ?? ''],
    enabled: !!appId && !!userId,
    queryFn: () =>
      api<{ transactions: LedgerEntry[] }>(`/credits/transactions${qs({ appId, userId, type, limit: 200 })}`),
  });
}

// --- Mutations -------------------------------------------------------------

export function useCreateApp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api<{ app: AppPublic }>('/admin/apps', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['apps'] }),
  });
}

export function useUpdateApp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ appId, patch }: { appId: string; patch: Record<string, unknown> }) =>
      api<{ app: AppPublic }>(`/admin/apps/${encodeURIComponent(appId)}`, { method: 'PATCH', body: patch }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['apps'] }),
  });
}

export function useDeleteApp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (appId: string) => api(`/admin/apps/${encodeURIComponent(appId)}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['apps'] }),
  });
}

export function useCreateJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { template: string; params: Record<string, unknown> }) =>
      api<{ jobId: string; status: string }>('/research', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
  });
}

export function useRetryJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) => api<{ jobId: string; status: string }>(`/admin/jobs/${encodeURIComponent(jobId)}/retry`, { method: 'POST' }),
    onSuccess: (_res, jobId) => {
      qc.invalidateQueries({ queryKey: ['job', jobId] });
      qc.invalidateQueries({ queryKey: ['jobs'] });
    },
  });
}

/**
 * Act on a held job. `approve` lets it continue (resuming from the checkpoint, no
 * re-charge); `refund` and `dismiss` close it, with and without giving the credits
 * back. A 409 means another admin got there first, which is why the job and the
 * list are both refetched either way.
 *
 * Nothing here happens on its own: a held job waits until one of these is called.
 */
/**
 * Both admin decisions answer in the same shape, so the caller does not have to
 * narrow a union to read the one field that says whether the money moved.
 * `refundFailed` means the job is closed and the buyer has NOT been paid back.
 */
interface ResolveResult {
  jobId: string;
  status: string;
  refunded?: boolean;
  refundFailed?: boolean;
}

export function useResolveHold() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, action, reason }: { jobId: string; action: 'approve' | 'refund' | 'dismiss'; reason?: string }) =>
      action === 'approve'
        ? api<ResolveResult>(`/admin/jobs/${encodeURIComponent(jobId)}/approve`, { method: 'POST' })
        : api<ResolveResult>(
            `/admin/jobs/${encodeURIComponent(jobId)}/resolve`,
            { method: 'POST', body: { outcome: action, ...(reason ? { reason } : {}) } },
          ),
    onSettled: (_res, _err, { jobId }) => {
      qc.invalidateQueries({ queryKey: ['job', jobId] });
      qc.invalidateQueries({ queryKey: ['jobs'] });
    },
  });
}


export function useBlockUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { appId: string; userId: string; blocked: boolean; reason?: string }) =>
      api<{ appId: string; userId: string; blocked: boolean }>('/admin/users/block', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useGrantCredits() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { appId: string; userId: string; credits: number; reason: string; idempotencyKey?: string }) =>
      api<{ granted: number; applied: boolean; grantedBy: string; balance: number }>('/admin/credits/grant', {
        method: 'POST',
        body,
      }),
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({ queryKey: ['balance', vars.appId, vars.userId] });
      qc.invalidateQueries({ queryKey: ['transactions', vars.appId, vars.userId] });
      qc.invalidateQueries({ queryKey: ['users'] });
    },
  });
}
