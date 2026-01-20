import React from 'react';
import { BusRoute } from '../types';
import { BusIcon, ClockIcon, ArrowRightIcon, XIcon, PriceTagIcon } from './icons';

interface TripCartProps {
    outboundRoute: BusRoute;
    onRemove: () => void;
}

const TripCart: React.FC<TripCartProps> = ({ outboundRoute, onRemove }) => {
    return (
        <div className="bg-purple-50 dark:bg-purple-900/30 border-2 border-dashed border-purple-300 dark:border-purple-700 p-4 rounded-xl mb-6 flex items-center justify-between animate-fade-in-down flex-wrap gap-4">
            <div className="flex-grow">
                <h3 className="font-bold text-lg text-[#652D8E] dark:text-purple-300">Selected Outbound Trip</h3>
                <div className="flex items-center gap-x-4 gap-y-1 text-sm mt-2 text-gray-700 dark:text-gray-300 flex-wrap">
                    <div className="flex items-center gap-2"><BusIcon className="h-4 w-4" /> <strong>{outboundRoute.busCompany}</strong></div>
                    <div className="flex items-center gap-2"><ClockIcon className="h-4 w-4" /> {outboundRoute.departureTime} <ArrowRightIcon className="h-3 w-3" /> {outboundRoute.arrivalTime}</div>
                    <div className="flex items-center gap-2 font-bold text-base text-[#652D8E] dark:text-purple-300"><PriceTagIcon className="h-4 w-4 text-gray-500" /> ${outboundRoute.price.toFixed(2)}</div>
                </div>
            </div>
            <button onClick={onRemove} className="p-2 rounded-full hover:bg-red-100 dark:hover:bg-red-900/50" aria-label="Remove outbound trip selection">
                <XIcon className="h-5 w-5 text-red-500" />
            </button>
        </div>
    );
};

export default TripCart;
