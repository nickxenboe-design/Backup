import React, { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import { AdDefinition, getConfiguredAds, saveConfiguredAds } from './AdSlot';

function downloadCSV(
  filename: string,
  headers: string[],
  rows: (string | number | null | undefined)[][],
) {
  if (typeof window === 'undefined') return;
  if (!rows.length) return;

  const escapeCell = (value: string | number | null | undefined) => {
    if (value === null || value === undefined) return '""';
    const str = String(value).replace(/\r?\n/g, ' ');
    const escaped = str.replace(/"/g, '""');
    return `"${escaped}"`;
  };

  const headerLine = headers.map(h => escapeCell(h)).join(',');
  const lines = rows.map(row => row.map(cell => escapeCell(cell)).join(','));
  const csv = [headerLine, ...lines].join('\r\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function downloadReportsExcel(summaryRows: any[], transactionRows: any[]) {
  if (!summaryRows.length && !transactionRows.length) return;

  const workbook = XLSX.utils.book_new();

  if (summaryRows.length) {
    const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
    XLSX.utils.book_append_sheet(workbook, wsSummary, 'Summary');
  }

  if (transactionRows.length) {
    const wsTx = XLSX.utils.json_to_sheet(transactionRows);
    XLSX.utils.book_append_sheet(workbook, wsTx, 'Transactions');
  }

  const datePart = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(workbook, `reports_${datePart}.xlsx`);
}

type FirebaseUser = {
  uid: string;
  email?: string;
  name?: string;
  picture?: string;
  email_verified?: boolean;
  phone_number?: string;
};

type AdminRecord = {
  id: string;
  email?: string;
  emailLower?: string;
  active?: boolean;
  createdAt?: any;
  createdBy?: string | null;
};

type AgentRecord = {
  id: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  active?: boolean;
  createdAt?: any;
};

type MiddlewareFlag = {
  name: string;
  enabled: boolean;
};

type PricingSettings = {
  commission: number;
  fixed: number;
  roundToNearest: number;
  apply: boolean;
  discount: number;
  markup: number;
  charges: number;
};

const API_BASE: string = (import.meta as any).env?.VITE_API_BASE_URL || '';

function formatDate(value: any): string {
  if (!value) return '-';
  try {
    if (typeof value === 'string' || typeof value === 'number') {
      const d = new Date(value);
      if (!isNaN(d.getTime())) return d.toLocaleString();
    }
    if (value && typeof value === 'object') {
      if (typeof value.toDate === 'function') {
        const d = value.toDate();
        if (!isNaN(d.getTime())) return d.toLocaleString();
      }
      if (typeof value._seconds === 'number') {
        const d = new Date(value._seconds * 1000);
        if (!isNaN(d.getTime())) return d.toLocaleString();
      }
    }
  } catch {}
  return '-';
}

const AdminDashboard: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<FirebaseUser | null>(null);
  const [adminRecord, setAdminRecord] = useState<AdminRecord | null>(null);
  const [admins, setAdmins] = useState<AdminRecord[]>([]);
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [approvingAgentId, setApprovingAgentId] = useState<string | null>(null);
  const [deletingAgentId, setDeletingAgentId] = useState<string | null>(null);
  const [deactivatingAgentId, setDeactivatingAgentId] = useState<string | null>(null);
  const [confirmDeactivateOpen, setConfirmDeactivateOpen] = useState(false);
  const [confirmDeactivateAgent, setConfirmDeactivateAgent] = useState<AgentRecord | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [confirmDeleteAgent, setConfirmDeleteAgent] = useState<AgentRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [middlewares, setMiddlewares] = useState<MiddlewareFlag[]>([]);
  const [pricing, setPricing] = useState<PricingSettings | null>(null);
  const [ads, setAds] = useState<AdDefinition[]>([]);
  const [savingPricing, setSavingPricing] = useState(false);
  const [savingAds, setSavingAds] = useState(false);
  const [savingMiddleware, setSavingMiddleware] = useState<string | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [adsError, setAdsError] = useState<string | null>(null);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportsError, setReportsError] = useState<string | null>(null);
  const [reportsSummary, setReportsSummary] = useState<any | null>(null);
  const [profitabilityLoading, setProfitabilityLoading] = useState(false);
  const [profitabilityError, setProfitabilityError] = useState<string | null>(null);
  const [profitabilityReport, setProfitabilityReport] = useState<any | null>(null);
  const [transactionsLoading, setTransactionsLoading] = useState(false);
  const [transactionsError, setTransactionsError] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [transactionsOperatorFilter, setTransactionsOperatorFilter] = useState('');
  const [transactionsAgentFilter, setTransactionsAgentFilter] = useState('');
  const [transactionsPaymentFilter, setTransactionsPaymentFilter] = useState('');
  const [transactionsDateFilter, setTransactionsDateFilter] = useState('');
  const [transactionsPage, setTransactionsPage] = useState(1);
  const transactionsPageSize = 10;
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [reportsNavOpen, setReportsNavOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<'overview' | 'middleware' | 'pricing' | 'ads' | 'admins' | 'reports'>('overview');
  const [reportsView, setReportsView] = useState<'summary' | 'profitability'>('summary');
  const [reportMetrics, setReportMetrics] = useState<{
    totalTickets: number;
    totalRevenue: number;
    branchesCount: number;
    primaryCurrency?: string;
    rangeLabel: string;
  } | null>(null);

  const hasReportMetrics = !!reportMetrics;

  const totalTickets = hasReportMetrics ? reportMetrics!.totalTickets : null;

  const totalRevenue = hasReportMetrics ? reportMetrics!.totalRevenue : null;

  const branchesCount = hasReportMetrics ? reportMetrics!.branchesCount : null;

  const revenueByCurrency =
    reportsSummary?.rangeTotals?.revenueByCurrency ??
    reportsSummary?.revenueByCurrency ??
    {};

  const branchesObject =
    reportsSummary?.rangeTotals?.perBranch ??
    reportsSummary?.perBranch ??
    {};

  const primaryCurrency =
    reportMetrics?.primaryCurrency ??
    (revenueByCurrency && typeof revenueByCurrency === 'object'
      ? Object.keys(revenueByCurrency)[0]
      : undefined);

  const rangeLabel = reportMetrics?.rangeLabel ?? 'last 7 days';

  const formattedRevenue =
    typeof totalRevenue === 'number'
      ? (() => {
          try {
            return Number(totalRevenue).toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            });
          } catch {
            return String(totalRevenue);
          }
        })()
      : null;

  const topBranches =
    reportsSummary &&
    reportsSummary.summaryTable &&
    Array.isArray(reportsSummary.summaryTable.byBranch)
      ? (reportsSummary.summaryTable.byBranch as any[]).slice(0, 5)
      : [];

  const topOperators =
    reportsSummary &&
    reportsSummary.summaryTable &&
    Array.isArray(reportsSummary.summaryTable.byOperator)
      ? (reportsSummary.summaryTable.byOperator as any[]).slice(0, 5)
      : [];

  const topPaymentTypes =
    reportsSummary &&
    reportsSummary.summaryTable &&
    Array.isArray(reportsSummary.summaryTable.byPaymentType)
      ? (reportsSummary.summaryTable.byPaymentType as any[]).slice(0, 5)
      : [];

  const dailyStats =
    reportsSummary && Array.isArray(reportsSummary.daily)
      ? (reportsSummary.daily as any[]).slice(0, 7)
      : [];

  const getTransactionOperator = (tx: any): string => {
    const op =
      tx.operator ||
      tx.operatorName ||
      tx.operator_name ||
      (tx.segment &&
        (tx.segment.operator_name ||
          (typeof tx.segment.operator === 'string'
            ? tx.segment.operator
            : tx.segment.operator?.name ||
              tx.segment.operator?.label ||
              tx.segment.operator?.operator_name))) ||
      (tx.trip &&
        (tx.trip.operator_name ||
          (typeof tx.trip.operator === 'string'
            ? tx.trip.operator
            : tx.trip.operator?.name ||
              tx.trip.operator?.label ||
              tx.trip.operator?.operator_name))) ||
      (tx.purchase &&
        (tx.purchase.operator_name ||
          (tx.purchase.operator &&
            (tx.purchase.operator.name ||
              tx.purchase.operator.label ||
              tx.purchase.operator.operator_name)))) ||
      null;
    return op ? String(op) : '';
  };

  const getTransactionAgent = (tx: any): string => {
    const bookedBy =
      tx.bookedBy ||
      tx.booked_by ||
      tx.agentEmail ||
      tx.agent_email ||
      tx.agentName ||
      tx.agent_name ||
      tx.booker ||
      tx.bookerEmail ||
      tx.booker_email ||
      '';
    return bookedBy ? String(bookedBy) : '';
  };

  const getTransactionPaymentMethod = (tx: any): string => {
    const method = tx.paymentMethod || tx.method || tx.payment_type || tx.paymentType || '';
    return method ? String(method) : '';
  };

  const getTransactionPaidDate = (tx: any): string => {
    const paidOnRaw =
      tx.paidOn || tx.paid_on || tx.createdAt || tx.created_at || tx.date || tx.departureDate || null;
    if (!paidOnRaw) return '';
    const d = new Date(paidOnRaw);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
  };

  const transactionOperatorOptions = React.useMemo(() => {
    const set = new Set<string>();
    transactions.forEach((tx) => {
      const op = getTransactionOperator(tx);
      if (op) set.add(op);
    });
    return Array.from(set).sort();
  }, [transactions]);

  const transactionAgentOptions = React.useMemo(() => {
    const set = new Set<string>();
    transactions.forEach((tx) => {
      const ag = getTransactionAgent(tx);
      if (ag) set.add(ag);
    });
    return Array.from(set).sort();
  }, [transactions]);

  const transactionPaymentOptions = React.useMemo(() => {
    const set = new Set<string>();
    transactions.forEach((tx) => {
      const pm = getTransactionPaymentMethod(tx);
      if (pm) set.add(pm);
    });
    return Array.from(set).sort();
  }, [transactions]);

  const transactionDateOptions = React.useMemo(() => {
    const set = new Set<string>();
    transactions.forEach((tx) => {
      const d = getTransactionPaidDate(tx);
      if (d) set.add(d);
    });
    return Array.from(set).sort().reverse();
  }, [transactions]);

  const filteredTransactions = React.useMemo(
    () => {
      if (!transactions.length) return [];
      const opFilter = transactionsOperatorFilter.trim().toLowerCase();
      const agentFilter = transactionsAgentFilter.trim().toLowerCase();
      const paymentFilter = transactionsPaymentFilter.trim().toLowerCase();
      const dateFilter = transactionsDateFilter.trim();
      if (!opFilter && !agentFilter && !paymentFilter && !dateFilter) return transactions;

      return transactions.filter((tx) => {
        const operatorText = getTransactionOperator(tx).toLowerCase();
        const agentText = getTransactionAgent(tx).toLowerCase();
        const paymentText = getTransactionPaymentMethod(tx).toLowerCase();
        const dateText = getTransactionPaidDate(tx);

        const matchesOperator = !opFilter || operatorText === opFilter;
        const matchesAgent = !agentFilter || agentText === agentFilter;
        const matchesPayment = !paymentFilter || paymentText === paymentFilter;
        const matchesDate = !dateFilter || dateText === dateFilter;
        return matchesOperator && matchesAgent && matchesPayment && matchesDate;
      });
    },
    [
      transactions,
      transactionsOperatorFilter,
      transactionsAgentFilter,
      transactionsPaymentFilter,
      transactionsDateFilter,
    ]
  );

  const paginatedTransactions = React.useMemo(() => {
    const start = (transactionsPage - 1) * transactionsPageSize;
    return filteredTransactions.slice(start, start + transactionsPageSize);
  }, [filteredTransactions, transactionsPage, transactionsPageSize]);

  const transactionsTotalPages = React.useMemo(() => {
    if (filteredTransactions.length === 0) return 1;
    return Math.max(1, Math.ceil(filteredTransactions.length / transactionsPageSize));
  }, [filteredTransactions, transactionsPageSize]);

  useEffect(() => {
    setTransactionsPage(1);
  }, [filteredTransactions]);

  const handleTransactionsPrevPage = () => {
    setTransactionsPage((p) => Math.max(1, p - 1));
  };

  const handleTransactionsNextPage = () => {
    setTransactionsPage((p) => Math.min(transactionsTotalPages, p + 1));
  };

  const buildSummaryExportRows = () => {
    const rows: {
      section: string;
      metric: string;
      value: string | number | null;
      description: string;
    }[] = [];

    if (hasReportMetrics) {
      rows.push(
        {
          section: 'Summary',
          metric: 'Total Tickets Sold',
          value: typeof totalTickets === 'number' ? totalTickets : null,
          description: `Across all branches and operators (${rangeLabel})`,
        },
        {
          section: 'Summary',
          metric: 'Total Revenue',
          value: formattedRevenue ? `${formattedRevenue} ${primaryCurrency || ''}`.trim() : null,
          description: `Sum of ticket revenue in primary currency (${rangeLabel})`,
        },
        {
          section: 'Summary',
          metric: 'Active Branches',
          value: typeof branchesCount === 'number' ? branchesCount : null,
          description: `Branches with recorded ticket sales (${rangeLabel})`,
        },
      );
    }

    if (primaryCurrency && revenueByCurrency && typeof revenueByCurrency === 'object') {
      Object.entries(revenueByCurrency as Record<string, number>).forEach(([code, amount]) => {
        rows.push({
          section: 'Revenue by currency',
          metric: code,
          value: Number(amount || 0),
          description: code === primaryCurrency ? 'Primary currency' : '',
        });
      });
    }

    if (dailyStats.length > 0) {
      dailyStats.forEach((day: any) => {
        let dateLabel = '-';
        if (day && day.date) {
          const d = new Date(day.date);
          dateLabel = Number.isNaN(d.getTime()) ? String(day.date) : d.toLocaleDateString();
        }
        rows.push({
          section: 'Daily breakdown',
          metric: dateLabel,
          value: Number(day?.tickets || 0),
          description: `${Number(day?.revenue || 0).toLocaleString()} ${primaryCurrency || ''}`.trim(),
        });
      });
    }

    if (topBranches.length > 0) {
      topBranches.forEach((row: any) => {
        rows.push({
          section: 'Top branches',
          metric: row.label,
          value: Number(row.tickets || 0),
          description: `${Number(row.revenue || 0).toLocaleString()} ${primaryCurrency || ''}`.trim(),
        });
      });
    }

    if (topOperators.length > 0) {
      topOperators.forEach((row: any) => {
        rows.push({
          section: 'Top operators',
          metric: row.label,
          value: Number(row.tickets || 0),
          description: `${Number(row.revenue || 0).toLocaleString()} ${primaryCurrency || ''}`.trim(),
        });
      });
    }

    if (topPaymentTypes.length > 0) {
      topPaymentTypes.forEach((row: any) => {
        rows.push({
          section: 'Payment methods',
          metric: row.label,
          value: Number(row.tickets || 0),
          description: `${Number(row.revenue || 0).toLocaleString()} ${primaryCurrency || ''}`.trim(),
        });
      });
    }

    return rows;
  };

  const buildTransactionsExportRows = () => {
    return filteredTransactions.map((tx: any) => {
      const paidOnRaw =
        tx.paidOn ||
        tx.paid_on ||
        tx.createdAt ||
        tx.created_at ||
        tx.date ||
        null;
      let paidOn = '-';
      if (paidOnRaw) {
        const d = new Date(paidOnRaw);
        paidOn = Number.isNaN(d.getTime()) ? String(paidOnRaw) : d.toLocaleString();
      }

      const paidBy =
        tx.paidBy ||
        tx.paid_by ||
        tx.purchaserEmail ||
        tx.purchaser_email ||
        tx.email ||
        tx.userEmail ||
        '-';

      const bookedBy =
        tx.bookedBy ||
        tx.booked_by ||
        tx.agentEmail ||
        tx.agent_email ||
        tx.agentName ||
        tx.agent_name ||
        tx.booker ||
        tx.bookerEmail ||
        tx.booker_email ||
        '';

      const ticket =
        tx.ticket ||
        tx.reference ||
        tx.cartId ||
        tx.cart_id ||
        tx.transactionRef ||
        tx.transaction_ref ||
        '-';

      const primaryName = tx.name || tx.fullName || tx.full_name;
      const first = tx.firstName || tx.first_name;
      const last = tx.lastName || tx.last_name;
      const composedName = [first, last].filter(Boolean).join(' ');
      const passengerFromNested =
        tx.passenger &&
        (tx.passenger.name ||
          `${tx.passenger.firstName || ''} ${tx.passenger.lastName || ''}`.trim());
      const name =
        primaryName ||
        (composedName && composedName.trim()) ||
        (passengerFromNested && passengerFromNested.trim()) ||
        '-';

      const departure = tx.departure || tx.origin || tx.from || '-';

      const destination = tx.destination || tx.to || '-';

      const departureDateRaw =
        tx.departureDate ||
        tx.departure_date ||
        tx.departureTime ||
        tx.departure_time ||
        null;
      let departureDate = '-';
      if (departureDateRaw) {
        const d = new Date(departureDateRaw);
        departureDate = Number.isNaN(d.getTime())
          ? String(departureDateRaw)
          : d.toLocaleString();
      }

      const passengerType =
        tx.passengerType ||
        tx.passenger_type ||
        (tx.passenger && (tx.passenger.type || tx.passenger.category)) ||
        '-';

      const operator = getTransactionOperator(tx) || '-';

      const amountRaw =
        tx.amount ||
        tx.revenue ||
        tx.total ||
        tx.price ||
        null;
      let amountDisplay = '';
      if (amountRaw != null) {
        const n = typeof amountRaw === 'number' ? amountRaw : Number(amountRaw as any);
        if (!Number.isNaN(n)) {
          amountDisplay = n.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          });
        } else {
          amountDisplay = String(amountRaw);
        }
      }

      const currency = tx.currency || primaryCurrency || '';
      const paymentMethod =
        tx.paymentMethod || tx.method || tx.payment_type || tx.paymentType || '';
      const status = tx.status || '';

      return {
        paidOn,
        paidBy,
        bookedBy,
        ticket,
        name,
        operator,
        departure,
        destination,
        departureDate,
        passengerType,
        amount: amountDisplay,
        currency,
        paymentMethod,
        status,
      };
    });
  };

  const handleCopySummary = () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard || !reportsSummary) return;
    const rows = buildSummaryExportRows();
    if (!rows.length) return;

    const headers = ['Section', 'Metric', 'Value', 'Description'];
    const lines = rows.map(row => [
      row.section,
      row.metric,
      row.value ?? '',
      row.description,
    ].join('\t'));
    const text = [headers.join('\t'), ...lines].join('\n');
    navigator.clipboard.writeText(text).catch(() => {});
  };

  const handleExportSummaryCSV = () => {
    if (!reportsSummary) return;
    const rows = buildSummaryExportRows();
    if (!rows.length) return;
    const headers = ['Section', 'Metric', 'Value', 'Description'];
    const dataRows = rows.map(row => [
      row.section,
      row.metric,
      row.value,
      row.description,
    ]);
    downloadCSV('reports_summary.csv', headers, dataRows);
  };

  const handleExportReportsExcel = () => {
    if (!reportsSummary) return;
    const summaryRows = buildSummaryExportRows();
    const transactionRows = buildTransactionsExportRows();
    if (!summaryRows.length && !transactionRows.length) return;
    downloadReportsExcel(summaryRows, transactionRows);
  };

  const handleCopyTransactions = () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    if (!filteredTransactions.length) return;
    const rows = buildTransactionsExportRows();
    if (!rows.length) return;

    const headers = [
      'Paid on',
      'Paid by',
      'Booked by',
      'Ticket',
      'Name',
      'Operator',
      'Departure',
      'Destination',
      'Departure date',
      'Passenger type',
      'Payment method',
      'Status',
      'Amount',
      'Currency',
    ];
    const lines = rows.map(row => [
      row.paidOn,
      row.paidBy,
      row.bookedBy || '',
      row.ticket,
      row.name,
      row.operator,
      row.departure,
      row.destination,
      row.departureDate,
      row.passengerType,
      row.paymentMethod || '',
      row.status || '',
      row.amount,
      row.currency,
    ].join('\t'));
    const text = [headers.join('\t'), ...lines].join('\n');
    navigator.clipboard.writeText(text).catch(() => {});
  };

  const handleExportTransactionsCSV = () => {
    if (!filteredTransactions.length) return;
    const rows = buildTransactionsExportRows();
    if (!rows.length) return;
    const headers = [
      'Paid on',
      'Paid by',
      'Booked by',
      'Ticket',
      'Name',
      'Operator',
      'Departure',
      'Destination',
      'Departure date',
      'Passenger type',
      'Payment method',
      'Status',
      'Amount',
      'Currency',
    ];
    const dataRows = rows.map(row => [
      row.paidOn,
      row.paidBy,
      row.bookedBy || '',
      row.ticket,
      row.name,
      row.operator,
      row.departure,
      row.destination,
      row.departureDate,
      row.passengerType,
      row.paymentMethod || '',
      row.status || '',
      row.amount,
      row.currency,
    ]);
    downloadCSV('reports_transactions.csv', headers, dataRows);
  };

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);
        setConfigError(null);

        const meRes = await fetch(`${API_BASE}/api/auth/me`, { credentials: 'include' });
        if (!meRes.ok) {
          if (!cancelled) {
            setError('You are not signed in as an admin. Please log in via /admin/login.');
            setLoading(false);
          }
          return;
        }
        const meJson = await meRes.json().catch(() => null);
        if (!cancelled && meJson && meJson.success && meJson.user) {
          setMe(meJson.user as FirebaseUser);
        }

        const [admMeRes, adminsRes, configRes, agentsRes] = await Promise.all([
          fetch(`${API_BASE}/api/admins/me`, { credentials: 'include' }),
          fetch(`${API_BASE}/api/admins`, { credentials: 'include' }),
          fetch(`${API_BASE}/api/admin/config`, { credentials: 'include' }),
          fetch(`${API_BASE}/api/v1/agents`, { credentials: 'include' })
        ]);

        if (!cancelled) {
          if (admMeRes.ok) {
            const admMeJson = await admMeRes.json().catch(() => null);
            if (admMeJson && admMeJson.success && admMeJson.data) {
              setAdminRecord(admMeJson.data as AdminRecord);
            }
          }
          if (adminsRes.ok) {
            const adminsJson = await adminsRes.json().catch(() => null);
            if (adminsJson && adminsJson.success && Array.isArray(adminsJson.data)) {
              setAdmins(adminsJson.data as AdminRecord[]);
            }
          }
          if (configRes.ok) {
            const cfgJson = await configRes.json().catch(() => null);
            if (cfgJson && cfgJson.success && cfgJson.data) {
              if (Array.isArray(cfgJson.data.middlewares)) {
                setMiddlewares(cfgJson.data.middlewares as MiddlewareFlag[]);
              }
              const pricingData = (cfgJson.data.settings && cfgJson.data.settings.pricing) || cfgJson.data.pricing;
              if (pricingData) {
                const p: any = pricingData;
                const normalized: PricingSettings = {
                  commission: Number(p.commission ?? p.percentage) || 0,
                  fixed: Number(p.fixed) || 0,
                  roundToNearest: Number(p.roundToNearest) || 0,
                  apply: !!p.apply,
                  discount: Number(p.discount) || 0,
                  markup: Number(p.markup) || 0,
                  charges: Number(p.charges) || 0,
                };
                setPricing(normalized);
              }
              // Load ads configuration from localStorage (frontend-only)
              setAds(getConfiguredAds());
            } else {
              setConfigError('Failed to load configuration');
            }
          } else {
            setConfigError('Failed to load configuration');
          }

          setAgentsLoading(true);
          setAgentsError(null);
          if (agentsRes.ok) {
            const agentsJson = await agentsRes.json().catch(() => null);
            if (agentsJson && agentsJson.success && Array.isArray(agentsJson.data)) {
              setAgents(agentsJson.data as AgentRecord[]);
            } else {
              setAgentsError('Failed to load agents');
            }
          } else {
            setAgentsError('Failed to load agents');
          }
          setAgentsLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError('Failed to load admin data. Please try again.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (activeSection !== 'reports') return;

    let cancelled = false;

    async function loadReports() {
      try {
        setReportsLoading(true);
        setReportsError(null);

        const res = await fetch(`${API_BASE}/api/admin/reports?type=sales-summary&range=7d`, {
          credentials: 'include',
        });
        if (!res.ok) {
          throw new Error('Failed to load reports');
        }

        const json: any = await res.json().catch(() => null);
        console.log('[AdminDashboard] Reports response', json);
        if (!json || json.success === false || !json.data || typeof json.data !== 'object') {
          throw new Error(json?.message || 'Failed to load reports');
        }

        const data: any = json.data;

        const metricsBranchesObject =
          data?.rangeTotals?.perBranch ??
          data?.perBranch ??
          {};

        const metricsTotalTickets =
          (data?.rangeTotals?.totalTickets ??
            data?.totalTicketsSold ??
            0) as number;

        const metricsTotalRevenue =
          (data?.rangeTotals?.totalRevenue ??
            data?.totalRevenue ??
            0) as number;

        const metricsBranchesCount =
          metricsBranchesObject ? Object.keys(metricsBranchesObject).length : 0;

        const metricsRevenueByCurrency =
          data?.rangeTotals?.revenueByCurrency ??
          data?.revenueByCurrency ??
          {};

        const metricsPrimaryCurrency =
          metricsRevenueByCurrency && typeof metricsRevenueByCurrency === 'object'
            ? Object.keys(metricsRevenueByCurrency)[0]
            : undefined;

        const rawRangeKey = data?.range && data.range.key;
        const metricsRangeLabel = (() => {
          if (!rawRangeKey) return 'last 7 days';
          switch (rawRangeKey) {
            case 'today':
              return 'today';
            case '7d':
              return 'last 7 days';
            case '30d':
              return 'last 30 days';
            case 'all':
              return 'all time';
            default:
              return String(rawRangeKey);
          }
        })();

        if (!cancelled) {
          setReportsSummary(data);
          setReportMetrics({
            totalTickets: metricsTotalTickets,
            totalRevenue: metricsTotalRevenue,
            branchesCount: metricsBranchesCount,
            primaryCurrency: metricsPrimaryCurrency,
            rangeLabel: metricsRangeLabel,
          });
        }
      } catch (e: any) {
        if (!cancelled) {
          const message =
            (e && typeof e === 'object' && 'message' in e && (e as any).message) ||
            'Failed to load reports';
          setReportsError(String(message));
        }
      } finally {
        if (!cancelled) {
          setReportsLoading(false);
        }
      }
    }

    async function loadTransactions() {
      try {
        setTransactionsLoading(true);
        setTransactionsError(null);

        const res = await fetch(
          `${API_BASE}/api/admin/reports/transactions?range=7d&limit=500`,
          {
            credentials: 'include',
          }
        );
        if (!res.ok) {
          throw new Error('Failed to load transactions');
        }

        const json: any = await res.json().catch(() => null);
        console.log('[AdminDashboard] Transactions response', json);
        if (!json || json.success === false) {
          throw new Error(json?.message || 'Failed to load transactions');
        }

        const data: any = json.data;
        let rows: any[] = [];

        if (Array.isArray(data)) {
          rows = data;
        } else if (data && Array.isArray(data.rows)) {
          rows = data.rows;
        } else if (data && Array.isArray(data.transactions)) {
          rows = data.transactions;
        } else {
          rows = [];
        }

        if (!cancelled) {
          setTransactions(rows);
        }
      } catch (e: any) {
        if (!cancelled) {
          const message =
            (e && typeof e === 'object' && 'message' in e && (e as any).message) ||
            'Failed to load transactions';
          setTransactionsError(String(message));
        }
      } finally {
        if (!cancelled) {
          setTransactionsLoading(false);
        }
      }
    }

    loadReports();
    loadTransactions();

    return () => {
      cancelled = true;
    };
  }, [activeSection]);

  useEffect(() => {
    if (activeSection !== 'reports' || reportsView !== 'profitability') return;

    let cancelled = false;

    async function loadProfitability() {
      try {
        setProfitabilityLoading(true);
        setProfitabilityError(null);

        const body = {
          range: '7d',
          dimensions: ['operator', 'branch', 'paymentType'],
          metrics: ['payments', 'tickets', 'revenue'],
          filters: [
            {
              field: 'status',
              op: 'eq',
              value: 'completed',
            },
          ],
          sort: [
            {
              field: 'revenue',
              direction: 'desc',
            },
          ],
          limit: 100,
        };

        const res = await fetch(`${API_BASE}/api/admin/reports/engine`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          throw new Error('Failed to load profitability report');
        }

        const json: any = await res.json().catch(() => null);
        console.log('[AdminDashboard] Profitability report response', json);
        if (!json || json.success === false || !json.data || typeof json.data !== 'object') {
          throw new Error(json?.message || 'Failed to load profitability report');
        }

        if (!cancelled) {
          setProfitabilityReport(json.data);
        }
      } catch (e: any) {
        if (!cancelled) {
          const message =
            (e && typeof e === 'object' && 'message' in e && (e as any).message) ||
            'Failed to load profitability report';
          setProfitabilityError(String(message));
        }
      } finally {
        if (!cancelled) {
          setProfitabilityLoading(false);
        }
      }
    }

    loadProfitability();

    return () => {
      cancelled = true;
    };
  }, [activeSection, reportsView]);

  const handleApproveAgent = async (agentId: string) => {
    try {
      setApprovingAgentId(agentId);
      setAgentsError(null);
      const res = await fetch(`${API_BASE}/api/v1/agents/${agentId}/approve`, {
        method: 'POST',
        credentials: 'include',
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || json.success === false) {
        throw new Error(json?.message || 'Failed to activate agent');
      }
      setAgents(prev => prev.map(a => a.id === agentId ? { ...a, active: true } : a));
    } catch (e: any) {
      setAgentsError(e?.message || 'Failed to activate agent');
    } finally {
      setApprovingAgentId(null);
    }
  };

  const handleDeleteAgent = async (agentId: string) => {
    try {
      setDeletingAgentId(agentId);
      setAgentsError(null);
      const res = await fetch(`${API_BASE}/api/v1/agents/${agentId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || json.success === false) {
        throw new Error(json?.message || 'Failed to delete agent');
      }
      setAgents(prev => prev.filter(a => a.id !== agentId));
      setConfirmDeleteOpen(false);
      setConfirmDeleteAgent(null);
    } catch (e: any) {
      setAgentsError(e?.message || 'Failed to delete agent');
    } finally {
      setDeletingAgentId(null);
    }
  };

  const handleDeactivateAgent = async (agentId: string) => {
    try {
      setDeactivatingAgentId(agentId);
      setAgentsError(null);
      const res = await fetch(`${API_BASE}/api/v1/agents/${agentId}/deactivate`, {
        method: 'POST',
        credentials: 'include',
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || json.success === false) {
        throw new Error(json?.message || 'Failed to deactivate agent');
      }
      setAgents(prev => prev.map(a => a.id === agentId ? { ...a, active: false } : a));
      setConfirmDeactivateOpen(false);
      setConfirmDeactivateAgent(null);
    } catch (e: any) {
      setAgentsError(e?.message || 'Failed to deactivate agent');
    } finally {
      setDeactivatingAgentId(null);
    }
  };

  const openDeactivateModal = (agent: AgentRecord) => {
    setConfirmDeactivateAgent(agent);
    setConfirmDeactivateOpen(true);
  };

  const closeDeactivateModal = () => {
    if (confirmDeactivateAgent && deactivatingAgentId === confirmDeactivateAgent.id) return;
    setConfirmDeactivateOpen(false);
    setConfirmDeactivateAgent(null);
  };

  const openDeleteModal = (agent: AgentRecord) => {
    setConfirmDeleteAgent(agent);
    setConfirmDeleteOpen(true);
  };

  const closeDeleteModal = () => {
    if (confirmDeleteAgent && deletingAgentId === confirmDeleteAgent.id) return;
    setConfirmDeleteOpen(false);
    setConfirmDeleteAgent(null);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-gray-700 dark:text-gray-200 text-sm">Loading admin dashboard...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
        <div className="max-w-md w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow p-6">
          <h1 className="text-lg font-semibold text-red-600 dark:text-red-400 mb-2">Admin access required</h1>
          <p className="text-sm text-gray-700 dark:text-gray-200 mb-4">{error}</p>
          <a
            href="/admin/login?next=/admin-dashboard"
            className="inline-flex items-center justify-center rounded-md bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700"
          >
            Go to Admin Login
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-gradient-to-br from-purple-50 via-white to-purple-100 dark:bg-gray-900 px-4 py-4 overflow-y-hidden">
      <div className="h-full w-full flex flex-col md:flex-row gap-6">
        <aside className="md:w-64 lg:w-72 md:flex-shrink-0 md:sticky md:top-4 mb-4 md:mb-0">
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm">
            <div className="px-4 py-3 flex items-center justify-between md:block">
              <div>
                <div className="text-xs font-semibold tracking-wide text-purple-600 dark:text-purple-300 uppercase">
                  Admin
                </div>
                <div className="text-sm font-bold text-gray-900 dark:text-gray-50">
                  Dashboard navigation
                </div>
              </div>
              <button
                type="button"
                className="md:hidden inline-flex items-center rounded-md px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
                onClick={() => setSidebarOpen(prev => !prev)}
              >
                Menu
              </button>
            </div>
            <nav className={`px-2 pb-3 space-y-1 ${sidebarOpen ? 'block' : 'hidden'} md:block`}>
              <button
                type="button"
                onClick={() => { setActiveSection('overview'); setSidebarOpen(false); }}
                className="w-full text-left rounded-md px-3 py-2.5 text-sm font-medium text-purple-800 hover:bg-purple-50 hover:text-purple-700 dark:text-purple-100 dark:hover:bg-gray-800/80"
              >
                Overview
              </button>
              <button
                type="button"
                onClick={() => { setActiveSection('middleware'); setSidebarOpen(false); }}
                className="w-full text-left rounded-md px-3 py-2.5 text-sm font-medium text-purple-800 hover:bg-purple-50 hover:text-purple-700 dark:text-purple-100 dark:hover:bg-gray-800/80"
              >
                Middleware
              </button>
              <button
                type="button"
                onClick={() => { setActiveSection('pricing'); setSidebarOpen(false); }}
                className="w-full text-left rounded-md px-3 py-2.5 text-sm font-medium text-purple-800 hover:bg-purple-50 hover:text-purple-700 dark:text-purple-100 dark:hover:bg-gray-800/80"
              >
                Pricing
              </button>
              <button
                type="button"
                onClick={() => { setActiveSection('ads'); setSidebarOpen(false); }}
                className="w-full text-left rounded-md px-3 py-2.5 text-sm font-medium text-purple-800 hover:bg-purple-50 hover:text-purple-700 dark:text-purple-100 dark:hover:bg-gray-800/80"
              >
                Ads
              </button>
              <button
                type="button"
                onClick={() => { setActiveSection('admins'); setSidebarOpen(false); }}
                className="w-full text-left rounded-md px-3 py-2.5 text-sm font-medium text-purple-800 hover:bg-purple-50 hover:text-purple-700 dark:text-purple-100 dark:hover:bg-gray-800/80"
              >
                Admin accounts
              </button>
              <div className="space-y-0.5">
                <button
                  type="button"
                  onClick={() => {
                    setReportsNavOpen(prev => !prev);
                    setActiveSection('reports');
                    setReportsView('summary');
                  }}
                  className="w-full flex items-center justify-between rounded-md px-3 py-2.5 text-sm font-medium text-purple-800 hover:bg-purple-50 hover:text-purple-700 dark:text-purple-100 dark:hover:bg-gray-800/80"
                >
                  <span>Reports</span>
                  <span
                    className={`ml-2 text-[11px] text-gray-500 dark:text-gray-400 transform transition-transform ${
                      reportsNavOpen ? 'rotate-90' : ''
                    }`}
                  >
                    ▸
                  </span>
                </button>
                {reportsNavOpen && (
                  <div className="ml-4 space-y-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveSection('reports');
                        setReportsView('summary');
                        setSidebarOpen(false);
                      }}
                      className="w-full text-left rounded-md px-3 py-1.5 text-xs font-medium text-purple-800 hover:bg-purple-50 hover:text-purple-700 dark:text-purple-100 dark:hover:bg-gray-800/80"
                    >
                      Sales summary
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveSection('reports');
                        setReportsView('profitability');
                        setSidebarOpen(false);
                      }}
                      className="w-full text-left rounded-md px-3 py-1.5 text-xs font-medium text-purple-800 hover:bg-purple-50 hover:text-purple-700 dark:text-purple-100 dark:hover:bg-gray-800/80"
                    >
                      Profitability
                    </button>
                  </div>
                )}
              </div>
            </nav>
          </div>
        </aside>

        <main className="flex-1 overflow-y-auto">
          <header className="sticky top-0 z-10 mb-4 bg-purple-50/80 dark:bg-gray-900/80 backdrop-blur border-b border-purple-200/80 dark:border-purple-500/40">
            <div className="flex items-center justify-between px-2 py-2 md:px-4">
              <div>
                <p className="text-[11px] font-semibold tracking-wide text-gray-500 dark:text-gray-400 uppercase">
                  Admin / Dashboard
                </p>
                <h1 className="mt-0.5 text-xl md:text-2xl font-bold text-gray-900 dark:text-gray-50">Admin Dashboard</h1>
              </div>
              {me && (
                <div className="flex items-center gap-3">
                  {me.picture && (
                    <img
                      src={me.picture}
                      alt={me.email || me.name || 'Admin'}
                      className="h-8 w-8 md:h-9 md:w-9 rounded-full object-cover border border-gray-200 dark:border-gray-700"
                    />
                  )}
                  <div className="text-right">
                    <div className="text-xs md:text-sm font-semibold text-gray-900 dark:text-gray-50">
                      {me.email || me.name || 'Admin'}
                    </div>
                    <div className="text-[11px] text-gray-600 dark:text-gray-300">
                      {me.email_verified ? 'Email verified' : 'Email not verified'}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </header>

          {activeSection === 'overview' && (
          <section id="overview" className="mb-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="relative overflow-hidden rounded-xl bg-white dark:bg-gray-800 shadow-sm border border-gray-200 dark:border-gray-700">
                <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-purple-500 via-pink-500 to-amber-400" />
                <div className="p-5 flex items-center justify-between">
                  <div>
                    <div className="text-xs md:text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                      Total Admins
                    </div>
                    <div className="mt-2 text-3xl font-bold text-gray-900 dark:text-gray-50">
                      {admins.length}
                    </div>
                    <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      All registered admin accounts
                    </div>
                  </div>
                  <div className="ml-4 h-12 w-12 rounded-full bg-purple-50 dark:bg-purple-900/30 flex items-center justify-center">
                    <span className="text-sm font-semibold text-purple-600 dark:text-purple-300">A</span>
                  </div>
                </div>
              </div>

              <div className="relative overflow-hidden rounded-xl bg-white dark:bg-gray-800 shadow-sm border border-gray-200 dark:border-gray-700">
                <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-emerald-400 to-teal-500" />
                <div className="p-5 flex items-center justify-between">
                  <div>
                    <div className="text-xs md:text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                      Active Admins
                    </div>
                    <div className="mt-2 text-3xl font-bold text-gray-900 dark:text-gray-50">
                      {admins.filter(a => a.active !== false).length}
                    </div>
                    <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      Currently active admins
                    </div>
                  </div>
                  <div className="ml-4 h-12 w-12 rounded-full bg-emerald-50 dark:bg-emerald-900/30 flex items-center justify-center">
                    <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-300">✓</span>
                  </div>
                </div>
              </div>

              <div className="relative overflow-hidden rounded-xl bg-white dark:bg-gray-800 shadow-sm border border-gray-200 dark:border-gray-700">
                <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-sky-400 to-indigo-500" />
                <div className="p-5 flex items-center justify-between">
                  <div>
                    <div className="text-xs md:text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                      Your Status
                    </div>
                    <div className="mt-2 text-base md:text-lg font-semibold text-gray-900 dark:text-gray-50">
                      {adminRecord?.active === false ? 'Inactive' : 'Active admin'}
                    </div>
                    <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      {adminRecord?.email || me?.email || '-'}
                    </div>
                  </div>
                  <div className="ml-4 h-12 w-12 rounded-full bg-sky-50 dark:bg-sky-900/30 flex items-center justify-center">
                    <span className="text-sm font-semibold text-sky-600 dark:text-sky-300">You</span>
                  </div>
                </div>
              </div>
            </div>
          </section>
          )}

          {activeSection !== 'overview' && configError && (
            <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
              {configError}
            </div>
          )}

          {activeSection === 'reports' && (
          <section id="reports" className="mb-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-50">Reports</h2>
              <div className="flex items-center gap-2">
                {reportsLoading && (
                  <span className="text-xs text-gray-500 dark:text-gray-400">Loading...</span>
                )}
                {reportsSummary && !reportsLoading && (
                  <>
                    <button
                      type="button"
                      onClick={handleCopySummary}
                      className="inline-flex items-center rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
                    >
                      Copy
                    </button>
                    <button
                      type="button"
                      onClick={handleExportSummaryCSV}
                      className="inline-flex items-center rounded-md border border-purple-200 bg-purple-50 px-2 py-1 text-[11px] font-medium text-purple-700 hover:bg-purple-100 dark:border-purple-500/60 dark:bg-purple-900/30 dark:text-purple-100 dark:hover:bg-purple-900/60"
                    >
                      CSV
                    </button>
                    <button
                      type="button"
                      onClick={handleExportReportsExcel}
                      className="inline-flex items-center rounded-md border border-purple-200 bg-purple-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-purple-700 dark:border-purple-500/60"
                    >
                      Excel
                    </button>
                  </>
                )}
              </div>
            </div>
            {reportsError && (
              <div className="px-4 py-2 text-xs text-red-800 bg-red-50 border-b border-red-200 dark:bg-red-950/40 dark:border-red-900/60 dark:text-red-200">
                {reportsError}
              </div>
            )}
            {reportsSummary && (
              <div className="px-4 pt-2 text-[10px] text-gray-500 dark:text-gray-400">
                Debug totals: tickets={String(totalTickets)} | revenue={String(totalRevenue)} | branches={String(branchesCount)} | range={rangeLabel}
              </div>
            )}
            <div className="px-4 py-3 text-xs md:text-sm">
              <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-800/80">
                    <tr>
                      <th scope="col" className="px-3 py-2 text-left text-[11px] font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">
                        Metric
                      </th>
                      <th scope="col" className="px-3 py-2 text-right text-[11px] font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">
                        Value
                      </th>
                      <th scope="col" className="px-3 py-2 text-left text-[11px] font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">
                        Description
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {!hasReportMetrics ? (
                      <tr>
                        <td
                          colSpan={3}
                          className="px-3 py-3 text-[11px] text-gray-600 dark:text-gray-300 text-center"
                        >
                          No report data available.
                        </td>
                      </tr>
                    ) : (
                      <>
                        <tr>
                          <td className="px-3 py-2 text-[11px] font-medium text-gray-900 dark:text-gray-50">
                            Total Tickets Sold
                          </td>
                          <td className="px-3 py-2 text-[11px] text-right text-gray-900 dark:text-gray-50">
                            {typeof totalTickets === 'number'
                              ? totalTickets.toLocaleString()
                              : ''}
                          </td>
                          <td className="px-3 py-2 text-[11px] text-gray-600 dark:text-gray-300">
                            Across all branches and operators ({rangeLabel})
                          </td>
                        </tr>
                        <tr>
                          <td className="px-3 py-2 text-[11px] font-medium text-gray-900 dark:text-gray-50">
                            Total Revenue
                          </td>
                          <td className="px-3 py-2 text-[11px] text-right text-gray-900 dark:text-gray-50">
                            {formattedRevenue ?? ''} {primaryCurrency || ''}
                          </td>
                          <td className="px-3 py-2 text-[11px] text-gray-600 dark:text-gray-300">
                            Sum of ticket revenue in primary currency ({rangeLabel})
                          </td>
                        </tr>
                        <tr>
                          <td className="px-3 py-2 text-[11px] font-medium text-gray-900 dark:text-gray-50">
                            Active Branches
                          </td>
                          <td className="px-3 py-2 text-[11px] text-right text-gray-900 dark:text-gray-50">
                            {typeof branchesCount === 'number'
                              ? branchesCount.toLocaleString()
                              : ''}
                          </td>
                          <td className="px-3 py-2 text-[11px] text-gray-600 dark:text-gray-300">
                            Branches with recorded ticket sales ({rangeLabel})
                          </td>
                        </tr>
                      </>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

                {primaryCurrency && revenueByCurrency && (
              <div className="px-4 pb-3">
                <div className="mt-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm">
                  <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                    <h3 className="text-xs font-semibold text-gray-900 dark:text-gray-50">Revenue by currency</h3>
                  </div>
                  <div className="px-3 py-2 grid grid-cols-1 md:grid-cols-3 gap-2 text-xs text-gray-700 dark:text-gray-200">
                    {Object.entries(revenueByCurrency as Record<string, number>).map(([code, amount]) => (
                      <div key={code} className="flex items-baseline justify-between">
                        <span className="font-medium text-gray-600 dark:text-gray-300">{code}</span>
                        <span>
                          {Number(amount || 0).toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
                )}

                {dailyStats.length > 0 && (
              <div className="px-4 pb-4">
                <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm">
                  <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                    <h3 className="text-xs font-semibold text-gray-900 dark:text-gray-50">Daily breakdown</h3>
                    <span className="text-[11px] text-gray-500 dark:text-gray-400">{rangeLabel}</span>
                  </div>
                  <div className="px-3 py-2 text-xs text-gray-700 dark:text-gray-200">
                    <div className="grid grid-cols-3 gap-2 mb-1 font-medium text-[11px] text-gray-500 dark:text-gray-300">
                      <span>Date</span>
                      <span className="text-right">Tickets</span>
                      <span className="text-right">Revenue</span>
                    </div>
                    <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                      {dailyStats.map((day: any) => {
                        const dateLabel = (() => {
                          if (!day || !day.date) return '-';
                          const d = new Date(day.date);
                          if (Number.isNaN(d.getTime())) return String(day.date);
                          return d.toLocaleDateString();
                        })();
                        return (
                          <li key={day.date || dateLabel} className="flex items-center justify-between py-1.5">
                            <span className="text-[11px] text-gray-700 dark:text-gray-200 truncate mr-2">{dateLabel}</span>
                            <span className="text-[11px] text-gray-700 dark:text-gray-200 text-right flex-1">
                              {Number(day?.tickets || 0).toLocaleString()}
                            </span>
                            <span className="text-[11px] font-medium text-gray-900 dark:text-gray-50 text-right flex-1">
                              {Number(day?.revenue || 0).toLocaleString()} {primaryCurrency || ''}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </div>
              </div>
                )}

                {reportsSummary && reportsSummary.summaryTable && (
              <div className="px-4 pb-4 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs md:text-sm">
                <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm">
                  <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                    <h3 className="text-xs font-semibold text-gray-900 dark:text-gray-50">Top branches</h3>
                  </div>
                  <div className="px-3 py-2">
                    {topBranches.length === 0 ? (
                      <div className="text-[11px] text-gray-500 dark:text-gray-300">No branch data</div>
                    ) : (
                      <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                        {topBranches.map((row: any) => (
                          <li key={row.key} className="flex items-center justify-between py-1.5">
                            <span className="text-[11px] text-gray-700 dark:text-gray-200 truncate mr-2">{row.label}</span>
                            <div className="flex flex-col items-end">
                              <span className="text-[11px] font-medium text-gray-900 dark:text-gray-50">
                                {Number(row.tickets || 0).toLocaleString()} tickets
                              </span>
                              <span className="text-[11px] text-gray-500 dark:text-gray-400">
                                {Number(row.revenue || 0).toLocaleString()} {primaryCurrency || ''}
                              </span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>

                <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm">
                  <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                    <h3 className="text-xs font-semibold text-gray-900 dark:text-gray-50">Top operators</h3>
                  </div>
                  <div className="px-3 py-2">
                    {topOperators.length === 0 ? (
                      <div className="text-[11px] text-gray-500 dark:text-gray-300">No operator data</div>
                    ) : (
                      <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                        {topOperators.map((row: any) => (
                          <li key={row.key} className="flex items-center justify-between py-1.5">
                            <span className="text-[11px] text-gray-700 dark:text-gray-200 truncate mr-2">{row.label}</span>
                            <div className="flex flex-col items-end">
                              <span className="text-[11px] font-medium text-gray-900 dark:text-gray-50">
                                {Number(row.tickets || 0).toLocaleString()} tickets
                              </span>
                              <span className="text-[11px] text-gray-500 dark:text-gray-400">
                                {Number(row.revenue || 0).toLocaleString()} {primaryCurrency || ''}
                              </span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>

                <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm">
                  <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                    <h3 className="text-xs font-semibold text-gray-900 dark:text-gray-50">Payment methods</h3>
                  </div>
                  <div className="px-3 py-2">
                    {topPaymentTypes.length === 0 ? (
                      <div className="text-[11px] text-gray-500 dark:text-gray-300">No payment data</div>
                    ) : (
                      <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                        {topPaymentTypes.map((row: any) => (
                          <li key={row.key} className="flex items-center justify-between py-1.5">
                            <span className="text-[11px] text-gray-700 dark:text-gray-200 truncate mr-2">{row.label}</span>
                            <div className="flex flex-col items-end">
                              <span className="text-[11px] font-medium text-gray-900 dark:text-gray-50">
                                {Number(row.tickets || 0).toLocaleString()} tickets
                              </span>
                              <span className="text-[11px] text-gray-500 dark:text-gray-400">
                                {Number(row.revenue || 0).toLocaleString()} {primaryCurrency || ''}
                              </span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
                )}

                <div className="px-4 pb-4">
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm">
                <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-gray-900 dark:text-gray-50">
                    Transactions (per passenger)
                  </h3>
                  <div className="flex items-center gap-2">
                    {transactionsLoading && (
                      <span className="text-[11px] text-gray-500 dark:text-gray-400">Loading...</span>
                    )}
                    {!transactionsLoading && filteredTransactions.length > 0 && (
                      <>
                        <button
                          type="button"
                          onClick={handleCopyTransactions}
                          className="inline-flex items-center rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
                        >
                          Copy
                        </button>
                        <button
                          type="button"
                          onClick={handleExportTransactionsCSV}
                          className="inline-flex items-center rounded-md border border-purple-200 bg-purple-50 px-2 py-1 text-[11px] font-medium text-purple-700 hover:bg-purple-100 dark:border-purple-500/60 dark:bg-purple-900/30 dark:text-purple-100 dark:hover:bg-purple-900/60"
                        >
                          CSV
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {transactionsError && (
                  <div className="px-3 py-2 text-[11px] text-red-800 bg-red-50 border-b border-red-200 dark:bg-red-950/40 dark:border-red-900/60 dark:text-red-200">
                    {transactionsError}
                  </div>
                )}
                {!transactionsLoading && transactions.length > 0 && (
                  <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div className="text-[11px] font-medium text-gray-700 dark:text-gray-200">
                      Filters
                    </div>
                    <div className="flex flex-col gap-2 md:flex-row md:gap-3 w-full md:w-auto">
                      <div className="flex flex-col gap-1 md:w-48">
                        <label className="text-[11px] font-medium text-gray-600 dark:text-gray-300">
                          Operator
                        </label>
                        <select
                          value={transactionsOperatorFilter}
                          onChange={(e) => setTransactionsOperatorFilter(e.target.value)}
                          className="w-full rounded-md border border-gray-300 px-2 py-1 text-[11px] text-gray-900 focus:outline-none focus:ring-1 focus:ring-purple-500 focus:border-purple-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                        >
                          <option value="">All operators</option>
                          {transactionOperatorOptions.map((opt) => (
                            <option key={opt} value={opt.toLowerCase()}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex flex-col gap-1 md:w-48">
                        <label className="text-[11px] font-medium text-gray-600 dark:text-gray-300">
                          Agent
                        </label>
                        <select
                          value={transactionsAgentFilter}
                          onChange={(e) => setTransactionsAgentFilter(e.target.value)}
                          className="w-full rounded-md border border-gray-300 px-2 py-1 text-[11px] text-gray-900 focus:outline-none focus:ring-1 focus:ring-purple-500 focus:border-purple-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                        >
                          <option value="">All agents</option>
                          {transactionAgentOptions.map((opt) => (
                            <option key={opt} value={opt.toLowerCase()}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex flex-col gap-1 md:w-48">
                        <label className="text-[11px] font-medium text-gray-600 dark:text-gray-300">
                          Payment method
                        </label>
                        <select
                          value={transactionsPaymentFilter}
                          onChange={(e) => setTransactionsPaymentFilter(e.target.value)}
                          className="w-full rounded-md border border-gray-300 px-2 py-1 text-[11px] text-gray-900 focus:outline-none focus:ring-1 focus:ring-purple-500 focus:border-purple-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                        >
                          <option value="">All methods</option>
                          {transactionPaymentOptions.map((opt) => (
                            <option key={opt} value={opt.toLowerCase()}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex flex-col gap-1 md:w-48">
                        <label className="text-[11px] font-medium text-gray-600 dark:text-gray-300">
                          Date (paid)
                        </label>
                        <select
                          value={transactionsDateFilter}
                          onChange={(e) => setTransactionsDateFilter(e.target.value)}
                          className="w-full rounded-md border border-gray-300 px-2 py-1 text-[11px] text-gray-900 focus:outline-none focus:ring-1 focus:ring-purple-500 focus:border-purple-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                        >
                          <option value="">All dates</option>
                          {transactionDateOptions.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                )}
                <div className="px-3 py-2 overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-[11px]">
                    <thead className="bg-gray-50 dark:bg-gray-800/80">
                      <tr>
                        <th className="px-2 py-2 text-left font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">
                          Paid on
                        </th>
                        <th className="px-2 py-2 text-left font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">
                          Paid by
                        </th>
                        <th className="px-2 py-2 text-left font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">
                          Booked by
                        </th>
                        <th className="px-2 py-2 text-left font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">
                          Ticket
                        </th>
                        <th className="px-2 py-2 text-left font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">
                          Name
                        </th>
                        <th className="px-2 py-2 text-left font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">
                          Operator
                        </th>
                        <th className="px-2 py-2 text-left font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">
                          Departure
                        </th>
                        <th className="px-2 py-2 text-left font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">
                          Destination
                        </th>
                        <th className="px-2 py-2 text-left font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">
                          Departure date
                        </th>
                        <th className="px-2 py-2 text-left font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">
                          Passenger type
                        </th>
                        <th className="px-2 py-2 text-left font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">
                          Payment method
                        </th>
                        <th className="px-2 py-2 text-left font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">
                          Status
                        </th>
                        <th className="px-2 py-2 text-right font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">
                          Amount
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {paginatedTransactions.length === 0 ? (
                        <tr>
                          <td
                            colSpan={12}
                            className="py-3 text-center text-xs text-gray-500 dark:text-gray-400"
                          >
                            No transactions found for this range.
                          </td>
                        </tr>
                      ) : (
                        paginatedTransactions.map((tx: any, idx: number) => {
                          const paidOnRaw =
                            tx.paidOn ||
                            tx.paid_on ||
                            tx.createdAt ||
                            tx.created_at ||
                            tx.date ||
                            null;
                          let paidOn = '-';
                          if (paidOnRaw) {
                            const d = new Date(paidOnRaw);
                            paidOn = Number.isNaN(d.getTime()) ? String(paidOnRaw) : d.toLocaleString();
                          }

                          const paidBy =
                            tx.paidBy ||
                            tx.paid_by ||
                            tx.purchaserEmail ||
                            tx.purchaser_email ||
                            tx.email ||
                            tx.userEmail ||
                            '-';

                          const bookedBy =
                            tx.bookedBy ||
                            tx.booked_by ||
                            tx.agentEmail ||
                            tx.agent_email ||
                            tx.agentName ||
                            tx.agent_name ||
                            tx.booker ||
                            tx.bookerEmail ||
                            tx.booker_email ||
                            '';

                          const ticket =
                            tx.ticket ||
                            tx.reference ||
                            tx.cartId ||
                            tx.cart_id ||
                            tx.transactionRef ||
                            tx.transaction_ref ||
                            '-';

                          const primaryName = tx.name || tx.fullName || tx.full_name;
                          const first = tx.firstName || tx.first_name;
                          const last = tx.lastName || tx.last_name;
                          const composedName = [first, last].filter(Boolean).join(' ');
                          const passengerFromNested =
                            tx.passenger &&
                            (tx.passenger.name ||
                              `${tx.passenger.firstName || ''} ${tx.passenger.lastName || ''}`.trim());
                          const name =
                            primaryName ||
                            (composedName && composedName.trim()) ||
                            (passengerFromNested && passengerFromNested.trim()) ||
                            '-';

                          const departure =
                            tx.departure ||
                            tx.origin ||
                            tx.from ||
                            '-';

                          const destination =
                            tx.destination ||
                            tx.to ||
                            '-';

                          const departureDateRaw =
                            tx.departureDate ||
                            tx.departure_date ||
                            tx.departureTime ||
                            tx.departure_time ||
                            null;
                          let departureDate = '-';
                          if (departureDateRaw) {
                            const d = new Date(departureDateRaw);
                            departureDate = Number.isNaN(d.getTime())
                              ? String(departureDateRaw)
                              : d.toLocaleString();
                          }

                          const passengerType =
                            tx.passengerType ||
                            tx.passenger_type ||
                            (tx.passenger && (tx.passenger.type || tx.passenger.category)) ||
                            '-';

                          const operator = getTransactionOperator(tx) || '-';

                          const amountRaw =
                            tx.amount ||
                            tx.revenue ||
                            tx.total ||
                            tx.price ||
                            null;
                          let amountDisplay = '';
                          if (amountRaw != null) {
                            const n =
                              typeof amountRaw === 'number' ? amountRaw : Number(amountRaw as any);
                            if (!Number.isNaN(n)) {
                              amountDisplay = n.toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              });
                            } else {
                              amountDisplay = String(amountRaw);
                            }
                          }

                          const currency = tx.currency || primaryCurrency || '';

                          const method =
                            tx.paymentMethod || tx.method || tx.payment_type || tx.paymentType || '';
                          const status = tx.status || '';

                          return (
                            <tr
                              key={
                                tx.id ||
                                tx.transactionRef ||
                                tx.transaction_ref ||
                                tx.reference ||
                                idx
                              }
                            >
                              <td className="px-2 py-1 whitespace-nowrap text-gray-700 dark:text-gray-200">
                                {paidOn}
                              </td>
                              <td className="px-2 py-1 whitespace-nowrap text-gray-700 dark:text-gray-200">
                                {paidBy}
                              </td>
                              <td className="px-2 py-1 whitespace-nowrap text-gray-700 dark:text-gray-200">
                                {bookedBy}
                              </td>
                              <td className="px-2 py-1 whitespace-nowrap text-gray-700 dark:text-gray-200">
                                {ticket}
                              </td>
                              <td className="px-2 py-1 whitespace-nowrap text-gray-700 dark:text-gray-200">
                                {name}
                              </td>
                              <td className="px-2 py-1 whitespace-nowrap text-gray-700 dark:text-gray-200">
                                {operator}
                              </td>
                              <td className="px-2 py-1 whitespace-nowrap text-gray-700 dark:text-gray-200">
                                {departure}
                              </td>
                              <td className="px-2 py-1 whitespace-nowrap text-gray-700 dark:text-gray-200">
                                {destination}
                              </td>
                              <td className="px-2 py-1 whitespace-nowrap text-gray-700 dark:text-gray-200">
                                {departureDate}
                              </td>
                              <td className="px-2 py-1 whitespace-nowrap text-gray-700 dark:text-gray-200">
                                {passengerType}
                              </td>
                              <td className="px-2 py-1 whitespace-nowrap text-gray-700 dark:text-gray-200">
                                {method}
                              </td>
                              <td className="px-2 py-1 whitespace-nowrap text-gray-700 dark:text-gray-200">
                                {status}
                              </td>
                              <td className="px-2 py-1 whitespace-nowrap text-right text-gray-900 dark:text-gray-50">
                                {amountDisplay} {currency}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
                {!transactionsLoading && filteredTransactions.length > 0 && (
                  <div className="px-3 py-3 flex items-center justify-between text-[11px] text-gray-700 dark:text-gray-200">
                    <div>
                      Page {transactionsPage} of {transactionsTotalPages} · Showing{' '}
                      {paginatedTransactions.length} of {filteredTransactions.length} filtered (
                      {transactions.length} total)
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleTransactionsPrevPage}
                        disabled={transactionsPage === 1}
                        className="inline-flex items-center rounded-md border border-gray-300 bg-white px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
                      >
                        Prev
                      </button>
                      <button
                        type="button"
                        onClick={handleTransactionsNextPage}
                        disabled={transactionsPage === transactionsTotalPages}
                        className="inline-flex items-center rounded-md border border-gray-300 bg-white px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>
          )}

          {activeSection === 'middleware' && (
          <section id="middleware" className="mb-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-50">Middleware Toggles</h2>
              <span className="text-xs text-gray-500 dark:text-gray-400">{middlewares.length} middleware{middlewares.length === 1 ? '' : 's'}</span>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-700/70">
              {middlewares.map((mw) => (
                <div key={mw.name} className="flex items-center justify-between px-4 py-2 text-sm">
                  <div className="flex flex-col">
                    <span className="font-medium text-gray-900 dark:text-gray-50">{mw.name}</span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {mw.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        setSavingMiddleware(mw.name);
                        setConfigError(null);
                        const nextEnabled = !mw.enabled;
                        const res = await fetch(`${API_BASE}/api/admin/config/middleware`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          credentials: 'include',
                          body: JSON.stringify({ name: mw.name, enabled: nextEnabled })
                        });
                        const json = await res.json().catch(() => null);
                        if (!res.ok || !json || !json.success) {
                          throw new Error(json?.message || 'Failed to update middleware');
                        }
                        if (json.data && Array.isArray(json.data.middlewares)) {
                          setMiddlewares(json.data.middlewares as MiddlewareFlag[]);
                        } else {
                          setMiddlewares(prev => prev.map(m => m.name === mw.name ? { ...m, enabled: nextEnabled } : m));
                        }
                      } catch (e: any) {
                        setConfigError(e?.message || 'Failed to update middleware');
                      } finally {
                        setSavingMiddleware(null);
                      }
                    }}
                    className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium shadow-sm ${
                      mw.enabled
                        ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-200'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200'
                    } ${savingMiddleware === mw.name ? 'opacity-60 cursor-wait' : ''}`}
                    disabled={savingMiddleware === mw.name}
                  >
                    {savingMiddleware === mw.name ? 'Updating...' : mw.enabled ? 'Disable' : 'Enable'}
                  </button>
                </div>
              ))}
              {middlewares.length === 0 && (
                <div className="px-4 py-3 text-sm text-gray-500 dark:text-gray-300">
                  No middleware flags registered.
                </div>
              )}
            </div>
          </section>
          )}

          {activeSection === 'pricing' && (
          <section id="pricing" className="mb-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-50">Pricing Settings</h2>
            </div>
            {pricing ? (
              <div className="px-4 py-3 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs md:text-sm">
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-300">Commission (%)</label>
                  <input
                    type="number"
                    className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                    value={pricing.commission}
                    onChange={(e) =>
                      setPricing(prev => prev ? { ...prev, commission: Number(e.target.value) || 0 } : prev)
                    }
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-300">Fixed</label>
                  <input
                    type="number"
                    className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                    value={pricing.fixed}
                    onChange={(e) =>
                      setPricing(prev => prev ? { ...prev, fixed: Number(e.target.value) || 0 } : prev)
                    }
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-300">Round To Nearest</label>
                  <input
                    type="number"
                    className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                    value={pricing.roundToNearest}
                    onChange={(e) =>
                      setPricing(prev => prev ? { ...prev, roundToNearest: Number(e.target.value) || 0 } : prev)
                    }
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-300">Discount</label>
                  <input
                    type="number"
                    className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                    value={pricing.discount}
                    onChange={(e) =>
                      setPricing(prev => prev ? { ...prev, discount: Number(e.target.value) || 0 } : prev)
                    }
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-300">Markup</label>
                  <input
                    type="number"
                    className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                    value={pricing.markup}
                    onChange={(e) =>
                      setPricing(prev => prev ? { ...prev, markup: Number(e.target.value) || 0 } : prev)
                    }
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-300">Charges</label>
                  <input
                    type="number"
                    className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                    value={pricing.charges}
                    onChange={(e) =>
                      setPricing(prev => prev ? { ...prev, charges: Number(e.target.value) || 0 } : prev)
                    }
                  />
                </div>
                <div className="flex items-center gap-2 mt-4">
                  <input
                    id="apply-pricing"
                    type="checkbox"
                    className="h-4 w-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500 dark:border-gray-600 dark:bg-gray-900"
                    checked={pricing.apply}
                    onChange={(e) =>
                      setPricing(prev => prev ? { ...prev, apply: e.target.checked } : prev)
                    }
                  />
                  <label htmlFor="apply-pricing" className="text-xs text-gray-700 dark:text-gray-200">
                    Apply pricing adjustments to bookings
                  </label>
                </div>
                <div className="md:col-span-3 flex justify-end mt-2">
                  <button
                    type="button"
                    onClick={async () => {
                      if (!pricing) return;
                      try {
                        setSavingPricing(true);
                        setConfigError(null);
                        const res = await fetch(`${API_BASE}/api/admin/config/pricing`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          credentials: 'include',
                          body: JSON.stringify(pricing)
                        });
                        const json = await res.json().catch(() => null);
                        if (!res.ok || !json || !json.success) {
                          throw new Error(json?.message || 'Failed to update pricing');
                        }
                        if (json.data) {
                          const p: any = json.data;
                          setPricing({
                            commission: Number(p.commission ?? p.percentage) || 0,
                            fixed: Number(p.fixed) || 0,
                            roundToNearest: Number(p.roundToNearest) || 0,
                            apply: !!p.apply,
                            discount: Number(p.discount) || 0,
                            markup: Number(p.markup) || 0,
                            charges: Number(p.charges) || 0,
                          });
                        }
                      } catch (e: any) {
                        setConfigError(e?.message || 'Failed to update pricing');
                      } finally {
                        setSavingPricing(false);
                      }
                    }}
                    className={`inline-flex items-center rounded-md px-3 py-1.5 text-xs font-semibold text-white shadow-sm ${
                      savingPricing
                        ? 'bg-purple-400 cursor-wait'
                        : 'bg-purple-600 hover:bg-purple-700'
                    }`}
                    disabled={savingPricing}
                  >
                    {savingPricing ? 'Saving...' : 'Save Pricing'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="px-4 py-3 text-sm text-gray-500 dark:text-gray-300">
                Pricing settings are not available.
              </div>
            )}
          </section>
          )}

          {activeSection === 'ads' && (
          <section id="ads" className="mb-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-50">Ads</h2>
              <span className="text-xs text-gray-500 dark:text-gray-400">{ads.length} ad{ads.length === 1 ? '' : 's'}</span>
            </div>
            <div className="px-4 py-3 text-xs md:text-sm space-y-3">
              {adsError && (
                <div className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
                  {adsError}
                </div>
              )}
              {ads.map((ad, index) => (
                <div key={ad.id || index} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 space-y-2 bg-white dark:bg-gray-900/40">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">Slot {index + 1}</span>
                    <button
                      type="button"
                      className="inline-flex items-center rounded-md border border-gray-300 dark:border-gray-600 px-2 py-0.5 text-[11px] font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
                      onClick={() => {
                        setAds(prev => prev.filter((_, i) => i !== index));
                      }}
                    >
                      Remove
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="block text-[11px] font-medium text-gray-600 dark:text-gray-300">Label</label>
                      <input
                        type="text"
                        className="w-full rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                        value={ad.label}
                        onChange={(e) => {
                          const value = e.target.value;
                          setAds(prev => prev.map((item, i) => i === index ? { ...item, label: value } : item));
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-[11px] font-medium text-gray-600 dark:text-gray-300">CTA Label</label>
                      <input
                        type="text"
                        className="w-full rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                        value={ad.ctaLabel || ''}
                        onChange={(e) => {
                          const value = e.target.value;
                          setAds(prev => prev.map((item, i) => i === index ? { ...item, ctaLabel: value } : item));
                        }}
                      />
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <label className="block text-[11px] font-medium text-gray-600 dark:text-gray-300">Title</label>
                      <input
                        type="text"
                        className="w-full rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                        value={ad.title}
                        onChange={(e) => {
                          const value = e.target.value;
                          setAds(prev => prev.map((item, i) => i === index ? { ...item, title: value } : item));
                        }}
                      />
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <label className="block text-[11px] font-medium text-gray-600 dark:text-gray-300">Link URL</label>
                      <input
                        type="url"
                        className="w-full rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                        placeholder="https://example.com/your-offer"
                        value={ad.href}
                        onChange={(e) => {
                          const value = e.target.value;
                          setAds(prev => prev.map((item, i) => i === index ? { ...item, href: value } : item));
                        }}
                      />
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <label className="block text-[11px] font-medium text-gray-600 dark:text-gray-300">Description</label>
                      <textarea
                        rows={2}
                        className="w-full rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 resize-none"
                        value={ad.description}
                        onChange={(e) => {
                          const value = e.target.value;
                          setAds(prev => prev.map((item, i) => i === index ? { ...item, description: value } : item));
                        }}
                      />
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <label className="block text-[11px] font-medium text-gray-600 dark:text-gray-300">Image</label>
                      {ad.imageDataUrl && (
                        <div className="flex items-center gap-2 mb-1">
                          <img
                            src={ad.imageDataUrl}
                            alt={ad.title || 'Ad image'}
                            className="h-12 w-20 object-cover rounded-md border border-gray-200 dark:border-gray-700"
                          />
                          <button
                            type="button"
                            className="inline-flex items-center rounded-md border border-gray-300 dark:border-gray-600 px-2 py-0.5 text-[11px] font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
                            onClick={() => {
                              setAds(prev => prev.map((item, i) => i === index ? { ...item, imageDataUrl: undefined } : item));
                            }}
                          >
                            Remove image
                          </button>
                        </div>
                      )}
                      <input
                        type="file"
                        accept="image/*"
                        className="block w-full text-[11px] text-gray-600 dark:text-gray-300 file:mr-3 file:py-1 file:px-2 file:rounded-md file:border-0 file:text-[11px] file:font-medium file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200 dark:file:bg-gray-800 dark:file:text-gray-200"
                        onChange={(e) => {
                          const file = e.target.files && e.target.files[0];
                          if (!file) return;
                          const reader = new FileReader();
                          reader.onloadend = () => {
                            const result = typeof reader.result === 'string' ? reader.result : '';
                            setAds(prev => prev.map((item, i) => i === index ? { ...item, imageDataUrl: result } : item));
                          };
                          reader.readAsDataURL(file);
                        }}
                      />
                    </div>
                  </div>
                </div>
              ))}
              {ads.length === 0 && (
                <div className="text-xs text-gray-500 dark:text-gray-300">
                  No ads configured yet. Use "Add ad" to create your first banner.
                </div>
              )}
              <div className="flex items-center justify-between pt-2 border-t border-gray-100 dark:border-gray-700/70 mt-1">
                <button
                  type="button"
                  className="inline-flex items-center rounded-md border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
                  onClick={() => {
                    setAds(prev => [
                      ...prev,
                      {
                        id: `ad-${Date.now()}-${prev.length + 1}`,
                        label: 'Ad',
                        title: 'New ad',
                        description: '',
                        href: '#',
                        ctaLabel: '',
                      },
                    ]);
                  }}
                >
                  Add ad
                </button>
                <button
                  type="button"
                  onClick={() => {
                    try {
                      setSavingAds(true);
                      setAdsError(null);
                      saveConfiguredAds(ads);
                    } catch (e: any) {
                      setAdsError(e?.message || 'Failed to save ads');
                    } finally {
                      setSavingAds(false);
                    }
                  }}
                  className={`inline-flex items-center rounded-md px-3 py-1.5 text-xs font-semibold text-white shadow-sm ${
                    savingAds ? 'bg-purple-400 cursor-wait' : 'bg-purple-600 hover:bg-purple-700'
                  }`}
                  disabled={savingAds}
                >
                  {savingAds ? 'Saving...' : 'Save Ads'}
                </button>
              </div>
            </div>
          </section>
          )}

          {activeSection === 'admins' && (
          <section id="admins" className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-50">Admin Accounts</h2>
              <span className="text-xs text-gray-500 dark:text-gray-400">{admins.length} account{admins.length === 1 ? '' : 's'}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-900/60">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Email</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Status</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Created At</th>
                  </tr>
                </thead>
                <tbody>
                  {admins.map((adm) => (
                    <tr key={adm.id} className="border-t border-gray-100 dark:border-gray-700/70">
                      <td className="px-4 py-2 text-gray-900 dark:text-gray-50">{adm.email || adm.emailLower || '-'}</td>
                      <td className="px-4 py-2">
                        <span
                          className={
                            adm.active === false
                              ? 'inline-flex items-center rounded-full bg-red-100 text-red-700 px-2 py-0.5 text-xs font-medium dark:bg-red-900/40 dark:text-red-300'
                              : 'inline-flex items-center rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 text-xs font-medium dark:bg-emerald-900/40 dark:text-emerald-300'
                          }
                        >
                          {adm.active === false ? 'Inactive' : 'Active'}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-gray-700 dark:text-gray-200">{formatDate(adm.createdAt)}</td>
                    </tr>
                  ))}
                  {admins.length === 0 && (
                    <tr>
                      <td className="px-4 py-4 text-center text-gray-500 dark:text-gray-300" colSpan={3}>
                        No admin records found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="px-4 pt-6 pb-3 border-t border-gray-100 dark:border-gray-700/70 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-50">Agents (approval)</h2>
              <span className="text-xs text-gray-500 dark:text-gray-400">{agents.length} agent{agents.length === 1 ? '' : 's'}</span>
            </div>
            <div className="overflow-x-auto">
              {agentsLoading ? (
                <div className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">Loading agents...</div>
              ) : agentsError ? (
                <div className="px-4 py-3 text-sm text-red-600 dark:text-red-300">{agentsError}</div>
              ) : (
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-900/60">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Agent</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Email</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Status</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agents.length === 0 ? (
                      <tr className="border-t border-gray-100 dark:border-gray-700/70">
                        <td colSpan={4} className="px-4 py-3 text-gray-600 dark:text-gray-300 text-center">
                          No agents found.
                        </td>
                      </tr>
                    ) : (
                      agents.map((agent) => (
                        <tr key={agent.id} className="border-t border-gray-100 dark:border-gray-700/70">
                          <td className="px-4 py-2 text-gray-900 dark:text-gray-50">
                            {[agent.firstName, agent.lastName].filter(Boolean).join(' ') || '—'}
                          </td>
                          <td className="px-4 py-2 text-gray-900 dark:text-gray-50">{agent.email || '—'}</td>
                          <td className="px-4 py-2">
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                agent.active
                                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200'
                                  : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
                              }`}
                            >
                              {agent.active ? 'Active' : 'Pending approval'}
                            </span>
                          </td>
                          <td className="px-4 py-2">
                            <button
                              type="button"
                              disabled={agent.active || approvingAgentId === agent.id}
                              onClick={() => handleApproveAgent(agent.id)}
                              className={`inline-flex items-center rounded-md px-3 py-1 text-xs font-semibold shadow-sm ${
                                agent.active
                                  ? 'bg-gray-200 text-gray-500 cursor-not-allowed dark:bg-gray-800 dark:text-gray-400'
                                  : 'bg-purple-600 text-white hover:bg-purple-700'
                              } ${approvingAgentId === agent.id ? 'opacity-70 cursor-wait' : ''}`}
                            >
                              {agent.active ? 'Active' : approvingAgentId === agent.id ? 'Activating...' : 'Activate'}
                            </button>
                            <button
                              type="button"
                              onClick={() => openDeactivateModal(agent)}
                              disabled={!agent.active || deactivatingAgentId === agent.id}
                              className={`inline-flex items-center rounded-md px-3 py-1 text-xs font-semibold shadow-sm ml-2 ${
                                (!agent.active || deactivatingAgentId === agent.id)
                                  ? 'bg-gray-200 text-gray-500 cursor-not-allowed dark:bg-gray-800 dark:text-gray-400'
                                  : 'bg-amber-600 text-white hover:bg-amber-700'
                              }`}
                            >
                              {deactivatingAgentId === agent.id ? 'Deactivating...' : 'Deactivate'}
                            </button>
                            <button
                              type="button"
                              onClick={() => openDeleteModal(agent)}
                              disabled={deletingAgentId === agent.id}
                              className={`inline-flex items-center rounded-md px-3 py-1 text-xs font-semibold shadow-sm ml-2 ${
                                deletingAgentId === agent.id
                                  ? 'bg-red-400 text-white cursor-wait'
                                  : 'bg-red-600 text-white hover:bg-red-700'
                              }`}
                            >
                              {deletingAgentId === agent.id ? 'Deleting...' : 'Delete'}
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </section>
          )}
        </main>
      </div>

      {confirmDeactivateOpen && confirmDeactivateAgent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-lg bg-white dark:bg-gray-800 shadow-lg border border-gray-200 dark:border-gray-700">
            <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-50">Deactivate agent</h3>
            </div>
            <div className="px-4 py-3 text-sm text-gray-700 dark:text-gray-200">
              Deactivate this agent? They will lose access until re-approved.
            </div>
            <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-700 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closeDeactivateModal}
                disabled={deactivatingAgentId === confirmDeactivateAgent.id}
                className="inline-flex items-center rounded-md border border-gray-300 dark:border-gray-600 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleDeactivateAgent(confirmDeactivateAgent.id)}
                disabled={deactivatingAgentId === confirmDeactivateAgent.id}
                className={`inline-flex items-center rounded-md px-3 py-1 text-xs font-semibold shadow-sm ${
                  deactivatingAgentId === confirmDeactivateAgent.id
                    ? 'bg-amber-400 text-white cursor-wait'
                    : 'bg-amber-600 text-white hover:bg-amber-700'
                }`}
              >
                {deactivatingAgentId === confirmDeactivateAgent.id ? 'Deactivating...' : 'Deactivate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDeleteOpen && confirmDeleteAgent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-lg bg-white dark:bg-gray-800 shadow-lg border border-gray-200 dark:border-gray-700">
            <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-50">Delete agent</h3>
            </div>
            <div className="px-4 py-3 text-sm text-gray-700 dark:text-gray-200">
              Are you sure you want to delete this agent? This action cannot be undone.
            </div>
            <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-700 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closeDeleteModal}
                disabled={deletingAgentId === confirmDeleteAgent.id}
                className="inline-flex items-center rounded-md border border-gray-300 dark:border-gray-600 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleDeleteAgent(confirmDeleteAgent.id)}
                disabled={deletingAgentId === confirmDeleteAgent.id}
                className={`inline-flex items-center rounded-md px-3 py-1 text-xs font-semibold shadow-sm ${
                  deletingAgentId === confirmDeleteAgent.id
                    ? 'bg-red-400 text-white cursor-wait'
                    : 'bg-red-600 text-white hover:bg-red-700'
                }`}
              >
                {deletingAgentId === confirmDeleteAgent.id ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminDashboard;
