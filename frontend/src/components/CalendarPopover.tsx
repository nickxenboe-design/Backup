import React, { useState } from 'react';
import { ChevronLeftIcon, ChevronRightIcon } from './icons';

interface CalendarPopoverProps {
  selectedDate: Date | null;
  onDateSelect: (date: Date) => void;
  onClose: () => void;
  minDate?: Date;
  maxDate?: Date;
}

const CalendarPopover: React.FC<CalendarPopoverProps> = ({ selectedDate, onDateSelect, onClose, minDate, maxDate }) => {
  const [displayDate, setDisplayDate] = useState(selectedDate || maxDate || minDate || new Date());
  const [isYearMode, setIsYearMode] = useState(false);

  const daysOfWeek = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const startOfMonth = new Date(displayDate.getFullYear(), displayDate.getMonth(), 1);
  const endOfMonth = new Date(displayDate.getFullYear(), displayDate.getMonth() + 1, 0);
  const startDay = startOfMonth.getDay();
  const daysInMonth = endOfMonth.getDate();

  const handlePrevMonth = () => {
    setDisplayDate(new Date(displayDate.getFullYear(), displayDate.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setDisplayDate(new Date(displayDate.getFullYear(), displayDate.getMonth() + 1, 1));
  };

  const handlePrevYear = () => {
    setDisplayDate(new Date(displayDate.getFullYear() - 1, displayDate.getMonth(), 1));
  };

  const handleNextYear = () => {
    setDisplayDate(new Date(displayDate.getFullYear() + 1, displayDate.getMonth(), 1));
  };

  const handleMonthYearClick = () => {
    setIsYearMode(!isYearMode);
  };

  const handleYearSelect = (year: number) => {
    setDisplayDate(new Date(year, displayDate.getMonth(), 1));
    setIsYearMode(false);
  };

  const handleDateClick = (day: number) => {
    const newDate = new Date(displayDate.getFullYear(), displayDate.getMonth(), day);
    onDateSelect(newDate);
    onClose();
  };

  const renderDays = () => {
    const days = [];
    for (let i = 0; i < startDay; i++) {
      days.push(<div key={`blank-${i}`} className="w-6 h-6"></div>);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const currentDate = new Date(displayDate.getFullYear(), displayDate.getMonth(), day);
      const isSelected = selectedDate &&
        selectedDate.getFullYear() === currentDate.getFullYear() &&
        selectedDate.getMonth() === currentDate.getMonth() &&
        selectedDate.getDate() === currentDate.getDate();
      const isToday = today.getTime() === currentDate.getTime();
      
      const isBeforeMinDate = minDate ?
        currentDate.getFullYear() < minDate.getFullYear() ||
        (currentDate.getFullYear() === minDate.getFullYear() && currentDate.getMonth() < minDate.getMonth()) ||
        (currentDate.getFullYear() === minDate.getFullYear() && currentDate.getMonth() === minDate.getMonth() && currentDate.getDate() < minDate.getDate())
        : false;
      const isAfterMaxDate = maxDate ?
        currentDate.getFullYear() > maxDate.getFullYear() ||
        (currentDate.getFullYear() === maxDate.getFullYear() && currentDate.getMonth() > maxDate.getMonth()) ||
        (currentDate.getFullYear() === maxDate.getFullYear() && currentDate.getMonth() === maxDate.getMonth() && currentDate.getDate() > maxDate.getDate())
        : false;
      const isDisabled = isBeforeMinDate || isAfterMaxDate;

      const classes = [
        'w-6 h-6 flex items-center justify-center rounded-full transition-colors duration-200',
        isDisabled ? 'text-gray-400 dark:text-gray-500 cursor-not-allowed' : 'hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer',
        isSelected ? 'bg-[#652D8E] dark:bg-purple-600 text-white font-bold hover:opacity-90' : 'text-[#652D8E] dark:text-purple-300',
        isToday && !isSelected && !isDisabled ? 'border-2 border-[#652D8E] dark:border-purple-400' : '',
      ].join(' ');

      days.push(
        <button
          key={day}
          type="button"
          onClick={() => !isDisabled && handleDateClick(day)}
          disabled={isDisabled}
          className={classes}
          aria-label={`Select date ${day}`}
          aria-pressed={isSelected}
        >
          {day}
        </button>
      );
    }
    return days;
  };

  const renderYearSelector = () => {
    const currentYear = new Date().getFullYear();
    const startYear = currentYear - 50; // Allow selection from 50 years ago
    const endYear = currentYear + 10; // Allow selection up to 10 years in future
    const years = [];
    
    for (let year = startYear; year <= endYear; year++) {
      years.push(
        <button
          key={year}
          type="button"
          onClick={() => handleYearSelect(year)}
          className={`w-8 h-6 flex items-center justify-center rounded-md transition-colors duration-200 ${
            year === displayDate.getFullYear() 
              ? 'bg-[#652D8E] text-white font-bold' 
              : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-[#652D8E] dark:text-purple-300'
          }`}
          aria-label={`Select year ${year}`}
        >
          {year}
        </button>
      );
    }
    
    return (
      <div className="grid grid-cols-5 gap-2 p-4 max-h-80 overflow-y-auto">
        {years}
      </div>
    );
  };

  return (
    <div className="absolute top-full left-0 mt-1 w-64 bg-white rounded-lg shadow-xl border border-gray-200 z-20 p-2 animate-fade-in-down dark:bg-gray-800 dark:border-gray-600">
      <div className="flex items-center justify-between mb-2">
        {/* Year navigation */}
        <button 
          type="button" 
          onClick={handlePrevYear} 
          className="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center" 
          aria-label="Previous year"
        >
          <ChevronLeftIcon className="h-3 w-3 text-[#652D8E] dark:text-purple-300" />
          <ChevronLeftIcon className="h-3 w-3 -ml-2 text-[#652D8E] dark:text-purple-300" />
        </button>

        {/* Month/Year header */}
        <button
          type="button"
          onClick={handleMonthYearClick}
          className="font-semibold text-xs text-[#652D8E] dark:text-purple-300 hover:opacity-80 transition-opacity"
          aria-label={isYearMode ? "Switch to month view" : "Switch to year view"}
        >
          {isYearMode 
            ? `${displayDate.getFullYear()}`
            : displayDate.toLocaleString('default', { month: 'long', year: 'numeric' })
          }
        </button>

        {/* Year navigation */}
        <button 
          type="button" 
          onClick={handleNextYear} 
          className="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center" 
          aria-label="Next year"
        >
          <ChevronRightIcon className="h-3 w-3 text-[#652D8E] dark:text-purple-300" />
          <ChevronRightIcon className="h-3 w-3 -ml-2 text-[#652D8E] dark:text-purple-300" />
        </button>
      </div>

      {isYearMode ? (
        renderYearSelector()
      ) : (
        <>
          <div className="flex items-center justify-between mb-2">
            <button type="button" onClick={handlePrevMonth} className="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700" aria-label="Previous month">
              <ChevronLeftIcon className="h-3 w-3 text-[#652D8E] dark:text-purple-300" />
            </button>
            <div className="font-semibold text-xs text-[#652D8E] dark:text-purple-300">
              {displayDate.toLocaleString('default', { month: 'long' })}
            </div>
            <button type="button" onClick={handleNextMonth} className="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700" aria-label="Next month">
              <ChevronRightIcon className="h-3 w-3 text-[#652D8E] dark:text-purple-300" />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center">
            {daysOfWeek.map(day => (
              <div key={day} className="w-6 h-6 flex items-center justify-center text-[10px] font-semibold text-gray-500 dark:text-gray-400">
                {day}
              </div>
            ))}
            {renderDays()}
          </div>
        </>
      )}
    </div>
  );
};

export default CalendarPopover;
