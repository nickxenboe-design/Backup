import React, { useState, useEffect } from 'react';
import { BusRoute, SearchQuery, timestampToLocaleTime, timestampToISO } from '../utils/api';
import { BookingDetails, Passenger } from '../types';
import { CheckCircleIcon, ArrowRightIcon, CreditCardIcon, UserCircleIcon, AtSymbolIcon, PhoneIcon, PayPalIcon, GooglePayIcon, StoreIcon, PrinterIcon, XIcon, ClipboardCopyIcon, ClipboardCheckIcon, CalendarIcon, LocationIcon, DownloadIcon } from './icons';
import TripSummary from './TripSummary';

interface BookingConfirmationProps {
    booking: { outbound: BusRoute; inbound: BusRoute | null };
    query: SearchQuery;
    details: BookingDetails;
    onNewBooking: () => void;
}

const InfoCard: React.FC<{ title: string, children: React.ReactNode, className?: string }> = ({ title, children, className }) => (
    <div className={`bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-md border border-gray-200 dark:border-gray-700 ${className || ''}`}>
        <h3 className="text-xl font-bold text-[#652D8E] dark:text-purple-300 mb-4 border-b border-gray-200 dark:border-gray-700 pb-3">{title}</h3>
        {children}
    </div>
);

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
    <div className="flex items-start text-sm">
        <div className="flex-shrink-0 h-4 w-4 text-gray-400 mt-0.5">{icon}</div>
        <div className="ml-2">
            <span className="font-semibold text-gray-600 dark:text-gray-300">{label}:</span>
            <span className="ml-1 text-gray-800 dark:text-gray-200">{value}</span>
        </div>
    </div>
);

const formatPassengerDOB = (dob: string): string => {
    const iso = timestampToISO(dob + 'T00:00:00');
    if (!iso) return 'Invalid Date';

    try {
        const date = new Date(iso);
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    } catch (e) {
        console.error('Error formatting DOB:', e);
        return 'Invalid Date';
    }
};

