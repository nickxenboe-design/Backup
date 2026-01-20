// ---------------------
// src/utils/api.ts
// ---------------------

// ---------------------
// Imports & Types
// ---------------------
import { mapTripResponse } from "./tripMapper";
import { getAgentHeaders, getAgentMetadata } from "./agentHeaders";
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

export interface LocationSuggestion {
  id: string | null;
  name: string;
  city: string;
  region: string;
  country: string;
  latitude?: number | null;
  longitude?: number | null;
  geohash?: string | null;
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
  returnTripId?: string;
  segmentInfo?: SegmentInfo[];
  passengerQuestions?: {
    required: string[];
    optional: string[];
    all: string[];
  };
  quotedTotal?: number;
  quotedCurrency?: string;
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
  pnr?: string;
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

export interface MyBookingSummary {
  cartId: string;
  pnr?: string;
  status?: string;
  origin?: string;
  destination?: string;
  departAt?: any;
  createdAt?: any;
}

const MY_BOOKINGS_STORAGE_KEY = "natticks_my_bookings";

export const getMyBookings = (): MyBookingSummary[] => {
  console.log('📚 [MyBookings] Getting bookings from localStorage');

  if (typeof window === 'undefined' || !window.localStorage) {
    console.log('📚 [MyBookings] No localStorage available');
    return [];
  }

  try {
    const raw = window.localStorage.getItem(MY_BOOKINGS_STORAGE_KEY);
    if (!raw) {
      console.log('📚 [MyBookings] No existing bookings found');
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      console.warn('📚 [MyBookings] Stored bookings value is not an array');
      return [];
    }
    return parsed as MyBookingSummary[];
  } catch (e) {
    console.error('❌ [MyBookings] Error reading bookings from localStorage:', e);
    return [];
  }
};

export const addBookingToHistory = (entry: MyBookingSummary) => {
  console.log('📚 [MyBookings] Adding booking to history:', entry);

  if (typeof window === 'undefined' || !window.localStorage) {
    console.log('📚 [MyBookings] No localStorage available');
    return;
  }

  try {
    const existing = getMyBookings();
    const filtered = existing.filter(b => b && b.cartId !== entry.cartId);
    const normalized: MyBookingSummary = {
      cartId: entry.cartId,
      pnr: entry.pnr,
      status: entry.status,
      origin: entry.origin,
      destination: entry.destination,
      departAt: entry.departAt,
      createdAt: entry.createdAt ?? Date.now()
    };
    const updated = [normalized, ...filtered];
    const maxEntries = 20;
    window.localStorage.setItem(MY_BOOKINGS_STORAGE_KEY, JSON.stringify(updated.slice(0, maxEntries)));
    console.log('✅ [MyBookings] Booking history updated');
  } catch (e) {
    console.error('❌ [MyBookings] Error saving booking history:', e);
  }
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
// Locations (autocomplete)
// ---------------------
export const searchLocations = async (
  query: string,
  limit = 10,
  opts: { signal?: AbortSignal } = {}
): Promise<LocationSuggestion[]> => {
  const trimmed = query.trim();
  const params = new URLSearchParams({
    query: trimmed,
    limit: String(limit)
  });

  const url = `${API_BASE_URL}/search/locations?${params.toString()}`;
  await logRequest('GET', url);

  try {
    const response = await fetch(url, {
      signal: opts.signal
    });

    const body = await response.json().catch(() => null);

    if (!response.ok) {
      console.error('❌ [Locations] Server error:', response.status, body);
      throw new Error((body && (body.message || body.error)) || `Server error: ${response.status}`);
    }

    const locations = Array.isArray(body?.data) ? body.data : [];
    await logResponse('GET', url, response, locations);
    return locations as LocationSuggestion[];
  } catch (error) {
    console.error('❌ [Locations] Autocomplete request failed:', error);
    return [];
  }
};

// ---------------------
// Search Trips
// ---------------------
let __searchTripsInFlight: { key: string; startedAt: number; promise: Promise<BusRoute[]> } | null = null;
let __searchTripsLastCompleted: { key: string; completedAt: number } | null = null;

export const searchTrips = async (searchQuery: SearchQuery): Promise<BusRoute[]> => {
  // Guard: prevent accidental repeated identical searches within a short time window.
  // This protects the backend from bursts caused by re-renders / double-invokes / retries.
  try {
    const key = JSON.stringify({
      origin: searchQuery?.origin,
      destination: searchQuery?.destination,
      departureDate: searchQuery?.departureDate,
      returnDate: searchQuery?.returnDate || null,
      passengers: searchQuery?.passengers || {},
      tripType: (searchQuery as any)?.tripType || null,
      filters: (searchQuery as any)?.filters || {},
    });
    const now = Date.now();

    if (__searchTripsInFlight && __searchTripsInFlight.key === key) {
      return await __searchTripsInFlight.promise;
    }

    // 2s cooldown after completion for identical query
    if (__searchTripsLastCompleted && __searchTripsLastCompleted.key === key) {
      if (now - __searchTripsLastCompleted.completedAt < 2000) {
        return [];
      }
    }

    const run = (async () => {
      try {
        console.log('🔍 [Search] Starting trip search process');
        console.log('📋 [Search] Search query:', searchQuery);

        const { origin, destination, departureDate, returnDate, passengers, filters = {} } = searchQuery;
        console.log('📋 [Search] Extracted parameters:', { origin, destination, departureDate, returnDate, passengers, filters });

        const agentMeta = getAgentMetadata();

        const childrenCount = Number(passengers.children || 0);
        const normalizedChildrenAges = (() => {
          if (!childrenCount || childrenCount <= 0) return [];
          const raw = Array.isArray(passengers.childrenAges) ? passengers.childrenAges : [];
          const cleaned = raw
            .map((v) => parseInt(String(v), 10))
            .filter((v) => Number.isFinite(v) && v >= 0);
          if (cleaned.length === childrenCount) return cleaned;
          return Array.from({ length: childrenCount }, (_, idx) => {
            const v = cleaned[idx];
            return (v != null && Number.isFinite(v)) ? v : 5;
          });
        })();

        const params = new URLSearchParams({
          origin,
          destination,
          date: departureDate,
          adults: passengers.adults.toString(),
          children: childrenCount.toString(),
          ...(childrenCount > 0 ? { age: normalizedChildrenAges.join(',') } : {}),
          ...(passengers.seniors && { seniors: passengers.seniors.toString() }),
          ...(passengers.students && { students: passengers.students.toString() }),
          ...(filters.maxPrice && { maxPrice: filters.maxPrice.toString() }),
          ...(filters.departureTime && { departureTime: filters.departureTime }),
          ...(returnDate && { returnDate }),
          ...(agentMeta.agentMode === 'true' ? {
            agentMode: 'true',
            ...(agentMeta.agentEmail ? { agentEmail: agentMeta.agentEmail } : {}),
            ...(agentMeta.agentId ? { agentId: agentMeta.agentId } : {}),
            ...(agentMeta.agentName ? { agentName: agentMeta.agentName } : {}),
          } : {})
        });

        console.log('🔗 [Search] API URL:', `${API_BASE_URL}/search?${params.toString()}`);
        console.log('📋 [Search] Method: GET');

        console.log('📤 [Search] Sending search request...');
        const response = await fetch(`${API_BASE_URL}/search?${params.toString()}`, { headers: { "Content-Type": "application/json", ...getAgentHeaders() }, credentials: 'include' });
        console.log('🌐 [Search] Response status:', response.status);
        console.log('🌐 [Search] Response headers:', Object.fromEntries(response.headers.entries()));

        if (!response.ok) {
          console.error('❌ [Search] Server error:', response.status);
          throw new Error(`Server error: ${response.status}`);
        }

        const data = await response.json();
        console.log('📥 [Search] Raw API response:', data);

        // Handle searchId-based response (polling required)
        if (data.searchId && !data.trips) {
          console.log(`🔁 [Search] Received searchId: ${data.searchId}, starting polling...`);
          const pollingResult = await pollTrips(data.searchId);
          console.log(`✅ [Search] Polling completed, found ${pollingResult.length} trips`);
          return pollingResult;
        }

        // Handle direct trips response
        if (!Array.isArray(data.trips)) {
          console.warn("⚠️ [Search] No 'trips' array found in response:", data);

          // If response has search context but no trips, return empty array
          if (data.searchId || data.search_id || data.id || (data.metadata && data.metadata.searchId)) {
            console.log('📭 [Search] API response has search context but no trips');
            return [];
          }

          // If no search context at all, throw error
          console.error('❌ [Search] No search context or trips in response');
          throw new Error('Invalid API response: missing search context and trip data');
        }

        console.log(`🔍 [Search] Found ${data.trips.length} trips in direct response`);

        // First, try to extract search ID from API response root level
        let searchId = data.searchId || data.search_id || data.id || data.searchContext || data.contextId ||
                      (data.metadata && (data.metadata.searchId || data.metadata.search_id || data.metadata.id));

        // If not found at root level, try to extract from the first trip
        if (!searchId && data.trips.length > 0) {
          const firstTrip = data.trips[0];
          searchId = firstTrip.search_id || firstTrip.searchId;

          // If still not found, try to decode from trip ID
          if (!searchId && firstTrip.id) {
            try {
              const decodedId = JSON.parse(atob(firstTrip.id));
              searchId = decodedId.searchId || decodedId.search_id || decodedId.id;
              console.log('🔍 [Search] Extracted searchId from first trip data structure:', searchId);
            } catch (e) {
              console.warn('⚠️ [Search] Could not decode trip ID as base64 JSON:', e);
            }
          }
        }

        if (!searchId) {
          console.warn('⚠️ [Search] No search ID found in API response - proceeding without search context (non-blocking)');
          console.log('📋 [Search] Available response fields:', Object.keys(data));
          if (data.metadata) {
            console.log('📋 [Search] Metadata content:', data.metadata);
          }

          const mappedTrips = data.trips.map((trip: any) => mapTrip(trip, { search_id: 'unknown' }));
          console.log(`✅ [Search] Successfully mapped ${mappedTrips.length} trips without searchId`);
          return mappedTrips;
        }

        console.log(`🔍 [Search] Using searchId: ${searchId}`);
        const mappedTrips = data.trips.map((trip: any) => mapTrip(trip, { search_id: searchId }));
        console.log(`✅ [Search] Successfully mapped ${mappedTrips.length} trips with searchId: ${searchId}`);
        return mappedTrips;
      } catch (error) {
        console.error("❌ [Search] Search request failed:", error);
        throw error;
      } finally {
        __searchTripsInFlight = null;
        try {
          __searchTripsLastCompleted = { key, completedAt: Date.now() };
        } catch {}
      }
    })();

    __searchTripsInFlight = { key, startedAt: now, promise: run };
    return await run;
  } catch {
    // Fall back to original implementation below if the guard fails for any reason.
  }

  console.log('🔍 [Search] Starting trip search process');
  console.log('📋 [Search] Search query:', searchQuery);

  const { origin, destination, departureDate, returnDate, passengers, filters = {} } = searchQuery;
  console.log('📋 [Search] Extracted parameters:', { origin, destination, departureDate, returnDate, passengers, filters });

  const agentMeta = getAgentMetadata();

  const childrenCount = Number(passengers.children || 0);
  const normalizedChildrenAges = (() => {
    if (!childrenCount || childrenCount <= 0) return [];
    const raw = Array.isArray(passengers.childrenAges) ? passengers.childrenAges : [];
    const cleaned = raw
      .map((v) => parseInt(String(v), 10))
      .filter((v) => Number.isFinite(v) && v >= 0);
    if (cleaned.length === childrenCount) return cleaned;
    return Array.from({ length: childrenCount }, (_, idx) => {
      const v = cleaned[idx];
      return (v != null && Number.isFinite(v)) ? v : 5;
    });
  })();

  const params = new URLSearchParams({
    origin,
    destination,
    date: departureDate,
    adults: passengers.adults.toString(),
    children: childrenCount.toString(),
    ...(childrenCount > 0 ? { age: normalizedChildrenAges.join(',') } : {}),
    ...(passengers.seniors && { seniors: passengers.seniors.toString() }),
    ...(passengers.students && { students: passengers.students.toString() }),
    ...(filters.maxPrice && { maxPrice: filters.maxPrice.toString() }),
    ...(filters.departureTime && { departureTime: filters.departureTime }),
    ...(returnDate && { returnDate }),
    ...(agentMeta.agentMode === 'true' ? {
      agentMode: 'true',
      ...(agentMeta.agentEmail ? { agentEmail: agentMeta.agentEmail } : {}),
      ...(agentMeta.agentId ? { agentId: agentMeta.agentId } : {}),
      ...(agentMeta.agentName ? { agentName: agentMeta.agentName } : {}),
    } : {})
  });

  console.log('🔗 [Search] API URL:', `${API_BASE_URL}/search?${params.toString()}`);
  console.log('📋 [Search] Method: GET');

  try {
    console.log('📤 [Search] Sending search request...');
    const response = await fetch(`${API_BASE_URL}/search?${params.toString()}`, { headers: { "Content-Type": "application/json", ...getAgentHeaders() }, credentials: 'include' });
    console.log('🌐 [Search] Response status:', response.status);
    console.log('🌐 [Search] Response headers:', Object.fromEntries(response.headers.entries()));

    if (!response.ok) {
      console.error('❌ [Search] Server error:', response.status);
      throw new Error(`Server error: ${response.status}`);
    }

    const data = await response.json();
    console.log('📥 [Search] Raw API response:', data);

    // Handle searchId-based response (polling required)
    if (data.searchId && !data.trips) {
      console.log(`🔁 [Search] Received searchId: ${data.searchId}, starting polling...`);
      const pollingResult = await pollTrips(data.searchId);
      console.log(`✅ [Search] Polling completed, found ${pollingResult.length} trips`);
      return pollingResult;
    }

    // Handle direct trips response
    if (!Array.isArray(data.trips)) {
      console.warn("⚠️ [Search] No 'trips' array found in response:", data);

      // If response has search context but no trips, return empty array
      if (data.searchId || data.search_id || data.id || (data.metadata && data.metadata.searchId)) {
        console.log('📭 [Search] API response has search context but no trips');
        return [];
      }

      // If no search context at all, throw error
      console.error('❌ [Search] No search context or trips in response');
      throw new Error('Invalid API response: missing search context and trip data');
    }

    console.log(`🔍 [Search] Found ${data.trips.length} trips in direct response`);

    // First, try to extract search ID from API response root level
    let searchId = data.searchId || data.search_id || data.id || data.searchContext || data.contextId ||
                   (data.metadata && (data.metadata.searchId || data.metadata.search_id || data.metadata.id));

    // If not found at root level, try to extract from the first trip
    if (!searchId && data.trips.length > 0) {
      const firstTrip = data.trips[0];
      searchId = firstTrip.search_id || firstTrip.searchId;

      // If still not found, try to decode from trip ID
      if (!searchId && firstTrip.id) {
        try {
          const decodedId = JSON.parse(atob(firstTrip.id));
          searchId = decodedId.searchId || decodedId.search_id || decodedId.id;
          console.log('🔍 [Search] Extracted searchId from first trip data structure:', searchId);
        } catch (e) {
          console.warn('⚠️ [Search] Could not decode trip ID as base64 JSON:', e);
        }
      }
    }

    if (!searchId) {
      console.warn('⚠️ [Search] No search ID found in API response - proceeding without search context (non-blocking)');
      console.log('📋 [Search] Available response fields:', Object.keys(data));
      if (data.metadata) {
        console.log('📋 [Search] Metadata content:', data.metadata);
      }

      // Still try to map trips even without searchId
      const mappedTrips = data.trips.map(trip => mapTrip(trip, { search_id: 'unknown' }));
      console.log(`✅ [Search] Successfully mapped ${mappedTrips.length} trips without searchId`);
      return mappedTrips;
    }

    console.log(`🔍 [Search] Using searchId: ${searchId}`);

    // Map all trips but ensure they all have the correct search context
    const mappedTrips = data.trips.map(trip => mapTrip(trip, { search_id: searchId }));
    console.log(`✅ [Search] Successfully mapped ${mappedTrips.length} trips with searchId: ${searchId}`);
    return mappedTrips;
  } catch (error) {
    console.error("❌ [Search] Search request failed:", error);
    console.error("❌ [Search] Request URL:", `${API_BASE_URL}/search?${params.toString()}`);
    console.error("❌ [Search] Request headers:", { "Content-Type": "application/json" });

    // Check if it's a network error or API error
    if (error instanceof Error && error.message.includes('fetch')) {
      throw new Error(`Network error: Unable to connect to the trip search service. Please check your internet connection and try again.`);
    }

    throw error;
  }
};

// ---------------------
// Poll Trips
// ---------------------
export const pollTrips = async (searchId: string, maxAttempts = 20, delay = 1500): Promise<BusRoute[]> => {
  console.log(`🔁 [Poll] Starting polling process for searchId: ${searchId}`);
  console.log(`🔗 [Poll] API URL: ${API_BASE_URL}/poll?searchId=${searchId}`);
  console.log(`📋 [Poll] Method: GET`);
  console.log(`⏱️ [Poll] Max attempts: ${maxAttempts}, Delay: ${delay}ms`);

  let attempts = 0;

  while (attempts < maxAttempts) {
    console.log(`🕓 [Poll] Attempt ${attempts + 1}/${maxAttempts}`);

    try {
      console.log(`📤 [Poll] Sending poll request for attempt ${attempts + 1}...`);
      const response = await fetch(`${API_BASE_URL}/poll?searchId=${searchId}`, { headers: { ...getAgentHeaders() }, credentials: 'include' });
      console.log('🌐 [Poll] Response status:', response.status);
      console.log('🌐 [Poll] Response headers:', Object.fromEntries(response.headers.entries()));

      const data = await response.json();
      console.log('📥 [Poll] Poll response data:', data);

      if (data.success && Array.isArray(data.trips) && data.trips.length > 0) {
        console.log(`🔍 [Poll] Found ${data.trips.length} trips in response`);

        // Extract search ID from response or use the original searchId
        let pollSearchId = data.searchId || data.search_id || data.id || data.contextId || searchId ||
                           (data.metadata && (data.metadata.searchId || data.metadata.search_id || data.metadata.id));

        if (!pollSearchId) {
          console.warn('⚠️ [Poll] No search ID found in polling response - using original searchId');
          pollSearchId = searchId || 'unknown';
        }

        console.log(`🔍 [Poll] Using searchId: ${pollSearchId}`);
        const mapped = data.trips.map(trip => mapTrip(trip, { search_id: pollSearchId }));
        console.log(`🗺️ [Poll] Mapped ${mapped.length} trips`);

        const isComplete = mapped.every(
          (trip) => trip.departureTime !== "N/A" && trip.origin !== "Unknown Origin"
        );
        console.log(`✅ [Poll] Trips ready check: ${isComplete ? 'Complete' : 'Still processing'}`);

        if (isComplete) {
          console.log(`🎯 [Poll] Trips ready after ${attempts + 1} attempts`);
          return mapped;
        } else {
          console.log(`⏳ [Poll] Trips not ready yet, continuing to poll...`);
        }
      } else {
        console.log(`⚠️ [Poll] No valid trips found in response, continuing...`);
      }
    } catch (error) {
      console.error(`❌ [Poll] Error in attempt ${attempts + 1}:`, error);
    }

    console.log(`💤 [Poll] Waiting ${delay}ms before next attempt...`);
    await new Promise(resolve => setTimeout(resolve, delay));
    attempts++;
  }

  console.error(`⏰ [Poll] Timeout reached after ${maxAttempts} attempts`);
  throw new Error("⏰ [Poll] Timeout — trips not ready.");
};
export const selectTrip = async (params: { trip: BusRoute; searchQuery: Omit<SearchQuery, 'searchId'> & { searchId?: string }; returnTripId?: string; returnTrip?: BusRoute; options?: { forceNewCart?: boolean } }): Promise<TripSelectionResponse> => {
  console.log('🚀 [Trip Selection] Starting trip selection process');
  console.log('🔍 [Trip Selection] Search query:', params.searchQuery);

  const { trip, searchQuery, returnTripId, returnTrip, options } = params;
  const agentMeta = getAgentMetadata();

  console.log('📝 [Trip Selection] Trip data:', {
    id: trip.id,
    origin: trip.origin,
    destination: trip.destination,
    departureTime: trip.departureTime,
    search_id: trip.search_id
  });

  // Extract segment info first as it's required for the payload
  let segmentInfo;
  try {
    const outboundSegments = extractSegmentInfo(trip);
    const combinedSegments = returnTrip ? [...outboundSegments, ...extractSegmentInfo(returnTrip)] : outboundSegments;
    segmentInfo = combinedSegments;
    console.log('✅ [Trip Selection] Segment info extracted:', segmentInfo);
  } catch (error) {
    console.error('❌ [Trip Selection] Failed to extract segment info:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Invalid trip data. Please select a different trip.'
    };
  }

  // Validate required fields for the /select endpoint
  if (!trip.origin || !trip.destination) {
    console.error('❌ [Trip Selection] Missing trip origin/destination:', { origin: trip.origin, destination: trip.destination });
    return {
      success: false,
      message: 'Invalid trip data. Please select a different trip.'
    };
  }

  if (!searchQuery.origin || !searchQuery.destination || !searchQuery.departureDate) {
    console.error('❌ [Trip Selection] Missing search query data:', searchQuery);
    return {
      success: false,
      message: 'Missing search information. Please search for trips again.'
    };
  }

  // SearchId is completely optional - just log it if present
  console.log('ℹ️ [Trip Selection] SearchId status:', searchQuery.searchId ? `Present: ${searchQuery.searchId}` : 'Not provided (optional)');

  // Pull any existing cartId from session to reuse the same Busbud cart
  const existingCart = getCartData();
  const existingCartId = existingCart?.cartId;

  // Create the payload with required fields only
  const payload = {
    tripId: trip.tripId || trip.id,
    ...(returnTripId && { returnTripId }),
    ...((existingCartId && !options?.forceNewCart) ? { busbudCartId: existingCartId } : {}),
    origin: trip.origin,
    destination: trip.destination,
    'x-departure': searchQuery.departureDate,
    operator: trip.busCompany || trip.operator,
    price: trip.price,
    currency: trip.currency || 'USD',
    departureTime: trip.departureTime,
    arrivalTime: trip.arrivalTime,
    duration: trip.duration,
    segments: segmentInfo,
    // Only include searchId if it exists (optional field)
    ...(searchQuery.searchId && { searchId: searchQuery.searchId }),
    // Include other search parameters
    search_origin: searchQuery.origin,
    search_destination: searchQuery.destination,
    passengers: searchQuery.passengers,
    segment_ids: segmentInfo.map(s => s.id),
    segment_info: segmentInfo,
    timestamp: Date.now(),
    ...(agentMeta.agentMode === 'true' ? {
      agentMode: 'true',
      ...(agentMeta.agentEmail ? { agentEmail: agentMeta.agentEmail } : {}),
      ...(agentMeta.agentId ? { agentId: agentMeta.agentId } : {}),
      ...(agentMeta.agentName ? { agentName: agentMeta.agentName } : {}),
    } : {})
  };

  console.log('📤 [Trip Selection] Sending trip selection payload:', JSON.stringify(payload, null, 2));

  try {
    console.log('📤 [Trip Selection] Sending trip selection request...');
    const url = `${API_BASE_URL}/trips/select`;
    const requestBody = JSON.stringify(payload);
    
    // Log the outgoing request
    await logRequest('POST', url, payload);
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAgentHeaders(),
      },
      credentials: 'include',
      body: requestBody,
    });
    
