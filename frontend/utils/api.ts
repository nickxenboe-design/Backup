// ---------------------
// src/utils/api.ts
// ---------------------

// ---------------------
// Imports & Types
// ---------------------
// Use the canonical trip mapper implementation from src/utils/tripMapper
import { mapTripResponse } from "../src/utils/tripMapper";
import type {
  BusRoute,
  SearchQuery,
  BookingDetails,
  ContactInfo,
  BookingPassenger,
  TripSelectionResponse,
  Passenger
} from "../types";

// Re-export types for backward compatibility
export type { BusRoute, SearchQuery, BookingDetails, ContactInfo, BookingPassenger, TripSelectionResponse, Passenger } from "../types";

// Export API health return type
export interface ApiHealthResult {
  available: boolean;
  message?: string;
}

const API_BASE_URL = (import.meta as any).env?.VITE_API_BASE_URL || "/api";
const IS_DEV = typeof import.meta !== 'undefined' && (((import.meta as any).env?.DEV) ?? false);

// ---------------------
// Cart session
// ---------------------
const CART_STORAGE_KEY = "natticks_cart";

export interface SegmentInfo {
  id: string;
  isLegacy: boolean;
}

export interface CartSessionData {
  cartId?: string;
  tripId?: string;
  segmentInfo?: SegmentInfo[];
  timestamp: number;
}

export const getCartData = (): CartSessionData | null => {
  console.log('🛒 [Cart] Getting cart data from sessionStorage');

  if (typeof window === 'undefined') {
    console.log('🛒 [Cart] Server-side rendering, no sessionStorage available');
    return null;
  }

  try {
    const data = sessionStorage.getItem(CART_STORAGE_KEY);
    if (!data) {
      console.log("🛒 [Cart] No cart data found in sessionStorage");
      return null;
    }

    const parsed = JSON.parse(data) as CartSessionData;

    if (Date.now() - parsed.timestamp > 24 * 60 * 60 * 1000) {
      console.warn("⚠️ [Cart] Cart data expired, clearing old data");
      sessionStorage.removeItem(CART_STORAGE_KEY);
      return null;
    }

    console.log("🛒 [Cart] Retrieved cart data:", parsed);
    return parsed;
  } catch (e) {
    console.error("❌ [Cart] Error reading cart data:", e);
    return null;
  }
};

// ---------------------
// Select Trip (create/update cart; supports round-trip)
// ---------------------
export const selectTrip = async ({
  trip,
  searchQuery,
  returnTripId,
  returnTrip
}: {
  trip: BusRoute;
  searchQuery: SearchQuery;
  returnTripId?: string;
  returnTrip?: BusRoute;
}): Promise<TripSelectionResponse> => {
  try {
    const existingCart = getCartData();

    const payload: any = {
      tripId: trip.tripId || trip.id,
      searchId: searchQuery.searchId,
      passengers: searchQuery.passengers,
      tripType: searchQuery.tripType,
    };

    const finalReturnTripId = returnTripId || returnTrip?.tripId || returnTrip?.id;
    if (finalReturnTripId) {
      payload.returnTripId = finalReturnTripId;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Request-ID': `select_${Date.now()}`,
    };
    if (existingCart?.cartId) headers['X-Cart-ID'] = existingCart.cartId;
    if (existingCart?.tripId) headers['X-Trip-ID'] = existingCart.tripId;

    const response = await fetch(`${API_BASE_URL}/select`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify(payload),
    });

    let data: any = {};
    try {
      data = await response.json();
    } catch {
      // non-JSON response
    }

    if (!response.ok) {
      return { success: false, message: data?.message || `Server error: ${response.status}` };
    }

    const responseCartId = data.cartId || data.cart_id || existingCart?.cartId;
    const responseTripId = data.tripId || data.trip_id || existingCart?.tripId || (trip.tripId || trip.id);

    // Persist cart context and segment info
    const segmentsOutbound = extractSegmentInfo(trip);
    const segmentsInbound = finalReturnTripId && returnTrip ? extractSegmentInfo(returnTrip) : [];
    const combinedSegments = [...segmentsOutbound, ...segmentsInbound];
    saveCartData({ cartId: responseCartId, tripId: responseTripId, segmentInfo: combinedSegments });

    return {
      success: true,
      cartId: responseCartId,
      tripId: responseTripId,
      segmentInfo: combinedSegments,
      message: data?.message,
    };
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : 'Trip selection failed' };
  }
};

export const saveCartData = (data: Partial<CartSessionData>) => {
  console.log('💾 [Cart] Saving cart data to sessionStorage:', data);

  if (typeof window === 'undefined') {
    console.log('💾 [Cart] Server-side rendering, no sessionStorage available');
    return;
  }

  try {
    const cartData: CartSessionData = {
      ...(getCartData() || {}),
      ...data,
      timestamp: Date.now()
    };

    sessionStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cartData));
    console.log("✅ [Cart] Cart data saved successfully");
  } catch (e) {
    console.error("❌ [Cart] Error saving cart data:", e);
  }
};

