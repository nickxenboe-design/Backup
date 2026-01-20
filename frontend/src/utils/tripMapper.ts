// src/utils/tripMapper.ts
import { BusRoute } from "@/types";



function formatTimestamp(timestamp?: string): string {
  if (!timestamp) return "N/A";

  // Handle time strings like "14:30" or "2:30 PM"
  if (typeof timestamp === 'string' && timestamp.includes(':')) {
    try {
      // If it's already a full datetime string, use as-is
      if (timestamp.includes('T') || timestamp.includes(' ')) {
        const date = new Date(timestamp);
        if (!isNaN(date.getTime())) {
          return formatTimeOnly(date);
        }
      }

      // Handle time-only strings like "14:30"
      const timeParts = timestamp.split(':');
      if (timeParts.length >= 2) {
        const hours = parseInt(timeParts[0], 10);
        const minutes = parseInt(timeParts[1], 10);
        if (!isNaN(hours) && !isNaN(minutes)) {
          return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
        }
      }
    } catch (e) {
      console.warn('⚠️ [formatTimestamp] Failed to parse time string:', timestamp, e);
    }
    return "N/A";
  }

  // Handle Unix timestamps (seconds or milliseconds)
  if (typeof timestamp === 'string' || typeof timestamp === 'number') {
    try {
      const numTimestamp = Number(timestamp);
      if (!isNaN(numTimestamp)) {
        const date = numTimestamp > 1e12 ? new Date(numTimestamp) : new Date(numTimestamp * 1000);
        if (!isNaN(date.getTime())) {
          return formatTimeOnly(date);
        }
      }
    } catch (e) {
      console.warn('⚠️ [formatTimestamp] Failed to parse timestamp:', timestamp, e);
    }
  }

  return "N/A";
}