    // Parse response once and store it
    const responseData = await response.json().catch(() => ({}));

    
    if (responseData.success) {
      const busbudCartId = responseData.busbudCartId; // This is the Busbud cart ID
      console.log('Busbud Cart ID:', busbudCartId);
    }

    console.log('🔍 [Trip Selection] Full response:', JSON.stringify(responseData, null, 2));
    
    // Log all available IDs for debugging
    console.log('🔍 [Trip Selection] Available IDs in response:', {
      id: responseData.id,
      cartId: responseData.cartId,
      busbudCartId: responseData.busbudCartId,
    
    });
    
    // Extract busbud cart ID from response only
    const extractedId = responseData.busbudCartId;
    
    if (extractedId) {
      console.log('✅ [Trip Selection] Extracted ID:', extractedId);
    } else {
      console.warn('⚠️ [Trip Selection] No valid ID found in response');
    }
    // Log the incoming response
    await logResponse('POST', url, response, responseData);
    
    console.log('🌐 [Trip Selection] Response status:', response.status);

    if (!response.ok) {
      console.error('❌ [Trip Selection] API error response:', responseData);
      throw new Error(responseData.message || `HTTP error! status: ${response.status}`);
    }

    if (responseData.success) {
      const busbudCartId = responseData.busbudCartId; // This is the Busbud cart ID
      console.log('Busbud Cart ID:', busbudCartId);
    }
    // 

