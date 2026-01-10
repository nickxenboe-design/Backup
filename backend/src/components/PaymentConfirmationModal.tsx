import React, { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import jsPDF from 'jspdf';
import { BusRoute, SearchQuery, getCartData, getHoldTicketsByPnr } from '@/utils/api';
import { BookingDetails, Passenger } from '@/types';
import { CheckCircleIcon, ArrowRightIcon, UserCircleIcon, AtSymbolIcon, CreditCardIcon, PayPalIcon, GooglePayIcon, StoreIcon, CalendarIcon, LocationIcon, TicketIcon, ShareIcon, DownloadIcon } from './icons';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface PaymentConfirmationModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
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

const generatePnrPdfBlob = (pnr: string) => {
    const doc = new jsPDF();

    doc.setFontSize(16);
    doc.text('Reservation (PNR)', 10, 15);

    doc.setFontSize(12);
    doc.text(`Reservation Code: ${pnr}`, 10, 30);

    doc.setFontSize(10);
    doc.text(
        'Use this code at any Pick n Pay store to purchase and collect your tickets.',
        10,
        40,
        { maxWidth: 190 }
    );

    return doc.output('blob');
};

const PaymentConfirmationModal: React.FC<PaymentConfirmationModalProps> = ({ isOpen, onClose, onConfirm, booking, query, details, pnr, maxWidth }) => {
    const modalRef = useRef<HTMLDivElement>(null);
    const pdfContainerRef = useRef<HTMLDivElement>(null);
    const pdfCanvasRef = useRef<HTMLCanvasElement>(null);
    const [copied, setCopied] = useState(false);
    const [showAllPassengers, setShowAllPassengers] = useState(false);
    const [holdTicket, setHoldTicket] = useState<CartTicket | null>(null);
    const [holdTicketLoading, setHoldTicketLoading] = useState(false);
    const [holdTicketError, setHoldTicketError] = useState<string | null>(null);
    const [holdTicketPdfUrl, setHoldTicketPdfUrl] = useState<string | null>(null);
    const [holdPdfPreviewLoading, setHoldPdfPreviewLoading] = useState(false);
    const [holdPdfPreviewError, setHoldPdfPreviewError] = useState<string | null>(null);

    useEffect(() => {
        if (!isOpen || details.paymentMethod !== 'In-Store') {
            setHoldTicket(null);
            setHoldTicketError(null);
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

    const handleSharePnr = async () => {
        if (!pnr) return;

        const blob = generatePnrPdfBlob(pnr);
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
        const blob = generatePnrPdfBlob(pnr);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `reservation-${pnr}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleDownloadHoldTicket = () => {
        if (!holdTicketPdfUrl) return;
        const a = document.createElement('a');
        a.href = holdTicketPdfUrl;
        a.download = `reserved-ticket-${holdTicket?.options?.ticket?.ref_no || holdTicket?.id || 'ticket'}.pdf`;
        a.click();
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

    useEffect(() => {
        if (!holdTicket || holdTicketLoading) {
            setHoldTicketPdfUrl((prev) => {
                if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
                return null;
            });
            return;
        }

        const pdfPnr = holdRefNo || pnr || getCartData()?.cartId;
        if (!pdfPnr) return;

        const controller = new AbortController();

        const loadPdf = async () => {
            try {
                setHoldTicketError(null);
                setHoldPdfPreviewError(null);
                const response = await fetch(`/api/ticket/hold/pdf/${pdfPnr}`, {
                    signal: controller.signal,
                });
                if (!response.ok) {
                    throw new Error(`Failed to load PDF (status ${response.status})`);
                }
                const contentType = response.headers.get('content-type') || '';
                if (!contentType.toLowerCase().includes('application/pdf')) {
                    throw new Error('Unexpected content type for PDF');
                }
                const blob = await response.blob();
                const objectUrl = URL.createObjectURL(blob);
                setHoldTicketPdfUrl((prev) => {
                    if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
                    return objectUrl;
                });
            } catch (err: any) {
                if (controller.signal.aborted) return;
                console.error('Failed to load reserved ticket PDF', err);
                setHoldTicketError('Failed to open reserved ticket PDF. Please try again or download it instead.');
                setHoldTicketPdfUrl((prev) => {
                    if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
                    return null;
                });
            }
        };

        loadPdf();

        return () => {
            controller.abort();
            setHoldTicketPdfUrl((prev) => {
                if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
                return null;
            });
        };
    }, [holdTicket, holdTicketLoading, holdRefNo, pnr]);

    useEffect(() => {
        if (!isOpen) return;
        if (!holdTicketPdfUrl) return;

        let cancelled = false;
        let rafId: number | null = null;
        let activeRenderTask: any | null = null;
        let pdfLoadingTask: any | null = null;
        let pdfDoc: any | null = null;
        let attempts = 0;
        let rendering = false;
        let rendered = false;

        const ensurePdf = async () => {
            if (pdfDoc) return pdfDoc;
            if (pdfLoadingTask) return await pdfLoadingTask.promise;

            pdfLoadingTask = getDocument({ url: holdTicketPdfUrl });
            try {
                pdfDoc = await pdfLoadingTask.promise;
                return pdfDoc;
            } catch (e) {
                pdfLoadingTask = null;
                pdfDoc = null;
                throw e;
            }
        };

        const renderOnce = async () => {
            const containerEl = pdfContainerRef.current;
            const canvasEl = pdfCanvasRef.current;
            if (!containerEl || !canvasEl) return;

            if (rendered || rendering) return;
            rendering = true;

            // If a previous render is still using this canvas, cancel it before starting a new one.
            if (activeRenderTask) {
                try {
                    activeRenderTask.cancel();
                } catch (_) {
                    // ignore
                }
                try {
                    await activeRenderTask.promise;
                } catch (_) {
                    // ignore expected cancellation
                }
                activeRenderTask = null;
            }

            setHoldPdfPreviewLoading(true);
            setHoldPdfPreviewError(null);

            try {
                const pdf = await ensurePdf();
                if (cancelled) return;
                const page = await pdf.getPage(1);
                if (cancelled) return;

                const containerWidth = Math.max(1, containerEl.getBoundingClientRect().width);
                const viewportAt1 = page.getViewport({ scale: 1 });
                const isInStore = details.paymentMethod === 'In-Store';
                const cropX = isInStore ? 0.08 : 0;
                const cropY = 0;
                const cropLeft = viewportAt1.width * cropX;
                const cropTop = viewportAt1.height * cropY;
                const cropWidth = Math.max(1, viewportAt1.width - cropLeft * 2);
                const cropHeight = Math.max(1, viewportAt1.height - cropTop * 2);

                const fitScale = containerWidth / cropWidth;
                const displayScale = fitScale;
                const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1;
                const viewport = page.getViewport({ scale: displayScale * dpr });

                const ctx = canvasEl.getContext('2d');
                if (!ctx) throw new Error('Canvas not supported');

                canvasEl.width = Math.floor(cropWidth * displayScale * dpr);
                canvasEl.height = Math.floor(cropHeight * displayScale * dpr);
                canvasEl.style.width = '100%';
                canvasEl.style.height = `${Math.max(1, Math.floor(cropHeight * displayScale))}px`;

                activeRenderTask = page.render({
                    canvasContext: ctx,
                    viewport,
                    transform: [1, 0, 0, 1, -cropLeft * displayScale * dpr, -cropTop * displayScale * dpr],
                });
                try {
                    await activeRenderTask.promise;
                } finally {
                    activeRenderTask = null;
                }

                rendered = true;
            } catch (e: any) {
                if (cancelled) return;
                if (e?.name === 'RenderingCancelledException') return;
                if (String(e?.message || '').toLowerCase().includes('rendering cancelled')) return;
                setHoldPdfPreviewError(e?.message || 'Failed to render PDF preview');
            } finally {
                rendering = false;
                if (!cancelled) setHoldPdfPreviewLoading(false);
            }
        };

        const schedule = () => {
            if (cancelled) return;

            if (rafId) cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(() => {
                rafId = null;
                const el = pdfContainerRef.current;
                const canvasEl = pdfCanvasRef.current;
                const w = el ? Math.round(el.getBoundingClientRect().width) : 0;
                if (!el || !canvasEl || w < 50) {
                    if (attempts < 240) {
                        attempts += 1;
                        schedule();
                    }
                    return;
                }
                renderOnce();
            });
        };

        schedule();

        return () => {
            cancelled = true;
            if (rafId) cancelAnimationFrame(rafId);
            if (activeRenderTask) {
                try {
                    activeRenderTask.cancel();
                } catch (_) {
                    // ignore
                }
            }
            if (pdfLoadingTask) {
                try {
                    pdfLoadingTask.destroy();
                } catch (_) {
                    // ignore
                }
            }
            if (pdfDoc) {
                try {
                    pdfDoc.destroy();
                } catch (_) {
                    // ignore
                }
            }
        };
    }, [isOpen, holdTicketPdfUrl, details.paymentMethod]);

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-1 sm:p-2" role="dialog" aria-modal="true">
            <div ref={modalRef} className={`w-full ${modalWidthClass} h-[90vh] max-h-[90vh]`}>
                <div className="bg-white dark:bg-gray-800 p-3 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 h-full overflow-hidden flex flex-col min-h-0">
                    <p className="text-[11px] text-gray-600 dark:text-gray-300 mb-2">
                        {details.paymentMethod === 'In-Store'
                            ? 'Your reservation is ready. Preview your reserved ticket below, then use View/Download to save it. Click Finish when you are done.'
                            : 'Your booking is ready. Review the details below, then click Finish to continue.'}
                    </p>
                    {holdTicketLoading && <p className="text-[11px] text-gray-500 dark:text-gray-400">Loading reserved ticket...</p>}
                    {holdTicketError && <p className="text-[11px] text-red-600 dark:text-red-400">{holdTicketError}</p>}
                    {holdTicket && !holdTicketLoading && !holdTicketError && holdTicketPdfUrl && (
                        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col flex-1 min-h-0">
                            <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                                <div className="text-sm font-bold text-[#652D8E] dark:text-purple-300 truncate">Reserved Ticket</div>
                                <div className="flex items-center gap-1.5">
                                    <button
                                        type="button"
                                        onClick={() => window.open(holdTicketPdfUrl, '_blank', 'noopener,noreferrer')}
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

                            <div className="p-2 flex-1 min-h-0 overflow-hidden">
                                <div ref={pdfContainerRef} className="relative border border-gray-200 dark:border-gray-700 rounded-lg overflow-y-auto overflow-x-hidden h-full bg-white dark:bg-gray-900/40">
                                    <canvas ref={pdfCanvasRef} className="w-full h-auto block" />
                                    {holdPdfPreviewError && (
                                        <div className="absolute inset-0 flex items-center justify-center p-3 text-[11px] text-red-600 dark:text-red-400 bg-white/80 dark:bg-gray-900/70">
                                            {holdPdfPreviewError}
                                        </div>
                                    )}
                                    {holdPdfPreviewLoading && (
                                        <div className="absolute inset-0 flex items-center justify-center text-[11px] text-gray-500 dark:text-gray-400 bg-white/70 dark:bg-gray-900/60">
                                            Rendering preview...
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                    {!holdTicket && !holdTicketLoading && !holdTicketError && (
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
                            onClick={onConfirm}
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