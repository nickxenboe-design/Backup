import React from 'react';
import { BusRoute, SearchQuery } from '@/utils/api';
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
        <div className="flex-shrink-0 text-gray-400 text-[11px]">{icon}</div>
        <div className="ml-1">
            <p className="text-[9px] text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                {label}
            </p>
            <p className="text-[11px] font-semibold text-[#652D8E] dark:text-purple-300 leading-tight">
                {value}
            </p>
        </div>
    </div>
);

const ItineraryLeg: React.FC<{ title: string, departureDate: string, arrivalDate: string, route: BusRoute }> = ({ title, departureDate, arrivalDate, route }) => (
    <div className="bg-white dark:bg-gray-800 p-2 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 text-[11px]">
        <h2 className="text-xs font-bold text-[#652D8E] dark:text-purple-300 mb-0.5">
            {route.origin} to {route.destination}
        </h2>
        <p className="text-gray-500 dark:text-gray-400 text-[10px] mb-0.5"></p>
        <h3 className="text-[11px] font-bold text-[#652D8E] dark:text-purple-300 mb-1.5 border-b border-gray-200 dark:border-gray-700 pb-0.5">
            {title}
        </h3>

        <div className="space-y-3">
            {/* Departure */}
            <div>
                <h4 className="text-[10px] font-semibold text-[#652D8E] dark:text-purple-300 mb-1">
                    Departure
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <InfoRow icon={<CalendarIcon/>} label="Date" value={departureDate} />
                    <InfoRow icon={<ClockIcon className="h-3 w-3"/>} label="Time" value={route.departureTime} />
                    <InfoRow icon={<DepartureIcon className="h-3 w-3"/>} label="From" value={route.origin} />
                    <InfoRow icon={<BusIcon className="h-3 w-3"/>} label="Operator" value={route.busCompany} />
                </div>
            </div>
            
            <div className="border-t border-gray-200 dark:border-gray-700 border-dashed my-2"></div>
            
            {/* Arrival */}
             <div>
                <h4 className="text-[10px] font-semibold text-[#652D8E] dark:text-purple-300 mb-1">
                    Arrival
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <InfoRow icon={<CalendarIcon/>} label="Date" value={arrivalDate} />
                    <InfoRow icon={<ClockIcon className="h-3 w-3"/>} label="Time" value={route.arrivalTime} />
                    <InfoRow icon={<ArrivalIcon className="h-3 w-3"/>} label="To" value={route.destination} />
                    <InfoRow icon={<UsersIcon className="h-3 w-3"/>} label="Total Duration" value={route.duration} />
                </div>
            </div>
        </div>
    </div>
);

