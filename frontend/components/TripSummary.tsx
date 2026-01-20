import React, { useState, useEffect } from 'react';
import { BusRoute, SearchQuery, timestampToISO } from '../utils/api';
import { BusIcon, CalendarIcon, ClockIcon, UsersIcon, ArrowRightIcon, PriceTagIcon, ShareIcon } from './icons';

interface TripSummaryProps {
    booking: { outbound: BusRoute; inbound: BusRoute | null };
    query: SearchQuery;
}

const DetailRow: React.FC<{ icon: React.ReactNode, label: string, value: string | React.ReactNode }> = ({ icon, label, value }) => (
    <div className="flex items-start py-2.5">
        <div className="flex-shrink-0 h-5 w-5 text-gray-400 mt-0.5">{icon}</div>
        <div className="ml-4 flex-1">
            <p className="text-xs text-gray-500 dark:text-gray-400 uppercase font-medium tracking-wider">{label}</p>
            <p className="font-medium text-[#652D8E] dark:text-purple-300">{value}</p>
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

const TripSummary: React.FC<TripSummaryProps> = ({ booking, query }) => {
    const { outbound, inbound } = booking;
    const formattedOutboundDate = formatDateForDisplay(query.departureDate);
    const formattedInboundDate = query.returnDate ? formatDateForDisplay(query.returnDate) : '';
    
    const totalPassengers = query.passengers.adults + query.passengers.children;
    const outboundTotalPrice = outbound.price * totalPassengers;
    const inboundTotalPrice = inbound ? inbound.price * totalPassengers : 0;
    const totalPrice = outboundTotalPrice + inboundTotalPrice;
    
    const [canShare, setCanShare] = useState(false);

    useEffect(() => {
        if (navigator.share) {
            setCanShare(true);
        }
    }, []);

    const handleShare = async () => {
        if (!navigator.share) return;
        
        let text = `Check out this bus trip from ${outbound.origin} to ${outbound.destination} on ${formattedOutboundDate} with ${outbound.busCompany}!`;
        if(inbound) {
            text += `\nReturn trip is on ${formattedInboundDate}.`;
        }
        text += `\nBook your tickets on National Tickets Global.`

        const shareData = {
            title: 'My Bus Trip Details',
            text,
            url: 'https://nationaltickets.global',
        };

        try {
            await navigator.share(shareData);
        } catch (error) {
            console.error('Error sharing:', error);
        }
    };

    return (
        <div className="relative space-y-4">
            {canShare && (
                <button
                    type="button"
                    onClick={handleShare}
                    className="absolute -top-2 -right-2 p-2 text-[#652D8E] dark:text-purple-300 rounded-full hover:bg-purple-100 dark:hover:bg-purple-900/50 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-purple-500"
                    aria-label="Share trip details"
                >
                    <ShareIcon className="h-6 w-6" />
                </button>
            )}

            {/* Trip Details */}
            <div className="divide-y divide-gray-100 dark:divide-gray-700/50 -my-2.5">
                <DetailRow 
                    icon={<ArrowRightIcon />} 
                    label="Outbound Route" 
                    value={`${outbound.origin} to ${outbound.destination}`} 
                />
                <DetailRow icon={<BusIcon />} label="Outbound Operator" value={outbound.busCompany} />
                 <DetailRow icon={<CalendarIcon />} label="Outbound Date" value={formattedOutboundDate} />
                <DetailRow icon={<ClockIcon />} label="Outbound Schedule" value={`${outbound.departureTime} → ${outbound.arrivalTime} (${outbound.duration})`} />
                {inbound && (
                    <>
                        <DetailRow 
                            icon={<ArrowRightIcon style={{ transform: 'rotate(180deg)'}}/>} 
                            label="Return Route" 
                            value={`${inbound.origin} to ${inbound.destination}`} 
                        />
                        <DetailRow icon={<BusIcon />} label="Return Operator" value={inbound.busCompany} />
                        <DetailRow icon={<CalendarIcon />} label="Return Date" value={formattedInboundDate} />
                        <DetailRow icon={<ClockIcon />} label="Return Schedule" value={`${inbound.departureTime} → ${inbound.arrivalTime} (${inbound.duration})`} />
                    </>
                )}
                <DetailRow icon={<UsersIcon />} label="Passengers" value={`${totalPassengers} Traveler(s)`} />
            </div>

            {/* Price Breakdown */}
            <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
                <div className="mb-2">
                    <h4 className="text-sm font-bold text-[#652D8E] dark:text-purple-300 uppercase tracking-wide">Price Breakdown</h4>
                </div>
                <div className="space-y-1 text-sm">
                    <div className="flex justify-between items-center">
                        <span className="text-gray-600 dark:text-gray-300">Outbound ({totalPassengers}x)</span>
                        <span className="font-medium text-gray-900 dark:text-gray-100">${outboundTotalPrice.toFixed(2)}</span>
                    </div>
                    {inbound && (
                        <div className="flex justify-between items-center">
                            <span className="text-gray-600 dark:text-gray-300">Inbound ({totalPassengers}x)</span>
                            <span className="font-medium text-gray-900 dark:text-gray-100">${inboundTotalPrice.toFixed(2)}</span>
                        </div>
                    )}
                </div>

                <div className="border-t border-gray-200 dark:border-gray-700 my-4"></div>

                <div className="flex justify-between items-center">
                    <span className="font-bold text-base text-[#652D8E] dark:text-purple-300 flex items-center gap-2">
                         <PriceTagIcon className="h-5 w-5"/>
                         Total
                    </span>
                    <span className="text-2xl font-bold text-[#652D8E] dark:text-purple-300">${totalPrice.toFixed(2)}</span>
                </div>
            </div>
        </div>
    );
};

export default TripSummary;