    // Use the already parsed response data
    const data = responseData;
    console.log('✅ [Trip Selection] Success response:', data);

    // Log the full response structure for debugging
    console.log('🔍 [Trip Selection] Full response structure:', JSON.parse(JSON.stringify(data)));
    
    // Extract cart ID from the response
    let cartId: string | undefined;
    
    try {
      // Log the full response for debugging
      console.log('🔍 [Trip Selection] Full response data:', JSON.stringify(data, null, 2));
      
      // Cart ID pattern based on the example: "OWMxMTczZmItNzliZS00M2"
      // Format: 20-22 alphanumeric characters with dashes
      const cartIdPattern = /^[A-Za-z0-9]{3}-?[A-Za-z0-9]{4}-?[A-Za-z0-9]{4}-?[A-Za-z0-9]{4}-?[A-Za-z0-9]{5,7}$/;
      
      if (!data) {
        console.error('❌ [Trip Selection] No data in response');
      } else {
        // Check for cart ID in the expected response structure (strict: busbudCartId only)
        const potentialCartId = data.busbudCartId;
        if (potentialCartId) {
          const cleanCartId = String(potentialCartId).trim();
          if (cartIdPattern.test(cleanCartId)) {
            cartId = cleanCartId;
            console.log('✅ [Trip Selection] Valid cart ID found:', cartId);
            if (data.itemsCount !== undefined) {
              console.log(`🛒 [Trip Selection] Cart contains ${data.itemsCount} items`);
            }
            if (data.status) {
              console.log(`ℹ️ [Trip Selection] Cart status: ${data.status}`);
            }
          } else {
            console.warn('⚠️ [Trip Selection] busbudCartId present but invalid format:', cleanCartId);
          }
        }
      }

      // If we still don't have a cart ID, treat as error (no fallbacks)
      if (!cartId) {
        throw new Error('Missing busbudCartId in response');
      }
    } catch (error) {
      console.error('❌ [Trip Selection] Error extracting cart ID:', error);
    }
    
