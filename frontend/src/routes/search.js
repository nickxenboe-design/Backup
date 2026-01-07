import express from 'express';
import BusbudService from '../services/busbud.service.mjs';
import logger from '../utils/logger.js';
import { success, error } from '../utils/response.js';
import { query as pgQuery } from '../config/postgres.js';

const router = express.Router();

console.log('✅ Search route loaded');

router.get('/locations', async (req, res) => {
  const { query: queryParam = '', q, limit } = req.query;

  try {
    const rawQuery = (queryParam || q || '').toString();
    const searchTerm = rawQuery.trim().toLowerCase();
    const numericLimitRaw = parseInt(limit, 10);
    const numericLimit = Number.isFinite(numericLimitRaw)
      ? Math.min(Math.max(numericLimitRaw, 1), 50)
      : 20;

    let rows;

    if (!searchTerm) {
      // No query: return a default set of cities ordered by name
      const text = `
        SELECT id, country_code2, city_name, city_geohash, city_lat, city_lon
        FROM public.cities
        ORDER BY city_name ASC
        LIMIT $1
      `;
      const result = await pgQuery(text, [numericLimit]);
      rows = result.rows || [];
    } else {
      // Search by city name and country code
      const text = `
        SELECT id, country_code2, city_name, city_geohash, city_lat, city_lon
        FROM public.cities
        WHERE LOWER(city_name) LIKE $1
           OR LOWER(country_code2) LIKE $1
        ORDER BY city_name ASC
        LIMIT $2
      `;

      const likeValue = `%${searchTerm}%`;
      const result = await pgQuery(text, [likeValue, numericLimit]);
      rows = result.rows || [];
    }

    const normalized = rows.map((row) => ({
      id: row.id ?? row.city_id ?? null,
      name: row.city_name || '',
      city: row.city_name || '',
      region: '',
      country: row.country_code2 || '',
      latitude: row.city_lat != null ? Number(row.city_lat) : null,
      longitude: row.city_lon != null ? Number(row.city_lon) : null,
      geohash: row.city_geohash || null
    }));

    return success(res, {
      data: normalized,
      message: 'Locations fetched successfully'
    });
  } catch (err) {
    logger.error('Locations search error', {
      message: err.message,
      stack: err.stack
    });
    return error(res, err, 500);
  }
});

