import React, { useEffect, useMemo, useRef, useState } from 'react';
import jsPDF from 'jspdf';
import { BusRoute, SearchQuery, getCartData, getHoldTicketsByPnr, saveCartData } from '@/utils/api';
import { getAgentHeaders, isAgentModeActive } from '@/utils/agentHeaders';

import { BookingDetails, Passenger } from '@/types';
import { CheckCircleIcon, ArrowRightIcon, UserCircleIcon, AtSymbolIcon, CreditCardIcon, PayPalIcon, GooglePayIcon, StoreIcon, CalendarIcon, LocationIcon, TicketIcon, ShareIcon, DownloadIcon, SpinnerIcon } from './icons';

interface PaymentConfirmationModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    showInfo?: (opts: { title: string; message: string; details?: string; primaryActionLabel?: string; onPrimaryAction?: () => void }) => void;
    booking: { outbound: BusRoute; inbound: BusRoute | null };
    query: SearchQuery;
    details: BookingDetails;
    pnr?: string;
    maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';
}

interface CartTicket {
    id: string;
    cartId: string;
    status: string;
    updatedAt: string;
    options?: any;
    isHold?: boolean;
}

const getPaymentIcon = (method: string) => {
    const props = { className: "h-4 w-4 text-gray-500 dark:text-gray-400 mr-2" };
    switch (method) {
        case 'Credit Card':
            return <CreditCardIcon {...props} />;
        case 'PayPal':
            return <PayPalIcon {...props} />;
        case 'Google Pay':
            return <GooglePayIcon {...props} />;
        case 'In-Store':
            return <StoreIcon {...props} />;
        default:
            return <CreditCardIcon {...props} />;
    }
}

const PassengerDetailRow: React.FC<{ icon: React.ReactNode; label: string; value: string }> = ({ icon, label, value }) => (
    <div className="flex items-start text-[10px]">
        <div className="flex-shrink-0 h-3.5 w-3.5 text-gray-400 mt-0.5">{icon}</div>
        <div className="ml-2">
            <span className="font-semibold text-gray-500 dark:text-gray-400">{label}:</span>
            <span className="ml-1 text-gray-700 dark:text-gray-300">{value}</span>
        </div>
    </div>
);

const calculateAge = (dob: string): string => {
    try {
        const birth = new Date(dob + 'T00:00:00');
        if (isNaN(birth.getTime())) return '—';
        const today = new Date();
        let age = today.getFullYear() - birth.getFullYear();
        const m = today.getMonth() - birth.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
        return String(Math.max(0, age));
    } catch {
        return '—';
    }
}

const PassengerDetailsCard: React.FC<{ passenger: Passenger, index: number }> = ({ passenger, index }) => (
    <div className="border-t border-gray-200 dark:border-gray-700 pt-2 first:pt-0 first:border-t-0">
        <div className="flex justify-between items-center">
            <h4 className="font-semibold text-sm text-[#652D8E] dark:text-purple-300">
                {passenger.firstName} {passenger.lastName}
            </h4>
            <span className="text-xs capitalize text-gray-500 bg-gray-100 dark:bg-gray-700 dark:text-gray-300 px-1.5 py-0.5 rounded-md">
                {passenger.type}
            </span>
        </div>
        <div className="mt-1.5 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
            <PassengerDetailRow icon={<CalendarIcon />} label="Age" value={calculateAge(passenger.dob)} />
            <PassengerDetailRow icon={<UserCircleIcon />} label="Gender" value={passenger.gender.charAt(0).toUpperCase() + passenger.gender.slice(1)} />
            <PassengerDetailRow icon={<LocationIcon />} label="Nationality" value={passenger.nationality} />
            <PassengerDetailRow icon={<CreditCardIcon />} label={passenger.idType.replace('_', ' ')} value={passenger.idNumber} />
        </div>
    </div>
);

