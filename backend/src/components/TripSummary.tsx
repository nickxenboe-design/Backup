import React, { useState, useEffect } from 'react';
import jsPDF from 'jspdf';
import { BusRoute, SearchQuery, timestampToISO } from '@/utils/api';
import { computePassengerFareBreakdown } from '@/utils/fareUtils';
import { BusIcon, CalendarIcon, ClockIcon, UsersIcon, ArrowRightIcon, PriceTagIcon, ShareIcon } from './icons';

interface TripSummaryProps {
    booking: { outbound: BusRoute; inbound: BusRoute | null };
    query: SearchQuery;
    compact?: boolean;
}

const DetailRow: React.FC<{ icon: React.ReactNode, label: string, value: string | React.ReactNode, compact?: boolean }> = ({ icon, label, value, compact }) => (
    <div className={`flex items-start ${compact ? 'py-1.5' : 'py-2.5'}`}>
        <div className={`flex-shrink-0 text-gray-400 mt-0.5 ${compact ? 'h-3.5 w-3.5' : 'h-5 w-5'}`}>{icon}</div>
        <div className={`${compact ? 'ml-2' : 'ml-4'} flex-1`}>
            <p className={`${compact ? 'text-[10px]' : 'text-xs'} text-gray-500 dark:text-gray-400 uppercase font-medium tracking-wider`}>{label}</p>
            <p className={`${compact ? 'text-[10px]' : ''} font-medium text-[#652D8E] dark:text-purple-300`}>{value}</p>
        </div>
    </div>
);

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

