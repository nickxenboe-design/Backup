// utils/busbudPoll.ts
import axios from "axios";

export interface Segment {
  id: string;
  origin: any;
  destination: any;
  departure_time: string;
  arrival_time: string;
  operator: any;
  fare: any;
  class: any;
  vehicle: any;
  amenities: any[];
}

export interface BusRoute {
  id: string;
  tripId: string;
  origin: any;
  destination: any;
  departureTime: string;
  arrivalTime: string;
  duration: string;
  operator: any;
  busCompany: string;
  amenities: any[];
  className: string;
  price: number;
  currency: string;
  segments: Segment[];
}

// Poll a single leg until it becomes sellable or timeout
async function pollLeg(
  searchId: string,
  legNumber: number,
  interval: number = 1000,
  timeout: number = 15000
) {
  const startTime = Date.now();

  while (true) {
    const { data } = await axios.get(`/searches/${searchId}/legs/${legNumber}/poll`);

    if (data.sellable) return data;
    
    if (Date.now() - startTime > timeout) {
      // Stop polling after timeout
      return data;
    }

    await new Promise((res) => setTimeout(res, interval));
  }
}

// Poll all legs and assemble full trips
export async function fetchCompleteTrips(searchId: string, tripLegs: any[]): Promise<BusRoute[]> {
  const fullTrips: BusRoute[] = [];

  for (const trip of tripLegs) {
    const legResults = await Promise.all(
      trip.segment_ids.map((_, i) => pollLeg(searchId, i + 1))
    );

    // Map segments and prices
    const segments: Segment[] = legResults.flatMap((leg) =>
      leg.segments.map((seg: any) => ({
        id: seg.id,
        origin: seg.origin,
        destination: seg.destination,
        departure_time: seg.departure_time.timestamp,
        arrival_time: seg.arrival_time.timestamp,
        operator: seg.operator,
        fare: seg.fare,
        class: seg.class,
        vehicle: seg.vehicle,
        amenities: seg.vehicle?.amenities || [],
      }))
    );

    // Assemble final BusRoute
    fullTrips.push({
      id: trip.id,
      tripId: trip.id,
      origin: segments[0]?.origin || null,
      destination: segments[segments.length - 1]?.destination || null,
      departureTime: segments[0]?.departure_time || "N/A",
      arrivalTime: segments[segments.length - 1]?.arrival_time || "N/A",
      duration: trip.schedule?.duration || "N/A",
      operator: segments[0]?.operator || null,
      busCompany: segments[0]?.operator?.name || "Unknown",
      amenities: segments.flatMap((s) => s.amenities),
      className: segments[0]?.class?.name || "Unknown",
      price: trip.pricing?.amount || 0,
      currency: trip.pricing?.currency || "USD",
      segments,
    });
  }

  return fullTrips;
}
