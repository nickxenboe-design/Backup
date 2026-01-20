import React, { useState, useRef, useEffect } from 'react';
import PassengersPopover from './PassengersPopover';
import { UsersIcon } from './icons';

interface PassengersInputProps {
  adults: number;
  children: number;
  childrenAges: number[];
  onAdultsChange: (newCount: number) => void;
  onChildrenChange: (newCount: number) => void;
  onChildrenAgesChange: (ages: number[]) => void;
}

const PassengersInput: React.FC<PassengersInputProps> = ({ adults, children, childrenAges, onAdultsChange, onChildrenChange, onChildrenAgesChange }) => {
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsPopoverOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const totalPassengers = adults + children;
  const passengerText = `${totalPassengers} Passenger${totalPassengers !== 1 ? 's' : ''}`;
  const ariaLabel = `Select number of passengers. Current selection: ${passengerText}`;

  return (
    <div ref={containerRef} className="relative flex-1">
      <button
        type="button"
        onClick={() => setIsPopoverOpen(!isPopoverOpen)}
        className="w-full text-left p-1 group bg-gray-100 hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#652D8E] dark:focus:ring-purple-500 rounded-md lg:rounded-none transition-colors duration-200 h-full dark:bg-gray-700/50 dark:hover:bg-gray-700"
        aria-haspopup="true"
        aria-expanded={isPopoverOpen}
        aria-label={ariaLabel}
      >
        <div className="block text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-0.5">
          Passengers
        </div>
        <div className="flex items-center">
          <UsersIcon className="h-4 w-4 text-gray-400" />
          <span className="ml-2 text-sm font-semibold text-[#652D8E] dark:text-purple-200">{passengerText}</span>
        </div>
      </button>
      {isPopoverOpen && (
        <>
          <div className="absolute top-full right-0 mt-2 z-50">
            <PassengersPopover
              adults={adults}
              children={children}
              childrenAges={childrenAges}
              onAdultsChange={onAdultsChange}
              onChildrenChange={onChildrenChange}
              onChildrenAgesChange={onChildrenAgesChange}
              onClose={() => setIsPopoverOpen(false)}
            />
          </div>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsPopoverOpen(false)}
            aria-hidden="true"
          />
        </>
      )}
    </div>
  );
};

export default PassengersInput;