const TripSummary: React.FC<TripSummaryProps> = ({ booking, query, compact }) => {
    const { outbound, inbound } = booking;
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
    
    const totalPassengers = Math.max(1, (query.passengers.adults || 0) + (query.passengers.children || 0));

    const hasAggregatedRoundTrip = !inbound && hasRoundTripLegs;
    const outboundBasePrice = outbound.price || 0;
    const inboundBasePrice = inbound
        ? (inbound.price || 0)
        : (hasAggregatedRoundTrip ? outboundBasePrice : 0);

    const outboundPerPassenger = outboundBasePrice / totalPassengers;
    const inboundPerPassenger = inboundBasePrice / totalPassengers;
    const outboundTotalPrice = outboundPerPassenger * totalPassengers;
    const inboundTotalPrice = inboundPerPassenger * totalPassengers;
    const totalPrice = outboundTotalPrice + inboundTotalPrice;

    const outboundFare = computePassengerFareBreakdown(outbound, query);
    const inboundFare = inboundToShow ? computePassengerFareBreakdown(inboundToShow, query) : null;

    const outboundAdultTotal = outboundFare.adultUnit * outboundFare.adultCount;
    const outboundChildTotal = outboundFare.childUnit * outboundFare.childCount;
    const inboundAdultTotal = inboundFare ? inboundFare.adultUnit * inboundFare.adultCount : 0;
    const inboundChildTotal = inboundFare ? inboundFare.childUnit * inboundFare.childCount : 0;
    
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
                >
                    <ShareIcon className={`${compact ? 'h-4 w-4' : 'h-6 w-6'}`} />
                </button>
            )}

            {/* Trip Details */}
            <div className={`divide-y divide-gray-100 dark:divide-gray-700/50 ${compact ? '-my-1.5' : '-my-2.5'}`}>
                <DetailRow 
                    icon={<ArrowRightIcon className={`${compact ? 'h-3.5 w-3.5' : ''}`} />} 
                    label="Outbound Route" 
                    value={`${outboundDisplay.origin} to ${outboundDisplay.destination}`} 
                    compact={compact}
                />
                <DetailRow icon={<BusIcon className={`${compact ? 'h-3.5 w-3.5' : ''}`} />} label="Outbound Operator" value={outboundDisplay.busCompany} compact={compact} />
                <DetailRow icon={<CalendarIcon className={`${compact ? 'h-3.5 w-3.5' : ''}`} />} label="Outbound Date" value={formattedOutboundDate} compact={compact} />
                <DetailRow icon={<ClockIcon className={`${compact ? 'h-3.5 w-3.5' : ''}`} />} label="Outbound Schedule" value={`${outboundDisplay.departureTime} → ${outboundDisplay.arrivalTime} (${outboundDisplay.duration})`} compact={compact} />
                {inboundToShow && (
                    <>
                        <DetailRow 
                            icon={<ArrowRightIcon style={{ transform: 'rotate(180deg)'}} className={`${compact ? 'h-3.5 w-3.5' : ''}`} />} 
                            label="Return Route" 
                            value={`${inboundToShow.origin} to ${inboundToShow.destination}`} 
                            compact={compact}
                        />
                        <DetailRow icon={<BusIcon className={`${compact ? 'h-3.5 w-3.5' : ''}`} />} label="Return Operator" value={inboundToShow.busCompany} compact={compact} />
                        <DetailRow icon={<CalendarIcon className={`${compact ? 'h-3.5 w-3.5' : ''}`} />} label="Return Date" value={formattedInboundDate} compact={compact} />
                        <DetailRow icon={<ClockIcon className={`${compact ? 'h-3.5 w-3.5' : ''}`} />} label="Return Schedule" value={`${inboundToShow.departureTime} → ${inboundToShow.arrivalTime} (${inboundToShow.duration})`} compact={compact} />
                    </>
                )}
                <DetailRow icon={<UsersIcon className={`${compact ? 'h-3.5 w-3.5' : ''}`} />} label="Passengers" value={`${totalPassengers} Traveler(s)`} compact={compact} />
            </div>

            {/* Price Breakdown */}
            <div className="pt-3 border-t border-gray-200 dark:border-gray-700">
                <div className="mb-1.5">
                    <h4 className={`${compact ? 'text-xs' : 'text-sm'} font-bold text-[#652D8E] dark:text-purple-300 uppercase tracking-wide`}>Price Breakdown</h4>
                </div>
                <div className={`space-y-1.5 ${compact ? 'text-xs' : 'text-sm'}`}>
                    <div className="flex justify-between items-center">
                        <div>
                            <span className="text-gray-600 dark:text-gray-300">Outbound ({totalPassengers}x)</span>
                            {outboundFare.hasDetailedBreakdown ? (
                                <>
                                    {outboundFare.adultCount > 0 && outboundFare.adultUnit > 0 && (
                                        <div className={`${compact ? 'text-[10px]' : 'text-xs'} text-gray-500 dark:text-gray-400`}>{
                                            `Adults (${outboundFare.adultCount}x @ $${outboundFare.adultUnit.toFixed(2)}) → $${outboundAdultTotal.toFixed(2)}`
                                        }</div>
                                    )}
                                    {outboundFare.childCount > 0 && outboundFare.childUnit > 0 && (
                                        <div className={`${compact ? 'text-[10px]' : 'text-xs'} text-gray-500 dark:text-gray-400`}>{
                                            `Children (${outboundFare.childCount}x @ $${outboundFare.childUnit.toFixed(2)}) → $${outboundChildTotal.toFixed(2)}`
                                        }</div>
                                    )}
                                </>
                            ) : (
                                <div className={`${compact ? 'text-[10px]' : 'text-xs'} text-gray-500 dark:text-gray-400`}>{`Per passenger: $${outboundPerPassenger.toFixed(2)}`}</div>
                            )}
                        </div>
                        <span className="font-medium text-gray-900 dark:text-gray-100">${outboundTotalPrice.toFixed(2)}</span>
                    </div>
                    {inboundToShow && inboundTotalPrice > 0 && (
                        <div className="flex justify-between items-center">
                            <div>
                                <span className="text-gray-600 dark:text-gray-300">Inbound ({totalPassengers}x)</span>
                                {inboundFare && inboundFare.hasDetailedBreakdown ? (
                                    <>
                                        {inboundFare.adultCount > 0 && inboundFare.adultUnit > 0 && (
                                            <div className={`${compact ? 'text-[10px]' : 'text-xs'} text-gray-500 dark:text-gray-400`}>{
                                                `Adults (${inboundFare.adultCount}x @ $${inboundFare.adultUnit.toFixed(2)}) → $${inboundAdultTotal.toFixed(2)}`
                                            }</div>
                                        )}
                                        {inboundFare.childCount > 0 && inboundFare.childUnit > 0 && (
                                            <div className={`${compact ? 'text-[10px]' : 'text-xs'} text-gray-500 dark:text-gray-400`}>{
                                                `Children (${inboundFare.childCount}x @ $${inboundFare.childUnit.toFixed(2)}) → $${inboundChildTotal.toFixed(2)}`
                                            }</div>
                                        )}
                                    </>
                                ) : (
                                    <div className={`${compact ? 'text-[10px]' : 'text-xs'} text-gray-500 dark:text-gray-400`}>{`Per passenger: $${inboundPerPassenger.toFixed(2)}`}</div>
                                )}
                            </div>
                            <span className="font-medium text-gray-900 dark:text-gray-100">${inboundTotalPrice.toFixed(2)}</span>
                        </div>
                    )}
                </div>

                <div className="border-t border-gray-200 dark:border-gray-700 my-3"></div>

                <div className="flex justify-between items-center">
                    <span className={`font-bold ${compact ? 'text-xs' : 'text-base'} text-[#652D8E] dark:text-purple-300 flex items-center gap-2`}>
                         <PriceTagIcon className={`${compact ? 'h-3.5 w-3.5' : 'h-5 w-5'}`}/>
                         Total
                    </span>
                    <span className={`${compact ? 'text-base' : 'text-2xl'} font-bold text-[#652D8E] dark:text-purple-300`}>${totalPrice.toFixed(2)}</span>
                </div>
            </div>
        </div>
    );
};

export default TripSummary;