function formatTimeOnly(date: Date): string {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

function formatDuration(start?: string, end?: string): string {
  if (!start || !end) return "N/A";

  // If we have time strings like "14:30", we can't calculate duration from time-only
  // In this case, return a placeholder or try to get duration from trip data
  if (typeof start === 'string' && start.includes(':') && !start.includes('T') && !start.includes(' ')) {
    // This is a time-only string, we can't calculate duration without date context
    return "N/A";
  }

  try {
    const startDate = new Date(start);
    const endDate = new Date(end);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return "Invalid Date";

    // Duration in milliseconds
    const diffMs = endDate.getTime() - startDate.getTime();
    if (diffMs < 0) return "N/A";

    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

    return `${hours}h ${minutes}m`;
  } catch (e) {
    console.warn('⚠️ [formatDuration] Failed to calculate duration:', start, end, e);
    return "N/A";
  }
}



export function mapTripResponse(rawTrip: any): BusRoute {
  if (!rawTrip || !rawTrip.segments?.length) {
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
    };
  }

  const firstSegment = rawTrip.segments[0];
  const lastSegment = rawTrip.segments[rawTrip.segments.length - 1];

  // Try multiple possible timestamp paths
  let departureTimestamp: string | undefined;
  let arrivalTimestamp: string | undefined;

  // Path 1: Expected format (departure_time.timestamp)
  if (firstSegment.departure_time?.timestamp) {
    departureTimestamp = firstSegment.departure_time.timestamp;
  }
  if (lastSegment.arrival_time?.timestamp) {
    arrivalTimestamp = lastSegment.arrival_time.timestamp;
  }

  // Path 2: Direct timestamp on segment
  if (!departureTimestamp && firstSegment.departure_timestamp) {
    departureTimestamp = firstSegment.departure_timestamp;
  }
  if (!arrivalTimestamp && lastSegment.arrival_timestamp) {
    arrivalTimestamp = lastSegment.arrival_timestamp;
  }

  // Path 3: Time strings (e.g., "14:30")
  if (!departureTimestamp && firstSegment.departure_time) {
    departureTimestamp = firstSegment.departure_time;
  }
  if (!arrivalTimestamp && lastSegment.arrival_time) {
    arrivalTimestamp = lastSegment.arrival_time;
  }

  const departureTime = formatTimestamp(departureTimestamp);
  const arrivalTime = formatTimestamp(arrivalTimestamp);
  const duration = formatDuration(departureTimestamp, arrivalTimestamp);

  const operator =
    rawTrip.operator?.name ||
    rawTrip.carrier?.name ||
    firstSegment.operator?.name ||
    "Unknown Operator";

  // Price mapping: prefer nested rawTrip.prices[0].prices totals (in minor units),
  // then rawTrip.prices[0].breakdown totals, and only fall back to rawTrip.price.amount
  let price = 0;
  let currency = "USD";

  if (rawTrip?.prices?.[0]?.prices) {
    const p = rawTrip.prices[0].prices;
    if (p.total != null) {
      const rawTotal = Number(p.total);
      if (!Number.isNaN(rawTotal)) {
        // Nested totals are often in minor units (e.g. cents); convert to standard currency units
        price = rawTotal / 100;
      }
    }
    currency = p.currency || currency;
    // Some APIs put numeric totals under breakdown
    if (!price && p.breakdown && p.breakdown.total != null) {
      const rawBreakdownTotal = Number(p.breakdown.total);
      if (!Number.isNaN(rawBreakdownTotal)) {
        price = rawBreakdownTotal / 100;
      }
    }
  } else if (rawTrip?.prices?.[0]?.breakdown) {
    const b = rawTrip.prices[0].breakdown;
    if (b.total != null) {
      const rawBTotal = Number(b.total);
      if (!Number.isNaN(rawBTotal)) {
        price = rawBTotal / 100;
      }
    }
    // currency may live at the parent prices level; keep default if absent
  } else if (rawTrip?.price && (rawTrip.price.amount != null)) {
    price = Number(rawTrip.price.amount);
    currency = rawTrip.price.currency || currency;
  }

  let result: BusRoute = {
    id: rawTrip.id || "unknown",
    tripId: rawTrip.id || "unknown",
    journey_id: rawTrip.journey_id || "unknown",
    origin: firstSegment.origin?.name || "Unknown Origin",
    destination: lastSegment.destination?.name || "Unknown Destination",
    departureTime,
    arrivalTime,
    duration,
    operator,
    busCompany: operator,
    amenities: firstSegment.vehicle?.amenities || [],
    className: firstSegment.class?.name || "N/A",
    price,
    currency,
    deeplink: rawTrip.deeplinks?.[0]?.deeplink?.url || "#",
    segments: rawTrip.segments || [],
    prices: rawTrip.prices || [],
  };

  try {
    const rawLegs = (rawTrip as any)?.legs;
    if (Array.isArray(rawLegs) && rawLegs.length >= 2) {
      const extractLegPrice = (leg: any) => {
        try {
          if (!leg || typeof leg !== 'object') return { amount: 0, currency: null };

          const p0 = Array.isArray(leg.prices) && leg.prices.length > 0 ? leg.prices[0] : null;
          const p0Prices = p0 && p0.prices ? p0.prices : null;
          const p0Breakdown = p0 && p0.breakdown ? p0.breakdown : null;

          const currency =
            (p0Prices && p0Prices.currency) ||
            (leg.price && leg.price.currency) ||
            (leg.pricing && leg.pricing.currency) ||
            null;

          const totalCandidate =
            (p0Prices && p0Prices.total != null ? p0Prices.total : null) ??
            (p0Prices && p0Prices.breakdown && p0Prices.breakdown.total != null ? p0Prices.breakdown.total : null) ??
            (p0Breakdown && p0Breakdown.total != null ? p0Breakdown.total : null) ??
            (leg.price && leg.price.amount != null ? leg.price.amount : null) ??
            (leg.pricing && leg.pricing.amount != null ? leg.pricing.amount : null) ??
            null;

          if (totalCandidate == null) return { amount: 0, currency };

          const n = Number(totalCandidate);
          if (!Number.isFinite(n) || n <= 0) return { amount: 0, currency };

          // Busbud nested totals are commonly in minor units.
          const amount = (p0Prices && p0Prices.total != null) || (p0Prices && p0Prices.breakdown && p0Prices.breakdown.total != null) || (p0Breakdown && p0Breakdown.total != null)
            ? (n / 100)
            : n;

          return { amount, currency };
        } catch (e) {
          return { amount: 0, currency: null };
        }
      };

      const mappedLegs = rawLegs.map((leg: any) => {
        const lFirst = Array.isArray(leg.segments) && leg.segments.length > 0 ? leg.segments[0] : leg;
        const lLast = Array.isArray(leg.segments) && leg.segments.length > 0 ? leg.segments[leg.segments.length - 1] : leg;

        const legDepTs = lFirst?.departure_time?.timestamp || lFirst?.departure_time || lFirst?.departure_timestamp || leg?.departure_time?.timestamp || leg?.departure_time;
        const legArrTs = lLast?.arrival_time?.timestamp || lLast?.arrival_time || lLast?.arrival_timestamp || leg?.arrival_time?.timestamp || leg?.arrival_time;

        const priceMeta = extractLegPrice(leg);

        return {
          origin: lFirst?.origin?.name || leg?.origin?.name || "Unknown Origin",
          destination: lLast?.destination?.name || leg?.destination?.name || "Unknown Destination",
          departureTime: formatTimestamp(legDepTs),
          arrivalTime: formatTimestamp(legArrTs),
          duration: formatDuration(legDepTs, legArrTs),
          operator: lFirst?.operator?.name || leg?.operator?.name || operator,
          price: priceMeta.amount,
          currency: priceMeta.currency
        };
      });

      if (mappedLegs.length >= 2) {
        const sumLegPrices = mappedLegs.reduce((acc: number, l: any) => {
          const v = Number(l && l.price != null ? l.price : 0);
          if (!Number.isFinite(v)) return acc;
          return acc + v;
        }, 0);
        const totalPrice = Number((result as any).price || 0);

        const scaledLegs = (() => {
          if (sumLegPrices > 0 && totalPrice > 0) {
            const ratio = totalPrice / sumLegPrices;
            return mappedLegs.map((l: any) => {
              const v = Number(l && l.price != null ? l.price : 0);
              const scaled = Number.isFinite(v) ? (v * ratio) : 0;
              const rounded = Math.round(scaled * 100) / 100;
              return { ...l, price: rounded, currency: result.currency || l.currency || currency };
            });
          }
          return mappedLegs.map((l: any) => ({ ...l, currency: result.currency || l.currency || currency }));
        })();

        result = {
          ...result,
          origin: scaledLegs[0].origin,
          destination: scaledLegs[0].destination,
          departureTime: scaledLegs[0].departureTime,
          arrivalTime: scaledLegs[0].arrivalTime,
          duration: scaledLegs[0].duration,
          legs: scaledLegs
        } as BusRoute;
      } else {
        (result as any).legs = mappedLegs;
      }
    } else if (Array.isArray((rawTrip as any)?.trip_legs) && (rawTrip as any)?.trip_legs.length >= 2 && Array.isArray((rawTrip as any)?.segments)) {
      const tripLegs = (rawTrip as any).trip_legs;
      const segs = (rawTrip as any).segments;
      const segById = new Map<string, any>(segs.map((s: any) => [s.id, s]));

      const mappedLegs = tripLegs.map((leg: any) => {
        const ids: string[] = Array.isArray(leg.segment_ids) ? leg.segment_ids : [];
        const legSegs: any[] = ids.map((id) => segById.get(id)).filter(Boolean);
        const lFirst = legSegs[0] || segs[0];
        const lLast = legSegs[legSegs.length - 1] || segs[segs.length - 1];

        const legDepTs = lFirst?.departure_time?.timestamp || lFirst?.departure_time || lFirst?.departure_timestamp || leg?.departure_time?.timestamp || leg?.departure_time;
        const legArrTs = lLast?.arrival_time?.timestamp || lLast?.arrival_time || lLast?.arrival_timestamp || leg?.arrival_time?.timestamp || leg?.arrival_time;

        let priceAmount = 0;
        try {
          const candidate = leg && leg.pricing ? (leg.pricing.amount ?? leg.pricing.total) : null;
          if (candidate != null) {
            const n = Number(candidate);
            if (Number.isFinite(n) && n > 0) priceAmount = n;
          }
        } catch {}

        return {
          origin: lFirst?.origin?.name || "Unknown Origin",
          destination: lLast?.destination?.name || "Unknown Destination",
          departureTime: formatTimestamp(legDepTs),
          arrivalTime: formatTimestamp(legArrTs),
          duration: formatDuration(legDepTs, legArrTs),
          operator: lFirst?.operator?.name || operator,
          price: priceAmount,
          currency: currency
        };
      });

      if (mappedLegs.length >= 2) {
        const sumLegPrices = mappedLegs.reduce((acc: number, l: any) => {
          const v = Number(l && l.price != null ? l.price : 0);
          if (!Number.isFinite(v)) return acc;
          return acc + v;
        }, 0);
        const totalPrice = Number((result as any).price || 0);
        const scaledLegs = (() => {
          if (sumLegPrices > 0 && totalPrice > 0) {
            const ratio = totalPrice / sumLegPrices;
            return mappedLegs.map((l: any) => {
              const v = Number(l && l.price != null ? l.price : 0);
              const scaled = Number.isFinite(v) ? (v * ratio) : 0;
              const rounded = Math.round(scaled * 100) / 100;
              return { ...l, price: rounded, currency: result.currency || l.currency || currency };
            });
          }
          return mappedLegs.map((l: any) => ({ ...l, currency: result.currency || l.currency || currency }));
        })();

        result = {
          ...result,
          origin: scaledLegs[0].origin,
          destination: scaledLegs[0].destination,
          departureTime: scaledLegs[0].departureTime,
          arrivalTime: scaledLegs[0].arrivalTime,
          duration: scaledLegs[0].duration,
          legs: scaledLegs
        } as BusRoute;
      } else {
        (result as any).legs = mappedLegs;
      }
    }
  } catch {}

  return result;
}
