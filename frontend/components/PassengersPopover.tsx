import React from 'react';
import { PlusIcon, MinusIcon } from './icons';

interface PassengersPopoverProps {
  adults: number;
  children: number;
  onAdultsChange: (newCount: number) => void;
  onChildrenChange: (newCount: number) => void;
  onClose: () => void;
}

interface CounterProps {
  label: string;
  description: string;
  count: number;
  onCountChange: (newCount: number) => void;
  min?: number;
  max?: number;
}

const Counter: React.FC<CounterProps> = ({ label, description, count, onCountChange, min = 0, max = 10 }) => {
  const handleDecrement = () => {
    if (count > min) {
      onCountChange(count - 1);
    }
  };

  const handleIncrement = () => {
    if (count < max) {
      onCountChange(count + 1);
    }
  };

  return (
    <div className="flex items-center justify-between py-3">
      <div>
        <div className="font-semibold text-[#652D8E] dark:text-purple-300">{label}</div>
        <div className="text-sm text-gray-500 dark:text-gray-400">{description}</div>
      </div>
      <div className="flex items-center space-x-4">
        <button
          type="button"
          onClick={handleDecrement}
          disabled={count <= min}
          className="p-1 rounded-full border border-gray-300 dark:border-gray-500 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          aria-label={`Decrease ${label}`}
        >
          <MinusIcon className="h-5 w-5 text-[#652D8E] dark:text-purple-300" />
        </button>
        <span className="text-lg font-semibold w-6 text-center text-[#652D8E] dark:text-purple-300">{count}</span>
        <button
          type="button"
          onClick={handleIncrement}
          disabled={count >= max}
          className="p-1 rounded-full border border-gray-300 dark:border-gray-500 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          aria-label={`Increase ${label}`}
        >
          <PlusIcon className="h-5 w-5 text-[#652D8E] dark:text-purple-300" />
        </button>
      </div>
    </div>
  );
};

const PassengersPopover: React.FC<PassengersPopoverProps> = ({
  adults,
  children,
  onAdultsChange,
  onChildrenChange,
  onClose,
}) => {
  return (
    <div className="absolute top-full right-0 mt-2 w-80 bg-white rounded-lg shadow-xl border border-gray-200 z-20 p-4 animate-fade-in-down dark:bg-gray-800 dark:border-gray-600">
      <Counter
        label="Adults"
        description="Ages 13+"
        count={adults}
        onCountChange={onAdultsChange}
        min={1}
      />
      <div className="border-t border-gray-200 dark:border-gray-700 -mx-4 my-1"></div>
      <Counter
        label="Children"
        description="Ages 2-12"
        count={children}
        onCountChange={onChildrenChange}
        min={0}
      />
      <div className="border-t border-gray-200 dark:border-gray-700 -mx-4 my-2"></div>
      <button
        onClick={onClose}
        className="w-full text-center py-2 px-4 bg-[#652D8E] dark:bg-purple-600 text-white font-semibold rounded-md hover:opacity-90 transition-colors focus:outline-none focus:ring-2 focus:ring-[#652D8E] dark:focus:ring-offset-gray-800"
      >
        Done
      </button>
    </div>
  );
};

export default PassengersPopover;