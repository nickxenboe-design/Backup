import React, { useState, useMemo, useEffect } from 'react';
import { BusRoute, SearchQuery, timestampToISO, timestampToLocaleTime, searchTrips } from '@/utils/api';
import { analyzeBusRoutes } from '@/utils/busDataQuality';
import { useAuth } from '@/contexts/AuthContext';
import BusResultCard from './BusResultCard';
import BusResultCardSkeleton from './BusResultCardSkeleton';
import FilterSidebar from './FilterSidebar';
import { SearchOffIcon, FilterIcon, BusIcon, ArrowRightIcon, ResetIcon, SearchIcon, XIcon } from './icons';
import DateScroller from './DateScroller';
import TripCart from './TripCart';
import AdSlot from './AdSlot';

const CITY_OPTIONS = [
  { label: 'Bree', geohash: 'v73xj7' },
  { label: 'Hobbiton', geohash: 'v58fnj' },
  { label: 'Caras Galadhon', geohash: 'y162qq' },
  { label: 'Halls of Thranduil', geohash: 'yscxnz' },
  { label: 'Rivendell', geohash: 'vgtzy1' },
  { label: 'Edoras', geohash: 'tvzq3n' },
  { label: "Helm's Deep", geohash: 'ty79pn' },
  { label: 'Isengard', geohash: 'tz2k09' },
  { label: 'Minas Tirith', geohash: 'ws9x09' },
  { label: 'Barad-Dur', geohash: 'wvq550' },
  { label: 'Mount Doom', geohash: 'wj62yq' },
];

const geohashToLabel = (hash: string): string => {
  const found = CITY_OPTIONS.find(c => c.geohash === hash);
  return found?.label || hash;
};

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
  onTripError?: (error: unknown) => void;
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
	if (!dateString) return 'Invalid Date';

	try {
		// Expecting a plain "YYYY-MM-DD" string from the search form.
		// Parse it directly using local calendar fields to avoid timezone shifts.
		const [yearStr, monthStr, dayStr] = dateString.split('-');
		const year = Number(yearStr);
		const month = Number(monthStr);
		const day = Number(dayStr);

		if (!year || !month || !day) {
			return 'Invalid Date';
		}

		const date = new Date(year, month - 1, day);
		if (isNaN(date.getTime())) {
			return 'Invalid Date';
		}

		return date.toLocaleDateString('en-US', {
			weekday: 'long',
			month: 'long',
			day: 'numeric'
		});
	} catch (e) {
		console.error('Error formatting date:', e, dateString);
		return 'Invalid Date';
	}
};

const Results: React.FC<ResultsProps> = ({ routes, loading, isRefetching, error, query, booking, onSelectRoute, onSearch, onEditSearch, onResetOutbound, onTripError }) => {
  const { user } = useAuth();
  const isAdmin = String((user as any)?.role || '').toLowerCase() === 'admin';
  const [sort, setSort] = useState('earliest');
  const [timeFilters, setTimeFilters] = useState<string[]>([]);
  const [operatorFilters, setOperatorFilters] = useState<string[]>([]);
  const [amenityFilters, setAmenityFilters] = useState<string[]>([]);
  const [visibleDates, setVisibleDates] = useState<string[]>([]);
  const [dateMeta, setDateMeta] = useState<Record<string, { price?: number | null; unavailable?: boolean; loading?: boolean }>>({});
  const [isFilterVisible, setIsFilterVisible] = useState(false);
  const [displayedRoutes, setDisplayedRoutes] = useState<BusRoute[]>(routes);

  useEffect(() => {
    if (!isRefetching) {
        setDisplayedRoutes(routes);
    }
  }, [routes, isRefetching]);

  const quality = useMemo(() => analyzeBusRoutes(displayedRoutes as any), [displayedRoutes]);
  const qualityRoutes = quality.routes as unknown as BusRoute[];

  const availableOperators = useMemo(() => Array.from(new Set(qualityRoutes.map(r => r.busCompany).filter(Boolean))), [qualityRoutes]);
  const availableAmenities = useMemo(() => Array.from(new Set(qualityRoutes.flatMap(r => r.amenities || []))), [qualityRoutes]);

  useEffect(() => {
    setOperatorFilters((prev) => prev.filter((op) => availableOperators.includes(op)));
  }, [availableOperators]);

  const qualityCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const issue of quality.issues) {
      counts[issue.type] = (counts[issue.type] || 0) + 1;
    }
    const errorCount = quality.issues.filter((i) => i.severity === 'error').length;
    const warningCount = quality.issues.filter((i) => i.severity === 'warning').length;
    return { counts, errorCount, warningCount };
  }, [quality.issues]);

  const qualityReport = useMemo(() => {
    const payload = {
      at: new Date().toISOString(),
      query,
      totals: {
        incomingTrips: displayedRoutes.length,
        shownTrips: qualityRoutes.length,
        duplicatesHidden: quality.duplicatesHiddenCount,
        issueCount: quality.issues.length,
        errorCount: qualityCounts.errorCount,
        warningCount: qualityCounts.warningCount,
      },
      issueCounts: qualityCounts.counts,
      operators: quality.operatorStats.slice(0, 25),
      issues: quality.issues.slice(0, 50),
    };
    try {
      return JSON.stringify(payload, null, 2);
    } catch {
      return JSON.stringify(payload);
    }
  }, [query, displayedRoutes.length, qualityRoutes.length, quality.duplicatesHiddenCount, quality.issues, quality.operatorStats, qualityCounts]);

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

  useEffect(() => {
    setDateMeta({});
  }, [query?.origin, query?.destination, query?.returnDate, query?.tripType, query?.passengers?.adults, query?.passengers?.children]);

  const handleTripSelection = async (route: BusRoute) => {
    if (onSelectRoute) onSelectRoute(route);
  };

  const filteredAndSortedRoutes = useMemo(() => {
    let processedRoutes = [...qualityRoutes];

    // Filter out empty/placeholder trips (API returned undefined data)
    processedRoutes = processedRoutes.filter(route => {
      const isEmptyTrip = route.departureTime === "N/A" &&
                         route.arrivalTime === "N/A" &&
                         route.busCompany === "Unknown Operator" &&
                         route.origin === "Unknown Origin" &&
                         route.destination === "Unknown Destination";
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
  }, [qualityRoutes, sort, timeFilters, operatorFilters, amenityFilters]);

  const visibleRouteIdSet = useMemo(() => {
    return new Set(filteredAndSortedRoutes.map((r) => r.id));
  }, [filteredAndSortedRoutes]);

  const anyFiltersApplied = sort !== 'earliest' || timeFilters.length > 0 || operatorFilters.length > 0 || amenityFilters.length > 0;

  const getUnitPrice = (route: BusRoute): number => {
    const adults = query?.passengers?.adults || 0;
    const children = query?.passengers?.children || 0;
    const passengerCount = Math.max(1, adults + children);
    const isRoundTripCard = query?.tripType === 'round-trip' && Array.isArray((route as any).legs) && (route as any).legs.length >= 2;
    const rawPrice = (route.price || 0) * (isRoundTripCard ? 2 : 1);
    return rawPrice / passengerCount;
  };

  const parseLocalDate = (dateString: string) => {
    const [y, m, d] = dateString.split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  };

  useEffect(() => {
    const run = async () => {
      if (!query || !query.departureDate) return;
      const isSelectingInbound = query.tripType === 'round-trip' && !!booking.outbound;
      if (isSelectingInbound) return;
      if (!Array.isArray(visibleDates) || visibleDates.length === 0) return;

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const datesToFetch = visibleDates.filter((d) => {
        const meta = dateMeta[d];
        if (meta?.loading) return false;
        if (typeof meta?.price === 'number') return false;
        if (meta?.unavailable) return false;
        return parseLocalDate(d) >= today;
      });

      if (datesToFetch.length === 0) return;

      setDateMeta((prev) => {
        const next = { ...prev };
        for (const d of datesToFetch) {
          next[d] = { ...(next[d] || {}), loading: true };
        }
        return next;
      });

      const updates: Array<{ date: string; unavailable: boolean; price: number | null } | { date: string; error: true }> = [];

      for (const d of datesToFetch) {
        try {
          const q: SearchQuery = { ...query, departureDate: d };
          const trips = await searchTrips(q);
          if (!Array.isArray(trips) || trips.length === 0) {
            updates.push({ date: d, unavailable: true, price: null });
            continue;
          }
          const minPrice = trips.reduce((best, r) => Math.min(best, getUnitPrice(r)), Number.POSITIVE_INFINITY);
          updates.push({ date: d, unavailable: false, price: Number.isFinite(minPrice) ? minPrice : null });
        } catch {
          updates.push({ date: d, error: true });
        }
      }

      setDateMeta((prev) => {
        const next = { ...prev };
        updates.forEach((u) => {
          if ('error' in u) {
            next[u.date] = { ...(next[u.date] || {}), loading: false };
            return;
          }
          next[u.date] = { price: u.price, unavailable: u.unavailable, loading: false };
        });
        return next;
      });
    };

    void run();
  }, [visibleDates, query, booking.outbound, dateMeta]);

  const cheapestRoute = useMemo(() => {
    if (filteredAndSortedRoutes.length === 0) return null;
    return filteredAndSortedRoutes.reduce((best, r) => (getUnitPrice(r) < getUnitPrice(best) ? r : best), filteredAndSortedRoutes[0]);
  }, [filteredAndSortedRoutes]);

  const fastestRoute = useMemo(() => {
    if (filteredAndSortedRoutes.length === 0) return null;
    return filteredAndSortedRoutes.reduce((best, r) => (parseDuration(r.duration || '') < parseDuration(best.duration || '') ? r : best), filteredAndSortedRoutes[0]);
  }, [filteredAndSortedRoutes]);

  const getBadgesForRoute = (route: BusRoute): string[] => {
    const badges: string[] = [];
    if (cheapestRoute && route.id === cheapestRoute.id) badges.push('Best price');
    if (fastestRoute && route.id === fastestRoute.id) badges.push('Fastest');
    if (typeof route.availableSeats === 'number' && route.availableSeats > 0 && route.availableSeats <= 5) {
      badges.push('Few seats');
    }
    return badges;
  };

  const scrollToRoute = (routeId: string) => {
    if (typeof document === 'undefined') return;
    const el = document.getElementById(`route-${routeId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const handleCopyQualityReport = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(qualityReport);
        return;
      }
    } catch {}
    try {
      if (typeof window !== 'undefined') {
        window.prompt('Copy data-quality report:', qualityReport);
      }
    } catch {}
  };


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

  const rawOrigin = isSelectingInbound ? query?.destination : query?.origin;
  const rawDestination = isSelectingInbound ? query?.origin : query?.destination;
  const displayOrigin = rawOrigin ? geohashToLabel(rawOrigin) : '';
  const displayDestination = rawDestination ? geohashToLabel(rawDestination) : '';

  const dateForTitle = isSelectingInbound ? query?.returnDate : query?.departureDate;
  const formattedDate = dateForTitle ? formatDateForDisplay(dateForTitle) : '';
  
  const noResultsAfterLoad = !loading && routes.length === 0;
  const noFilteredResults = !noResultsAfterLoad && filteredAndSortedRoutes.length === 0;
  
  return (
    <div className="relative">
        {booking.outbound && (
            <div className="sm:flex sm:justify-center mb-6">
                <TripCart 
                    outboundRoute={booking.outbound} 
                    inboundRoute={booking.inbound || undefined} 
                    onRemove={onResetOutbound} 
                />
            </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
            {/* Full-width date/search bar row */}
            <div className="lg:col-span-4">
                <div className="bg-white dark:bg-gray-800 p-3 rounded-xl shadow-sm border border-gray-200/80 dark:border-gray-700">
                    {/* Trip Header moved into date/search card */}
                    <div className="flex items-center gap-4 flex-grow min-w-0 mb-3">
                        <div className="bg-[#652D8E]/10 dark:bg-purple-900/30 p-2.5 rounded-lg hidden sm:block">
                            <BusIcon className="h-6 w-6 text-[#652D8E] dark:text-purple-300" />
                        </div>
                        <div className="min-w-0">
                            {query?.tripType === 'round-trip' && (
                                <p className="text-[11px] font-semibold text-[#652D8E] dark:text-purple-300 uppercase tracking-widest mb-0.5">
                                    {isSelectingInbound ? 'Step 2 of 2  b7 Return trip' : 'Step 1 of 2  b7 Outbound trip'}
                                </p>
                            )}
                            <p className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                {isSelectingInbound ? 'Select your return trip' : 'Select your outbound trip'}
                            </p>
                            <h2 className="text-lg md:text-xl font-bold text-[#652D8E] dark:text-purple-300 tracking-tight flex items-center gap-2 md:gap-3 flex-wrap">
                                <span className="truncate">{displayOrigin}</span>
                                <ArrowRightIcon className="h-4 w-4 md:h-5 md:w-5 text-gray-400 flex-shrink-0" />
                                <span className="truncate">{displayDestination}</span>
                            </h2>
                            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 font-medium">{loading ? 'Searching...' : `${filteredAndSortedRoutes.length} results`} for {formattedDate}</p>
                        </div>
                    </div>

                    <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                            <button
                                onClick={onEditSearch}
                                className="btn-primary flex items-center gap-2 p-2 sm:px-4 sm:py-2"
                                aria-label="Edit your search query"
                            >
                                <SearchIcon className="h-5 w-5" />
                                <span className="hidden sm:inline">Change route</span>
                            </button>
                            <button
                                onClick={() => setIsFilterVisible(!isFilterVisible)}
                                className="lg:hidden btn-primary flex items-center gap-2 p-2 sm:px-4 sm:py-2"
                            >
                                <FilterIcon className="h-5 w-5" />
                                <span className="hidden sm:inline">Filters</span>
                            </button>
                        </div>
                    </div>

                    {query?.departureDate && !isSelectingInbound && (
                        <div className="mt-2">
                            <DateScroller 
                                selectedDate={query.departureDate}
                                onDateSelect={handleDateChange}
                                loading={loading}
                                fullWidth
                                dateMeta={dateMeta}
                                onVisibleDatesChange={setVisibleDates}
                            />
                        </div>
                    )}
                </div>
            </div>

            {/* Second row: filters + trip cards */}
            <div className={`lg:col-span-1 ${isFilterVisible ? 'block' : 'hidden'} lg:block ml-[5px]`}>
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
                    <div className="text-center py-10 px-4 flex flex-col items-center justify-center h-full bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200/80 dark:border-gray-700">
                        <div className="bg-gray-100 dark:bg-gray-700 p-4 rounded-full">
                            <SearchOffIcon className="mx-auto h-12 w-12 text-gray-400" />
                        </div>
                        <h3 className="mt-4 text-base font-bold text-[#652D8E] dark:text-purple-300">
                            No Trips Found
                        </h3>
                        <p className="mt-2 text-sm text-gray-600 dark:text-gray-300 max-w-md">
                            We couldn't find any trips for your search. Try adjusting the date or locations for better results.
                        </p>
                    </div>
                ) : noFilteredResults ? (
                    <div className="text-center py-10 px-4 flex flex-col items-center justify-center h-full bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200/80 dark:border-gray-700">
                        <div className="bg-gray-100 dark:bg-gray-700 p-4 rounded-full">
                            <SearchOffIcon className="mx-auto h-12 w-12 text-gray-400" />
                        </div>
                        <h3 className="mt-4 text-base font-bold text-[#652D8E] dark:text-purple-300">
                            No trips match your filters
                        </h3>
                        <p className="mt-2 text-sm text-gray-600 dark:text-gray-300 max-w-md">
                            Try removing some filters to see more results for your trip.
                        </p>
                        <button
                            type="button"
                            onClick={resetFilters}
                            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#652D8E] px-4 py-2 text-sm font-bold text-white shadow-md hover:opacity-90 dark:bg-purple-600"
                        >
                            <ResetIcon className="h-4 w-4" />
                            Clear filters
                        </button>
                    </div>
                ) : (
                    <div className="flex flex-col lg:flex-row lg:items-start gap-6">
                        {/* Left: Trip cards, now aligned closer to filters */}
                        <div className="flex-1 space-y-4 relative">
                            {(quality.duplicatesHiddenCount > 0 || quality.issues.length > 0) && (
                              <div className="rounded-xl border border-gray-200/80 dark:border-gray-700 bg-white dark:bg-gray-900/60 p-3 shadow-sm">
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <div className="text-xs font-bold text-gray-700 dark:text-gray-200">Data quality</div>
                                    <div className="mt-0.5 text-[11px] text-gray-600 dark:text-gray-400">
                                      {quality.duplicatesHiddenCount > 0 ? `${quality.duplicatesHiddenCount} duplicate trips hidden.` : null}
                                      {quality.duplicatesHiddenCount > 0 && quality.issues.length > 0 ? ' ' : null}
                                      {quality.issues.length > 0 ? `${qualityCounts.errorCount} errors, ${qualityCounts.warningCount} warnings detected.` : null}
                                    </div>
                                  </div>
                                  {isAdmin && (
                                    <button
                                      type="button"
                                      onClick={handleCopyQualityReport}
                                      className="text-[11px] font-bold text-[#652D8E] hover:opacity-80 dark:text-purple-300"
                                    >
                                      Copy report
                                    </button>
                                  )}
                                </div>

                                {isAdmin && (
                                  <details className="mt-2">
                                    <summary className="cursor-pointer text-[11px] font-semibold text-gray-600 dark:text-gray-300">
                                      Admin diagnostics
                                    </summary>
                                    <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-3">
                                      <div className="rounded-lg border border-gray-200/80 dark:border-gray-700 p-2">
                                        <div className="text-[11px] font-bold text-gray-700 dark:text-gray-200">Validation summary</div>
                                        <div className="mt-1 space-y-1 text-[11px] text-gray-600 dark:text-gray-300">
                                          {qualityCounts.counts.operator_missing ? (
                                            <div>Missing operator: <span className="font-bold">{qualityCounts.counts.operator_missing}</span></div>
                                          ) : null}
                                          {qualityCounts.counts.operator_truncated ? (
                                            <div>Truncated operator: <span className="font-bold">{qualityCounts.counts.operator_truncated}</span></div>
                                          ) : null}
                                          {qualityCounts.counts.origin_invalid ? (
                                            <div>Invalid origin: <span className="font-bold">{qualityCounts.counts.origin_invalid}</span></div>
                                          ) : null}
                                          {qualityCounts.counts.destination_invalid ? (
                                            <div>Invalid destination: <span className="font-bold">{qualityCounts.counts.destination_invalid}</span></div>
                                          ) : null}
                                          {qualityCounts.counts.departure_time_invalid ? (
                                            <div>Invalid departure time: <span className="font-bold">{qualityCounts.counts.departure_time_invalid}</span></div>
                                          ) : null}
                                          {qualityCounts.counts.arrival_time_invalid ? (
                                            <div>Invalid arrival time: <span className="font-bold">{qualityCounts.counts.arrival_time_invalid}</span></div>
                                          ) : null}
                                          {qualityCounts.counts.duration_invalid ? (
                                            <div>Invalid duration: <span className="font-bold">{qualityCounts.counts.duration_invalid}</span></div>
                                          ) : null}
                                          {quality.duplicatesHiddenCount ? (
                                            <div>Duplicates hidden: <span className="font-bold">{quality.duplicatesHiddenCount}</span></div>
                                          ) : null}
                                          {quality.issues.length === 0 && quality.duplicatesHiddenCount === 0 ? (
                                            <div>No issues detected.</div>
                                          ) : null}
                                        </div>
                                      </div>

                                      <div className="rounded-lg border border-gray-200/80 dark:border-gray-700 p-2">
                                        <div className="flex items-center justify-between gap-2">
                                          <div className="text-[11px] font-bold text-gray-700 dark:text-gray-200">Operator preview</div>
                                          <div className="text-[10px] font-semibold text-gray-500 dark:text-gray-400">Top 8</div>
                                        </div>
                                        <div className="mt-1 space-y-1">
                                          {quality.operatorStats.slice(0, 8).map((op) => (
                                            <div key={op.name} className="flex items-start justify-between gap-2 rounded-md bg-gray-50 dark:bg-gray-800/60 px-2 py-1">
                                              <div className="min-w-0">
                                                <div className="text-[11px] font-semibold text-gray-700 dark:text-gray-200 break-words">{op.name}</div>
                                                <div className="text-[10px] text-gray-500 dark:text-gray-400">
                                                  {op.tripCount} trips · {op.issueCount} issues
                                                </div>
                                              </div>
                                              <div className="flex items-center gap-1 flex-shrink-0">
                                                {op.sampleTripIds.filter((id) => visibleRouteIdSet.has(id)).slice(0, 2).map((id) => (
                                                  <button
                                                    key={id}
                                                    type="button"
                                                    onClick={() => scrollToRoute(id)}
                                                    className="text-[10px] font-bold text-[#652D8E] hover:opacity-80 dark:text-purple-300"
                                                    title={id}
                                                  >
                                                    View
                                                  </button>
                                                ))}
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    </div>

                                    {quality.issues.length > 0 && (
                                      <div className="mt-3 rounded-lg border border-gray-200/80 dark:border-gray-700 p-2">
                                        <div className="text-[11px] font-bold text-gray-700 dark:text-gray-200">Recent issues</div>
                                        <div className="mt-1 space-y-1">
                                          {quality.issues.slice(0, 6).map((issue, idx) => (
                                            <div key={`${issue.type}-${issue.routeId || 'x'}-${idx}`} className="flex items-start justify-between gap-2 rounded-md bg-gray-50 dark:bg-gray-800/60 px-2 py-1">
                                              <div className="min-w-0">
                                                <div className="text-[11px] font-semibold text-gray-700 dark:text-gray-200">{issue.message}</div>
                                                <div className="text-[10px] text-gray-500 dark:text-gray-400">{issue.type}{issue.routeId ? ` · ${issue.routeId}` : ''}</div>
                                              </div>
                                              {issue.routeId && visibleRouteIdSet.has(issue.routeId) ? (
                                                <button
                                                  type="button"
                                                  onClick={() => scrollToRoute(issue.routeId as string)}
                                                  className="text-[10px] font-bold text-[#652D8E] hover:opacity-80 dark:text-purple-300"
                                                >
                                                  View
                                                </button>
                                              ) : null}
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </details>
                                )}
                              </div>
                            )}

                            {anyFiltersApplied && (
                                <div className="flex flex-wrap items-center gap-2">
                                    {sort !== 'earliest' && (
                                        <button
                                            type="button"
                                            onClick={() => setSort('earliest')}
                                            className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2 py-1 text-[11px] font-semibold text-gray-700 shadow-sm hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
                                            aria-label="Remove sort"
                                        >
                                            <span>{sort === 'cheapest' ? 'Cheapest' : sort === 'fastest' ? 'Fastest' : 'Earliest'}</span>
                                            <XIcon className="h-3 w-3 text-gray-400" />
                                        </button>
                                    )}
                                    {timeFilters.map((t) => (
                                        <button
                                            key={t}
                                            type="button"
                                            onClick={() => setTimeFilters((prev) => prev.filter((x) => x !== t))}
                                            className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2 py-1 text-[11px] font-semibold text-gray-700 shadow-sm hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
                                            aria-label={`Remove ${t} filter`}
                                        >
                                            <span>{t === 'morning' ? 'Morning' : t === 'afternoon' ? 'Afternoon' : 'Evening'}</span>
                                            <XIcon className="h-3 w-3 text-gray-400" />
                                        </button>
                                    ))}
                                    {operatorFilters.map((op) => (
                                        <button
                                            key={op}
                                            type="button"
                                            onClick={() => setOperatorFilters((prev) => prev.filter((x) => x !== op))}
                                            className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2 py-1 text-[11px] font-semibold text-gray-700 shadow-sm hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
                                            aria-label={`Remove ${op} filter`}
                                            title={op}
                                        >
                                            <span className="max-w-[180px] truncate">{op}</span>
                                            <XIcon className="h-3 w-3 text-gray-400" />
                                        </button>
                                    ))}
                                    {amenityFilters.map((am) => (
                                        <button
                                            key={am}
                                            type="button"
                                            onClick={() => setAmenityFilters((prev) => prev.filter((x) => x !== am))}
                                            className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2 py-1 text-[11px] font-semibold text-gray-700 shadow-sm hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
                                            aria-label={`Remove ${am} filter`}
                                        >
                                            <span className="capitalize">{am}</span>
                                            <XIcon className="h-3 w-3 text-gray-400" />
                                        </button>
                                    ))}

                                    <button
                                        type="button"
                                        onClick={resetFilters}
                                        className="inline-flex items-center gap-1 rounded-full border border-[#652D8E]/25 bg-[#652D8E]/5 px-2 py-1 text-[11px] font-bold text-[#652D8E] hover:bg-[#652D8E]/10 dark:border-purple-500/30 dark:bg-purple-900/20 dark:text-purple-200 dark:hover:bg-purple-900/30"
                                    >
                                        <ResetIcon className="h-3 w-3" />
                                        Clear
                                    </button>
                                </div>
                            )}

                            {filteredAndSortedRoutes.map((route, index) => (
                                <div key={route.id} id={`route-${route.id}`}>
                                    <BusResultCard
                                        route={route}
                                        searchQuery={query!}
                                        isSelectingInbound={isSelectingInbound}
                                        badges={getBadgesForRoute(route)}
                                        onTripSelected={() => handleTripSelection(route)}
                                        onError={onTripError}
                                    />
                                </div>
                            ))}
                        </div>

                        {/* Right: Ads + traveler's tips (shown on large screens) */}
                        <div className="hidden lg:flex flex-col gap-4 w-64">
                            {(cheapestRoute || fastestRoute) && (
                                <div className="rounded-xl border border-gray-200/80 dark:border-gray-700 bg-white dark:bg-gray-900/60 p-3 shadow-sm">
                                    <h4 className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                        Quick picks
                                    </h4>

                                    {cheapestRoute && (
                                        <button
                                            type="button"
                                            onClick={() => scrollToRoute(cheapestRoute.id)}
                                            className="mt-2 w-full text-left rounded-lg border border-emerald-200/60 bg-emerald-50/60 p-2 hover:bg-emerald-50 dark:border-emerald-900/40 dark:bg-emerald-900/20 dark:hover:bg-emerald-900/30"
                                        >
                                            <div className="flex items-center justify-between">
                                                <span className="text-[11px] font-bold text-emerald-800 dark:text-emerald-200">Best price</span>
                                                <span className="text-[11px] font-bold text-emerald-800 dark:text-emerald-200">${getUnitPrice(cheapestRoute).toFixed(2)}</span>
                                            </div>
                                            <div className="mt-1 text-[11px] text-gray-700 dark:text-gray-200">
                                                {cheapestRoute.busCompany}
                                            </div>
                                            <div className="mt-0.5 text-[10px] text-gray-500 dark:text-gray-400">
                                                {timestampToLocaleTime(cheapestRoute.departureTime)} → {timestampToLocaleTime(cheapestRoute.arrivalTime)} · {cheapestRoute.duration} · per passenger
                                            </div>
                                        </button>
                                    )}

                                    {fastestRoute && (!cheapestRoute || fastestRoute.id !== cheapestRoute.id) && (
                                        <button
                                            type="button"
                                            onClick={() => scrollToRoute(fastestRoute.id)}
                                            className="mt-2 w-full text-left rounded-lg border border-sky-200/60 bg-sky-50/60 p-2 hover:bg-sky-50 dark:border-sky-900/40 dark:bg-sky-900/20 dark:hover:bg-sky-900/30"
                                        >
                                            <div className="flex items-center justify-between">
                                                <span className="text-[11px] font-bold text-sky-800 dark:text-sky-200">Fastest</span>
                                                <span className="text-[11px] font-bold text-sky-800 dark:text-sky-200">{fastestRoute.duration}</span>
                                            </div>
                                            <div className="mt-1 text-[11px] text-gray-700 dark:text-gray-200">
                                                {fastestRoute.busCompany}
                                            </div>
                                            <div className="mt-0.5 text-[10px] text-gray-500 dark:text-gray-400">
                                                {timestampToLocaleTime(fastestRoute.departureTime)} → {timestampToLocaleTime(fastestRoute.arrivalTime)} · ${getUnitPrice(fastestRoute).toFixed(2)} · per passenger
                                            </div>
                                        </button>
                                    )}
                                </div>
                            )}

                            <AdSlot slotId={0} />
                            <AdSlot slotId={1} />

                            <details className="rounded-xl border border-gray-200/80 dark:border-gray-700 bg-white dark:bg-gray-900/60 p-3 shadow-sm">
                                <summary className="cursor-pointer list-none">
                                    <div className="flex items-center gap-2">
                                        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#652D8E]/10 text-[10px] font-bold text-[#652D8E] dark:text-purple-300">
                                            i
                                        </span>
                                        <h4 className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                            Traveler tips
                                        </h4>
                                    </div>
                                </summary>
                                <ul className="mt-2 list-disc list-inside space-y-1 text-justify">
                                    <li className="text-xs text-gray-600 dark:text-gray-300">
                                        Arrive at the station at least 30 minutes before departure.
                                    </li>
                                    <li className="text-xs text-gray-600 dark:text-gray-300">
                                        Keep your ID, ticket and valuables in a secure, easy-to-reach place.
                                    </li>
                                    <li className="text-xs text-gray-600 dark:text-gray-300">
                                        Label your luggage clearly and avoid blocking the aisle with bags.
                                    </li>
                                </ul>
                            </details>
                        </div>
                    </div>
                )}
            </div>
        </div>
    </div>
  );
};

export default Results;