export interface PurchaseSessionData {
  purchaseId?: string;
  purchaseUuid?: string;
  userId?: string;
  timestamp: number;
}

const PURCHASE_STORAGE_KEY = "natticks_purchase";

export const getPurchaseData = (): PurchaseSessionData | null => {
  console.log('🛒 [Purchase] Getting purchase data from sessionStorage');

  if (typeof window === 'undefined') {
    console.log('🛒 [Purchase] Server-side rendering, no sessionStorage available');
    return null;
  }

  try {
    const data = sessionStorage.getItem(PURCHASE_STORAGE_KEY);
    console.log('🛒 [Purchase] Raw sessionStorage data:', data);

    if (!data) {
      console.log("🛒 [Purchase] No purchase data found in sessionStorage");
      return null;
    }

    const parsed = JSON.parse(data) as PurchaseSessionData;
    console.log("🛒 [Purchase] Parsed purchase data:", parsed);

    if (Date.now() - parsed.timestamp > 7 * 24 * 60 * 60 * 1000) { // 7 days expiry
      console.warn("⚠️ [Purchase] Purchase data expired, clearing old data");
      sessionStorage.removeItem(PURCHASE_STORAGE_KEY);
      return null;
    }

    console.log("🛒 [Purchase] Retrieved purchase data:", parsed);
    return parsed;
  } catch (e) {
    console.error("❌ [Purchase] Error reading purchase data:", e);
    return null;
  }
};

export const savePurchaseData = (data: Partial<PurchaseSessionData>) => {
  console.log('💾 [Purchase] Saving purchase data to sessionStorage:', data);

  if (typeof window === 'undefined') {
    console.log('💾 [Purchase] Server-side rendering, no sessionStorage available');
    return;
  }

  try {
    const purchaseData: PurchaseSessionData = {
      ...(getPurchaseData() || {}),
      ...data,
      timestamp: Date.now()
    };

    sessionStorage.setItem(PURCHASE_STORAGE_KEY, JSON.stringify(purchaseData));
    console.log("✅ [Purchase] Purchase data saved successfully");
  } catch (e) {
    console.error("❌ [Purchase] Error saving purchase data:", e);
  }
};

export const clearPurchaseData = () => {
  console.log("🧹 [Purchase] Clearing purchase data from sessionStorage");

  if (typeof window === 'undefined') {
    console.log('🧹 [Purchase] Server-side rendering, no sessionStorage available');
    return;
  }

  sessionStorage.removeItem(PURCHASE_STORAGE_KEY);
  console.log("✅ [Purchase] Purchase data cleared");
};

// ---------------------
// Map Trip
// ---------------------
export const mapTrip = (trip: any, searchContext?: Partial<Pick<BusRoute, "search_id">>): BusRoute => {
  console.log('🗺️ [Trip Mapping] Starting trip mapping process');
  console.log('📥 [Trip Mapping] Raw trip data:', trip);
  console.log('🔍 [Trip Mapping] Search context:', searchContext);

  try {
    console.log('🔄 [Trip Mapping] Calling mapTripResponse...');
    const mapped = mapTripResponse(trip);
    console.log('✅ [Trip Mapping] mapTripResponse completed:', mapped);

    // Use search ID from context or trip data (try multiple sources)
    let finalSearchId = searchContext?.search_id || trip.search_id || trip.searchId;

    // If not found, try to extract from the trip ID structure
    if (!finalSearchId && trip.id) {
      try {
        // The trip ID might be a base64-encoded JSON containing the search ID
        const decodedId = JSON.parse(atob(trip.id));
        finalSearchId = decodedId.searchId || decodedId.search_id || decodedId.id;
        console.log('🔍 [Trip Mapping] Extracted searchId from trip data:', finalSearchId);
      } catch (e) {
        console.warn('⚠️ [Trip Mapping] Could not decode trip ID as base64 JSON:', e);
      }
    }

    if (!finalSearchId) {
      console.warn('⚠️ [Trip Mapping] No search ID found - using fallback');
      finalSearchId = 'unknown';
    }

    const result = {
      ...mapped,
      search_id: finalSearchId,
      leg_hashes: trip.leg_hashes || [],
      route_ids: trip.route_ids || [],
      version: trip.version || 2,
      id: trip.id || mapped.id || "unknown",
      tripId: trip.id || mapped.tripId || "unknown",
      journey_id: trip.journey_id || mapped.journey_id || "unknown",
      origin: mapped.origin || "Unknown Origin",
      destination: mapped.destination || "Unknown Destination",
      departureTime: mapped.departureTime || "N/A",
      arrivalTime: mapped.arrivalTime || "N/A",
      duration: mapped.duration || "N/A",
      operator: mapped.operator || "Unknown Operator",
      busCompany: mapped.busCompany || "Unknown Operator",
      amenities: mapped.amenities || [],
      className: mapped.className || "N/A",
      price: mapped.price || 0,
      currency: mapped.currency || "USD",
      deeplink: mapped.deeplink || "#",
      segments: mapped.segments || [],
      prices: mapped.prices || [],
    };

    console.log('🎯 [Trip Mapping] Final mapped trip:', result);
    console.log('🔍 [Trip Mapping] Final search_id:', result.search_id);
    return result;
  } catch (error) {
    console.error("❌ [Trip Mapping] Error during mapping:", error);
    console.log('🔄 [Trip Mapping] Returning fallback trip data');

    return {
      id: "unknown",
      tripId: "unknown",
      journey_id: "unknown",
      origin: "Unknown Origin",
      destination: "Unknown Destination",
      departureTime: "N/A",
      arrivalTime: "N/A",
      duration: "N/A",
      operator: "Unknown Operator",
      busCompany: "Unknown Operator",
      amenities: [],
      className: "N/A",
      price: 0,
      currency: "USD",
      deeplink: "#",
      segments: [],
      prices: [],
      search_id: (() => {
        // Try to extract search ID from searchContext or trip data
        let fallbackSearchId = searchContext?.search_id;

        // If not found, try to extract from the trip ID structure
        if (!fallbackSearchId && trip?.id) {
          try {
            const decodedId = JSON.parse(atob(trip.id));
            fallbackSearchId = decodedId.searchId || decodedId.search_id || decodedId.id;
            console.log('🔍 [Trip Mapping] Extracted searchId from fallback trip data:', fallbackSearchId);
          } catch (e) {
            console.warn('⚠️ [Trip Mapping] Could not decode fallback trip ID as base64 JSON:', e);
          }
        }

        if (!fallbackSearchId) {
          console.warn('⚠️ [Trip Mapping] No search ID found in fallback context - using unknown');
          fallbackSearchId = 'unknown';
        }

        return fallbackSearchId;
      })(),
      leg_hashes: [],
      route_ids: [],
      version: 2,
    };
  }
};

