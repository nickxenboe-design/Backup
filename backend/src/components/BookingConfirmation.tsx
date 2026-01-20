import React from 'react';
import { BusRoute, SearchQuery } from '@/utils/api';
import { BookingDetails } from '@/types';
import { CheckCircleIcon, ArrowRightIcon, PrinterIcon } from './icons';

interface BookingConfirmationProps {
    booking: { outbound: BusRoute; inbound: BusRoute | null };
    query: SearchQuery;
    details: BookingDetails;
    onNewBooking: () => void;
    onViewTickets?: () => void;
    pnr?: string;
}

const BookingConfirmation: React.FC<BookingConfirmationProps> = ({ details, onNewBooking, onViewTickets }) => {
    const isInStorePayment = (details.paymentMethod || '').toLowerCase() === 'in-store';

    return (
        <div className="max-w-xl mx-auto animate-fade-in py-8">
            <div className="text-center">
                <CheckCircleIcon className="h-10 w-10 text-green-500 mx-auto" />
                <h1 className="mt-3 text-xl font-bold text-[#652D8E] dark:text-purple-300 tracking-tight">
                    Booking Successful!
                </h1>
                <p className="mt-2 text-[13px] text-gray-600 dark:text-gray-300">
                    A confirmation email has been sent to {details.contactInfo.email}.
                </p>
                <p className="mt-2 text-[13px] text-gray-600 dark:text-gray-300">
                    {isInStorePayment
                        ? 'You selected In-Store payment. Please complete payment at a Pick n Pay store using the reservation details in your email.'
                        : 'Your ticket(s) are ready. Use the button below to get your ticket(s).'}
                </p>
            </div>

            <div className="mt-6 text-center flex flex-col sm:flex-row items-center justify-center gap-2">
                {!isInStorePayment && (
                    <button
                        type="button"
                        onClick={() => {
                            if (onViewTickets) {
                                onViewTickets();
                            } else {
                                window.print();
                            }
                        }}
                        className="inline-flex items-center justify-center gap-2 w-full sm:w-auto text-[#652D8E] border-2 border-[#652D8E] font-bold py-2 px-3 rounded-lg hover:bg-[#652D8E]/10 transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#652D8E] dark:text-purple-300 dark:border-purple-300 dark:hover:bg-purple-300/10 dark:focus:ring-offset-gray-950 transform hover:scale-105 text-xs"
                    >
                        <PrinterIcon className="h-4 w-4" />
                        <span>Get Ticket(s)</span>
                    </button>
                )}

                <button
                    onClick={onNewBooking}
                    className="btn-primary inline-flex items-center justify-center gap-2 w-full sm:w-auto py-2 px-3 transform hover:scale-105 shadow-lg text-xs"
                >
                    <span>Book Another Trip</span>
                    <ArrowRightIcon className="h-4 w-4" />
                </button>
            </div>
        </div>
    );
};

export default BookingConfirmation;