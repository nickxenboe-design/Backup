import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BusRoute, SearchQuery } from '@/utils/api';
import TripSummary from './TripSummary';
import { CheckCircleIcon, ArrowRightIcon, ChevronLeftIcon, LockClosedIcon, MinusIcon, PlusIcon, PriceTagIcon, UsersIcon } from './icons';

interface ConfirmationModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (opts?: { eaglelinerPassengerCounts?: Record<string, number>; estimatedTotal?: number }) => void;
    booking: { outbound: BusRoute; inbound: BusRoute | null };
    query: SearchQuery;
    maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';
    onChangeRequested?: (section: 'route' | 'date' | 'passengers') => void;
}

type EaglelinerModalStep = 'fare' | 'confirm';

const ConfirmationModal: React.FC<ConfirmationModalProps> = ({ isOpen, onClose, onConfirm, booking, query, maxWidth, onChangeRequested }) => {
    const modalRef = useRef<HTMLDivElement>(null);

    const isEagleliner = (() => {
        const outbound: any = (booking as any)?.outbound;
        const provider = String(outbound?.provider || '').toLowerCase();
        const id = String(outbound?.id || '');
        if (provider === 'eagleliner') return true;
        if (id.startsWith('eagleliner:')) return true;
        const raw = outbound?.raw || outbound?._eagleliner;
        if (raw && Array.isArray(raw?.FairPrice) && raw.FairPrice.length > 0) return true;
        return false;
    })();

    const fairPriceList = useMemo(() => {
        const outbound: any = (booking as any)?.outbound;
        const raw = outbound?._eagleliner?.FairPrice || outbound?.raw?.FairPrice || outbound?.raw?.fairPrice;
        return Array.isArray(raw) ? raw : [];
    }, [booking]);

    const requiresFareSelection = isEagleliner && Array.isArray(fairPriceList) && fairPriceList.length > 0;

    const [eaglelinerStep, setEaglelinerStep] = useState<EaglelinerModalStep>(() => {
        return requiresFareSelection ? 'fare' : 'confirm';
    });

    const buildDefaultEaglelinerCounts = () => {
        const next: Record<string, number> = {};
        if (!Array.isArray(fairPriceList) || fairPriceList.length === 0) return next;

        const byType: any = {};
        for (const item of fairPriceList) {
            const key = classifyFareName(String(item?.name || ''));
            if (!byType[key]) byType[key] = item;
        }

        const children = Math.max(0, Number(query?.passengers?.children || 0));
        const seniors = Math.max(0, Number((query?.passengers as any)?.seniors || 0));
        const students = Math.max(0, Number((query?.passengers as any)?.students || 0));
        const adults = Math.max(0, Number(query?.passengers?.adults || 0));

        const total = Math.max(1, adults + children + seniors + students);
        const fallbackAdult = byType.adult || fairPriceList[0];

        if (children > 0 && byType.child) next[String(byType.child.id)] = children;
        if (seniors > 0 && byType.senior) next[String(byType.senior.id)] = seniors;
        if (students > 0 && byType.student) next[String(byType.student.id)] = students;

        const used = (children > 0 ? children : 0) + (seniors > 0 ? seniors : 0) + (students > 0 ? students : 0);
        const remaining = Math.max(0, total - used);
        if (remaining > 0 && fallbackAdult) next[String(fallbackAdult.id)] = remaining;
        return next;
    };

    const classifyFareName = (value: string) => {
        const v = String(value || '').toLowerCase();
        if (v.includes('child')) return 'child';
        if (v.includes('student')) return 'student';
        if (v.includes('pension') || v.includes('senior')) return 'senior';
        if (v.includes('adult')) return 'adult';
        return 'adult';
    };

    const defaultTotalPassengers = useMemo(() => {
        return Math.max(
            1,
            Number(query?.passengers?.adults || 0) +
                Number(query?.passengers?.children || 0) +
                Number((query?.passengers as any)?.seniors || 0) +
                Number((query?.passengers as any)?.students || 0)
        );
    }, [query]);

    const [eaglelinerCounts, setEaglelinerCounts] = useState<Record<string, number>>(() => {
        const existing = query?.eaglelinerPassengerCounts && typeof query.eaglelinerPassengerCounts === 'object'
            ? query.eaglelinerPassengerCounts
            : null;
        const next: Record<string, number> = {};

        if (existing) {
            for (const [k, v] of Object.entries(existing)) {
                const n = Number(v);
                if (Number.isFinite(n) && n > 0) next[String(k)] = Math.floor(n);
            }
            return next;
        }

        if (!Array.isArray(fairPriceList) || fairPriceList.length === 0) {
            return next;
        }

        const byType: any = {};
        for (const item of fairPriceList) {
            const key = classifyFareName(String(item?.name || ''));
            if (!byType[key]) byType[key] = item;
        }

        const children = Math.max(0, Number(query?.passengers?.children || 0));
        const seniors = Math.max(0, Number((query?.passengers as any)?.seniors || 0));
        const students = Math.max(0, Number((query?.passengers as any)?.students || 0));
        const adults = Math.max(0, Number(query?.passengers?.adults || 0));

        const total = Math.max(1, adults + children + seniors + students);
        const fallbackAdult = byType.adult || fairPriceList[0];

        if (children > 0 && byType.child) next[String(byType.child.id)] = children;
        if (seniors > 0 && byType.senior) next[String(byType.senior.id)] = seniors;
        if (students > 0 && byType.student) next[String(byType.student.id)] = students;

        const used = (children > 0 ? children : 0) + (seniors > 0 ? seniors : 0) + (students > 0 ? students : 0);
        const remaining = Math.max(0, total - used);
        if (remaining > 0 && fallbackAdult) next[String(fallbackAdult.id)] = remaining;
        return next;
    });

    useEffect(() => {
        if (!isOpen) return;
        setEaglelinerStep(requiresFareSelection ? 'fare' : 'confirm');
    }, [isOpen, requiresFareSelection, (booking as any)?.outbound?.id]);

    useEffect(() => {
        if (!isOpen) return;
        if (!requiresFareSelection) return;
        const currentTotal = Object.values(eaglelinerCounts || {}).reduce((acc, v) => acc + (Number(v) > 0 ? Number(v) : 0), 0);
        if (currentTotal > 0) return;
        const defaults = buildDefaultEaglelinerCounts();
        const defaultsTotal = Object.values(defaults).reduce((acc, v) => acc + (Number(v) > 0 ? Number(v) : 0), 0);
        if (defaultsTotal > 0) setEaglelinerCounts(defaults);
    }, [isOpen, requiresFareSelection, booking?.outbound?.id, query?.passengers?.adults, query?.passengers?.children, (query?.passengers as any)?.seniors, (query?.passengers as any)?.students]);

    useEffect(() => {
        if (!isOpen) return;
        if (!isEagleliner) return;

        const existing = query?.eaglelinerPassengerCounts && typeof query.eaglelinerPassengerCounts === 'object'
            ? query.eaglelinerPassengerCounts
            : null;
        if (existing && Object.keys(existing).length > 0) {
            const next: Record<string, number> = {};
            for (const [k, v] of Object.entries(existing)) {
                const n = Number(v);
                if (Number.isFinite(n) && n > 0) next[String(k)] = Math.floor(n);
            }
            setEaglelinerCounts(next);
        }
    }, [isOpen, isEagleliner, query?.eaglelinerPassengerCounts]);

    const eaglelinerTotalPassengers = useMemo(() => {
        if (!requiresFareSelection) return defaultTotalPassengers;
        const sum = Object.values(eaglelinerCounts || {}).reduce((acc, v) => acc + (Number(v) > 0 ? Number(v) : 0), 0);
        return Math.max(0, sum);
    }, [defaultTotalPassengers, eaglelinerCounts, requiresFareSelection]);

    const eaglelinerTotalPrice = useMemo(() => {
        if (!isEagleliner) return null;
        if (!Array.isArray(fairPriceList) || fairPriceList.length === 0) return null;
        let total = 0;
        for (const item of fairPriceList) {
            const key = String(item?.id);
            const count = Number((eaglelinerCounts || {})[key] || 0);
            const unit = Number(item?.price);
            if (!Number.isFinite(count) || count <= 0) continue;
            if (!Number.isFinite(unit) || unit < 0) continue;
            total += unit * count;
        }
        return Number.isFinite(total) ? total : null;
    }, [eaglelinerCounts, fairPriceList, isEagleliner]);
    const leaveMessage = isEagleliner
        ? 'Are you sure? If you leave this screen, your trip selection may be cleared.'
        : 'Are you sure? If you leave this screen, your reservation may be released.';

    const handleCloseRequested = () => {
        try {
            if (typeof window !== 'undefined') {
                const ok = window.confirm(leaveMessage);
                if (!ok) return;
            }
        } catch {}
        onClose();
    };

    useEffect(() => {
        if (!isOpen) return;

        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            e.preventDefault();
            e.returnValue = leaveMessage;
            return leaveMessage;
        };

        const handlePopState = () => {
            try {
                if (typeof window !== 'undefined') {
                    const ok = window.confirm(leaveMessage);
                    if (!ok) {
                        try {
                            window.history.pushState({ __confirmModal: true }, '');
                        } catch {}
                        return;
                    }
                }
            } catch {
                try {
                    window.history.pushState({ __confirmModal: true }, '');
                } catch {}
                return;
            }
            onClose();
        };

        if (typeof window !== 'undefined') {
            try {
                window.history.pushState({ __confirmModal: true }, '');
            } catch {}
            window.addEventListener('beforeunload', handleBeforeUnload);
            window.addEventListener('popstate', handlePopState);
            return () => {
                window.removeEventListener('beforeunload', handleBeforeUnload);
                window.removeEventListener('popstate', handlePopState);
            };
        }
        return;
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    const showFareStep = requiresFareSelection && eaglelinerStep === 'fare';
    const showConfirmStep = !requiresFareSelection || eaglelinerStep === 'confirm';

    const sizeClass = ({
        sm: 'max-w-sm',
        md: 'max-w-md',
        lg: 'max-w-lg',
        xl: 'max-w-xl',
        '2xl': 'max-w-2xl',
        '3xl': 'max-w-3xl',
    } as const)[maxWidth || 'lg'];

    return (
        <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-2 sm:p-3"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirmation-modal-title"
        >
            <div
                ref={modalRef}
                className={`relative bg-white dark:bg-gray-800 rounded-lg sm:rounded-xl shadow-xl w-full ${sizeClass} max-h-[90vh] overflow-y-auto animate-fade-in-down border border-gray-200 dark:border-gray-700`}
            >
                <div className="p-2.5">
                    <div className="flex items-center">
                        <CheckCircleIcon className="h-4 w-4 text-green-500" />
                        <h2 id="confirmation-modal-title" className="ml-2 text-sm font-bold text-[#652D8E] dark:text-purple-300">
                            {showFareStep ? 'Select Fare Types' : 'Confirm Your Trip'}
                        </h2>
                    </div>

                    <div className="mt-1 flex items-center gap-2 text-[11px] text-gray-700 dark:text-gray-200">
                        <span className="inline-flex items-center gap-1 rounded-full bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-200 px-2 py-0.5 font-semibold">
                            <CheckCircleIcon className="h-3.5 w-3.5" />
                            We’ll hold your selected trip for the next 10 minutes
                        </span>
                    </div>

                    <div className="mt-2 text-[10px] font-semibold text-gray-500 dark:text-gray-400">
                        <span className="text-gray-400 dark:text-gray-500">Search</span>
                        <span className="mx-1">→</span>
                        <span className="text-gray-400 dark:text-gray-500">Select</span>
                        {requiresFareSelection ? (
                            <>
                                <span className="mx-1">→</span>
                                <span className={showFareStep ? 'text-[#652D8E] dark:text-purple-300' : 'text-gray-400 dark:text-gray-500'}>Fare types</span>
                                <span className="mx-1">→</span>
                                <span className={showConfirmStep ? 'text-[#652D8E] dark:text-purple-300' : 'text-gray-400 dark:text-gray-500'}>Confirm</span>
                            </>
                        ) : (
                            <>
                                <span className="mx-1">→</span>
                                <span className="text-[#652D8E] dark:text-purple-300">Confirm</span>
                            </>
                        )}
                        <span className="mx-1">→</span>
                        <span className="text-gray-400 dark:text-gray-500">Passenger Info</span>
                        <span className="mx-1">→</span>
                        <span className="text-gray-400 dark:text-gray-500">Payment</span>
                    </div>
                </div>

                <div className="bg-gray-50 dark:bg-gray-800/50 px-3 py-2.5 border-y border-gray-200 dark:border-gray-700 text-xs">
                    <TripSummary
                        booking={booking}
                        query={isEagleliner ? { ...query, eaglelinerPassengerCounts: eaglelinerCounts } : query}
                        compact
                        onChangeRequested={onChangeRequested}
                    />
                </div>

                {showFareStep ? (
                    <div className="px-3 py-2.5 text-xs">
                        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3">
                            <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2">
                                    <PriceTagIcon className="h-4 w-4 text-[#652D8E] dark:text-purple-300" />
                                    <div className="text-xs font-bold text-[#652D8E] dark:text-purple-300">Fare types</div>
                                </div>
                                <div className="flex items-center gap-2 text-[11px] font-semibold text-gray-600 dark:text-gray-300">
                                    <UsersIcon className="h-4 w-4" />
                                    {eaglelinerTotalPassengers} passenger(s)
                                </div>
                            </div>

                            <div className="mt-2 space-y-2">
                                {fairPriceList.map((p: any) => {
                                    const id = String(p?.id);
                                    const label = String(p?.name || 'Passenger');
                                    const unit = Number(p?.price);
                                    const count = Number((eaglelinerCounts || {})[id] || 0);
                                    const lineTotal = Number.isFinite(unit) && Number.isFinite(count) ? unit * Math.max(0, count) : 0;
                                    return (
                                        <div key={id} className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 dark:border-gray-700 px-2.5 py-2">
                                            <div className="min-w-0">
                                                <div className="text-[11px] font-bold text-gray-800 dark:text-gray-200 truncate">{label}</div>
                                                <div className="text-[10px] text-gray-500 dark:text-gray-400">
                                                    {Number.isFinite(unit) ? `${unit.toFixed(2)}` : '—'}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setEaglelinerCounts((prev) => {
                                                            const next = { ...(prev || {}) };
                                                            const cur = Number(next[id] || 0);
                                                            const updated = Math.max(0, cur - 1);
                                                            if (!updated) delete next[id];
                                                            else next[id] = updated;
                                                            return next;
                                                        });
                                                    }}
                                                    className="h-7 w-7 inline-flex items-center justify-center rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                                                    aria-label={`Decrease ${label}`}
                                                >
                                                    <MinusIcon className="h-4 w-4" />
                                                </button>
                                                <span className="w-6 text-center text-[11px] font-bold text-[#652D8E] dark:text-purple-300">{Math.max(0, count) || 0}</span>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setEaglelinerCounts((prev) => {
                                                            const next = { ...(prev || {}) };
                                                            const cur = Number(next[id] || 0);
                                                            next[id] = Math.max(0, cur + 1);
                                                            return next;
                                                        });
                                                    }}
                                                    className="h-7 w-7 inline-flex items-center justify-center rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                                                    aria-label={`Increase ${label}`}
                                                >
                                                    <PlusIcon className="h-4 w-4" />
                                                </button>
                                                <div className="w-20 text-right text-[11px] font-bold text-gray-900 dark:text-white">
                                                    {Number.isFinite(lineTotal) ? lineTotal.toFixed(2) : '—'}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            <div className="mt-2 flex items-center justify-between">
                                <div className="text-[11px] text-gray-600 dark:text-gray-300">Total</div>
                                <div className="text-sm font-extrabold text-[#652D8E] dark:text-purple-300">
                                    {eaglelinerTotalPrice != null ? eaglelinerTotalPrice.toFixed(2) : '—'}
                                </div>
                            </div>
                        </div>
                    </div>
                ) : null}

                {showConfirmStep && requiresFareSelection ? (
                    <div className="px-3 py-2.5 text-xs">
                        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3">
                            <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2">
                                    <PriceTagIcon className="h-4 w-4 text-[#652D8E] dark:text-purple-300" />
                                    <div className="text-xs font-bold text-[#652D8E] dark:text-purple-300">Selected fare types</div>
                                </div>
                                <div className="flex items-center gap-2 text-[11px] font-semibold text-gray-600 dark:text-gray-300">
                                    <UsersIcon className="h-4 w-4" />
                                    {eaglelinerTotalPassengers} passenger(s)
                                </div>
                            </div>

                            <div className="mt-2 space-y-1">
                                {fairPriceList
                                    .map((p: any) => {
                                        const id = String(p?.id);
                                        const label = String(p?.name || 'Passenger');
                                        const unit = Number(p?.price);
                                        const count = Number((eaglelinerCounts || {})[id] || 0);
                                        if (!Number.isFinite(count) || count <= 0) return null;
                                        const lineTotal = Number.isFinite(unit) ? unit * count : 0;
                                        return (
                                            <div key={id} className="flex items-center justify-between gap-3 text-[11px]">
                                                <div className="text-gray-700 dark:text-gray-200 truncate">{label} ({count}x)</div>
                                                <div className="text-gray-500 dark:text-gray-400">{Number.isFinite(lineTotal) ? lineTotal.toFixed(2) : '—'}</div>
                                            </div>
                                        );
                                    })
                                    .filter(Boolean)}
                            </div>

                            <div className="mt-2 flex items-center justify-between">
                                <div className="text-[11px] text-gray-600 dark:text-gray-300">Total</div>
                                <div className="text-sm font-extrabold text-[#652D8E] dark:text-purple-300">
                                    {eaglelinerTotalPrice != null ? eaglelinerTotalPrice.toFixed(2) : '—'}
                                </div>
                            </div>
                        </div>
                    </div>
                ) : null}

                <div className="sticky bottom-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 p-2.5">
                    <div className="flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2.5 gap-2">
                        <button
                            type="button"
                            onClick={() => {
                                if (requiresFareSelection && eaglelinerStep === 'confirm') {
                                    setEaglelinerStep('fare');
                                    return;
                                }
                                if (onChangeRequested) {
                                    onChangeRequested('route');
                                    return;
                                }
                                handleCloseRequested();
                            }}
                            className="w-full sm:w-auto text-[#652D8E] border border-[#652D8E] font-semibold py-2 px-3 rounded-md text-xs hover:bg-[#652D8E]/10 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-[#652D8E] dark:text-purple-300 dark:border-purple-300 dark:hover:bg-purple-300/10 dark:focus:ring-offset-gray-800 inline-flex items-center justify-center gap-1.5"
                        >
                            <ChevronLeftIcon className="h-4 w-4" />
                            <span>{requiresFareSelection && eaglelinerStep === 'confirm' ? 'Back to fare types' : 'Change trip details'}</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                if (showFareStep) {
                                    setEaglelinerStep('confirm');
                                    return;
                                }

                                if (!requiresFareSelection) {
                                    onConfirm();
                                    return;
                                }

                                const cleaned: Record<string, number> = {};
                                for (const [k, v] of Object.entries(eaglelinerCounts || {})) {
                                    const n = Number(v);
                                    if (Number.isFinite(n) && n > 0) cleaned[String(k)] = Math.floor(n);
                                }

                                const total = Object.values(cleaned).reduce((acc, v) => acc + (Number(v) > 0 ? Number(v) : 0), 0);
                                if (total <= 0) {
                                    return;
                                }

                                onConfirm({
                                    eaglelinerPassengerCounts: cleaned,
                                    estimatedTotal: eaglelinerTotalPrice != null ? eaglelinerTotalPrice : undefined,
                                });
                            }}
                            className="btn-primary w-full sm:w-auto flex items-center justify-center gap-1.5 py-2 px-3 text-xs shadow-md"
                            disabled={showFareStep ? (requiresFareSelection && eaglelinerTotalPassengers <= 0) : false}
                        >
                            <span>{showFareStep ? 'Continue to Confirm' : 'Continue to Passenger Info'}</span>
                            <ArrowRightIcon className="h-4 w-4" />
                        </button>
                    </div>

                    <div className="mt-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5">
                        <div className="text-[10px] text-gray-600 dark:text-gray-300">
                            You’ll enter passenger details next. Payment comes after.
                        </div>
                        <div className="inline-flex items-center gap-1 text-[10px] font-semibold text-gray-500 dark:text-gray-400">
                            <LockClosedIcon className="h-3.5 w-3.5" />
                            Secure checkout
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ConfirmationModal;