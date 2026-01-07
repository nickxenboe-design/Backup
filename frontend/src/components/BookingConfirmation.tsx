import React, { useEffect, useMemo, useState } from 'react';
import jsPDF from 'jspdf';
import { getHoldTicketsByPnr, sendEmailNotification, timestampToISO, timestampToLocaleTime } from '@/utils/api';
import type { BusRoute, SearchQuery } from '@/utils/api';
import type { BookingDetails } from '@/types';
import { AtSymbolIcon, ArrowRightIcon, CheckCircleIcon, ClipboardCheckIcon, ClipboardCopyIcon, ClockIcon, DownloadIcon, PhoneIcon, PrinterIcon, ShareIcon, StoreIcon, TicketIcon } from './icons';

interface BookingConfirmationProps {
    booking: { outbound: BusRoute; inbound: BusRoute | null };
    query: SearchQuery;
    details: BookingDetails;
    onNewBooking: () => void;
    onViewTickets?: () => void;
    pnr?: string;
}

const BookingConfirmation: React.FC<BookingConfirmationProps> = ({ booking, query, details, onNewBooking, onViewTickets, pnr }) => {
    const isInStorePayment = (details.paymentMethod || '').toLowerCase() === 'in-store';
    const passengerCount = Array.isArray(details.passengers) ? details.passengers.length : 0;
    const [copied, setCopied] = useState(false);
    const [emailSending, setEmailSending] = useState(false);
    const [emailResult, setEmailResult] = useState<{ ok: boolean; message: string } | null>(null);
    const [inStoreExpiryText, setInStoreExpiryText] = useState<string>('');

    const reservationRef = (pnr || '').trim();
    const deadlineHours = useMemo(() => {
        const raw = (import.meta as any)?.env?.VITE_INSTORE_PAYMENT_DEADLINE_HOURS;
        const n = Number(raw);
        return Number.isFinite(n) && n > 0 ? n : 12;
    }, []);
    const supportEmail = useMemo(() => {
        return String((import.meta as any)?.env?.VITE_SUPPORT_EMAIL || 'support@nationaltickets.co.za');
    }, []);

    const supportPhone = useMemo(() => {
        const v = (import.meta as any)?.env?.VITE_SUPPORT_PHONE;
        return v ? String(v) : '';
    }, []);
    const supportWhatsapp = useMemo(() => {
        const v = (import.meta as any)?.env?.VITE_SUPPORT_WHATSAPP;
        return v ? String(v) : '';
    }, []);
    const supportWhatsappDigits = useMemo(() => {
        return supportWhatsapp.replace(/\D/g, '');
    }, [supportWhatsapp]);

    const formatExpiryDateTime = (value: any): string | null => {
        if (!value) return null;
        try {
            const d = value && typeof value === 'object' && (value._seconds || value.seconds)
                ? new Date(((value._seconds || value.seconds) as number) * 1000 + Number(value._nanoseconds || value.nanoseconds || 0) / 1000000)
                : new Date(value);
            if (Number.isNaN(d.getTime())) return null;
            return d.toLocaleString(undefined, {
                year: 'numeric',
                month: 'short',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
            });
        } catch {
            return null;
        }
    };

    useEffect(() => {
        if (!isInStorePayment) return;
        if (!reservationRef) return;

        let cancelled = false;
        (async () => {
            try {
                const response = await getHoldTicketsByPnr(reservationRef);
                const tickets = Array.isArray(response?.tickets) ? response.tickets : [];
                const hold = tickets.find((t: any) => t?.isHold) || tickets[0] || null;
                const opt: any = hold?.options || {};

                const rawExpiry =
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

                const formatted = formatExpiryDateTime(rawExpiry);
                if (!cancelled && formatted) {
                    setInStoreExpiryText(formatted);
                }
            } catch {
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [isInStorePayment, reservationRef]);

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

    const formatDate = (ymd?: string) => {
        if (!ymd) return '';
        const iso = timestampToISO(`${ymd}T00:00:00`);
        if (!iso) return ymd;
        try {
            const d = new Date(iso);
            return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        } catch {
            return ymd;
        }
    };

    const addDaysToYmd = (ymd: string, days: number) => {
        try {
            const d = new Date(`${ymd}T00:00:00`);
            d.setDate(d.getDate() + days);
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            return `${yyyy}-${mm}-${dd}`;
        } catch {
            return ymd;
        }
    };

    const returnTripUrl = useMemo(() => {
        const depart = query?.departureDate ? addDaysToYmd(query.departureDate, 1) : '';
        const adults = Math.max(1, Number(query?.passengers?.adults || 1));
        const children = Math.max(0, Number(query?.passengers?.children || 0));
        if (!query?.origin || !query?.destination || !depart) return '';
        const params = new URLSearchParams({
            origin: query.destination,
            destination: query.origin,
            departureDate: depart,
            tripType: 'one-way',
            adults: String(adults),
            children: String(children),
        });
        return `/?${params.toString()}`;
    }, [query?.origin, query?.destination, query?.departureDate, query?.passengers?.adults, query?.passengers?.children]);

    const showReturnTripCta = Boolean(query?.tripType !== 'round-trip' && returnTripUrl);

    const handleCopyRef = async () => {
        if (!reservationRef) return;
        try {
            await navigator.clipboard.writeText(reservationRef);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
        } catch {
            try {
                const el = document.createElement('textarea');
                el.value = reservationRef;
                document.body.appendChild(el);
                el.select();
                document.execCommand('copy');
                document.body.removeChild(el);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
            } catch {}
        }
    };

    const handleResendEmail = async () => {
        if (!reservationRef) return;
        setEmailSending(true);
        setEmailResult(null);
        try {
            const res = await sendEmailNotification(reservationRef);
            setEmailResult({ ok: !!res.success, message: res.message || (res.success ? 'Email sent.' : 'Email could not be sent.') });
        } catch (e: any) {
            setEmailResult({ ok: false, message: e?.message || 'Email could not be sent.' });
        } finally {
            setEmailSending(false);
        }
    };

    const buildShareText = () => {
        const from = booking.outbound?.origin || query.origin;
        const to = booking.outbound?.destination || query.destination;
        const dateText = formatDate(query.departureDate);
        const depart = timestampToLocaleTime(booking.outbound?.departureTime);
        const arrive = timestampToLocaleTime(booking.outbound?.arrivalTime);
        const operator = booking.outbound?.busCompany || '';
        const pax = passengerCount ? `${passengerCount} Passenger${passengerCount === 1 ? '' : 's'}` : 'Passengers';
        return [
            'Booking successful',
            `${from} → ${to}`,
            `${dateText} • ${depart} – ${arrive}`,
            `${pax}${operator ? ` • ${operator}` : ''}`,
            reservationRef ? `Reservation Ref: ${reservationRef}` : undefined,
        ].filter(Boolean).join('\n');
    };

    const handleWhatsappShare = () => {
        const text = buildShareText();
        const base = supportWhatsappDigits ? `https://wa.me/${supportWhatsappDigits}` : 'https://wa.me/';
        const url = supportWhatsappDigits
            ? `${base}?text=${encodeURIComponent(text)}`
            : `https://wa.me/?text=${encodeURIComponent(text)}`;
        window.open(url, '_blank', 'noopener,noreferrer');
    };

    const handleDownloadReservationPdf = () => {
        if (!reservationRef) return;

        const from = booking.outbound?.origin || query.origin;
        const to = booking.outbound?.destination || query.destination;
        const dateText = formatDate(query.departureDate);
        const depart = timestampToLocaleTime(booking.outbound?.departureTime);
        const arrive = timestampToLocaleTime(booking.outbound?.arrivalTime);
        const operator = booking.outbound?.busCompany || '';
        const pax = passengerCount ? `${passengerCount} Passenger${passengerCount === 1 ? '' : 's'}` : '';

        const doc = new jsPDF();
        doc.setFontSize(14);
        doc.text('Reservation Confirmation', 10, 14);
        doc.setFontSize(11);
        doc.text(`Reservation Ref: ${reservationRef}`, 10, 28);
        doc.text(`${from} → ${to}`, 10, 40);
        doc.text(`${dateText} • ${depart} – ${arrive}`, 10, 48);
        if (operator) doc.text(`Operator: ${operator}`, 10, 56);
        if (pax) doc.text(`Passengers: ${pax}`, 10, 64);
        doc.text(`Email: ${details.contactInfo.email || '—'}`, 10, 76);

        if (isInStorePayment) {
            const expiryText = inStoreExpiryText || fallbackExpiryText;
            doc.setFontSize(11);
            doc.text('Pay In-Store', 10, 92);

            doc.setFontSize(12);
            doc.setFont(undefined, 'bold');
            doc.text(
                `Your booking has an outstanding balance, please process payment before ${expiryText || 'the expiry time shown on your reserved ticket'} to secure your booking.`,
                10,
                102,
                { maxWidth: 190 }
            );
            doc.setFont(undefined, 'normal');
            doc.setFontSize(10);
            doc.text('Bring a valid ID and your reservation reference.', 10, 124);
            doc.text(`Support: ${supportEmail}`, 10, 132);
        }

        doc.save(`reservation-${reservationRef}.pdf`);
    };

    return (
        <div className="max-w-xl mx-auto animate-fade-in py-6">
            <div className="text-center" aria-live="polite">
                <CheckCircleIcon className="h-10 w-10 text-green-600 mx-auto" aria-hidden="true" />
                <h1 className="mt-3 text-xl font-bold text-[#652D8E] dark:text-purple-300 tracking-tight">
                    Booking Successful
                </h1>
                <p className="mt-1.5 text-[13px] text-gray-700 dark:text-gray-200">
                    Have a safe and pleasant journey.
                </p>
                <p className="mt-2 text-[12px] text-gray-600 dark:text-gray-300">
                    Confirmation email: <span className="font-semibold">{details.contactInfo.email}</span>
                </p>
            </div>

            <div className="mt-4 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm p-3">
                <div className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400 font-semibold">
                    Booking summary
                </div>
                <div className="mt-1 text-sm font-bold text-gray-900 dark:text-gray-100 break-words">
                    {booking.outbound?.origin || query.origin} → {booking.outbound?.destination || query.destination}
                </div>
                <div className="mt-1 text-[12px] text-gray-700 dark:text-gray-200">
                    {formatDate(query.departureDate)} • {timestampToLocaleTime(booking.outbound?.departureTime)} – {timestampToLocaleTime(booking.outbound?.arrivalTime)}
                </div>
                <div className="mt-1 text-[12px] text-gray-700 dark:text-gray-200">
                    {passengerCount ? `${passengerCount} Passenger${passengerCount === 1 ? '' : 's'}` : 'Passengers'} • {booking.outbound?.busCompany || 'Operator'}
                </div>

                <div className="mt-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30 p-3">
                    <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                            <div className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400 font-semibold">
                                Reservation reference
                            </div>
                            <div className="mt-1 font-mono text-[15px] font-extrabold text-gray-900 dark:text-gray-100 tracking-wider break-all">
                                {reservationRef || '—'}
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={handleCopyRef}
                            disabled={!reservationRef}
                            className="inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-60 disabled:cursor-not-allowed"
                            aria-label="Copy reservation reference"
                            title="Copy"
                        >
                            {copied ? <ClipboardCheckIcon className="h-4 w-4 text-green-600" /> : <ClipboardCopyIcon className="h-4 w-4" />}
                            <span className="text-xs font-semibold">{copied ? 'Copied' : 'Copy'}</span>
                        </button>
                    </div>
                </div>
            </div>

            {isInStorePayment ? (
                <div className="mt-3 rounded-2xl border border-purple-200 dark:border-purple-700 bg-purple-50 dark:bg-purple-900/20 p-3">
                    <div className="flex items-center gap-2">
                        <StoreIcon className="h-4 w-4 text-[#652D8E] dark:text-purple-300" />
                        <div className="text-sm font-bold text-[#652D8E] dark:text-purple-300">
                            How to Pay In-Store
                        </div>
                    </div>
                    <div className="mt-2 text-[15px] sm:text-[16px] font-extrabold text-purple-900 dark:text-purple-100">
                        Your booking has an outstanding balance, please process payment before {inStoreExpiryText || fallbackExpiryText || 'the expiry time shown on your reserved ticket'} to secure your booking.
                    </div>

                    <ol className="mt-2 list-decimal pl-5 space-y-1 text-[12px] text-gray-700 dark:text-gray-200">
                        <li>Present Ref No: {reservationRef || '—'} to teller.</li>
                        <li>Pay at any TM Pick n Pay BancABC kiosk.</li>
                        <li>Obtain your printed receipt and confirmation.</li>
                        <li>Check your email for your official e-ticket.</li>
                        <li>Support &amp; Payments: {supportEmail}. WhatsApp: +263 783 911 611.</li>
                    </ol>
                </div>
            ) : null}

            <div className="mt-3 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm p-3">
                <div className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400 font-semibold">
                    What happens next
                </div>
                <div className="mt-2 grid grid-cols-1 gap-2 text-[12px]">
                    <div className="flex items-center gap-2 text-gray-800 dark:text-gray-100">
                        <CheckCircleIcon className="h-4 w-4 text-green-600" />
                        <span className="font-semibold">Booking confirmed</span>
                    </div>
                    <div className="flex items-center gap-2 text-gray-700 dark:text-gray-200">
                        <ClockIcon className="h-4 w-4 text-gray-500" />
                        <span>{isInStorePayment ? 'Pay in-store' : 'Tickets ready'}</span>
                    </div>
                    <div className="flex items-center gap-2 text-gray-700 dark:text-gray-200">
                        <TicketIcon className="h-4 w-4 text-gray-500" />
                        <span>Ticket issued</span>
                    </div>
                    <div className="flex items-center gap-2 text-gray-700 dark:text-gray-200">
                        <ArrowRightIcon className="h-4 w-4 text-gray-500" />
                        <span>Travel day</span>
                    </div>
                </div>
            </div>

            {!isInStorePayment ? (
                <div className="mt-3 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm p-3">
                    <div className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400 font-semibold">
                        Helpful actions
                    </div>
                    <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <button
                            type="button"
                            onClick={handleResendEmail}
                            disabled={!reservationRef || emailSending}
                            className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 py-2 px-3 text-xs font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                            <AtSymbolIcon className="h-4 w-4" />
                            <span>{emailSending ? 'Sending…' : 'Resend email'}</span>
                        </button>
                        <button
                            type="button"
                            onClick={handleWhatsappShare}
                            disabled={!reservationRef}
                            className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 py-2 px-3 text-xs font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                            <ShareIcon className="h-4 w-4" />
                            <span>Send via WhatsApp</span>
                        </button>
                        <button
                            type="button"
                            onClick={handleDownloadReservationPdf}
                            disabled={!reservationRef}
                            className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 py-2 px-3 text-xs font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                            <DownloadIcon className="h-4 w-4" />
                            <span>Download PDF</span>
                        </button>
                    </div>
                    {emailResult ? (
                        <div className={`mt-2 text-[11px] ${emailResult.ok ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'}`}>
                            {emailResult.message}
                        </div>
                    ) : null}
                </div>
            ) : null}

            <div className="mt-4 text-center flex flex-col sm:flex-row items-center justify-center gap-2">
                <button
                    type="button"
                    onClick={() => {
                        if (onViewTickets) {
                            onViewTickets();
                        } else {
                            window.print();
                        }
                    }}
                    className="inline-flex items-center justify-center gap-2 w-full sm:w-auto text-[#652D8E] border-2 border-[#652D8E] font-bold py-2 px-3 rounded-lg hover:bg-[#652D8E]/10 transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#652D8E] dark:text-purple-300 dark:border-purple-300 dark:hover:bg-purple-300/10 dark:focus:ring-offset-gray-950 transform hover:scale-105 text-xs"
                >
                    {onViewTickets ? <TicketIcon className="h-4 w-4" /> : <PrinterIcon className="h-4 w-4" />}
                    <span>
                        {isInStorePayment ? 'View reservation' : (onViewTickets ? 'View ticket(s)' : 'Get Ticket(s)')}
                    </span>
                </button>

                {showReturnTripCta ? (
                    <button
                        type="button"
                        onClick={() => {
                            window.location.href = returnTripUrl;
                        }}
                        className="inline-flex items-center justify-center gap-2 w-full sm:w-auto text-[#652D8E] border-2 border-[#652D8E] font-bold py-2 px-3 rounded-lg hover:bg-[#652D8E]/10 transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#652D8E] dark:text-purple-300 dark:border-purple-300 dark:hover:bg-purple-300/10 dark:focus:ring-offset-gray-950 transform hover:scale-105 text-xs"
                    >
                        <ArrowRightIcon className="h-4 w-4" />
                        <span>Book return trip</span>
                    </button>
                ) : null}

                <button
                    onClick={onNewBooking}
                    className="btn-primary inline-flex items-center justify-center gap-2 w-full sm:w-auto py-2 px-3 transform hover:scale-105 shadow-lg text-xs"
                >
                    <span>Book another trip</span>
                    <ArrowRightIcon className="h-4 w-4" />
                </button>
            </div>

            <div className="mt-4 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm p-3">
                <div className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400 font-semibold">
                    Need help?
                </div>
                <div className="mt-2 grid grid-cols-1 gap-1.5 text-[12px] text-gray-700 dark:text-gray-200">
                    <a href={`mailto:${supportEmail}`} className="inline-flex items-center gap-2 hover:opacity-80">
                        <AtSymbolIcon className="h-4 w-4 text-gray-500" />
                        <span>{supportEmail}</span>
                    </a>
                    {supportPhone ? (
                        <a href={`tel:${supportPhone}`} className="inline-flex items-center gap-2 hover:opacity-80">
                            <PhoneIcon className="h-4 w-4 text-gray-500" />
                            <span>{supportPhone}</span>
                        </a>
                    ) : null}
                    {supportWhatsappDigits ? (
                        <a href={`https://wa.me/${supportWhatsappDigits}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 hover:opacity-80">
                            <ShareIcon className="h-4 w-4 text-gray-500" />
                            <span>WhatsApp support</span>
                        </a>
                    ) : null}
                </div>
            </div>
        </div>
    );
};

export default BookingConfirmation;