    // The trip ID comes from the trip object or the response
    const tripId = data.trip?.id || data.tripId || data.trip_id || trip?.tripId || trip?.id;
    
    console.log('🔍 [Trip Selection] Extracted IDs:', { cartId, tripId });

   
    if (cartId && tripId) {
      console.log('💾 [Trip Selection] Saving cart data to session storage...');
      try {
        const finalCartId = cartId || `cart_${Date.now()}`;
        const quotedOutbound = typeof trip.price === 'number' && Number.isFinite(trip.price) ? trip.price : 0;
        const legs = (trip as any)?.legs;
        const isAggregatedRoundTrip = !returnTripId && !returnTrip && Array.isArray(legs) && legs.length >= 2;

        const quotedTotal = (() => {
          if (isAggregatedRoundTrip) {
            const leg0 = Number(legs?.[0]?.price || 0);
            const leg1 = Number(legs?.[1]?.price || 0);
            const legsTotal = (Number.isFinite(leg0) ? leg0 : 0) + (Number.isFinite(leg1) ? leg1 : 0);
            return legsTotal > 0 ? legsTotal : quotedOutbound;
          }

          const quotedReturn = (returnTrip && typeof returnTrip.price === 'number' && Number.isFinite(returnTrip.price)
            ? returnTrip.price
            : 0);

          return quotedOutbound + quotedReturn;
        })();
        const quotedCurrency = trip.currency || returnTrip?.currency || 'USD';

        const cartData = { 
          cartId: finalCartId, 
          tripId, 
          ...(returnTripId ? { returnTripId } : {}),
          segmentInfo,
          ...(data && data.passengerQuestions ? { passengerQuestions: data.passengerQuestions } : {}),
          quotedTotal,
          quotedCurrency,
          timestamp: Date.now() // Using numeric timestamp instead of ISO string
        };
        
        // Save to session storage
        sessionStorage.setItem('selectedTrip', JSON.stringify(cartData));
        console.log('💾 [Trip Selection] Cart data saved to session storage:', cartData);
        
        // Also save using the existing saveCartData function for compatibility
        saveCartData(cartData);
        console.log('✅ [Trip Selection] Cart data saved successfully');
      } catch (error) {
        console.error('❌ [Trip Selection] Failed to save cart data to session storage:', error);
        throw new Error('Failed to save trip selection. Please try again.');
      }
    } else {
      throw new Error('Missing busbudCartId or tripId in response');
    }

    console.log('✅ [Trip Selection] Trip selection completed successfully');
    return {
      success: true,
      cartId,
      tripId,
      segmentInfo,
      message: data.message || 'Trip selected successfully'
    };
  } catch (error) {
    console.error('❌ [Trip Selection] Trip selection failed:', error);

    return {
      success: false,
      message: error instanceof Error ? error.message : 'Failed to select trip. Please try again.'
    };
  }
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
}): Promise<{ success: boolean; bookingId?: string; pnr?: string; message?: string; finalTotal?: number; currency?: string }> => {
    console.log('🚀 [Booking] Starting booking submission process');
    console.log('📋 [Booking] Contact info:', contactInfo);
    console.log('📋 [Booking] Passengers:', passengers);
    console.log('📋 [Booking] Payment method:', paymentMethod);
    console.log('📋 [Booking] Trip ID:', tripId);
    console.log('📋 [Booking] Search query:', searchQuery);

  try {
    // --- 1. Get Cart Data ---
    console.log('🛒 [Booking] Getting cart data from session storage...');
    const cartData = getCartData();
    let cartId: string;
    let tripIdFinal: string;
    let returnTripIdFinal: string | undefined;

    if (cartData?.cartId && cartData?.tripId) {
      // Use existing cart data
      cartId = cartData.cartId;
      tripIdFinal = cartData.tripId;
      returnTripIdFinal = cartData.returnTripId;
      console.log('🛒 [Booking] Using existing cart data:', { cartId, tripId: tripIdFinal, returnTripId: returnTripIdFinal });
    } else {
      console.error('❌ [Booking] No cart data found in session storage');
      throw new Error('Cart data missing. Please select a trip first.');
    }

    // Transform passengers data to match middleware expectations
    console.log('👥 [Booking] Transforming passenger data...');

    const getAgeFromDob = (dob?: string): number | null => {
      if (!dob) {
        return null;
      }
      const birthDate = new Date(dob);
      if (isNaN(birthDate.getTime())) {
        return null;
      }
      const today = new Date();
      let age = today.getFullYear() - birthDate.getFullYear();
      const monthDiff = today.getMonth() - birthDate.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        age--;
      }
      return age;
    };

    const transformedPassengers: BookingPassenger[] = passengers.map((passenger, index) => ({
      id: index + 1,
      firstName: passenger.firstName,
      lastName: passenger.lastName,
      type: passenger.type as 'adult' | 'child' | 'senior' | 'student',
      seatNumber: '',
      idNumber: passenger.idNumber,
      idType: passenger.idType,
      nationality: passenger.nationality,
      dateOfBirth: passenger.dob,
      gender: passenger.gender
    }));
    console.log('✅ [Booking] Passengers transformed:', transformedPassengers);

    // --- Extract Segment Information ---
    const segmentInfo = cartData?.segmentInfo || [];
    console.log('🔗 [Booking] Using segment info:', segmentInfo);

    if (segmentInfo.length === 0) {
      console.error('❌ [Booking] No segment information found, cannot proceed with booking');
      throw new Error('Invalid trip data: Missing segment information');
    }

    // For backward compatibility, also maintain the original segmentIds array
    const segmentIds = segmentInfo.map(s => s.id);
    console.log('🔗 [Booking] Segment IDs:', segmentIds);

    // --- Build Passenger Data ---
    const ticketType = 'eticket'; // Default ticket type
    console.log('🎫 [Booking] Using ticket type:', ticketType);

    // --- Construct Final Payload ---
    // Check if payment method is in-store
    const isInStorePayment = paymentMethod?.toLowerCase() === 'in-store';
    
    const agentMeta = getAgentMetadata();

    const payload = {
      // Core booking data
      busbudCartId: cartId,
      trip_id: tripIdFinal,
      ...(returnTripIdFinal ? { returnTripId: returnTripIdFinal } : {}),
      
      // Add hold flag for in-store payments
      ...(isInStorePayment && { hold: true }),

      // Trip details - use searchQuery as fallback since we don't have direct trip access
      origin: searchQuery.origin,
      destination: searchQuery.destination,
      departure_date: searchQuery.departureDate,

      // Contact information
      contact_info: contactInfo,

      // Passenger information
      passengers: transformedPassengers.map((passenger, index) => {
        const sourcePassenger: any = Array.isArray(passengers) ? (passengers as any[])[index] : null;
        const computedAge = getAgeFromDob(passenger.dateOfBirth);
        if (passenger.type === 'child' && (computedAge === null || computedAge < 0)) {
          throw new Error(`Age is required for child passenger #${index + 1}. Please provide a valid date of birth.`);
        }
        const finalAge = computedAge !== null ? computedAge : 25;

        const normalizeQuestionKeyLocal = (value: any) => {
          try {
            return String(value || '')
              .trim()
              .toLowerCase()
              .replace(/[\s-]+/g, '_')
              .replace(/[^a-z0-9_]/g, '');
          } catch {
            return '';
          }
        };

        const dobValue = (() => {
          try {
            const raw = String((passenger as any)?.dateOfBirth || '').trim();
            if (!raw) return '';
            const d = raw.includes('T') ? raw.slice(0, 10) : raw;
            return d;
          } catch {
            return '';
          }
        })();

        const idTypeValue = (() => {
          try {
            const raw = String((passenger as any)?.idType || (passenger as any)?.id_type || '').trim().toLowerCase();
            if (!raw) return '';
            const s = raw.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
            if (s === 'passport') return 'passport';
            if (s === 'national_id' || s === 'nationalid' || s === 'nat_id' || s === 'id') return 'national_id';
            if (s === 'id_card' || s === 'idcard' || s === 'identity_card' || s === 'identitycard') return 'id_card';
            if (s === 'drivers_license' || s === 'driver_license' || s === 'driving_license' || s === 'driverslicence') return 'drivers_license';
            return s;
          } catch {
            return '';
          }
        })();

        const genderValue = (() => {
          try {
            const s = String((passenger as any)?.gender || '').trim();
            return s ? s : '';
          } catch {
            return '';
          }
        })();

        const allowedKeys = (() => {
          try {
            const pq = cartData && cartData.passengerQuestions ? cartData.passengerQuestions : null;
            const allRaw = pq && Array.isArray(pq.all) ? pq.all : [];
            const requiredRaw = pq && Array.isArray(pq.required) ? pq.required : [];
            const optionalRaw = pq && Array.isArray(pq.optional) ? pq.optional : [];
            const source = allRaw && allRaw.length ? allRaw : [...requiredRaw, ...optionalRaw];
            return new Set(source.map((k) => String(k || '').trim().toLowerCase()).filter(Boolean));
          } catch {
            return new Set();
          }
        })();

        const answerMap = new Map<string, string>();
        if (dobValue) answerMap.set('dob', dobValue);
        if (genderValue) answerMap.set('gender', genderValue);
        if (idTypeValue) answerMap.set('id_type', idTypeValue);
        if (passenger.idNumber) answerMap.set('id_number', String(passenger.idNumber));
        if (passenger.nationality) answerMap.set('nationality', String(passenger.nationality));

        try {
          const qa = sourcePassenger && sourcePassenger.questionAnswers && typeof sourcePassenger.questionAnswers === 'object'
            ? sourcePassenger.questionAnswers
            : null;
          if (qa) {
            for (const [kRaw, vRaw] of Object.entries(qa)) {
              const k = normalizeQuestionKeyLocal(kRaw);
              const v = String(vRaw || '').trim();
              if (!k || !v) continue;
              answerMap.set(k, v);
            }
          }
        } catch {
        }

        const rawAnswers = Array.from(answerMap.entries()).map(([question_key, value]) => ({ question_key, value }));
        const answers = rawAnswers.filter((a) => a && a.question_key && allowedKeys.has(String(a.question_key).trim().toLowerCase()));

        return {
          id: index + 1,
          first_name: passenger.firstName,
          last_name: passenger.lastName,
          category: passenger.type || 'adult',
          age: finalAge, // Default age since BookingPassenger doesn't have age property
          wheelchair: false,
          discounts: [],
          phone: '', // Default empty since BookingPassenger doesn't have phone property
          selected_seats: segmentInfo.map(({id}) => ({
            segment_id: id,  // Always use the ID as segment_id
            seat_id: ''
            // Remove the trip_id field as it's not needed
          })),
          answers
        };
      }),

      // Ticket types
      ticket_types: segmentIds.reduce((acc, id) => {
        acc[id] = ticketType;
        return acc;
      }, {} as Record<string, string>),

      // Agent attribution fallback (in case headers are stripped)
      ...(agentMeta.agentMode === 'true' ? {
        agentMode: 'true',
        ...(agentMeta.agentEmail ? { agentEmail: agentMeta.agentEmail } : {}),
        ...(agentMeta.agentId ? { agentId: agentMeta.agentId } : {}),
        ...(agentMeta.agentName ? { agentName: agentMeta.agentName } : {}),
      } : {})
    };

    console.log('📦 [Booking] Final payload constructed:', JSON.stringify(payload, null, 2));
    console.log('🔄 [Booking] Payment method:', paymentMethod, '| Hold flag:', isInStorePayment);
    console.log('🔗 [Booking] API URL:', `${API_BASE_URL}/trips/frontend`);
    console.log('📋 [Booking] Method: POST');

    // --- Send Booking Request ---
    console.log('📤 [Booking] Sending booking request...');
    const response = await fetch(`${API_BASE_URL}/trips/frontend`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Cart-ID': cartId,
        'X-Trip-ID': tripIdFinal,
        'X-Request-ID': `booking_${Date.now()}`,
        ...getAgentHeaders(),
      },
      credentials: 'include',
      body: JSON.stringify(payload)
    });

    console.log('🌐 [Booking] Response status:', response.status);
    console.log('🌐 [Booking] Response headers:', Object.fromEntries(response.headers.entries()));

    const data = await response.json();
    console.log('📥 [Booking] API Response:', data);
    console.log('📋 [Booking] Available response fields:', Object.keys(data));
    console.log('📋 [Booking] Full response data:', JSON.stringify(data, null, 2));

    const responsePnr = (() => {
      try {
        if (!data || typeof data !== 'object') return undefined;
        const anyData = data as any;
        const getStr = (obj: any, key: string) => (typeof obj?.[key] === 'string' ? obj[key] : undefined);
        // Prefer Firestore cart ID variants as PNR
        const firestorePnr =
          getStr(anyData, 'firestoreCartId') ??
          getStr(anyData, 'firestoreCartID') ??
          getStr(anyData, 'firestorecartId') ??
          getStr(anyData, 'firestorecartID') ??
          getStr(anyData, 'firestore_cart_id');
        if (firestorePnr) return firestorePnr;
        // Fallbacks
        if (anyData.invoice && typeof anyData.invoice.pnr === 'string') return anyData.invoice.pnr;
        if (typeof anyData.pnr === 'string') return anyData.pnr;
        if (typeof anyData.PNR === 'string') return anyData.PNR;
        if (anyData.booking && typeof anyData.booking.pnr === 'string') return anyData.booking.pnr;
      } catch {}
      return undefined;
    })();

    const responsePricing = (() => {
      try {
        if (!data || typeof data !== 'object') return null;
        const anyData = data as any;

        const toNumber = (v: any): number | null => {
          if (typeof v === 'number' && Number.isFinite(v)) return v;
          if (typeof v === 'string') {
            const s = v.trim();
            if (!s) return null;
            const n = Number(s);
            return Number.isFinite(n) ? n : null;
          }
          return null;
        };

        const normalizeLikelyCents = (n: number): number => {
          // Heuristic: totals coming back as integer cents are typically >= 1000 (=$10.00)
          if (Number.isInteger(n) && Math.abs(n) >= 1000) {
            return Math.round((n / 100) * 100) / 100;
          }
          return n;
        };

        const candidates = [
          anyData?.pricing,
          anyData?.data?.pricing,
        ].filter(Boolean);

        for (const pricing of candidates) {
          if (!pricing || typeof pricing !== 'object') continue;
          const totalRaw = toNumber((pricing as any).total ?? (pricing as any).amount);
          const currencyRaw = typeof (pricing as any).currency === 'string' ? (pricing as any).currency : null;
          if (totalRaw != null) {
            return { total: normalizeLikelyCents(totalRaw), currency: currencyRaw || undefined };
          }
        }

        const invoiceCandidates = [
          anyData?.invoice,
          anyData?.data?.invoice,
          anyData?.confirmation?.invoice,
          anyData?.data?.confirmation?.invoice,
        ].filter(Boolean);

        for (const invoice of invoiceCandidates) {
          if (!invoice || typeof invoice !== 'object') continue;
          const totalRaw = toNumber((invoice as any).total ?? (invoice as any).amount);
          const currencyRaw = typeof (invoice as any).currency === 'string' ? (invoice as any).currency : null;
          if (totalRaw != null) {
            return { total: normalizeLikelyCents(totalRaw), currency: currencyRaw || undefined };
          }
        }

        return null;
      } catch {
        return null;
      }
    })();

    // --- Handle Response ---
    const responseCartId = data.cartId || data.cart_id;
    if (responseCartId && responseCartId !== cartId) {
      console.log('🔄 [Booking] Updating cart ID:', { oldCartId: cartId, newCartId: responseCartId });
      saveCartData({ cartId: responseCartId });
    }

    if (!response.ok) {
      console.error('❌ [Booking] Booking submission failed:', data.message || `Server error: ${response.status}`);
      throw new Error(data.message || `Server error: ${response.status}`);
    }

    // Extract purchase data from booking response (middleware creates automatically)
    const responsePurchaseId = data.purchase_id;
    const responsePurchaseUuid = data.purchase_uuid;
    const responseUserId = data.user_id;

    console.log('💳 [Booking] Extracting purchase data from booking response:', {
      responsePurchaseId,
      responsePurchaseUuid,
      responseUserId
    });

    // Save purchase data to session storage if available in booking response
    if (responsePurchaseId && responsePurchaseUuid) {
      console.log('✅ [Booking] Purchase data found in booking response, saving to session storage');
      savePurchaseData({
        purchaseId: responsePurchaseId.toString(),
        purchaseUuid: responsePurchaseUuid.toString(),
        userId: responseUserId?.toString(),
        ...(responsePnr ? { pnr: responsePnr.toString() } : {})
      });
      console.log('✅ [Booking] Purchase data saved from booking response');
    } else {
      console.log('📋 [Booking] No purchase data found in booking response - middleware should create purchases automatically');
      console.log('📋 [Booking] Available response fields:', Object.keys(data));
      console.log('📋 [Booking] Response data:', JSON.stringify(data, null, 2));

      // Fallback: Create purchase data from booking data if middleware doesn't provide it
      if (data.bookingId) {
        console.log('🔄 [Booking] Creating fallback purchase data from booking response');
        const fallbackPurchaseId = data.bookingId;
        const fallbackPurchaseUuid = `purchase_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        savePurchaseData({
          purchaseId: fallbackPurchaseId,
          purchaseUuid: fallbackPurchaseUuid,
          userId: responseUserId?.toString(),
          ...(responsePnr ? { pnr: responsePnr.toString() } : {})
        });

        console.log('✅ [Booking] Fallback purchase data created and saved:', {
          purchaseId: fallbackPurchaseId,
          purchaseUuid: fallbackPurchaseUuid
        });
      } else {
        console.error('❌ [Booking] No purchase data or booking ID available in response');
        console.log('📋 [Booking] This indicates a middleware configuration issue');
        console.log('📋 [Booking] Expected fields: purchase_id, purchase_uuid, bookingId');
      }
    }

    console.log('✅ [Booking] Booking submitted successfully');
    console.log('📋 [Booking] Final booking ID:', data.bookingId);

    return {
      success: true,
      bookingId: data.bookingId,
      pnr: responsePnr,
      ...(responsePricing ? { finalTotal: responsePricing.total, currency: responsePricing.currency } : {}),
      message: data.message || 'Booking submitted successfully'
    };
  } catch (error) {
    console.error('❌ [Booking] Booking submission failed:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Failed to submit booking. Please try again.'
    };
  }
}

// Purchase/Ticket Purchase
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
    // Get cart data and purchase data from session storage
    const cartData = getCartData();
    const purchaseData = getPurchaseData();

    const finalCartId = cartId || cartData?.cartId;
    const finalBookingId = bookingId || cartData?.tripId;

    console.log('🔍 [Purchase] Starting purchase data extraction...');
    console.log('📋 [Purchase] Cart data from session:', {
      cartId: cartData?.cartId,
      tripId: cartData?.tripId,
      segmentInfo: cartData?.segmentInfo,
      timestamp: cartData?.timestamp
    });
    console.log('📋 [Purchase] Purchase data from session:', {
      purchaseId: purchaseData?.purchaseId,
      purchaseUuid: purchaseData?.purchaseUuid,
      userId: purchaseData?.userId,
      timestamp: purchaseData?.timestamp,
      isFromMiddleware: !!(purchaseData?.purchaseId && purchaseData?.purchaseUuid),
      dataSource: purchaseData?.purchaseId === cartData?.tripId ? 'fallback' : 'middleware'
    });
    console.log('📋 [Purchase] Final resolved IDs:', {
      finalCartId,
      finalBookingId,
      tripId
    });

    if (!finalCartId && !finalBookingId) {
      console.error('❌ [Purchase] No cart or booking ID available');
      console.log('📋 [Purchase] Available data:', {
        inputCartId: cartId,
        inputBookingId: bookingId,
        sessionCartId: cartData?.cartId,
        sessionTripId: cartData?.tripId
      });
      throw new Error('No booking reference found. Please restart the booking process.');
    }

    // Get purchase ID and UUID from session storage (created automatically by middleware or fallback)
    const purchaseId = purchaseData?.purchaseId;
    const purchaseUuid = purchaseData?.purchaseUuid;
    const userId = purchaseData?.userId;

    console.log('💾 [Purchase] Extracted purchase data from session storage:', {
      purchaseId,
      purchaseUuid,
      userId,
      dataType: typeof purchaseData,
      isValid: !!(purchaseId && purchaseUuid)
    });

    // Log the source of the purchase data
    if (purchaseData?.purchaseId && purchaseData?.purchaseUuid) {
      if (purchaseData.purchaseId === cartData?.tripId) {
        console.log('🔄 [Purchase] Using fallback purchase data (created by frontend)');
        console.log('📋 [Purchase] Fallback reason: Middleware did not provide purchase data in booking response');
      } else {
        console.log('✅ [Purchase] Using middleware purchase data (created automatically during booking)');
        console.log('📋 [Purchase] Middleware integration: Working correctly');
      }
    } else {
      console.error('❌ [Purchase] Purchase data is missing or incomplete');
      console.log('📋 [Purchase] This should not happen - check booking submission process');
    }

    // If purchase data already exists, just return it (no API call needed)
    console.log('✅ [Purchase] Purchase data extraction completed successfully');
    console.log('📋 [Purchase] Final extracted data:', {
      purchaseId,
      purchaseUuid,
      userId,
      source: purchaseData?.purchaseId === cartData?.tripId ? 'fallback' : 'middleware'
    });

    const result = {
      success: true,
      purchaseId: purchaseId,
      purchaseUuid: purchaseUuid,
      ticketNumbers: [],
      extractedFields: {
        purchaseId: purchaseId?.toString(),
        purchaseUuid: purchaseUuid?.toString(),
        userId: userId?.toString()
      },
      message: 'Purchase data extracted successfully'
    };

    console.log('🎯 [Purchase] Final result object:', result);
    console.log('📊 [Purchase] Extraction summary:', {
      dataFound: !!(purchaseId && purchaseUuid),
      source: purchaseData?.purchaseId === cartData?.tripId ? 'frontend-fallback' : 'middleware',
      middlewareWorking: !(purchaseData?.purchaseId === cartData?.tripId),
      purchaseId,
      purchaseUuid
    });

    return result;

  } catch (error) {
    console.error('❌ [Purchase] Purchase data extraction failed:', error);
    console.log('📋 [Purchase] Error context:', {
      errorName: error?.name,
      errorMessage: error?.message,
      errorStack: error?.stack,
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
export const confirmPurchase = async (): Promise<{ success: boolean; statusCode?: number; purchaseId?: string; purchaseUuid?: string; ticketNumbers?: string[]; extractedFields?: { purchaseId?: string; purchaseUuid?: string; userId?: string }; message?: string }> => {
  console.log('💳 [Purchase] Starting purchase confirmation process');

  try {
    // Get purchase data from session storage (middleware creates automatically)
    const purchaseData = getPurchaseData();

    console.log('💾 [Purchase] Retrieved from session storage:', {
      purchaseId: purchaseData.purchaseId,
      purchaseUuid: purchaseData.purchaseUuid
    });

    // Get cart data for headers
    const cartData = getCartData();
    const finalCartId = cartData?.cartId;
    const finalBookingId = cartData?.tripId;

    console.log('📋 [Purchase] Using IDs:', {
      purchaseId: purchaseData.purchaseId,
      purchaseUuid: purchaseData.purchaseUuid,
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
          'X-Request-ID': `purchase_confirm_${Date.now()}`,
          ...getAgentHeaders(),
        },
        credentials: 'include',
        body: JSON.stringify({
          purchaseId: purchaseData.purchaseId,
          purchaseUuid: purchaseData.purchaseUuid,
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
          purchaseId: purchaseData.purchaseId,
          purchaseUuid: purchaseData.purchaseUuid,
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

      const msg =
        (confirmationData && (confirmationData.message || confirmationData.error?.message)) ||
        `Purchase confirmation failed: ${response.status}`;

      const err: any = new Error(msg);
      err.statusCode = response.status;
      throw err;
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
    console.log('📋 [Purchase] Purchase ID:', purchaseData.purchaseId);
    console.log('📋 [Purchase] Purchase UUID:', purchaseData.purchaseUuid);
    console.log('📋 [Purchase] Ticket numbers:', confirmationData.ticketNumbers);

    // Extract additional data if available in confirmation response - use exact field names only
    const finalResponsePurchaseId = confirmationData.purchase_id;
    const finalResponsePurchaseUuid = confirmationData.purchase_uuid;
    const finalUserId = confirmationData.user_id;

    console.log('💾 [Purchase] Final response data extraction:', { finalResponsePurchaseId, finalResponsePurchaseUuid, finalUserId });

    // Update session storage with any additional data from confirmation response
    if (finalResponsePurchaseId && finalResponsePurchaseId !== purchaseData.purchaseId) {
      console.log('🔄 [Purchase] Updating purchase ID from confirmation response:', {
        old: purchaseData.purchaseId,
        new: finalResponsePurchaseId
      });
      savePurchaseData({
        purchaseId: finalResponsePurchaseId.toString(),
        purchaseUuid: finalResponsePurchaseUuid?.toString() || purchaseData.purchaseUuid,
        userId: finalUserId?.toString()
      });
      console.log('✅ [Purchase] Updated purchase data in session storage');
    }

    console.log('🎯 [Purchase] Final result:', {
      success: true,
      purchaseId: finalResponsePurchaseId || purchaseData.purchaseId,
      purchaseUuid: finalResponsePurchaseUuid || purchaseData.purchaseUuid,
      ticketNumbers: confirmationData.ticketNumbers || [],
      message: confirmationData.message || 'Purchase confirmed successfully'
    });

    return {
      success: true,
      purchaseId: finalResponsePurchaseId || purchaseData.purchaseId,
      purchaseUuid: finalResponsePurchaseUuid || purchaseData.purchaseUuid,
      ticketNumbers: confirmationData.ticketNumbers || [],
      extractedFields: {
        purchaseId: (finalResponsePurchaseId || purchaseData.purchaseId)?.toString(),
        purchaseUuid: (finalResponsePurchaseUuid || purchaseData.purchaseUuid)?.toString(),
        userId: finalUserId?.toString()
      },
      message: confirmationData.message || 'Purchase confirmed successfully'
    };

  } catch (error) {
    console.error('❌ [Purchase] Purchase confirmation failed:', error);
    console.log('📋 [Purchase] Error details:', {
      errorName: error?.name,
      errorMessage: error?.message,
      errorStack: error?.stack
    });

    // Additional logging for debugging
    console.log('📋 [Purchase] Session storage state at error:', {
      purchaseData: getPurchaseData(),
      cartData: getCartData()
    });

    return {
      success: false,
      statusCode: (error as any)?.statusCode,
      message: error instanceof Error ? error.message : 'Failed to confirm purchase. Please try again.'
    };
  }
};

export const getPurchaseStatus = async (
  purchaseId: string,
  purchaseUuid?: string
): Promise<{ success: boolean; statusCode?: number; total?: number; currency?: string; message?: string }> => {
  console.log('📊 [Purchase] Fetching purchase status');

  try {
    const params = new URLSearchParams();
    if (purchaseUuid) params.set('purchaseUuid', purchaseUuid);

    const url = `${API_BASE_URL}/purchase/${encodeURIComponent(purchaseId)}/status${
      params.toString() ? `?${params.toString()}` : ''
    }`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        ...getAgentHeaders(),
        'X-Request-ID': `purchase_status_${Date.now()}`,
      },
      credentials: 'include',
    });

    let data: any = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok) {
      return {
        success: false,
        statusCode: response.status,
        message:
          (data && (data.message || data.error?.message)) ||
          `Failed to fetch purchase status: ${response.status}`,
      };
    }

    const rawTotal = data?.purchase?.total;
    const centsTotal = data?.purchase?.totalPrice;
    const total =
      typeof rawTotal === 'number'
        ? rawTotal
        : typeof centsTotal === 'number'
          ? centsTotal / 100
          : undefined;

    return {
      success: true,
      statusCode: response.status,
      total,
      currency: data?.purchase?.currency,
      message: data?.message,
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Failed to fetch purchase status',
    };
  }
};

export const getTicket = async (cartId: string, ticketId: string) => {
  console.log('🎫 [Ticket] Getting ticket details');
  console.log('🔗 [Ticket] API URL:', `${API_BASE_URL}/ticket/cart/${cartId}/${ticketId}`);
  console.log('📋 [Ticket] Method: GET');

  try {
    console.log('📤 [Ticket] Sending ticket request...');
    const response = await fetch(`${API_BASE_URL}/ticket/cart/${cartId}/${ticketId}`, { headers: { ...getAgentHeaders() }, credentials: 'include' });
    console.log('🌐 [Ticket] Response status:', response.status);

    const data = await response.json();
    console.log('📥 [Ticket] Ticket response:', data);

    if (!response.ok) {
      console.error('❌ [Ticket] API error:', data);
      throw new Error(data.message || `HTTP error! status: ${response.status}`);
    }

    return data;
  } catch (error) {
    console.error('❌ [Ticket] Failed to get ticket:', error);
    throw error;
  }
};

export const getTicketsByCart = async (cartId: string) => {
  console.log('🎫 [Tickets] Getting all tickets for cart');
  console.log('🔗 [Tickets] API URL:', `${API_BASE_URL}/ticket/cart/${cartId}`);
  console.log('📋 [Tickets] Method: GET');

  try {
    console.log('📤 [Tickets] Sending tickets request...');
    const response = await fetch(`${API_BASE_URL}/ticket/cart/${cartId}`, { headers: { ...getAgentHeaders() }, credentials: 'include' });
    console.log('🌐 [Tickets] Response status:', response.status);

    const data = await response.json();
    console.log('📥 [Tickets] Tickets response:', data);

    if (!response.ok) {
      console.error('❌ [Tickets] API error:', data);
      throw new Error(data.message || `HTTP error! status: ${response.status}`);
    }

    return data;
  } catch (error) {
    console.error('❌ [Tickets] Failed to get tickets:', error);
    throw error;
  }
};

// Fetch hold / cart tickets using PNR (Firestore cart ID). This reuses the cart endpoint
// since the backend treats PNR as the cart identifier for hold tickets.
export const getHoldTicketsByPnr = async (pnr: string) => {
  console.log('🎫 [Tickets] Getting hold tickets by PNR');
  console.log('🔗 [Tickets] API URL:', `${API_BASE_URL}/ticket/cart/${pnr}`);
  console.log('📋 [Tickets] Method: GET');

  try {
    console.log('📤 [Tickets] Sending hold tickets request...');
    const response = await fetch(`${API_BASE_URL}/ticket/cart/${pnr}`, { headers: { ...getAgentHeaders() }, credentials: 'include' });
    console.log('🌐 [Tickets] Response status:', response.status);

    const data = await response.json();
    console.log('📥 [Tickets] Hold tickets response:', data);

    if (!response.ok) {
      console.error('❌ [Tickets] API error:', data);
      throw new Error(data.message || `HTTP error! status: ${response.status}`);
    }

    return data;
  } catch (error) {
    console.error('❌ [Tickets] Failed to get hold tickets:', error);
    throw error;
  }
};

export const checkApiHealth = async (): Promise<ApiHealthResult> => {
  console.log('🏥 [Health] Checking middleware connectivity...');
  console.log('🔗 [Health] API URL:', `${API_BASE_URL}/health`);
  console.log('📋 [Health] Method: GET');

  try {
    console.log('📤 [Health] Sending health check request...');
    const res = await fetch(`${API_BASE_URL}/health`, { headers: { ...getAgentHeaders() }, credentials: 'include' });
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

// ---------------------
// Email Notification
// ---------------------
export const sendEmailNotification = async (pnr: string): Promise<{ success: boolean; message?: string }> => {
  console.log('📧 [Email] Sending email notification request');
  console.log('📋 [Email] PNR:', pnr);
  console.log('🔗 [Email] API URL:', `${API_BASE_URL}/ticket/hold`);
  console.log('📋 [Email] Method: POST');

  try {
    console.log('📤 [Email] Sending email notification request...');
    const response = await fetch(`${API_BASE_URL}/ticket/hold`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Request-ID': `email_notification_${Date.now()}`,
        ...getAgentHeaders(),
      },
      credentials: 'include',
      body: JSON.stringify({ pnr })
    });

    console.log('🌐 [Email] Response status:', response.status);
    console.log('🌐 [Email] Response headers:', Object.fromEntries(response.headers.entries()));

    const data = await response.json();
    console.log('📥 [Email] Email notification response:', data);

    if (!response.ok) {
      console.error('❌ [Email] Email notification failed:', data.message || `Server error: ${response.status}`);
      return {
        success: false,
        message: data.message || `Email notification failed: ${response.status}`
      };
    }

    console.log('✅ [Email] Email notification sent successfully');
    return {
      success: true,
      message: data.message || 'Email notification sent successfully'
    };
  } catch (error) {
    console.error('❌ [Email] Email notification request failed:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Failed to send email notification. Please try again.'
    };
  }
};