// ---------------------
// Segment Info Helper
// ---------------------
export const extractSegmentInfo = (trip: BusRoute | any): SegmentInfo[] => {
  console.log('🔍 [Segment Extraction] Starting segment extraction');
  console.log('📥 [Segment Extraction] Trip data:', trip);
  console.log('📋 [Segment Extraction] Trip keys:', Object.keys(trip || {}));

  const segments: SegmentInfo[] = [];
  console.log('📋 [Segment Extraction] Initial segments array created');

  if (Array.isArray(trip.segments)) {
    console.log('🔗 [Segment Extraction] Found segments array with', trip.segments.length, 'segments');
    trip.segments.forEach((segment: any, index: number) => {
      console.log(`🔗 [Segment Extraction] Processing segment ${index}:`, segment);
      console.log(`🔗 [Segment Extraction] Segment keys:`, Object.keys(segment || {}));

      if (segment.segment_id) {
        console.log(`✅ [Segment Extraction] Added segment with segment_id: ${segment.segment_id}`);
        segments.push({ id: segment.segment_id, isLegacy: false });
      } else if (segment.id) {
        console.log(`✅ [Segment Extraction] Added segment with id: ${segment.id}`);
        segments.push({ id: segment.id, isLegacy: !segment.id.startsWith('leg_') });
      } else {
        console.log(`❌ [Segment Extraction] Segment ${index} has no usable ID`);
      }
    });
  } else {
    console.log('❌ [Segment Extraction] No segments array found');
  }

  if (segments.length === 0 && trip.segment_id) {
    console.log(`🔗 [Segment Extraction] No segments found in array, using direct segment_id: ${trip.segment_id}`);
    segments.push({ id: trip.segment_id, isLegacy: false });
  }

  if (segments.length === 0 && trip.tripId) {
    console.log(`🔗 [Segment Extraction] No segments found, using tripId as fallback: ${trip.tripId}`);
    segments.push({ id: trip.tripId, isLegacy: true });
  }

  if (segments.length === 0 && trip.id && trip.id !== "unknown") {
    console.log(`🔗 [Segment Extraction] No segments found, using trip id as fallback: ${trip.id}`);
    segments.push({ id: trip.id, isLegacy: true });
  }

  if (segments.length === 0 && Array.isArray(trip.legs)) {
    console.log('🔗 [Segment Extraction] No segments found, checking legacy legs array with', trip.legs.length, 'legs');
    trip.legs.forEach((leg: any, index: number) => {
      console.log(`🔗 [Segment Extraction] Processing leg ${index}:`, leg);
      console.log(`🔗 [Segment Extraction] Leg keys:`, Object.keys(leg || {}));

      if (leg.segment_id) {
        console.log(`✅ [Segment Extraction] Added segment from leg with segment_id: ${leg.segment_id}`);
        segments.push({ id: leg.segment_id, isLegacy: false });
      } else if (leg.id) {
        console.log(`✅ [Segment Extraction] Added segment from leg with id: ${leg.id}`);
        segments.push({ id: leg.id, isLegacy: !leg.id.startsWith('leg_') });
      } else {
        console.log(`❌ [Segment Extraction] Leg ${index} has no usable ID`);
      }
    });
  }

  if (segments.length === 0) {
    console.error('❌ [Segment Extraction] No segments found with any method');
    throw new Error('Invalid trip data: Missing segment information');
  }

  console.log('🎯 [Segment Extraction] Final extracted segments:', segments);
  console.log('📊 [Segment Extraction] Segments count:', segments.length);

  return segments;
};

