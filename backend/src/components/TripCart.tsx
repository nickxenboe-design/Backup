import React from 'react';
import { BusRoute } from '@/types';
import { BusIcon, ClockIcon, ArrowRightIcon, XIcon, PriceTagIcon } from './icons';

interface TripCartProps {
    outboundRoute: BusRoute;
    inboundRoute?: BusRoute;
    onRemove: () => void;
}

const TripCart: React.FC<TripCartProps> = ({ outboundRoute, inboundRoute, onRemove }) => {
    const legs = (outboundRoute as any)?.legs;
    const hasAggregatedRoundTrip = !inboundRoute && Array.isArray(legs) && legs.length >= 2;
    const inboundDisplay: BusRoute | undefined = inboundRoute || (hasAggregatedRoundTrip
        ? { ...outboundRoute, origin: legs[1].origin, destination: legs[1].destination, departureTime: legs[1].departureTime, arrivalTime: legs[1].arrivalTime, duration: legs[1].duration, busCompany: (legs[1] as any).operator || outboundRoute.busCompany }
        : undefined);

    const isRoundTrip = !!inboundDisplay;
    const outboundPrice = outboundRoute.price || 0;
    const inboundPrice = inboundDisplay ? (inboundRoute ? inboundRoute.price || 0 : outboundPrice) : 0;
    const totalPrice = isRoundTrip ? (outboundPrice + inboundPrice) : outboundPrice;

    return (
        <div className="bg-purple-50 dark:bg-purple-900/30 border-2 border-dashed border-purple-300 dark:border-purple-700 p-2 rounded-xl mb-6 animate-fade-in-down w-full sm:max-w-md">
            <div className="flex-grow">
                <h3 className="font-bold text-lg text-[#652D8E] dark:text-purple-300 flex items-center gap-2">
                    {isRoundTrip ? 'Selected Round Trip' : 'Selected Outbound Trip'}
                    {isRoundTrip && <span className="text-sm font-normal bg-purple-200 dark:bg-purple-800 px-2 py-1 rounded-full">Round Trip</span>}
                </h3>
                <div className="mt-3 space-y-3">
                    {/* Outbound */}
                    <div className="flex items-center gap-x-4 gap-y-1 text-sm text-gray-700 dark:text-gray-300 flex-wrap">
                        <div className="flex items-center gap-2"><BusIcon className="h-4 w-4" /> <strong>{outboundRoute.busCompany}</strong></div>
                        <div className="flex items-center gap-2"><ClockIcon className="h-4 w-4" /> {outboundRoute.departureTime} <ArrowRightIcon className="h-3 w-3" /> {outboundRoute.arrivalTime}</div>
                        <div className="flex items-center gap-2 font-bold text-base text-[#652D8E] dark:text-purple-300"><PriceTagIcon className="h-4 w-4 text-gray-500" /> ${outboundRoute.price.toFixed(2)}</div>
                    </div>
                    {/* Inbound if round trip */}
                    {isRoundTrip && inboundDisplay && (
                        <>
                            <div className="flex items-center justify-center py-2">
                                <span className="text-gray-500 dark:text-gray-400 text-sm font-medium">Return Trip</span>
                            </div>
                            <div className="flex items-center gap-x-4 gap-y-1 text-sm text-gray-700 dark:text-gray-300 flex-wrap">
                                <div className="flex items-center gap-2"><BusIcon className="h-4 w-4" /> <strong>{inboundDisplay.busCompany}</strong></div>
                                <div className="flex items-center gap-2"><ClockIcon className="h-4 w-4" /> {inboundDisplay.departureTime} <ArrowRightIcon className="h-3 w-3" /> {inboundDisplay.arrivalTime}</div>
                                <div className="flex items-center gap-2 font-bold text-base text-[#652D8E] dark:text-purple-300"><PriceTagIcon className="h-4 w-4 text-gray-500" /> ${inboundPrice.toFixed(2)}</div>
                            </div>
                        </>
                    )}
                </div>
                {isRoundTrip && (
                    <div className="mt-3 pt-3 border-t border-purple-300 dark:border-purple-700">
                        <div className="flex items-center justify-between text-sm font-bold text-[#652D8E] dark:text-purple-300">
                            <span>Total Price:</span>
                            <span>${totalPrice.toFixed(2)}</span>
                        </div>
                    </div>
                )}
            </div>
            <button onClick={onRemove} className="p-2 rounded-full hover:bg-red-100 dark:hover:bg-red-900/50 ml-4 flex-shrink-0" aria-label="Remove trip selection">
                <XIcon className="h-5 w-5 text-red-500" />
            </button>
        </div>
    );
};

export default TripCart;
