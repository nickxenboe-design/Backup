import React, { useMemo } from 'react';
import type { BusRoute } from '@/utils/api';

function normalizeSeatId(value: unknown): string {
  return String(value ?? '').trim();
}

function uniqNonEmpty(values: unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values || []) {
    const s = normalizeSeatId(v);
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function tryParseSeatNumber(id: string): number | null {
  const trimmed = id.trim();
  if (!trimmed) return null;
  if (!/^[0-9]+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

type SeatStatus = 'occupied' | 'reserved' | 'available' | 'unknown';

type SeatItem = {
  id: string;
  status: SeatStatus;
};

type SeatMapProps = {
  route: BusRoute;
  departDate?: string;
  selectable?: boolean;
  selectedSeatIds?: string[];
  maxSelectable?: number;
  onSelectedSeatIdsChange?: (ids: string[]) => void;
};

const SeatMap: React.FC<SeatMapProps> = ({
  route,
  departDate,
  selectable = false,
  selectedSeatIds = [],
  maxSelectable,
  onSelectedSeatIdsChange,
}) => {
  const raw: any = (route as any)?.raw || (route as any)?._eagleliner || (route as any)?._raw || null;

  const normalizedDepartDate = useMemo(() => {
    const rawDate = String(departDate || '').trim();
    if (!rawDate) return '';
    return rawDate.includes('T') ? rawDate.slice(0, 10) : rawDate;
  }, [departDate]);

  const reserved = useMemo(() => uniqNonEmpty((raw?.reserved_seats as any[]) || []), [raw]);
  const occupied = useMemo(() => uniqNonEmpty((raw?.occupied_seats as any[]) || []), [raw]);
  const available = useMemo(() => uniqNonEmpty((raw?.available_seats as any[]) || []), [raw]);

  const reservedNo = raw?.reserved_seats_no ?? (route as any)?.reservedSeats ?? null;
  const occupiedNo = raw?.occupied_seats_no ?? (route as any)?.occupiedSeats ?? null;
  const availableNo = raw?.available_seats_no ?? (route as any)?.availableSeats ?? null;

  const allSeatIds = useMemo(() => {
    return uniqNonEmpty([...reserved, ...occupied, ...available]);
  }, [reserved, occupied, available]);

  const hasExplicitSeatLists = allSeatIds.length > 0;

  const numericSeatMode = useMemo(() => {
    if (allSeatIds.length === 0) return false;
    return allSeatIds.every((id) => tryParseSeatNumber(id) != null);
  }, [allSeatIds]);

  const seatItems = useMemo<SeatItem[]>(() => {
    if (hasExplicitSeatLists) {
      if (!numericSeatMode) {
        const ids = [...allSeatIds].sort((a, b) => a.localeCompare(b));
        return ids.map((id) => ({
          id,
          status: (occupied.includes(id)
            ? 'occupied'
            : reserved.includes(id)
              ? 'reserved'
              : 'available') as SeatStatus,
        }));
      }

      const nums = allSeatIds
        .map((id) => tryParseSeatNumber(id) || 0)
        .filter((n) => n > 0);

      const derivedMax = nums.length > 0 ? Math.max(...nums) : 0;
      const maxSeats = Number(raw?.Bus?.max_seats || 0);
      const countFromTotals =
        (Number(reservedNo || 0) || 0) + (Number(occupiedNo || 0) || 0) + (Number(availableNo || 0) || 0);

      const seatCount =
        (Number.isFinite(maxSeats) && maxSeats > 0 ? maxSeats : 0) || derivedMax || countFromTotals;

      if (!seatCount || seatCount <= 0) return [];

      return Array.from({ length: seatCount }, (_, i) => {
        const id = String(i + 1);
        const status: SeatStatus = occupied.includes(id)
          ? 'occupied'
          : reserved.includes(id)
            ? 'reserved'
            : 'available';
        return { id, status };
      });
    }

    const maxSeats = Number(raw?.Bus?.max_seats || 0);
    const occ = Number(occupiedNo || 0) || 0;
    const res = Number(reservedNo || 0) || 0;
    const avail = Number(availableNo || 0) || 0;
    const totalFromTotals = occ + res + avail;
    const seatCount = (Number.isFinite(maxSeats) && maxSeats > 0 ? maxSeats : 0) || totalFromTotals;
    if (!seatCount || seatCount <= 0) return [];

    return Array.from({ length: seatCount }, (_, i) => {
      const idx = i + 1;
      let status: SeatStatus = 'unknown';
      if (idx <= occ) status = 'occupied';
      else if (idx <= occ + res) status = 'reserved';
      else if (idx <= occ + res + avail) status = 'available';
      return { id: String(idx), status };
    });
  }, [hasExplicitSeatLists, numericSeatMode, allSeatIds, occupied, reserved, available, raw, reservedNo, occupiedNo, availableNo]);

  const seatColumns = useMemo(() => {
    const items = Array.isArray(seatItems) ? seatItems : [];
    const cols: Array<Array<SeatItem | null>> = [];
    const padCount = (5 - (items.length % 5)) % 5;
    const padded: Array<SeatItem | null> = (() => {
      if (!padCount) return items;
      if (padCount === 1 && items.length) {
        return [items[0], null, ...items.slice(1)];
      }
      return [...Array.from({ length: padCount }, () => null), ...items];
    })();
    for (let i = 0; i < padded.length; i += 5) {
      const chunk = padded.slice(i, i + 5);
      cols.push(chunk);
    }
    return cols;
  }, [seatItems]);

  const canSelect = selectable && typeof onSelectedSeatIdsChange === 'function';

  const selectedSet = useMemo(() => {
    return new Set(selectedSeatIds.map((x) => normalizeSeatId(x)).filter(Boolean));
  }, [selectedSeatIds]);

  const toggleSeat = (id: string, status: SeatStatus) => {
    if (!canSelect) return;
    if (status !== 'available') return;

    const normalized = normalizeSeatId(id);
    if (!normalized) return;

    const isSelected = selectedSet.has(normalized);
    if (isSelected) {
      onSelectedSeatIdsChange!(selectedSeatIds.filter((x) => normalizeSeatId(x) !== normalized));
      return;
    }

    const next = [...selectedSeatIds, normalized];
    if (maxSelectable != null && Number.isFinite(maxSelectable) && maxSelectable > 0 && next.length > maxSelectable) {
      return;
    }

    onSelectedSeatIdsChange!(next);
  };

  const seatVisual = (status: SeatStatus, isSelected: boolean) => {
    if (isSelected) {
      return {
        bg: 'bg-green-500',
        border: 'border-green-700',
        text: 'text-white',
      };
    }
    if (status === 'occupied') {
      return {
        bg: 'bg-red-600',
        border: 'border-red-800',
        text: 'text-white',
      };
    }
    if (status === 'reserved') {
      return {
        bg: 'bg-blue-600',
        border: 'border-blue-800',
        text: 'text-white',
      };
    }
    return {
      bg: 'bg-white dark:bg-transparent',
      border: 'border-gray-400 dark:border-gray-500',
      text: 'text-gray-700 dark:text-gray-200',
    };
  };

  const LegendItem = ({ label, className }: { label: string; className: string }) => {
    return (
      <div className="flex items-center gap-2">
        <span className={`inline-block h-3.5 w-6 border ${className}`} />
        <span className="text-[11px] font-semibold text-gray-700 dark:text-gray-200">{label}</span>
      </div>
    );
  };

  const BusFrontDrawing = () => {
    return (
      <svg
        viewBox="0 0 160 220"
        className="h-[170px] w-[150px] text-gray-400 dark:text-gray-300"
        aria-hidden="true"
      >
        <path
          d="M22 18 C10 24 8 40 8 56 L8 164 C8 190 26 206 50 206 L132 206 C148 206 152 196 152 180 L152 44 C152 26 138 14 120 14 L52 14 C38 14 30 14 22 18 Z"
          fill="currentColor"
          fillOpacity="0.18"
          stroke="currentColor"
          strokeWidth="3"
        />

        <path
          d="M28 26 C18 34 16 48 16 60"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
        />

        <path
          d="M48 36 H132"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />

        <path
          d="M18 64 H64 V126 H18 Z"
          fill="currentColor"
          fillOpacity="0.14"
          stroke="currentColor"
          strokeWidth="3"
        />

        <path
          d="M26 76 H56"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          opacity="0.7"
        />
        <path
          d="M26 88 H56"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          opacity="0.7"
        />
        <path
          d="M26 100 H56"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          opacity="0.7"
        />
        <path
          d="M26 112 H56"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          opacity="0.7"
        />

        <path
          d="M64 60 L64 168"
          stroke="currentColor"
          strokeWidth="3"
          opacity="0.65"
        />

        <path
          d="M28 34 H64 V52 H28 Z"
          fill="currentColor"
          fillOpacity="0.10"
          stroke="currentColor"
          strokeWidth="3"
        />

        <path
          d="M34 140 C34 132 40 126 48 126 H58 C66 126 72 132 72 140 V166 C72 174 66 180 58 180 H48 C40 180 34 174 34 166 Z"
          fill="currentColor"
          fillOpacity="0.10"
          stroke="currentColor"
          strokeWidth="3"
        />

        <path
          d="M22 150 C22 143 28 138 35 138"
          stroke="currentColor"
          strokeWidth="3"
          opacity="0.75"
        />

        <circle cx="56" cy="206" r="9" fill="currentColor" fillOpacity="0.35" />
        <circle cx="128" cy="206" r="9" fill="currentColor" fillOpacity="0.35" />
        <circle cx="56" cy="206" r="4" fill="currentColor" fillOpacity="0.12" />
        <circle cx="128" cy="206" r="4" fill="currentColor" fillOpacity="0.12" />
      </svg>
    );
  };

  return (
    <div className="rounded-2xl border border-gray-200/80 dark:border-gray-800 bg-white/80 dark:bg-gray-900/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-4">
          <LegendItem label="Available" className="bg-white dark:bg-transparent border-gray-400" />
          <LegendItem label="Occupied" className="bg-red-600 border-red-800" />
          <LegendItem label="Reserved" className="bg-blue-600 border-blue-800" />
          <LegendItem label="Selected" className="bg-green-500 border-green-700" />
        </div>
        <div className="text-[12px] font-bold text-gray-800 dark:text-gray-100">
          Leg1 {normalizedDepartDate ? `(depart: ${normalizedDepartDate})` : ''}
        </div>
      </div>

      {seatItems.length > 0 ? (
        <div className="mt-4 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-100/60 dark:bg-gray-950/20 p-2">
          <div className="flex items-start gap-3 overflow-x-auto">
            <div className="flex-shrink-0">
              <BusFrontDrawing />
            </div>
            <div className="min-w-[420px] py-2">
              <div className="flex gap-2">
                {seatColumns.map((col, colIdx) => (
                  <div key={colIdx} className="flex flex-col items-center">
                    <div className="flex flex-col items-center gap-1">
                      {[2, 3, 4].map((rowIndex) => {
                        const item = col[rowIndex];
                        if (!item) return <div key={rowIndex} className="h-7 w-9" />;
                        const normalized = normalizeSeatId(item.id);
                        const isSelected = normalized ? selectedSet.has(normalized) : false;
                        const visual = seatVisual(item.status, isSelected);
                        const isInteractive = canSelect && item.status === 'available' && !isSelected;
                        return (
                          <button
                            key={rowIndex}
                            type="button"
                            onClick={() => toggleSeat(item.id, item.status)}
                            disabled={!isInteractive && !isSelected}
                            className={`relative h-7 w-9 rounded-sm border ${visual.border} ${visual.bg} ${visual.text} shadow-sm ${
                              isInteractive || isSelected ? 'cursor-pointer hover:opacity-90' : 'cursor-not-allowed opacity-80'
                            }`}
                            title={item.id}
                          >
                            <span className="absolute right-0 top-0 bottom-0 w-[5px] border-l border-black/20" />
                            <span className="absolute left-0 right-0 top-0 h-[5px] border-b border-black/15" />
                            <span className="relative z-10 text-[10px] font-extrabold leading-none">{item.id}</span>
                          </button>
                        );
                      })}
                    </div>

                    <div className="h-4 w-10" />

                    <div className="flex flex-col items-center gap-1">
                      {(() => {
                        const hasTop = Boolean(col[0]);
                        const hasBottom = Boolean(col[1]);
                        const keepStandaloneTop = hasTop && !hasBottom;
                        const order = keepStandaloneTop ? [0, 1] : [1, 0];
                        return order;
                      })().map((rowIndex) => {
                        const item = col[rowIndex];
                        if (!item) return <div key={rowIndex} className="h-7 w-9" />;
                        const normalized = normalizeSeatId(item.id);
                        const isSelected = normalized ? selectedSet.has(normalized) : false;
                        const visual = seatVisual(item.status, isSelected);
                        const isInteractive = canSelect && item.status === 'available' && !isSelected;
                        return (
                          <button
                            key={rowIndex}
                            type="button"
                            onClick={() => toggleSeat(item.id, item.status)}
                            disabled={!isInteractive && !isSelected}
                            className={`relative h-7 w-9 rounded-sm border ${visual.border} ${visual.bg} ${visual.text} shadow-sm ${
                              isInteractive || isSelected ? 'cursor-pointer hover:opacity-90' : 'cursor-not-allowed opacity-80'
                            }`}
                            title={item.id}
                          >
                            <span className="absolute right-0 top-0 bottom-0 w-[5px] border-l border-black/20" />
                            <span className="absolute left-0 right-0 top-0 h-[5px] border-b border-black/15" />
                            <span className="relative z-10 text-[10px] font-extrabold leading-none">{item.id}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              {canSelect ? (
                <div className="mt-3 text-[11px] font-semibold text-gray-600 dark:text-gray-300">
                  Selected: <span className="font-extrabold text-[#652D8E] dark:text-purple-200">{selectedSeatIds.length}</span>
                  {maxSelectable != null ? ` / ${maxSelectable}` : ''}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-3 text-[11px] font-semibold text-gray-500 dark:text-gray-400">
          Seat layout not available for this trip.
        </div>
      )}
    </div>
  );
};

export default SeatMap;
