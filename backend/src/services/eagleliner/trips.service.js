import { createEaglelinerClient } from './eaglelinerClient.js';
import { listStops } from './stops.service.js';

function asNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeCity(value) {
  const s = String(value || '').trim().toLowerCase();
  if (!s) return '';
  const idx = s.indexOf('(');
  return (idx >= 0 ? s.slice(0, idx) : s).trim();
}

function stopMatchesCity(stop, cityQuery) {
  const q = normalizeCity(cityQuery);
  if (!q) return false;
  const city = normalizeCity(stop && stop.city);
  return city === q || city.includes(q) || q.includes(city);
}

function extractTripsList(response) {
  const trips = response && response.AvailableTrips && response.AvailableTrips.Trip1;
  return Array.isArray(trips) ? trips : [];
}

function getDefaultOperatorId() {
  return asNumber(process.env.EAGLE_OPERATOR_ID, 2);
}

export async function searchTripsByCities({
  username,
  password,
  fromCity,
  toCity,
  departureDate,
  passengers,
  operatorFilterId,
} = {}) {
  const fromQ = normalizeCity(fromCity);
  const toQ = normalizeCity(toCity);

  if (!fromQ || !toQ) {
    const err = new Error('origin and destination are required');
    err.statusCode = 400;
    throw err;
  }

  if (fromQ === toQ) {
    const err = new Error('origin and destination must be different');
    err.statusCode = 400;
    throw err;
  }

  if (!departureDate) {
    const err = new Error('date is required');
    err.statusCode = 400;
    throw err;
  }

  const pax = Math.max(1, asNumber(passengers, 1));
  const opFilter = operatorFilterId == null ? getDefaultOperatorId() : asNumber(operatorFilterId, getDefaultOperatorId());

  const stops = await listStops({ username, password });

  const fromStops = stops.filter((s) => stopMatchesCity(s, fromQ));
  const toStops = stops.filter((s) => stopMatchesCity(s, toQ));

  if (fromStops.length === 0) {
    const err = new Error(`No stops found for origin: ${fromCity}`);
    err.statusCode = 400;
    throw err;
  }

  if (toStops.length === 0) {
    const err = new Error(`No stops found for destination: ${toCity}`);
    err.statusCode = 400;
    throw err;
  }

  const maxPairs = asNumber(process.env.EAGLE_MAX_STOP_PAIRS, 25);
  const pairsCount = fromStops.length * toStops.length;

  if (maxPairs > 0 && pairsCount > maxPairs) {
    const err = new Error(
      `Too many stop combinations to search (${pairsCount}). Please be more specific (e.g., "Harare" instead of "H").`
    );
    err.statusCode = 400;
    throw err;
  }

  const client = createEaglelinerClient();
  const tripsByKey = new Map();

  for (const from of fromStops) {
    for (const to of toStops) {
      if (String(from.id) === String(to.id)) continue;

      const result = await client.request({
        method: 'POST',
        path: '/api/v2/trips/find',
        username,
        password,
        data: {
          TripDetails: {
            Trip1: {
              DepartureStopID: asNumber(from.id, 0),
              DestinationStopID: asNumber(to.id, 0),
              DepartureDate: String(departureDate),
              Passengers: pax,
              OperatorFilterID: opFilter,
            },
          },
        },
      });

      const trips = extractTripsList(result);
      for (const t of trips) {
        const key = `${t?.TripID || ''}|${t?.DepartureTime || ''}|${t?.DepartureStopID || ''}|${t?.DestinationStopID || ''}`;
        if (!tripsByKey.has(key)) {
          tripsByKey.set(key, t);
        }
      }
    }
  }

  const aggregated = Array.from(tripsByKey.values());
  aggregated.sort((a, b) => String(a?.DepartureTime || '').localeCompare(String(b?.DepartureTime || '')));
  return aggregated;
}
