import React, { useState, useEffect } from 'react';
import jsPDF from 'jspdf';
import { BusRoute, SearchQuery, timestampToISO } from '@/utils/api';
import { computePassengerFareBreakdown } from '@/utils/fareUtils';
import { CalendarIcon, ClockIcon, UsersIcon, PriceTagIcon, ShareIcon, CheckCircleIcon, LockClosedIcon } from './icons';

interface TripSummaryProps {
    booking: { outbound: BusRoute; inbound: BusRoute | null };
    query: SearchQuery;
    compact?: boolean;
    onChangeRequested?: (section: 'route' | 'date' | 'passengers') => void;
}

const formatDateForDisplay = (dateString: string): string => {
    const iso = timestampToISO(dateString + 'T00:00:00');
    if (!iso) return 'Invalid Date';

    try {
        const date = new Date(iso);
        return date.toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric'
        });
    } catch (e) {
        console.error('Error formatting date:', e);
        return 'Invalid Date';
    }
};

const toDateStringYmd = (d: Date): string => {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
};

const addDaysToDateString = (dateString: string, days: number): string => {
    try {
        const d = new Date(dateString + 'T00:00:00');
        if (Number.isNaN(d.getTime())) return dateString;
        d.setDate(d.getDate() + days);
        return toDateStringYmd(d);
    } catch {
        return dateString;
    }
};

const formatShortDate = (dateString: string): string => {
    try {
        const d = new Date(dateString + 'T00:00:00');
        if (Number.isNaN(d.getTime())) return dateString;
        return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    } catch {
        return dateString;
    }
};

const parseClockMinutes = (value: string | undefined): number | null => {
    if (!value) return null;
    const m = String(value).trim().match(/^(\d{1,2}):(\d{2})/);
    if (!m) return null;
    const hh = Number(m[1]);
    const mm = Number(m[2]);
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
    return hh * 60 + mm;
};

const parseDurationMinutes = (duration: string | undefined): number | null => {
    if (!duration) return null;
    const s = String(duration);
    const hoursMatch = s.match(/(\d+)h/);
    const minutesMatch = s.match(/(\d+)m/);
    const hours = hoursMatch ? parseInt(hoursMatch[1], 10) : 0;
    const minutes = minutesMatch ? parseInt(minutesMatch[1], 10) : 0;
    const total = hours * 60 + minutes;
    return total > 0 ? total : null;
};

const addMinutesToDate = (baseDateString: string, minutesFromMidnight: number): Date | null => {
    try {
        const base = new Date(baseDateString + 'T00:00:00');
        if (Number.isNaN(base.getTime())) return null;
        return new Date(base.getTime() + minutesFromMidnight * 60 * 1000);
    } catch {
        return null;
    }
};

const formatDateTimeLabel = (dateString: string, timeString: string): string => {
    const datePart = formatShortDate(dateString);
    const timePart = timeString && timeString !== 'N/A' ? timeString : 'N/A';
    return `${datePart} • ${timePart}`;
};

const splitStopParts = (value: string) => {
    const v = String(value || '').trim();
    if (!v) return { primary: 'Unknown', secondary: '' };

    const commaParts = v.split(',').map((p) => p.trim()).filter(Boolean);
    if (commaParts.length >= 2) {
        return { primary: commaParts[0], secondary: commaParts.slice(1).join(', ') };
    }

    const dashParts = v.split(/\s[-–]\s/).map((p) => p.trim()).filter(Boolean);
    if (dashParts.length >= 2) {
        return { primary: dashParts[0], secondary: dashParts.slice(1).join(' – ') };
    }

    return { primary: v, secondary: '' };
};

