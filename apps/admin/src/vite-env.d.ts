/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_ADMIN_GOOGLE_CLIENT_ID: string;
  readonly VITE_ADMIN_APP_ID?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Minimal Google Identity Services surface we use.
interface GoogleIdConfiguration {
  client_id: string;
  callback: (res: { credential: string }) => void;
  auto_select?: boolean;
}
interface GoogleAccountsId {
  initialize(config: GoogleIdConfiguration): void;
  renderButton(parent: HTMLElement, options: Record<string, unknown>): void;
  prompt(): void;
  disableAutoSelect(): void;
}
interface Window {
  google?: { accounts: { id: GoogleAccountsId } };
}
