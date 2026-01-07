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
  const [origin, setOrigin] = useState('v73xj7');
  const [destination, setDestination] = useState('v58fnj');
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

  useEffect(() => {
    if (initialQuery) {
      setOrigin(initialQuery.origin);
      setDestination(initialQuery.destination);
      setTripType('one-way');
      setDepartureDate(initialQuery.departureDate);
      setReturnDate(null);
      setAdults(initialQuery.passengers.adults);
      setChildren(initialQuery.passengers.children);
    }
  }, [initialQuery]);

  const handleSwapLocations = () => {
    const temp = origin;
    setOrigin(destination);
    setDestination(temp);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (departureDate) {
        // Validate that departure date is not in the past
        const selectedDate = new Date(departureDate + 'T00:00:00');

        if (selectedDate < today) {
            alert('Please select a departure date that is today or in the future.');
            return;
        }

        // Validate return date if it's a round trip
        if (tripType === 'round-trip' && returnDate) {
            const returnDateObj = new Date(returnDate + 'T00:00:00');
            if (returnDateObj <= selectedDate) {
                alert('Return date must be after departure date.');
                return;
            }
        }

        onSearch({
            origin,
            destination,
            departureDate,
            returnDate: tripType === 'round-trip' && returnDate ? returnDate : undefined,
            passengers: { adults, children },
            tripType,
        });
    }
  };
  
  const today = (() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return new Date(`${year}-${month}-${day}T00:00:00`);
  })();

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-lg border border-gray-200/80 dark:bg-gray-800 dark:border-gray-700" role="search">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center space-x-2">
            <button
                type="button"
                onClick={() => setTripType('one-way')}
                className={`px-4 py-2 rounded-lg font-semibold text-sm transition-all duration-200 ${tripType === 'one-way' ? 'bg-[#652D8E] text-white shadow-lg shadow-[#652D8E]/20 dark:bg-purple-600 dark:shadow-purple-600/20' : 'bg-transparent text-[#652D8E] dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700'}`}
                aria-pressed={tripType === 'one-way'}
            >
                One-way
            </button>
            <div className="relative inline-block">
                <button
                    type="button"
                    disabled
                    aria-disabled="true"
                    title="Coming soon"
                    className="px-4 py-2 rounded-lg font-semibold text-sm transition-all duration-200 bg-transparent text-[#652D8E] dark:text-gray-200 opacity-60 cursor-not-allowed relative select-none"
                >
                    <span className="block text-[10px] font-semibold uppercase text-[#652D8E] dark:text-purple-200 -mt-1 mb-0.5 pointer-events-none">Coming soon</span>
                    <span>Round-trip</span>
                </button>
            </div>
        </div>
        <div className="lg:flex items-center">
            <div className="flex-grow flex flex-col lg:flex-row relative">
                <LocationInput
                    id="origin"
                    label="Origin"
                    value={origin}
                    onChange={setOrigin}
                    icon={<LocationIcon className="h-6 w-6 text-gray-400" />}
                />

                <button
                    type="button"
                    onClick={handleSwapLocations}
                    className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 lg:static lg:transform-none lg:p-4 bg-white dark:bg-gray-800 rounded-full lg:rounded-none border lg:border-l lg:border-r border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors focus:outline-none focus:ring-2 focus:ring-[#652D8E] dark:focus:ring-purple-500"
                    aria-label="Swap origin and destination"
                >
                    <SwapIcon className="h-5 w-5 text-[#652D8E] dark:text-purple-300"/>
                </button>

                <LocationInput
                    id="destination"
                    label="Destination"
                    value={destination}
                    onChange={setDestination}
                    icon={<LocationIcon className="h-6 w-6 text-gray-400" />}
                />

                <div className="hidden lg:block w-px bg-gray-300 dark:bg-gray-600"></div>

                <DateInput 
                    id="departure-date"
                    label="Departure"
                    value={departureDate}
                    onDateChange={setDepartureDate}
                    minDate={today}
                    placeholder="Select date"
                />
                
                {tripType === 'round-trip' && <div className="hidden lg:block w-px bg-gray-300 dark:bg-gray-600"></div>}

                {tripType === 'round-trip' && (
                  <DateInput
                      id="return-date"
                      label="Return"
                      value={returnDate}
                      onDateChange={setReturnDate}
                      minDate={departureDate ? (() => {
                        const depDate = new Date(departureDate + 'T00:00:00');
                        depDate.setDate(depDate.getDate() + 1);
                        return depDate;
                      })() : today}
                      placeholder="Add return"
                  />
                )}

                <div className="hidden lg:block w-px bg-gray-300 dark:bg-gray-600"></div>

                <PassengersInput 
                    adults={adults}
                    children={children}
                    onAdultsChange={setAdults}
                    onChildrenChange={setChildren}
                />
            </div>
            <div className="p-4 bg-gray-100 dark:bg-gray-800/50 rounded-b-2xl lg:bg-transparent lg:p-0 lg:pr-4">
                 <button
                    type="submit"
                    disabled={loading || !origin || !destination || !departureDate}
                    className="w-full flex items-center justify-center gap-2 bg-[#652D8E] text-white font-bold py-4 px-8 rounded-lg lg:rounded-xl hover:opacity-90 transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#652D8E] dark:focus:ring-offset-gray-800 disabled:bg-gray-400 disabled:cursor-not-allowed transform hover:scale-105 shadow-lg"
                >
                    <SearchIcon className="h-5 w-5" />
                    <span>Search</span>
                </button>
            </div>
        </div>
    </form>
  );
};

export default BusSearchBar;