const getInitials = (value: string) => {
    const parts = String(value || '')
        .replace(/[^a-zA-Z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(Boolean);
    const first = parts[0]?.[0] || 'O';
    const second = parts.length > 1 ? parts[1][0] : parts[0]?.[1] || '';
    return (first + second).toUpperCase();
};

const getOperatorTrustMeta = (route: BusRoute) => {
    const r: any = route as any;
    const rating = typeof r.operatorRating === 'number' && Number.isFinite(r.operatorRating) ? r.operatorRating : undefined;
    const trustCount = typeof r.operatorTrustCount === 'number' && Number.isFinite(r.operatorTrustCount) ? r.operatorTrustCount : undefined;
    const verified = typeof r.operatorVerified === 'boolean' ? r.operatorVerified : undefined;
    return { rating, trustCount, verified };
};

const TripSummary: React.FC<TripSummaryProps> = ({ booking, query, compact, onChangeRequested }) => {
    const { outbound, inbound } = booking;
    const isEaglelinerTrip = (() => {
        const o: any = outbound as any;
        const provider = String(o?.provider || '').toLowerCase();
        const id = String(o?.id || '');
        if (provider === 'eagleliner') return true;
        if (id.startsWith('eagleliner:')) return true;
        const raw = o?.raw || o?._eagleliner;
        if (raw && Array.isArray(raw?.FairPrice) && raw.FairPrice.length > 0) return true;
        return false;
    })();
    const eaglelinerFairPriceList = (() => {
        if (!isEaglelinerTrip) return [] as any[];
        const o: any = outbound as any;
        const raw = o?._eagleliner?.FairPrice || o?.raw?.FairPrice || o?.raw?.fairPrice;
        return Array.isArray(raw) ? raw : [];
    })();
    const eaglelinerSelectedCounts = (() => {
        const raw = (query as any)?.eaglelinerPassengerCounts;
        if (!raw || typeof raw !== 'object') return null;
        const next: Record<string, number> = {};
        for (const [k, v] of Object.entries(raw)) {
            const n = Number(v);
            if (Number.isFinite(n) && n > 0) next[String(k)] = Math.floor(n);
        }
        return Object.keys(next).length ? next : null;
    })();
    const formattedOutboundDate = formatDateForDisplay(query.departureDate);
    const formattedInboundDate = query.returnDate ? formatDateForDisplay(query.returnDate) : '';
    const legs = (outbound as any)?.legs;
    const hasRoundTripLegs = Array.isArray(legs) && legs.length >= 2;
    const outboundDisplay: BusRoute = hasRoundTripLegs
        ? { ...outbound, origin: legs[0].origin, destination: legs[0].destination, departureTime: legs[0].departureTime, arrivalTime: legs[0].arrivalTime, duration: legs[0].duration, busCompany: (legs[0] as any).operator || outbound.busCompany }
        : outbound;
    const inboundDisplay: BusRoute | null = inbound ? inbound : (hasRoundTripLegs
        ? { ...outbound, origin: legs[1].origin, destination: legs[1].destination, departureTime: legs[1].departureTime, arrivalTime: legs[1].arrivalTime, duration: legs[1].duration, busCompany: (legs[1] as any).operator || outbound.busCompany }
        : null);
    const inboundToShow: BusRoute | null = inboundDisplay || inbound || null;
    
    const totalPassengers = (() => {
        if (isEaglelinerTrip && eaglelinerSelectedCounts) {
            const sum = Object.values(eaglelinerSelectedCounts).reduce((acc, v) => acc + (Number(v) > 0 ? Number(v) : 0), 0);
            if (sum > 0) return sum;
        }
        return Math.max(1, (query.passengers.adults || 0) + (query.passengers.children || 0) + ((query.passengers as any).seniors || 0) + ((query.passengers as any).students || 0));
    })();

    const eaglelinerTotalPrice = (() => {
        if (!isEaglelinerTrip) return null;
        if (!eaglelinerSelectedCounts) return null;
        if (!Array.isArray(eaglelinerFairPriceList) || eaglelinerFairPriceList.length === 0) return null;
        let total = 0;
        for (const item of eaglelinerFairPriceList) {
            const id = String(item?.id);
            const qty = Number((eaglelinerSelectedCounts as any)[id] || 0);
            const unit = Number(item?.price);
            if (!Number.isFinite(qty) || qty <= 0) continue;
            if (!Number.isFinite(unit) || unit < 0) continue;
            total += unit * qty;
        }
        return Number.isFinite(total) ? total : null;
    })();

    const hasAggregatedRoundTrip = !inbound && hasRoundTripLegs;
    const outboundBasePrice = outbound.price || 0;
    const inboundBasePrice = inbound
        ? (inbound.price || 0)
        : (hasAggregatedRoundTrip ? outboundBasePrice : 0);

    const outboundPerPassenger = (eaglelinerTotalPrice != null ? eaglelinerTotalPrice : outboundBasePrice) / totalPassengers;
    const inboundPerPassenger = inboundBasePrice / totalPassengers;
    const outboundTotalPrice = eaglelinerTotalPrice != null ? eaglelinerTotalPrice : (outboundPerPassenger * totalPassengers);
    const inboundTotalPrice = inboundPerPassenger * totalPassengers;
    const totalPrice = outboundTotalPrice + inboundTotalPrice;

    const outboundFare = computePassengerFareBreakdown(outbound, query);
    const inboundFare = inboundToShow ? computePassengerFareBreakdown(inboundToShow, query) : null;

    const outboundAdultTotal = outboundFare.adultUnit * outboundFare.adultCount;
    const outboundChildTotal = outboundFare.childUnit * outboundFare.childCount;
    const inboundAdultTotal = inboundFare ? inboundFare.adultUnit * inboundFare.adultCount : 0;
    const inboundChildTotal = inboundFare ? inboundFare.childUnit * inboundFare.childCount : 0;

    const currency = outbound.currency || inbound?.currency || 'USD';
    const currencyPrefix = currency === 'USD' ? '$' : `${currency} `;

    const outboundFrom = splitStopParts(outboundDisplay.origin);
    const outboundTo = splitStopParts(outboundDisplay.destination);
    const inboundFrom = inboundToShow ? splitStopParts(inboundToShow.origin) : null;
    const inboundTo = inboundToShow ? splitStopParts(inboundToShow.destination) : null;

    const outboundDepMin = parseClockMinutes(outboundDisplay.departureTime);
    const outboundArrMin = parseClockMinutes(outboundDisplay.arrivalTime);
    const outboundDurMin = parseDurationMinutes(outboundDisplay.duration);
    const outboundArrivesNextDay = (() => {
        if (outboundDepMin != null && outboundArrMin != null) return outboundArrMin < outboundDepMin;
        if (outboundDepMin != null && outboundDurMin != null) {
            const dep = addMinutesToDate(query.departureDate, outboundDepMin);
            const arr = addMinutesToDate(query.departureDate, outboundDepMin + outboundDurMin);
            if (!dep || !arr) return false;
            return dep.toDateString() !== arr.toDateString();
        }
        return false;
    })();

    const outboundArrivalDateString = (() => {
        if (outboundDepMin != null && outboundDurMin != null) {
            const arr = addMinutesToDate(query.departureDate, outboundDepMin + outboundDurMin);
            if (arr) return toDateStringYmd(arr);
        }
        return outboundArrivesNextDay ? addDaysToDateString(query.departureDate, 1) : query.departureDate;
    })();

    const inboundArrivesNextDay = (() => {
        if (!inboundToShow || !query.returnDate) return false;
        const depMin = parseClockMinutes(inboundToShow.departureTime);
        const arrMin = parseClockMinutes(inboundToShow.arrivalTime);
        const durMin = parseDurationMinutes(inboundToShow.duration);
        if (depMin != null && arrMin != null) return arrMin < depMin;
        if (depMin != null && durMin != null) {
            const dep = addMinutesToDate(query.returnDate, depMin);
            const arr = addMinutesToDate(query.returnDate, depMin + durMin);
            if (!dep || !arr) return false;
            return dep.toDateString() !== arr.toDateString();
        }
        return false;
    })();

    const inboundArrivalDateString = (() => {
        if (!inboundToShow || !query.returnDate) return '';
        const depMin = parseClockMinutes(inboundToShow.departureTime);
        const durMin = parseDurationMinutes(inboundToShow.duration);
        if (depMin != null && durMin != null) {
            const arr = addMinutesToDate(query.returnDate, depMin + durMin);
            if (arr) return toDateStringYmd(arr);
        }
        return inboundArrivesNextDay ? addDaysToDateString(query.returnDate, 1) : query.returnDate;
    })();
    
    const [canShare, setCanShare] = useState(false);

    useEffect(() => {
        if (typeof window !== 'undefined') {
            setCanShare(true);
        }
    }, []);

    const handleShare = async () => {
        const currency = outbound.currency || inbound?.currency || 'USD';

        const doc = new jsPDF();
        let y = 15;

        doc.setFontSize(16);
        doc.text('Bus Trip Itinerary', 10, y);
        y += 8;

        doc.setFontSize(11);
        doc.text(`Route: ${outboundDisplay.origin} → ${outboundDisplay.destination}`, 10, y);
        y += 6;
        doc.text(`Outbound: ${formattedOutboundDate}`, 10, y);
        y += 6;
        doc.text(`Time: ${outboundDisplay.departureTime} – ${outboundDisplay.arrivalTime} (${outboundDisplay.duration})`, 10, y, { maxWidth: 190 });
        y += 6;
        doc.text(`Operator: ${outboundDisplay.busCompany}`, 10, y, { maxWidth: 190 });
        y += 6;
        doc.text(`Passengers: ${totalPassengers} traveler(s)`, 10, y);
        y += 8;

        if (inboundToShow && formattedInboundDate) {
            doc.text('Return Trip', 10, y);
            y += 6;
            doc.text(`Date: ${formattedInboundDate}`, 10, y);
            y += 6;
            doc.text(`Time: ${inboundToShow.departureTime} – ${inboundToShow.arrivalTime} (${inboundToShow.duration})`, 10, y, { maxWidth: 190 });
            y += 6;
            doc.text(`Operator: ${inboundToShow.busCompany}`, 10, y, { maxWidth: 190 });
            y += 8;
        }

        doc.text(`Total price: ${currency} ${totalPrice.toFixed(2)}`, 10, y);
        y += 6;
        doc.text('Book this trip on National Tickets Global.', 10, y, { maxWidth: 190 });

        const blob = doc.output('blob');
        const fileName = 'trip-itinerary.pdf';

        const file = new File([blob], fileName, { type: 'application/pdf' });
        const nav: any = typeof navigator !== 'undefined' ? navigator : null;
        const canShareFile = nav && typeof nav.canShare === 'function' && nav.canShare({ files: [file] });

        if (canShareFile && typeof nav.share === 'function') {
            try {
                await nav.share({
                    files: [file],
                    title: 'Bus Trip Itinerary',
                    text: 'Trip itinerary attached as PDF.',
                });
                return;
            } catch (error) {
                console.error('Error sharing PDF:', error);
            }
        }

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className={`relative ${compact ? 'space-y-2.5' : 'space-y-4'}`}>
            {canShare && (
                <button
                    type="button"
                    onClick={handleShare}
                    className={`absolute -top-2 -right-2 ${compact ? 'p-1.5' : 'p-2'} text-[#652D8E] dark:text-purple-300 rounded-full hover:bg-purple-100 dark:hover:bg-purple-900/50 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-purple-500`}
                    aria-label="Share trip details"
                    title="Share itinerary"
                >
                    <ShareIcon className={`${compact ? 'h-4 w-4' : 'h-6 w-6'}`} />
                </button>
            )}

            {/* Trip Details */}
            <div className={`space-y-2 ${compact ? '' : 'space-y-3'}`}>
                <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white/60 dark:bg-gray-900/30 p-2">
                    <div className="flex items-start justify-between gap-2">
                        <div>
                            <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Outbound</div>
                            <div className="mt-1 grid grid-cols-2 gap-3">
                                <div>
                                    <div className="text-[9px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">From</div>
                                    <div className="text-[11px] font-semibold text-[#652D8E] dark:text-purple-300 leading-tight">{outboundFrom.primary}</div>
                                    {outboundFrom.secondary ? (
                                        <div className="text-[10px] text-gray-600 dark:text-gray-300 leading-tight">{outboundFrom.secondary}</div>
                                    ) : null}
                                </div>
                                <div>
                                    <div className="text-[9px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">To</div>
                                    <div className="text-[11px] font-semibold text-[#652D8E] dark:text-purple-300 leading-tight">{outboundTo.primary}</div>
                                    {outboundTo.secondary ? (
                                        <div className="text-[10px] text-gray-600 dark:text-gray-300 leading-tight">{outboundTo.secondary}</div>
                                    ) : null}
                                </div>
                            </div>
                        </div>
                        {onChangeRequested ? (
                            <button
                                type="button"
                                onClick={() => onChangeRequested('route')}
                                className="text-[10px] font-bold text-[#652D8E] hover:opacity-80 dark:text-purple-300"
                            >
                                Change
                            </button>
                        ) : null}
                    </div>

                    <div className="mt-2 grid grid-cols-1 gap-2">
                        <div className="rounded-lg bg-gray-50 dark:bg-gray-800/60 border border-gray-200/70 dark:border-gray-700 p-2">
                            <div className="flex items-start justify-between gap-2">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 flex-1">
                                <div className="flex items-start gap-2">
                                    <CalendarIcon className="h-4 w-4 text-gray-400 mt-0.5" />
                                    <div>
                                        <div className="text-[9px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Departs</div>
                                        <div className="text-[11px] font-semibold text-gray-800 dark:text-gray-100">{formatDateTimeLabel(query.departureDate, outboundDisplay.departureTime)}</div>
                                    </div>
                                </div>
                                <div className="flex items-start gap-2">
                                    <ClockIcon className="h-4 w-4 text-gray-400 mt-0.5" />
                                    <div>
                                        <div className="text-[9px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Arrives</div>
                                        <div className="text-[11px] font-semibold text-gray-800 dark:text-gray-100">{formatDateTimeLabel(outboundArrivalDateString, outboundDisplay.arrivalTime)}</div>
                                    </div>
                                </div>
                                </div>
                                {onChangeRequested ? (
                                    <button
                                        type="button"
                                        onClick={() => onChangeRequested('date')}
                                        className="text-[10px] font-bold text-[#652D8E] hover:opacity-80 dark:text-purple-300"
                                    >
                                        Change
                                    </button>
                                ) : null}
                            </div>

                            <div className="mt-1.5 text-[10px] text-gray-600 dark:text-gray-300">
                                Duration: <span className="font-semibold">{outboundDisplay.duration || 'N/A'}</span>
                            </div>
                            {outboundArrivesNextDay ? (
                                <div className="mt-1 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                                    Arrives the next day
                                </div>
                            ) : null}
                        </div>

                        <div className="rounded-lg bg-gray-50 dark:bg-gray-800/60 border border-gray-200/70 dark:border-gray-700 p-2">
                            <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0">
                                    <div className="h-7 w-7 rounded-full bg-[#652D8E]/10 dark:bg-purple-500/15 flex items-center justify-center text-[10px] font-extrabold text-[#652D8E] dark:text-purple-200 flex-shrink-0">
                                        {getInitials(outboundDisplay.busCompany || 'Operator')}
                                    </div>
                                    <div className="min-w-0">
                                        <div className="text-[9px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Operator</div>
                                        <div className="text-[11px] font-semibold text-gray-800 dark:text-gray-100 break-words">{outboundDisplay.busCompany || 'Unknown Operator'}</div>
                                        {(() => {
                                            const meta = getOperatorTrustMeta(outboundDisplay);
                                            if (meta.rating == null && meta.trustCount == null) return null;
                                            const ratingPart = meta.rating != null ? `⭐ ${meta.rating.toFixed(1)}` : '';
                                            const countPart = meta.trustCount != null ? `Trusted by ${meta.trustCount.toLocaleString()}+ travelers` : '';
                                            const sep = ratingPart && countPart ? ' • ' : '';
                                            return (
                                                <div className="mt-0.5 text-[10px] text-gray-600 dark:text-gray-300">
                                                    {ratingPart}{sep}{countPart}
                                                </div>
                                            );
                                        })()}
                                    </div>
                                </div>
                                {(() => {
                                    const meta = getOperatorTrustMeta(outboundDisplay);
                                    if (meta.verified !== true) return null;
                                    return (
                                        <span className="inline-flex items-center gap-1 rounded-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 px-2 py-0.5 text-[10px] font-semibold text-gray-600 dark:text-gray-300">
                                            <LockClosedIcon className="h-3.5 w-3.5 text-gray-400" />
                                            Verified operator
                                        </span>
                                    );
                                })()}
                            </div>
                        </div>
                    </div>
                </div>

                {inboundToShow && inboundFrom && inboundTo ? (
                    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white/60 dark:bg-gray-900/30 p-2">
                        <div className="flex items-start justify-between gap-2">
                            <div>
                                <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Return</div>
                                <div className="mt-1 grid grid-cols-2 gap-3">
                                    <div>
                                        <div className="text-[9px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">From</div>
                                        <div className="text-[11px] font-semibold text-[#652D8E] dark:text-purple-300 leading-tight">{inboundFrom.primary}</div>
                                        {inboundFrom.secondary ? (
                                            <div className="text-[10px] text-gray-600 dark:text-gray-300 leading-tight">{inboundFrom.secondary}</div>
                                        ) : null}
                                    </div>
                                    <div>
                                        <div className="text-[9px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">To</div>
                                        <div className="text-[11px] font-semibold text-[#652D8E] dark:text-purple-300 leading-tight">{inboundTo.primary}</div>
                                        {inboundTo.secondary ? (
                                            <div className="text-[10px] text-gray-600 dark:text-gray-300 leading-tight">{inboundTo.secondary}</div>
                                        ) : null}
                                    </div>
                                </div>
                            </div>
                            {onChangeRequested ? (
                                <button
                                    type="button"
                                    onClick={() => onChangeRequested('route')}
                                    className="text-[10px] font-bold text-[#652D8E] hover:opacity-80 dark:text-purple-300"
                                >
                                    Change
                                </button>
                            ) : null}
                        </div>

                        <div className="mt-2 grid grid-cols-1 gap-2">
                            <div className="rounded-lg bg-gray-50 dark:bg-gray-800/60 border border-gray-200/70 dark:border-gray-700 p-2">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 flex-1">
                                    <div className="flex items-start gap-2">
                                        <CalendarIcon className="h-4 w-4 text-gray-400 mt-0.5" />
                                        <div>
                                            <div className="text-[9px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Departs</div>
                                            <div className="text-[11px] font-semibold text-gray-800 dark:text-gray-100">{formatDateTimeLabel(query.returnDate || '', inboundToShow.departureTime)}</div>
                                        </div>
                                    </div>
                                    <div className="flex items-start gap-2">
                                        <ClockIcon className="h-4 w-4 text-gray-400 mt-0.5" />
                                        <div>
                                            <div className="text-[9px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Arrives</div>
                                            <div className="text-[11px] font-semibold text-gray-800 dark:text-gray-100">{formatDateTimeLabel(inboundArrivalDateString || (query.returnDate || ''), inboundToShow.arrivalTime)}</div>
                                        </div>
                                    </div>
                                    </div>
                                    {onChangeRequested ? (
                                        <button
                                            type="button"
                                            onClick={() => onChangeRequested('date')}
                                            className="text-[10px] font-bold text-[#652D8E] hover:opacity-80 dark:text-purple-300"
                                        >
                                            Change
                                        </button>
                                    ) : null}
                                </div>

                                <div className="mt-1.5 text-[10px] text-gray-600 dark:text-gray-300">
                                    Duration: <span className="font-semibold">{inboundToShow.duration || 'N/A'}</span>
                                </div>
                                {inboundArrivesNextDay ? (
                                    <div className="mt-1 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                                        Arrives the next day
                                    </div>
                                ) : null}
                            </div>

                            <div className="rounded-lg bg-gray-50 dark:bg-gray-800/60 border border-gray-200/70 dark:border-gray-700 p-2">
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <div className="h-7 w-7 rounded-full bg-[#652D8E]/10 dark:bg-purple-500/15 flex items-center justify-center text-[10px] font-extrabold text-[#652D8E] dark:text-purple-200 flex-shrink-0">
                                            {getInitials(inboundToShow.busCompany || 'Operator')}
                                        </div>
                                        <div className="min-w-0">
                                            <div className="text-[9px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Operator</div>
                                            <div className="text-[11px] font-semibold text-gray-800 dark:text-gray-100 break-words">{inboundToShow.busCompany || 'Unknown Operator'}</div>
                                            {(() => {
                                                const meta = getOperatorTrustMeta(inboundToShow);
                                                if (meta.rating == null && meta.trustCount == null) return null;
                                                const ratingPart = meta.rating != null ? `⭐ ${meta.rating.toFixed(1)}` : '';
                                                const countPart = meta.trustCount != null ? `Trusted by ${meta.trustCount.toLocaleString()}+ travelers` : '';
                                                const sep = ratingPart && countPart ? ' • ' : '';
                                                return (
                                                    <div className="mt-0.5 text-[10px] text-gray-600 dark:text-gray-300">
                                                        {ratingPart}{sep}{countPart}
                                                    </div>
                                                );
                                            })()}
                                        </div>
                                    </div>
                                    {(() => {
                                        const meta = getOperatorTrustMeta(inboundToShow);
                                        if (meta.verified !== true) return null;
                                        return (
                                            <span className="inline-flex items-center gap-1 rounded-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 px-2 py-0.5 text-[10px] font-semibold text-gray-600 dark:text-gray-300">
                                                <LockClosedIcon className="h-3.5 w-3.5 text-gray-400" />
                                                Verified operator
                                            </span>
                                        );
                                    })()}
                                </div>
                            </div>
                        </div>
                    </div>
                ) : null}

                <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white/60 dark:bg-gray-900/30 p-2">
                    <div className="flex items-center justify-between gap-2">
                        <div className="flex items-start gap-2">
                            <UsersIcon className="h-4 w-4 text-gray-400 mt-0.5" />
                            <div>
                                <div className="text-[9px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Passengers</div>
                                <div className="text-[11px] font-semibold text-gray-800 dark:text-gray-100">{totalPassengers} traveler(s)</div>
                            </div>
                        </div>
                        {onChangeRequested ? (
                            <button
                                type="button"
                                onClick={() => onChangeRequested('passengers')}
                                className="text-[10px] font-bold text-[#652D8E] hover:opacity-80 dark:text-purple-300"
                            >
                                Change
                            </button>
                        ) : null}
                    </div>
                </div>
            </div>

            {/* Price Breakdown */}
            <div className="pt-3 border-t border-gray-200 dark:border-gray-700">
                <div className="mb-1.5">
                    <h4 className={`${compact ? 'text-xs' : 'text-sm'} font-bold text-[#652D8E] dark:text-purple-300 uppercase tracking-wide`}>Price Breakdown</h4>
                </div>

                <div className="border-t border-gray-200 dark:border-gray-700 my-3"></div>

                <div className="flex justify-between items-center">
                    <span className={`font-bold ${compact ? 'text-xs' : 'text-base'} text-[#652D8E] dark:text-purple-300 flex items-center gap-2`}>
                         <PriceTagIcon className={`${compact ? 'h-3.5 w-3.5' : 'h-5 w-5'}`}/>
                         Total
                    </span>
                    <span className={`${compact ? 'text-base' : 'text-2xl'} font-bold text-[#652D8E] dark:text-purple-300`}>{currencyPrefix}{totalPrice.toFixed(2)}</span>
                </div>

                <div className="mt-1.5 space-y-1 text-[10px] text-gray-600 dark:text-gray-300">
                    <div className="inline-flex items-center gap-1">
                        <CheckCircleIcon className="h-3.5 w-3.5 text-green-600 dark:text-green-300" />
                        No hidden fees
                    </div>
                    <div className="inline-flex items-center gap-1">
                        <CheckCircleIcon className="h-3.5 w-3.5 text-green-600 dark:text-green-300" />
                        Taxes included (where applicable)
                    </div>
                </div>

                <details className="mt-2">
                    <summary className="cursor-pointer text-[11px] font-semibold text-[#652D8E] hover:opacity-80 dark:text-purple-300">
                        View detailed fare breakdown
                    </summary>
                    <div className={`mt-2 space-y-1.5 ${compact ? 'text-xs' : 'text-sm'}`}>
                        <div className="flex justify-between items-start gap-3">
                            <div>
                                <span className="text-gray-600 dark:text-gray-300">Outbound ({totalPassengers}x)</span>
                                {isEaglelinerTrip && eaglelinerTotalPrice != null && eaglelinerSelectedCounts && eaglelinerFairPriceList.length > 0 ? (
                                    <>
                                        {eaglelinerFairPriceList.map((item: any) => {
                                            const id = String(item?.id);
                                            const qty = Number((eaglelinerSelectedCounts as any)[id] || 0);
                                            const unit = Number(item?.price);
                                            if (!Number.isFinite(qty) || qty <= 0) return null;
                                            if (!Number.isFinite(unit)) return null;
                                            const label = String(item?.name || 'Passenger');
                                            const lineTotal = unit * qty;
                                            return (
                                                <div key={id} className={`${compact ? 'text-[10px]' : 'text-xs'} text-gray-500 dark:text-gray-400`}>{
                                                    `${label} (${qty}x @ ${currencyPrefix}${unit.toFixed(2)}) → ${currencyPrefix}${lineTotal.toFixed(2)}`
                                                }</div>
                                            );
                                        })}
                                    </>
                                ) : null}
                                {outboundFare.hasDetailedBreakdown ? (
                                    <>
                                        {Array.isArray(outboundFare.lines) && outboundFare.lines.length > 0 ? (
                                            outboundFare.lines.map((line) => (
                                                <div key={line.key} className={`${compact ? 'text-[10px]' : 'text-xs'} text-gray-500 dark:text-gray-400`}>{
                                                    `${line.label} (${line.count}x @ ${currencyPrefix}${line.unit.toFixed(2)}) → ${currencyPrefix}${line.total.toFixed(2)}`
                                                }</div>
                                            ))
                                        ) : (
                                            <>
                                                {outboundFare.adultCount > 0 && outboundFare.adultUnit > 0 && (
                                                    <div className={`${compact ? 'text-[10px]' : 'text-xs'} text-gray-500 dark:text-gray-400`}>{
                                                        `Adults (${outboundFare.adultCount}x @ ${currencyPrefix}${outboundFare.adultUnit.toFixed(2)}) → ${currencyPrefix}${outboundAdultTotal.toFixed(2)}`
                                                    }</div>
                                                )}
                                                {outboundFare.childCount > 0 && outboundFare.childUnit > 0 && (
                                                    <div className={`${compact ? 'text-[10px]' : 'text-xs'} text-gray-500 dark:text-gray-400`}>{
                                                        `Children (${outboundFare.childCount}x @ ${currencyPrefix}${outboundFare.childUnit.toFixed(2)}) → ${currencyPrefix}${outboundChildTotal.toFixed(2)}`
                                                    }</div>
                                                )}
                                            </>
                                        )}
                                    </>
                                ) : (
                                    <div className={`${compact ? 'text-[10px]' : 'text-xs'} text-gray-500 dark:text-gray-400`}>{`Per passenger: ${currencyPrefix}${outboundPerPassenger.toFixed(2)}`}</div>
                                )}
                            </div>
                            <span className="font-medium text-gray-900 dark:text-gray-100">{currencyPrefix}{outboundTotalPrice.toFixed(2)}</span>
                        </div>

                        {inboundToShow && inboundTotalPrice > 0 && (
                            <div className="flex justify-between items-start gap-3">
                                <div>
                                    <span className="text-gray-600 dark:text-gray-300">Inbound ({totalPassengers}x)</span>
                                    {inboundFare && inboundFare.hasDetailedBreakdown ? (
                                        <>
                                            {Array.isArray(inboundFare.lines) && inboundFare.lines.length > 0 ? (
                                                inboundFare.lines.map((line) => (
                                                    <div key={line.key} className={`${compact ? 'text-[10px]' : 'text-xs'} text-gray-500 dark:text-gray-400`}>{
                                                        `${line.label} (${line.count}x @ ${currencyPrefix}${line.unit.toFixed(2)}) → ${currencyPrefix}${line.total.toFixed(2)}`
                                                    }</div>
                                                ))
                                            ) : (
                                                <>
                                                    {inboundFare.adultCount > 0 && inboundFare.adultUnit > 0 && (
                                                        <div className={`${compact ? 'text-[10px]' : 'text-xs'} text-gray-500 dark:text-gray-400`}>{
                                                            `Adults (${inboundFare.adultCount}x @ ${currencyPrefix}${inboundFare.adultUnit.toFixed(2)}) → ${currencyPrefix}${inboundAdultTotal.toFixed(2)}`
                                                        }</div>
                                                    )}
                                                    {inboundFare.childCount > 0 && inboundFare.childUnit > 0 && (
                                                        <div className={`${compact ? 'text-[10px]' : 'text-xs'} text-gray-500 dark:text-gray-400`}>{
                                                            `Children (${inboundFare.childCount}x @ ${currencyPrefix}${inboundFare.childUnit.toFixed(2)}) → ${currencyPrefix}${inboundChildTotal.toFixed(2)}`
                                                        }</div>
                                                    )}
                                                </>
                                            )}
                                        </>
                                    ) : (
                                        <div className={`${compact ? 'text-[10px]' : 'text-xs'} text-gray-500 dark:text-gray-400`}>{`Per passenger: ${currencyPrefix}${inboundPerPassenger.toFixed(2)}`}</div>
                                    )}
                                </div>
                                <span className="font-medium text-gray-900 dark:text-gray-100">{currencyPrefix}{inboundTotalPrice.toFixed(2)}</span>
                            </div>
                        )}
                    </div>
                </details>
            </div>
        </div>
    );
};

export default TripSummary;
