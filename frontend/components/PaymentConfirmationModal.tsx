import React, { useRef } from 'react';
import { BusRoute, SearchQuery } from '../utils/api';
import { BookingDetails, Passenger } from '../types';
import TripSummary from './TripSummary';
import { CheckCircleIcon, ArrowRightIcon, UserCircleIcon, AtSymbolIcon, CreditCardIcon, PayPalIcon, GooglePayIcon, StoreIcon, CalendarIcon, LocationIcon } from './icons';

interface PaymentConfirmationModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    booking: { outbound: BusRoute; inbound: BusRoute | null };
    query: SearchQuery;
    details: BookingDetails;
}

const getPaymentIcon = (method: string) => {
    const props = { className: "h-6 w-6 text-gray-500 dark:text-gray-400 mr-3" };
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
    <div className="flex items-start text-xs">
        <div className="flex-shrink-0 h-4 w-4 text-gray-400 mt-0.5">{icon}</div>
        <div className="ml-2">
            <span className="font-semibold text-gray-500 dark:text-gray-400">{label}:</span>
            <span className="ml-1 text-gray-700 dark:text-gray-300">{value}</span>
        </div>
    </div>
);

const PassengerDetailsCard: React.FC<{ passenger: Passenger, index: number }> = ({ passenger, index }) => (
    <div className="border-t border-gray-200 dark:border-gray-700 pt-3 first:pt-0 first:border-t-0">
        <div className="flex justify-between items-center">
            <h4 className="font-semibold text-base text-[#652D8E] dark:text-purple-300">
                {passenger.firstName} {passenger.lastName}
            </h4>
            <span className="text-sm capitalize text-gray-500 bg-gray-100 dark:bg-gray-700 dark:text-gray-300 px-2 py-1 rounded-md">
                {passenger.type}
            </span>
        </div>
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
            <PassengerDetailRow icon={<CalendarIcon />} label="DOB" value={new Date(passenger.dob + 'T00:00:00').toLocaleDateString()} />
            <PassengerDetailRow icon={<UserCircleIcon />} label="Gender" value={passenger.gender.charAt(0).toUpperCase() + passenger.gender.slice(1)} />
            <PassengerDetailRow icon={<LocationIcon />} label="Nationality" value={passenger.nationality} />
            <PassengerDetailRow icon={<CreditCardIcon />} label={passenger.idType.replace('_', ' ')} value={passenger.idNumber} />
        </div>
    </div>
);

const PaymentConfirmationModal: React.FC<PaymentConfirmationModalProps> = ({ isOpen, onClose, onConfirm, booking, query, details }) => {
    const modalRef = useRef<HTMLDivElement>(null);

    if (!isOpen) return null;

    return (
        <div 
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="payment-modal-title"
        >
            <div 
                ref={modalRef}
                className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-2xl animate-fade-in-down border border-gray-200 dark:border-gray-700"
            >
                <div className="p-6">
                    <div className="flex items-center">
                        <CheckCircleIcon className="h-8 w-8 text-[#652D8E] dark:text-purple-400" />
                        <h2 id="payment-modal-title" className="ml-3 text-2xl font-bold text-[#652D8E] dark:text-purple-300">
                            Complete Your Purchase
                        </h2>
                    </div>
                    <p className="mt-2 text-gray-600 dark:text-gray-300">
                        Your booking has been submitted successfully and a purchase has been created. Click below to confirm your purchase and receive your tickets.
                    </p>
                </div>

                <div className="max-h-[60vh] overflow-y-auto px-6 py-5 border-y border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                    <div className="space-y-6">
                        <div>
                            <h3 className="text-lg font-bold text-[#652D8E] dark:text-purple-300 mb-2">Trip Itinerary</h3>
                            <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
                                <TripSummary booking={booking} query={query} />
                            </div>
                        </div>

                        <div>
                            <h3 className="text-lg font-bold text-[#652D8E] dark:text-purple-300 mb-2">Passengers</h3>
                            <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 space-y-3">
                                {details.passengers.map((p, index) => (
                                    <PassengerDetailsCard key={index} passenger={p} index={index} />
                                ))}
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <h3 className="text-lg font-bold text-[#652D8E] dark:text-purple-300 mb-2">Contact Details</h3>
                                <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 space-y-3">
                                    <div className="flex items-center">
                                        <UserCircleIcon className="h-5 w-5 text-gray-400 mr-3" />
                                        <span className="font-medium text-gray-700 dark:text-gray-300">{details.contactInfo.firstName} {details.contactInfo.lastName}</span>
                                    </div>
                                    <div className="flex items-center">
                                        <AtSymbolIcon className="h-5 w-5 text-gray-400 mr-3" />
                                        <span className="font-medium text-gray-700 dark:text-gray-300">{details.contactInfo.email}</span>
                                    </div>
                                </div>
                            </div>

                            <div>
                                <h3 className="text-lg font-bold text-[#652D8E] dark:text-purple-300 mb-2">Payment Method</h3>
                                <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
                                    <div className="flex items-center">
                                        {getPaymentIcon(details.paymentMethod)}
                                        <span className="font-semibold text-[#652D8E] dark:text-purple-300">{details.paymentMethod}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div className="p-6 flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-4 gap-3">
                    <button 
                        type="button"
                        onClick={onClose}
                        className="w-full sm:w-auto text-[#652D8E] border-2 border-[#652D8E] font-bold py-3 px-6 rounded-lg hover:bg-[#652D8E]/10 transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#652D8E] dark:text-purple-300 dark:border-purple-300 dark:hover:bg-purple-300/10 dark:focus:ring-offset-gray-800"
                    >
                        Cancel
                    </button>
                    <button 
                        type="button"
                        onClick={onConfirm}
                        className="w-full sm:w-auto flex items-center justify-center gap-2 bg-[#652D8E] dark:bg-purple-600 text-white font-bold py-3 px-6 rounded-lg hover:opacity-90 transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#652D8E] dark:focus:ring-offset-gray-800 shadow-lg"
                    >
                        <span>Complete Purchase</span>
                        <ArrowRightIcon className="h-5 w-5" />
                    </button>
                </div>
            </div>
        </div>
    );
};

export default PaymentConfirmationModal;