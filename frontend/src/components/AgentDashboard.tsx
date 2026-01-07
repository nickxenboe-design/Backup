import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { setAgentHeaders, getAgentHeaders, setAgentModeActive } from '../utils/agentHeaders';

const API_BASE: string = (import.meta as any).env?.VITE_API_BASE_URL || '';
const EMBED_BASE_RAW: string = (import.meta as any).env?.VITE_EMBED_BASE_URL || '';

const normalizeBaseUrl = (raw: string): string => {
  const v = String(raw || '').trim();
  if (!v) return '';
  return v.replace(/\/+$/, '');
};

// Simple type aliases for clarity
export type AgentTheme = 'light' | 'dark';

interface FaqItem {
  id: string;
  question: string;
  answer: string;
}

const faqItems: FaqItem[] = [
  {
    id: 'change-date',
    question: 'Can a passenger change their travel date?',
    answer:
      'Changes are allowed if done before departure time, subject to the company rules and any change fee. Check the fare conditions for the specific trip before confirming.',
  },
  {
    id: 'luggage',
    question: 'What is the luggage allowance?',
    answer:
      'Standard tickets usually include one main bag in the hold and one small hand luggage item. For extra or oversized bags, confirm with operations or your company policy before promising space.',
  },
  {
    id: 'missed-bus',
    question: 'What happens if a passenger misses the bus?',
    answer:
      'Missed departure is normally treated as a no-show. Explain the policy clearly and, if allowed, check if the ticket can be moved to a later trip with a penalty.',
  },
  {
    id: 'refunds',
    question: 'How do refunds work?',
    answer:
      'Refunds depend on how long before departure the passenger cancels and the fare rules. Always check the company policy before confirming any refund or credit to a passenger.',
  },
];

