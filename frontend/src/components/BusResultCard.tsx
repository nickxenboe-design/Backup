import React, { useState } from 'react';
import { BusRoute, timestampToLocaleTime, timestampToLocaleDateTime, SearchQuery, selectTrip } from '../utils/api';
import { ClockIcon, TicketIcon, WifiIcon, PowerIcon, RestroomIcon, ArmchairIcon, CircleIcon, DepartureIcon, ArrivalIcon, PriceTagIcon } from './icons';

interface BusResultCardProps {
  route: BusRoute;
  searchQuery: SearchQuery;
  onTripSelected?: (route: BusRoute) => void;
  disabled?: boolean;
  deferApiCall?: boolean;
  isSelectingInbound?: boolean;
  onError?: (error: unknown) => void;
  badges?: string[];
  onSelectingChange?: (selecting: boolean, route: BusRoute) => void;
}

const CHILD_TOKENS = ['child', 'children', 'youth', 'teen', 'student'];

const hasChildOrYouthPrice = (route: BusRoute): boolean => {
  const anyRoute: any = route as any;
  const prices = anyRoute?.prices;
  if (!Array.isArray(prices) || prices.length === 0) return false;

  const hasChildInBreakdown = (breakdown: any): boolean => {
    if (!breakdown || typeof breakdown !== 'object') return false;
    for (const [key, value] of Object.entries(breakdown)) {
      const keyLower = key.toLowerCase();
      if (keyLower === 'total') continue;

      if (keyLower === 'passengers' && Array.isArray(value)) {
        for (const p of value) {
          if (!p || typeof p !== 'object') continue;
          const passenger: any = p;
          const categoryField = String(
            passenger.category ||
            passenger.passengerType ||
            passenger.passenger_type ||
            passenger.type ||
            ''
          ).toLowerCase();
          if (CHILD_TOKENS.some((token) => categoryField.includes(token))) {
            return true;
          }
        }
        continue;
      }

      if (CHILD_TOKENS.some((token) => keyLower.includes(token))) {
        return true;
      }
      if (value && typeof value === 'object') {
        const nested: any = value;
        const typeField = String(
          nested.passengerType ||
          nested.passenger_type ||
          nested.type ||
          nested.category ||
          ''
        ).toLowerCase();
        if (CHILD_TOKENS.some((token) => typeField.includes(token))) {
          return true;
        }
      }
    }
    return false;
  };

  for (const entry of prices) {
    if (!entry) continue;

    const anyEntry: any = entry as any;

    if (anyEntry.prices?.breakdown && hasChildInBreakdown(anyEntry.prices.breakdown)) {
      return true;
    }

    if (anyEntry.breakdown && hasChildInBreakdown(anyEntry.breakdown)) {
      return true;
    }

    const typeField = String(
      anyEntry.passengerType ||
      anyEntry.passenger_type ||
      anyEntry.type ||
      anyEntry.category ||
      ''
    ).toLowerCase();
    if (CHILD_TOKENS.some((token) => typeField.includes(token))) {
      return true;
    }
  }

  return false;
};

const InlineSpinner: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={`animate-spin ${className || ''}`}
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path
      className="opacity-75"
      fill="currentColor"
      d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
    />
  </svg>
);

const getCompanyColor = (companyName: string) => {
    // Handle undefined or null companyName
    if (!companyName) {
        companyName = 'Unknown Company';
    }

    let hash = 0;
    for (let i = 0; i < companyName.length; i++) {
        hash = companyName.charCodeAt(i) + ((hash << 5) - hash);
    }
    const color = `hsl(${hash % 360}, 60%, 45%)`;
    return color;
};