const generatePnrPdfBlob = (pnr: string, expiryText?: string, supportEmail?: string) => {
    const doc = new jsPDF();

    doc.setFontSize(16);
    doc.text('Reservation (PNR)', 10, 15);

    doc.setFontSize(12);
    doc.text(`Reservation Code: ${pnr}`, 10, 30);

    doc.setFontSize(10);
    doc.text('How to Pay In-Store', 10, 42);

    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    doc.text(
        `Your booking has an outstanding balance, please process payment before ${expiryText || 'the expiry time shown on your reserved ticket'} to secure your booking.`,
        10,
        52,
        { maxWidth: 190 }
    );
    doc.setFont(undefined, 'normal');

    doc.setFontSize(10);
    doc.text(
        [
            `1. Present Ref No: ${pnr} to teller.`,
            '2. Pay at any TM Pick n Pay BancABC kiosk.',
            '3. Obtain your printed receipt and confirmation.',
            '4. Check your email for your official e-ticket.',
            `5. Support & Payments: ${supportEmail || 'support@nationaltickets.co.za'}. WhatsApp: +263 783 911 611.`,
        ],
        10,
        78,
        { maxWidth: 190 }
    );

    return doc.output('blob');
};

const PaymentConfirmationModal: React.FC<PaymentConfirmationModalProps> = ({ isOpen, onClose, onConfirm, showInfo, booking, query, details, pnr, maxWidth }) => {
    const modalRef = useRef<HTMLDivElement>(null);
    const [copied, setCopied] = useState(false);
    const [showAllPassengers, setShowAllPassengers] = useState(false);

    const [holdTicket, setHoldTicket] = useState<CartTicket | null>(null);
    const [holdTicketLoading, setHoldTicketLoading] = useState(false);
    const [holdTicketError, setHoldTicketError] = useState<string | null>(null);
    const [holdTicketPdfLoading, setHoldTicketPdfLoading] = useState(false);

    const [priceConfirmationRequired, setPriceConfirmationRequired] = useState(false);
    const [priceConfirmed, setPriceConfirmed] = useState(false);
    const priceInfoRef = useRef<{ quoted: number; updated: number; currency: string } | null>(null);
    const hasShownPriceInfoRef = useRef(false);

    const supportEmail = useMemo(() => {
        return String((import.meta as any)?.env?.VITE_SUPPORT_EMAIL || 'support@nationaltickets.co.za');
    }, []);

    const deadlineHours = useMemo(() => {
        const raw = (import.meta as any)?.env?.VITE_INSTORE_PAYMENT_DEADLINE_HOURS;
        const n = Number(raw);
        return Number.isFinite(n) && n > 0 ? n : 12;
    }, []);

    const expiryText = useMemo(() => {
        try {
            const opt: any = holdTicket?.options || null;
            const raw =
                opt?.ticket?.expiresAt ||
                opt?.ticket?.expires_at ||
                opt?.ticket?.expiryDate ||
                opt?.ticket?.expiry_date ||
                opt?.ticket?.expirationDate ||
                opt?.ticket?.expiration_date ||
                opt?.ticket?.x_datetime ||
                opt?.expiresAt ||
                opt?.expires_at ||
                opt?.expiryDate ||
                opt?.expiry_date ||
                null;
            if (!raw) return '';
            const d = raw && typeof raw === 'object' && (raw._seconds || raw.seconds)
                ? new Date(((raw._seconds || raw.seconds) as number) * 1000 + Number(raw._nanoseconds || raw.nanoseconds || 0) / 1000000)
                : new Date(raw);
            if (Number.isNaN(d.getTime())) return '';
            return d.toLocaleString(undefined, {
                year: 'numeric',
                month: 'short',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
            });
        } catch {
            return '';
        }
    }, [holdTicket]);

    const fallbackExpiryText = useMemo(() => {
        try {
            const d = new Date(Date.now() + deadlineHours * 60 * 60 * 1000);
            return d.toLocaleString(undefined, {
                year: 'numeric',
                month: 'short',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
            });
        } catch {
            return '';
        }
    }, [deadlineHours]);

    const displayExpiryText = expiryText || fallbackExpiryText || 'the expiry time shown on your reserved ticket';

    const extractNumericFromUnknown = (value: unknown) => {
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        if (typeof value !== 'string') return null;
        const m = value.match(/[0-9]+(?:\.[0-9]+)?/);
        if (!m) return null;
        const n = Number.parseFloat(m[0]);
        return Number.isFinite(n) ? n : null;
    };

    const extractCurrencyFromText = (text: string, numericMatch?: string) => {
        try {
            const rest = text.replace(numericMatch ?? '', '').trim();
            const token = rest.split(/\s+/).filter(Boolean)[0];
            if (token && /^[A-Z]{3}$/.test(token)) return token;
        } catch {}
        return null;
    };

    const buildPriceChangeMessage = (quoted: number, updated: number, currency: string) => {
        const prefix = currency === 'USD' ? '$' : `${currency} `;
        const delta = updated - quoted;
        const absDelta = Math.abs(delta);
        const deltaText = absDelta >= 0.01 ? `${prefix}${absDelta.toFixed(2)}` : '';
        return delta < 0
            ? `Good news — the fare dropped. Your new total is ${prefix}${updated.toFixed(2)} (previously ${prefix}${quoted.toFixed(2)}).`
            : `Quick update — the operator updated the fare${deltaText ? ` (+${deltaText})` : ''}. Your new total is ${prefix}${updated.toFixed(2)} (previously ${prefix}${quoted.toFixed(2)}).`;
    };

    const triggerPriceInfo = (quoted: number, updated: number, currency: string) => {
        priceInfoRef.current = { quoted, updated, currency };
        setPriceConfirmationRequired(true);
        setPriceConfirmed(false);

        if (!showInfo) return;

        showInfo({
            title: 'Price updated',
            message: buildPriceChangeMessage(quoted, updated, currency),
            primaryActionLabel: 'Continue',
            onPrimaryAction: () => {
                try {
                    saveCartData({ quotedTotal: updated, quotedCurrency: currency });
                } catch {}
                setPriceConfirmed(true);
            },
        });
    };

    useEffect(() => {
        if (!isOpen || details.paymentMethod !== 'In-Store') {
            setHoldTicket(null);
            setHoldTicketError(null);
            setHoldTicketPdfLoading(false);
            setPriceConfirmationRequired(false);
            setPriceConfirmed(false);
            priceInfoRef.current = null;
            hasShownPriceInfoRef.current = false;
            return;
        }

        const cartData = getCartData();
        const cartId = cartData?.cartId;
        const lookupId = pnr || cartId;

        if (!lookupId) {
            setHoldTicketError('No PNR found for this booking.');
            return;
        }

        const fetchHoldTicket = async () => {
            try {
                setHoldTicketLoading(true);
                setHoldTicketError(null);

                const response = await getHoldTicketsByPnr(lookupId);
                if (response && response.success && Array.isArray(response.tickets)) {
                    const tickets = response.tickets as CartTicket[];
                    const hold = tickets.find((t) => t.isHold) || tickets[0] || null;
                    setHoldTicket(hold);
                } else {
                    setHoldTicketError(response?.error || 'Failed to load tickets.');
                }
            } catch (e: any) {
                setHoldTicketError(e?.message || 'Failed to load tickets.');
            } finally {
                setHoldTicketLoading(false);
            }
        };

        fetchHoldTicket();
    }, [isOpen, details.paymentMethod]);

    useEffect(() => {
        if (!isOpen) return;
        if (details.paymentMethod !== 'In-Store') return;
        if (!holdTicket || holdTicketLoading) return;
        if (hasShownPriceInfoRef.current) return;

        const cartData = getCartData();
        const sessionQuoted = typeof cartData?.quotedTotal === 'number' ? cartData.quotedTotal : null;
        const bookingQuoted = (() => {
            const out = booking?.outbound && typeof (booking.outbound as any).price === 'number' ? (booking.outbound as any).price : 0;
            const inn = booking?.inbound && typeof (booking.inbound as any).price === 'number' ? (booking.inbound as any).price : 0;
            const total = out + inn;
            return total > 0 && Number.isFinite(total) ? total : null;
        })();
        const quoted = sessionQuoted ?? bookingQuoted;
        if (quoted == null || !Number.isFinite(quoted)) return;

        const opt: any = holdTicket?.options || null;
        const priceCandidate =
            opt?.price ??
            opt?.ticket?.price ??
            opt?.ticket?.priceText ??
            opt?.ticket?.totalPrice ??
            opt?.ticket?.total ??
            '';

        const priceText = typeof priceCandidate === 'string' ? priceCandidate : '';
        const m = priceText.match(/[0-9]+(?:\.[0-9]+)?/);
        const updated = extractNumericFromUnknown(priceCandidate);

        const resolvedCurrency =
            (typeof priceCandidate === 'string' ? extractCurrencyFromText(priceCandidate, m?.[0]) : null) ||
            opt?.currency ||
            cartData?.quotedCurrency ||
            booking?.outbound?.currency ||
            'USD';

        if (updated == null || !Number.isFinite(updated)) return;

        if (Math.abs(updated - quoted) >= 0.01) {
            hasShownPriceInfoRef.current = true;
            triggerPriceInfo(quoted, updated, resolvedCurrency);
        }
    }, [isOpen, details.paymentMethod, holdTicket, holdTicketLoading, booking?.outbound?.currency, showInfo]);

    const handleFinish = async () => {

        if (priceConfirmationRequired && !priceConfirmed) {
            const info = priceInfoRef.current;
            if (info && showInfo) {
                showInfo({
                    title: 'Price updated',
                    message: buildPriceChangeMessage(info.quoted, info.updated, info.currency),
                    primaryActionLabel: 'Continue',
                    onPrimaryAction: () => {
                        try {
                            saveCartData({ quotedTotal: info.updated, quotedCurrency: info.currency });
                        } catch {}
                        setPriceConfirmed(true);
                    },
                });
            }
            return;
        }

        await Promise.resolve(onConfirm());
        if (typeof window !== 'undefined') {
            const shouldRedirect = isAgentModeActive();
            if (shouldRedirect) {
                try {
                    window.location.assign('/agent-dashboard');
                } catch {
                    window.location.href = '/agent-dashboard';
                }
            }
        }
    };

    const handleSharePnr = async () => {
        if (!pnr) return;

        const blob = generatePnrPdfBlob(pnr, expiryText, supportEmail);

        const fileName = `reservation-${pnr}.pdf`;
        const file = new File([blob], fileName, { type: 'application/pdf' });

        const nav: any = typeof navigator !== 'undefined' ? navigator : null;
        const canShareFile = nav && typeof nav.canShare === 'function' && nav.canShare({ files: [file] });

        if (canShareFile && typeof nav.share === 'function') {
            try {
                await nav.share({
                    files: [file],
                    title: 'Reservation Code (PNR)',
                    text: 'Reservation code PDF attached.',
                });
                return;
            } catch {}
        }

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);

        if (typeof navigator !== 'undefined' && navigator.clipboard) {
            try {
                const text = `Reservation Code (PNR): ${pnr}`;
                await navigator.clipboard.writeText(text);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
            } catch {}
        }
    };

    const handleDownloadPnr = () => {
        if (!pnr) return;
        const blob = generatePnrPdfBlob(pnr, expiryText, supportEmail);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `reservation-${pnr}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleDownloadHoldTicket = () => {
        const pdfPnr = holdRefNo || pnr || getCartData()?.cartId;
        if (!pdfPnr) return;

        const run = async () => {
            const encoded = encodeURIComponent(String(pdfPnr));
            try {
                setHoldTicketPdfLoading(true);
                const response = await fetch(`/api/ticket/pdf?pnr=${encoded}&type=hold&download=1&v=${Date.now()}`);
                if (!response.ok) {
                    throw new Error(`Failed to download PDF (status ${response.status})`);
                }
                const blob = await response.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `reserved-ticket-${holdTicket?.options?.ticket?.ref_no || holdTicket?.id || String(pdfPnr)}.pdf`;
                a.click();
                URL.revokeObjectURL(url);
            } catch (err) {
                console.error('Failed to download reserved ticket PDF', err);
            } finally {
                setHoldTicketPdfLoading(false);
            }
        };

        run();
    };

    if (!isOpen) return null;

    const sizeClass = ({
        sm: 'max-w-sm',
        md: 'max-w-md',
        lg: 'max-w-lg',
        xl: 'max-w-xl',
        '2xl': 'max-w-2xl',
        '3xl': 'max-w-3xl',
    } as const)[maxWidth || 'xl'];

    const modalWidthClass = details.paymentMethod === 'In-Store' ? 'max-w-3xl' : sizeClass;

    const passengerCount = details.passengers.length;
    const hasMultiplePassengers = passengerCount > 1;
    const opt: any = holdTicket?.options || null;
    const holdRefNo: string = String((opt && (opt.ticket?.ref_no ?? opt.ref_no)) ?? (pnr ?? ''));
    const holdSeatNo: string = String((opt && (opt.ticket?.seat_no ?? opt.ticket?.seat ?? opt.seat_no ?? '—')));
    const holdPassengerName: string = String(opt?.passenger?.name ?? opt?.passenger?.full_name ?? '');
    const holdPassengerId: string = String(opt?.passenger?.id ?? opt?.passenger?.id_number ?? '');
    const holdOperator: string = String(opt?.operatorName ?? opt?.operator ?? '');
    const holdBookedBy: string = String(opt?.ticket?.booked_by ?? '');
    const holdPrice: string = String((opt && (opt.ticket?.price ?? opt.price)) ?? '');
    const holdQr: string | null = (opt && typeof opt.qrDataUrl === 'string') ? opt.qrDataUrl : null;
    const itin: any = (opt && opt.itinerary) || {};
    const departCity: string = String(itin?.depart_city ?? itin?.departCity ?? '');
    const departDateText: string = String(itin?.depart_date ?? '');
    const departTimeText: string = String(itin?.depart_time ?? '');
    const arriveCity: string = String(itin?.arrive_city ?? itin?.arriveCity ?? '');
    const arriveDateText: string = String(itin?.arrive_date ?? '');
    const arriveTimeText: string = String(itin?.arrive_time ?? '');
    const holdPassengerPhone: string = String(opt?.passenger?.phone ?? opt?.contact?.phone ?? '');

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-1 sm:p-2" role="dialog" aria-modal="true">
            <div ref={modalRef} className={`w-full ${modalWidthClass} h-[90vh] max-h-[90vh]`}>
                <div className="bg-white dark:bg-gray-800 p-3 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 h-full overflow-hidden flex flex-col min-h-0">
                    <p className="text-[11px] text-gray-600 dark:text-gray-300 mb-2">
                        {details.paymentMethod === 'In-Store'
                            ? 'Your reservation is ready. Review the reservation details below, then use View/Download to open the reserved ticket. Click Finish when you are done.'
                            : 'Your booking is ready. Review the details below, then click Finish to continue.'}
                    </p>
                    {details.paymentMethod === 'In-Store' && (holdTicketLoading || holdTicketPdfLoading) && (
                        <div className="mb-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30 px-3 py-2 flex items-start gap-2" aria-live="polite">
                            <SpinnerIcon className="h-4 w-4 mt-0.5 text-[#652D8E] dark:text-purple-300 animate-spin" />
                            <div className="min-w-0">
                                <div className="text-[11px] font-semibold text-gray-700 dark:text-gray-200">
                                    {holdTicketLoading ? 'Preparing your reservation…' : 'Downloading your reserved ticket PDF…'}
                                </div>
                                <div className="text-[10px] text-gray-500 dark:text-gray-400">
                                    This can take a few seconds. Please keep this window open.
                                </div>
                            </div>
                        </div>
                    )}
                    {details.paymentMethod === 'In-Store' && holdTicketError && <p className="text-[11px] text-red-600 dark:text-red-400">{holdTicketError}</p>}
                    {details.paymentMethod === 'In-Store' && holdTicket && !holdTicketLoading && !holdTicketError && (
                        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col flex-1 min-h-0">
                            <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                                <div className="text-sm font-bold text-[#652D8E] dark:text-purple-300 truncate">Reserved Ticket</div>
                                <div className="flex items-center gap-1.5">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const pdfPnr = holdRefNo || pnr || getCartData()?.cartId;
                                            if (!pdfPnr) return;
                                            const encoded = encodeURIComponent(String(pdfPnr));
                                            window.open(`/api/ticket/pdf?pnr=${encoded}&type=hold&v=${Date.now()}#zoom=page-width`, '_blank', 'noopener,noreferrer');
                                        }}
                                        className="inline-flex items-center px-2.5 py-1 text-[10px] font-medium rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 bg-white/70 dark:bg-gray-800/60 hover:bg-gray-100 dark:hover:bg-gray-700"
                                    >
                                        View
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleDownloadHoldTicket}
                                        className="inline-flex items-center justify-center h-7 w-7 rounded-md border border-purple-200 dark:border-purple-700 text-[#652D8E] dark:text-purple-200 hover:bg-purple-100/70 dark:hover:bg-purple-800/30"
                                        title="Download ticket"
                                    >
                                        <DownloadIcon className="h-3 w-3" />
                                    </button>
                                </div>
                            </div>

                            <div className="p-3 sm:p-4 flex-1 min-h-0 overflow-y-auto">
                                <div className="rounded-xl border border-purple-200/70 dark:border-purple-900/40 bg-gradient-to-br from-purple-50 via-white to-white dark:from-purple-950/25 dark:via-gray-900 dark:to-gray-900 p-3 sm:p-4">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2">
                                                <div className="h-8 w-8 rounded-lg bg-[#652D8E] text-white flex items-center justify-center flex-shrink-0">
                                                    <TicketIcon className="h-4 w-4" />
                                                </div>
                                                <div className="min-w-0">
                                                    <div className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">Reservation code (PNR)</div>
                                                    <div className="text-lg sm:text-xl font-extrabold text-gray-900 dark:text-white tracking-wide break-words">
                                                        {holdRefNo || pnr || '—'}
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="mt-2 flex flex-wrap items-center gap-2">
                                                <span className="inline-flex items-center rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200 px-2 py-0.5 text-[10px] font-semibold">
                                                    <CheckCircleIcon className="h-3 w-3 mr-1" />
                                                    {String(holdTicket.status || 'Reserved')}
                                                </span>
                                                <span className="inline-flex items-center rounded-full bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200 px-2 py-0.5 text-[10px] font-semibold">
                                                    Seat: {holdSeatNo && holdSeatNo !== 'undefined' ? holdSeatNo : '—'}
                                                </span>
                                                <span className="inline-flex items-center rounded-full bg-purple-100 text-[#652D8E] dark:bg-purple-900/30 dark:text-purple-200 px-2 py-0.5 text-[10px] font-semibold">
                                                    {holdOperator || booking?.outbound?.busCompany || '—'}
                                                </span>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-2 flex-shrink-0">
                                            <button
                                                type="button"
                                                onClick={async () => {
                                                    const code = holdRefNo || pnr;
                                                    if (!code) return;
                                                    try {
                                                        await navigator.clipboard.writeText(code);
                                                        setCopied(true);
                                                        setTimeout(() => setCopied(false), 2000);
                                                    } catch {}
                                                }}
                                                className="inline-flex items-center px-2.5 py-1.5 text-[10px] font-semibold rounded-md border border-gray-300 dark:border-gray-600 bg-white/80 dark:bg-gray-800/70 text-gray-800 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700"
                                                title="Copy reservation code"
                                            >
                                                {copied ? 'Copied' : 'Copy'}
                                            </button>
                                        </div>
                                    </div>

                                    <div className="mt-3 text-[11px] text-gray-600 dark:text-gray-300">
                                        Use the instructions below to complete payment in-store and receive your ticket.
                                    </div>
                                </div>

                                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                                    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3">
                                        <div className="flex items-center gap-2">
                                            <div className="h-7 w-7 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-gray-500 dark:text-gray-300 flex-shrink-0">
                                                <UserCircleIcon className="h-4 w-4" />
                                            </div>
                                            <div className="text-[11px] font-bold text-gray-800 dark:text-gray-100">Passenger{hasMultiplePassengers ? 's' : ''}</div>
                                        </div>

                                        {!hasMultiplePassengers ? (
                                            <>
                                                <div className="mt-2 text-[12px] font-semibold text-gray-900 dark:text-white break-words">
                                                    {holdPassengerName || `${details.passengers?.[0]?.firstName || ''} ${details.passengers?.[0]?.lastName || ''}`.trim() || '—'}
                                                </div>

                                                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-[11px]">
                                                    <div className="min-w-0">
                                                        <div className="text-[10px] text-gray-500 dark:text-gray-400">ID</div>
                                                        <div className="font-semibold text-gray-700 dark:text-gray-200 break-words">{holdPassengerId || details.passengers?.[0]?.idNumber || '—'}</div>
                                                    </div>
                                                    <div className="min-w-0">
                                                        <div className="text-[10px] text-gray-500 dark:text-gray-400">Phone</div>
                                                        <div className="font-semibold text-gray-700 dark:text-gray-200 break-words">{holdPassengerPhone || details.contactInfo?.phone || '—'}</div>
                                                    </div>
                                                    <div className="col-span-2 min-w-0">
                                                        <div className="text-[10px] text-gray-500 dark:text-gray-400">Booked by</div>
                                                        <div className="font-semibold text-gray-700 dark:text-gray-200 break-words">{holdBookedBy || '—'}</div>
                                                    </div>
                                                </div>
                                            </>
                                        ) : (
                                            <>
                                                <div className="mt-2 flex items-center justify-between gap-2">
                                                    <div className="text-[11px] text-gray-600 dark:text-gray-300">
                                                        {passengerCount} passengers on this booking
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => setShowAllPassengers((v) => !v)}
                                                        className="text-[10px] font-semibold text-[#652D8E] dark:text-purple-300 hover:underline"
                                                    >
                                                        {showAllPassengers ? 'Show less' : 'Show all'}
                                                    </button>
                                                </div>

                                                <div className="mt-2 space-y-2">
                                                    {(showAllPassengers ? details.passengers : details.passengers.slice(0, 1)).map((p, i) => (
                                                        <PassengerDetailsCard key={`${p.firstName}-${p.lastName}-${i}`} passenger={p} index={i} />
                                                    ))}
                                                </div>

                                                <div className="mt-2 grid grid-cols-1 gap-y-2 text-[11px]">
                                                    <div className="min-w-0">
                                                        <div className="text-[10px] text-gray-500 dark:text-gray-400">Contact phone</div>
                                                        <div className="font-semibold text-gray-700 dark:text-gray-200 break-words">{holdPassengerPhone || details.contactInfo?.phone || '—'}</div>
                                                    </div>
                                                    <div className="min-w-0">
                                                        <div className="text-[10px] text-gray-500 dark:text-gray-400">Booked by</div>
                                                        <div className="font-semibold text-gray-700 dark:text-gray-200 break-words">{holdBookedBy || '—'}</div>
                                                    </div>
                                                </div>
                                            </>
                                        )}
                                    </div>

                                    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3">
                                        <div className="flex items-center justify-between gap-3">
                                            <div className="flex items-center gap-2">
                                                <div className="h-7 w-7 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-gray-500 dark:text-gray-300 flex-shrink-0">
                                                    <LocationIcon className="h-4 w-4" />
                                                </div>
                                                <div className="text-[11px] font-bold text-gray-800 dark:text-gray-100">Trip</div>
                                            </div>
                                            {holdQr && (
                                                <img
                                                    src={holdQr}
                                                    alt="QR"
                                                    className="h-16 w-16 rounded-lg border border-gray-200 dark:border-gray-700 bg-white flex-shrink-0"
                                                />
                                            )}
                                        </div>

                                        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                                            <div className="min-w-0">
                                                <div className="text-[10px] text-gray-500 dark:text-gray-400">Departure</div>
                                                <div className="font-semibold text-gray-700 dark:text-gray-200 break-words">{departCity || booking?.outbound?.origin || '—'}</div>
                                                <div className="text-[11px] text-gray-600 dark:text-gray-300">{[departDateText, departTimeText].filter(Boolean).join(' ') || booking?.outbound?.departureTime || ''}</div>
                                            </div>
                                            <div className="min-w-0">
                                                <div className="text-[10px] text-gray-500 dark:text-gray-400">Arrival</div>
                                                <div className="font-semibold text-gray-700 dark:text-gray-200 break-words">{arriveCity || booking?.outbound?.destination || '—'}</div>
                                                <div className="text-[11px] text-gray-600 dark:text-gray-300">{[arriveDateText, arriveTimeText].filter(Boolean).join(' ') || booking?.outbound?.arrivalTime || ''}</div>
                                            </div>
                                        </div>

                                        <div className="mt-3 flex items-end justify-between gap-3">
                                            <div className="text-[10px] text-gray-500 dark:text-gray-400">
                                                {booking?.inbound ? 'Round trip' : 'One way'}
                                            </div>
                                            <div className="text-right">
                                                <div className="text-[10px] text-gray-500 dark:text-gray-400">Price</div>
                                                <div className="text-base font-extrabold text-[#652D8E] dark:text-purple-300">
                                                    {holdPrice || (booking?.outbound && (booking.outbound as any).price ? `$${Number((booking.outbound as any).price).toFixed(2)}` : '—')}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                    {details.paymentMethod === 'In-Store' && !holdTicket && !holdTicketLoading && !holdTicketError && (
                        <p className="text-[11px] text-gray-500 dark:text-gray-400">
                            No ticket found yet for this reservation.
                        </p>
                    )}

                    <div className="mt-3 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="w-full sm:w-auto text-[#652D8E] border border-[#652D8E] font-semibold py-2 px-4 rounded-md hover:bg-[#652D8E]/10 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#652D8E] dark:text-purple-300 dark:border-purple-300 dark:hover:bg-purple-300/10 dark:focus:ring-offset-gray-800"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={handleFinish}
                            className="w-full sm:w-auto bg-[#652D8E] dark:bg-purple-600 text-white font-semibold py-2 px-4 rounded-md hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#652D8E] dark:focus:ring-offset-gray-800"
                        >
                            Finish
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default PaymentConfirmationModal;