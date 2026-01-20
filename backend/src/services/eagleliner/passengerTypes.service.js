import { createEaglelinerClient } from './eaglelinerClient.js';

let cache = {
  value: null,
  expiresAt: 0,
};

function isCacheValid() {
  return Boolean(cache.value) && Date.now() < cache.expiresAt;
}

export async function listPassengerTypes({ username, password, forceRefresh = false } = {}) {
  const useCache = String(process.env.PASSENGER_TYPES_CACHE || 'true').toLowerCase() !== 'false';
  if (!forceRefresh && useCache && isCacheValid()) {
    return cache.value;
  }

  const client = createEaglelinerClient();
  const data = await client.request({
    method: 'GET',
    path: '/api/v2/passenger/list_types',
    username,
    password,
  });

  if (useCache) {
    const ttlMs = Number(process.env.PASSENGER_TYPES_CACHE_TTL_MS || 24 * 60 * 60 * 1000);
    cache = { value: data, expiresAt: Date.now() + ttlMs };
  }

  return data;
}
