import React, { useEffect, useRef } from 'react';
import { BusRoute, SearchQuery } from '@/utils/api';
import TripSummary from './TripSummary';
import { CheckCircleIcon, ArrowRightIcon, ChevronLeftIcon, LockClosedIcon } from './icons';

interface ConfirmationModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    booking: { outbound: BusRoute; inbound: BusRoute | null };
    query: SearchQuery;
    maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';
    onChangeRequested?: (section: 'route' | 'date' | 'passengers') => void;
}

const ConfirmationModal: React.FC<ConfirmationModalProps> = ({ isOpen, onClose, onConfirm, booking, query, maxWidth, onChangeRequested }) => {
    const modalRef = useRef<HTMLDivElement>(null);

    const handleCloseRequested = () => {
        try {
            if (typeof window !== 'undefined') {
                const ok = window.confirm('Are you sure? If you leave this screen, your reservation may be released.');
                if (!ok) return;
            }
        } catch {}
        onClose();
    };

    useEffect(() => {
        if (!isOpen) return;

        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            e.preventDefault();
            e.returnValue = 'Are you sure? Your reservation may be released.';
            return 'Are you sure? Your reservation may be released.';
        };

        const handlePopState = () => {
            try {
                if (typeof window !== 'undefined') {
                    const ok = window.confirm('Are you sure? If you leave this screen, your reservation may be released.');
                    if (!ok) {
                        try {
                            window.history.pushState({ __confirmModal: true }, '');
                        } catch {}
                        return;
                    }
                }
            } catch {
                try {
                    window.history.pushState({ __confirmModal: true }, '');
                } catch {}
                return;
            }
            onClose();
        };

        if (typeof window !== 'undefined') {
            try {
                window.history.pushState({ __confirmModal: true }, '');
            } catch {}
            window.addEventListener('beforeunload', handleBeforeUnload);
            window.addEventListener('popstate', handlePopState);
            return () => {
                window.removeEventListener('beforeunload', handleBeforeUnload);
                window.removeEventListener('popstate', handlePopState);
            };
        }
        return;
    }, [isOpen, onClose]);

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
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-gray-700 dark:text-gray-200">
                        <span className="inline-flex items-center gap-1 rounded-full bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-200 px-2 py-0.5 font-semibold">
                            <CheckCircleIcon className="h-3.5 w-3.5" />
                            We’ll hold your selected trip for the next 10 minutes
                        </span>
                    </div>

                    <div className="mt-2 text-[10px] font-semibold text-gray-500 dark:text-gray-400">
                        <span className="text-gray-400 dark:text-gray-500">Search</span>
                        <span className="mx-1">→</span>
                        <span className="text-gray-400 dark:text-gray-500">Select</span>
                        <span className="mx-1">→</span>
                        <span className="text-[#652D8E] dark:text-purple-300">Confirm</span>
                        <span className="mx-1">→</span>
                        <span className="text-gray-400 dark:text-gray-500">Passenger Info</span>
                        <span className="mx-1">→</span>
                        <span className="text-gray-400 dark:text-gray-500">Payment</span>
                    </div>
                </div>

                <div className="bg-gray-50 dark:bg-gray-800/50 px-3 py-2.5 border-y border-gray-200 dark:border-gray-700 text-xs">
                    <TripSummary booking={booking} query={query} compact onChangeRequested={onChangeRequested} />
                </div>

                <div className="sticky bottom-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 p-2.5">
                    <div className="flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2.5 gap-2">
                        <button
                            type="button"
                            onClick={() => {
                                if (onChangeRequested) {
                                    onChangeRequested('route');
                                    return;
                                }
                                handleCloseRequested();
                            }}
                            className="w-full sm:w-auto text-[#652D8E] border border-[#652D8E] font-semibold py-2 px-3 rounded-md text-xs hover:bg-[#652D8E]/10 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-[#652D8E] dark:text-purple-300 dark:border-purple-300 dark:hover:bg-purple-300/10 dark:focus:ring-offset-gray-800 inline-flex items-center justify-center gap-1.5"
                        >
                            <ChevronLeftIcon className="h-4 w-4" />
                            <span>Change trip details</span>
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

                    <div className="mt-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5">
                        <div className="text-[10px] text-gray-600 dark:text-gray-300">
                            You’ll enter passenger details next. Payment comes after.
                        </div>
                        <div className="inline-flex items-center gap-1 text-[10px] font-semibold text-gray-500 dark:text-gray-400">
                            <LockClosedIcon className="h-3.5 w-3.5" />
                            Secure checkout
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ConfirmationModal;