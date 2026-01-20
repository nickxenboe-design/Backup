import React, { useState, useMemo, useEffect } from 'react';
import { BusRoute, SearchQuery, timestampToISO } from '../utils/api';
import BusResultCard from './BusResultCard';
import BusResultCardSkeleton from './BusResultCardSkeleton';
import FilterSidebar from './FilterSidebar';
import { SearchOffIcon, FilterIcon, BusIcon, ArrowRightIcon, ResetIcon, SearchIcon } from './icons';
import DateScroller from './DateScroller';
import TripCart from './TripCart';

interface ResultsProps {
  routes: BusRoute[];
  loading: boolean;
  isRefetching: boolean;
  error: string | null;
  query: SearchQuery | null;
  booking: { outbound: BusRoute | null; inbound: BusRoute | null };
  onSelectRoute: (route: BusRoute) => void;
  onSearch: (query: SearchQuery) => void;
  onEditSearch: () => void;
  onResetOutbound: () => void;
}

const parseTime = (timeStr: string) => {
    if (!timeStr) return 0; // Return 0 for invalid/missing time

    // If it's already a number (timestamp), convert to minutes since midnight
    if (!isNaN(Number(timeStr))) {
        const timestamp = Number(timeStr);
        const date = new Date(timestamp > 1e12 ? timestamp : timestamp * 1000);
        if (!isNaN(date.getTime())) {
            return date.getHours() * 60 + date.getMinutes();
        }
    }

    // Try to parse time string formats (e.g., "14:30", "2:30 PM")
    const [time, modifier] = timeStr.split(' ');
    let [hours, minutes] = time.split(':').map(Number);

    if (isNaN(hours) || isNaN(minutes)) return 0;

    // Handle AM/PM format
    if (modifier === 'PM' && hours < 12) hours += 12;
    if (modifier === 'AM' && hours === 12) hours = 0;

    // Ensure valid time range
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return 0;

    return hours * 60 + minutes;
};

const parseDuration = (durationStr: string) => {
    if (!durationStr) return 0; // Return 0 for invalid/missing duration

    let totalMinutes = 0;

    // Try to parse formats like "2h 30m", "2h", "30m", "150m"
    const hoursMatch = durationStr.match(/(\d+)h/);
    const minutesMatch = durationStr.match(/(\d+)m/);

    if (hoursMatch) {
        const hours = parseInt(hoursMatch[1], 10);
        if (!isNaN(hours) && hours >= 0) totalMinutes += hours * 60;
    }

    if (minutesMatch) {
        const minutes = parseInt(minutesMatch[1], 10);
        if (!isNaN(minutes) && minutes >= 0 && minutes < 60) totalMinutes += minutes;
    }

    // If no matches found, try to parse as total minutes
    if (!hoursMatch && !minutesMatch) {
        const totalMins = parseInt(durationStr, 10);
        if (!isNaN(totalMins) && totalMins >= 0) {
            totalMinutes = totalMins;
        }
    }

    return totalMinutes;
};

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

