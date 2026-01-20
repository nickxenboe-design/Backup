import React, { useEffect, useState } from 'react';
import { getMyBookings, timestampToLocaleDateTime } from '../utils/api';
import type { MyBookingSummary } from '../utils/api';

export type BookingSummary = MyBookingSummary;

type MyBookingsProps = {
  onViewTickets?: (cartId: string) => void;
  showHeader?: boolean;
};

const MyBookings: React.FC<MyBookingsProps> = ({ onViewTickets, showHeader = true }) => {
  const [bookings, setBookings] = useState<BookingSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await getMyBookings();
        if (cancelled) return;
        setBookings(Array.isArray(res) ? res : []);
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message || 'Failed to load bookings');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  const now = new Date();
  const toDate = (value: any): Date | null => {
    if (!value && value !== 0) return null;
    try {
      if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
      if (typeof value === 'number') return new Date(value);
      if (typeof value === 'string') {
        const d = new Date(value);
        return isNaN(d.getTime()) ? null : d;
      }
    } catch {}
    return null;
  };

  const withDepart = bookings.map((b) => ({ ...b, _departDate: toDate(b.departAt || b.createdAt) || null }));
  const upcoming = withDepart
    .filter((b) => b._departDate && b._departDate >= now)
    .sort((a, b) => (a._departDate && b._departDate ? a._departDate.getTime() - b._departDate.getTime() : 0));
  const past = withDepart
    .filter((b) => b._departDate && b._departDate < now)
    .sort((a, b) => (a._departDate && b._departDate ? b._departDate.getTime() - a._departDate.getTime() : 0));

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {showHeader && (
        <header className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 md:text-3xl dark:text-gray-50">My bookings</h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              View your upcoming and past trips, and open any booking to see its tickets.
            </p>
          </div>
        </header>
      )}

      {loading && (
        <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-700 shadow-sm dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200">
          Loading your bookings...
        </div>
      )}

      {error && !loading && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 shadow-sm dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </div>
      )}

      {!loading && !error && bookings.length === 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-600 shadow-sm dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
          You don&apos;t have any bookings yet. Search for a trip to make your first booking.
        </div>
      )}

      {!loading && !error && bookings.length > 0 && (
        <div className="space-y-5">
          <section>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-50">Upcoming bookings</h2>
            {upcoming.length === 0 ? (
              <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">You have no upcoming trips.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {upcoming.map((b) => (
                  <li
                    key={b.cartId}
                    className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm shadow-sm dark:border-emerald-900/50 dark:bg-emerald-950/40"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-gray-900 dark:text-gray-50 truncate">
                        {b.origin && b.destination ? `${b.origin} → ${b.destination}` : 'Bus trip'}
                      </div>
                      <div className="text-[11px] text-gray-600 dark:text-gray-300">
                        {timestampToLocaleDateTime(b.departAt || b.createdAt)}
                      </div>
                      {b.pnr && (
                        <div className="text-[11px] text-gray-600 dark:text-gray-300">
                          PNR: <span className="font-mono break-all">{b.pnr}</span>
                        </div>
                      )}
                      {b.status && (
                        <div className="text-[11px] text-gray-600 dark:text-gray-300">Status: {b.status}</div>
                      )}
                    </div>
                    {onViewTickets && (
                      <button
                        type="button"
                        onClick={() => onViewTickets(b.cartId)}
                        className="ml-3 inline-flex items-center rounded-md bg-[#652D8E] px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm hover:opacity-90 dark:bg-purple-600"
                      >
                        View tickets
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-50">Past bookings</h2>
            {past.length === 0 ? (
              <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">You have no past trips yet.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {past.map((b) => (
                  <li
                    key={b.cartId}
                    className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm shadow-sm dark:border-gray-700 dark:bg-gray-900/60"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-gray-900 dark:text-gray-50 truncate">
                        {b.origin && b.destination ? `${b.origin} → ${b.destination}` : 'Bus trip'}
                      </div>
                      <div className="text-[11px] text-gray-600 dark:text-gray-300">
                        {timestampToLocaleDateTime(b.departAt || b.createdAt)}
                      </div>
                      {b.pnr && (
                        <div className="text-[11px] text-gray-600 dark:text-gray-300">
                          PNR: <span className="font-mono break-all">{b.pnr}</span>
                        </div>
                      )}
                      {b.status && (
                        <div className="text-[11px] text-gray-600 dark:text-gray-300">Status: {b.status}</div>
                      )}
                    </div>
                    {onViewTickets && (
                      <button
                        type="button"
                        onClick={() => onViewTickets(b.cartId)}
                        className="ml-3 inline-flex items-center rounded-md border border-gray-300 px-3 py-1.5 text-[11px] font-semibold text-gray-800 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
                      >
                        View tickets
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
};

export default MyBookings;
