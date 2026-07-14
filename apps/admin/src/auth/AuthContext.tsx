import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, clearToken, setToken, UNAUTHORIZED_EVENT } from '../api/client';
import { config } from '../config';
import type { SessionResponse, SessionUser } from '../api/types';

const USER_KEY = 'admin_user';

interface AuthState {
  user: SessionUser | null;
  isAdmin: boolean;
  loginWithGoogle: (idToken: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(() => {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as SessionUser) : null;
  });

  const logout = useCallback(() => {
    clearToken();
    localStorage.removeItem(USER_KEY);
    setUser(null);
    window.google?.accounts.id.disableAutoSelect();
  }, []);

  const loginWithGoogle = useCallback(async (idToken: string) => {
    const res = await api<SessionResponse>('/auth/session', {
      method: 'POST',
      anonymous: true,
      body: { appId: config.adminAppId, provider: 'google', idToken },
    });
    setToken(res.token);
    localStorage.setItem(USER_KEY, JSON.stringify(res.user));
    setUser(res.user);
  }, []);

  // A 401 from any authed request logs the user out.
  useEffect(() => {
    const onUnauthorized = () => logout();
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [logout]);

  const value = useMemo<AuthState>(
    () => ({ user, isAdmin: user?.role === 'admin', loginWithGoogle, logout }),
    [user, loginWithGoogle, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
