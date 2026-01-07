import React from 'react';
import { BusRoute, timestampToLocaleTime, timestampToLocaleDateTime, SearchQuery, selectTrip } from '../utils/api';
import { ClockIcon, TicketIcon, WifiIcon, PowerIcon, RestroomIcon, ArmchairIcon, CircleIcon, DepartureIcon, ArrivalIcon, PriceTagIcon } from './icons';

interface BusResultCardProps {
  route: BusRoute;
  searchQuery: SearchQuery;
  onTripSelected?: (route: BusRoute) => void;
  disabled?: boolean;
}

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

const BusResultCard: React.FC<BusResultCardProps> = ({ route, searchQuery, onTripSelected, disabled = false }) => {
    const brandColor = getCompanyColor(route.busCompany);
    const safeAmenities = route.amenities || [];
    const displayedAmenities = safeAmenities.slice(0, 3);
    const remainingAmenitiesCount = safeAmenities.length - 3;
    const remainingAmenitiesList = safeAmenities.slice(3).join(', ');

    // Check if this is a placeholder/empty trip (all major fields are fallbacks)
    const isEmptyTrip = route.departureTime === "N/A" &&
                       route.arrivalTime === "N/A" &&
                       route.busCompany === "Unknown Operator";

    const handleSelectTrip = async () => {
        if (isEmptyTrip || disabled) return;

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

        try {
            const selectionResult = await selectTrip({
                trip: route,
                searchQuery: searchQuery
            });

            console.log('📋 [BusResultCard] Trip selection result:', selectionResult);

            if (selectionResult.success) {
                console.log('✅ [BusResultCard] Trip selection successful:', selectionResult);
                // Notify parent component about the successful selection
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
            // Re-throw the error to be handled by the parent component
            throw error;
        }
    };

    return (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md hover:shadow-xl border border-gray-200/80 dark:border-gray-700 transition-all duration-300 overflow-hidden group hover:-translate-y-1 animate-fade-in dark:hover:shadow-2xl dark:hover:shadow-purple-900/20">
            <div className="p-4 md:p-5 grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">

                {/* Company & Amenities - Col 1 */}
                <div className="col-span-12 lg:col-span-3 border-b lg:border-b-0 lg:border-r border-gray-200/80 dark:border-gray-700 pb-4 lg:pb-0 lg:pr-4 flex flex-col justify-between h-full min-h-[60px]">
                    <div>
                        <p style={{ color: brandColor }} className="text-lg font-bold truncate">{route.busCompany || 'Unknown Company'}</p>
                    </div>
                    {safeAmenities.length > 0 && (
                        <div className="flex items-center gap-2 mt-3">
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
                <div className="col-span-12 lg:col-span-6 flex flex-col gap-3">
                    {Array.isArray((route as any).legs) && (route as any).legs.length >= 2 ? (
                      <>
                        {/* Outbound */}
                        <div className="flex flex-col 2xl:flex-row 2xl:items-center gap-3 2xl:gap-0">
                          <div className="flex flex-col items-center text-center w-full 2xl:w-1/3">
                              <div className="flex items-center justify-center gap-2">
                                  <DepartureIcon className="h-6 w-6 text-gray-500 dark:text-gray-400" />
                                  <div className="text-center">
                                      <p className="text-2xl font-bold text-gray-800 dark:text-gray-200 font-mono">
                                          {timestampToLocaleTime((route as any).legs[0].departureTime)}
                                      </p>
                                      <p className="text-xs text-gray-500 dark:text-gray-400">
                                          {timestampToLocaleDateTime((route as any).legs[0].departureTime)}
                                      </p>
                                  </div>
                              </div>
                              <p className="text-sm text-gray-500 dark:text-gray-400 font-medium truncate mt-1">{(route as any).legs[0].origin || 'Unknown'}</p>
                              <p className="text-[10px] uppercase tracking-wide text-gray-400 mt-1">Outbound</p>
                          </div>
                          <div className="w-full 2xl:w-1/3 flex-grow flex flex-col items-center text-gray-500 dark:text-gray-400 px-2">
                              <div className="flex items-center gap-1 text-xs font-semibold">
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
                                  <ArrivalIcon className="h-6 w-6 text-gray-500 dark:text-gray-400" />
                                  <div className="text-center">
                                      <p className="text-2xl font-bold text-gray-800 dark:text-gray-200 font-mono">
                                          {timestampToLocaleTime((route as any).legs[0].arrivalTime)}
                                      </p>
                                      <p className="text-xs text-gray-500 dark:text-gray-400">
                                          {timestampToLocaleDateTime((route as any).legs[0].arrivalTime)}
                                      </p>
                                  </div>
                              </div>
                              <p className="text-sm text-gray-500 dark:text-gray-400 font-medium truncate mt-1">{(route as any).legs[0].destination || 'Unknown'}</p>
                          </div>
                        </div>
                        <div className="h-px bg-gray-200 dark:bg-gray-700" />
                        {/* Return */}
                        <div className="flex flex-col 2xl:flex-row 2xl:items-center gap-3 2xl:gap-0">
                          <div className="flex flex-col items-center text-center w-full 2xl:w-1/3">
                              <div className="flex items-center justify-center gap-2">
                                  <DepartureIcon className="h-6 w-6 text-gray-500 dark:text-gray-400" />
                                  <div className="text-center">
                                      <p className="text-2xl font-bold text-gray-800 dark:text-gray-200 font-mono">
                                          {timestampToLocaleTime((route as any).legs[1].departureTime)}
                                      </p>
                                      <p className="text-xs text-gray-500 dark:text-gray-400">
                                          {timestampToLocaleDateTime((route as any).legs[1].departureTime)}
                                      </p>
                                  </div>
                              </div>
                              <p className="text-sm text-gray-500 dark:text-gray-400 font-medium truncate mt-1">{(route as any).legs[1].origin || 'Unknown'}</p>
                              <p className="text-[10px] uppercase tracking-wide text-gray-400 mt-1">Return</p>
                          </div>
                          <div className="w-full 2xl:w-1/3 flex-grow flex flex-col items-center text-gray-500 dark:text-gray-400 px-2">
                              <div className="flex items-center gap-1 text-xs font-semibold">
                                  <ClockIcon className="h-3 w-3" />
                                  <span>{(route as any).legs[1].duration || 'N/A'}</span>
                              </div>
                              <div className="w-full flex items-center">
                                  <CircleIcon className="h-3 w-3 text-gray-300 dark:text-gray-600 flex-shrink-0" />
                                  <div className="w-full h-px bg-gray-300 dark:bg-gray-600 border-t border-dashed"></div>
                                  <CircleIcon className="h-3 w-3 text-gray-300 dark:text-gray-600 flex-shrink-0" />
                              </div>
                          </div>
                          <div className="flex flex-col items-center text-center w-full 2xl:w-1/3">
                              <div className="flex items-center justify-center gap-2">
                                  <ArrivalIcon className="h-6 w-6 text-gray-500 dark:text-gray-400" />
                                  <div className="text-center">
                                      <p className="text-2xl font-bold text-gray-800 dark:text-gray-200 font-mono">
                                          {timestampToLocaleTime((route as any).legs[1].arrivalTime)}
                                      </p>
                                      <p className="text-xs text-gray-500 dark:text-gray-400">
                                          {timestampToLocaleDateTime((route as any).legs[1].arrivalTime)}
                                      </p>
                                  </div>
                              </div>
                              <p className="text-sm text-gray-500 dark:text-gray-400 font-medium truncate mt-1">{(route as any).legs[1].destination || 'Unknown'}</p>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="flex flex-col 2xl:flex-row 2xl:items-center gap-3 2xl:gap-0">
                        <div className="flex flex-col items-center text-center w-full 2xl:w-1/3">
                            <div className="flex items-center justify-center gap-2">
                                <DepartureIcon className="h-6 w-6 text-gray-500 dark:text-gray-400" />
                                <div className="text-center">
                                    <p className="text-2xl font-bold text-gray-800 dark:text-gray-200 font-mono">
                                        {isEmptyTrip ? "N/A" : timestampToLocaleTime(route.departureTime)}
                                    </p>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">
                                        {isEmptyTrip ? "N/A" : timestampToLocaleDateTime(route.departureTime)}
                                    </p>
                                </div>
                            </div>
                            <p className="text-sm text-gray-500 dark:text-gray-400 font-medium truncate mt-1">{route.origin || 'Unknown'}</p>
                        </div>
                        <div className="w-full 2xl:w-1/3 flex-grow flex flex-col items-center text-gray-500 dark:text-gray-400 px-2">
                            <div className="flex items-center gap-1 text-xs font-semibold">
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
                                <ArrivalIcon className="h-6 w-6 text-gray-500 dark:text-gray-400" />
                                <div className="text-center">
                                    <p className="text-2xl font-bold text-gray-800 dark:text-gray-200 font-mono">
                                        {isEmptyTrip ? "N/A" : timestampToLocaleTime(route.arrivalTime)}
                                    </p>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">
                                        {isEmptyTrip ? "N/A" : timestampToLocaleDateTime(route.arrivalTime)}
                                    </p>
                                </div>
                            </div>
                            <p className="text-sm text-gray-500 dark:text-gray-400 font-medium truncate mt-1">{route.destination || 'Unknown'}</p>
                        </div>
                      </div>
                    )}
                </div>

                {/* Price & CTA - Col 3 */}
                <div className="col-span-12 lg:col-span-3 lg:border-l border-gray-200/80 dark:border-gray-700 lg:pl-4 flex flex-col items-stretch lg:items-end justify-between lg:justify-center text-right h-full gap-3">
                    <div className="flex items-center gap-1.5">
                        <PriceTagIcon className="h-5 w-5 text-gray-400" />
                        <div>
                            <p className="text-3xl font-bold text-[#652D8E] dark:text-purple-300">${(route.price || 0).toFixed(2)}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 -mt-1">per passenger</p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={handleSelectTrip}
                        disabled={isEmptyTrip || disabled}
                        aria-label={`Book trip from ${route.origin} to ${route.destination} with ${route.busCompany}`}
                        className={`w-full flex items-center justify-center gap-2 font-bold py-3 px-5 rounded-lg transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#652D8E] dark:focus:ring-offset-gray-800 transform group-hover:scale-105 shadow-md mt-2 ${
                            isEmptyTrip || disabled
                                ? 'bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed opacity-50'
                                : 'bg-[#652D8E] dark:bg-purple-600 text-white hover:opacity-90'
                        }`}>
                        <TicketIcon className="h-5 w-5"/>
                        <span>{disabled ? 'Selecting...' : 'Book now'}</span>
                    </button>
                </div>
            </div>
        </div>
    );
};

export default BusResultCard;