// ---------------------
// Timestamp helpers
// ---------------------
export const timestampToISO = (timestamp: any): string | null => {
  console.log('⏰ [Timestamp] Converting timestamp to ISO:', timestamp);

  try {
    if (timestamp == null) {
      console.log('⏰ [Timestamp] Timestamp is null or undefined, returning null');
      return null;
    }

    // Handle Date objects
    if (timestamp instanceof Date) {
      console.log('⏰ [Timestamp] Timestamp is Date object');
      const result = isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
      console.log('⏰ [Timestamp] Date conversion result:', result);
      return result;
    }

    // Handle string dates in YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss format
    if (typeof timestamp === 'string') {
      console.log('⏰ [Timestamp] Timestamp is string, attempting to parse as date');
      // Check if it's a valid date string (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss)
      const date = new Date(timestamp);
      if (!isNaN(date.getTime())) {
        const result = date.toISOString();
        console.log('⏰ [Timestamp] String date parsed successfully:', result);
        return result;
      }
      console.log('⏰ [Timestamp] Failed to parse string as date, trying as number');
    }

    // Handle numeric timestamps
    const ts = Number(timestamp);
    console.log('⏰ [Timestamp] Converted to number:', ts);

    if (isNaN(ts) || !isFinite(ts)) {
      console.log('⏰ [Timestamp] Number conversion failed (NaN or not finite)');
      return null;
    }

    const date = ts > 1e12 ? new Date(ts) : new Date(ts * 1000);
    const result = isNaN(date.getTime()) ? null : date.toISOString();
    console.log('⏰ [Timestamp] Final ISO result:', result);
    return result;
  } catch (e) {
    console.error("❌ [Timestamp] Error during conversion:", e);
    return null;
  }
};

export const timestampToLocaleTime = (timestamp: any): string => {
  console.log('🕐 [Time Format] Converting timestamp to locale time:', timestamp);

  // Handle string fallbacks like "N/A"
  if (typeof timestamp === 'string' && (timestamp === "N/A" || timestamp.trim() === "")) {
    console.log('🕐 [Time Format] String fallback detected, returning --:--');
    return '--:--';
  }

  // If it's already a time string like "14:30", return as-is
  if (typeof timestamp === 'string' && timestamp.includes(':') && !timestamp.includes('T') && !timestamp.includes(' ')) {
    console.log('🕐 [Time Format] Already formatted time string, returning as-is');
    return timestamp;
  }

  const iso = timestampToISO(timestamp);
  if (!iso) {
    console.log('🕐 [Time Format] ISO conversion failed, returning --:--');
    return '--:--';
  }

  try {
    const date = new Date(iso);
    const result = date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    console.log('🕐 [Time Format] Final locale time result:', result);
    return result;
  } catch (e) {
    console.error("❌ [Time Format] Error formatting time:", e);
    return '--:--';
  }
};

export const timestampToLocaleDateTime = (timestamp: any): string => {
  console.log('📅 [DateTime Format] Converting timestamp to locale datetime:', timestamp);

  // Handle string fallbacks like "N/A"
  if (typeof timestamp === 'string' && (timestamp === "N/A" || timestamp.trim() === "")) {
    console.log('📅 [DateTime Format] String fallback detected, returning --:--');
    return '--:--';
  }

  // If it's already a time string like "14:30", we need to combine with today's date
  if (typeof timestamp === 'string' && timestamp.includes(':') && !timestamp.includes('T') && !timestamp.includes(' ')) {
    console.log('📅 [DateTime Format] Time string detected, combining with today\'s date');
    try {
      const today = new Date();
      const [hours, minutes] = timestamp.split(':').map(Number);
      const dateWithTime = new Date(today.getFullYear(), today.getMonth(), today.getDate(), hours, minutes);
      const result = dateWithTime.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
      console.log('📅 [DateTime Format] Final datetime result:', result);
      return result;
    } catch (e) {
      console.error("❌ [DateTime Format] Error formatting datetime from time string:", e);
      return '--:--';
    }
  }

  const iso = timestampToISO(timestamp);
  if (!iso) {
    console.log('📅 [DateTime Format] ISO conversion failed, returning --:--');
    return '--:--';
  }

  try {
    const date = new Date(iso);
    const result = date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    console.log('📅 [DateTime Format] Final datetime result:', result);
    return result;
  } catch (e) {
    console.error("❌ [DateTime Format] Error formatting datetime:", e);
    return '--:--';
  }
};

