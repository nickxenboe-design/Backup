import React, { useRef } from 'react';
import { BusRoute, SearchQuery } from '../utils/api';
import TripSummary from './TripSummary';
import { CheckCircleIcon, ArrowRightIcon } from './icons';

interface ConfirmationModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    booking: { outbound: BusRoute; inbound: BusRoute | null };
    query: SearchQuery;
}

const ConfirmationModal: React.FC<ConfirmationModalProps> = ({ isOpen, onClose, onConfirm, booking, query }) => {
    const modalRef = useRef<HTMLDivElement>(null);

    if (!isOpen) return null;

    return (
        <div 
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirmation-modal-title"
        >
            <div 
                ref={modalRef}
                className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-lg animate-fade-in-down border border-gray-200 dark:border-gray-700"
            >
                <div className="p-6">
                    <div className="flex items-center">
                        <CheckCircleIcon className="h-8 w-8 text-green-500" />
                        <h2 id="confirmation-modal-title" className="ml-3 text-2xl font-bold text-[#652D8E] dark:text-purple-300">
                            Confirm Your Trip
                        </h2>
                    </div>
                    <p className="mt-2 text-gray-600 dark:text-gray-300">
                        Please review your selected trip details below before proceeding to enter passenger information and payment details.
                    </p>
                </div>

                <div className="bg-gray-50 dark:bg-gray-800/50 px-6 py-5 border-y border-gray-200 dark:border-gray-700">
                    <TripSummary booking={booking} query={query} />
                </div>
                
                <div className="p-6 flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-4 gap-3">
                    <button 
                        type="button"
                        onClick={onClose}
                        className="w-full sm:w-auto text-[#652D8E] border-2 border-[#652D8E] font-bold py-3 px-6 rounded-lg hover:bg-[#652D8E]/10 transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#652D8E] dark:text-purple-300 dark:border-purple-300 dark:hover:bg-purple-300/10 dark:focus:ring-offset-gray-800"
                    >
                        Go Back
                    </button>
                    <button 
                        type="button"
                        onClick={onConfirm}
                        className="w-full sm:w-auto flex items-center justify-center gap-2 bg-[#652D8E] dark:bg-purple-600 text-white font-bold py-3 px-6 rounded-lg hover:opacity-90 transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#652D8E] dark:focus:ring-offset-gray-800 shadow-lg"
                    >
                        <span>Continue to Passenger Info</span>
                        <ArrowRightIcon className="h-5 w-5" />
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ConfirmationModal;