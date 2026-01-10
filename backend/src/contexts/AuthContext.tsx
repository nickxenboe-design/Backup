import React, { createContext, useContext, useEffect, useState } from 'react';
import { setAgentHeaders } from '../utils/agentHeaders';

export type AuthUser = {
  id?: string;
  email?: string;
  displayName?: string;
  name?: string;
  role?: string;
  [k: string]: unknown;
} | null;

type AuthContextType = {
  user: AuthUser;
  loading: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (params: {
    email: string;
    password: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
  }) => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const API_BASE = (import.meta as any).env?.VITE_API_BASE_URL || '';
  const LOGIN_URL = (import.meta as any).env?.VITE_AUTH_LOGIN_URL || `${API_BASE}/api/v1/auth/login`;
  const SIGNUP_URL = (import.meta as any).env?.VITE_AUTH_SIGNUP_URL || `${API_BASE}/api/v1/auth/signup`;
  const LOGOUT_URL = (import.meta as any).env?.VITE_AUTH_LOGOUT_URL || `${API_BASE}/api/v1/auth/logout`;
  const ME_URL = (import.meta as any).env?.VITE_AUTH_ME_URL || `${API_BASE}/api/v1/auth/me`;
  const RESET_URL = (import.meta as any).env?.VITE_AUTH_RESET_PASSWORD_URL || `${API_BASE}/api/v1/auth/forgot-password`;
  const AUTH_OPTIONAL = String((import.meta as any).env?.VITE_AUTH_OPTIONAL || 'false').toLowerCase() === 'true';

  const fetchMe = async (isCancelled?: () => boolean) => {
    try {
      const res = await fetch(ME_URL, { credentials: 'include' });
      if (isCancelled && isCancelled()) return;
      if (!res.ok) {
        setUser(null);
        setAgentHeaders({});
        return;
      }
      const data = await res.json().catch(() => null);
      if (isCancelled && isCancelled()) return;
      setUser(data || null);
      try {
        const u: any = data || null;
        const role = String(u?.role || '').toLowerCase();
        if (u && role === 'agent') {
          const email = typeof u.email === 'string' ? u.email : '';
          const id = typeof u.id === 'string' ? u.id : '';
          const first = u.firstName || u.first_name || '';
          const last = u.lastName || u.last_name || '';
          const display = u.name || u.displayName || '';
          const name = display || [first, last].filter(Boolean).join(' ');
          const headers: Record<string, string> = { 'X-Agent-Mode': 'true' };
          if (email) headers['X-Agent-Email'] = email;
          if (id) headers['X-Agent-Id'] = id;
          if (name) headers['X-Agent-Name'] = name;
          setAgentHeaders(headers);
        } else {
          setAgentHeaders({});
        }
      } catch {}
    } catch {
      if (isCancelled && isCancelled()) return;
      setUser(null);
      setAgentHeaders({});
    }
  };

  useEffect(() => {
    let cancelled = false;
    if (AUTH_OPTIONAL) {
      setLoading(false);
      return () => { cancelled = true; };
    }
    (async () => {
      await fetchMe(() => cancelled);
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [ME_URL, AUTH_OPTIONAL]);

  const signIn = async (email: string, password: string) => {
    setError(null);
    try {
      const res = await fetch(LOGIN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password })
      });
      if (!res.ok) {
        let msg = 'Login failed';
        try {
          const data = await res.json();
          msg = (data && (data.message as string)) || msg;
        } catch {
          const text = await res.text().catch(() => '');
          if (text) msg = text;
        }
        throw new Error(msg || 'Login failed');
      }
      const data = await res.json().catch(() => null);
      setUser(data || null);
      try {
        const u: any = data || null;
        const role = String(u?.role || '').toLowerCase();
        if (u && role === 'agent') {
          const emailL = typeof u.email === 'string' ? u.email : '';
          const idL = typeof u.id === 'string' ? u.id : '';
          const first = u.firstName || u.first_name || '';
          const last = u.lastName || u.last_name || '';
          const display = u.name || u.displayName || '';
          const name = display || [first, last].filter(Boolean).join(' ');
          const headers: Record<string, string> = { 'X-Agent-Mode': 'true' };
          if (emailL) headers['X-Agent-Email'] = emailL;
          if (idL) headers['X-Agent-Id'] = idL;
          if (name) headers['X-Agent-Name'] = name;
          setAgentHeaders(headers);
        } else {
          setAgentHeaders({});
        }
      } catch {}
    } catch (e: any) {
      setError(e?.message || 'Failed to sign in');
      throw e;
    }
  };

  const signUp = async (params: {
    email: string;
    password: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
  }) => {
    setError(null);
    try {
      const res = await fetch(SIGNUP_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(params)
      });
      if (!res.ok) {
        let msg = 'Signup failed';
        try {
          const data = await res.json();
          msg = (data && (data.message as string)) || msg;
        } catch {
          const text = await res.text().catch(() => '');
          if (text) msg = text;
        }
        throw new Error(msg || 'Signup failed');
      }
      const data = await res.json().catch(() => null);
      setUser(data || null);
      try {
        const u: any = data || null;
        const role = String(u?.role || '').toLowerCase();
        if (u && role === 'agent') {
          const emailL = typeof u.email === 'string' ? u.email : '';
          const idL = typeof u.id === 'string' ? u.id : '';
          const first = u.firstName || u.first_name || '';
          const last = u.lastName || u.last_name || '';
          const display = u.name || u.displayName || '';
          const name = display || [first, last].filter(Boolean).join(' ');
          const headers: Record<string, string> = { 'X-Agent-Mode': 'true' };
          if (emailL) headers['X-Agent-Email'] = emailL;
          if (idL) headers['X-Agent-Id'] = idL;
          if (name) headers['X-Agent-Name'] = name;
          setAgentHeaders(headers);
        } else {
          setAgentHeaders({});
        }
      } catch {}
    } catch (e: any) {
      setError(e?.message || 'Failed to sign up');
      throw e;
    }
  };

  const signOut = async () => {
    try {
      await fetch(LOGOUT_URL, { method: 'POST', credentials: 'include' });
    } finally {
      setUser(null);
      setAgentHeaders({});
    }
  };

  const resetPassword = async (email: string) => {
    const res = await fetch(RESET_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email })
    });
    if (!res.ok) throw new Error('Could not send reset email');
  };

  const refreshUser = async () => {
    await fetchMe();
  };

  const value: AuthContextType = { user, loading, error, signIn, signUp, signOut, resetPassword, refreshUser };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