// ---------------------
// Middleware for logging
// ---------------------
async function logRequest(method: string, url: string, body?: any) {
  if (!IS_DEV) return;
  console.log('🌐 [API] Request:', {
    timestamp: new Date().toISOString(),
    method,
    url,
    ...(body && { requestBody: body })
  });
}

async function logResponse(method: string, url: string, response: Response, responseData: any) {
  if (!IS_DEV) return;
  console.log('📩 [API] Response:', {
    timestamp: new Date().toISOString(),
    method,
    url,
    status: response.status,
    statusText: response.statusText,
    responseData: responseData
  });
}

// ---------------------
// Search Trips
// ---------------------
export const searchTrips = async (searchQuery: SearchQuery): Promise<BusRoute[]> => {
  console.log('🔍 [Search] Starting trip search process');
  console.log('📋 [Search] Search query:', searchQuery);

  const { origin, destination, departureDate, passengers, filters = {} } = searchQuery;
  console.log('📋 [Search] Extracted parameters:', { origin, destination, departureDate, passengers, filters });

  const params = new URLSearchParams({
    origin,
    destination,
    date: departureDate,
    adults: passengers.adults.toString(),
    children: (passengers.children || 0).toString(),
    ...(passengers.seniors && { seniors: passengers.seniors.toString() }),
    ...(passengers.students && { students: passengers.students.toString() }),
    ...(filters.maxPrice && { maxPrice: filters.maxPrice.toString() }),
    ...(filters.departureTime && { departureTime: filters.departureTime })
  });

  if (IS_DEV) console.log('🔗 [Search] API URL:', `${API_BASE_URL}/search?${params.toString()}`);
  if (IS_DEV) console.log('📋 [Search] Method: GET');

  try {
    if (IS_DEV) console.log('📤 [Search] Sending search request...');
    const response = await fetch(`${API_BASE_URL}/search?${params.toString()}`, { headers: { "Content-Type": "application/json" }, credentials: 'include' });
    if (IS_DEV) console.log('🌐 [Search] Response status:', response.status);
    if (IS_DEV) console.log('🌐 [Search] Response headers:', Object.fromEntries(response.headers.entries()));

    if (!response.ok) {
      if (IS_DEV) console.error('❌ [Search] Server error:', response.status);
      throw new Error(`Server error: ${response.status}`);
    }

    const data = await response.json();
    if (IS_DEV) console.log('📥 [Search] Raw API response:', data);

    // Map results into BusRoute[] using mapTrip helper
    const searchId = (data && (data.search_id || data.searchId || data.id)) as string | undefined;
    let trips: any[] = [];
    if (Array.isArray(data?.trips)) trips = data.trips;
    else if (Array.isArray(data?.routes)) trips = data.routes;
    else if (Array.isArray(data?.data?.trips)) trips = data.data.trips;
    else if (Array.isArray(data?.results)) trips = data.results;
    else if (data?.trip) trips = [data.trip];

    const mapped: BusRoute[] = trips.map((t) => mapTrip(t, searchId ? { search_id: searchId } : undefined));
    if (IS_DEV) console.log('🧭 [Search] Mapped trips count:', mapped.length);
    return mapped;
  } catch (error: any) {
    console.error('❌ [Search] Trip search failed:', error);
    return [];
  }
};

// ---------------------
// Poll Trips
// ---------------------
export const pollTrips = async (searchId: string, maxAttempts = 20, delay = 1500): Promise<BusRoute[]> => {
  if (IS_DEV) console.log(`🔁 [Poll] Starting polling process for searchId: ${searchId}`);
  if (IS_DEV) console.log(`🔗 [Poll] API URL: ${API_BASE_URL}/poll?searchId=${searchId}`);
  if (IS_DEV) console.log(`📋 [Poll] Method: GET`);
  if (IS_DEV) console.log(`⏱️ [Poll] Max attempts: ${maxAttempts}, Delay: ${delay}ms`);

  let attempts: number = 0; // Add type declaration for attempts

  while (attempts < maxAttempts) {
    if (IS_DEV) console.log(`🕓 [Poll] Attempt ${attempts + 1}/${maxAttempts}`);

    try {
      if (IS_DEV) console.log(`📤 [Poll] Sending poll request for attempt ${attempts + 1}...`);
      const response = await fetch(`${API_BASE_URL}/poll?searchId=${encodeURIComponent(searchId)}`, { credentials: 'include' });
      if (IS_DEV) console.log('🌐 [Poll] Response status:', response.status);
      if (IS_DEV) console.log('🌐 [Poll] Response headers:', Object.fromEntries(response.headers.entries()));

      const data = await response.json();
      if (IS_DEV) console.log('📥 [Poll] Poll response data:', data);

      const done = !!(data?.done || data?.completed || data?.status === 'complete');
      let trips: any[] = [];
      if (Array.isArray(data?.trips)) trips = data.trips;
      else if (Array.isArray(data?.routes)) trips = data.routes;
      else if (Array.isArray(data?.data?.trips)) trips = data.data.trips;

      if (done || trips.length > 0) {
        const mapped: BusRoute[] = trips.map((t: any) => mapTrip(t, { search_id: searchId }));
        if (IS_DEV) console.log('🧭 [Poll] Returning mapped trips count:', mapped.length);
        return mapped;
      }
    } catch (e: any) {
      console.error('❌ [Poll] Polling error:', e instanceof Error ? e.message : 'Unknown error');
      // continue to next attempt after delay
    }
    attempts++;
    await new Promise((r) => setTimeout(r, delay));             
  }
  if (IS_DEV) console.warn('⏹️ [Poll] Max attempts reached with no results');
  return [];
};

