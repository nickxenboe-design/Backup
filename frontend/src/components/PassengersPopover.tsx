import React from 'react';
import { PlusIcon, MinusIcon } from './icons';

interface PassengersPopoverProps {
  adults: number;
  children: number;
  childrenAges: number[];
  onAdultsChange: (newCount: number) => void;
  onChildrenChange: (newCount: number) => void;
  onChildrenAgesChange: (ages: number[]) => void;
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
    <div className="flex items-center justify-between py-1.5">
      <div>
        <div className="text-xs font-semibold text-[#652D8E] dark:text-purple-300">{label}</div>
        <div className="text-[11px] text-gray-500 dark:text-gray-400">{description}</div>
      </div>
      <div className="flex items-center space-x-3">
        <button
          type="button"
          onClick={handleDecrement}
          disabled={count <= min}
          className="p-1 rounded-full border border-gray-300 dark:border-gray-500 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          aria-label={`Decrease ${label}`}
        >
          <MinusIcon className="h-4 w-4 text-[#652D8E] dark:text-purple-300" />
        </button>
        <span className="text-sm font-semibold w-5 text-center text-[#652D8E] dark:text-purple-300">{count}</span>
        <button
          type="button"
          onClick={handleIncrement}
          disabled={count >= max}
          className="p-1 rounded-full border border-gray-300 dark:border-gray-500 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          aria-label={`Increase ${label}`}
        >
          <PlusIcon className="h-4 w-4 text-[#652D8E] dark:text-purple-300" />
        </button>
      </div>
    </div>
  );
};

const PassengersPopover: React.FC<PassengersPopoverProps> = ({
  adults,
  children,
  childrenAges,
  onAdultsChange,
  onChildrenChange,
  onChildrenAgesChange,
  onClose,
}) => {
  const handleChildrenCountChange = (newCount: number) => {
    onChildrenChange(newCount);
    if (newCount > childrenAges.length) {
      const diff = newCount - childrenAges.length;
      const newAges = [...childrenAges, ...Array(diff).fill(5)];
      onChildrenAgesChange(newAges);
    } else {
      onChildrenAgesChange(childrenAges.slice(0, newCount));
    }
  };

  const handleChildAgeChange = (index: number, value: string) => {
    const parsed = parseInt(value, 10);
    const age = isNaN(parsed) ? 0 : parsed;
    const next = [...childrenAges];
    next[index] = age;
    onChildrenAgesChange(next);
  };

  return (
    <div className="w-64 bg-white rounded-md shadow-lg border border-gray-200 z-50 p-3 text-xs animate-fade-in-down dark:bg-gray-800 dark:border-gray-600">
      <div className="mb-2">
        <h4 className="text-xs font-semibold text-[#652D8E] dark:text-purple-300 tracking-wide uppercase">
          Who's travelling?
        </h4>
        <p className="text-[11px] text-gray-500 dark:text-gray-400">
          Choose the number of adults and children/infants for this trip.
        </p>
      </div>
      <div className="border-t border-gray-200 dark:border-gray-700 -mx-3 my-1" />
      <Counter
        label="Adults"
        description="Ages 13+"
        count={adults}
        onCountChange={onAdultsChange}
        min={1}
      />
      <div className="border-t border-gray-200 dark:border-gray-700 -mx-3 my-1"></div>
      <Counter
        label="Children / Infants"
        description="Ages 0-12"
        count={children}
        onCountChange={handleChildrenCountChange}
        min={0}
      />
      {children > 0 && (
        <div className="mt-2 space-y-1">
          {Array.from({ length: children }).map((_, index) => (
            <div key={index} className="flex items-center justify-between py-0.5">
              <span className="text-[11px] text-gray-500 dark:text-gray-400">Child {index + 1} age</span>
              <input
                type="number"
                min={0}
                className="w-16 px-1.5 py-0.5 text-xs font-semibold border border-gray-300 rounded-md text-[#652D8E] placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-[#652D8E] focus:border-[#652D8E] dark:bg-gray-700 dark:border-gray-600 dark:text-purple-200 dark:focus:ring-purple-400 dark:focus:border-purple-400"
                value={childrenAges[index] ?? ''}
                onChange={(e) => handleChildAgeChange(index, e.target.value)}
              />
            </div>
          ))}
        </div>
      )}
      <div className="border-t border-gray-200 dark:border-gray-700 -mx-4 my-2"></div>
      <button
        onClick={onClose}
        className="btn-primary w-full py-1.5 text-xs"
      >
        Done
      </button>
    </div>
  );
};

export default PassengersPopover;