// ----------------------------
// 🔍 GET /api/search
// ----------------------------
router.get('/', async (req, res) => {
  const requestId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const startTime = Date.now();
  const { origin, destination, date, returnDate, adults, children, seniors, currency, language, age } = req.query;

  logger.info(`🔍 [${requestId}] Incoming search request`, {
    origin,
    destination,
    date,
    returnDate,
    query: req.query,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });

  // Define options with default values
  const options = {
    adults: parseInt(adults || '1'),
    children: parseInt(children || '0'),
    seniors: parseInt(seniors || '0'),
    currency: currency || 'USD',
    language: language || 'en',
    returnDate: returnDate || undefined
  };

  // --- Validation ---
  const missingParams = [];
  if (!origin) missingParams.push('origin');
  if (!destination) missingParams.push('destination');
  if (!date) missingParams.push('date');

  if (missingParams.length > 0) {
    const errorMessage = `Missing required parameters: ${missingParams.join(', ')}`;
    logger.warn(`⚠️ [${requestId}] ${errorMessage}`, { 
      missingParams,
      providedParams: { origin, destination, date }
    });
    return error(res, new Error(errorMessage), 400);
  }

  // When there are children, require ages in the query
  if (options.children > 0) {
    if (!age) {
      const msg = `age query parameter is required when children > 0 (expected ${options.children} ages; comma-separated if multiple)`;
      logger.warn(`⚠️ [${requestId}] ${msg}`, {
        children: options.children,
        query: req.query
      });
      return error(res, new Error(msg), 400);
    }

    let rawValues = [];

    if (Array.isArray(age)) {
      rawValues = age.flatMap(value => String(value).split(','));
    } else {
      rawValues = String(age).split(',');
    }

    const parsedAges = rawValues
      .map(value => parseInt(value.trim(), 10))
      .filter(value => !Number.isNaN(value));

    if (parsedAges.length !== options.children) {
      const msg = `age must contain exactly one age per child (expected ${options.children}, got ${parsedAges.length})`;
      logger.warn(`⚠️ [${requestId}] ${msg}`, {
        children: options.children,
        age,
        parsedAges
      });
      return error(res, new Error(msg), 400);
    }

    const invalidAge = parsedAges.find(age => age < 0 || !Number.isFinite(age));
    if (invalidAge !== undefined) {
      const msg = `age must be non-negative integers. Invalid age: ${invalidAge}`;
      logger.warn(`⚠️ [${requestId}] ${msg}`, {
        children: options.children,
        age,
        parsedAges
      });
      return error(res, new Error(msg), 400);
    }

    options.childrenAges = parsedAges;
    logger.info(`👶 [${requestId}] Parsed children ages for search`, {
      children: options.children,
      ages: parsedAges
    });
  }

  try {

    logger.info(`📋 [${requestId}] Parsed options:`, options);
    logger.info(`🚀 [${requestId}] Calling BusbudService.search...`);

    // Timeout promise for safety (increased to 120 seconds to accommodate slow Busbud polls)
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Search request timed out after 120 seconds`)), 120000)
    );

    // Run search
    const results = await Promise.race([
      BusbudService.search(origin, destination, date, options),
      timeoutPromise
    ]);

    const responseTime = Date.now() - startTime;
    logger.info(`✅ [${requestId}] Search completed successfully in ${responseTime}ms`);

    // Log the formatted response for debugging
    console.log(`📄 [${requestId}] Complete response data:`);
    console.log(JSON.stringify(results, null, 2));

    // Log original prices for verification
    logger.info('🔍 Original prices from API:', {
      sampleTrip: results.trips?.[0] ? {
        id: results.trips[0].id,
        price: results.trips[0].price,
        departure: results.trips[0].departure_time
      } : 'No trips found',
      tripCount: results.trips?.length || 0
    });

    // Send search results directly; pricing has already been adjusted by BusbudService._transformSearchResults
    res.set('Content-Type', 'application/json');
    return res.send(JSON.stringify(results, null, 2));
  } catch (err) {
    const responseTime = Date.now() - startTime;
    logger.error(`❌ [${requestId}] Search error:`, { 
      error: err.message,
      stack: err.stack,
      searchParams: { origin, destination, date, ...options },
      duration: Date.now() - startTime
    });
    error(res, err, 500);
  }
});

// ----------------------------
// 🚌 POST /api/search/results
// ----------------------------
router.post('/results', async (req, res) => {
  const requestId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const { trips, metadata, searchInfo } = req.body;

  logger.info(`📦 [${requestId}] Trip results received`, { tripsCount: trips?.length || 0 });

  if (!trips || !Array.isArray(trips) || trips.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Invalid or missing trip data',
      requestId
    });
  }

  try {
    logger.info(`[${requestId}] Processed ${trips.length} trip results`);

    return success(res, {
      data: {
        search: {
          origin: searchInfo.origin,
          destination: searchInfo.destination,
          date: searchInfo.date,
          adults: searchInfo.adults,
          children: searchInfo.children,
          seniors: searchInfo.seniors,
          currency: searchInfo.currency,
          language: searchInfo.language
        },
        results: trips,
        metadata: {
          totalResults: trips.length,
          searchTime: Date.now() - requestId,
          ...(metadata || {})
        }
      },
      message: 'Search completed successfully',
      requestId
    });
  } catch (error) {
    logger.error(`❌ [${requestId}] Error saving trips:`, { message: error.message, stack: error.stack });
    return error(res, error, 500);
  }
});

export default router;