// ---------------------
// Submit Booking
// ---------------------
export const submitBooking = async ({
  contactInfo,
  passengers,
  paymentMethod,
  tripId,
  searchQuery
}: {
  contactInfo: ContactInfo;
  passengers: Passenger[];
  paymentMethod: string;
  tripId: string;
  searchQuery: SearchQuery;
}): Promise<{ success: boolean; bookingId?: string; message?: string }> => {
  if (IS_DEV) console.log('🚀 [Booking] Starting booking submission process');
  if (IS_DEV) console.log('📋 [Booking] Contact info:', contactInfo);
  if (IS_DEV) console.log('📋 [Booking] Passengers:', passengers);
  if (IS_DEV) console.log('📋 [Booking] Payment method:', paymentMethod);
  if (IS_DEV) console.log('📋 [Booking] Trip ID:', tripId);
  if (IS_DEV) console.log('📋 [Booking] Search query:', searchQuery);

  try {
    const cartData = getCartData();
    const cartId = cartData?.cartId || '';
    const tripIdFinal = tripId || cartData?.tripId || '';
    const payload = {
      contactInfo,
      passengers,
      paymentMethod,
      tripId: tripIdFinal,
      searchQuery
    };

    if (IS_DEV) console.log('📤 [Booking] Sending booking request...');
    const response = await fetch(`${API_BASE_URL}/trips/frontend`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Cart-ID': cartId,
        'X-Trip-ID': tripIdFinal,
        'X-Request-ID': `booking_${Date.now()}`
      },
      credentials: 'include',
      body: JSON.stringify(payload)
    });

    if (IS_DEV) console.log('🌐 [Booking] Response status:', response.status);
    if (IS_DEV) console.log('🌐 [Booking] Response headers:', Object.fromEntries(response.headers.entries()));

    const data = await response.json();
    if (IS_DEV) console.log('📥 [Booking] API Response:', data);

    const responseCartId = data.cartId || data.cart_id;
    if (responseCartId && responseCartId !== cartId) {
      if (IS_DEV) console.log('🔄 [Booking] Updating cart ID:', { oldCartId: cartId, newCartId: responseCartId });
      saveCartData({ cartId: responseCartId });
    }

    if (!response.ok) {
      console.error('❌ [Booking] Booking submission failed:', data.message || `Server error: ${response.status}`);
      throw new Error(data.message || `Server error: ${response.status}`);
    }

    // Save purchase data if backend provides it
    const responsePurchaseId = data.purchase_id || data.purchaseId;
    const responsePurchaseUuid = data.purchase_uuid || data.purchaseUuid;
    const responseUserId = data.user_id || data.userId;
    if (responsePurchaseId && responsePurchaseUuid) {
      savePurchaseData({
        purchaseId: String(responsePurchaseId),
        purchaseUuid: String(responsePurchaseUuid),
        userId: responseUserId ? String(responseUserId) : undefined
      });
    }

    return {
      success: true,
      bookingId: data.bookingId || data.booking_id,
      message: data.message || 'Booking submitted successfully'
    };
  } catch (error) {
    console.error('❌ [Booking] Booking submission failed:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Failed to submit booking. Please try again.'
    };
  }
};

// ---------------------
// Purchase/Ticket Purchase (extract from session)
// ---------------------
export const createPurchase = async ({
  tripId,
  bookingId,
  cartId
}: {
  tripId: string;
  bookingId?: string;
  cartId?: string;
}): Promise<{ success: boolean; purchaseId?: string; purchaseUuid?: string; ticketNumbers?: string[]; extractedFields?: { purchaseId?: string; purchaseUuid?: string; userId?: string }; message?: string }> => {
  console.log('💳 [Purchase] Starting purchase data extraction process');
  console.log('📋 [Purchase] Input parameters:', { tripId, bookingId, cartId });

  try {
    const sessionCart = getCartData();
    const sessionPurchase = getPurchaseData();

    const finalCartId = cartId || sessionCart?.cartId;
    const finalBookingId = bookingId || sessionCart?.tripId || tripId;
    const purchaseId = sessionPurchase?.purchaseId;
    const purchaseUuid = sessionPurchase?.purchaseUuid;
    const userId = sessionPurchase?.userId;

    const result = {
      success: !!(purchaseId && purchaseUuid),
      purchaseId,
      purchaseUuid,
      ticketNumbers: [],
      extractedFields: {
        purchaseId: purchaseId?.toString(),
        purchaseUuid: purchaseUuid?.toString(),
        userId: userId?.toString()
      },
      message: purchaseId && purchaseUuid
        ? 'Purchase data extracted successfully'
        : 'Purchase data not available in session'
    };

    console.log('🎯 [Purchase] Final result object:', result);
    console.log('📊 [Purchase] Extraction summary:', {
      dataFound: !!(purchaseId && purchaseUuid),
      source: sessionPurchase?.purchaseId === sessionCart?.tripId ? 'frontend-fallback' : 'middleware',
      middlewareWorking: !(sessionPurchase?.purchaseId === sessionCart?.tripId),
      purchaseId,
      purchaseUuid,
      finalCartId,
      finalBookingId
    });

    return result;
  } catch (error) {
    console.error('❌ [Purchase] Purchase data extraction failed:', error);
    const err: any = error as any;
    console.log('📋 [Purchase] Error context:', {
      errorName: err && err.name,
      errorMessage: err && err.message,
      errorStack: err && err.stack,
      inputParams: { tripId, bookingId, cartId }
    });
    console.log('📋 [Purchase] Session state at error:', {
      cartData: getCartData(),
      purchaseData: getPurchaseData()
    });

    return {
      success: false,
      message: error instanceof Error ? error.message : 'Failed to extract purchase data. Please try again.'
    };
  }
};
export const confirmPurchase = async (): Promise<{ success: boolean; purchaseId?: string; purchaseUuid?: string; ticketNumbers?: string[]; extractedFields?: { purchaseId?: string; purchaseUuid?: string; userId?: string }; message?: string }> => {
  console.log('💳 [Purchase] Starting purchase confirmation process');

  try {
    // Get purchase data from session storage (middleware creates automatically)
    const purchaseData = getPurchaseData();

    const purchaseId = purchaseData?.purchaseId;
    const purchaseUuid = purchaseData?.purchaseUuid;

    console.log('💾 [Purchase] Retrieved from session storage:', {
      purchaseId: purchaseId,
      purchaseUuid: purchaseUuid
    });

    // Get cart data for headers
    const cartData = getCartData();
    const finalCartId = cartData?.cartId;
    const finalBookingId = cartData?.tripId;

    console.log('📋 [Purchase] Using IDs:', {
      purchaseId: purchaseId,
      purchaseUuid: purchaseUuid,
      cartId: finalCartId,
      bookingId: finalBookingId
    });

    // Validate required IDs are available
    if (!finalCartId && !finalBookingId) {
      console.error('❌ [Purchase] No cart or booking reference available');
      console.log('📋 [Purchase] Cart data state:', {
        hasCartId: !!cartData?.cartId,
        hasTripId: !!cartData?.tripId,
        cartId: cartData?.cartId || 'undefined',
        tripId: cartData?.tripId || 'undefined'
      });
      throw new Error('No booking reference found. Please restart the booking process.');
    }

    // Send purchase confirmation request using extracted values first, then fallback to session storage
    console.log('📤 [Purchase] Sending purchase confirmation request...');

    let response;
    try {
      response = await fetch(`${API_BASE_URL}/purchase`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Cart-ID': finalCartId || '',
          'X-Booking-ID': finalBookingId || '',
          'X-Request-ID': `purchase_confirm_${Date.now()}`
        },
        credentials: 'include',
        body: JSON.stringify({
          purchaseId: purchaseId,
          purchaseUuid: purchaseUuid,
        }),
      });
    } catch (fetchError) {
      console.error('❌ [Purchase] Network error during confirmation request:', fetchError);
      console.log('📋 [Purchase] Request details:', {
        url: `${API_BASE_URL}/purchase`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Cart-ID': finalCartId || '',
          'X-Booking-ID': finalBookingId || '',
          'X-Request-ID': `purchase_confirm_${Date.now()}`
        },
        body: {
          purchaseId: purchaseId,
          purchaseUuid: purchaseUuid,
        }
      });
      throw new Error(`Network error: ${fetchError instanceof Error ? fetchError.message : 'Unable to connect to purchase confirmation service'}`);
    }

    console.log('🌐 [Purchase] Response status:', response.status);
    console.log('🌐 [Purchase] Response headers:', Object.fromEntries(response.headers.entries()));

    let confirmationData;
    try {
      confirmationData = await response.json();
      console.log('📥 [Purchase] Confirmation API Response:', confirmationData);
    } catch (parseError) {
      console.error('❌ [Purchase] Failed to parse confirmation response as JSON:', parseError);
      console.log('📋 [Purchase] Raw response status:', response.status);
      console.log('📋 [Purchase] Raw response text:', await response.text());
      throw new Error(`Invalid JSON response: ${parseError instanceof Error ? parseError.message : 'Response parsing failed'}`);
    }

    if (!response.ok) {
      console.error('❌ [Purchase] Purchase confirmation failed:', confirmationData.message || `Server error: ${response.status}`);
      console.log('📋 [Purchase] Error response details:', {
        status: response.status,
        statusText: response.statusText,
        message: confirmationData.message,
        error: confirmationData.error,
        availableFields: Object.keys(confirmationData)
      });
      throw new Error(confirmationData.message || `Purchase confirmation failed: ${response.status}`);
    }

    if (!confirmationData.success) {
      console.error('❌ [Purchase] Purchase confirmation not successful:', confirmationData.message);
      console.log('📋 [Purchase] Confirmation data details:', {
        success: confirmationData.success,
        message: confirmationData.message,
        availableFields: Object.keys(confirmationData)
      });
      throw new Error(confirmationData.message || 'Purchase confirmation failed');
    }

    // Validate response data
    if (!confirmationData.ticketNumbers || !Array.isArray(confirmationData.ticketNumbers)) {
      console.warn('⚠️ [Purchase] No ticket numbers received in confirmation response');
      console.log('📋 [Purchase] Expected ticket numbers but got:', confirmationData.ticketNumbers);
    }

    console.log('✅ [Purchase] Purchase confirmed successfully');
    console.log('📋 [Purchase] Purchase ID:', purchaseId);
    console.log('📋 [Purchase] Purchase UUID:', purchaseUuid);
    console.log('📋 [Purchase] Ticket numbers:', confirmationData.ticketNumbers);

    // Extract additional data if available in confirmation response - use exact field names only
    const finalResponsePurchaseId = confirmationData.purchase_id;
    const finalResponsePurchaseUuid = confirmationData.purchase_uuid;
    const finalUserId = confirmationData.user_id;

    console.log('💾 [Purchase] Final response data extraction:', { finalResponsePurchaseId, finalResponsePurchaseUuid, finalUserId });

    // Update session storage with any additional data from confirmation response
    if (finalResponsePurchaseId && finalResponsePurchaseId !== purchaseId) {
      console.log('🔄 [Purchase] Updating purchase ID from confirmation response:', {
        old: purchaseId,
        new: finalResponsePurchaseId
      });
      savePurchaseData({
        purchaseId: finalResponsePurchaseId.toString(),
        purchaseUuid: finalResponsePurchaseUuid?.toString() || purchaseUuid,
        userId: finalUserId?.toString()
      });
      console.log('✅ [Purchase] Updated purchase data in session storage');
    }

    console.log('🎯 [Purchase] Final result:', {
      success: true,
      purchaseId: finalResponsePurchaseId || purchaseId,
      purchaseUuid: finalResponsePurchaseUuid || purchaseUuid,
      ticketNumbers: confirmationData.ticketNumbers || [],
      message: confirmationData.message || 'Purchase confirmed successfully'
    });

    return {
      success: true,
      purchaseId: finalResponsePurchaseId || purchaseId,
      purchaseUuid: finalResponsePurchaseUuid || purchaseUuid,
      ticketNumbers: confirmationData.ticketNumbers || [],
      extractedFields: {
        purchaseId: (finalResponsePurchaseId || purchaseId)?.toString(),
        purchaseUuid: (finalResponsePurchaseUuid || purchaseUuid)?.toString(),
        userId: finalUserId?.toString()
      },
      message: confirmationData.message || 'Purchase confirmed successfully'
    };

  } catch (error) {
    console.error('❌ [Purchase] Purchase confirmation failed:', error);
    const err: any = error as any;
    console.log('📋 [Purchase] Error details:', {
      errorName: err && err.name,
      errorMessage: err && err.message,
      errorStack: err && err.stack
    });

    // Additional logging for debugging
    console.log('📋 [Purchase] Session storage state at error:', {
      purchaseData: getPurchaseData(),
      cartData: getCartData()
    });

    return {
      success: false,
      message: error instanceof Error ? error.message : 'Failed to confirm purchase. Please try again.'
    };
  }
};
export const checkApiHealth = async (): Promise<ApiHealthResult> => {
  console.log('🏥 [Health] Checking middleware connectivity...');
  console.log('🔗 [Health] API URL:', `${API_BASE_URL}/health`);
  console.log('📋 [Health] Method: GET');

  try {
    console.log('📤 [Health] Sending health check request...');
    const res = await fetch(`${API_BASE_URL}/health`, { credentials: 'include' });
    console.log('🌐 [Health] Response status:', res.status);
    console.log('🌐 [Health] Response headers:', Object.fromEntries(res.headers.entries()));

    const result = { available: res.ok, message: res.ok ? undefined : `HTTP ${res.status}` };
    console.log('📋 [Health] Health check result:', result);

    if (res.ok) {
      console.log('✅ [Health] Middleware is responding correctly');
    } else {
      console.warn('⚠️ [Health] Middleware returned error status:', res.status);
    }

    return result;
  } catch (error) {
    console.error('❌ [Health] Middleware not accessible:', error);
    const result = {
      available: false,
      message: error instanceof Error ? error.message : 'Connection failed'
    };
    console.log('📋 [Health] Health check failed result:', result);
    return result;
  }
};
