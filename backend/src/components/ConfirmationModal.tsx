import React, { useRef } from 'react';
import { BusRoute, SearchQuery } from '@/utils/api';
import TripSummary from './TripSummary';
import { CheckCircleIcon, ArrowRightIcon } from './icons';

interface ConfirmationModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    booking: { outbound: BusRoute; inbound: BusRoute | null };
    query: SearchQuery;
    maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';
}

const ConfirmationModal: React.FC<ConfirmationModalProps> = ({ isOpen, onClose, onConfirm, booking, query, maxWidth }) => {
    const modalRef = useRef<HTMLDivElement>(null);

    if (!isOpen) return null;

    const sizeClass = ({
        sm: 'max-w-sm',
        md: 'max-w-md',
        lg: 'max-w-lg',
        xl: 'max-w-xl',
        '2xl': 'max-w-2xl',
        '3xl': 'max-w-3xl',
    } as const)[maxWidth || 'lg'];

    return (
        <div 
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-2 sm:p-3"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirmation-modal-title"
        >
            <div 
                ref={modalRef}
                className={`relative bg-white dark:bg-gray-800 rounded-lg sm:rounded-xl shadow-xl w-full ${sizeClass} max-h-[90vh] overflow-y-auto animate-fade-in-down border border-gray-200 dark:border-gray-700`}
            >
                <div className="p-2.5">
                    <div className="flex items-center">
                        <CheckCircleIcon className="h-4 w-4 text-green-500" />
                        <h2 id="confirmation-modal-title" className="ml-2 text-sm font-bold text-[#652D8E] dark:text-purple-300">
                            Confirm Your Trip
                        </h2>
                    </div>
                    <p className="mt-1 text-[11px] text-gray-600 dark:text-gray-300">
                        Please review your selected trip details below before proceeding to enter passenger information and payment details.
                    </p>
                </div>

                <div className="bg-gray-50 dark:bg-gray-800/50 px-3 py-2.5 border-y border-gray-200 dark:border-gray-700 text-xs">
                    <TripSummary booking={booking} query={query} compact />
                </div>
                
                <div className="p-2.5 flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2.5 gap-2">
                    <button 
                        type="button"
                        onClick={onClose}
                        className="w-full sm:w-auto text-[#652D8E] border border-[#652D8E] font-semibold py-2 px-3 rounded-md text-xs hover:bg-[#652D8E]/10 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-[#652D8E] dark:text-purple-300 dark:border-purple-300 dark:hover:bg-purple-300/10 dark:focus:ring-offset-gray-800"
                    >
                        Go Back
                    </button>
                    <button 
                        type="button"
                        onClick={onConfirm}
                        className="btn-primary w-full sm:w-auto flex items-center justify-center gap-1.5 py-2 px-3 text-xs shadow-md"
                    >
                        <span>Continue to Passenger Info</span>
                        <ArrowRightIcon className="h-4 w-4" />
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ConfirmationModal;