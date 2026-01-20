function toIsoTimestamp(value) {
  const s = String(value || '').trim();
  if (!s) return undefined;
  if (s.includes('T')) return s;
  if (s.includes(' ')) return s.replace(' ', 'T');
  return s;
}

function asNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function findAdultFare(fairPrice) {
  const list = Array.isArray(fairPrice) ? fairPrice : [];
  const adult = list.find((p) => String(p?.name || '').toLowerCase().includes('adult'));
  return adult || list[0] || null;
}

function findFareByToken(fairPrice, tokens) {
  const list = Array.isArray(fairPrice) ? fairPrice : [];
  const match = list.find((p) => tokens.some((t) => String(p?.name || '').toLowerCase().includes(t)));
  return match || null;
}

function computeTotalFromPassengerCounts(fairPrice, passengerCounts) {
  const counts = passengerCounts && typeof passengerCounts === 'object' ? passengerCounts : null;
  if (!counts) return null;

  const adults = Number(counts.adults || 0);
  const children = Number(counts.children || 0);
  const seniors = Number(counts.seniors || 0);
  const students = Number(counts.students || 0);

  if (![adults, children, seniors, students].some((n) => Number.isFinite(n) && n > 0)) {
    return null;
  }

  const adultFare = findFareByToken(fairPrice, ['adult']);
  const childFare = findFareByToken(fairPrice, ['child', 'children', 'youth']);
  const seniorFare = findFareByToken(fairPrice, ['senior']);
  const studentFare = findFareByToken(fairPrice, ['student']);

  const adultUnit = asNumber(adultFare?.price, asNumber(findAdultFare(fairPrice)?.price, 0));
  const childUnit = asNumber(childFare?.price, adultUnit);
  const seniorUnit = asNumber(seniorFare?.price, adultUnit);
  const studentUnit = asNumber(studentFare?.price, childUnit);

  const totalMajor =
    adultUnit * Math.max(0, adults) +
    childUnit * Math.max(0, children) +
    seniorUnit * Math.max(0, seniors) +
    studentUnit * Math.max(0, students);

  return Number.isFinite(totalMajor) ? totalMajor : null;
}

export function normalizeEaglelinerTrip(trip, { currency = 'USD', passengersCount = 1, passengerCounts } = {}) {
  const depIso = toIsoTimestamp(trip?.DepartureTime);
  const arrIso = toIsoTimestamp(trip?.ArrivalTime);

  const operatorName = String(trip?.Operator || 'Eagleliner Coaches');
  const originName = String(trip?.DepartureStopName || trip?.DepartureStopID || 'Unknown Origin');
  const destinationName = String(trip?.DestinationStopName || trip?.DestinationStopID || 'Unknown Destination');

  const pax = Math.max(1, asNumber(passengersCount, 1));
  const computedTotalMajor = computeTotalFromPassengerCounts(trip?.FairPrice, passengerCounts);
  const fare = findAdultFare(trip?.FairPrice);
  const unitPrice = asNumber(fare?.price, 0);
  const totalMajor = computedTotalMajor != null ? computedTotalMajor : unitPrice * pax;
  const totalMinor = Math.round(totalMajor * 100);

  const fairPriceList = Array.isArray(trip?.FairPrice) ? trip.FairPrice : [];
  const reservedSeatsNo = asNumber(trip?.reserved_seats_no, 0);
  const occupiedSeatsNo = asNumber(trip?.occupied_seats_no, 0);
  const availableSeatsNo = asNumber(trip?.available_seats_no, trip?.available_seats?.length);

  const tripId = String(trip?.TripID ?? 'unknown');
  const rawId = `eagleliner:${tripId}:${trip?.DepartureStopID ?? ''}:${trip?.DestinationStopID ?? ''}:${depIso || ''}`;

  return {
    id: rawId,
    journey_id: rawId,
    operator: { name: operatorName },
    segments: [
      {
        id: `${rawId}:seg:0`,
        origin: { name: originName },
        destination: { name: destinationName },
        departure_time: { timestamp: depIso },
        arrival_time: { timestamp: arrIso },
        operator: { name: operatorName },
        vehicle: { amenities: [] },
        class: { name: 'Standard' },
      },
    ],
    prices: [
      {
        prices: {
          total: totalMinor,
          currency,
          breakdown: {
            total: totalMinor,
            passengers: fairPriceList.map((p) => ({
              category: p?.name,
              passengerType: p?.name,
              unit: asNumber(p?.price, 0),
              currency,
            })),
          },
        },
        breakdown: {
          total: totalMinor,
        },
      },
    ],
    price: {
      amount: totalMajor,
      currency,
    },
    availableSeats: availableSeatsNo,
    reservedSeats: reservedSeatsNo,
    occupiedSeats: occupiedSeatsNo,
    provider: 'eagleliner',
    _eagleliner: trip,
  };
}
