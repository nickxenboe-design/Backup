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

  const handleDateClick = (day: number) => {
    const newDate = new Date(displayDate.getFullYear(), displayDate.getMonth(), day);
    onDateSelect(newDate);
    onClose();
  };

  const renderDays = () => {
    const days = [];
    for (let i = 0; i < startDay; i++) {
      days.push(<div key={`blank-${i}`} className="w-10 h-10"></div>);
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
        'w-10 h-10 flex items-center justify-center rounded-full transition-colors duration-200',
        isDisabled ? 'text-gray-400 dark:text-gray-500 cursor-not-allowed' : 'hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer',
        isSelected ? 'bg-[#652D8E] dark:bg-purple-600 text-white font-bold hover:opacity-90' : 'text-[#652D8E] dark:text-purple-300',
        isToday && !isSelected && !isDisabled ? 'border-2 border-[#652D8E] dark:border-purple-400' : '',
      ].join(' ');

      days.push(
        <button
          key={day}
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

  return (
    <div className="absolute top-full left-0 mt-2 w-80 bg-white rounded-lg shadow-xl border border-gray-200 z-20 p-4 animate-fade-in-down dark:bg-gray-800 dark:border-gray-600">
      <div className="flex items-center justify-between mb-4">
        <button onClick={handlePrevMonth} className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700" aria-label="Previous month">
          <ChevronLeftIcon className="h-5 w-5 text-[#652D8E] dark:text-purple-300" />
        </button>
        <div className="font-semibold text-lg text-[#652D8E] dark:text-purple-300">
          {displayDate.toLocaleString('default', { month: 'long', year: 'numeric' })}
        </div>
        <button onClick={handleNextMonth} className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700" aria-label="Next month">
          <ChevronRightIcon className="h-5 w-5 text-[#652D8E] dark:text-purple-300" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {daysOfWeek.map(day => (
          <div key={day} className="w-10 h-10 flex items-center justify-center text-xs font-semibold text-gray-500 dark:text-gray-400">
            {day}
          </div>
        ))}
        {renderDays()}
      </div>
    </div>
  );
};

export default CalendarPopover;
