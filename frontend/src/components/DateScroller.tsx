import React, { useState, useEffect, useMemo } from 'react';
import { ChevronLeftIcon, ChevronRightIcon } from './icons';
import { timestampToISO } from '@/utils/api';

interface DateScrollerProps {
    selectedDate: string;
    onDateSelect: (date: string) => void;
    loading: boolean;
    fullWidth?: boolean;
    dateMeta?: Record<string, { price?: number | null; unavailable?: boolean; loading?: boolean }>;
    onVisibleDatesChange?: (dates: string[]) => void;
}

const formatDate = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const DateScroller: React.FC<DateScrollerProps> = ({ selectedDate, onDateSelect, loading, fullWidth, dateMeta, onVisibleDatesChange }) => {
    // Initialize centerDate based on the selectedDate prop safely
    const [centerDate, setCenterDate] = useState(() => {
        const iso = timestampToISO(selectedDate + 'T00:00:00');
        return iso ? new Date(iso) : new Date();
    });

    // Effect to update the centerDate if the selectedDate prop changes from the parent
    useEffect(() => {
        const iso = timestampToISO(selectedDate + 'T00:00:00');
        setCenterDate(iso ? new Date(iso) : new Date());
    }, [selectedDate]);

    const displayedDates = useMemo(() => {
        const dates: Date[] = [];
        const start = new Date(centerDate);
        start.setDate(start.getDate() - 3); // Center the week around the centerDate

        for (let i = 0; i < 7; i++) {
            const date = new Date(start);
            date.setDate(start.getDate() + i);
            dates.push(date);
        }
        return dates;
    }, [centerDate]);

    useEffect(() => {
        onVisibleDatesChange?.(displayedDates.map((d) => formatDate(d)));
    }, [displayedDates, onVisibleDatesChange]);

    const today = useMemo(() => {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        return d;
    }, []);

    const handlePrev = () => {
        const newCenterDate = new Date(centerDate);
        newCenterDate.setDate(centerDate.getDate() - 7);
        setCenterDate(newCenterDate);
    };

    const handleNext = () => {
        const newCenterDate = new Date(centerDate);
        newCenterDate.setDate(centerDate.getDate() + 7);
        setCenterDate(newCenterDate);
    };

    const isPrevDisabled = useMemo(() => {
        const lastDayOfPrevWeek = new Date(displayedDates[0]);
        lastDayOfPrevWeek.setDate(lastDayOfPrevWeek.getDate() - 1);
        return lastDayOfPrevWeek < today;
    }, [displayedDates, today]);

    const wrapperClass = fullWidth ? "relative w-full" : "relative w-[65%] mx-auto";
    return (
        <div className={wrapperClass}>
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-200/80 dark:border-gray-700 p-1">
                <div className="flex items-center justify-between">
                    <button
                        onClick={handlePrev}
                        disabled={isPrevDisabled || loading}
                        className="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        aria-label="Previous week"
                    >
                        <ChevronLeftIcon className="h-3 w-3 text-[#652D8E] dark:text-purple-300" />
                    </button>
                    
                    <div className="flex-grow grid grid-cols-7 gap-0.5 text-center">
                        {displayedDates.map((date, index) => {
                            const dateString = formatDate(date);
                            const isSelected = dateString === selectedDate;
                            const isPast = date < today;
                            const meta = dateMeta?.[dateString];
                            const isUnavailable = !!meta?.unavailable;
                            const isMetaLoading = !!meta?.loading;
                            const isDisabled = isPast || loading || isUnavailable;

                            return (
                                <button
                                    key={index}
                                    onClick={() => onDateSelect(dateString)}
                                    disabled={isDisabled}
                                    className={`p-1 rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed ${
                                        isSelected
                                            ? 'bg-[#652D8E] dark:bg-purple-600 text-white shadow-lg shadow-[#652D8E]/20 dark:shadow-purple-600/20'
                                            : 'bg-transparent text-[#652D8E] dark:text-purple-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                                    }`}
                                    aria-pressed={isSelected}
                                    aria-label={
                                      `${date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}` +
                                      (isUnavailable ? ' (Sold out)' : (typeof meta?.price === 'number' ? ` (From $${meta.price.toFixed(2)})` : ''))
                                    }
                                >
                                    <div className="text-[10px] font-bold uppercase">
                                        {date.toLocaleDateString('en-US', { weekday: 'short' })}
                                    </div>
                                    <div className="text-sm font-bold mt-1">
                                        {date.getDate()}
                                    </div>
                                    <div className={`text-[10px] font-semibold mt-0.5 ${
                                      isSelected ? 'text-white/90' : 'text-gray-500 dark:text-gray-400'
                                    }`}>
                                        {isUnavailable
                                            ? 'Sold out'
                                            : isMetaLoading
                                                ? '…'
                                                : typeof meta?.price === 'number'
                                                    ? `$${meta.price.toFixed(2)}`
                                                    : ''}
                                    </div>
                                </button>
                            );
                        })}
                    </div>

                    <button
                        onClick={handleNext}
                        disabled={loading}
                        className="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        aria-label="Next week"
                    >
                        <ChevronRightIcon className="h-3 w-3 text-[#652D8E] dark:text-purple-300" />
                    </button>
                </div>
            </div>
        </div>
    );
};

export default DateScroller;