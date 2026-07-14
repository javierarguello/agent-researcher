/** Shared API response shapes (mirrors the API's admin endpoints). */

export interface SessionUser {
  email: string;
  name: string | null;
  role: 'user' | 'admin';
  appId: string;
}
export interface SessionResponse {
  token: string;
  user: SessionUser;
  expiresInSeconds: number;
}

export interface AppStatsRollup {
  appId: string;
  reports: number;
  reportsCompleted: number;
  reportsFailed: number;
  degradedReports: number;
  users: number;
  costUsd: number;
  revenueUsd: number;
  purchases: number;
  creditsPurchased: number;
  avgGenMs: number | null;
  genTimeMsMin: number | null;
  genTimeMsMax: number | null;
}
export interface DailyPoint {
  date: string;
  reports: number;
  reportsCompleted: number;
  reportsFailed: number;
  costUsd: number;
  revenueUsd: number;
}
export interface AdminStats {
  totals: Omit<AppStatsRollup, 'appId'>;
  apps: AppStatsRollup[];
  daily: DailyPoint[];
}

export interface AdminUser {
  appId: string;
  userId: string;
  reports: number;
  costUsd: number;
  spentUsd: number;
  creditsPurchased: number;
  firstSeenAt?: string;
  lastSeenAt?: string;
}

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'incomplete';
export interface AdminJob {
  jobId: string;
  appId: string;
  userId: string;
  template: string;
  title: string | null;
  status: JobStatus;
  cost: { totalUsd?: number } | null;
  attempts: number | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export interface AppPublic {
  appId: string;
  name: string;
  active: boolean;
  role: 'admin' | 'app';
  rateLimitPerHour?: number;
  allowedTemplates?: string[];
  googleClientId?: string;
  adminEmails?: string[];
  apiKeyPreview: string;
  createdAt: string;
  updatedAt: string;
}

export interface LedgerEntry {
  id: string;
  appId: string;
  userId: string;
  type: 'purchase' | 'consumption' | 'refund' | 'grant';
  credits: number;
  plan?: string;
  paymentId?: string;
  provider?: string;
  amountUsd?: number;
  currency?: string;
  jobId?: string;
  grantedBy?: string;
  reason?: string;
  note?: string;
  createdAt: string;
}

export interface TemplateManifest {
  id: string;
  name: string;
  description: string;
  version: number;
  sections: Array<{ key: string; title: string }>;
  paramsSchema: unknown;
  reportSchema: unknown;
}
