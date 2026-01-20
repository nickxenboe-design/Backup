import React, { useState, useEffect } from 'react';
import LocationInput from './LocationInput';
import DateInput from './DateInput';
import PassengersInput from './PassengersInput';
import { LocationIcon, SwapIcon, SearchIcon } from './icons';
import { SearchQuery } from '../utils/api';

interface BusSearchBarProps {
  onSearch: (query: SearchQuery) => void;
  loading: boolean;
  initialQuery?: SearchQuery | null;
}

const BusSearchBar: React.FC<BusSearchBarProps> = ({ onSearch, loading, initialQuery }) => {
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [tripType, setTripType] = useState<'one-way' | 'round-trip'>('one-way');
  const [departureDate, setDepartureDate] = useState<string | null>(() => {
    const today = new Date();
    // Use local date components to avoid UTC conversion issues
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  });
  const [returnDate, setReturnDate] = useState<string | null>(null);
  const [adults, setAdults] = useState(1);
  const [children, setChildren] = useState(0);
  const [childrenAges, setChildrenAges] = useState<number[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (initialQuery) {
      setOrigin(initialQuery.origin);
      setDestination(initialQuery.destination);
      setTripType(initialQuery.tripType || 'one-way');
      setDepartureDate(initialQuery.departureDate);
      setReturnDate(initialQuery.returnDate ?? null);
      setAdults(initialQuery.passengers.adults);
      const initialChildren = initialQuery.passengers.children || 0;
      setChildren(initialChildren);

      const initialChildrenAges =
        Array.isArray(initialQuery.passengers.childrenAges) &&
        initialQuery.passengers.childrenAges.length > 0
          ? initialQuery.passengers.childrenAges
          : Array.from({ length: initialChildren }, () => 5);
      setChildrenAges(initialChildrenAges);
    }
  }, [initialQuery]);

  const handleSwapLocations = () => {
    const temp = origin;
    setOrigin(destination);
    setDestination(temp);
  };

  const handleOriginChange = (value: string) => {
    setOrigin(value);
  };

  const handleDestinationChange = (value: string) => {
    setDestination(value);
  };

  const today = (() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return new Date(`${year}-${month}-${day}T00:00:00`);
  })();

  const getNextDayString = (dateStr: string): string => {
    const base = new Date(dateStr + 'T00:00:00');
    base.setDate(base.getDate() + 1);
    const year = base.getFullYear();
    const month = String(base.getMonth() + 1).padStart(2, '0');
    const day = String(base.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!departureDate) {
      return;
    }

    const selectedDate = new Date(departureDate + 'T00:00:00');
    setFormError(null);

    // Validate that departure date is not in the past
    if (selectedDate < today) {
      setFormError('Please choose a departure date that is today or later.');
      return;
    }

    // Validate return date if it's a round trip
    if (tripType === 'round-trip' && returnDate) {
      const returnDateObj = new Date(returnDate + 'T00:00:00');
      if (returnDateObj <= selectedDate) {
        setFormError('Return date must be at least one day after the departure date.');
        return;
      }
    }

    onSearch({
      origin,
      destination,
      departureDate,
      returnDate: tripType === 'round-trip' && returnDate ? returnDate : undefined,
      passengers: {
        adults,
        children,
        ...(children > 0 ? { childrenAges } : {}),
      },
      tripType,
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white/95 dark:bg-gray-900/90 rounded-2xl shadow-xl border border-gray-100/90 dark:border-gray-800/80 backdrop-blur-sm text-xs transition-all duration-300 hover:shadow-2xl hover:-translate-y-0.5"
      role="search"
    >
        <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700 flex items-center space-x-1.5">
            <button
                type="button"
                onClick={() => setTripType('one-way')}
                className={`px-2.5 py-1.5 rounded-md font-semibold text-[11px] transition-all duration-200 ${tripType === 'one-way' ? 'bg-[#652D8E] text-white shadow-md shadow-[#652D8E]/20 dark:bg-purple-600 dark:shadow-purple-600/20' : 'bg-transparent text-[#652D8E] dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700'}`}
                aria-pressed={tripType === 'one-way'}
            >
                One-way
            </button>
            <button
                type="button"
                onClick={() => {
                  setTripType('round-trip');
                  setFormError(null);
                  if (departureDate) {
                    const nextDay = getNextDayString(departureDate);
                    setReturnDate(prev => {
                      if (!prev) {
                        return nextDay;
                      }
                      if (prev <= departureDate) {
                        return nextDay;
                      }
                      return prev;
                    });
                  }
                }}
                className={`px-2.5 py-1.5 rounded-md font-semibold text-[11px] transition-all duration-200 ${tripType === 'round-trip' ? 'bg-[#652D8E] text-white shadow-md shadow-[#652D8E]/20 dark:bg-purple-600 dark:shadow-purple-600/20' : 'bg-transparent text-[#652D8E] dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700'}`}
                aria-pressed={tripType === 'round-trip'}
            >
                Round-trip
            </button>
        </div>
        {formError && (
          <div className="px-4 py-3 bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-700 text-red-700 dark:text-red-300 text-sm">
            {formError}
          </div>
        )}
        <div className="sm:flex items-stretch">
            <div className="flex-grow flex flex-col sm:flex-row relative">
                <LocationInput
                    id="origin"
                    label="Origin"
                    value={origin}
                    onChange={handleOriginChange}
                    icon={<LocationIcon className="h-4 w-4 text-gray-400" />}
                    showAllOnFocus
                />

                <button
                    type="button"
                    onClick={handleSwapLocations}
                    className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 sm:static sm:transform-none sm:px-2 sm:py-3 bg-white dark:bg-gray-800 rounded-full sm:rounded-none border sm:border-l sm:border-r border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors focus:outline-none focus:ring-2 focus:ring-[#652D8E] dark:focus:ring-purple-500"
                    aria-label="Swap origin and destination"
                >
                    <SwapIcon className="h-4 w-4 text-[#652D8E] dark:text-purple-300"/>
                </button>

                <LocationInput
                    id="destination"
                    label="Destination"
                    value={destination}
                    onChange={handleDestinationChange}
                    icon={<LocationIcon className="h-4 w-4 text-gray-400" />}
                    showAllOnFocus
                />

                <div className="hidden sm:block w-px bg-gray-300 dark:bg-gray-600" />

                <DateInput 
                    id="departure-date"
                    label="Departure"
                    value={departureDate}
                    onDateChange={(date) => {
                      setDepartureDate(date);
                      if (tripType === 'round-trip' && date) {
                        const nextDay = getNextDayString(date);
                        setReturnDate(prev => {
                          if (!prev) {
                            return nextDay;
                          }
                          if (prev <= date) {
                            return nextDay;
                          }
                          return prev;
                        });
                      }
                    }}
                    minDate={today}
                    placeholder="Select date"
                />
                
                {tripType === 'round-trip' && (
                  <div className="hidden sm:block w-px bg-gray-300 dark:bg-gray-600" />
                )}

                {tripType === 'round-trip' && (
                  <DateInput
                      id="return-date"
                      label="Return"
                      value={returnDate}
                      onDateChange={setReturnDate}
                      minDate={departureDate ? new Date(getNextDayString(departureDate) + 'T00:00:00') : today}
                      placeholder="Add return"
                  />
                )}

                <div className="hidden lg:block w-px bg-gray-300 dark:bg-gray-600" />

                <PassengersInput 
                    adults={adults}
                    children={children}
                    childrenAges={childrenAges}
                    onAdultsChange={setAdults}
                    onChildrenChange={setChildren}
                    onChildrenAgesChange={setChildrenAges}
                />
            </div>
            <div className="px-3 py-3 bg-gray-100 dark:bg-gray-800/50 rounded-b-2xl lg:bg-transparent lg:px-0 lg:pr-3 flex items-stretch">
                 <button
                    type="submit"
                    disabled={loading || !origin || !destination || !departureDate || (tripType === 'round-trip' && !returnDate)}
                    className="w-full flex items-center justify-center gap-1.5 bg-[#652D8E] text-white font-bold py-2.5 px-4 rounded-lg lg:rounded-xl hover:opacity-90 hover:scale-[1.03] active:scale-95 transform transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#652D8E] dark:focus:ring-offset-gray-800 disabled:bg-gray-400 disabled:cursor-not-allowed text-xs shadow-md"
                >
                    <SearchIcon className="h-4 w-4" />
                    <span>Search</span>
                </button>
            </div>
        </div>
    </form>
  );
};

export default BusSearchBar;