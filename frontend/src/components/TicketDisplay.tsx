import React, { useState, useEffect } from 'react';
import { getTicket, getTicketsByCart } from '@/utils/api';
import { mapTripErrorToUserMessage } from '@/utils/errorMessages';
import { ClipboardCopyIcon, ClipboardCheckIcon, TicketIcon, PrinterIcon } from './icons';

const DEFAULT_TICKET_LOGO_SRC = '/ticket-logo.png';

interface Ticket {
  id: string;
  cartId: string;
  options?: any;
  status: string;
  updatedAt: string;
}

const getTicketReference = (ticket: Ticket): string | null => {
  const options = ticket.options;
  if (!options || typeof options !== 'object') return null;

  const keys = ['pnr', 'PNR', 'reference', 'referenceNumber', 'bookingReference', 'ticketNumber', 'ticketNo'];
  for (const key of keys) {
    const value = (options as any)[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }

  return null;
};

interface TicketViewModel {
  ticketNo?: string;
  refNo?: string;
  seatNo?: string;
  price?: string;
  bookedBy?: string;
  uuid?: string;
  passengerName?: string;
  passengerPhone?: string;
  departCity?: string;
  departDate?: string;
  departTime?: string;
  arriveCity?: string;
  arriveDate?: string;
  arriveTime?: string;
  contactPhone?: string;
  qrDataUrl?: string;
  logoSrc?: string;
}

const buildTicketViewModel = (ticket: Ticket): TicketViewModel => {
  const options = ticket && ticket.options && typeof ticket.options === 'object' ? (ticket.options as any) : ({} as any);
  const ticketNode = (options.ticket || options.ticketInfo || options.ticketDetails || {}) as any;
  const passengerNode = (options.passenger || options.passengerInfo || options.traveller || {}) as any;
  const itineraryNode = (options.itinerary || options.trip || options.segment || {}) as any;
  const contactNode = (options.contact || {}) as any;

  const qrDataUrl =
    options.qrDataUrl ||
    options.qr ||
    options.qr_url ||
    options.qrCodeUrl ||
    null;

  const logoBase64 =
    (options.assets && options.assets.logoBase64) ||
    options.logoBase64 ||
    options.logo ||
    null;

  const refFromHelper = getTicketReference(ticket);

  const refNo =
    (ticketNode.ref_no || ticketNode.refNo || ticketNode.reference || ticketNode.referenceNumber) ||
    options.ref_no ||
    options.refNo ||
    refFromHelper ||
    null;

  const ticketNo =
    (ticketNode.ticket_no || ticketNode.ticketNo || ticketNode.ticket_number) ||
    options.ticket_no ||
    options.ticketNo ||
    ticket.id ||
    null;

  const seatNo =
    (ticketNode.seat_no || ticketNode.seatNo || ticketNode.seat) ||
    options.seat_no ||
    options.seatNo ||
    passengerNode.seat ||
    passengerNode.seat_no ||
    passengerNode.seatNo ||
    null;

  let price: string | null =
    ticketNode.price ||
    options.price ||
    options.unitPriceText ||
    null;

  if (!price && typeof options.priceAmount === 'number') {
    const cur = options.priceCurrency || options.currency || 'USD';
    const amount = options.priceAmount;
    price = `${typeof amount === 'number' && Number.isFinite(amount) ? amount.toFixed(2) : amount} ${cur}`;
  }

  const bookedBy =
    ticketNode.booked_by ||
    ticketNode.bookedBy ||
    options.booked_by ||
    options.bookedBy ||
    'online';

  const uuid =
    ticketNode.uuid ||
    ticketNode.ticket_uuid ||
    ticketNode.ticketUuid ||
    options.uuid ||
    null;

  const passengerName =
    passengerNode.name ||
    passengerNode.fullName ||
    [passengerNode.first_name || passengerNode.firstName, passengerNode.last_name || passengerNode.lastName]
      .filter(Boolean)
      .join(' ') ||
    null;

  const passengerPhone =
    passengerNode.phone ||
    passengerNode.phoneNumber ||
    options.passengerPhone ||
    null;

  const departCity =
    itineraryNode.depart_city ||
    itineraryNode.departCity ||
    itineraryNode.origin ||
    itineraryNode.from ||
    null;

  const departDate =
    itineraryNode.depart_date ||
    itineraryNode.departDate ||
    null;

  const departTime =
    itineraryNode.depart_time ||
    itineraryNode.departTime ||
    itineraryNode.depart_time_str ||
    null;

  const arriveCity =
    itineraryNode.arrive_city ||
    itineraryNode.arriveCity ||
    itineraryNode.destination ||
    itineraryNode.to ||
    null;

  const arriveDate =
    itineraryNode.arrive_date ||
    itineraryNode.arriveDate ||
    null;

  const arriveTime =
    itineraryNode.arrive_time ||
    itineraryNode.arriveTime ||
    itineraryNode.arrive_time_str ||
    null;

  const contactPhone =
    contactNode.phone ||
    options.contactPhone ||
    null;

  const logoSrc = logoBase64 ? `data:image/png;base64,${logoBase64}` : undefined;

  return {
    ticketNo: ticketNo || undefined,
    refNo: refNo || undefined,
    seatNo: seatNo || undefined,
    price: price || undefined,
    bookedBy,
    uuid: uuid || undefined,
    passengerName: passengerName || undefined,
    passengerPhone: passengerPhone || undefined,
    departCity: departCity || undefined,
    departDate: departDate || undefined,
    departTime: departTime || undefined,
    arriveCity: arriveCity || undefined,
    arriveDate: arriveDate || undefined,
    arriveTime: arriveTime || undefined,
    contactPhone: contactPhone || undefined,
    qrDataUrl: qrDataUrl || undefined,
    logoSrc
  };
};

interface TicketDisplayProps {
  cartId: string;
  ticketId?: string;
  onBack?: () => void;
}

const TicketDisplay: React.FC<TicketDisplayProps> = ({ cartId, ticketId, onBack }) => {
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showOptions, setShowOptions] = useState(false);

  useEffect(() => {
    const fetchTickets = async () => {
      try {
        setLoading(true);
        setError(null);

        if (ticketId) {
          // Fetch single ticket
          const response = await getTicket(cartId, ticketId);
          if (response.success) {
            setTicket(response.ticket);
          } else {
            const mapped = mapTripErrorToUserMessage({
              context: 'ticket',
              message: response.error || 'Failed to load ticket',
            });
            setError(mapped.message);
          }
        } else {
          // Fetch all tickets for cart
          const response = await getTicketsByCart(cartId);
          if (response.success) {
            setTickets(response.tickets);
          } else {
            const mapped = mapTripErrorToUserMessage({
              context: 'ticket',
              message: response.error || 'Failed to load tickets',
            });
            setError(mapped.message);
          }
        }
      } catch (err) {
        const mapped = mapTripErrorToUserMessage({
          context: 'ticket',
          error: err,
          fallbackMessage: 'We could not load your tickets. Please try again.',
        });
        setError(mapped.message);
      } finally {
        setLoading(false);
      }
    };

    fetchTickets();
  }, [cartId, ticketId]);

  const singleTicketView = ticket ? buildTicketViewModel(ticket) : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#652D8E]"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <h3 className="text-red-800 font-semibold">Error Loading Ticket</h3>
          <p className="text-red-600 mt-1">{error}</p>
          {onBack && (
            <button
              onClick={onBack}
              className="mt-4 btn-primary"
            >
              Go Back
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-4">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center h-9 w-9 rounded-full bg-[#652D8E]/10">
            <TicketIcon className="h-5 w-5 text-[#652D8E] dark:text-purple-300" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-[#652D8E] dark:text-purple-300">
              {ticketId ? 'Ticket Details' : 'Your Tickets'}
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mt-1 text-xs">
              Cart ID: {cartId}
            </p>
          </div>
        </div>
        {onBack && (
          <button
            onClick={onBack}
            className="btn-primary px-3 py-1.5 text-xs"
          >
            ← Back
          </button>
        )}
      </div>

      {ticket ? (
        // Single ticket display - mirror backend email/print ticket layout
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden max-w-xl mx-auto">
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-[#652D8E]/10 flex items-center justify-center overflow-hidden">
              <img
                src={singleTicketView?.logoSrc || DEFAULT_TICKET_LOGO_SRC}
                alt="National Tickets Global"
                className="h-8 w-auto object-contain"
              />
            </div>
            <div className="flex-1">
              <h2 className="text-base font-semibold tracking-tight text-gray-900 dark:text-gray-100">
                National Tickets Global
              </h2>
              {!ticket?.isHold && singleTicketView?.ticketNo && (
                <p className="text-[11px] text-gray-500 dark:text-gray-400">
                  Ticket No:{' '}
                  <span className="font-medium text-gray-900 dark:text-gray-100">
                    {singleTicketView.ticketNo}
                  </span>
                </p>
              )}
            </div>
            <span
              className={`inline-flex items-center px-2 py-1 text-[11px] font-semibold rounded-full ${
                ticket.status === 'pending'
                  ? 'bg-yellow-100/90 text-yellow-900'
                  : 'bg-emerald-100/90 text-emerald-900'
              }`}
            >
              {ticket.status}
            </span>
          </div>

          <div className="p-4 space-y-4">
            <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    Passenger
                  </div>
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {singleTicketView?.passengerName || '—'}
                  </div>
                  <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                    Phone: {singleTicketView?.passengerPhone || '—'}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    Ref No
                  </div>
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {singleTicketView?.refNo || getTicketReference(ticket) || '—'}
                  </div>
                  <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                    Booked By: {singleTicketView?.bookedBy || 'online'}
                  </div>
                </div>
              </div>
            </div>

            <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    Depart
                  </div>
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {singleTicketView?.departCity || '—'}
                  </div>
                  <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                    {(singleTicketView?.departDate || '—')}{' '}
                    {singleTicketView?.departTime || ''}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    Arrive
                  </div>
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {singleTicketView?.arriveCity || '—'}
                  </div>
                  <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                    {(singleTicketView?.arriveDate || '—')}{' '}
                    {singleTicketView?.arriveTime || ''}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    Seat
                  </div>
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {singleTicketView?.seatNo || '—'}
                  </div>
                  <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                    Price:{' '}
                    <span className="font-semibold">
                      {singleTicketView?.price || '—'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {singleTicketView?.qrDataUrl && (
              <div className="text-center">
                <img
                  src={singleTicketView.qrDataUrl}
                  alt="Ticket QR code"
                  className="inline-block w-28 h-28 object-contain"
                />
                {singleTicketView?.uuid && (
                  <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                    Ticket UUID:{' '}
                    <span className="font-mono">{singleTicketView.uuid}</span>
                  </div>
                )}
              </div>
            )}

            <div className="text-[11px] text-gray-600 dark:text-gray-300 space-y-1">
              <div className="font-medium text-gray-800 dark:text-gray-100">
                TICKET CONFIRMED — Congratulations your ticket(s) have been booked.
              </div>
              <div>Checkin 1 Hour before Departure | Terms &amp; Conditions Apply</div>
              {singleTicketView?.contactPhone && (
                <div>For Info Call {singleTicketView.contactPhone}</div>
              )}
            </div>

            {ticket.options && (
              <div className="pt-3 border-t border-gray-200 dark:border-gray-700">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-semibold text-gray-900 dark:text-gray-100">Ticket Details (raw)</h3>
                  <button
                    type="button"
                    onClick={() => setShowOptions((v) => !v)}
                    className="text-[11px] font-medium text-[#652D8E] dark:text-purple-300 hover:underline"
                  >
                    {showOptions ? 'Hide raw data' : 'Show raw data'}
                  </button>
                </div>
                {showOptions && (
                  <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-3 max-h-64 overflow-auto">
                    <pre className="text-xs text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
                      {JSON.stringify(ticket.options, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}

            <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => window.print()}
                  className="btn-primary px-3 py-1.5 text-xs"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <PrinterIcon className="h-4 w-4" />
                    <span>Get Ticket(s)</span>
                  </span>
                </button>
                <button
                  onClick={() => {
                    const ticketData = JSON.stringify(ticket, null, 2);
                    navigator.clipboard.writeText(ticketData);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="px-3 py-1.5 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors flex items-center gap-1.5 text-xs"
                  aria-live="polite"
                >
                  {copied ? (
                    <>
                      <ClipboardCheckIcon className="h-4 w-4" /> Copied!
                    </>
                  ) : (
                    <>
                      <ClipboardCopyIcon className="h-4 w-4" /> Copy Details
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        // Multiple tickets list
        <div className="space-y-3">
          {tickets.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-4xl mb-3">🎫</div>
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-2">No Tickets Found</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">No tickets have been created for this cart yet.</p>
            </div>
          ) : (
            tickets.map((t) => (
              <div key={t.id} className="bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                      Ticket #{t.id}
                    </h3>
                    <p className="text-gray-600 dark:text-gray-400 text-xs">
                      Status: <span className={`font-medium ${
                        t.status === 'pending'
                          ? 'text-yellow-600 dark:text-yellow-400'
                          : 'text-green-600 dark:text-green-400'
                      }`}>{t.status}</span>
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                      Updated: {new Date(t.updatedAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => setTicket(t)}
                      className="btn-primary px-3 py-1.5 text-xs"
                    >
                      View Details
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default TicketDisplay;