const TripDetails: React.FC<TripDetailsProps> = ({ booking, query, onBack, onConfirm }) => {
    const { outbound, inbound } = booking;

    console.log('[TripDetails] Render', {
        tripType: query.tripType,
        hasOutbound: !!outbound,
        hasInbound: !!inbound,
        query,
        booking,
    });

    const parseDurationToMs = (duration: string | undefined): number => {
        if (!duration) return 0;
        const hoursMatch = duration.match(/(\d+)h/);
        const minutesMatch = duration.match(/(\d+)m/);

        let totalMinutes = 0;
        if (hoursMatch) {
            totalMinutes += parseInt(hoursMatch[1], 10) * 60;
        }
        if (minutesMatch) {
            totalMinutes += parseInt(minutesMatch[1], 10);
        }

        return totalMinutes * 60 * 1000;
    };

    const formatDate = (date: Date): string =>
        date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

    const baseOutboundDate = new Date(query.departureDate + 'T00:00:00');
    const outboundDurationMs = parseDurationToMs(outbound.duration);
    const outboundArrivalDateObj = new Date(baseOutboundDate.getTime() + outboundDurationMs);

    const formattedOutboundDepartureDate = formatDate(baseOutboundDate);
    const formattedOutboundArrivalDate = formatDate(outboundArrivalDateObj);

    let formattedInboundDepartureDate = '';
    let formattedInboundArrivalDate = '';

    if (inbound && query.returnDate) {
        const baseInboundDate = new Date(query.returnDate + 'T00:00:00');
        const inboundDurationMs = parseDurationToMs(inbound.duration);
        const inboundArrivalDateObj = new Date(baseInboundDate.getTime() + inboundDurationMs);

        formattedInboundDepartureDate = formatDate(baseInboundDate);
        formattedInboundArrivalDate = formatDate(inboundArrivalDateObj);
    }

    const legs = (outbound as any)?.legs;
    const hasRoundTripLegs = Array.isArray(legs) && legs.length >= 2;
    const outboundDisplay: BusRoute = hasRoundTripLegs
        ? { ...outbound, origin: legs[0].origin, destination: legs[0].destination, departureTime: legs[0].departureTime, arrivalTime: legs[0].arrivalTime, duration: legs[0].duration, busCompany: legs[0].operator || outbound.busCompany }
        : outbound;
    const inboundDisplay: BusRoute | null = inbound ? inbound : (hasRoundTripLegs
        ? { ...outbound, origin: legs[1].origin, destination: legs[1].destination, departureTime: legs[1].departureTime, arrivalTime: legs[1].arrivalTime, duration: legs[1].duration, busCompany: legs[1].operator || outbound.busCompany }
        : null);
    const isRoundTrip = !!query.returnDate;

    return (
        <div className="max-w-6xl mx-auto animate-fade-in">
            <div className="mb-4">
                <button onClick={onBack} className="flex items-center text-[#652D8E] dark:text-purple-300 hover:opacity-80 font-semibold text-xs transition-colors">
                    <ChevronLeftIcon className="h-4 w-4 mr-0.5" />
                    Back to results
                </button>
            </div>

            <div className="flex items-center justify-center min-h-[70vh]">
                <div className="w-full lg:grid lg:grid-cols-3 lg:gap-4">
                    {isRoundTrip && (
                        <div className="lg:col-span-3 mb-2 flex justify-end">
                            <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-[#652D8E]/10 text-[#652D8E] dark:bg-purple-500/10 dark:text-purple-200 text-[10px] font-semibold uppercase tracking-wide">
                                Round Trip
                            </span>
                        </div>
                    )}

                    {/* Column 1: Outbound Itinerary */}
                    <div>
                        <ItineraryLeg
                            title="Outbound Itinerary"
                            departureDate={formattedOutboundDepartureDate}
                            arrivalDate={formattedOutboundArrivalDate}
                            route={outbound}
                        />
                    </div>

                    {/* Column 2: Return Itinerary for round-trip, or Ad placeholder for one-way */}
                    <div className="mt-4 lg:mt-0">
                        {inbound && query.returnDate ? (
                            <ItineraryLeg
                                title="Return Itinerary"
                                departureDate={formattedInboundDepartureDate}
                                arrivalDate={formattedInboundArrivalDate}
                                route={inbound}
                            />
                        ) : (
                            <div className="bg-white dark:bg-gray-800 p-2 rounded-2xl shadow-md border border-gray-200 dark:border-gray-700 flex flex-col justify-between">
                                <div>
                                    <h2 className="text-sm font-bold text-[#652D8E] dark:text-purple-300 mb-0.5">Sponsored</h2>
                                    <p className="text-gray-500 dark:text-gray-400 text-[10px] mb-1"></p>
                                    <h3 className="text-xs font-bold text-[#652D8E] dark:text-purple-300 mb-2 border-b border-gray-200 dark:border-gray-700 pb-1">Ad Placement</h3>
                                </div>
                                <div className="text-[10px] text-gray-600 dark:text-gray-300">
                                    Ad placeholder
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Column 3: Pricing */}
                    <div className="mt-4 lg:mt-0">
                        <div className="sticky top-28">
                            <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-md border border-gray-200 dark:border-gray-700">
                                <h3 className="text-xs font-bold text-[#652D8E] dark:text-purple-300 mb-1.5 border-b border-gray-200 dark:border-gray-700 pb-1">Price Summary</h3>
                                <TripSummary booking={booking} query={query} compact />
                                <button onClick={onConfirm} className="btn-primary mt-2 w-full flex items-center justify-center gap-1.5 py-1 px-2 transform hover:scale-105 shadow-lg text-[10px]">
                                    <span>Continue</span>
                                    <ArrowRightIcon className="h-3 w-3" />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
;

export default TripDetails;