const AmenityIcon: React.FC<{ amenity: string }> = ({ amenity }) => {
    const iconProps = { className: "h-5 w-5 text-gray-500 dark:text-gray-400", "aria-label": amenity };

    let iconToShow;
    switch (amenity.toLowerCase()) {
        case 'wi-fi':
            iconToShow = <WifiIcon {...iconProps} />;
            break;
        case 'charging port':
            iconToShow = <PowerIcon {...iconProps} />;
            break;
        case 'toilet':
            iconToShow = <RestroomIcon {...iconProps} />;
            break;
        case 'reclining seat':
            iconToShow = <ArmchairIcon {...iconProps} />;
            break;
        default:
            return null;
    }

    return (
        <span title={amenity}>
            {iconToShow}
        </span>
    );
};

const getBadgeClasses = (badge: string) => {
    const base = 'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold';
    const key = badge.toLowerCase();

    if (key.includes('best') || key.includes('cheap')) {
        return `${base} bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200`;
    }
    if (key.includes('fast')) {
        return `${base} bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-200`;
    }
    if (key.includes('seat')) {
        return `${base} bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200`;
    }
    return `${base} bg-[#652D8E]/10 text-[#652D8E] dark:bg-purple-900/40 dark:text-purple-200`;
};

const ExpandableStationText: React.FC<{ text: string; className?: string }> = ({ text, className }) => {
    const [expanded, setExpanded] = useState(false);
    const safeText = typeof text === 'string' ? text : String(text ?? '');
    const canExpand = safeText.length > 28;

    if (!canExpand) {
        return (
            <p className={className} title={safeText}>
                {safeText}
            </p>
        );
    }

    return (
        <button
            type="button"
            onClick={(e) => {
                e.stopPropagation();
                setExpanded((v) => !v);
            }}
            className={`${className} ${expanded ? 'whitespace-normal break-words' : 'truncate'} cursor-pointer focus:outline-none`}
            title={safeText}
        >
            {safeText}
        </button>
    );
};

const BusResultCard: React.FC<BusResultCardProps> = ({ route, searchQuery, onTripSelected, disabled = false, deferApiCall = false, isSelectingInbound = false, onError, badges, onSelectingChange }) => {
    const brandColor = getCompanyColor(route.busCompany);
    const safeAmenities = route.amenities || [];
    const displayedAmenities = safeAmenities.slice(0, 3);
    const remainingAmenitiesCount = safeAmenities.length - 3;
    const remainingAmenitiesList = safeAmenities.slice(3).join(', ');
    const passengerCount = Math.max(1, (searchQuery?.passengers?.adults || 0) + (searchQuery?.passengers?.children || 0));
    const [isSelecting, setIsSelecting] = useState(false);

    const legs = (route as any).legs;
    const isRoundTripCard = searchQuery?.tripType === 'round-trip' && Array.isArray(legs) && legs.length >= 2;
    const outboundLegPrice = Number(legs?.[0]?.price || 0);
    const inboundLegPrice = Number(legs?.[1]?.price || 0);
    const legsTotal = (Number.isFinite(outboundLegPrice) ? outboundLegPrice : 0) + (Number.isFinite(inboundLegPrice) ? inboundLegPrice : 0);
    const rawPrice = isRoundTripCard
        ? (legsTotal > 0 ? legsTotal : (route.price || 0))
        : (route.price || 0);
    const unitPrice = rawPrice / passengerCount;

    const formatLegDateTime = (baseDate: string | undefined, timeValue: any) => {
        if (!baseDate) {
            return timestampToLocaleDateTime(timeValue);
        }

        if (typeof timeValue === 'string' && timeValue.includes(':') && !timeValue.includes('T') && !timeValue.includes(' ')) {
            const [yearStr, monthStr, dayStr] = baseDate.split('-');
            const year = Number(yearStr);
            const month = Number(monthStr);
            const day = Number(dayStr);

            const [hoursStr, minutesStr] = timeValue.split(':');
            const hours = Number(hoursStr);
            const minutes = Number(minutesStr);

            if (!year || !month || !day || isNaN(hours) || isNaN(minutes)) {
                return timestampToLocaleDateTime(timeValue);
            }

            const date = new Date(year, month - 1, day, hours, minutes);
            if (isNaN(date.getTime())) {
                return timestampToLocaleDateTime(timeValue);
            }

            return date.toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
            });
        }

        return timestampToLocaleDateTime(timeValue);
    };

    // Check if this is a placeholder/empty trip (all major fields are fallbacks)
    const isEmptyTrip = route.departureTime === "N/A" &&
                       route.arrivalTime === "N/A" &&
                       route.busCompany === "Unknown Operator";

    // For one-way cards (no explicit legs), derive proper datetime using raw fields or search query dates
    const routeWithRaw = route as any;
    const departureDateTimeForDisplay = !isEmptyTrip
        ? (routeWithRaw.departureDateTimeRaw
            || (searchQuery.departureDate ? `${searchQuery.departureDate}T${route.departureTime}` : route.departureTime))
        : undefined;

    const arrivalBaseDate = searchQuery.returnDate || searchQuery.departureDate;
    const arrivalDateTimeForDisplay = !isEmptyTrip
        ? (routeWithRaw.arrivalDateTimeRaw
            || (arrivalBaseDate ? `${arrivalBaseDate}T${route.arrivalTime}` : route.arrivalTime))
        : undefined;

    const handleSelectTrip = async () => {
        if (isEmptyTrip || disabled || isSelecting) return;

        console.log('🎯 [BusResultCard] Starting trip selection for route:', route.id);
        console.log('📋 [BusResultCard] Route data:', {
            id: route.id,
            tripId: route.tripId,
            origin: route.origin,
            destination: route.destination,
            search_id: route.search_id,
            price: route.price,
            segments: route.segments,
            legs: route.legs,
            segment_id: route.segment_id
        });
        console.log('🔍 [BusResultCard] Search query:', searchQuery);

        // Validate search context (non-blocking)
        if (!searchQuery.searchId) {
            console.warn('⚠️ [BusResultCard] Missing searchId in searchQuery - proceeding without search context');
        } else {
            console.log('✅ [BusResultCard] Using searchId:', searchQuery.searchId);
        }

        if (deferApiCall) {
            onSelectingChange?.(true, route);
            try {
                if (onTripSelected) {
                    onTripSelected(route);
                }
            } finally {
                onSelectingChange?.(false, route);
            }
            return;
        }

        setIsSelecting(true);
        onSelectingChange?.(true, route);

        try {
            const selectionResult = await selectTrip({
                trip: route,
                searchQuery: searchQuery
            });

            console.log('📋 [BusResultCard] Trip selection result:', selectionResult);

            if (selectionResult.success) {
                console.log('✅ [BusResultCard] Trip selection successful:', selectionResult);
                if (onTripSelected) {
                    onTripSelected(route);
                }
            } else {
                const errorMessage = selectionResult.message || 'Unknown error occurred during trip selection';
                console.error('❌ [BusResultCard] Trip selection failed:', errorMessage);
                throw new Error(errorMessage);
            }
        } catch (error) {
            console.error('❌ [BusResultCard] Error during trip selection:', error);
            if (onError) {
                onError(error);
            }
        } finally {
            setIsSelecting(false);
            onSelectingChange?.(false, route);
        }
    };

    return (
        <div className="w-full rounded-2xl shadow-md hover:shadow-2xl border border-gray-200/80 dark:border-gray-700 bg-gradient-to-br from-white via-white to-purple-50/40 dark:from-gray-900 dark:via-gray-900 dark:to-purple-950/20 transition-all duration-300 overflow-hidden group hover:-translate-y-1 hover:border-[#652D8E]/25 dark:hover:border-purple-500/40 animate-fade-in dark:hover:shadow-purple-900/30">
            <div className="p-3 md:p-4 grid grid-cols-12 gap-3 items-center">

                {/* Company & Amenities - Col 1 */}
                <div className="col-span-12 md:col-span-3 border-b md:border-b-0 md:border-r border-gray-200/80 dark:border-gray-700 pb-3 md:pb-0 md:pr-3 flex flex-col justify-between h-full min-h-[60px]">
                    <div>
                        <p
                            style={{ color: brandColor }}
                            className="text-sm font-bold leading-tight break-words"
                            title={route.busCompany || 'Unknown Company'}
                        >
                            {route.busCompany || 'Unknown Company'}
                        </p>

                        {Array.isArray(badges) && badges.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                                {badges.map((badge) => (
                                    <span key={badge} className={getBadgeClasses(badge)}>
                                        {badge}
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                    {safeAmenities.length > 0 && (
                        <div className="flex items-center gap-2 mt-2">
                            {displayedAmenities.map(amenity => <AmenityIcon key={amenity} amenity={amenity} />)}
                            {remainingAmenitiesCount > 0 && (
                                <div
                                    className="flex items-center justify-center h-5 px-1.5 bg-gray-100 dark:bg-gray-700 rounded-md text-xs font-bold text-gray-500 dark:text-gray-300 cursor-default"
                                    title={`More: ${remainingAmenitiesList}`}
                                >
                                    +{remainingAmenitiesCount}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Journey Details - Col 2 */}
                <div className="col-span-12 md:col-span-6 flex flex-col gap-2">
                    {Array.isArray((route as any).legs) && (route as any).legs.length >= 2 ? (
                      <>
                        {/* Outbound */}
                        <div className="flex flex-col 2xl:flex-row 2xl:items-center gap-2 2xl:gap-0">
                          <div className="flex flex-col items-center text-center w-full 2xl:w-1/3">
                              <div className="flex items-center justify-center gap-2">
                                  <DepartureIcon className="h-5 w-5 text-gray-500 dark:text-gray-400" />
                                  <div className="text-center">
                                      <p className="text-lg font-semibold text-gray-800 dark:text-gray-200 font-mono">
                                          {timestampToLocaleTime((route as any).legs[0].departureTime)}
                                      </p>
                                      <p className="text-xs text-gray-500 dark:text-gray-400">
                                          {formatLegDateTime(searchQuery?.departureDate, (route as any).legs[0].departureTime)}
                                      </p>
                                  </div>
                              </div>
                              <ExpandableStationText
                                  text={(route as any).legs[0].origin || 'Unknown'}
                                  className="text-xs text-gray-500 dark:text-gray-400 font-medium mt-1 block w-full max-w-full text-center"
                              />
                              <p className="text-[9px] uppercase tracking-wide mt-0.5 text-[#652D8E] dark:text-purple-300 font-semibold">Outbound</p>
                          </div>
                          <div className="w-full 2xl:w-1/3 flex-grow flex flex-col items-center text-gray-500 dark:text-gray-400 px-2">
                              <div className="flex items-center gap-1 text-[10px] font-semibold">
                                  <ClockIcon className="h-3 w-3" />
                                  <span>{(route as any).legs[0].duration || 'N/A'}</span>
                              </div>
                              <div className="w-full flex items-center">
                                  <CircleIcon className="h-3 w-3 text-gray-300 dark:text-gray-600 flex-shrink-0" />
                                  <div className="w-full h-px bg-gray-300 dark:bg-gray-600 border-t border-dashed"></div>
                                  <CircleIcon className="h-3 w-3 text-gray-300 dark:text-gray-600 flex-shrink-0" />
                              </div>
                          </div>
                          <div className="flex flex-col items-center text-center w-full 2xl:w-1/3">
                              <div className="flex items-center justify-center gap-2">
                                  <ArrivalIcon className="h-5 w-5 text-gray-500 dark:text-gray-400" />
                                  <div className="text-center">
                                      <p className="text-lg font-semibold text-gray-800 dark:text-gray-200 font-mono">
                                          {timestampToLocaleTime((route as any).legs[0].arrivalTime)}
                                      </p>
                                      <p className="text-xs text-gray-500 dark:text-gray-400">
                                          {formatLegDateTime(searchQuery?.departureDate, (route as any).legs[0].arrivalTime)}
                                      </p>
                                  </div>
                              </div>
                              <ExpandableStationText
                                  text={(route as any).legs[0].destination || 'Unknown'}
                                  className="text-xs text-gray-500 dark:text-gray-400 font-medium mt-1 block w-full max-w-full text-center"
                              />
                          </div>
                        </div>
                        <div className="h-px bg-gray-200 dark:bg-gray-700" />
                        {/* Return */}
                        <div className="flex flex-col 2xl:flex-row 2xl:items-center gap-2 2xl:gap-0">
                          <div className="flex flex-col items-center text-center w-full 2xl:w-1/3">
                              <div className="flex items-center justify-center gap-2">
                                  <DepartureIcon className="h-5 w-5 text-gray-500 dark:text-gray-400" />
                                  <div className="text-center">
                                      <p className="text-lg font-semibold text-gray-800 dark:text-gray-200 font-mono">
                                          {timestampToLocaleTime((route as any).legs[1].departureTime)}
                                      </p>
                                      <p className="text-xs text-gray-500 dark:text-gray-400">
                                          {formatLegDateTime(searchQuery?.returnDate, (route as any).legs[1].departureTime)}
                                      </p>
                                  </div>
                              </div>
                              <ExpandableStationText
                                  text={(route as any).legs[1].origin || 'Unknown'}
                                  className="text-xs text-gray-500 dark:text-gray-400 font-medium mt-1 block w-full max-w-full text-center"
                              />
                              <p className="text-[9px] uppercase tracking-wide mt-0.5 text-[#652D8E] dark:text-purple-300 font-semibold">Return</p>
                          </div>
                          <div className="w-full 2xl:w-1/3 flex-grow flex flex-col items-center text-gray-500 dark:text-gray-400 px-2">
                              <div className="flex items-center gap-1 text-[10px] font-semibold">
                                  <ClockIcon className="h-3 w-3" />
                                  <span>{(route as any).legs[1].duration || 'N/A'}</span>
                              </div>
                              <div className="w-full flex items-center">
                                  <CircleIcon className="h-3 w-3 text-gray-300 dark:text-gray-600 flex-shrink-0" />
                                  <div className="w-full h-px bg-gray-300 dark:bg-gray-600 border-t border-dashed"></div>
                                  <CircleIcon className="h-3 w-3 text-gray-300 dark:text-gray-600 flex-shrink-0" />
                              </div>
                          </div>
                          <div className="flex flex-col items-center text-center w-1/3">
                              <div className="flex items-center justify-center gap-2">
                                  <ArrivalIcon className="h-5 w-5 text-gray-500 dark:text-gray-400" />
                                  <div className="text-center">
                                      <p className="text-lg font-semibold text-gray-800 dark:text-gray-200 font-mono">
                                          {timestampToLocaleTime((route as any).legs[1].arrivalTime)}
                                      </p>
                                      <p className="text-xs text-gray-500 dark:text-gray-400">
                                          {formatLegDateTime(searchQuery?.returnDate, (route as any).legs[1].arrivalTime)}
                                      </p>
                                  </div>
                              </div>
                              <ExpandableStationText
                                  text={(route as any).legs[1].destination || 'Unknown'}
                                  className="text-xs text-gray-500 dark:text-gray-400 font-medium mt-1 block w-full max-w-full text-center"
                              />
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="flex flex-col 2xl:flex-row 2xl:items-center gap-2 2xl:gap-0">
                        <div className="flex flex-col items-center text-center w-full 2xl:w-1/3">
                            <div className="flex items-center justify-center gap-2">
                                <DepartureIcon className="h-5 w-5 text-gray-500 dark:text-gray-400" />
                                <div className="text-center">
                                    <p className="text-2xl font-bold text-gray-800 dark:text-gray-200 font-mono">
                                        {isEmptyTrip ? "N/A" : timestampToLocaleTime(route.departureTime)}
                                    </p>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">
                                        {isEmptyTrip ? "N/A" : timestampToLocaleDateTime(departureDateTimeForDisplay)}
                                    </p>
                                </div>
                            </div>
                            <ExpandableStationText
                                text={route.origin || 'Unknown'}
                                className="text-xs text-gray-500 dark:text-gray-400 font-medium mt-1 block w-full max-w-full text-center"
                            />
                        </div>
                        <div className="w-full 2xl:w-1/3 flex-grow flex flex-col items-center text-gray-500 dark:text-gray-400 px-2">
                            <div className="flex items-center gap-1 text-[10px] font-semibold">
                                <ClockIcon className="h-3 w-3" />
                                <span>{route.duration || 'N/A'}</span>
                            </div>
                            <div className="w-full flex items-center">
                                <CircleIcon className="h-3 w-3 text-gray-300 dark:text-gray-600 flex-shrink-0" />
                                <div className="w-full h-px bg-gray-300 dark:bg-gray-600 border-t border-dashed"></div>
                                <CircleIcon className="h-3 w-3 text-gray-300 dark:text-gray-600 flex-shrink-0" />
                            </div>
                        </div>
                        <div className="flex flex-col items-center text-center w-full 2xl:w-1/3">
                            <div className="flex items-center justify-center gap-2">
                                <ArrivalIcon className="h-5 w-5 text-gray-500 dark:text-gray-400" />
                                <div className="text-center">
                                    <p className="text-2xl font-bold text-gray-800 dark:text-gray-200 font-mono">
                                        {isEmptyTrip ? "N/A" : timestampToLocaleTime(route.arrivalTime)}
                                    </p>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">
                                        {isEmptyTrip ? "N/A" : timestampToLocaleDateTime(arrivalDateTimeForDisplay)}
                                    </p>
                                </div>
                            </div>
                            <ExpandableStationText
                                text={route.destination || 'Unknown'}
                                className="text-xs text-gray-500 dark:text-gray-400 font-medium mt-1 block w-full max-w-full text-center"
                            />
                        </div>
                      </div>
                    )}
                </div>

                {/* Price & CTA - Col 3 */}
                <div className="col-span-12 md:col-span-3 md:border-l border-gray-200/80 dark:border-gray-700 md:pl-3 flex flex-row md:flex-col items-center justify-between md:justify-center md:items-end text-right h-full">
                     <div className="flex items-center gap-1.5">
                        <PriceTagIcon className="h-4 w-4 text-gray-400" />
                        <div className="text-right">
                            <p className="text-xl font-bold text-[#652D8E] dark:text-purple-300">${unitPrice.toFixed(2)}</p>
                            <p className="text-[10px] text-gray-500 dark:text-gray-400 -mt-0.5">per passenger</p>
                            {hasChildOrYouthPrice(route) && (
                              <p className="text-[10px] text-emerald-600 dark:text-emerald-400 mt-0.5">Child / youth fares available</p>
                            )}
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={handleSelectTrip}
                        disabled={isEmptyTrip || disabled || isSelecting}
                        aria-label={`Book trip from ${route.origin} to ${route.destination} with ${route.busCompany}`}
                        className={`flex items-center justify-center gap-2 font-bold py-2 px-3 rounded-lg transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#652D8E] dark:focus:ring-offset-gray-800 transform group-hover:scale-105 shadow-md md:mt-2 ml-3 md:ml-0 flex-shrink-0 ${
                            isSelecting
                                ? 'bg-[#652D8E]/10 dark:bg-purple-900/30 text-[#652D8E] dark:text-purple-200 cursor-wait'
                                : isEmptyTrip || disabled
                                    ? 'bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed opacity-50'
                                    : 'bg-[#652D8E] dark:bg-purple-600 text-white hover:opacity-90'
                        }`}>
                        {isSelecting ? (
                          <InlineSpinner className="h-4 w-4 text-[#652D8E] dark:text-purple-200" />
                        ) : (
                          <TicketIcon className="h-4 w-4" />
                        )}
                        <span className={isSelecting ? 'text-[#652D8E] dark:text-purple-200' : undefined}>
                          {isSelecting ? 'Selecting...' : 'Select trip'}
                        </span>
                    </button>
                </div>
            </div>
        </div>
    );
};

export default BusResultCard;
