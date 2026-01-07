import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './src/components/ErrorBoundary';
import { AuthProvider } from './src/contexts/AuthContext';
import './index.css';

const DEFAULT_THEME_PRIMARY = '#652D8E';
const DEFAULT_THEME_ACCENT = '#F59E0B';

const applyThemeVars = (opts: { primary?: string; accent?: string }) => {
  try {
    const root = document.documentElement;
    const primary = String(opts.primary || DEFAULT_THEME_PRIMARY).trim();
    const accent = String(opts.accent || DEFAULT_THEME_ACCENT).trim();
    root.style.setProperty('--theme-primary', primary);
    root.style.setProperty('--theme-accent', accent);
  } catch (_e) {}
};

applyThemeVars({ primary: DEFAULT_THEME_PRIMARY, accent: DEFAULT_THEME_ACCENT });

try {
  fetch('/runtime-config.json', { cache: 'no-store' })
    .then(async (r) => {
      if (!r.ok) throw new Error(`Runtime config fetch failed: ${r.status}`);
      return r.json();
    })
    .then((cfg) => {
      applyThemeVars({ primary: cfg?.themePrimary, accent: cfg?.themeAccent });
    })
    .catch(() => {
      const API_BASE_URL = String((import.meta as any).env?.VITE_API_BASE_URL || '/api').replace(/\/+$/, '');
      const themeUrl = API_BASE_URL.startsWith('http')
        ? (API_BASE_URL.endsWith('/api') ? `${API_BASE_URL}/v1/theme` : `${API_BASE_URL}/api/v1/theme`)
        : (API_BASE_URL === '/api' ? '/api/v1/theme' : `${API_BASE_URL}/v1/theme`);
      return fetch(themeUrl, { credentials: 'include' });
    })
    .then(async (r: any) => {
      if (!r || !r.ok) return;
      const data = await r.json();
      applyThemeVars({ primary: data?.primary, accent: data?.accent });
    })
    .catch(() => {});
} catch (_e) {}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
