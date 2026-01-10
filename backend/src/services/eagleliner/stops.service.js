import { createEaglelinerClient } from './eaglelinerClient.js';

let cachedStops = null;
let cachedAtMs = 0;

function getStopsCacheTtlMs() {
  const ttl = Number(process.env.EAGLE_STOPS_CACHE_TTL_MS);
  return Number.isFinite(ttl) ? ttl : 60 * 60 * 1000;
}

export async function listStops({ username, password, forceRefresh = false } = {}) {
  const ttlMs = getStopsCacheTtlMs();

  if (!forceRefresh && cachedStops && Date.now() - cachedAtMs < ttlMs) {
    return cachedStops;
  }

  const client = createEaglelinerClient();
  const response = await client.request({
    method: 'GET',
    path: '/api/v2/stops/list',
    username,
    password,
  });

  const stops = Array.isArray(response && response.Stops) ? response.Stops : [];
  cachedStops = stops;
  cachedAtMs = Date.now();
  return stops;
}
