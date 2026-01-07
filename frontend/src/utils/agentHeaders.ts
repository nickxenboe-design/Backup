let current: Record<string, string> = {};
let bootstrapInFlight: Promise<void> | null = null;
let fetchPatched = false;
let originalFetchRef: typeof fetch | null = null;
let agentModeActive = false;
const STORAGE_KEY = 'nt_agent_headers';
const STARTED_KEY = 'nt_agent_started';
const API_BASE: string = (typeof (import.meta as any) !== 'undefined' && (import.meta as any).env?.VITE_API_BASE_URL) || '';

const resolveMeUrl = (): string => {
  try {
    if (typeof window !== 'undefined') {
      const p = window.location?.pathname || '';
      if (agentModeActive || p.startsWith('/agent')) {
        return `${API_BASE}/api/v1/auth/agent/me`;
      }
    }
  } catch {}
  return `${API_BASE}/api/v1/auth/me`;
};

const normaliseAgentHeaders = (headers: Record<string, string> | null | undefined) => {
  if (!headers || typeof headers !== 'object') return {};
  const out: Record<string, string> = {};
  const entries = Object.entries(headers);
  for (const [k, v] of entries) {
    if (v == null || String(v).length === 0) continue;
    const key = k.toLowerCase();
    if (key === 'x-agent-mode' || key === 'x-agent-email' || key === 'x-agent-id' || key === 'x-agent-name') {
      out[key] = String(v);
    }
  }
  return out;
};

const persistHeaders = (headers: Record<string, string>) => {
  if (typeof window === 'undefined') return;
  try {
    if (headers && headers['x-agent-mode'] === 'true') {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(headers));
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
};

const loadPersistedHeaders = () => {
  if (typeof window === 'undefined') return;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      current = normaliseAgentHeaders(parsed);
      if (current['x-agent-mode'] === 'true') {
        agentModeActive = true;
        try {
          sessionStorage.setItem(STARTED_KEY, 'true');
        } catch {}
      }
    }
  } catch {
    // ignore
  }
};

loadPersistedHeaders();

export const setAgentHeaders = (headers: Record<string, string> | null | undefined) => {
  current = normaliseAgentHeaders(headers);
  persistHeaders(current);
};

export const getAgentHeaders = (): Record<string, string> => {
  if (!agentModeActive) return {};
  return current || {};
};

export const getAgentMetadata = (): {
  agentMode?: string;
  agentEmail?: string;
  agentId?: string;
  agentName?: string;
} => {
  if (!agentModeActive || !current || current['x-agent-mode'] !== 'true') return {};
  return {
    agentMode: 'true',
    agentEmail: current['x-agent-email'],
    agentId: current['x-agent-id'],
    agentName: current['x-agent-name'],
  };
};

export const setAgentModeActive = (active: boolean) => {
  agentModeActive = !!active;
  if (agentModeActive) {
    try {
      sessionStorage.setItem(STARTED_KEY, 'true');
    } catch {}
  }
  if (!agentModeActive) {
    // Clearing headers ensures we don't accidentally send stale agent headers
    current = {};
    persistHeaders(current);
    try {
      sessionStorage.removeItem(STARTED_KEY);
    } catch {}
  }
};

export const isAgentModeActive = (): boolean => agentModeActive;

export const hasAgentSessionStarted = (): boolean => {
  if (agentModeActive) return true;
  if (typeof window === 'undefined') return false;
  try {
    return sessionStorage.getItem(STARTED_KEY) === 'true';
  } catch {
    return false;
  }
};

async function ensureAgentHeadersBootstrapped(): Promise<void> {
  try {
    // Only bootstrap when agent mode is explicitly active
    if (!agentModeActive) return;
    // If we already have full agent headers, nothing to do
    if (
      current &&
      current['x-agent-mode'] === 'true' &&
      (current['x-agent-email'] || current['x-agent-id'] || current['x-agent-name'])
    ) {
      return;
    }
    if (bootstrapInFlight) return bootstrapInFlight;
    // Start bootstrap using the original fetch if available to avoid recursion
    const doFetch = (originalFetchRef || window.fetch).bind(window);
    bootstrapInFlight = (async () => {
      try {
        const meUrl = resolveMeUrl();
        const res = await doFetch(meUrl, { credentials: 'include' });
        if (!res.ok) return;
        const user: any = await res.json().catch(() => null);
        if (!user || typeof user !== 'object') return;
        const role = String(user.role || '').toLowerCase();
        if (role !== 'agent') return;
        const email = typeof user.email === 'string' ? user.email : '';
        const id = typeof user.id === 'string' ? user.id : '';
        const first = user.firstName || user.first_name || '';
        const last = user.lastName || user.last_name || '';
        const display = user.name || user.displayName || '';
        const name = display || [first, last].filter(Boolean).join(' ');
        const headers: Record<string, string> = { 'x-agent-mode': 'true' };
        if (email) headers['x-agent-email'] = email;
        if (id) headers['x-agent-id'] = id;
        if (name) headers['x-agent-name'] = name;
        // Only adopt headers if mode remains active
        if (agentModeActive) setAgentHeaders(headers);
      } finally {
        bootstrapInFlight = null;
      }
    })();
    return bootstrapInFlight;
  } catch {
    // noop
  }
}

if (typeof window !== 'undefined') {
  try {
    window.addEventListener('message', (event: MessageEvent) => {
      const data: any = event.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'nt-agent-headers' && data.headers && typeof data.headers === 'object') {
        const hdrs = data.headers as Record<string, string>;
        const mode = String(hdrs['X-Agent-Mode'] || hdrs['x-agent-mode'] || '').toLowerCase() === 'true';
        setAgentModeActive(mode);
        setAgentHeaders(hdrs);
      }
    });
  } catch {}
}

if (typeof window !== 'undefined' && typeof (window as any).fetch === 'function') {
  const w = window as any;
  if (!fetchPatched) {
    originalFetchRef = w.fetch.bind(window);
    w.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      try {
        // Avoid recursion when querying /auth/me; do not ensure or inject for that URL
        const urlStr = typeof input === 'string' ? input : (input instanceof URL ? input.toString() : (input as Request).url);
        const isMe = typeof urlStr === 'string' && urlStr.includes('/api/v1/auth/me');
        if (!isMe) {
          // Only bootstrap and inject when agent mode is active
          if (agentModeActive) await ensureAgentHeadersBootstrapped();
          const agent = agentModeActive ? getAgentHeaders() : {};
          const hasAgentFlag = agent && (agent['x-agent-mode'] === 'true' || agentModeActive);
          if (agent && hasAgentFlag) {
            const hdr = new Headers((init && (init as any).headers) || {});
            for (const [k, v] of Object.entries(agent)) {
              if (v != null && String(v).length > 0) hdr.set(k, String(v));
            }
            init = { ...(init || {}), headers: hdr };
          }
        }
      } catch {
        // ignore header bootstrap failures
      }
      return (originalFetchRef as typeof fetch)(input as any, init as any);
    };
    fetchPatched = true;
  }
}

// Note: we no longer auto-bootstrap on page load. Agent mode must be explicitly activated
// by the Agent Dashboard or a trusted parent via postMessage.
