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

type BranchRecord = {
  id: string;
  code?: string;
  name?: string;
  active?: boolean;
  createdAt?: any;
  updatedAt?: any;
};

type UserRecord = {
  id: string;
  email?: string;
  emailLower?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  role?: string;
  createdAt?: any;
  updatedAt?: any;
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

type NotificationItem = {
  id: string;
  title?: string;
  message?: string;
  category?: string;
  level?: string;
  read?: boolean;
  createdAtMs?: number;
  createdAt?: any;
  meta?: any;
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

function toDateKeyUTC(d: Date): string {
  const u = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  return u.toISOString().slice(0, 10);
}

function computeReportDates(rangeKey: string): { dateFrom: string; dateTo: string } {
  const now = new Date();
  const todayKey = toDateKeyUTC(now);
  if (rangeKey === 'today') {
    return { dateFrom: todayKey, dateTo: todayKey };
  }
  if (rangeKey === '7d') {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    start.setUTCDate(start.getUTCDate() - 6);
    return { dateFrom: toDateKeyUTC(start), dateTo: todayKey };
  }
  if (rangeKey === '30d') {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    start.setUTCDate(start.getUTCDate() - 29);
    return { dateFrom: toDateKeyUTC(start), dateTo: todayKey };
  }
  return { dateFrom: '', dateTo: '' };
}

type ReportRangeKey = 'today' | '7d' | '30d' | 'all' | 'custom';

function computeRangeLabel(rangeKey: ReportRangeKey, dateFrom: string, dateTo: string): string {
  if (rangeKey === 'custom' && dateFrom && dateTo) {
    const from = dateFrom <= dateTo ? dateFrom : dateTo;
    const to = dateFrom <= dateTo ? dateTo : dateFrom;
    return `${from} to ${to}`;
  }
  if (rangeKey === 'today') return 'today';
  if (rangeKey === '7d') return 'last 7 days';
  if (rangeKey === '30d') return 'last 30 days';
  if (rangeKey === 'all') return 'all time';
  return 'last 7 days';
}

function applyRangeParams(
  params: URLSearchParams,
  rangeKey: ReportRangeKey,
  dateFrom: string,
  dateTo: string,
) {
  if (rangeKey === 'custom' && dateFrom && dateTo) {
    const from = dateFrom <= dateTo ? dateFrom : dateTo;
    const to = dateFrom <= dateTo ? dateTo : dateFrom;
    params.set('range', 'custom');
    params.set('dateFrom', from);
    params.set('dateTo', to);
    return;
  }
  params.set('range', rangeKey);
}

function getSalesSummaryRevenueByCurrency(data: any): Record<string, number> {
  const obj = data?.rangeTotals?.revenueByCurrency ?? data?.revenueByCurrency ?? {};
  if (!obj || typeof obj !== 'object') return {};
  return obj as Record<string, number>;
}

function getSalesSummaryPrimaryCurrency(data: any): string {
  const revenueByCurrency = getSalesSummaryRevenueByCurrency(data);
  return revenueByCurrency && typeof revenueByCurrency === 'object'
    ? Object.keys(revenueByCurrency)[0] || ''
    : '';
}

const AdminDashboard: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<FirebaseUser | null>(null);
  const [adminRecord, setAdminRecord] = useState<AdminRecord | null>(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsError, setNotificationsError] = useState<string | null>(null);
  const [notificationsRows, setNotificationsRows] = useState<NotificationItem[]>([]);
  const [notificationsUnreadCount, setNotificationsUnreadCount] = useState<number>(0);
  const [admins, setAdmins] = useState<AdminRecord[]>([]);
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [branchesError, setBranchesError] = useState<string | null>(null);
  const [branchCreateCode, setBranchCreateCode] = useState('');
  const [branchCreateName, setBranchCreateName] = useState('');
  const [branchCreating, setBranchCreating] = useState(false);
  const [branchSavingId, setBranchSavingId] = useState<string | null>(null);
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [usersSearch, setUsersSearch] = useState('');
  const [usersRoleFilter, setUsersRoleFilter] = useState('');
  const [usersRefreshing, setUsersRefreshing] = useState(false);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
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
  const [summaryProfitabilityTotals, setSummaryProfitabilityTotals] = useState<any | null>(null);
  const [summaryProfitabilityLoading, setSummaryProfitabilityLoading] = useState(false);
  const [summaryProfitabilityError, setSummaryProfitabilityError] = useState<string | null>(null);
  const [profitabilityLoading, setProfitabilityLoading] = useState(false);
  const [profitabilityError, setProfitabilityError] = useState<string | null>(null);
  const [profitabilityReport, setProfitabilityReport] = useState<any | null>(null);
  const [profitabilityPage, setProfitabilityPage] = useState(1);
  const [profitabilityPageSize, setProfitabilityPageSize] = useState(25);
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
  const [activeSection, setActiveSection] = useState<'overview' | 'middleware' | 'pricing' | 'ads' | 'admins' | 'agents' | 'branches' | 'users' | 'reports'>('overview');
  const [reportsView, setReportsView] = useState<'summary' | 'profitability'>('summary');
  const [summaryRange, setSummaryRange] = useState<ReportRangeKey>('7d');
  const [summaryDateFrom, setSummaryDateFrom] = useState<string>(computeReportDates('7d').dateFrom);
  const [summaryDateTo, setSummaryDateTo] = useState<string>(computeReportDates('7d').dateTo);

  const loadNotifications = async (opts?: { silent?: boolean }) => {
    const silent = Boolean(opts && opts.silent);
    try {
      if (!silent) setNotificationsLoading(true);
      setNotificationsError(null);
      const res = await fetch(`${API_BASE}/api/admin/notifications?limit=30`, {
        credentials: 'include',
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(json?.message || json?.error || 'Failed to load notifications');
      }
      const rows = (json?.data?.rows || []) as NotificationItem[];
      const unreadCountRaw = json?.data?.unreadCount;
      const unreadCount = typeof unreadCountRaw === 'number'
        ? unreadCountRaw
        : (rows || []).filter((r) => r && r.read !== true).length;
      setNotificationsRows(Array.isArray(rows) ? rows : []);
      setNotificationsUnreadCount(unreadCount);
      if (!silent) setNotificationsLoading(false);
    } catch (e: any) {
      if (!silent) setNotificationsLoading(false);
      setNotificationsError(e?.message || 'Failed to load notifications');
    }
  };

  const markNotificationRead = async (id: string) => {
    const safeId = String(id || '').trim();
    if (!safeId) return;
    try {
      await fetch(`${API_BASE}/api/admin/notifications/${encodeURIComponent(safeId)}/read`, {
        method: 'PATCH',
        credentials: 'include',
      });
    } catch {
    }
    setNotificationsRows((prev) => prev.map((n) => (n && n.id === safeId ? { ...n, read: true } : n)));
    setNotificationsUnreadCount((prev) => Math.max(0, prev - 1));
  };

  const [currencyRange, setCurrencyRange] = useState<ReportRangeKey>('7d');
  const [currencyDateFrom, setCurrencyDateFrom] = useState<string>(computeReportDates('7d').dateFrom);
  const [currencyDateTo, setCurrencyDateTo] = useState<string>(computeReportDates('7d').dateTo);
  const [currencySalesSummary, setCurrencySalesSummary] = useState<any | null>(null);
  const [currencyLoading, setCurrencyLoading] = useState(false);
  const [currencyError, setCurrencyError] = useState<string | null>(null);

  const [dailyRange, setDailyRange] = useState<ReportRangeKey>('7d');
  const [dailyDateFrom, setDailyDateFrom] = useState<string>(computeReportDates('7d').dateFrom);
  const [dailyDateTo, setDailyDateTo] = useState<string>(computeReportDates('7d').dateTo);
  const [dailySalesSummary, setDailySalesSummary] = useState<any | null>(null);
  const [dailyLoading, setDailyLoading] = useState(false);
  const [dailyError, setDailyError] = useState<string | null>(null);

  const [topBranchesRange, setTopBranchesRange] = useState<ReportRangeKey>('7d');
  const [topBranchesDateFrom, setTopBranchesDateFrom] = useState<string>(computeReportDates('7d').dateFrom);
  const [topBranchesDateTo, setTopBranchesDateTo] = useState<string>(computeReportDates('7d').dateTo);
  const [topBranchesSalesSummary, setTopBranchesSalesSummary] = useState<any | null>(null);
  const [topBranchesLoading, setTopBranchesLoading] = useState(false);
  const [topBranchesError, setTopBranchesError] = useState<string | null>(null);

  const [topOperatorsRange, setTopOperatorsRange] = useState<ReportRangeKey>('7d');
  const [topOperatorsDateFrom, setTopOperatorsDateFrom] = useState<string>(computeReportDates('7d').dateFrom);
  const [topOperatorsDateTo, setTopOperatorsDateTo] = useState<string>(computeReportDates('7d').dateTo);
  const [topOperatorsSalesSummary, setTopOperatorsSalesSummary] = useState<any | null>(null);
  const [topOperatorsLoading, setTopOperatorsLoading] = useState(false);
  const [topOperatorsError, setTopOperatorsError] = useState<string | null>(null);

  const [paymentTypesRange, setPaymentTypesRange] = useState<ReportRangeKey>('7d');
  const [paymentTypesDateFrom, setPaymentTypesDateFrom] = useState<string>(computeReportDates('7d').dateFrom);
  const [paymentTypesDateTo, setPaymentTypesDateTo] = useState<string>(computeReportDates('7d').dateTo);
  const [paymentTypesSalesSummary, setPaymentTypesSalesSummary] = useState<any | null>(null);
  const [paymentTypesLoading, setPaymentTypesLoading] = useState(false);
  const [paymentTypesError, setPaymentTypesError] = useState<string | null>(null);

  const [transactionsRange, setTransactionsRange] = useState<ReportRangeKey>('7d');
  const [transactionsDateFrom, setTransactionsDateFrom] = useState<string>(computeReportDates('7d').dateFrom);
  const [transactionsDateTo, setTransactionsDateTo] = useState<string>(computeReportDates('7d').dateTo);

  const [profitabilityRange, setProfitabilityRange] = useState<ReportRangeKey>('7d');
  const [profitabilityDateFrom, setProfitabilityDateFrom] = useState<string>(computeReportDates('7d').dateFrom);
  const [profitabilityDateTo, setProfitabilityDateTo] = useState<string>(computeReportDates('7d').dateTo);
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

  const summaryRangeLabel = computeRangeLabel(summaryRange, summaryDateFrom, summaryDateTo);

  const summaryRevenueByCurrency = getSalesSummaryRevenueByCurrency(reportsSummary);

  const primaryCurrency =
    reportMetrics?.primaryCurrency ??
    (getSalesSummaryPrimaryCurrency(reportsSummary) || undefined);

  const currencyRangeLabel = computeRangeLabel(currencyRange, currencyDateFrom, currencyDateTo);
  const currencyRevenueByCurrency = getSalesSummaryRevenueByCurrency(currencySalesSummary);
  const currencyPrimaryCurrency = getSalesSummaryPrimaryCurrency(currencySalesSummary);

  const dailyRangeLabel = computeRangeLabel(dailyRange, dailyDateFrom, dailyDateTo);
  const dailyPrimaryCurrency = getSalesSummaryPrimaryCurrency(dailySalesSummary);

  const topBranchesRangeLabel = computeRangeLabel(topBranchesRange, topBranchesDateFrom, topBranchesDateTo);
  const topBranchesPrimaryCurrency = getSalesSummaryPrimaryCurrency(topBranchesSalesSummary);

  const topOperatorsRangeLabel = computeRangeLabel(topOperatorsRange, topOperatorsDateFrom, topOperatorsDateTo);
  const topOperatorsPrimaryCurrency = getSalesSummaryPrimaryCurrency(topOperatorsSalesSummary);

  const paymentTypesRangeLabel = computeRangeLabel(paymentTypesRange, paymentTypesDateFrom, paymentTypesDateTo);
  const paymentTypesPrimaryCurrency = getSalesSummaryPrimaryCurrency(paymentTypesSalesSummary);

  const transactionsRangeLabel = computeRangeLabel(transactionsRange, transactionsDateFrom, transactionsDateTo);

  const profitabilityRangeLabel = computeRangeLabel(profitabilityRange, profitabilityDateFrom, profitabilityDateTo);

  const renderRangeFilter = (
    rangeKey: ReportRangeKey,
    dateFrom: string,
    dateTo: string,
    setRangeKey: React.Dispatch<React.SetStateAction<ReportRangeKey>>,
    setDateFrom: React.Dispatch<React.SetStateAction<string>>,
    setDateTo: React.Dispatch<React.SetStateAction<string>>,
  ) => {
    const rangeLabel = computeRangeLabel(rangeKey, dateFrom, dateTo);
    return (
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={rangeKey}
          onChange={(e) => {
            const next = e.target.value as ReportRangeKey;
            if (next === 'today' || next === '7d' || next === '30d') {
              const d = computeReportDates(next);
              setRangeKey(next);
              setDateFrom(d.dateFrom);
              setDateTo(d.dateTo);
              return;
            }
            if (next === 'all') {
              setRangeKey('all');
              setDateFrom('');
              setDateTo('');
              return;
            }
            if (next === 'custom') {
              const todayKey = toDateKeyUTC(new Date());
              setRangeKey('custom');
              setDateFrom((prev) => (prev ? prev : todayKey));
              setDateTo((prev) => (prev ? prev : todayKey));
              return;
            }
            setRangeKey(next);
          }}
          className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-900 focus:outline-none focus:ring-1 focus:ring-purple-500 focus:border-purple-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
        >
          <option value="today">Today</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="all">All time</option>
          <option value="custom">Custom</option>
        </select>
        {rangeKey === 'custom' && (
          <>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setRangeKey('custom');
                setDateFrom(e.target.value);
                if (!dateTo) setDateTo(e.target.value);
              }}
              className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-900 focus:outline-none focus:ring-1 focus:ring-purple-500 focus:border-purple-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            />
            <input
              type="date"
              value={dateTo}
              onChange={(e) => {
                setRangeKey('custom');
                setDateTo(e.target.value);
                if (!dateFrom) setDateFrom(e.target.value);
              }}
              className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-900 focus:outline-none focus:ring-1 focus:ring-purple-500 focus:border-purple-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            />
          </>
        )}
        <span className="text-[11px] text-gray-500 dark:text-gray-400">{rangeLabel}</span>
      </div>
    );
  };

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
    topBranchesSalesSummary &&
    topBranchesSalesSummary.summaryTable &&
    Array.isArray(topBranchesSalesSummary.summaryTable.byBranch)
      ? (topBranchesSalesSummary.summaryTable.byBranch as any[]).slice(0, 5)
      : [];

  const topOperators =
    topOperatorsSalesSummary &&
    topOperatorsSalesSummary.summaryTable &&
    Array.isArray(topOperatorsSalesSummary.summaryTable.byOperator)
      ? (topOperatorsSalesSummary.summaryTable.byOperator as any[]).slice(0, 5)
      : [];

  const topPaymentTypes =
    paymentTypesSalesSummary &&
    paymentTypesSalesSummary.summaryTable &&
    Array.isArray(paymentTypesSalesSummary.summaryTable.byPaymentType)
      ? (paymentTypesSalesSummary.summaryTable.byPaymentType as any[]).slice(0, 5)
      : [];

  const dailyStats =
    dailySalesSummary && Array.isArray(dailySalesSummary.daily)
      ? (dailySalesSummary.daily as any[]).slice(0, 7)
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

  const getTransactionAmountNumber = (tx: any): number => {
    const amountRaw = tx?.amount ?? tx?.revenue ?? tx?.total ?? tx?.price ?? null;
    if (amountRaw == null) return 0;
    const n = typeof amountRaw === 'number' ? amountRaw : Number(amountRaw);
    return Number.isFinite(n) ? n : 0;
  };

  const getTransactionsTotalCurrencyLabel = (rows: any[]): string => {
    const set = new Set<string>();
    rows.forEach((tx) => {
      const c = tx?.currency ?? primaryCurrency ?? '';
      const s = String(c || '').trim();
      if (s) set.add(s);
    });
    if (set.size === 1) return Array.from(set)[0];
    if (set.size > 1) return 'mixed';
    return primaryCurrency || '';
  };

  const transactionsPageSubtotal = React.useMemo(() => {
    return paginatedTransactions.reduce((acc, tx) => acc + getTransactionAmountNumber(tx), 0);
  }, [paginatedTransactions]);

  const transactionsFilteredTotal = React.useMemo(() => {
    return filteredTransactions.reduce((acc, tx) => acc + getTransactionAmountNumber(tx), 0);
  }, [filteredTransactions]);

  const transactionsPageCurrency = React.useMemo(() => {
    return getTransactionsTotalCurrencyLabel(paginatedTransactions);
  }, [paginatedTransactions, primaryCurrency]);

  const transactionsFilteredCurrency = React.useMemo(() => {
    return getTransactionsTotalCurrencyLabel(filteredTransactions);
  }, [filteredTransactions, primaryCurrency]);

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
          description: `Across all branches and operators (${summaryRangeLabel})`,
        },
        {
          section: 'Summary',
          metric: 'Total Revenue',
          value: formattedRevenue ? `${formattedRevenue} ${primaryCurrency || ''}`.trim() : null,
          description: `Sum of ticket revenue in primary currency (${summaryRangeLabel})`,
        },
        {
          section: 'Summary',
          metric: 'Active Branches',
          value: typeof branchesCount === 'number' ? branchesCount : null,
          description: `Branches with recorded ticket sales (${summaryRangeLabel})`,
        },
      );
    }

    if (currencyRevenueByCurrency && typeof currencyRevenueByCurrency === 'object') {
      Object.entries(currencyRevenueByCurrency as Record<string, number>).forEach(([code, amount]) => {
        rows.push({
          section: 'Revenue by currency',
          metric: code,
          value: Number(amount || 0),
          description:
            code === currencyPrimaryCurrency
              ? `Primary currency (${currencyRangeLabel})`
              : `(${currencyRangeLabel})`,
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
          description: `${Number(day?.revenue || 0).toLocaleString()} ${dailyPrimaryCurrency || ''}`.trim() + ` (${dailyRangeLabel})`,
        });
      });
    }

    if (topBranches.length > 0) {
      topBranches.forEach((row: any) => {
        rows.push({
          section: 'Top branches',
          metric: row.label,
          value: Number(row.tickets || 0),
          description: `${Number(row.revenue || 0).toLocaleString()} ${topBranchesPrimaryCurrency || ''}`.trim() + ` (${topBranchesRangeLabel})`,
        });
      });
    }

    if (topOperators.length > 0) {
      topOperators.forEach((row: any) => {
        rows.push({
          section: 'Top operators',
          metric: row.label,
          value: Number(row.tickets || 0),
          description: `${Number(row.revenue || 0).toLocaleString()} ${topOperatorsPrimaryCurrency || ''}`.trim() + ` (${topOperatorsRangeLabel})`,
        });
      });
    }

    if (topPaymentTypes.length > 0) {
      topPaymentTypes.forEach((row: any) => {
        rows.push({
          section: 'Payment methods',
          metric: row.label,
          value: Number(row.tickets || 0),
          description: `${Number(row.revenue || 0).toLocaleString()} ${paymentTypesPrimaryCurrency || ''}`.trim() + ` (${paymentTypesRangeLabel})`,
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

  const handleExportReportsPdf = async () => {
    if (typeof window === 'undefined') return;
    if (!reportsSummary) return;

    const summaryRows = buildSummaryExportRows();
    const transactionRows = buildTransactionsExportRows();
    if (!summaryRows.length && !transactionRows.length) return;

    try {
      setReportsError(null);
      const res = await fetch(`${API_BASE}/api/admin/reports/export.pdf`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'text/plain',
        },
        body: JSON.stringify({
          summaryRows,
          transactionRows,
          meta: {
            rangeLabel: summaryRangeLabel,
          },
        }),
      });

      if (!res.ok) {
        let msg = 'Failed to export PDF';
        try {
          const text = await res.text();
          if (text) msg = text;
        } catch {}
        throw new Error(msg);
      }

      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      const arrayBuffer = await res.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      const isPdf =
        bytes.length >= 5 &&
        bytes[0] === 0x25 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x44 &&
        bytes[3] === 0x46 &&
        bytes[4] === 0x2d;
      if (!isPdf) {
        let preview = '';
        try {
          preview = new TextDecoder().decode(bytes.slice(0, 800));
        } catch {}
        const hint = contentType && !contentType.includes('pdf') ? ` (content-type: ${contentType})` : '';
        throw new Error((preview || 'Server did not return a valid PDF') + hint);
      }

      const blob = new Blob([bytes], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `reports_${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => {
        try {
          window.URL.revokeObjectURL(url);
        } catch {}
      }, 4000);
    } catch (e) {
      console.warn('[AdminDashboard] PDF export failed', e);
      const message =
        (e && typeof e === 'object' && 'message' in e && (e as any).message) ||
        'Failed to export PDF';
      setReportsError(String(message));
    }
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

        const [admMeRes, adminsRes, configRes, agentsRes, adsRes] = await Promise.all([
          fetch(`${API_BASE}/api/admins/me`, { credentials: 'include' }),
          fetch(`${API_BASE}/api/admins`, { credentials: 'include' }),
          fetch(`${API_BASE}/api/admin/config`, { credentials: 'include' }),
          fetch(`${API_BASE}/api/v1/agents`, { credentials: 'include' }),
          fetch(`${API_BASE}/api/ads`, { credentials: 'include' })
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
              if (adsRes && adsRes.ok) {
                const adsJson = await adsRes.json().catch(() => null);
                if (adsJson && adsJson.success && Array.isArray(adsJson.data)) {
                  setAds(adsJson.data as AdDefinition[]);
                } else {
                  setAds(getConfiguredAds());
                }
              } else {
                setAds(getConfiguredAds());
              }
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
    if (!me) return;
    loadNotifications({ silent: true });
  }, [me]);

  useEffect(() => {
    if (!notificationsOpen) return;
    loadNotifications();
  }, [notificationsOpen]);

  useEffect(() => {
    if (!notificationsOpen) return;
    const onDoc = (e: any) => {
      const el = e && e.target ? (e.target as HTMLElement) : null;
      if (!el) return;
      const wrapper = el.closest && el.closest('[data-admin-notifications]');
      if (!wrapper) setNotificationsOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [notificationsOpen]);

  useEffect(() => {
    if (activeSection !== 'reports' || reportsView !== 'summary') return;

    let cancelled = false;

    async function loadSummary() {
      try {
        setReportsLoading(true);
        setReportsError(null);

        const params = new URLSearchParams();
        params.set('type', 'sales-summary');
        applyRangeParams(params, summaryRange, summaryDateFrom, summaryDateTo);

        const res = await fetch(`${API_BASE}/api/admin/reports?${params.toString()}`, {
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

        const metricsPrimaryCurrency = getSalesSummaryPrimaryCurrency(data) || undefined;

        const metricsRangeLabel = summaryRangeLabel;

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

    loadSummary();

    return () => {
      cancelled = true;
    };
  }, [activeSection, reportsView, summaryRange, summaryDateFrom, summaryDateTo, summaryRangeLabel]);

  useEffect(() => {
    if (activeSection !== 'reports' || reportsView !== 'summary') return;

    let cancelled = false;

    async function loadSummaryProfitabilityTotals() {
      try {
        setSummaryProfitabilityLoading(true);
        setSummaryProfitabilityError(null);

        const params = new URLSearchParams();
        params.set('page', '1');
        params.set('pageSize', '1');
        applyRangeParams(params, summaryRange, summaryDateFrom, summaryDateTo);

        const url = `${API_BASE}/api/admin/reports/profitability?${params.toString()}`;
        const res = await fetch(url, {
          credentials: 'include',
        });
        if (!res.ok) {
          throw new Error('Failed to load profitability totals');
        }

        const json: any = await res.json().catch(() => null);
        if (!json || json.success === false || !json.data || typeof json.data !== 'object') {
          throw new Error(json?.message || 'Failed to load profitability totals');
        }

        const totals = (json.data && json.data.totals) || null;
        if (!cancelled) {
          setSummaryProfitabilityTotals(totals);
        }
      } catch (e: any) {
        if (!cancelled) {
          setSummaryProfitabilityError(String(e?.message || 'Failed to load profitability totals'));
          setSummaryProfitabilityTotals(null);
        }
      } finally {
        if (!cancelled) {
          setSummaryProfitabilityLoading(false);
        }
      }
    }

    loadSummaryProfitabilityTotals();

    return () => {
      cancelled = true;
    };
  }, [activeSection, reportsView, summaryRange, summaryDateFrom, summaryDateTo]);

  useEffect(() => {
    if (activeSection !== 'reports' || reportsView !== 'summary') return;

    let cancelled = false;

    async function loadCurrencyCard() {
      try {
        setCurrencyLoading(true);
        setCurrencyError(null);

        const params = new URLSearchParams();
        params.set('type', 'sales-summary');
        applyRangeParams(params, currencyRange, currencyDateFrom, currencyDateTo);

        const res = await fetch(`${API_BASE}/api/admin/reports?${params.toString()}`, {
          credentials: 'include',
        });
        if (!res.ok) throw new Error('Failed to load revenue by currency');

        const json: any = await res.json().catch(() => null);
        if (!json || json.success === false || !json.data || typeof json.data !== 'object') {
          throw new Error(json?.message || 'Failed to load revenue by currency');
        }

        if (!cancelled) {
          setCurrencySalesSummary(json.data);
        }
      } catch (e: any) {
        if (!cancelled) setCurrencyError(String(e?.message || 'Failed to load revenue by currency'));
      } finally {
        if (!cancelled) setCurrencyLoading(false);
      }
    }

    loadCurrencyCard();

    return () => {
      cancelled = true;
    };
  }, [activeSection, reportsView, currencyRange, currencyDateFrom, currencyDateTo]);

  useEffect(() => {
    if (activeSection !== 'reports' || reportsView !== 'summary') return;

    let cancelled = false;

    async function loadDailyCard() {
      try {
        setDailyLoading(true);
        setDailyError(null);

        const params = new URLSearchParams();
        params.set('type', 'sales-summary');
        applyRangeParams(params, dailyRange, dailyDateFrom, dailyDateTo);

        const res = await fetch(`${API_BASE}/api/admin/reports?${params.toString()}`, {
          credentials: 'include',
        });
        if (!res.ok) throw new Error('Failed to load daily breakdown');

        const json: any = await res.json().catch(() => null);
        if (!json || json.success === false || !json.data || typeof json.data !== 'object') {
          throw new Error(json?.message || 'Failed to load daily breakdown');
        }

        if (!cancelled) {
          setDailySalesSummary(json.data);
        }
      } catch (e: any) {
        if (!cancelled) setDailyError(String(e?.message || 'Failed to load daily breakdown'));
      } finally {
        if (!cancelled) setDailyLoading(false);
      }
    }

    loadDailyCard();

    return () => {
      cancelled = true;
    };
  }, [activeSection, reportsView, dailyRange, dailyDateFrom, dailyDateTo]);

  useEffect(() => {
    if (activeSection !== 'reports' || reportsView !== 'summary') return;

    let cancelled = false;

    async function loadTopBranchesCard() {
      try {
        setTopBranchesLoading(true);
        setTopBranchesError(null);

        const params = new URLSearchParams();
        params.set('type', 'sales-summary');
        applyRangeParams(params, topBranchesRange, topBranchesDateFrom, topBranchesDateTo);

        const res = await fetch(`${API_BASE}/api/admin/reports?${params.toString()}`, {
          credentials: 'include',
        });
        if (!res.ok) throw new Error('Failed to load top branches');

        const json: any = await res.json().catch(() => null);
        if (!json || json.success === false || !json.data || typeof json.data !== 'object') {
          throw new Error(json?.message || 'Failed to load top branches');
        }

        if (!cancelled) {
          setTopBranchesSalesSummary(json.data);
        }
      } catch (e: any) {
        if (!cancelled) setTopBranchesError(String(e?.message || 'Failed to load top branches'));
      } finally {
        if (!cancelled) setTopBranchesLoading(false);
      }
    }

    loadTopBranchesCard();

    return () => {
      cancelled = true;
    };
  }, [activeSection, reportsView, topBranchesRange, topBranchesDateFrom, topBranchesDateTo]);

  useEffect(() => {
    if (activeSection !== 'reports' || reportsView !== 'summary') return;

    let cancelled = false;

    async function loadTopOperatorsCard() {
      try {
        setTopOperatorsLoading(true);
        setTopOperatorsError(null);

        const params = new URLSearchParams();
        params.set('type', 'sales-summary');
        applyRangeParams(params, topOperatorsRange, topOperatorsDateFrom, topOperatorsDateTo);

        const res = await fetch(`${API_BASE}/api/admin/reports?${params.toString()}`, {
          credentials: 'include',
        });
        if (!res.ok) throw new Error('Failed to load top operators');

        const json: any = await res.json().catch(() => null);
        if (!json || json.success === false || !json.data || typeof json.data !== 'object') {
          throw new Error(json?.message || 'Failed to load top operators');
        }

        if (!cancelled) {
          setTopOperatorsSalesSummary(json.data);
        }
      } catch (e: any) {
        if (!cancelled) setTopOperatorsError(String(e?.message || 'Failed to load top operators'));
      } finally {
        if (!cancelled) setTopOperatorsLoading(false);
      }
    }

    loadTopOperatorsCard();

    return () => {
      cancelled = true;
    };
  }, [activeSection, reportsView, topOperatorsRange, topOperatorsDateFrom, topOperatorsDateTo]);

  useEffect(() => {
    if (activeSection !== 'reports' || reportsView !== 'summary') return;

    let cancelled = false;

    async function loadPaymentTypesCard() {
      try {
        setPaymentTypesLoading(true);
        setPaymentTypesError(null);

        const params = new URLSearchParams();
        params.set('type', 'sales-summary');
        applyRangeParams(params, paymentTypesRange, paymentTypesDateFrom, paymentTypesDateTo);

        const res = await fetch(`${API_BASE}/api/admin/reports?${params.toString()}`, {
          credentials: 'include',
        });
        if (!res.ok) throw new Error('Failed to load payment methods');

        const json: any = await res.json().catch(() => null);
        if (!json || json.success === false || !json.data || typeof json.data !== 'object') {
          throw new Error(json?.message || 'Failed to load payment methods');
        }

        if (!cancelled) {
          setPaymentTypesSalesSummary(json.data);
        }
      } catch (e: any) {
        if (!cancelled) setPaymentTypesError(String(e?.message || 'Failed to load payment methods'));
      } finally {
        if (!cancelled) setPaymentTypesLoading(false);
      }
    }

    loadPaymentTypesCard();

    return () => {
      cancelled = true;
    };
  }, [activeSection, reportsView, paymentTypesRange, paymentTypesDateFrom, paymentTypesDateTo]);

  useEffect(() => {
    if (activeSection !== 'reports' || reportsView !== 'summary') return;

    let cancelled = false;

    async function loadTransactions() {
      try {
        setTransactionsLoading(true);
        setTransactionsError(null);

        const params = new URLSearchParams();
        params.set('limit', '500');
        applyRangeParams(params, transactionsRange, transactionsDateFrom, transactionsDateTo);

        const res = await fetch(`${API_BASE}/api/admin/reports/transactions?${params.toString()}`, {
          credentials: 'include',
        });
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

    loadTransactions();

    return () => {
      cancelled = true;
    };
  }, [activeSection, reportsView, transactionsRange, transactionsDateFrom, transactionsDateTo]);

  const loadUsers = async () => {
    try {
      setUsersRefreshing(true);
      setUsersLoading(true);
      setUsersError(null);
      const params = new URLSearchParams();
      params.set('limit', '500');
      if (usersSearch.trim()) params.set('search', usersSearch.trim());
      if (usersRoleFilter.trim()) params.set('role', usersRoleFilter.trim());

      const res = await fetch(`${API_BASE}/api/admin/users?${params.toString()}`, { credentials: 'include' });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.message || 'Failed to load users');
      }
      const json = await res.json().catch(() => null);
      if (!json || json.success === false || !Array.isArray(json.data)) {
        throw new Error(json?.message || 'Failed to load users');
      }
      setUsers(json.data as UserRecord[]);
    } catch (e: any) {
      setUsersError(e?.message || 'Failed to load users');
    } finally {
      setUsersLoading(false);
      setUsersRefreshing(false);
    }
  };

  const loadBranches = async () => {
    try {
      setBranchesLoading(true);
      setBranchesError(null);
      const res = await fetch(`${API_BASE}/api/admin/branches`, { credentials: 'include' });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || json.success === false || !Array.isArray(json.data)) {
        throw new Error(json?.message || 'Failed to load branches');
      }
      setBranches(json.data as BranchRecord[]);
    } catch (e: any) {
      setBranchesError(e?.message || 'Failed to load branches');
    } finally {
      setBranchesLoading(false);
    }
  };

  const handleCreateBranch = async () => {
    const code = branchCreateCode.trim();
    const name = branchCreateName.trim();
    if (!/^\d{2}$/.test(code)) {
      setBranchesError('Branch code must be exactly 2 digits');
      return;
    }
    if (!name) {
      setBranchesError('Branch name is required');
      return;
    }
    try {
      setBranchCreating(true);
      setBranchesError(null);
      const res = await fetch(`${API_BASE}/api/admin/branches`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, name }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || json.success === false) {
        throw new Error(json?.message || json?.error || 'Failed to create branch');
      }
      setBranchCreateCode('');
      setBranchCreateName('');
      await loadBranches();
    } catch (e: any) {
      setBranchesError(e?.message || 'Failed to create branch');
    } finally {
      setBranchCreating(false);
    }
  };

  const handleToggleBranchActive = async (branch: BranchRecord) => {
    const id = String(branch?.id || '').trim();
    if (!id) return;
    try {
      setBranchSavingId(id);
      setBranchesError(null);
      const nextActive = branch.active === false;
      const res = await fetch(`${API_BASE}/api/admin/branches/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: nextActive }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || json.success === false) {
        throw new Error(json?.message || json?.error || 'Failed to update branch');
      }
      const updated = (json.data || null) as BranchRecord | null;
      if (updated && updated.id) {
        setBranches((prev) => prev.map((b) => (b.id === updated.id ? { ...b, ...updated } : b)));
      } else {
        setBranches((prev) => prev.map((b) => (b.id === id ? { ...b, active: nextActive } : b)));
      }
    } catch (e: any) {
      setBranchesError(e?.message || 'Failed to update branch');
    } finally {
      setBranchSavingId(null);
    }
  };

  const handleSetUserRole = async (userId: string, role: string) => {
    try {
      setSavingUserId(userId);
      setUsersError(null);
      const res = await fetch(`${API_BASE}/api/admin/users/${encodeURIComponent(userId)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || json.success === false) {
        throw new Error(json?.message || 'Failed to update user');
      }
      const updated = (json.data || null) as UserRecord | null;
      if (updated && updated.id) {
        setUsers((prev) => prev.map((u) => (u.id === updated.id ? { ...u, ...updated } : u)));
      } else {
        setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role } : u)));
      }
    } catch (e: any) {
      setUsersError(e?.message || 'Failed to update user');
    } finally {
      setSavingUserId(null);
    }
  };

  const handleResetUserPassword = async (userId: string) => {
    const nextPassword = window.prompt('Enter a new password (min 8 characters):');
    if (!nextPassword) return;
    try {
      setSavingUserId(userId);
      setUsersError(null);
      const res = await fetch(`${API_BASE}/api/admin/users/${encodeURIComponent(userId)}/password`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: nextPassword }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || json.success === false) {
        throw new Error(json?.message || 'Failed to reset password');
      }
    } catch (e: any) {
      setUsersError(e?.message || 'Failed to reset password');
    } finally {
      setSavingUserId(null);
    }
  };

  const handlePromoteToAgent = async (userId: string) => {
    try {
      setSavingUserId(userId);
      setUsersError(null);
      const res = await fetch(`${API_BASE}/api/admin/users/${encodeURIComponent(userId)}/make-agent`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || json.success === false) {
        throw new Error(json?.message || 'Failed to promote user to agent');
      }
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role: 'agent' } : u)));
      await loadUsers();

      try {
        setAgentsLoading(true);
        setAgentsError(null);
        const agentsRes = await fetch(`${API_BASE}/api/v1/agents`, { credentials: 'include' });
        if (agentsRes.ok) {
          const agentsJson = await agentsRes.json().catch(() => null);
          if (agentsJson?.success !== false && Array.isArray(agentsJson?.data)) {
            setAgents(agentsJson.data);
          }
        }
      } finally {
        setAgentsLoading(false);
      }
    } catch (e: any) {
      setUsersError(e?.message || 'Failed to promote user to agent');
    } finally {
      setSavingUserId(null);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    const ok = window.confirm('Delete this user? This cannot be undone.');
    if (!ok) return;
    try {
      setDeletingUserId(userId);
      setUsersError(null);
      const res = await fetch(`${API_BASE}/api/admin/users/${encodeURIComponent(userId)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || json.success === false) {
        throw new Error(json?.message || 'Failed to delete user');
      }
      setUsers((prev) => prev.filter((u) => u.id !== userId));
    } catch (e: any) {
      setUsersError(e?.message || 'Failed to delete user');
    } finally {
      setDeletingUserId(null);
    }
  };

  useEffect(() => {
    if (activeSection !== 'users') return;
    if (usersRefreshing) return;
    loadUsers();
  }, [activeSection]);

  useEffect(() => {
    if (activeSection !== 'branches') return;
    loadBranches();
  }, [activeSection]);

  useEffect(() => {
    if (activeSection !== 'reports' || reportsView !== 'profitability') return;

    setProfitabilityPage(1);
  }, [activeSection, reportsView, profitabilityRange, profitabilityDateFrom, profitabilityDateTo]);

  useEffect(() => {
    if (activeSection !== 'reports' || reportsView !== 'profitability') return;

    let cancelled = false;

    async function loadProfitability() {
      try {
        setProfitabilityLoading(true);
        setProfitabilityError(null);

        const params = new URLSearchParams();
        params.set('page', String(profitabilityPage));
        params.set('pageSize', String(profitabilityPageSize));
        applyRangeParams(params, profitabilityRange, profitabilityDateFrom, profitabilityDateTo);

        const url = `${API_BASE}/api/admin/reports/profitability?${params.toString()}`;

        const res = await fetch(url, {
          credentials: 'include',
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
  }, [activeSection, reportsView, profitabilityPage, profitabilityPageSize, profitabilityRange, profitabilityDateFrom, profitabilityDateTo]);

  const profitabilityTotalPages = (() => {
    const tp = profitabilityReport?.totalPages;
    const n = typeof tp === 'number' ? tp : Number(tp);
    return Number.isFinite(n) && n > 0 ? n : 1;
  })();

  const profitabilityRows: any[] = Array.isArray(profitabilityReport?.rows)
    ? profitabilityReport.rows
    : [];

  const profitabilityTotals = profitabilityReport?.totals || {};

  const fmtMoney = (value: any): string => {
    if (value == null) return '0.00';
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) return '0.00';
    try {
      return n.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    } catch {
      return String(n);
    }
  };

  const fmtPct = (value: any): string => {
    if (value == null) return '0.00%';
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) return '0.00%';
    return `${(n * 100).toFixed(2)}%`;
  };

  const handleProfitabilityPrev = () => {
    setProfitabilityPage((p) => Math.max(1, p - 1));
  };

  const handleProfitabilityNext = () => {
    setProfitabilityPage((p) => Math.min(profitabilityTotalPages, p + 1));
  };

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
              <button
                type="button"
                onClick={() => { setActiveSection('agents'); setSidebarOpen(false); }}
                className="w-full text-left rounded-md px-3 py-2.5 text-sm font-medium text-purple-800 hover:bg-purple-50 hover:text-purple-700 dark:text-purple-100 dark:hover:bg-gray-800/80"
              >
                Agents
              </button>
              <button
                type="button"
                onClick={() => { setActiveSection('users'); setSidebarOpen(false); }}
                className="w-full text-left rounded-md px-3 py-2.5 text-sm font-medium text-purple-800 hover:bg-purple-50 hover:text-purple-700 dark:text-purple-100 dark:hover:bg-gray-800/80"
              >
                Users
              </button>
              <button
                type="button"
                onClick={() => { setActiveSection('branches'); setSidebarOpen(false); }}
                className="w-full text-left rounded-md px-3 py-2.5 text-sm font-medium text-purple-800 hover:bg-purple-50 hover:text-purple-700 dark:text-purple-100 dark:hover:bg-gray-800/80"
              >
                Branches
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
                <div className="flex items-center gap-3" data-admin-notifications>
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setNotificationsOpen((v) => !v)}
                      className="relative inline-flex items-center justify-center h-9 w-9 rounded-full border border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-800/60 hover:bg-white dark:hover:bg-gray-800"
                      aria-label="Notifications"
                    >
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                        className="text-gray-700 dark:text-gray-200"
                      >
                        <path
                          d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2Zm6-6V11a6 6 0 0 0-5-5.91V4a1 1 0 0 0-2 0v1.09A6 6 0 0 0 6 11v5l-2 2v1h16v-1l-2-2Z"
                          fill="currentColor"
                        />
                      </svg>
                      {notificationsUnreadCount > 0 && (
                        <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-semibold flex items-center justify-center">
                          {notificationsUnreadCount > 99 ? '99+' : notificationsUnreadCount}
                        </span>
                      )}
                    </button>
                    {notificationsOpen && (
                      <div className="absolute right-0 mt-2 w-96 max-w-[90vw] rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg overflow-hidden">
                        <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                          <div className="text-sm font-semibold text-gray-900 dark:text-gray-50">Notifications</div>
                          <button
                            type="button"
                            onClick={() => loadNotifications({ silent: false })}
                            className="text-xs font-medium text-purple-700 dark:text-purple-300 hover:underline"
                          >
                            Refresh
                          </button>
                        </div>
                        <div className="max-h-[360px] overflow-y-auto">
                          {notificationsLoading && (
                            <div className="px-3 py-3 text-xs text-gray-600 dark:text-gray-300">Loading...</div>
                          )}
                          {!notificationsLoading && notificationsError && (
                            <div className="px-3 py-3 text-xs text-red-700 dark:text-red-300">{notificationsError}</div>
                          )}
                          {!notificationsLoading && !notificationsError && notificationsRows.length === 0 && (
                            <div className="px-3 py-3 text-xs text-gray-600 dark:text-gray-300">No notifications yet.</div>
                          )}
                          {!notificationsLoading && !notificationsError && notificationsRows.map((n) => {
                            const created = (n && (n.createdAtMs || n.createdAt)) || null;
                            const when = created ? formatDate(created) : '-';
                            const unread = n && n.read !== true;
                            return (
                              <button
                                key={n.id}
                                type="button"
                                onClick={() => markNotificationRead(n.id)}
                                className={`w-full text-left px-3 py-2 border-b border-gray-100 dark:border-gray-700/60 hover:bg-gray-50 dark:hover:bg-gray-700/30 ${unread ? 'bg-purple-50/70 dark:bg-purple-900/20' : ''}`}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <div className="text-xs font-semibold text-gray-900 dark:text-gray-50 truncate">
                                      {n.title || 'Notification'}
                                    </div>
                                    <div className="mt-0.5 text-[11px] text-gray-700 dark:text-gray-200 line-clamp-2">
                                      {n.message || ''}
                                    </div>
                                    <div className="mt-1 text-[10px] text-gray-500 dark:text-gray-400">{when}</div>
                                  </div>
                                  {unread && (
                                    <span className="mt-1 h-2 w-2 rounded-full bg-purple-600 dark:bg-purple-300 flex-shrink-0" />
                                  )}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
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
              <div className="flex flex-col gap-1">
                <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-50">Reports</h2>
              </div>
              <div className="flex items-center gap-2">
                <div className="inline-flex rounded-md border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setReportsView('summary')}
                    className={`px-2 py-1 text-[11px] font-medium transition-colors ${
                      reportsView === 'summary'
                        ? 'bg-purple-600 text-white'
                        : 'text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800'
                    }`}
                  >
                    Summary
                  </button>
                  <button
                    type="button"
                    onClick={() => setReportsView('profitability')}
                    className={`px-2 py-1 text-[11px] font-medium transition-colors ${
                      reportsView === 'profitability'
                        ? 'bg-purple-600 text-white'
                        : 'text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800'
                    }`}
                  >
                    Profitability
                  </button>
                </div>
                {reportsView === 'summary' && reportsLoading && (
                  <span className="text-xs text-gray-500 dark:text-gray-400">Loading...</span>
                )}
                {reportsView === 'profitability' && profitabilityLoading && (
                  <span className="text-xs text-gray-500 dark:text-gray-400">Loading...</span>
                )}
                {reportsView === 'summary' && reportsSummary && !reportsLoading && (
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
                      onClick={handleExportReportsPdf}
                      className="inline-flex items-center rounded-md border border-purple-200 bg-purple-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-purple-700 dark:border-purple-500/60"
                    >
                      PDF
                    </button>
                  </>
                )}
              </div>
            </div>
            {reportsView === 'summary' && reportsError && (
              <div className="px-4 py-2 text-xs text-red-800 bg-red-50 border-b border-red-200 dark:bg-red-950/40 dark:border-red-900/60 dark:text-red-200">
                {reportsError}
              </div>
            )}
            {reportsView === 'profitability' && profitabilityError && (
              <div className="px-4 py-2 text-xs text-red-800 bg-red-50 border-b border-red-200 dark:bg-red-950/40 dark:border-red-900/60 dark:text-red-200">
                {profitabilityError}
              </div>
            )}
            {reportsView === 'summary' && reportsSummary && (
              <div className="px-4 pt-2 text-[10px] text-gray-500 dark:text-gray-400">
                Debug totals: tickets={String(totalTickets)} | revenue={String(totalRevenue)} | branches={String(branchesCount)} | range={summaryRangeLabel}
              </div>
            )}

            {reportsView === 'profitability' && (
              <div className="px-4 py-3 text-xs md:text-sm">
                <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div className="text-[11px] text-gray-600 dark:text-gray-300">
                    Page {profitabilityPage} of {profitabilityTotalPages} · Showing {profitabilityRows.length} rows · Range {profitabilityRangeLabel}
                    {typeof profitabilityReport?.totalRows === 'number' || profitabilityReport?.totalRows != null
                      ? ` (total ${String(profitabilityReport.totalRows)})`
                      : ''}
                  </div>
                  <div className="flex items-center gap-2">
                    {renderRangeFilter(
                      profitabilityRange,
                      profitabilityDateFrom,
                      profitabilityDateTo,
                      setProfitabilityRange,
                      setProfitabilityDateFrom,
                      setProfitabilityDateTo,
                    )}
                    <label className="text-[11px] text-gray-600 dark:text-gray-300">Page size</label>
                    <select
                      value={profitabilityPageSize}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        setProfitabilityPageSize(Number.isFinite(n) && n > 0 ? n : 25);
                        setProfitabilityPage(1);
                      }}
                      className="rounded-md border border-gray-300 px-2 py-1 text-[11px] text-gray-900 focus:outline-none focus:ring-1 focus:ring-purple-500 focus:border-purple-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                    >
                      <option value={10}>10</option>
                      <option value={25}>25</option>
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                    </select>
                    <button
                      type="button"
                      onClick={handleProfitabilityPrev}
                      disabled={profitabilityPage <= 1}
                      className="inline-flex items-center rounded-md border border-gray-300 bg-white px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
                    >
                      Prev
                    </button>
                    <button
                      type="button"
                      onClick={handleProfitabilityNext}
                      disabled={profitabilityPage >= profitabilityTotalPages}
                      className="inline-flex items-center rounded-md border border-gray-300 bg-white px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
                    >
                      Next
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-[11px]">
                    <thead className="bg-gray-50 dark:bg-gray-800/80">
                      <tr>
                        <th className="px-2 py-2 text-left font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">Date</th>
                        <th className="px-2 py-2 text-left font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">Ref</th>
                        <th className="px-2 py-2 text-left font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">Booked by</th>
                        <th className="px-2 py-2 text-left font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">Branch</th>
                        <th className="px-2 py-2 text-left font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">Operator</th>
                        <th className="px-2 py-2 text-left font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">Method</th>
                        <th className="px-2 py-2 text-left font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">Status</th>
                        <th className="px-2 py-2 text-right font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">Cost</th>
                        <th className="px-2 py-2 text-right font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">Markup</th>
                        <th className="px-2 py-2 text-right font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">Discount</th>
                        <th className="px-2 py-2 text-right font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">Charges</th>
                        <th className="px-2 py-2 text-right font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">Retail</th>
                        <th className="px-2 py-2 text-right font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">Round diff</th>
                        <th className="px-2 py-2 text-right font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">Commission</th>
                        <th className="px-2 py-2 text-right font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">Profit</th>
                        <th className="px-2 py-2 text-right font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">Margin</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {profitabilityRows.length === 0 ? (
                        <tr>
                          <td colSpan={16} className="py-3 text-center text-xs text-gray-500 dark:text-gray-400">
                            No profitability rows found for this range.
                          </td>
                        </tr>
                      ) : (
                        profitabilityRows.map((row: any, idx: number) => {
                          const dateLabel = (() => {
                            const raw = row.createdAt || row.created_at || row.paidOn || row.paid_on;
                            if (!raw) return '-';
                            const d = new Date(raw);
                            return Number.isNaN(d.getTime()) ? String(raw) : d.toLocaleString();
                          })();

                          const ref = row.transactionRef || row.transaction_ref || row.reference || '-';
                          const bookedBy = row.bookedBy || row.booked_by || '-';
                          const branch = row.branch || '-';
                          const operator = row.operator || '-';
                          const method = row.paymentType || row.payment_type || row.method || '-';
                          const status = row.status || '-';

                          const cost = row.costPrice;
                          const markup = row.markup;
                          const discount = row.discount;
                          const charges = row.charges;
                          const retail = row.retailPrice;
                          const commission = row.commission ?? row.commission_amount ?? row.commissionAmount;
                          const profit = row.profit;
                          const margin = row.margin;

                          const profitNum = typeof profit === 'number' ? profit : Number(profit);
                          const profitClass = Number.isFinite(profitNum)
                            ? (profitNum >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300')
                            : 'text-gray-700 dark:text-gray-200';

                          return (
                            <tr key={ref || idx}>
                              <td className="px-2 py-1 whitespace-nowrap text-gray-700 dark:text-gray-200">{dateLabel}</td>
                              <td className="px-2 py-1 whitespace-nowrap text-gray-700 dark:text-gray-200">{ref}</td>
                              <td className="px-2 py-1 whitespace-nowrap text-gray-700 dark:text-gray-200">{bookedBy}</td>
                              <td className="px-2 py-1 whitespace-nowrap text-gray-700 dark:text-gray-200">{branch}</td>
                              <td className="px-2 py-1 whitespace-nowrap text-gray-700 dark:text-gray-200">{operator}</td>
                              <td className="px-2 py-1 whitespace-nowrap text-gray-700 dark:text-gray-200">{method}</td>
                              <td className="px-2 py-1 whitespace-nowrap text-gray-700 dark:text-gray-200">{status}</td>
                              <td className="px-2 py-1 whitespace-nowrap text-right text-gray-900 dark:text-gray-50">{fmtMoney(cost)}</td>
                              <td className="px-2 py-1 whitespace-nowrap text-right text-gray-900 dark:text-gray-50">{fmtMoney(markup)}</td>
                              <td className="px-2 py-1 whitespace-nowrap text-right text-gray-900 dark:text-gray-50">{fmtMoney(discount)}</td>
                              <td className="px-2 py-1 whitespace-nowrap text-right text-gray-900 dark:text-gray-50">{fmtMoney(charges)}</td>
                              <td className="px-2 py-1 whitespace-nowrap text-right text-gray-900 dark:text-gray-50">{fmtMoney(retail)}</td>
                              <td className="px-2 py-1 whitespace-nowrap text-right text-gray-900 dark:text-gray-50">{fmtMoney(row.round_diff)}</td>
                              <td className="px-2 py-1 whitespace-nowrap text-right text-gray-900 dark:text-gray-50">{fmtMoney(commission)}</td>
                              <td className={`px-2 py-1 whitespace-nowrap text-right font-semibold ${profitClass}`}>{fmtMoney(profit)}</td>
                              <td className="px-2 py-1 whitespace-nowrap text-right text-gray-900 dark:text-gray-50">{fmtPct(margin)}</td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                    <tfoot className="bg-gray-50 dark:bg-gray-800/80">
                      <tr>
                        <td colSpan={7} className="px-2 py-2 text-[11px] font-semibold text-gray-700 dark:text-gray-200">
                          Totals
                        </td>
                        <td className="px-2 py-2 text-right text-[11px] font-semibold text-gray-900 dark:text-gray-50">{fmtMoney(profitabilityTotals.costPrice)}</td>
                        <td className="px-2 py-2 text-right text-[11px] font-semibold text-gray-900 dark:text-gray-50">{fmtMoney(profitabilityTotals.markup)}</td>
                        <td className="px-2 py-2 text-right text-[11px] font-semibold text-gray-900 dark:text-gray-50">{fmtMoney(profitabilityTotals.discount)}</td>
                        <td className="px-2 py-2 text-right text-[11px] font-semibold text-gray-900 dark:text-gray-50">{fmtMoney(profitabilityTotals.charges)}</td>
                        <td className="px-2 py-2 text-right text-[11px] font-semibold text-gray-900 dark:text-gray-50">{fmtMoney(profitabilityTotals.retailPrice)}</td>
                        <td className="px-2 py-2 text-right text-[11px] font-semibold text-gray-900 dark:text-gray-50">{fmtMoney(profitabilityTotals.round_diff)}</td>
                        <td className="px-2 py-2 text-right text-[11px] font-semibold text-gray-900 dark:text-gray-50">{fmtMoney(profitabilityTotals.commission ?? profitabilityTotals.commission_amount ?? profitabilityTotals.commissionAmount)}</td>
                        <td className="px-2 py-2 text-right text-[11px] font-semibold text-gray-900 dark:text-gray-50">{fmtMoney(profitabilityTotals.profit)}</td>
                        <td className="px-2 py-2 text-right text-[11px] font-semibold text-gray-900 dark:text-gray-50">{fmtPct(profitabilityTotals.margin)}</td>
                      </tr>
                      <tr>
                        <td colSpan={16} className="px-2 pb-2 text-[10px] text-gray-500 dark:text-gray-400">
                          Net adjustment (markup + charges - discount): {fmtMoney(profitabilityTotals.profitability)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}

            {reportsView === 'summary' && (
            <>
            <div className="px-4 py-3 text-xs md:text-sm">
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm">
                <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-gray-900 dark:text-gray-50">Summary ({summaryRangeLabel})</h3>
                  {renderRangeFilter(
                    summaryRange,
                    summaryDateFrom,
                    summaryDateTo,
                    setSummaryRange,
                    setSummaryDateFrom,
                    setSummaryDateTo,
                  )}
                </div>
                <div className="overflow-x-auto">
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
                            Across all branches and operators ({summaryRangeLabel})
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
                            Sum of ticket revenue in primary currency ({summaryRangeLabel})
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
                            Branches with recorded ticket sales ({summaryRangeLabel})
                          </td>
                        </tr>
                      </>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            </div>

            <div className="mt-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm">
              <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                <h3 className="text-xs font-semibold text-gray-900 dark:text-gray-50">Totals ({summaryRangeLabel})</h3>
                {summaryProfitabilityLoading && (
                  <span className="text-[11px] text-gray-500 dark:text-gray-400">Loading...</span>
                )}
              </div>
              {summaryProfitabilityError && (
                <div className="px-3 py-2 text-[11px] text-red-800 bg-red-50 border-b border-red-200 dark:bg-red-950/40 dark:border-red-900/60 dark:text-red-200">
                  {summaryProfitabilityError}
                </div>
              )}
              {!summaryProfitabilityLoading && !summaryProfitabilityError && !summaryProfitabilityTotals && (
                <div className="px-3 py-3 text-[11px] text-gray-600 dark:text-gray-300 text-center">
                  No profitability totals available for this range.
                </div>
              )}
              {!summaryProfitabilityLoading && !summaryProfitabilityError && summaryProfitabilityTotals && (
                <div className="px-3 py-2 overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-[11px]">
                    <thead className="bg-gray-50 dark:bg-gray-800/80">
                      <tr>
                        <th className="px-2 py-2 text-left font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">Metric</th>
                        <th className="px-2 py-2 text-right font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      <tr>
                        <td className="px-2 py-2 text-gray-700 dark:text-gray-200">Cost</td>
                        <td className="px-2 py-2 text-right font-medium text-gray-900 dark:text-gray-50">{fmtMoney(summaryProfitabilityTotals.costPrice)} {primaryCurrency || ''}</td>
                      </tr>
                      <tr>
                        <td className="px-2 py-2 text-gray-700 dark:text-gray-200">Markup</td>
                        <td className="px-2 py-2 text-right font-medium text-gray-900 dark:text-gray-50">{fmtMoney(summaryProfitabilityTotals.markup)} {primaryCurrency || ''}</td>
                      </tr>
                      <tr>
                        <td className="px-2 py-2 text-gray-700 dark:text-gray-200">Discount</td>
                        <td className="px-2 py-2 text-right font-medium text-gray-900 dark:text-gray-50">{fmtMoney(summaryProfitabilityTotals.discount)} {primaryCurrency || ''}</td>
                      </tr>
                      <tr>
                        <td className="px-2 py-2 text-gray-700 dark:text-gray-200">Charges</td>
                        <td className="px-2 py-2 text-right font-medium text-gray-900 dark:text-gray-50">{fmtMoney(summaryProfitabilityTotals.charges)} {primaryCurrency || ''}</td>
                      </tr>
                      <tr>
                        <td className="px-2 py-2 text-gray-700 dark:text-gray-200">Retail</td>
                        <td className="px-2 py-2 text-right font-medium text-gray-900 dark:text-gray-50">{fmtMoney(summaryProfitabilityTotals.retailPrice)} {primaryCurrency || ''}</td>
                      </tr>
                      <tr>
                        <td className="px-2 py-2 text-gray-700 dark:text-gray-200">Round diff</td>
                        <td className="px-2 py-2 text-right font-medium text-gray-900 dark:text-gray-50">{fmtMoney(summaryProfitabilityTotals.round_diff)} {primaryCurrency || ''}</td>
                      </tr>
                      <tr>
                        <td className="px-2 py-2 text-gray-700 dark:text-gray-200">Commission</td>
                        <td className="px-2 py-2 text-right font-medium text-gray-900 dark:text-gray-50">{fmtMoney(summaryProfitabilityTotals.commission ?? summaryProfitabilityTotals.commission_amount ?? summaryProfitabilityTotals.commissionAmount)} {primaryCurrency || ''}</td>
                      </tr>
                      <tr>
                        <td className="px-2 py-2 text-gray-700 dark:text-gray-200">Profit</td>
                        <td className="px-2 py-2 text-right font-semibold text-gray-900 dark:text-gray-50">{fmtMoney(summaryProfitabilityTotals.profit)} {primaryCurrency || ''}</td>
                      </tr>
                      <tr>
                        <td className="px-2 py-2 text-gray-700 dark:text-gray-200">Margin</td>
                        <td className="px-2 py-2 text-right font-medium text-gray-900 dark:text-gray-50">{fmtPct(summaryProfitabilityTotals.margin)}</td>
                      </tr>
                    </tbody>
                  </table>
                  <div className="px-2 pb-2 pt-1 text-[10px] text-gray-500 dark:text-gray-400">
                    Net adjustment (markup + charges - discount): {fmtMoney(summaryProfitabilityTotals.profitability)} {primaryCurrency || ''}
                  </div>
                </div>
              )}
            </div>

            {Object.keys(currencyRevenueByCurrency || {}).length > 0 && (
              <div className="px-4 pb-3">
                <div className="mt-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm">
                  <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                    <h3 className="text-xs font-semibold text-gray-900 dark:text-gray-50">Revenue by currency ({currencyRangeLabel})</h3>
                    {renderRangeFilter(
                      currencyRange,
                      currencyDateFrom,
                      currencyDateTo,
                      setCurrencyRange,
                      setCurrencyDateFrom,
                      setCurrencyDateTo,
                    )}
                  </div>
                  <div className="px-3 py-2 grid grid-cols-1 md:grid-cols-3 gap-2 text-xs text-gray-700 dark:text-gray-200">
                    {Object.entries(currencyRevenueByCurrency as Record<string, number>).map(([code, amount]) => (
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
                    <h3 className="text-xs font-semibold text-gray-900 dark:text-gray-50">Daily breakdown ({dailyRangeLabel})</h3>
                    {renderRangeFilter(
                      dailyRange,
                      dailyDateFrom,
                      dailyDateTo,
                      setDailyRange,
                      setDailyDateFrom,
                      setDailyDateTo,
                    )}
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
                              {Number(day?.revenue || 0).toLocaleString()} {dailyPrimaryCurrency || ''}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </div>
              </div>
                )}

                {reportsSummary && (
              <div className="px-4 pb-4 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs md:text-sm">
                <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm">
                  <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                    <h3 className="text-xs font-semibold text-gray-900 dark:text-gray-50">Top branches ({topBranchesRangeLabel})</h3>
                    {renderRangeFilter(
                      topBranchesRange,
                      topBranchesDateFrom,
                      topBranchesDateTo,
                      setTopBranchesRange,
                      setTopBranchesDateFrom,
                      setTopBranchesDateTo,
                    )}
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
                                {Number(row.revenue || 0).toLocaleString()} {topBranchesPrimaryCurrency || ''}
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
                    <h3 className="text-xs font-semibold text-gray-900 dark:text-gray-50">Top operators ({topOperatorsRangeLabel})</h3>
                    {renderRangeFilter(
                      topOperatorsRange,
                      topOperatorsDateFrom,
                      topOperatorsDateTo,
                      setTopOperatorsRange,
                      setTopOperatorsDateFrom,
                      setTopOperatorsDateTo,
                    )}
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
                                {Number(row.revenue || 0).toLocaleString()} {topOperatorsPrimaryCurrency || ''}
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
                    <h3 className="text-xs font-semibold text-gray-900 dark:text-gray-50">Payment methods ({paymentTypesRangeLabel})</h3>
                    {renderRangeFilter(
                      paymentTypesRange,
                      paymentTypesDateFrom,
                      paymentTypesDateTo,
                      setPaymentTypesRange,
                      setPaymentTypesDateFrom,
                      setPaymentTypesDateTo,
                    )}
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
                                {Number(row.revenue || 0).toLocaleString()} {paymentTypesPrimaryCurrency || ''}
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
                    Transactions (per passenger) ({transactionsRangeLabel})
                  </h3>
                  <div className="flex items-center gap-2">
                    {renderRangeFilter(
                      transactionsRange,
                      transactionsDateFrom,
                      transactionsDateTo,
                      setTransactionsRange,
                      setTransactionsDateFrom,
                      setTransactionsDateTo,
                    )}
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
                            colSpan={13}
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
                    <tfoot className="bg-gray-50 dark:bg-gray-800/80">
                      <tr>
                        <td colSpan={12} className="px-2 py-2 text-[11px] font-semibold text-gray-700 dark:text-gray-200">
                          Page subtotal
                        </td>
                        <td className="px-2 py-2 text-right text-[11px] font-semibold text-gray-900 dark:text-gray-50">
                          {fmtMoney(transactionsPageSubtotal)} {transactionsPageCurrency}
                        </td>
                      </tr>
                      <tr>
                        <td colSpan={12} className="px-2 py-2 text-[11px] font-semibold text-gray-700 dark:text-gray-200">
                          Filtered total ({filteredTransactions.length} passengers)
                        </td>
                        <td className="px-2 py-2 text-right text-[11px] font-semibold text-gray-900 dark:text-gray-50">
                          {fmtMoney(transactionsFilteredTotal)} {transactionsFilteredCurrency}
                        </td>
                      </tr>
                    </tfoot>
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
            </>
            )}
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
                    (async () => {
                      try {
                        setSavingAds(true);
                        setAdsError(null);
                        const res = await fetch(`${API_BASE}/api/ads`, {
                          method: 'PUT',
                          headers: { 'Content-Type': 'application/json' },
                          credentials: 'include',
                          body: JSON.stringify(ads),
                        });
                        const json = await res.json().catch(() => null);
                        if (!res.ok || !json || json.success !== true) {
                          const msg = (json && (json.message || json.error)) ? String(json.message || json.error) : 'Failed to save ads';
                          throw new Error(msg);
                        }
                        if (Array.isArray(json.data)) {
                          setAds(json.data as AdDefinition[]);
                          try { saveConfiguredAds(json.data as AdDefinition[]); } catch {}
                        } else {
                          try { saveConfiguredAds(ads); } catch {}
                        }
                      } catch (e: any) {
                        setAdsError(e?.message || 'Failed to save ads');
                        try { saveConfiguredAds(ads); } catch {}
                      } finally {
                        setSavingAds(false);
                      }
                    })();
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

          {activeSection === 'agents' && (
          <section id="agents" className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-50">Agents</h2>
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
                        <td colSpan={4} className="px-4 py-3 text-gray-600 dark:text-gray-300 text-center">No agents found.</td>
                      </tr>
                    ) : (
                      agents.map((agent) => (
                        <tr key={agent.id} className="border-t border-gray-100 dark:border-gray-700/70">
                          <td className="px-4 py-2 text-gray-900 dark:text-gray-50">{[agent.firstName, agent.lastName].filter(Boolean).join(' ') || '—'}</td>
                          <td className="px-4 py-2 text-gray-900 dark:text-gray-50">{agent.email || '—'}</td>
                          <td className="px-4 py-2">
                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${agent.active ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200' : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'}`}>
                              {agent.active ? 'Active' : 'Pending approval'}
                            </span>
                          </td>
                          <td className="px-4 py-2">
                            <button
                              type="button"
                              disabled={agent.active || approvingAgentId === agent.id}
                              onClick={() => handleApproveAgent(agent.id)}
                              className={`inline-flex items-center rounded-md px-3 py-1 text-xs font-semibold shadow-sm ${agent.active ? 'bg-gray-200 text-gray-500 cursor-not-allowed dark:bg-gray-800 dark:text-gray-400' : 'bg-purple-600 text-white hover:bg-purple-700'} ${approvingAgentId === agent.id ? 'opacity-70 cursor-wait' : ''}`}
                            >
                              {agent.active ? 'Active' : approvingAgentId === agent.id ? 'Activating...' : 'Activate'}
                            </button>
                            <button
                              type="button"
                              onClick={() => openDeactivateModal(agent)}
                              disabled={!agent.active || deactivatingAgentId === agent.id}
                              className={`inline-flex items-center rounded-md px-3 py-1 text-xs font-semibold shadow-sm ml-2 ${(!agent.active || deactivatingAgentId === agent.id) ? 'bg-gray-200 text-gray-500 cursor-not-allowed dark:bg-gray-800 dark:text-gray-400' : 'bg-amber-600 text-white hover:bg-amber-700'}`}
                            >
                              {deactivatingAgentId === agent.id ? 'Deactivating...' : 'Deactivate'}
                            </button>
                            <button
                              type="button"
                              onClick={() => openDeleteModal(agent)}
                              disabled={deletingAgentId === agent.id}
                              className={`inline-flex items-center rounded-md px-3 py-1 text-xs font-semibold shadow-sm ml-2 ${deletingAgentId === agent.id ? 'bg-red-400 text-white cursor-wait' : 'bg-red-600 text-white hover:bg-red-700'}`}
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

          {activeSection === 'branches' && (
          <section id="branches" className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-50">Branches</h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={loadBranches}
                  className={`inline-flex items-center rounded-md px-3 py-1.5 text-xs font-semibold text-white shadow-sm ${branchesLoading ? 'bg-purple-400 cursor-wait' : 'bg-purple-600 hover:bg-purple-700'}`}
                  disabled={branchesLoading}
                >
                  {branchesLoading ? 'Refreshing...' : 'Refresh'}
                </button>
              </div>
            </div>

            <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700/70">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <input
                  value={branchCreateCode}
                  onChange={(e) => setBranchCreateCode(e.target.value)}
                  placeholder="Code (2 digits, e.g. 05)"
                  className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs text-gray-900 focus:outline-none focus:ring-1 focus:ring-purple-500 focus:border-purple-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                />
                <input
                  value={branchCreateName}
                  onChange={(e) => setBranchCreateName(e.target.value)}
                  placeholder="Name (e.g. Bulawayo)"
                  className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs text-gray-900 focus:outline-none focus:ring-1 focus:ring-purple-500 focus:border-purple-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                />
                <button
                  type="button"
                  onClick={handleCreateBranch}
                  disabled={branchCreating}
                  className={`inline-flex items-center justify-center rounded-md px-3 py-1.5 text-xs font-semibold text-white shadow-sm ${branchCreating ? 'bg-purple-400 cursor-wait' : 'bg-purple-600 hover:bg-purple-700'}`}
                >
                  {branchCreating ? 'Creating...' : 'Create branch'}
                </button>
              </div>
              {branchesError && (
                <div className="mt-2 text-xs text-red-600 dark:text-red-300">{branchesError}</div>
              )}
            </div>

            <div className="overflow-x-auto">
              {branchesLoading ? (
                <div className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">Loading branches...</div>
              ) : (
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-900/60">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Code</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Name</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Status</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {branches.length === 0 ? (
                      <tr className="border-t border-gray-100 dark:border-gray-700/70">
                        <td colSpan={4} className="px-4 py-3 text-gray-600 dark:text-gray-300 text-center">No branches found.</td>
                      </tr>
                    ) : (
                      branches.map((b) => (
                        <tr key={b.id} className="border-t border-gray-100 dark:border-gray-700/70">
                          <td className="px-4 py-2 text-gray-900 dark:text-gray-50">{b.code || '—'}</td>
                          <td className="px-4 py-2 text-gray-900 dark:text-gray-50">{b.name || '—'}</td>
                          <td className="px-4 py-2">
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${b.active === false ? 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200'}`}
                            >
                              {b.active === false ? 'Inactive' : 'Active'}
                            </span>
                          </td>
                          <td className="px-4 py-2">
                            <button
                              type="button"
                              onClick={() => handleToggleBranchActive(b)}
                              disabled={branchSavingId === b.id}
                              className={`inline-flex items-center rounded-md px-3 py-1 text-xs font-semibold shadow-sm ${branchSavingId === b.id ? 'bg-gray-200 text-gray-500 cursor-wait dark:bg-gray-800 dark:text-gray-400' : b.active === false ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-amber-600 text-white hover:bg-amber-700'}`}
                            >
                              {branchSavingId === b.id ? 'Saving...' : b.active === false ? 'Enable' : 'Disable'}
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

          {activeSection === 'users' && (
          <section id="users" className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-50">Users</h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={loadUsers}
                  className={`inline-flex items-center rounded-md px-3 py-1.5 text-xs font-semibold text-white shadow-sm ${usersRefreshing ? 'bg-purple-400 cursor-wait' : 'bg-purple-600 hover:bg-purple-700'}`}
                  disabled={usersRefreshing}
                >
                  {usersRefreshing ? 'Refreshing...' : 'Refresh'}
                </button>
              </div>
            </div>

            <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700/70">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <input
                  value={usersSearch}
                  onChange={(e) => setUsersSearch(e.target.value)}
                  placeholder="Search email/name/phone"
                  className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs text-gray-900 focus:outline-none focus:ring-1 focus:ring-purple-500 focus:border-purple-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                />
                <select
                  value={usersRoleFilter}
                  onChange={(e) => setUsersRoleFilter(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs text-gray-900 focus:outline-none focus:ring-1 focus:ring-purple-500 focus:border-purple-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                >
                  <option value="">All roles</option>
                  <option value="user">user</option>
                  <option value="agent">agent</option>
                  <option value="admin">admin</option>
                </select>
                <button
                  type="button"
                  onClick={loadUsers}
                  className="inline-flex items-center justify-center rounded-md border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
                >
                  Apply filters
                </button>
              </div>
              {usersError && (
                <div className="mt-2 text-xs text-red-600 dark:text-red-300">{usersError}</div>
              )}
            </div>

            <div className="overflow-x-auto">
              {usersLoading ? (
                <div className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">Loading users...</div>
              ) : (
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-900/60">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Name</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Email</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Role</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Phone</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.length === 0 ? (
                      <tr className="border-t border-gray-100 dark:border-gray-700/70">
                        <td colSpan={5} className="px-4 py-3 text-gray-600 dark:text-gray-300 text-center">No users found.</td>
                      </tr>
                    ) : (
                      users.map((u) => (
                        <tr key={u.id} className="border-t border-gray-100 dark:border-gray-700/70">
                          <td className="px-4 py-2 text-gray-900 dark:text-gray-50">{[u.firstName, u.lastName].filter(Boolean).join(' ') || '—'}</td>
                          <td className="px-4 py-2 text-gray-900 dark:text-gray-50">{u.emailLower || u.email || '—'}</td>
                          <td className="px-4 py-2">
                            <select
                              value={(u.role || 'user') as string}
                              onChange={(e) => handleSetUserRole(u.id, e.target.value)}
                              disabled={savingUserId === u.id}
                              className="rounded-md border border-gray-300 px-2 py-1 text-[11px] text-gray-900 focus:outline-none focus:ring-1 focus:ring-purple-500 focus:border-purple-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                            >
                              <option value="user">user</option>
                              <option value="agent">agent</option>
                              <option value="admin">admin</option>
                            </select>
                          </td>
                          <td className="px-4 py-2 text-gray-900 dark:text-gray-50">{u.phone || '—'}</td>
                          <td className="px-4 py-2">
                            <button
                              type="button"
                              onClick={() => handleResetUserPassword(u.id)}
                              disabled={savingUserId === u.id}
                              className={`inline-flex items-center rounded-md px-3 py-1 text-xs font-semibold shadow-sm ${savingUserId === u.id ? 'bg-gray-200 text-gray-500 cursor-wait dark:bg-gray-800 dark:text-gray-400' : 'bg-slate-700 text-white hover:bg-slate-800'}`}
                            >
                              Reset password
                            </button>
                            <button
                              type="button"
                              onClick={() => handlePromoteToAgent(u.id)}
                              disabled={savingUserId === u.id}
                              className={`inline-flex items-center rounded-md px-3 py-1 text-xs font-semibold shadow-sm ml-2 ${savingUserId === u.id ? 'bg-gray-200 text-gray-500 cursor-wait dark:bg-gray-800 dark:text-gray-400' : 'bg-purple-600 text-white hover:bg-purple-700'}`}
                            >
                              Make agent
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteUser(u.id)}
                              disabled={deletingUserId === u.id}
                              className={`inline-flex items-center rounded-md px-3 py-1 text-xs font-semibold shadow-sm ml-2 ${deletingUserId === u.id ? 'bg-red-400 text-white cursor-wait' : 'bg-red-600 text-white hover:bg-red-700'}`}
                            >
                              {deletingUserId === u.id ? 'Deleting...' : 'Delete'}
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
