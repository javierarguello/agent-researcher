import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from './client';
import type {
  AdminJob,
  AdminStats,
  AdminUser,
  AppPublic,
  JobDetail,
  LedgerEntry,
  TemplateManifest,
} from './types';

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

export function useUsers(filter: { appId?: string; q?: string }) {
  return useQuery({
    queryKey: ['users', filter.appId ?? '', filter.q ?? ''],
    queryFn: () => api<{ users: AdminUser[] }>(`/admin/users${qs({ appId: filter.appId, q: filter.q })}`),
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
