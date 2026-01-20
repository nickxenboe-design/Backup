import React, { useEffect, useState } from 'react';

const API_BASE_RAW: string = (import.meta as any).env?.VITE_API_BASE_URL || '';
const API_BASE: string = String(API_BASE_RAW).replace(/\/+$/, '').replace(/\/api$/i, '');

const AdminReports: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<any | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch(`${API_BASE}/api/admin/reports/sales-summary`, {
          credentials: 'include',
        });

        if (!res.ok) {
          throw new Error('Failed to load reports');
        }

        const json = await res.json().catch(() => null);
        if (!json || json.success === false || !json.data) {
          throw new Error(json?.message || 'Failed to load reports');
        }

        if (!cancelled) {
          setSummary(json.data);
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message || 'Failed to load reports');
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

  const totalTickets =
    summary?.totalTicketsSold ??
    summary?.countersSummary?.totalTickets ??
    summary?.rangeTotals?.totalTickets ??
    0;

  const totalRevenue =
    summary?.totalRevenue ??
    summary?.countersSummary?.totalRevenue ??
    summary?.rangeTotals?.totalRevenue ??
    0;

  const revenueByCurrency =
    summary?.revenueByCurrency ??
    summary?.countersSummary?.revenueByCurrency ??
    summary?.rangeTotals?.revenueByCurrency ??
    {};

  const branchesObject =
    summary?.perBranch ??
    summary?.countersSummary?.perBranch ??
    summary?.rangeTotals?.perBranch ??
    {};

  const branchesCount = branchesObject ? Object.keys(branchesObject).length : 0;

  const primaryCurrency =
    revenueByCurrency && typeof revenueByCurrency === 'object'
      ? Object.keys(revenueByCurrency)[0]
      : undefined;

  const formattedRevenue = (() => {
    if (!totalRevenue || totalRevenue <= 0) return '0.00';
    try {
      return Number(totalRevenue).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    } catch {
      return String(totalRevenue);
    }
  })();

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 px-3 py-4">
      <div className="max-w-5xl mx-auto">
        <header className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold tracking-wide text-gray-500 dark:text-gray-400 uppercase">
              Admin / Reports
            </p>
            <h1 className="mt-0.5 text-xl md:text-2xl font-bold text-gray-900 dark:text-gray-50">
              Reports
            </h1>
          </div>
          <a
            href="/admin-dashboard"
            className="inline-flex items-center rounded-md border border-gray-300 dark:border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            Back to dashboard
          </a>
        </header>

        {loading && (
          <div className="mb-4 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-200">
            Loading reports...
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="relative overflow-hidden rounded-xl bg-white dark:bg-gray-800 shadow-sm border border-gray-200 dark:border-gray-700">
            <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-purple-500 via-pink-500 to-amber-400" />
            <div className="p-4 flex flex-col">
              <div className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                Total Tickets Sold
              </div>
              <div className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-50">
                {totalTickets.toLocaleString()}
              </div>
              <div className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
                Across all branches and operators
              </div>
            </div>
          </div>

          <div className="relative overflow-hidden rounded-xl bg-white dark:bg-gray-800 shadow-sm border border-gray-200 dark:border-gray-700">
            <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-emerald-400 to-teal-500" />
            <div className="p-4 flex flex-col">
              <div className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                Total Revenue
              </div>
              <div className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-50">
                {formattedRevenue} {primaryCurrency || ''}
              </div>
              <div className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
                Sum of ticket revenue in primary currency
              </div>
            </div>
          </div>

          <div className="relative overflow-hidden rounded-xl bg-white dark:bg-gray-800 shadow-sm border border-gray-200 dark:border-gray-700">
            <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-sky-400 to-indigo-500" />
            <div className="p-4 flex flex-col">
              <div className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                Active Branches
              </div>
              <div className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-50">
                {branchesCount}
              </div>
              <div className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
                With recorded ticket sales
              </div>
            </div>
          </div>
        </div>

        {primaryCurrency && revenueByCurrency && (
          <div className="mt-4 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-50">Revenue by currency</h2>
            </div>
            <div className="px-4 py-3 text-xs text-gray-700 dark:text-gray-200 grid grid-cols-1 md:grid-cols-3 gap-2">
              {Object.entries(revenueByCurrency as Record<string, number>).map(([code, amount]) => (
                <div key={code} className="flex items-baseline justify-between">
                  <span className="font-medium text-gray-600 dark:text-gray-300">{code}</span>
                  <span className="text-gray-900 dark:text-gray-50">
                    {Number(amount || 0).toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminReports;