const AgentDashboard: React.FC = () => {
  const { user, signOut } = useAuth();
  const [theme, setTheme] = useState<AgentTheme>('light');
  const [openFaqId, setOpenFaqId] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [metricsLoading, setMetricsLoading] = useState<boolean>(false);
  const [bookingsCount, setBookingsCount] = useState<number | null>(null);
  const [ticketsSold, setTicketsSold] = useState<number | null>(null);
  const [revenueTotal, setRevenueTotal] = useState<number | null>(null);
  const [revenueCurrency, setRevenueCurrency] = useState<string | undefined>(undefined);
  const [recentBookings, setRecentBookings] = useState<any[]>([]);
  const [recentBookingsLoading, setRecentBookingsLoading] = useState<boolean>(false);
  const [recentBookingsError, setRecentBookingsError] = useState<string | null>(null);
  const [recentBookingsPage, setRecentBookingsPage] = useState<number>(1);
  const [allBookings, setAllBookings] = useState<any[]>([]);
  const [reportRange, setReportRange] = useState<'today' | '7d' | '30d' | 'all'>('today');
  const [pnrQuery, setPnrQuery] = useState<string>('');
  const [pnrResult, setPnrResult] = useState<any | null>(null);
  const [pnrSearchMessage, setPnrSearchMessage] = useState<string | null>(null);
  const [pnrSearching, setPnrSearching] = useState<boolean>(false);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [profileFirstName, setProfileFirstName] = useState<string>('');
  const [profileLastName, setProfileLastName] = useState<string>('');
  const [profilePhone, setProfilePhone] = useState<string>('');
  const [profileSaving, setProfileSaving] = useState<boolean>(false);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState<boolean>(false);
  const [downloadRange, setDownloadRange] = useState<'today' | '7d' | '30d' | 'all'>('today');
  const [downloadDate, setDownloadDate] = useState<string>('');
  const [downloadLoading, setDownloadLoading] = useState<boolean>(false);
  const [downloadMessage, setDownloadMessage] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [agentModeOn, setAgentModeOn] = useState<boolean>(false);
  const [findTicketPnr, setFindTicketPnr] = useState<string>('');
  const [findTicketLoading, setFindTicketLoading] = useState<boolean>(false);
  const [findTicketMessage, setFindTicketMessage] = useState<string | null>(null);
  const [findTicketResult, setFindTicketResult] = useState<{
    pnr: string;
    downloadUrl: string;
    ticketType: 'final' | 'hold' | 'unknown';
    stored: boolean;
    bookedBy?: string | null;
    createdAt?: string | null;
  } | null>(null);
  const [invoiceMessage, setInvoiceMessage] = useState<string | null>(null);
  const [invoiceMessageTone, setInvoiceMessageTone] = useState<'success' | 'error' | null>(null);
  const [invoiceSelections, setInvoiceSelections] = useState<Set<string>>(new Set());
  const [invoicePaymentOpen, setInvoicePaymentOpen] = useState<boolean>(false);
  const [invoicePaymentMethod, setInvoicePaymentMethod] = useState<string>('cash');
  const [invoiceConfirming, setInvoiceConfirming] = useState<boolean>(false);
  const [refreshKey, setRefreshKey] = useState<number>(0);
  const [invoiceRows, setInvoiceRows] = useState<any[]>([]);
  const [invoiceLoading, setInvoiceLoading] = useState<boolean>(false);
  const [invoiceError, setInvoiceError] = useState<string | null>(null);
  const [invoiceSearch, setInvoiceSearch] = useState<string>('');
  const [invoiceResults, setInvoiceResults] = useState<any[] | null>(null);
  const [confirmedTickets, setConfirmedTickets] = useState<{ pnr: string; downloadUrl: string }[]>([]);

  const embedBase = useMemo(() => {
    const fromEnv = normalizeBaseUrl(EMBED_BASE_RAW);
    if (fromEnv) return fromEnv;
    if (typeof window !== 'undefined') return normalizeBaseUrl(window.location.origin);
    return '';
  }, []);

  const formattedRevenue = useMemo(() => {
    if (revenueTotal == null || !Number.isFinite(revenueTotal)) return null;
    try {
      return Number(revenueTotal).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    } catch {
      return String(revenueTotal);
    }
  }, [revenueTotal]);

  const rangeLabel = useMemo(() => {
    switch (reportRange) {
      case 'today':
        return 'Today';
      case '7d':
        return 'Last 7 days';
      case '30d':
        return 'Last 30 days';
      case 'all':
      default:
        return 'All time';
    }
  }, [reportRange]);

  const unpaidInvoices = useMemo(() => {
    const isUnpaidStatus = (statusRaw: any) => {
      const status = (statusRaw || '').toString().toLowerCase();
      return ['unpaid', 'pending', 'payment_pending', 'awaiting_payment', 'invoice_due'].includes(status);
    };

    return (allBookings || []).filter((row: any) => {
      if (isUnpaidStatus(row?.status)) return true;
      if (typeof row?.paid === 'boolean' && row.paid === false) return true;
      return false;
    });
  }, [allBookings]);

  const isAgentUser = useMemo(() => {
    const base: any = user || {};
    const role = (base.role || '').toLowerCase();
    const email = typeof base.email === 'string' ? base.email : '';
    return role === 'agent' && !!email;
  }, [user]);

  const hasAgentContext = useMemo(() => {
    if (isAgentUser) return true;
    try {
      const headers = getAgentHeaders() as any;
      const email = headers && typeof headers['x-agent-email'] === 'string' ? headers['x-agent-email'] : '';
      return !!String(email || '').trim();
    } catch {
      return false;
    }
  }, [isAgentUser, agentModeOn]);

  useEffect(() => {
    const base: any = user || {};
    const firstName = base.firstName || base.first_name || '';
    const lastName = base.lastName || base.last_name || '';
    const phone = base.phone || '';
    setProfileFirstName(firstName);
    setProfileLastName(lastName);
    setProfilePhone(phone);
  }, [user]);

  const handleRangeChange = (range: 'today' | '7d' | '30d' | 'all') => {
    setReportRange(range);
    if (range === 'today') {
      const today = new Date();
      const iso = today.toISOString().slice(0, 10);
      setSelectedDate(iso);
    } else {
      setSelectedDate('');
    }
  };

  const toggleInvoiceSelection = (id: string) => {
    setInvoiceSelections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleConfirmInvoicePayment = () => {
    if (invoiceSelections.size === 0) {
      setInvoiceMessage('Select at least one unpaid invoice to confirm payment.');
      setInvoiceMessageTone('error');
      return;
    }

    setInvoicePaymentOpen(true);
  };

  const openInvoiceConfirmForPnrs = (pnrs: string[]) => {
    const cleaned = (pnrs || []).map((p) => String(p || '').trim()).filter(Boolean);
    if (!cleaned.length) {
      setInvoiceMessage('Select at least one unpaid invoice to confirm payment.');
      setInvoiceMessageTone('error');
      return;
    }
    setInvoiceSelections(new Set(cleaned));
    setInvoicePaymentOpen(true);
  };

  const handleInvoicePaymentSubmit = async () => {
    if (invoiceSelections.size === 0) {
      setInvoiceMessage('Select at least one unpaid invoice to confirm payment.');
      setInvoiceMessageTone('error');
      setInvoicePaymentOpen(false);
      return;
    }
    const pnrs = Array.from(invoiceSelections);
    setInvoiceConfirming(true);
    setInvoiceMessage(null);
    setInvoiceMessageTone(null);
    try {
      const res = await fetch(`${API_BASE}/api/payments/invoices/confirm`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...getAgentHeaders(),
        },
        body: JSON.stringify({ pnrs, method: invoicePaymentMethod }),
      });
      if (!res.ok) {
        let msg = 'Failed to confirm invoice payments';
        try {
          const j = await res.json();
          if (j && typeof j.message === 'string') msg = j.message;
        } catch {}
        throw new Error(msg);
      }
      const data: any = await res.json().catch(() => null);
      const results: any[] = data && Array.isArray(data.results) ? data.results : [];
      const ok = results.filter((r) => r && r.status === 'ok').length;
      const failed = results.filter((r) => r && r.status === 'error').length;
      const notFound = results.filter((r) => r && r.status === 'not_found').length;
      const forbidden = results.filter((r) => r && r.status === 'forbidden').length;

      const allSuccessful = ok > 0 && failed === 0 && notFound === 0 && forbidden === 0;
      const someSuccessful = ok > 0;

      let message = '';
      if (allSuccessful) {
        message = ok === 1
          ? 'Payment confirmed. The ticket is ready — use the “Download Ticket” button below.'
          : `Payments confirmed for ${ok} bookings. Tickets are ready — use the “Download Ticket” buttons below.`;
        setInvoiceMessageTone('success');
      } else if (someSuccessful) {
        message = `Payment confirmed for ${ok} booking(s). `;
        if (failed) message += `${failed} could not be confirmed. `;
        if (notFound) message += `${notFound} booking(s) were not found. `;
        if (forbidden) message += `${forbidden} booking(s) are not allowed. `;
        message += 'Tickets for the confirmed bookings are listed below.';
        setInvoiceMessageTone('error');
      } else {
        message = 'No payments were confirmed. Please check the selected PNR(s) and try again.';
        setInvoiceMessageTone('error');
      }

      setInvoiceMessage(message);
      setConfirmedTickets(
        results.filter((r) => r && r.status === 'ok' && r.downloadUrl).map((r) => ({
          pnr: r.reference,
          downloadUrl: r.downloadUrl,
        }))
      );
      setInvoiceSelections(new Set());
      setRefreshKey((x) => x + 1);
    } catch (e: any) {
      setInvoiceMessage(e?.message || 'Failed to confirm invoice payments');
      setInvoiceMessageTone('error');
    } finally {
      setInvoiceConfirming(false);
      setInvoicePaymentOpen(false);
    }
  };

  const handleInvoicePaymentCancel = () => {
    setInvoicePaymentOpen(false);
  };

  const handleProfileSave = async () => {
    setProfileSaving(true);
    setProfileMessage(null);
    setProfileError(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/agents/me`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...getAgentHeaders(),
        },
        credentials: 'include',
        body: JSON.stringify({
          firstName: profileFirstName,
          lastName: profileLastName,
          phone: profilePhone,
        }),
      });
      if (!res.ok) {
        let msg = 'Failed to update profile';
        try {
          const data = await res.json();
          if (data && typeof data.message === 'string') msg = data.message;
        } catch {}
        throw new Error(msg);
      }
      await res.json().catch(() => null);
      setProfileMessage('Profile updated');
    } catch (e: any) {
      setProfileError(e?.message || 'Failed to update profile');
    } finally {
      setProfileSaving(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut();
    } finally {
      try {
        setAgentModeActive(false);
        setAgentHeaders({});
      } catch {}
      if (typeof window !== 'undefined') {
        window.location.reload();
      }
    }
  };

  const handleDownloadReportCsv = async () => {
    if (typeof window === 'undefined') return;
    setDownloadLoading(true);
    setDownloadMessage(null);
    setDownloadError(null);
    try {
      const params = new URLSearchParams();
      params.set('range', downloadRange);
      if (downloadDate) {
        params.set('date', downloadDate);
      }

      const res = await fetch(
        `${API_BASE}/api/v1/agents/reports/sales-summary.csv?${params.toString()}`,
        {
          credentials: 'include',
          headers: { ...getAgentHeaders() },
        },
      );

      if (!res.ok) {
        let msg = 'Failed to download report';
        try {
          const text = await res.text();
          if (text) msg = text;
        } catch {}
        throw new Error(msg);
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const filenameSuffix = downloadDate || downloadRange || 'all';
      const a = document.createElement('a');
      a.href = url;
      a.download = `agent-sales-summary-${filenameSuffix}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);

      setDownloadMessage('Download started. Check your browser downloads.');
    } catch (e: any) {
      setDownloadError(e?.message || 'Failed to download report');
    } finally {
      setDownloadLoading(false);
    }
  };

  // Wrapper class for dark mode on the outer shell
  const wrapperClassName = useMemo(
    () => (theme === 'dark' ? 'nt-agent-shell nt-dark' : 'nt-agent-shell'),
    [theme],
  );



  const sendAgentHeadersToIframe = () => {
    const iframe = iframeRef.current;
    if (!iframe || !iframe.contentWindow) return;
    const base: any = user || {};
    const email = typeof base.email === 'string' ? base.email : '';
    const id = typeof base.id === 'string' ? base.id : '';
    const firstName = base.firstName || base.first_name || '';
    const lastName = base.lastName || base.last_name || '';
    const displayName = base.name || base.displayName || '';
    const name = displayName || [firstName, lastName].filter(Boolean).join(' ');
    const headers: Record<string, string> = {};
    const shouldEnable = isAgentUser && agentModeOn;
    if (shouldEnable) {
      headers['x-agent-mode'] = 'true';
      if (email) headers['x-agent-email'] = email;
      if (id) headers['x-agent-id'] = id;
      if (name) headers['x-agent-name'] = name;
    }
    try {
      setAgentModeActive(shouldEnable);
      setAgentHeaders(headers);
      iframe.contentWindow.postMessage({ type: 'nt-agent-headers', headers }, '*');
    } catch {}
  };

  const handlePnrSearch = () => {
    const raw = pnrQuery || '';
    const query = raw.trim().toLowerCase();
    if (!query) {
      setPnrResult(null);
      setPnrSearchMessage('Enter a PNR to search.');
      return;
    }

    setPnrSearching(true);
    try {
      const match = allBookings.find((row: any) => {
        const base = row || {};
        const candidate =
          (base.reference || base.cartId || base.transactionRef || '')
            .toString()
            .toLowerCase();
        if (!candidate) return false;
        return candidate.includes(query);
      });

      if (match) {
        setPnrResult(match);
        setPnrSearchMessage(null);
      } else {
        setPnrResult(null);
        setPnrSearchMessage('No booking found for that PNR in the selected range.');
      }
    } finally {
      setPnrSearching(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    async function loadMetrics() {
      try {
        setMetricsLoading(true);

        const params = new URLSearchParams();
        params.set('range', reportRange);
        if (selectedDate) {
          params.set('date', selectedDate);
        }

        const res = await fetch(
          `${API_BASE}/api/v1/agents/reports/sales-summary?${params.toString()}`,
          {
            credentials: 'include',
            headers: { ...getAgentHeaders() },
          },
        );

        if (!res.ok) {
          throw new Error('Failed to load today metrics');
        }

        const json: any = await res.json().catch(() => null);
        if (!json || json.success === false || !json.data || typeof json.data !== 'object') {
          throw new Error(json?.message || 'Failed to load today metrics');
        }

        if (cancelled) return;

        const data: any = json.data;
        const rows = Array.isArray(data.rows) ? data.rows : [];
        const rangeTotals = data.rangeTotals || {};

        const bookings = rows.length;
        const tickets =
          (rangeTotals.totalTickets ??
            data.totalTicketsSold ??
            0) as number;

        const revenue =
          (rangeTotals.totalRevenue ??
            data.totalRevenue ??
            0) as number;

        const revenueByCurrency =
          rangeTotals.revenueByCurrency ??
          data.revenueByCurrency ??
          {};

        const primaryCurrency =
          revenueByCurrency && typeof revenueByCurrency === 'object'
            ? Object.keys(revenueByCurrency)[0]
            : undefined;

        setAllBookings(rows);
        setBookingsCount(bookings);
        setTicketsSold(tickets);
        setRevenueTotal(typeof revenue === 'number' ? revenue : null);
        setRevenueCurrency(primaryCurrency);
        setPnrResult(null);
        setPnrSearchMessage(null);
      } catch (e: any) {
        if (!cancelled) {
          console.error('[AgentDashboard] Failed to load today metrics', e);
          setBookingsCount(null);
          setTicketsSold(null);
          setRevenueTotal(null);
          setRevenueCurrency(undefined);
        }
      } finally {
        if (!cancelled) {
          setMetricsLoading(false);
        }
      }
    }

    loadMetrics();

    return () => {
      cancelled = true;
    };
  }, [reportRange, selectedDate, refreshKey]);

  useEffect(() => {
    let cancelled = false;

    async function loadRecentBookings() {
      if (!hasAgentContext) {
        setRecentBookings([]);
        setRecentBookingsPage(1);
        setRecentBookingsError(null);
        setRecentBookingsLoading(false);
        return;
      }

      setRecentBookingsLoading(true);
      setRecentBookingsError(null);
      try {
        const params = new URLSearchParams();
        params.set('limit', '50');

        const res = await fetch(`${API_BASE}/api/v1/agents/reports/recent-bookings?${params.toString()}`, {
          credentials: 'include',
          headers: { ...getAgentHeaders() },
        });

        if (!res.ok) {
          let msg = 'Failed to load recent bookings';
          try {
            const j = await res.json();
            if (j && typeof j.message === 'string') msg = j.message;
          } catch {}
          throw new Error(msg);
        }

        const json: any = await res.json().catch(() => null);
        if (!json || json.success === false || !Array.isArray(json.data)) {
          throw new Error(json?.message || 'Failed to load recent bookings');
        }

        if (!cancelled) {
          setRecentBookings(json.data);
          setRecentBookingsPage(1);
        }
      } catch (e: any) {
        if (!cancelled) {
          setRecentBookings([]);
          setRecentBookingsPage(1);
          setRecentBookingsError(e?.message || 'Failed to load recent bookings');
        }
      } finally {
        if (!cancelled) {
          setRecentBookingsLoading(false);
        }
      }
    }

    loadRecentBookings();

    return () => {
      cancelled = true;
    };
  }, [hasAgentContext, refreshKey]);

  const recentBookingsPageSize = 5;
  const recentBookingsTotalPages = Math.max(
    1,
    Math.ceil((recentBookings || []).length / recentBookingsPageSize)
  );
  const recentBookingsPageSafe = Math.min(
    Math.max(1, recentBookingsPage),
    recentBookingsTotalPages
  );
  const recentBookingsStart = (recentBookingsPageSafe - 1) * recentBookingsPageSize;
  const recentBookingsSlice = (recentBookings || []).slice(
    recentBookingsStart,
    recentBookingsStart + recentBookingsPageSize
  );

  useEffect(() => {
    let cancelled = false;
    async function loadInvoices() {
      if (!isAgentUser) {
        setInvoiceRows([]);
        return;
      }
      setInvoiceLoading(true);
      setInvoiceError(null);
      try {
        const params = new URLSearchParams();
        params.set('status', 'unpaid');
        params.set('limit', '200');
        if (invoiceSearch) params.set('search', invoiceSearch);
        const res = await fetch(`${API_BASE}/api/payments/invoices?${params.toString()}` , {
          credentials: 'include',
          cache: 'no-store',
          headers: {
            ...getAgentHeaders(),
            'Cache-Control': 'no-cache',
            Pragma: 'no-cache',
          },
        });
        if (!res.ok) {
          let msg = 'Failed to load invoices';
          try { const j = await res.json(); if (j && j.message) msg = j.message; } catch {}
          throw new Error(msg);
        }
        const data: any = await res.json().catch(() => null);
        const rows = (data && data.data && Array.isArray(data.data.rows)) ? data.data.rows : [];
        if (!cancelled) setInvoiceRows(rows);
      } catch (e: any) {
        if (!cancelled) setInvoiceError(e?.message || 'Failed to load invoices');
      } finally {
        if (!cancelled) setInvoiceLoading(false);
      }
    }
    loadInvoices();
    return () => { cancelled = true; };
  }, [isAgentUser, agentModeOn, invoiceSearch, refreshKey]);

  const applyOuterTheme = (currentTheme: AgentTheme) => {
    if (typeof document === 'undefined') return;
    const body = document.body;
    if (!body) return;

    if (currentTheme === 'dark') {
      body.classList.add('nt-dark');
      body.style.background = '#020617';
      body.style.color = '#e5e7eb';
    } else {
      body.classList.remove('nt-dark');
      body.style.background = '#f3f4f6';
      body.style.color = '#111827';
    }
  };

  const sendThemeToIframe = (currentTheme: AgentTheme) => {
    const iframe = iframeRef.current;
    if (!iframe || !iframe.contentWindow) return;

    try {
      iframe.contentWindow.postMessage({ type: 'nt-theme-change', theme: currentTheme }, '*');
    } catch {
      // ignore
    }
  };

  // Sync theme when it changes
  useEffect(() => {
    applyOuterTheme(theme);
    sendThemeToIframe(theme);
  }, [theme]);

  useEffect(() => {
    sendAgentHeadersToIframe();
  }, [user, agentModeOn]);

  const handleFindTicket = async () => {
    const pnr = (findTicketPnr || '').trim();
    if (!pnr) {
      setFindTicketResult(null);
      setFindTicketMessage('Enter a PNR to find a paid ticket.');
      return;
    }

    setFindTicketLoading(true);
    setFindTicketMessage(null);
    setFindTicketResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/ticket/ticket-url/${encodeURIComponent(pnr)}`, {
        method: 'GET',
        credentials: 'include',
        headers: {
          ...getAgentHeaders(),
        },
      });

      const data: any = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || data?.message || 'Failed to find ticket');
      }

      const stored = Boolean(data?.stored);
      const ticket = data?.ticket || null;
      if (!stored || !ticket) {
        setFindTicketMessage('Ticket not found in stored tickets yet.');
        return;
      }

      const inferTypeFromUrl = (url?: string) => {
        if (!url || typeof url !== 'string') return null;
        const match = url.match(/[?&]type=([^&]+)/i);
        return match && match[1] ? decodeURIComponent(match[1]).toLowerCase() : null;
      };

      const ticketType =
        (typeof ticket.finalPdfBase64 === 'string' && ticket.finalPdfBase64.trim() ? 'final' : null) ||
        (typeof ticket.holdPdfBase64 === 'string' && ticket.holdPdfBase64.trim() ? 'hold' : null) ||
        inferTypeFromUrl(ticket.url) ||
        'unknown';

      const downloadUrl = `${API_BASE}/api/ticket/pdf?pnr=${encodeURIComponent(String(pnr))}&download=1&zip=1`;
      setFindTicketResult({
        pnr,
        downloadUrl,
        ticketType: (ticketType === 'final' || ticketType === 'hold') ? ticketType : 'unknown',
        stored: true,
        bookedBy: ticket.bookedBy || null,
        createdAt: ticket.createdAt || null,
      });
      setFindTicketMessage(null);
    } catch (e: any) {
      setFindTicketMessage(e?.message || 'Failed to find ticket');
    } finally {
      setFindTicketLoading(false);
    }
  };

  // Ensure global agent mode is only active while Agent Dashboard is active with a valid agent user
  useEffect(() => {
    setAgentModeActive(isAgentUser && agentModeOn);
  }, [isAgentUser, agentModeOn]);

  useEffect(() => {
    const base: any = user || {};
    const role = (base.role || '').toLowerCase();
    const email = typeof base.email === 'string' ? base.email : '';
    const isAgent = role === 'agent' && !!email;
    if (isAgent) {
      setAgentModeOn(true);
    } else {
      setAgentModeOn(false);
      try {
        localStorage.removeItem('nt_agent_mode');
      } catch {}
    }
  }, [user]);

  // On mount: listen for resize messages from inner app
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const handleMessage = (event: MessageEvent) => {
      const data = event.data as any;
      if (!data || data.type !== 'nt-embed-resize') return;

      if (typeof data.height === 'number') {
        const width = wrapper.offsetWidth || window.innerWidth;
        const heightPercent = (data.height / width) * 100;
        wrapper.style.paddingTop = `${heightPercent}%`;
      }
    };

    window.addEventListener('message', handleMessage);

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, []);

  // Once iframe loads, push the current theme
  const handleIframeLoad = () => {
    sendThemeToIframe(theme);
    applyOuterTheme(theme);
    sendAgentHeadersToIframe();
  };

  const handleToggleFaq = (id: string) => {
    setOpenFaqId((current) => (current === id ? null : id));
  };

  const agentLabel = useMemo(() => {
    if (!user) return 'Agent';
    const base: any = user;
    const firstName = base.firstName || base.first_name || '';
    const lastName = base.lastName || base.last_name || '';
    const displayName = base.name || base.displayName || '';
    const name = displayName || [firstName, lastName].filter(Boolean).join(' ');
    if (name) return name;
    if (typeof user.email === 'string' && user.email) return user.email;
    return 'Agent';
  }, [user]);

  const agentInitial = useMemo(() => {
    const s = agentLabel || 'A';
    return s.charAt(0).toUpperCase();
  }, [agentLabel]);

  return (
    <div
      className={wrapperClassName}
      style={{
        margin: 0,
        background: theme === 'dark' ? '#020617' : '#f3f4f6',
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
        minHeight: '100vh',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
        padding: '32px 5%',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 800,
          display: 'flex',
          flexDirection: 'column',
          gap: 24,
        }}
      >
        {/* Shell header */}
        <header
          className="nt-shell-header"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: '#111827',
            color: '#f9fafb',
            padding: '16px 20px',
            borderRadius: 12,
            boxShadow: '0 10px 30px rgba(15,23,42,0.4)',
            position: 'relative',
            zIndex: 40,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 12,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                opacity: 0.7,
              }}
            >
              National Tickets
            </div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>Agent Booking Dashboard</div>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              fontSize: 12,
              opacity: 0.9,
              position: 'relative',
            }}
          >
            <button
              type="button"
              onClick={() => setProfileOpen((open) => !open)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 8px',
                borderRadius: 999,
                border: '1px solid rgba(249,250,251,0.25)',
                background: 'rgba(15,23,42,0.9)',
                color: '#e5e7eb',
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: 500,
              }}
            >
              <span
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 999,
                  background: '#652D8E',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                {agentInitial}
              </span>
              <span>
                Logged in as: <strong>{agentLabel}</strong>
              </span>
            </button>
            {profileOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 8px)',
                  right: 0,
                  zIndex: 50,
                  width: 360,
                  maxWidth: '80vw',
                  background: '#ffffff',
                  borderRadius: 12,
                  padding: '14px 16px 10px',
                  boxShadow: '0 16px 40px rgba(15,23,42,0.6)',
                  color: '#111827',
                }}
              >
                <h3
                  style={{
                    margin: '0 0 8px',
                    fontSize: 13,
                    fontWeight: 600,
                    color: '#111827',
                  }}
                >
                  Account & profile
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
                  <div>
                    <div style={{ color: '#6b7280', marginBottom: 2 }}>Email</div>
                    <div style={{ fontWeight: 500 }}>{(user && (user as any).email) || '—'}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ color: '#6b7280', marginBottom: 2 }}>First name</div>
                      <input
                        type="text"
                        value={profileFirstName}
                        onChange={(e) => setProfileFirstName(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '6px 8px',
                          borderRadius: 8,
                          border: '1px solid #e5e7eb',
                          fontSize: 12,
                        }}
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ color: '#6b7280', marginBottom: 2 }}>Last name</div>
                      <input
                        type="text"
                        value={profileLastName}
                        onChange={(e) => setProfileLastName(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '6px 8px',
                          borderRadius: 8,
                          border: '1px solid #e5e7eb',
                          fontSize: 12,
                        }}
                      />
                    </div>
                  </div>
                  <div>
                    <div style={{ color: '#6b7280', marginBottom: 2 }}>Phone</div>
                    <input
                      type="text"
                      value={profilePhone}
                      onChange={(e) => setProfilePhone(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '6px 8px',
                        borderRadius: 8,
                        border: '1px solid #e5e7eb',
                        fontSize: 12,
                      }}
                    />
                  </div>
                  {(profileMessage || profileError) && (
                    <div
                      style={{
                        fontSize: 11,
                        color: profileError ? '#b91c1c' : '#166534',
                      }}
                    >
                      {profileError || profileMessage}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                    <button
                      type="button"
                      onClick={handleProfileSave}
                      disabled={profileSaving}
                      style={{
                        flex: '0 0 auto',
                        padding: '6px 10px',
                        fontSize: 12,
                        fontWeight: 600,
                        borderRadius: 8,
                        border: 'none',
                        background: '#652D8E',
                        color: '#f9fafb',
                        cursor: 'pointer',
                        opacity: profileSaving ? 0.7 : 1,
                      }}
                    >
                      {profileSaving ? 'Saving…' : 'Save changes'}
                    </button>
                    <button
                      type="button"
                      onClick={handleLogout}
                      style={{
                        flex: '0 0 auto',
                        padding: '6px 10px',
                        fontSize: 12,
                        fontWeight: 500,
                        borderRadius: 8,
                        border: '1px solid #e5e7eb',
                        background: '#ffffff',
                        color: '#b91c1c',
                        cursor: 'pointer',
                      }}
                    >
                      Log out
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </header>

        {/* Bus booking widget */}
        <section
          className="nt-card"
          style={{
            background: '#ffffff',
            borderRadius: 12,
            padding: 16,
            boxShadow: '0 10px 30px rgba(15,23,42,0.18)',
          }}
        >
          <h2
            style={{
              margin: '0 0 8px',
              fontSize: 14,
              fontWeight: 600,
              color: '#111827',
            }}
          >
            Bus booking widget
          </h2>
          <p style={{ margin: '0 0 12px', fontSize: 13, color: '#4b5563' }}>
            This embedded widget is the same bus booking experience agents see on the main
            website.
          </p>
          <div
            id="nt-agent-bus-dashboard-wrapper"
            ref={wrapperRef}
            style={{
              position: 'relative',
              width: '98%',
              paddingTop: '32%',
              overflow: 'hidden',
              borderRadius: 10,
            }}
          >
            <iframe
              key={theme}
              id="nt-agent-bus-dashboard"
              ref={iframeRef}
              src={`${embedBase}/?embed=search&theme=${theme}`}
              onLoad={handleIframeLoad}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                border: 0,
              }}
              loading="lazy"
              title="Agent Bus Booking Dashboard"
            />
          </div>
        </section>

        {/* Overview + PNR search */}
        <section
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 16,
            }}
          >
            {/* Today overview */}
            <div
              className="nt-card"
              style={{
                flex: '1 1 320px',
                background: '#ffffff',
                borderRadius: 12,
                padding: '14px 16px 10px',
                boxShadow: '0 6px 18px rgba(15,23,42,0.08)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  marginBottom: 8,
                }}
              >
                <h3
                  style={{
                    margin: 0,
                    fontSize: 13,
                    fontWeight: 600,
                    color: '#111827',
                  }}
                >
                  {rangeLabel} overview
                </h3>
                <div
                  style={{
                    display: 'flex',
                    gap: 4,
                    fontSize: 10,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => handleRangeChange('today')}
                    style={{
                      padding: '2px 6px',
                      borderRadius: 999,
                      border: reportRange === 'today' ? '1px solid #652D8E' : '1px solid #e5e7eb',
                      background: reportRange === 'today' ? '#f5f3ff' : '#ffffff',
                      color: reportRange === 'today' ? '#652D8E' : '#4b5563',
                      cursor: 'pointer',
                    }}
                  >
                    Today
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRangeChange('7d')}
                    style={{
                      padding: '2px 6px',
                      borderRadius: 999,
                      border: reportRange === '7d' ? '1px solid #652D8E' : '1px solid #e5e7eb',
                      background: reportRange === '7d' ? '#f5f3ff' : '#ffffff',
                      color: reportRange === '7d' ? '#652D8E' : '#4b5563',
                      cursor: 'pointer',
                    }}
                  >
                    7d
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRangeChange('30d')}
                    style={{
                      padding: '2px 6px',
                      borderRadius: 999,
                      border: reportRange === '30d' ? '1px solid #652D8E' : '1px solid #e5e7eb',
                      background: reportRange === '30d' ? '#f5f3ff' : '#ffffff',
                      color: reportRange === '30d' ? '#652D8E' : '#4b5563',
                      cursor: 'pointer',
                    }}
                  >
                    30d
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRangeChange('all')}
                    style={{
                      padding: '2px 6px',
                      borderRadius: 999,
                      border: reportRange === 'all' ? '1px solid #652D8E' : '1px solid #e5e7eb',
                      background: reportRange === 'all' ? '#f5f3ff' : '#ffffff',
                      color: reportRange === 'all' ? '#652D8E' : '#4b5563',
                      cursor: 'pointer',
                    }}
                  >
                    All
                  </button>
                </div>
                {(reportRange === '7d' || reportRange === '30d') && (
                  <div
                    style={{
                      marginTop: 4,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 11,
                    }}
                  >
                    <span style={{ color: '#6b7280' }}>Specific date</span>
                    <input
                      type="date"
                      value={selectedDate}
                      onChange={(e) => setSelectedDate(e.target.value)}
                      style={{
                        padding: '2px 4px',
                        borderRadius: 6,
                        border: '1px solid #e5e7eb',
                        fontSize: 11,
                      }}
                    />
                  </div>
                )}
              </div>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 8,
                  marginTop: 4,
                }}
              >
                <div
                  className="nt-metric"
                  style={{
                    flex: '1 1 80px',
                    background: '#f5f3ff',
                    borderRadius: 10,
                    padding: '8px 10px',
                    border: '1px solid #e5e7eb',
                  }}
                >
                  <div style={{ fontSize: 11, color: '#6b7280' }}>Bookings</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#652D8E' }}>
                    {metricsLoading && bookingsCount == null
                      ? '...'
                      : bookingsCount != null
                        ? bookingsCount.toLocaleString()
                        : '—'}
                  </div>
                </div>
                <div
                  className="nt-metric"
                  style={{
                    flex: '1 1 80px',
                    background: '#f5f3ff',
                    borderRadius: 10,
                    padding: '8px 10px',
                    border: '1px solid #e5e7eb',
                  }}
                >
                  <div style={{ fontSize: 11, color: '#6b7280' }}>Tickets sold</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#652D8E' }}>
                    {metricsLoading && ticketsSold == null
                      ? '...'
                      : ticketsSold != null
                        ? ticketsSold.toLocaleString()
                        : '—'}
                  </div>
                </div>
                <div
                  className="nt-metric"
                  style={{
                    flex: '1 1 80px',
                    background: '#f5f3ff',
                    borderRadius: 10,
                    padding: '8px 10px',
                    border: '1px solid #e5e7eb',
                  }}
                >
                  <div style={{ fontSize: 11, color: '#6b7280' }}>Revenue</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#652D8E' }}>
                    {metricsLoading && formattedRevenue == null
                      ? '...'
                      : formattedRevenue != null
                        ? `${formattedRevenue} ${revenueCurrency || ''}`
                        : '—'}
                  </div>
                </div>
              </div>
            </div>

            {/* PNR / booking search */}
            <div
              className="nt-card"
              style={{
                flex: '1 1 320px',
                background: '#ffffff',
                borderRadius: 12,
                padding: '14px 16px 10px',
                boxShadow: '0 6px 18px rgba(15,23,42,0.08)',
              }}
            >
              <h3
                style={{
                  margin: '0 0 8px',
                  fontSize: 13,
                  fontWeight: 600,
                  color: '#111827',
                }}
              >
                PNR / booking search
              </h3>
              <p
                style={{
                  margin: '0 0 10px',
                  fontSize: 12,
                  color: '#6b7280',
                }}
              >
                Enter a PNR to locate a booking from the loaded sales summary. Results are limited
                to the selected date range.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text"
                    placeholder="PNR e.g. NTG12345"
                    value={pnrQuery}
                    onChange={(e) => setPnrQuery(e.target.value)}
                    style={{
                      flex: 1,
                      padding: '6px 8px',
                      fontSize: 12,
                      borderRadius: 8,
                      border: '1px solid #e5e7eb',
                      outline: 'none',
                    }}
                  />
                  <button
                    type="button"
                    onClick={handlePnrSearch}
                    style={{
                      padding: '6px 10px',
                      fontSize: 12,
                      fontWeight: 600,
                      borderRadius: 8,
                      border: 'none',
                      background: '#652D8E',
                      color: '#f9fafb',
                      cursor: 'pointer',
                      boxShadow: '0 4px 10px rgba(101,45,142,0.35)',
                    }}
                  >
                    {pnrSearching ? 'Searching...' : 'Search'}
                  </button>
                </div>
                <input
                  type="text"
                  placeholder="Customer phone or email (placeholder)"
                  style={{
                    width: '100%',
                    padding: '6px 8px',
                    fontSize: 12,
                    borderRadius: 8,
                    border: '1px solid #e5e7eb',
                    outline: 'none',
                  }}
                  disabled
                />
                {(pnrSearchMessage || pnrResult) && (
                  <div
                    style={{
                      marginTop: 4,
                      fontSize: 11,
                      color: '#4b5563',
                    }}
                  >
                    {pnrSearchMessage && <div>{pnrSearchMessage}</div>}
                    {pnrResult && (
                      <div>
                        <strong>Result:</strong>{' '}
                        {(pnrResult.reference || pnrResult.cartId || pnrResult.transactionRef || '').toString() || '—'}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Recent bookings table */}
        <section
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div
            className="nt-card"
            style={{
              background: '#ffffff',
              borderRadius: 12,
              padding: '14px 16px 12px',
              boxShadow: '0 6px 18px rgba(15,23,42,0.08)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 8,
              }}
            >
              <h3
                style={{
                  margin: 0,
                  fontSize: 13,
                  fontWeight: 600,
                  color: '#111827',
                }}
              >
                Recent bookings
              </h3>
              <span style={{ fontSize: 11, color: '#6b7280' }}>
                Last {Math.min(50, recentBookings.length)} loaded
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <button
                type="button"
                onClick={() => setRecentBookingsPage((p) => Math.max(1, p - 1))}
                disabled={recentBookingsPageSafe <= 1}
                style={{
                  border: '1px solid #e5e7eb',
                  background: recentBookingsPageSafe <= 1 ? '#f9fafb' : '#ffffff',
                  color: recentBookingsPageSafe <= 1 ? '#9ca3af' : '#111827',
                  borderRadius: 8,
                  padding: '6px 10px',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: recentBookingsPageSafe <= 1 ? 'not-allowed' : 'pointer',
                }}
              >
                Prev
              </button>
              <div style={{ fontSize: 11, color: '#6b7280' }}>
                Page {recentBookingsPageSafe} / {recentBookingsTotalPages}
              </div>
              <button
                type="button"
                onClick={() => setRecentBookingsPage((p) => Math.min(recentBookingsTotalPages, p + 1))}
                disabled={recentBookingsPageSafe >= recentBookingsTotalPages}
                style={{
                  border: '1px solid #e5e7eb',
                  background: recentBookingsPageSafe >= recentBookingsTotalPages ? '#f9fafb' : '#ffffff',
                  color: recentBookingsPageSafe >= recentBookingsTotalPages ? '#9ca3af' : '#111827',
                  borderRadius: 8,
                  padding: '6px 10px',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: recentBookingsPageSafe >= recentBookingsTotalPages ? 'not-allowed' : 'pointer',
                }}
              >
                Next
              </button>
            </div>
            <div style={{ overflowX: 'auto' }}>
              {recentBookingsError && (
                <div style={{ fontSize: 11, color: '#b91c1c', padding: '6px 0' }}>{recentBookingsError}</div>
              )}
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: 12,
                  color: '#111827',
                }}
              >
                <thead>
                  <tr style={{ background: '#f9fafb' }}>
                    <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #e5e7eb' }}>PNR</th>
                    <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #e5e7eb' }}>Route</th>
                    <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #e5e7eb' }}>Date</th>
                    <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #e5e7eb' }}>Passenger</th>
                    <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #e5e7eb' }}>Status</th>
                    <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #e5e7eb' }}>Confirm</th>
                    <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #e5e7eb' }}>Download</th>
                    <th style={{ textAlign: 'right', padding: '6px 8px', borderBottom: '1px solid #e5e7eb' }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {recentBookingsLoading && recentBookings.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ padding: '8px', textAlign: 'center', color: '#6b7280', fontSize: 11 }}>
                        Loading recent bookings...
                      </td>
                    </tr>
                  ) : recentBookings.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ padding: '8px', textAlign: 'center', color: '#6b7280', fontSize: 11 }}>
                        No recent bookings available.
                      </td>
                    </tr>
                  ) : (
                    recentBookingsSlice.map((row: any, idx: number) => {
                      const pnr = row.reference || row.cartId || row.transactionRef || `row-${idx}`;
                      const route =
                        row.origin && row.destination
                          ? `${row.origin} → ${row.destination}`
                          : row.route || '—';
                      const createdAt = row.createdAt || row.date || null;
                      let dateLabel = '-';
                      if (createdAt) {
                        const d = new Date(createdAt);
                        dateLabel = Number.isNaN(d.getTime()) ? String(createdAt) : d.toLocaleDateString();
                      }
                      const passengerLabel =
                        typeof row.passengers === 'number' && row.passengers > 0
                          ? `${row.passengers} pax`
                          : row.name || row.customer || '—';
                      const status = row.status || row.state || '—';
                      const statusLower = String(status || '').toLowerCase();
                      const statusKey = String(status || '')
                        .trim()
                        .toLowerCase()
                        .replace(/[\s-]+/g, '_')
                        .replace(/[^a-z0-9_]/g, '');
                      const bookingTypeRaw = row.bookingType || row.booking_type || null;
                      const bookingType =
                        bookingTypeRaw === 'paid' || bookingTypeRaw === 'unpaid'
                          ? bookingTypeRaw
                          : [
                              'processed',
                              'processing',
                              'unpaid',
                              'pending',
                              'payment_pending',
                              'pending_payment',
                              'awaiting_payment',
                              'awaitingpay',
                              'invoice_due',
                            ].includes(statusKey || statusLower)
                            ? 'unpaid'
                            : 'paid';
                      const canDownload = Boolean(pnr);
                      const canConfirmPayment =
                        Boolean(pnr) &&
                        (bookingType === 'unpaid' ||
                          [
                            'confirm_registered',
                            'confirm_registerd',
                            'confrim_registerd',
                          ].includes(statusKey || statusLower));
                      const paxCount = (typeof row.passengers === 'number' && row.passengers > 0) ? row.passengers : 1;
                      const downloadUrl = `${API_BASE}/api/ticket/pdf?pnr=${encodeURIComponent(String(pnr))}&download=1${paxCount > 1 ? '&zip=1' : ''}`;
                      const amountNumber =
                        typeof row.revenue === 'number'
                          ? row.revenue
                          : typeof row.amount === 'number'
                            ? row.amount
                            : typeof row.total === 'number'
                              ? row.total
                              : 0;
                      const amountText = Number(amountNumber || 0).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      });
                      const currency = row.currency || revenueCurrency || '';

                      return (
                        <tr key={pnr}>
                          <td style={{ padding: '6px 8px', borderBottom: '1px solid #f3f4f6' }}>{pnr}</td>
                          <td style={{ padding: '6px 8px', borderBottom: '1px solid #f3f4f6' }}>{route}</td>
                          <td style={{ padding: '6px 8px', borderBottom: '1px solid #f3f4f6' }}>{dateLabel}</td>
                          <td style={{ padding: '6px 8px', borderBottom: '1px solid #f3f4f6' }}>{passengerLabel}</td>
                          <td
                            style={{
                              padding: '6px 8px',
                              borderBottom: '1px solid #f3f4f6',
                              textTransform: 'capitalize',
                            }}
                          >
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  width: 'fit-content',
                                  padding: '2px 8px',
                                  borderRadius: 999,
                                  fontSize: 10,
                                  fontWeight: 800,
                                  letterSpacing: 0.4,
                                  textTransform: 'uppercase',
                                  background: bookingType === 'paid' ? '#dcfce7' : '#fef3c7',
                                  color: bookingType === 'paid' ? '#14532d' : '#92400e',
                                  border: bookingType === 'paid' ? '1px solid #86efac' : '1px solid #fcd34d',
                                }}
                              >
                                {bookingType === 'paid' ? 'Paid' : 'Unpaid'}
                              </span>
                              <span style={{ fontSize: 11, color: '#4b5563' }}>{status}</span>
                            </div>
                          </td>
                          <td style={{ padding: '6px 8px', borderBottom: '1px solid #f3f4f6' }}>
                            {canConfirmPayment ? (
                              <button
                                type="button"
                                onClick={() => openInvoiceConfirmForPnrs([String(pnr)])}
                                style={{
                                  padding: '6px 10px',
                                  fontSize: 11,
                                  fontWeight: 700,
                                  borderRadius: 8,
                                  border: 'none',
                                  background: '#14532d',
                                  color: '#f9fafb',
                                  cursor: 'pointer',
                                }}
                              >
                                Confirm
                              </button>
                            ) : (
                              <span style={{ color: '#9ca3af', fontSize: 11 }}>—</span>
                            )}
                          </td>
                          <td style={{ padding: '6px 8px', borderBottom: '1px solid #f3f4f6' }}>
                            {canDownload ? (
                              <button
                                type="button"
                                onClick={() => {
                                  if (typeof window !== 'undefined') {
                                    window.open(downloadUrl, '_blank', 'noopener,noreferrer');
                                  }
                                }}
                                style={{
                                  padding: '6px 10px',
                                  fontSize: 11,
                                  fontWeight: 700,
                                  borderRadius: 8,
                                  border: 'none',
                                  background: '#652D8E',
                                  color: '#f9fafb',
                                  cursor: 'pointer',
                                }}
                              >
                                Download Ticket
                              </button>
                            ) : (
                              <span style={{ color: '#9ca3af', fontSize: 11 }}>—</span>
                            )}
                          </td>
                          <td
                            style={{
                              padding: '6px 8px',
                              borderBottom: '1px solid #f3f4f6',
                              textAlign: 'right',
                            }}
                          >
                            {amountText} {currency}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {invoicePaymentOpen && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(15,23,42,0.55)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 9999,
              padding: 16,
            }}
          >
            <div
              style={{
                width: '100%',
                maxWidth: 420,
                background: '#ffffff',
                borderRadius: 14,
                padding: 18,
                boxShadow: '0 20px 45px rgba(15,23,42,0.4)',
              }}
            >
              <h3 style={{ margin: '0 0 10px', fontSize: 15, fontWeight: 700, color: '#111827' }}>
                Confirm payment method
              </h3>
              <p style={{ margin: '0 0 12px', fontSize: 12, color: '#4b5563' }}>
                Select how the customer paid for the selected invoices.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  { value: 'cash', label: 'Cash' },
                  { value: 'bank_transfer', label: 'Bank transfer' },
                  { value: 'ecocash', label: 'Ecocash' },
                  { value: 'innbucks', label: 'InnBucks' },
                  { value: 'zipit', label: 'ZipIT' },
                  { value: 'other', label: 'Other / manual' },
                ].map((opt) => (
                  <label
                    key={opt.value}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '8px 10px',
                      borderRadius: 10,
                      border: invoicePaymentMethod === opt.value ? '1px solid #652D8E' : '1px solid #e5e7eb',
                      background: invoicePaymentMethod === opt.value ? '#f5f3ff' : '#fff',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="radio"
                      name="invoice-payment-method"
                      value={opt.value}
                      checked={invoicePaymentMethod === opt.value}
                      onChange={() => setInvoicePaymentMethod(opt.value)}
                    />
                    <span style={{ fontSize: 12, color: '#111827' }}>{opt.label}</span>
                  </label>
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
                <button
                  type="button"
                  onClick={handleInvoicePaymentCancel}
                  style={{
                    padding: '8px 10px',
                    fontSize: 12,
                    fontWeight: 600,
                    borderRadius: 8,
                    border: '1px solid #e5e7eb',
                    background: '#ffffff',
                    color: '#374151',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleInvoicePaymentSubmit}
                  style={{
                    padding: '8px 12px',
                    fontSize: 12,
                    fontWeight: 700,
                    borderRadius: 8,
                    border: 'none',
                    background: '#14532d',
                    color: '#f9fafb',
                    cursor: 'pointer',
                    boxShadow: '0 6px 16px rgba(20,83,45,0.35)',
                  }}
                >
                  Confirm payment
                </button>
              </div>
            </div>
          </div>
        )}

        <section
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 16,
            }}
          >
            <div
              className="nt-card"
              style={{
                flex: '1 1 260px',
                background: '#ffffff',
                borderRadius: 12,
                padding: '14px 16px 10px',
                boxShadow: '0 6px 18px rgba(15,23,42,0.08)',
              }}
            >
              <h3
                style={{
                  margin: '0 0 8px',
                  fontSize: 13,
                  fontWeight: 600,
                  color: '#111827',
                }}
              >
                Settings & exports
              </h3>
              <p
                style={{
                  margin: '0 0 8px',
                  fontSize: 12,
                  color: '#6b7280',
                }}
              >
                Download your sales reports and review basic dashboard preferences.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12 }}>
                <div>
                  <div
                    style={{
                      fontWeight: 600,
                      marginBottom: 4,
                      color: '#111827',
                    }}
                  >
                    Download reports
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 8,
                      alignItems: 'center',
                    }}
                  >
                    <label style={{ fontSize: 11, color: '#4b5563' }}>
                      Range
                      <select
                        value={downloadRange}
                        onChange={(e) =>
                          setDownloadRange(
                            (e.target.value as 'today' | '7d' | '30d' | 'all') || 'today',
                          )
                        }
                        style={{
                          marginLeft: 4,
                          padding: '4px 6px',
                          borderRadius: 6,
                          border: '1px solid #e5e7eb',
                          fontSize: 11,
                          background: '#ffffff',
                        }}
                      >
                        <option value="today">Today</option>
                        <option value="7d">Last 7 days</option>
                        <option value="30d">Last 30 days</option>
                        <option value="all">All time</option>
                      </select>
                    </label>
                    <label style={{ fontSize: 11, color: '#4b5563' }}>
                      Date (optional)
                      <input
                        type="date"
                        value={downloadDate}
                        onChange={(e) => setDownloadDate(e.target.value)}
                        style={{
                          marginLeft: 4,
                          padding: '2px 4px',
                          borderRadius: 6,
                          border: '1px solid #e5e7eb',
                          fontSize: 11,
                        }}
                      />
                    </label>
                  </div>
                  <div
                    style={{
                      marginTop: 4,
                      fontSize: 11,
                      color: '#6b7280',
                    }}
                  >
                    Leave date empty to export the full selected range. Files are CSV and
                    open directly in Excel.
                  </div>
                  {(downloadMessage || downloadError) && (
                    <div
                      style={{
                        marginTop: 4,
                        fontSize: 11,
                        color: downloadError ? '#b91c1c' : '#166534',
                      }}
                    >
                      {downloadError || downloadMessage}
                    </div>
                  )}
                  <div style={{ marginTop: 6 }}>
                    <button
                      type="button"
                      onClick={handleDownloadReportCsv}
                      disabled={downloadLoading}
                      style={{
                        padding: '6px 10px',
                        fontSize: 12,
                        fontWeight: 600,
                        borderRadius: 8,
                        border: 'none',
                        background: '#652D8E',
                        color: '#f9fafb',
                        cursor: 'pointer',
                        opacity: downloadLoading ? 0.7 : 1,
                      }}
                    >
                      {downloadLoading ? 'Preparing…' : 'Download CSV (Excel-ready)'}
                    </button>
                  </div>
                </div>
                <div>
                  <div
                    style={{
                      fontWeight: 600,
                      marginBottom: 4,
                      color: '#111827',
                    }}
                  >
                    Other settings (ideas)
                  </div>
                  <ul
                    style={{
                      margin: 0,
                      paddingLeft: 18,
                      fontSize: 11,
                      color: '#6b7280',
                    }}
                  >
                    <li>Choose a default date range for the dashboard overview.</li>
                    <li>Pick a preferred export currency / format once multi-currency is live.</li>
                    <li>Enable a daily summary email sent to this agent address.</li>
                  </ul>
                </div>
              </div>
            </div>

            <div
              className="nt-card"
              style={{
                flex: '1 1 260px',
                background: '#ffffff',
                borderRadius: 12,
                padding: '14px 16px 10px',
                boxShadow: '0 6px 18px rgba(15,23,42,0.08)',
              }}
            >
              <h3
                style={{
                  margin: '0 0 8px',
                  fontSize: 13,
                  fontWeight: 600,
                  color: '#111827',
                }}
              >
                Invoices
              </h3>
              <p
                style={{
                  margin: '0 0 10px',
                  fontSize: 12,
                  color: '#6b7280',
                }}
              >
                Find a paid ticket by PNR and download it.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    type="text"
                    value={findTicketPnr}
                    onChange={(e) => {
                      setFindTicketPnr(e.target.value);
                      setFindTicketMessage(null);
                      setFindTicketResult(null);
                    }}
                    placeholder="Enter PNR (e.g. NTG12345)"
                    style={{
                      flex: '1 1 auto',
                      minWidth: 160,
                      padding: '8px 10px',
                      borderRadius: 10,
                      border: '1px solid #e5e7eb',
                      fontSize: 12,
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleFindTicket}
                    disabled={findTicketLoading}
                    style={{
                      padding: '8px 10px',
                      fontSize: 12,
                      fontWeight: 700,
                      borderRadius: 10,
                      border: 'none',
                      background: '#111827',
                      color: '#f9fafb',
                      cursor: 'pointer',
                      opacity: findTicketLoading ? 0.75 : 1,
                    }}
                  >
                    {findTicketLoading ? 'Searching…' : 'Find Ticket'}
                  </button>
                </div>
                {findTicketMessage && (
                  <div style={{ fontSize: 11, color: '#b91c1c' }}>{findTicketMessage}</div>
                )}
                {findTicketResult && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                      border: '1px solid #e5e7eb',
                      borderRadius: 10,
                      padding: '8px 10px',
                      background: '#f9fafb',
                    }}
                  >
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#111827' }}>
                      PNR {findTicketResult.pnr}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        if (typeof window !== 'undefined') {
                          window.open(findTicketResult.downloadUrl, '_blank', 'noopener,noreferrer');
                        }
                      }}
                      style={{
                        padding: '6px 10px',
                        fontSize: 11,
                        fontWeight: 700,
                        borderRadius: 8,
                        border: 'none',
                        background: '#652D8E',
                        color: '#f9fafb',
                        cursor: 'pointer',
                      }}
                    >
                      Download Ticket
                    </button>
                  </div>
                )}
                {invoiceMessage && (
                  <div
                    style={{
                      fontSize: 11,
                      color: invoiceMessageTone === 'success' ? '#166534' : '#b91c1c',
                    }}
                  >
                    {invoiceMessage}
                  </div>
                )}
                {confirmedTickets.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#111827', marginBottom: 4 }}>
                      Confirmed Tickets:
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {confirmedTickets.map((ticket, idx) => (
                        <div
                          key={idx}
                          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}
                        >
                          <span style={{ fontSize: 12, color: '#111827' }}>PNR {ticket.pnr}</span>
                          <button
                            type="button"
                            onClick={() => {
                              if (typeof window !== 'undefined') {
                                const raw = ticket.downloadUrl;
                                const hasZip = /([?&])(zip|split)=/i.test(String(raw || ''));
                                const url = hasZip
                                  ? raw
                                  : `${raw}${String(raw).includes('?') ? '&' : '?'}zip=1`;
                                window.open(url, '_blank', 'noopener,noreferrer');
                              }
                            }}
                            style={{
                              padding: '6px 10px',
                              fontSize: 11,
                              fontWeight: 700,
                              borderRadius: 8,
                              border: 'none',
                              background: '#652D8E',
                              color: '#f9fafb',
                              cursor: 'pointer',
                            }}
                          >
                            Download Ticket
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div
                  style={{
                    marginTop: 10,
                    paddingTop: 8,
                    borderTop: '1px solid #f3f4f6',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      marginBottom: 6,
                    }}
                  >
                    <span style={{ fontWeight: 600, color: '#111827' }}>Unpaid invoices</span>
                    <input
                      type="text"
                      value={invoiceSearch}
                      onChange={(e) => setInvoiceSearch(e.target.value)}
                      placeholder="Search PNR or number"
                      style={{
                        flex: '1 1 auto',
                        minWidth: 120,
                        maxWidth: 220,
                        padding: '6px 8px',
                        borderRadius: 8,
                        border: '1px solid #e5e7eb',
                        fontSize: 11,
                        background: '#ffffff',
                        color: '#111827',
                      }}
                    />
                    <button
                      type="button"
                      onClick={handleConfirmInvoicePayment}
                      style={{
                        padding: '6px 10px',
                        fontSize: 11,
                        fontWeight: 700,
                        borderRadius: 8,
                        border: 'none',
                        background: '#14532d',
                        color: '#f9fafb',
                        cursor: 'pointer',
                        opacity: invoiceSelections.size ? 1 : 0.7,
                      }}
                      disabled={invoiceConfirming || invoiceSelections.size === 0}
                    >
                      {invoiceConfirming ? 'Confirming…' : 'Confirm payment'}
                    </button>
                  </div>
                  <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 10 }}>
                    <table
                      style={{
                        width: '100%',
                        borderCollapse: 'collapse',
                        fontSize: 11,
                        color: '#111827',
                      }}
                    >
                      <thead style={{ background: '#f9fafb' }}>
                        <tr>
                          <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #e5e7eb' }}>
                            Select
                          </th>
                          <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #e5e7eb' }}>
                            PNR
                          </th>
                          <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #e5e7eb' }}>
                            Invoice
                          </th>
                          <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #e5e7eb' }}>
                            Status
                          </th>
                          <th style={{ textAlign: 'right', padding: '6px 8px', borderBottom: '1px solid #e5e7eb' }}>
                            Amount
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {invoiceLoading ? (
                          <tr>
                            <td colSpan={5} style={{ padding: '8px', textAlign: 'center', color: '#6b7280' }}>
                              Loading invoices…
                            </td>
                          </tr>
                        ) : invoiceError ? (
                          <tr>
                            <td colSpan={5} style={{ padding: '8px', textAlign: 'center', color: '#b91c1c' }}>{invoiceError}</td>
                          </tr>
                        ) : invoiceRows.length === 0 ? (
                          <tr>
                            <td colSpan={5} style={{ padding: '8px', textAlign: 'center', color: '#6b7280' }}>
                              No unpaid invoices found.
                            </td>
                          </tr>
                        ) : (
                          invoiceRows.map((row: any, idx: number) => {
                            const pnr = row.reference || '';
                            const number = row.number || '—';
                            const status = (row.status || row.state || 'unpaid').toString();
                            const amountNumber = typeof row.residual === 'number' ? row.residual : (typeof row.amount === 'number' ? row.amount : 0);
                            const amountText = Number(amountNumber || 0).toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            });
                            const currency = row.currency || revenueCurrency || '';
                            const isSelected = invoiceSelections.has(pnr);
                            const canSelect = Boolean(pnr);

                            return (
                              <tr key={pnr}>
                                <td
                                  style={{
                                    padding: '6px 8px',
                                    borderBottom: '1px solid #f3f4f6',
                                  }}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    disabled={!canSelect}
                                    onChange={() => canSelect && toggleInvoiceSelection(pnr)}
                                  />
                                </td>
                                <td
                                  style={{
                                    padding: '6px 8px',
                                    borderBottom: '1px solid #f3f4f6',
                                  }}
                                >
                                  {pnr || '—'}
                                </td>
                                <td
                                  style={{
                                    padding: '6px 8px',
                                    borderBottom: '1px solid #f3f4f6',
                                  }}
                                >
                                  {number}
                                </td>
                                <td
                                  style={{
                                    padding: '6px 8px',
                                    borderBottom: '1px solid #f3f4f6',
                                    textTransform: 'capitalize',
                                  }}
                                >
                                  {status}
                                </td>
                                <td
                                  style={{
                                    padding: '6px 8px',
                                    borderBottom: '1px solid #f3f4f6',
                                    textAlign: 'right',
                                  }}
                                >
                                  {amountText} {currency}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                  {invoiceResults && (
                    <div style={{ marginTop: 8, fontSize: 11, color: '#374151' }}>
                      {invoiceResults.map((r: any, i: number) => (
                        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                          <span style={{ minWidth: 90, color: '#6b7280' }}>{r.reference || '—'}</span>
                          <span style={{ textTransform: 'capitalize', fontWeight: 600 }}>
                            {r.status || 'unknown'}
                          </span>
                          {r.error && (
                            <span style={{ color: '#b91c1c' }}>· {r.error}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div
              className="nt-card"
              style={{
                flex: '1 1 320px',
                background: '#ffffff',
                borderRadius: 12,
                padding: '14px 16px 10px',
                boxShadow: '0 6px 18px rgba(15,23,42,0.08)',
              }}
            >
              <h3
                style={{
                  margin: '0 0 6px',
                  fontSize: 13,
                  fontWeight: 600,
                  color: '#111827',
                }}
              >
                Passenger FAQs (for agents)
              </h3>
              <p
                style={{
                  margin: '0 0 8px',
                  fontSize: 12,
                  color: '#6b7280',
                }}
              >
                Quick answers to the questions passengers ask most often during booking and
                support.
              </p>
              <div
                className="nt-faq-list"
                style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}
              >
                {faqItems.map((item) => {
                  const isOpen = openFaqId === item.id;
                  return (
                    <div
                      key={item.id}
                      className={`nt-faq-item${isOpen ? ' nt-faq-open' : ''}`}
                      style={{
                        borderRadius: 8,
                        border: '1px solid #e5e7eb',
                        padding: '8px 10px',
                        background: '#f9fafb',
                      }}
                    >
                      <button
                        type="button"
                        className="nt-faq-question"
                        aria-expanded={isOpen}
                        onClick={() => handleToggleFaq(item.id)}
                        style={{
                          width: '100%',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          background: 'transparent',
                          border: 'none',
                          padding: 0,
                          margin: 0,
                          fontSize: 12,
                          fontWeight: 600,
                          color: '#111827',
                          cursor: 'pointer',
                          textAlign: 'left',
                        }}
                      >
                        {item.question}
                        <span style={{ fontSize: 11, opacity: 0.7 }}>
                          {isOpen ? 'Hide' : 'View'}
                        </span>
                      </button>
                      <div
                        className="nt-faq-answer"
                        aria-hidden={!isOpen}
                        style={{
                          marginTop: 4,
                          fontSize: 12,
                          color: '#6b7280',
                          display: isOpen ? 'block' : 'none',
                        }}
                      >
                        {item.answer}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default AgentDashboard;