const Results: React.FC<ResultsProps> = ({ routes, loading, isRefetching, error, query, booking, onSelectRoute, onSearch, onEditSearch, onResetOutbound }) => {
  const [sort, setSort] = useState('earliest');
  const [timeFilters, setTimeFilters] = useState<string[]>([]);
  const [operatorFilters, setOperatorFilters] = useState<string[]>([]);
  const [amenityFilters, setAmenityFilters] = useState<string[]>([]);
  const [isFilterVisible, setIsFilterVisible] = useState(false);
  const [displayedRoutes, setDisplayedRoutes] = useState<BusRoute[]>(routes);

  useEffect(() => {
    if (!isRefetching) {
        setDisplayedRoutes(routes);
    }
  }, [routes, isRefetching]);

  const availableOperators = useMemo(() => Array.from(new Set(routes.map(r => r.busCompany).filter(Boolean))), [routes]);
  const availableAmenities = useMemo(() => Array.from(new Set(routes.flatMap(r => r.amenities || []))), [routes]);

  const handleDateChange = (newDate: string) => {
    if (query && !loading) {
      onSearch({ ...query, departureDate: newDate });
    }
  };
  
  const resetFilters = () => {
    setSort('earliest');
    setTimeFilters([]);
    setOperatorFilters([]);
    setAmenityFilters([]);
  }

  const handleTripSelection = async (route: BusRoute) => {
    // Use centralized trip selection logic from App.tsx
    if (onSelectRoute) {
      await onSelectRoute(route);
    }
  };

  const filteredAndSortedRoutes = useMemo(() => {
    let processedRoutes = [...displayedRoutes];

    // Filter out empty/placeholder trips (API returned undefined data)
    processedRoutes = processedRoutes.filter(route => {
      const isEmptyTrip = route.departureTime === "N/A" &&
                         route.arrivalTime === "N/A" &&
                         route.busCompany === "Unknown Operator";
      return !isEmptyTrip;
    });

    // Filtering
    processedRoutes = processedRoutes.filter(route => {
      // Time filter
      if (timeFilters.length > 0) {
        const departureHour = parseTime(route.departureTime || '') / 60;
        const matchesTime = timeFilters.some(time => {
          if (time === 'morning') return departureHour < 12;
          if (time === 'afternoon') return departureHour >= 12 && departureHour < 18;
          if (time === 'evening') return departureHour >= 18;
          return false;
        });
        if (!matchesTime) return false;
      }
      // Operator filter
      if (operatorFilters.length > 0 && !operatorFilters.includes(route.busCompany)) {
        return false;
      }
      // Amenity filter
      if (amenityFilters.length > 0 && !amenityFilters.every(amenity => route.amenities.includes(amenity))) {
        return false;
      }
      return true;
    });

    // Sorting
    processedRoutes.sort((a, b) => {
      if (sort === 'cheapest') return a.price - b.price;
      if (sort === 'earliest') return parseTime(a.departureTime || '') - parseTime(b.departureTime || '');
      if (sort === 'fastest') return parseDuration(a.duration || '') - parseDuration(b.duration || '');
      return 0;
    });

    return processedRoutes;
  }, [displayedRoutes, sort, timeFilters, operatorFilters, amenityFilters]);


  if (error) {
    return (
      <div className="text-center py-10 px-4">
        <div className="bg-red-50 border-l-4 border-red-400 text-red-800 p-4 rounded-lg relative max-w-md mx-auto dark:bg-red-900/20 dark:border-red-500 dark:text-red-200" role="alert">
          <p className="font-bold text-red-900 dark:text-red-100">An Error Occurred</p>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  const isSelectingInbound = query?.tripType === 'round-trip' && !!booking.outbound;

  const dateForTitle = isSelectingInbound ? query?.returnDate : query?.departureDate;
  const formattedDate = dateForTitle ? formatDateForDisplay(dateForTitle) : '';
  
  const noResultsAfterLoad = !loading && routes.length === 0;
  const noFilteredResults = !noResultsAfterLoad && filteredAndSortedRoutes.length === 0;
  
  return (
    <div>
        {isSelectingInbound && booking.outbound && (
            <TripCart outboundRoute={booking.outbound} onRemove={onResetOutbound} />
        )}

        <div className="mb-6 flex justify-between items-center bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-200/80 dark:border-gray-700">
            <div className="flex items-center gap-4 flex-grow min-w-0">
                <div className="bg-[#652D8E]/10 dark:bg-purple-900/30 p-3 rounded-lg hidden sm:block">
                    <BusIcon className="h-8 w-8 text-[#652D8E] dark:text-purple-300" />
                </div>
                <div className="min-w-0">
                    <p className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        {isSelectingInbound ? 'Select your return trip' : 'Select your outbound trip'}
                    </p>
                    <h2 className="text-2xl md:text-3xl font-bold text-[#652D8E] dark:text-purple-300 tracking-tight flex items-center gap-2 md:gap-3 flex-wrap">
                        <span className="truncate">{isSelectingInbound ? query?.destination : query?.origin}</span>
                        <ArrowRightIcon className="h-5 w-5 md:h-6 md:w-6 text-gray-400 flex-shrink-0" />
                        <span className="truncate">{isSelectingInbound ? query?.origin : query?.destination}</span>
                    </h2>
                    <p className="mt-1 text-md text-gray-500 dark:text-gray-400 font-medium">{loading ? 'Searching...' : `${filteredAndSortedRoutes.length} results`} for {formattedDate}</p>
                </div>
            </div>
             <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                <button
                    onClick={onEditSearch}
                    className="flex items-center gap-2 bg-white dark:bg-gray-700 text-[#652D8E] dark:text-purple-300 font-bold p-2 sm:px-4 sm:py-2 rounded-lg border-2 border-current hover:bg-[#652D8E]/10 dark:hover:bg-purple-900/50 transition-colors"
                    aria-label="Edit your search query"
                >
                    <SearchIcon className="h-5 w-5" />
                    <span className="hidden sm:inline">Edit</span>
                </button>
                <button
                  onClick={() => setIsFilterVisible(!isFilterVisible)}
                  className="lg:hidden flex items-center gap-2 bg-[#652D8E] dark:bg-purple-600 text-white font-bold p-2 sm:px-4 sm:py-2 rounded-lg"
                >
                  <FilterIcon className="h-5 w-5" />
                  <span className="hidden sm:inline">Filters</span>
                </button>
            </div>
        </div>
        
        {query?.departureDate && !isSelectingInbound && (
          <div className="mb-8">
            <DateScroller 
              selectedDate={query.departureDate}
              onDateSelect={handleDateChange}
              loading={loading}
            />
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
            <div className={`lg:col-span-1 ${isFilterVisible ? 'block' : 'hidden'} lg:block`}>
                <FilterSidebar 
                    sort={sort}
                    onSortChange={setSort}
                    timeFilters={timeFilters}
                    onTimeFilterChange={setTimeFilters}
                    operatorFilters={operatorFilters}
                    onOperatorFilterChange={setOperatorFilters}
                    amenityFilters={amenityFilters}
                    onAmenityFilterChange={setAmenityFilters}
                    availableOperators={availableOperators}
                    availableAmenities={availableAmenities}
                />
            </div>
            <div className="lg:col-span-3">
              {loading && !isRefetching ? (
                 <div className="space-y-4">
                    <BusResultCardSkeleton />
                    <BusResultCardSkeleton />
                    <BusResultCardSkeleton />
                 </div>
              ) : noResultsAfterLoad ? (
                <div className="text-center py-16 px-4 flex flex-col items-center justify-center h-full bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200/80 dark:border-gray-700">
                    <div className="bg-gray-100 dark:bg-gray-700 p-5 rounded-full">
                        <SearchOffIcon className="mx-auto h-16 w-16 text-gray-400" />
                    </div>
                    <h3 className="mt-6 text-2xl font-bold text-[#652D8E] dark:text-purple-300">
                        No Trips Found
                    </h3>
                    <p className="mt-2 text-md text-gray-600 dark:text-gray-300 max-w-md">
                        We couldn't find any trips for your search. Try adjusting the date or locations for better results.
                    </p>
                </div>
              ) : noFilteredResults ? (
                <div className="text-center py-16 px-4 flex flex-col items-center justify-center h-full bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200/80 dark:border-gray-700">
                    <div className="bg-gray-100 dark:bg-gray-700 p-5 rounded-full">
                        <SearchOffIcon className="mx-auto h-16 w-16 text-gray-400" />
                    </div>
                    <h3 className="mt-6 text-2xl font-bold text-[#652D8E] dark:text-purple-300">
                        No trips match your filters
                    </h3>
                    <p className="mt-2 text-md text-gray-600 dark:text-gray-300 max-w-md">
                        Try removing some filters to see more results for your trip.
                    </p>
                    <button
                        onClick={resetFilters}
                        className="mt-6 flex items-center gap-2 bg-[#652D8E] dark:bg-purple-600 text-white font-bold py-3 px-6 rounded-lg hover:opacity-90 transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#652D8E] dark:focus:ring-offset-gray-800 transform hover:scale-105"
                    >
                        <ResetIcon className="h-5 w-5" />
                        Clear All Filters
                    </button>
                </div>
              ) : (
                <div className="space-y-4 relative">
                  {filteredAndSortedRoutes.map((route, index) => (
                    <BusResultCard
                      key={route.id}
                      route={route}
                      searchQuery={query!}
                      onTripSelected={(tripId) => handleTripSelection(route)}
                    />
                  ))}
                </div>
              )}
            </div>
        </div>
    </div>
  );
};

export default Results;