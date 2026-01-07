import React from 'react';
import { BusRoute, SearchQuery } from '../utils/api';
import { ChevronLeftIcon, BusIcon, ClockIcon, CalendarIcon, UsersIcon, ArrowRightIcon, DepartureIcon, ArrivalIcon } from './icons';
import TripSummary from './TripSummary';

interface TripDetailsProps {
    booking: { outbound: BusRoute; inbound: BusRoute | null };
    query: SearchQuery;
    onBack: () => void;
    onConfirm: () => void;
}

const InfoRow: React.FC<{ icon: React.ReactNode, label: string, value: string }> = ({ icon, label, value }) => (
    <div className="flex items-start">
        <div className="flex-shrink-0 h-6 w-6 text-gray-400">{icon}</div>
        <div className="ml-3">
            <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
            <p className="font-semibold text-[#652D8E] dark:text-purple-300">{value}</p>
        </div>
    </div>
);

const ItineraryLeg: React.FC<{ title: string, date: string, route: BusRoute }> = ({ title, date, route }) => (
    <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-md border border-gray-200 dark:border-gray-700">
        <h3 className="text-xl font-bold text-[#652D8E] dark:text-purple-300 mb-6 border-b border-gray-200 dark:border-gray-700 pb-4">{title}</h3>

        <div className="space-y-8">
            {/* Departure */}
            <div>
                <h4 className="text-lg font-semibold text-[#652D8E] dark:text-purple-300 mb-4">Departure</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <InfoRow icon={<CalendarIcon/>} label="Date" value={date} />
                    <InfoRow icon={<ClockIcon/>} label="Time" value={route.departureTime} />
                    <InfoRow icon={<DepartureIcon/>} label="From" value={route.origin} />
                    <InfoRow icon={<BusIcon/>} label="Operator" value={route.busCompany} />
                </div>
            </div>
            
            <div className="border-t border-gray-200 dark:border-gray-700 border-dashed my-6"></div>
            
            {/* Arrival */}
             <div>
                <h4 className="text-lg font-semibold text-[#652D8E] dark:text-purple-300 mb-4">Arrival</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <InfoRow icon={<CalendarIcon/>} label="Date" value={date} />
                    <InfoRow icon={<ClockIcon/>} label="Time" value={route.arrivalTime} />
                    <InfoRow icon={<ArrivalIcon/>} label="To" value={route.destination} />
                    <InfoRow icon={<UsersIcon/>} label="Total Duration" value={route.duration} />
                </div>
            </div>
        </div>
    </div>
);

const TripDetails: React.FC<TripDetailsProps> = ({ booking, query, onBack, onConfirm }) => {
    const { outbound, inbound } = booking;
    const formattedOutboundDate = new Date(query.departureDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    const formattedInboundDate = query.returnDate ? new Date(query.returnDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) : '';

    return (
        <div className="max-w-6xl mx-auto animate-fade-in">
            <div className="mb-6">
                <button onClick={onBack} className="flex items-center text-[#652D8E] dark:text-purple-300 hover:opacity-80 font-semibold text-sm transition-colors">
                    <ChevronLeftIcon className="h-5 w-5 mr-1" />
                    Back to results
                </button>
            </div>

            <div className="lg:grid lg:grid-cols-3 lg:gap-8">
                {/* Main Details Column */}
                <div className="lg:col-span-2 space-y-6">
                    <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-md border border-gray-200 dark:border-gray-700">
                        <h2 className="text-2xl font-bold text-[#652D8E] dark:text-purple-300 mb-1">{outbound.origin} to {outbound.destination}</h2>
                        <p className="text-gray-500 dark:text-gray-400">{inbound ? 'Round Trip' : 'One-way'}</p>
                    </div>

                    <ItineraryLeg title="Outbound Itinerary" date={formattedOutboundDate} route={outbound} />

                    {inbound && (
                        <ItineraryLeg title="Return Itinerary" date={formattedInboundDate} route={inbound} />
                    )}
                </div>

                {/* Pricing Column */}
                <div className="lg:col-span-1 mt-8 lg:mt-0">
                    <div className="sticky top-28">
                       <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-md border border-gray-200 dark:border-gray-700">
                            <h3 className="text-xl font-bold text-[#652D8E] dark:text-purple-300 mb-4 border-b border-gray-200 dark:border-gray-700 pb-4">Price Summary</h3>
                            <TripSummary booking={booking} query={query} />
                            <button onClick={onConfirm} className="mt-6 w-full flex items-center justify-center gap-2 bg-[#652D8E] dark:bg-purple-600 text-white font-bold py-3 px-4 rounded-lg hover:opacity-90 transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#652D8E] dark:focus:ring-offset-gray-800 transform hover:scale-105 shadow-lg">
                                <span>Continue</span>
                                <ArrowRightIcon className="h-5 w-5" />
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default TripDetails;
