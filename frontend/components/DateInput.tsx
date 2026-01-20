import React, { forwardRef, useCallback, useMemo, useState } from 'react';
import { format, isToday, isSameDay, isValid, addDays, startOfWeek, addMonths, isSameMonth, isSameYear, getDay, getDaysInMonth, getWeeksInMonth, eachDayOfInterval, eachWeekOfInterval, isBefore, isAfter, endOfMonth, startOfMonth } from 'date-fns';
import { CalendarIcon, CalendarPlusIcon, ChevronLeftIcon, ChevronRightIcon } from './icons';
import './DatePicker.css';

interface DateInputProps {
  id: string;
  label: string;
  value: string | null | undefined;
  onDateChange: (date: string) => void;
  minDate?: Date;
  placeholder?: string;
}

const CustomInput = forwardRef<HTMLButtonElement, {
  value?: string;
  onClick?: () => void;
  label: string;
  selectedDate: Date | null;
  placeholder: string;
}>(({ onClick, label, selectedDate, placeholder }, ref) => {
  const displayValue = selectedDate 
    ? format(selectedDate, 'EEEE, MMM d')
    : placeholder;
  
  const Icon = selectedDate ? CalendarIcon : CalendarPlusIcon;
  
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      className="w-full text-left p-4 group rounded-lg lg:rounded-none bg-gray-100 hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#652D8E] dark:focus:ring-purple-500 transition-colors duration-200 h-full dark:bg-gray-700/50 dark:hover:bg-gray-700 flex flex-col justify-center"
    >
      <div className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
        {label}
      </div>
      <div className="flex items-center">
        <Icon className="h-6 w-6 text-gray-400" />
        <span className={`w-full ml-3 text-lg ${selectedDate ? 'text-black dark:text-white' : 'text-gray-500 dark:text-gray-400'}`}>
          {displayValue}
        </span>
      </div>
    </button>
  );
});

const DateInput: React.FC<DateInputProps> = ({ 
  id, 
  label, 
  value, 
  onDateChange, 
  minDate = new Date(),
  placeholder = 'Select date' 
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  
  const selectedDate = useMemo(() => {
    if (!value) return null;
    try {
      const date = new Date(value + 'T00:00:00');
      return isValid(date) ? date : null;
    } catch (e) {
      console.error("❌ [DateInput] Failed to parse date:", e, value);
      return null;
    }
  }, [value]);

  const handleDateClick = useCallback((date: Date) => {
    if (minDate && isBefore(date, minDate)) return;
    const dateString = format(date, 'yyyy-MM-dd');
    onDateChange(dateString);
    setIsOpen(false);
  }, [onDateChange, minDate]);

  const toggleCalendar = useCallback(() => {
    setIsOpen(prev => !prev);
  }, []);

  const closeCalendar = useCallback(() => {
    setIsOpen(false);
  }, []);

  const nextMonth = useCallback(() => {
    setCurrentMonth(addMonths(currentMonth, 1));
  }, [currentMonth]);

  const prevMonth = useCallback(() => {
    if (minDate && isSameMonth(currentMonth, minDate) && isSameYear(currentMonth, minDate)) return;
    setCurrentMonth(addMonths(currentMonth, -1));
  }, [currentMonth, minDate]);

  // Generate days of the month in column format
  const renderCalendarDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 1 });
    const end = endOfMonth(currentMonth);
    const daysInMonth = eachDayOfInterval({ start, end });
    
    // Group days by day of week (0-6, where 0 is Monday)
    const daysByWeekday: Date[][] = Array(7).fill(null).map(() => []);
    
    daysInMonth.forEach(day => {
      const dayOfWeek = (getDay(day) + 6) % 7; // Convert to 0-6 where 0 is Monday
      daysByWeekday[dayOfWeek].push(day);
    });

    return daysByWeekday;
  }, [currentMonth]);

  const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  return (
    <div className="relative flex-1">
      <CustomInput
        label={label}
        selectedDate={selectedDate}
        placeholder={placeholder}
        onClick={toggleCalendar}
      />
      
      {isOpen && (
        <div className="absolute z-50 mt-1">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 p-4 w-[250px] h-[250px] overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
              <button
                onClick={prevMonth}
                disabled={minDate && isSameMonth(currentMonth, minDate) && isSameYear(currentMonth, minDate)}
                type="button"
                className="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronLeftIcon className="h-5 w-5 text-gray-500" />
              </button>
              <div className="text-base font-semibold text-[#652D8E] dark:text-purple-300">
                {format(currentMonth, 'MMMM yyyy')}
              </div>
              <button
                onClick={nextMonth}
                type="button"
                className="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <ChevronRightIcon className="h-5 w-5 text-gray-500" />
              </button>
            </div>

            {/* Calendar Grid */}
            <div className="grid grid-cols-7 gap-1.5 text-xs">
              {/* Weekday Headers */}
              {weekdays.map((day) => (
                <div key={day} className="text-center text-xs font-medium text-gray-500 dark:text-gray-400 py-1">
                  {day}
                </div>
              ))}

              {/* Days */}
              {renderCalendarDays.map((days, dayIndex) => (
                <div key={dayIndex} className="flex flex-col space-y-1">
                  {days.map((date, index) => {
                    const isCurrentMonth = isSameMonth(date, currentMonth);
                    const isSelected = selectedDate && isSameDay(date, selectedDate);
                    const isTodayDate = isToday(date);
                    const isDisabled = minDate && isBefore(date, minDate);
                    
                    return (
                      <button
                        key={index}
                        onClick={() => handleDateClick(date)}
                        disabled={isDisabled}
                        className={`
                          w-7 h-7 flex items-center justify-center rounded-full text-xs font-medium m-0.5
                          transition-colors duration-150
                          ${!isCurrentMonth ? 'text-gray-300 dark:text-gray-600' : ''}
                          ${isSelected 
                            ? 'bg-[#652D8E] text-white' 
                            : isTodayDate 
                              ? 'bg-[#652D8E]/10 dark:bg-purple-300/20 border-2 border-[#652D8E] dark:border-purple-300 font-bold text-[#652D8E] dark:text-purple-300' 
                              : 'text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700'
                          }
                          ${isDisabled ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed' : 'cursor-pointer'}
                        `}
                      >
                        {format(date, 'd')}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      
      {isOpen && (
        <div 
          className="fixed inset-0 z-40"
          onClick={closeCalendar}
          aria-hidden="true"
        />
      )}
    </div>
  );
};

export default React.memo(DateInput);