const PassengerDetailsCard: React.FC<{ passenger: Passenger, index: number }> = ({ passenger, index }) => (
    <div className="border-t border-gray-200 dark:border-gray-700 pt-4 first:pt-0 first:border-t-0">
        <div className="flex justify-between items-center">
            <h4 className="font-bold text-base text-[#652D8E] dark:text-purple-300">
                Passenger {index + 1}: {passenger.firstName} {passenger.lastName}
            </h4>
            <span className="text-sm capitalize text-gray-500 bg-gray-100 dark:bg-gray-700 dark:text-gray-300 px-2 py-1 rounded-md">
                {passenger.type}
            </span>
        </div>
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
            <PassengerDetailRow icon={<CalendarIcon />} label="DOB" value={formatPassengerDOB(passenger.dob)} />
            <PassengerDetailRow icon={<UserCircleIcon />} label="Gender" value={passenger.gender.charAt(0).toUpperCase() + passenger.gender.slice(1)} />
            <PassengerDetailRow icon={<LocationIcon />} label="Nationality" value={passenger.nationality} />
            <PassengerDetailRow icon={<CreditCardIcon />} label={passenger.idType.replace('_', ' ')} value={passenger.idNumber} />
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

const BookingConfirmation: React.FC<BookingConfirmationProps> = ({ booking, query, details, onNewBooking }) => {
    const [referenceNumber, setReferenceNumber] = useState<string | null>(null);
    const [isCopied, setIsCopied] = useState(false);
    const [showReferenceCard, setShowReferenceCard] = useState(true);

    useEffect(() => {
        if (details.paymentMethod === 'In-Store') {
            const generateRef = () => 'NTG-' + Math.random().toString(36).substring(2, 8).toUpperCase();
            setReferenceNumber(generateRef());
            setShowReferenceCard(true);
        } else {
            setReferenceNumber(null);
        }
    }, [details.paymentMethod]);
    
    const handleCopy = () => {
        if (referenceNumber) {
            navigator.clipboard.writeText(referenceNumber).then(() => {
                setIsCopied(true);
                setTimeout(() => setIsCopied(false), 2000); // Reset after 2 seconds
            });
        }
    };

    const handleDownload = () => {
        if (!referenceNumber) return;

        const { outbound, inbound } = booking;
        const totalPassengers = query.passengers.adults + query.passengers.children;
        const outboundTotalPrice = outbound.price * totalPassengers;
        const inboundTotalPrice = inbound ? inbound.price * totalPassengers : 0;
        const totalPrice = outboundTotalPrice + inboundTotalPrice;
        const formattedOutboundDate = formatDateForDisplay(query.departureDate);
        const formattedInboundDate = query.returnDate ? formatDateForDisplay(query.returnDate) : '';

        const fileContent = `
NATIONAL TICKETS GLOBAL - In-Store Payment Reference
===================================================

Booking Reference: ${referenceNumber}

Please present this reference number at the store to complete your payment.

Trip Summary:
----------------
Origin: ${outbound.origin}
Destination: ${outbound.destination}
Trip Type: ${inbound ? 'Round-trip' : 'One-way'}

Outbound Journey:
- Date: ${formattedOutboundDate}
- Operator: ${outbound.busCompany}
- Departs: ${outbound.departureTime}
- Arrives: ${outbound.arrivalTime}

${inbound ? `
Return Journey:
- Date: ${formattedInboundDate}
- Operator: ${inbound.busCompany}
- Departs: ${inbound.departureTime}
- Arrives: ${inbound.arrivalTime}
` : ''}

Passengers: ${totalPassengers}
Total Price: $${totalPrice.toFixed(2)}

Contact Email: ${details.contactInfo.email}
`;

        const blob = new Blob([fileContent.trim()], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Booking-Reference-${referenceNumber}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };


    return (
        <div className="max-w-4xl mx-auto animate-fade-in py-8 printable-area">
            {/* Print-only header */}
            <div className="print-header">
                <div className="flex items-center gap-3">
                    <img src="/logo-main/natticks-logo1.jpeg" alt="National Tickets Global" className="h-16 w-auto" />
                    <div>
                        <h1 className="text-xl font-bold">National Tickets Global</h1>
                        <p className="text-sm">Your E-Ticket</p>
                    </div>
                </div>
                {referenceNumber && (
                    <div className="text-right">
                        <p className="text-sm font-bold">Booking Reference</p>
                        <p className="font-mono text-lg">{referenceNumber}</p>
                    </div>
                )}
            </div>
            
            <div className="text-center mb-8 no-print">
                <CheckCircleIcon className="h-16 w-16 text-green-500 mx-auto" />
                <h1 className="mt-4 text-4xl font-bold text-[#652D8E] dark:text-purple-300 tracking-tight">Booking Successful!</h1>
                <p className="mt-2 text-lg text-gray-600 dark:text-gray-300">Your trip is confirmed. A confirmation email has been sent to {details.contactInfo.email}.</p>
            </div>

            {referenceNumber && showReferenceCard && (
                <div className="relative bg-purple-50 dark:bg-purple-900/30 border-2 border-dashed border-purple-300 dark:border-purple-700 p-6 rounded-2xl mb-8 animate-fade-in-down print-reference-card">
                    <button 
                        onClick={() => setShowReferenceCard(false)} 
                        className="absolute top-3 right-3 p-1 rounded-full hover:bg-purple-200/50 dark:hover:bg-purple-800/50 transition-colors no-print"
                        aria-label="Dismiss"
                    >
                        <XIcon className="h-5 w-5 text-purple-600 dark:text-purple-300" />
                    </button>
                    <div className="flex items-center mb-4">
                        <StoreIcon className="h-8 w-8 text-purple-600 dark:text-purple-300" />
                        <h2 className="ml-3 text-2xl font-bold text-purple-800 dark:text-purple-200">In-Store Payment Reference</h2>
                    </div>
                    <p className="text-gray-700 dark:text-gray-300 mb-4">
                        Please present this reference number at the store to complete your payment and receive your tickets.
                    </p>
                    <div className="bg-white dark:bg-gray-800 rounded-lg p-4 flex items-center justify-between gap-4 flex-wrap">
                        <span className="text-2xl md:text-3xl font-bold text-gray-800 dark:text-gray-100 font-mono tracking-widest break-all">
                            {referenceNumber}
                        </span>
                         <div className="flex items-center gap-2 flex-shrink-0">
                            <button 
                                onClick={handleCopy} 
                                className="flex items-center gap-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 font-semibold px-4 py-2 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors no-print"
                            >
                                {isCopied ? <ClipboardCheckIcon className="h-5 w-5 text-green-500" /> : <ClipboardCopyIcon className="h-5 w-5" />}
                                {isCopied ? 'Copied!' : 'Copy'}
                            </button>
                            <button
                                onClick={handleDownload}
                                className="flex items-center gap-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 font-semibold px-4 py-2 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors no-print"
                            >
                                <DownloadIcon className="h-5 w-5" />
                                <span>Download</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="space-y-6">
                <InfoCard title="Trip Itinerary" className="print-card">
                    <TripSummary booking={booking} query={query} />
                </InfoCard>

                <InfoCard title="Passengers" className="print-card">
                     <div className="space-y-4">
                        {details.passengers.map((passenger, index) => (
                           <PassengerDetailsCard key={index} passenger={passenger} index={index} />
                        ))}
                    </div>
                </InfoCard>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <InfoCard title="Contact Information" className="print-card">
                        <div className="space-y-4">
                            <div className="flex items-start">
                                <div className="flex-shrink-0 h-6 w-6 text-gray-400"><UserCircleIcon/></div>
                                <div className="ml-3">
                                    <p className="text-sm text-gray-500 dark:text-gray-400">Name</p>
                                    <p className="font-semibold text-[#652D8E] dark:text-purple-300">{`${details.contactInfo.firstName} ${details.contactInfo.lastName}`}</p>
                                </div>
                            </div>
                            <div className="flex items-start">
                                <div className="flex-shrink-0 h-6 w-6 text-gray-400"><AtSymbolIcon/></div>
                                <div className="ml-3">
                                    <p className="text-sm text-gray-500 dark:text-gray-400">Email</p>
                                    <p className="font-semibold text-[#652D8E] dark:text-purple-300">{details.contactInfo.email}</p>
                                </div>
                            </div>
                            <div className="flex items-start">
                                <div className="flex-shrink-0 h-6 w-6 text-gray-400"><PhoneIcon/></div>
                                <div className="ml-3">
                                    <p className="text-sm text-gray-500 dark:text-gray-400">Phone</p>
                                    <p className="font-semibold text-[#652D8E] dark:text-purple-300">{details.contactInfo.phone}</p>
                                </div>
                            </div>
                        </div>
                    </InfoCard>
                    <InfoCard title="Payment Details" className="print-card">
                        <div className="flex items-center">
                            {getPaymentIcon(details.paymentMethod)}
                            <span className="font-semibold text-[#652D8E] dark:text-purple-300">{details.paymentMethod}</span>
                        </div>
                    </InfoCard>
                </div>
            </div>

            <div className="mt-10 text-center flex flex-col sm:flex-row items-center justify-center gap-4 no-print">
                <button
                    type="button"
                    onClick={() => window.print()}
                    className="inline-flex items-center justify-center gap-2 w-full sm:w-auto text-[#652D8E] border-2 border-[#652D8E] font-bold py-3 px-8 rounded-lg hover:bg-[#652D8E]/10 transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#652D8E] dark:text-purple-300 dark:border-purple-300 dark:hover:bg-purple-300/10 dark:focus:ring-offset-gray-950 transform hover:scale-105"
                >
                    <PrinterIcon className="h-5 w-5" />
                    <span>Print Ticket</span>
                </button>
                <button
                    onClick={onNewBooking}
                    className="inline-flex items-center justify-center gap-2 w-full sm:w-auto bg-[#652D8E] dark:bg-purple-600 text-white font-bold py-3 px-8 rounded-lg hover:opacity-90 transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#652D8E] dark:focus:ring-offset-gray-950 transform hover:scale-105 shadow-lg"
                >
                    <span>Book Another Trip</span>
                    <ArrowRightIcon className="h-5 w-5" />
                </button>
            </div>
        </div>
    );
};

export default BookingConfirmation;