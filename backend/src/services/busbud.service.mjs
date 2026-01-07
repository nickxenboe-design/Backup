// @ts-nocheck
import axios from 'axios';
import { logger, firestoreLogger } from '../utils/logger.js';
import config from '../config/index.js';
import cache from '../utils/cache.js';
import { generateCartId, generateId } from '../utils/idGenerator.js';
import { getFirestore } from '../config/firebase.config.mjs';
import priceUtils from '../utils/price.utils.js';
import { getOrCreateFirestoreCartId as ensureFirestoreCartId } from '../utils/firestore.js';
import { query as pgQuery } from '../config/postgres.js';
import db, { tripSelections, cartPassengerDetails } from '../db/drizzleClient.js';
import { upsertCartFromBusbud, upsertCartPurchaserFromBusbud } from '../utils/postgresCarts.js';

// Simple function to log API responses
const logApiResponse = (endpoint, data) => {
  console.log(`[API Response] ${endpoint}:`, JSON.stringify(data, null, 2));
  return data;
};

class BusbudService {
  constructor() {
    this.baseUrl = config.busbud.baseUrl;
    this.headers = {
      'X-Busbud-Token': config.busbud.apiKey,
      'Accept': `application/vnd.busbud+json; version=${config.busbud.apiVersion}; profile=${config.busbud.profile}`,
      'User-Agent': 'uniglade/1.0'
    };
    this.db = null; // Will hold the Firestore instance
    
    // Initialize instance variables to store IDs
    this.cartId = null;
    this.tripId = null;
    this.bookingId = null;
    this.firestoreCartId = null; // Will be set in initialize()
    this.requestCounter = 0;
    this.agentCtx = null;

    // In-memory cache
    this.cache = new Map();
    this.cacheTimestamps = new Map();

    // Initialize the service
    this.initialize().catch(error => {
      logger.error('Failed to initialize BusbudService:', error);
      throw error;
    });

    // Create axios instance with interceptors
    this.axios = axios.create();

    // Request interceptor
    this.axios.interceptors.request.use(
      config => {
        const requestId = `req_${this.requestCounter++}`;
        const timestamp = new Date().toISOString();
        config.metadata = { requestId, startTime: Date.now(), timestamp };
        
        // Log complete request details
        const logEntry = {
          timestamp,
          type: 'REQUEST',
          requestId,
          method: config.method.toUpperCase(),
          url: config.url,
          params: config.params || {},
          data: config.data || {},
          headers: (() => {
            const { 'X-Busbud-Token': token, ...safeHeaders } = config.headers || {};
            return {
              ...safeHeaders,
              'X-Busbud-Token': token ? '***REDACTED***' : 'Not set'
            };
          })()
        };
        
        console.log('\n' + '='.repeat(80));
        console.log('🚀 BUSBUD API REQUEST');
        console.log('='.repeat(80));
        console.log(JSON.stringify(logEntry, null, 2));
        console.log('='.repeat(80) + '\n');
        
        // Also log to file via winston
        logger.http(`Busbud API Request`, logEntry);
        
        return config;
      },
      error => {
        const errorLog = {
          timestamp: new Date().toISOString(),
          type: 'REQUEST_ERROR',
          message: error.message,
          stack: error.stack,
          config: error.config ? {
            url: error.config.url,
            method: error.config.method,
            data: error.config.data,
            headers: (() => {
              if (!error.config.headers) return {};
              const { 'X-Busbud-Token': token, ...safeHeaders } = error.config.headers;
              return {
                ...safeHeaders,
                'X-Busbud-Token': token ? '***REDACTED***' : 'Not set'
              };
            })()
          } : null
        };
        
        console.error('\n' + '❌'.repeat(20));
        console.error('BUSBUD API REQUEST ERROR');
        console.error('❌'.repeat(20));
        console.error(JSON.stringify(errorLog, null, 2));
        console.error('❌'.repeat(20) + '\n');
        
        logger.error(`Busbud API Request Error`, errorLog);
        return Promise.reject(error);
      }
    );

    // Response interceptor
    this.axios.interceptors.response.use(
      response => {
        const { config, status, statusText, headers, data } = response;
        const { requestId, startTime, timestamp } = config.metadata || {};
        const duration = startTime ? Date.now() - startTime : 'unknown';
        
        // Log complete response details
        const logEntry = {
          timestamp: timestamp || new Date().toISOString(),
          type: 'RESPONSE',
          requestId,
          durationMs: duration,
          status,
          statusText,
          url: config.url,
          method: config.method.toUpperCase(),
          headers: headers || {},
          data: data || {}
        };
        
        console.log('\n' + '✅'.repeat(20));
        console.log(`BUSBUD API RESPONSE (${status} ${statusText})`);
        console.log('✅'.repeat(20));
        console.log(JSON.stringify(logEntry, null, 2));
        console.log('✅'.repeat(20) + '\n');
        
        // Also log to file via winston
        logger.http(`Busbud API Response [${status}]`, logEntry);
        
        return response;
      },
      error => {
        const { config, response, message, stack } = error;
        const { requestId, startTime, timestamp } = (config && config.metadata) || {};
        const duration = startTime ? Date.now() - startTime : 'unknown';
        
        const errorLog = {
          timestamp: timestamp || new Date().toISOString(),
          type: 'RESPONSE_ERROR',
          requestId,
          durationMs: duration,
          message,
          stack,
          request: config ? {
            url: config.url,
            method: config.method,
            data: config.data,
            params: config.params
          } : null,
          response: response ? {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
            data: response.data
          } : null
        };
        
        console.error('\n' + '❌'.repeat(30));
        console.error('BUSBUD API RESPONSE ERROR');
        console.error('❌'.repeat(30));
        console.error(JSON.stringify(errorLog, null, 2));
        console.error('❌'.repeat(30) + '\n');
        
        logger.error(`Busbud API Response Error`, errorLog);
        return Promise.reject(error);
      }
    );
  }

  // Async initialization
  async initialize() {
    try {
      const newfirestoreCartId = await generateCartId();
      this.setfirestoreCartId(newfirestoreCartId);
      logger.info('BusbudService initialized with firestoreCartId:', { firestoreCartId: this.firestoreCartId });
    } catch (error) {
      logger.error('Error initializing BusbudService:', error);
      throw error;
    }
  }

  // Method to set firestoreCartId with validation
  setfirestoreCartId(firestoreCartId) {
    if (!firestoreCartId || typeof firestoreCartId !== 'string' || firestoreCartId.trim() === '') {
      throw new Error('Invalid firestoreCartId: must be a non-empty string');
    }
    this.firestoreCartId = firestoreCartId.trim();
    logger.debug('User ID set', { firestoreCartId: this.firestoreCartId });
    return this.firestoreCartId;
  }

  setAgentContext(ctx) {
    try {
      const base = ctx || {};
      const firstName = base.firstName || base.first_name || null;
      const lastName = base.lastName || base.last_name || null;
      const name = [firstName, lastName].filter(Boolean).join(' ') || base.agentName || null;
      this.agentCtx = {
        agentMode: Boolean(base.agentMode),
        agentId: base.agentId || base.id || null,
        agentEmail: base.agentEmail || base.emailLower || null,
        agentName: name
      };
    } catch (_) {
      this.agentCtx = null;
    }
  }

  /**
   * Check if API response is cached in memory and not expired
   * @param {string} cacheKey - Unique key for the cached data
   * @param {number} maxAgeMs - Maximum age in milliseconds (default: 5 minutes for search results)
   * @returns {Promise<Object|null>} - Cached data or null if not found/expired
   */
  async getCachedResponse(cacheKey, maxAgeMs = 5 * 60 * 1000) {
    try {
      if (!this.cache.has(cacheKey)) {
        return null;
      }

      const timestamp = this.cacheTimestamps.get(cacheKey);
      const age = Date.now() - timestamp;

      if (age > maxAgeMs) {
        // Cache entry is too old
        this.cache.delete(cacheKey);
        this.cacheTimestamps.delete(cacheKey);
        return null;
      }

      return this.cache.get(cacheKey);
    } catch (error) {
      console.error('Error getting cached response:', error);
      return null;
    }
  }

  /**
   * Save API response to memory cache
   * @param {string} cacheKey - Unique key for the cached data
   * @param {Object} response - API response to cache
   * @param {number} ttlMs - Time to live in milliseconds (default: 5 minutes)
   * @returns {Promise<void>}
   */
  async setCachedResponse(cacheKey, response, ttlMs = 5 * 60 * 1000) {
    try {
      console.log(`💾 Caching response: ${cacheKey} (TTL: ${Math.round(ttlMs / 1000)}s)`);
      this.cache.set(cacheKey, response);
      this.cacheTimestamps.set(cacheKey, Date.now());
      
      // Set up automatic cache invalidation
      setTimeout(() => {
        if (this.cacheTimestamps.get(cacheKey) + ttlMs <= Date.now()) {
          this.cache.delete(cacheKey);
          this.cacheTimestamps.delete(cacheKey);
        }
      }, ttlMs);
      
      console.log(`✅ Successfully cached response for: ${cacheKey}`);
    } catch (error) {
      console.error('Error setting cached response:', error);
      // Don't throw, caching is not critical
    }
  }

  /**
   * Generate cache key for search results
   * @param {string} originId - Origin city ID
   * @param {string} destinationId - Destination city ID
   * @param {string} date - Travel date
   * @param {Object} options - Search options
   * @returns {string} - Cache key
   */
  generateSearchCacheKey(originId, destinationId, date, options = {}) {
    const optionsStr = JSON.stringify({
      adults: options.adults || 1,
      children: options.children || 0,
      seniors: options.seniors || 0,
      currency: options.currency || 'USD',
      returnDate: options.returnDate || null
    });
    return `search_${originId}_${destinationId}_${date}_${optionsStr}`;
  }

  /**
   * Generate cache key for cart operations
   * @param {string} operation - Operation type (create, get, update)
   * @param {string} cartId - Cart ID
   * @param {Object} params - Additional parameters
   * @returns {string} - Cache key
   */
  generateCartCacheKey(operation, cartId, params = {}) {
    const paramsStr = JSON.stringify(params);
    return `cart_${operation}_${cartId}_${paramsStr}`;
  }

  // Helper function to get city IDs from labels using the `cities` table
  // Accepts either raw city names (e.g. "Harare") or labels like "Harare, ZW"
  async getCityIds(originGeohash, destinationGeohash) {
    const requestId = `city_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Resolve from PostgreSQL cities table by city names (and optional country codes)
    try {
      const normalizeLabel = (label) => {
        const raw = (label || '').trim();
        if (!raw) {
          return { name: '', country: '' };
        }

        const parts = raw.split(',');
        const name = parts[0].trim();
        const country = (parts[1] || '').trim();
        return { name, country };
      };

      const { name: originName, country: originCountry } = normalizeLabel(originGeohash);
      const { name: destinationName, country: destinationCountry } = normalizeLabel(destinationGeohash);

      console.log(`🗂️ [${requestId}] Looking up city IDs in Postgres cities table`, {
        origin: originName,
        originCountry,
        destination: destinationName,
        destinationCountry
      });

      const dbResult = await pgQuery(
        `
          SELECT
            origin.city_id AS origin_city_id,
            origin.city_name AS origin_city_name,
            destination.city_id AS destination_city_id,
            destination.city_name AS destination_city_name
          FROM cities AS origin
          JOIN cities AS destination
            ON true
          WHERE lower(trim(origin.city_name)) = lower(trim($1))
            AND lower(trim(destination.city_name)) = lower(trim($2))
            AND ($3 = '' OR lower(trim(origin.country_code2)) = lower(trim($3)))
            AND ($4 = '' OR lower(trim(destination.country_code2)) = lower(trim($4)))
          LIMIT 1;
        `,
        [originName, destinationName, originCountry || '', destinationCountry || '']
      );

      if (dbResult.rows && dbResult.rows.length > 0) {
        const row = dbResult.rows[0];
        console.log(`✅ [${requestId}] Found cities in Postgres`, {
          originCityId: row.origin_city_id,
          destinationCityId: row.destination_city_id,
          originCityName: row.origin_city_name,
          destinationCityName: row.destination_city_name
        });

        return {
          originCityId: row.origin_city_id,
          destinationCityId: row.destination_city_id,
          originName: row.origin_city_name,
          destinationName: row.destination_city_name
        };
      }

      console.log(`❌ [${requestId}] No Postgres match found for origin/destination city names`, {
        origin: originName,
        destination: destinationName
      });
      throw new Error(`No city mapping found for origin "${originName}" and destination "${destinationName}" in local database`);
    } catch (dbError) {
      console.error(`❌ [${requestId}] Error querying Postgres for city IDs:`, dbError.message);
      throw dbError;
    }
  }

  async search(originId, destinationId, date, options = {}) {
    const requestId = `search_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    console.log(`\n🚀 [${requestId}] BusbudService.search() called`);
    console.log(`📋 [${requestId}] Parameters:`, { originId, destinationId, date, options });

    // Validate and resolve city IDs
    let resolvedOriginId = originId;
    let resolvedDestinationId = destinationId;
    let cityNames = null;

    // Treat 32-char hex strings as already-resolved Busbud city IDs
    const looksLikeCityId = (id) => typeof id === 'string' && /^[0-9a-f]{32}$/i.test(id);
    const needsResolution = (id) => !looksLikeCityId(id);

    if (needsResolution(originId) || needsResolution(destinationId)) {
      console.log(`🗺️ [${requestId}] Resolving origin/destination via Postgres/Busbud`, { originId, destinationId });
      try {
        const cityData = await this.getCityIds(originId, destinationId);
        resolvedOriginId = cityData.originCityId;
        resolvedDestinationId = cityData.destinationCityId;
        cityNames = {
          origin: cityData.originName,
          destination: cityData.destinationName
        };
        console.log(`✅ [${requestId}] Resolved to city IDs:`);
        console.log(`  ${originId} → ${resolvedOriginId} (${cityNames.origin})`);
        console.log(`  ${destinationId} → ${resolvedDestinationId} (${cityNames.destination})`);
      } catch (error) {
        console.error(`❌ [${requestId}] Failed to resolve origin/destination identifiers:`, error.message);
        throw new Error(`Failed to resolve origin/destination: ${error.message}`);
      }
    }

    try {
      const params = new URLSearchParams({
        adults: options.adults || 1,
        youth: options.children || 0,
        seniors: options.seniors || 0,
        lang: options.language || 'en',
        currency: options.currency || 'USD',
        sold_out: options.sold_out || false,
        ...(Array.isArray(options.childrenAges) && options.childrenAges.length > 0
          ? { age: options.childrenAges.join(',') }
          : {})
      });

      console.log(`🔧 [${requestId}] Query parameters:`, Object.fromEntries(params));

      const cacheKey = this.generateSearchCacheKey(resolvedOriginId, resolvedDestinationId, date, options);
      
      // Check in-memory cache first
      console.log(`🔍 [${requestId}] Checking cache for key: ${cacheKey}`);
      const cachedResults = await this.getCachedResponse(cacheKey, 10 * 60 * 1000); // 10 minutes cache

      if (cachedResults) {
        console.log(`💾 [${requestId}] Returning cached search results`);
        return this._transformSearchResults(cachedResults);
      }

      console.log(`❌ [${requestId}] No valid cache found, making fresh API request`);

      // Build legs for one-way or roundtrip (aggregated)
      const legs = [{
        origin: {
          id: resolvedOriginId.toString(),
          type: 'city'
        },
        destination: {
          id: resolvedDestinationId.toString(),
          type: 'city'
        },
        date: new Date(date).toISOString().split('T')[0]
      }];

      if (options.returnDate) {
        legs.push({
          origin: {
            id: resolvedDestinationId.toString(),
            type: 'city'
          },
          destination: {
            id: resolvedOriginId.toString(),
            type: 'city'
          },
          date: new Date(options.returnDate).toISOString().split('T')[0]
        });
      }

      const isRoundtrip = legs.length > 1;
      const searchUrl = `${this.baseUrl}/searches${isRoundtrip ? '?roundtrip_legs=aggregated' : ''}`;
      console.log(`🌐 [${requestId}] Search URL: ${searchUrl}`);

      // Build passengers with per-youth age values where available
      const youthAges = Array.isArray(options.childrenAges) ? options.childrenAges : [];

      const adultPassengers = Array.from({ length: options.adults || 1 }, () => ({
        category: 'adult',
        wheelchair: false,
        discounts: []
      }));

      const youthPassengers = Array.from({ length: options.children || 0 }, (_, idx) => ({
        category: 'youth',
        age: youthAges[idx],
        wheelchair: false,
        discounts: []
      }));

      const seniorPassengers = Array.from({ length: options.seniors || 0 }, () => ({
        category: 'senior',
        wheelchair: false,
        discounts: []
      }));

      const requestBody = {
        legs,
        passengers: [
          ...adultPassengers,
          ...youthPassengers,
          ...seniorPassengers
        ],
        options: {
          lang: options.language || 'en',
          locale: 'en-ca',
          currency: options.currency || 'USD',
          country_code: 'US',
          include_sold_out: options.sold_out || false
        }
      };

      console.log(`📦 [${requestId}] Request body:`, JSON.stringify(requestBody, null, 2));

      console.log(`⏱️ [${requestId}] Making search request with 30s timeout...`);
      const response = await axios.post(searchUrl, requestBody, {
        headers: this.headers,
        timeout: 30000,
        validateStatus: (status) => status < 500,
        params: Object.fromEntries(params)
      });

      console.log(`📡 [${requestId}] Search response status: ${response.status}`);
      console.log(`📄 [${requestId}] Response data keys:`, Object.keys(response.data || {}));

      // Log the full search response data for debugging
      console.log(`📄 [${requestId}] Full search response data:`, JSON.stringify(response.data, null, 2));

      if (response.status === 201) {
        if (response.data?.metadata?.links?.poll) {
          const pollUrl = `${this.baseUrl}${response.data.metadata.links.poll}`;
          console.log(`🔄 [${requestId}] Starting polling at: ${pollUrl}`);
          const results = await this.pollSearchResults(pollUrl, requestId);

          if (results) {
            // Check if we got any trips
            const tripsCount = results.trips?.length || 0;
            console.log(`✅ [${requestId}] Polling completed, caching results`);

            if (tripsCount === 0) {
              console.log(`🚨 [${requestId}] No trips found for this search`);
              console.log(`🔍 [${requestId}] Search parameters:`, {
                originId: resolvedOriginId,
                destinationId: resolvedDestinationId,
                date: date,
                originName: cityNames?.origin || originId,
                destinationName: cityNames?.destination || destinationId
              });

              // Try with a different date as fallback (maybe today or tomorrow)
              const fallbackDate = new Date();
              fallbackDate.setDate(fallbackDate.getDate() + 1); // Try tomorrow
              const fallbackDateString = fallbackDate.toISOString().split('T')[0];

              console.log(`🔄 [${requestId}] Attempting fallback search with date: ${fallbackDateString}`);

              // This would require a recursive call or separate search logic
              // For now, just log the suggestion
              console.log(`💡 [${requestId}] Consider trying different dates or verifying city IDs exist`);
            }

            // Cache results in memory
            await this.setCachedResponse(cacheKey, results, 10 * 60 * 1000);
            console.log(`💾 [${requestId}] Cached search results`);
            return this._transformSearchResults(results);
          }
        }
        throw new Error('Search initiated but no poll URL found in response');
      } else if (response.status >= 200 && response.status < 300) {
        console.log(`✅ [${requestId}] Direct results returned, caching`);
        // Cache results in memory
        await this.setCachedResponse(cacheKey, response.data, 10 * 60 * 1000);
        console.log(`💾 [${requestId}] Cached direct results`);
        return this._transformSearchResults(response.data);
      } else {
        throw new Error(`Search request failed with status ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      // Enhanced error handling with detailed debugging information
      const errorContext = {
        method: 'search',
        originId: resolvedOriginId,
        destinationId: resolvedDestinationId,
        date: date,
        options: options,
        timestamp: new Date().toISOString(),
        errorType: 'unknown'
      };

      // Determine error type and provide specific debugging info
      if (error.response) {
        errorContext.errorType = 'http_error';
        errorContext.status = error.response.status;
        errorContext.statusText = error.response.statusText;
        errorContext.responseHeaders = error.response.headers;
        errorContext.responseData = error.response.data;

        console.log(`🔍 [${requestId}] Processing HTTP error:`, {
          status: error.response.status,
          statusText: error.response.statusText,
          responseData: error.response.data
        });

        // Specific error messages based on HTTP status codes
        switch (error.response.status) {
          case 400:
            errorContext.suggestion = 'Check that originId, destinationId, and date parameters are valid. City IDs should be numeric (e.g., 358 for New York).';
            break;
          case 401:
            errorContext.suggestion = 'Authentication failed. Check that X-Busbud-Token is valid and not expired.';
            break;
          case 403:
            errorContext.suggestion = 'Access forbidden. The API token may not have permission for this operation.';
            break;
          case 404:
            errorContext.suggestion = 'City IDs not found. Verify that originId and destinationId are correct Busbud city codes.';
            break;
          case 422:
            // Unprocessable Entity - extract the actual error message from Busbud API
            const apiErrorMessage = error.response.data?.error?.message ||
                                   error.response.data?.message ||
                                   error.response.data?.error ||
                                   'Invalid request parameters';
            errorContext.suggestion = `Request validation failed: ${apiErrorMessage}`;
            errorContext.apiError = error.response.data; // Include full API error for debugging
            console.log(`🎯 [${requestId}] 422 error detected, API message:`, apiErrorMessage);
            break;
          case 429:
            errorContext.suggestion = 'Rate limit exceeded. Wait before making more requests.';
            break;
          case 500:
          case 502:
          case 503:
          case 504:
            errorContext.suggestion = 'Busbud API server error. The service may be temporarily unavailable.';
            break;
          default:
            errorContext.suggestion = `HTTP ${error.response.status} error occurred.`;
        }
      } else if (error.request) {
        errorContext.errorType = 'network_error';
        errorContext.suggestion = 'Network error occurred. Check internet connection and Busbud API availability.';
      } else if (error.code === 'ECONNABORTED') {
        errorContext.errorType = 'timeout_error';
        errorContext.suggestion = 'Request timed out. The Busbud API may be slow to respond.';
      } else if (error.code === 'ENOTFOUND') {
        errorContext.errorType = 'dns_error';
        errorContext.suggestion = 'DNS resolution failed. Check network configuration.';
      } else {
        errorContext.errorType = 'unexpected_error';
        errorContext.suggestion = 'An unexpected error occurred during the search request.';
      }

      // Log detailed error information for debugging
      logger.error('Search error details:', {
        ...errorContext,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
        originalError: error.message,
        // Log full response data for 422 errors to see actual API error
        ...(error.response?.status === 422 && {
          fullResponseData: JSON.stringify(error.response.data, null, 2)
        })
      });

      // Create user-friendly error message with debugging hints
      const userMessage = errorContext.suggestion || 'Failed to search for trips. Please check your input and try again.';

      // Include debugging information in development
      const debugInfo = process.env.NODE_ENV === 'development'
        ? ` [Error Type: ${errorContext.errorType}${errorContext.status ? `, Status: ${errorContext.status}` : ''}]`
        : '';

      throw new Error(`${userMessage}${debugInfo}`);
    }
  }

  /**
   * Transform search results by applying price adjustments and formatting
   * @param {Object} results - The search results to transform
   * @returns {Object} Transformed search results with adjusted prices
   */
  _transformSearchResults(results) {
    // Log the start of transformation
    logger.debug('🔄 Starting price transformation for search results', {
      tripCount: results?.trips?.length || 0,
      searchId: results?.id,
      complete: results?.complete,
      hasPrices: results.trips?.some(t => t.prices?.[0]?.prices?.total !== undefined) ? 'nested' : 'flat'
    });

    if (!results || !results.trips) {
      logger.warn('No trips found in search results, returning empty array');
      return {
        trips: [],
        metadata: {
          totalCount: 0,
          searchId: results?.id || null,
          complete: results?.complete || false,
          pricing: {
            hasAdjustedPrices: true,
            adjustedAt: new Date().toISOString()
          }
        },
        ...results // Preserve any other properties
      };
    }

    // Log sample of original prices
    if (results.trips.length > 0) {
      const sampleTrip = results.trips[0];
      logger.debug('📊 Sample original trip before adjustments:', {
        tripId: sampleTrip.id,
        originalPrice: sampleTrip.price,
        departure: sampleTrip.departure_time
      });
    }

    // Process trips with price adjustments
    const processedTrips = results.trips.map((trip, index) => {
      // Check for nested price structure (prices[0].prices.total)
      if (trip.prices?.[0]?.prices?.total !== undefined) {
        const priceInfo = trip.prices[0].prices;
        const currency = priceInfo.currency || 'USD';

        // Busbud returns monetary amounts in minor units (e.g. cents).
        // Convert once to standard currency units for all adjustment logic
        // and for the top-level trip.price.amount we expose to the frontend.
        const totalCentsRaw = priceInfo.total;
        const totalCents = Number(totalCentsRaw);
        const originalAmount = Number.isFinite(totalCents) ? totalCents / 100 : 0;

        const adjustedAmount = priceUtils.applyPriceAdjustments(originalAmount, { currency });
        const discountAmount = originalAmount - adjustedAmount;
        const ratio = originalAmount > 0 ? (adjustedAmount / originalAmount) : 1;

        logger.debug('🔧 Nested price adjustment:', {
          tripId: trip.id || `#${index}`,
          originalAmount: originalAmount.toFixed(2),
          adjustedAmount: adjustedAmount.toFixed(2),
          discount: {
            amount: discountAmount.toFixed(2),
            percentage: originalAmount > 0 ? (((discountAmount) / originalAmount) * 100).toFixed(2) + '%' : '0%',
            currency
          },
          departure: trip.segments?.[0]?.departure_time?.timestamp
        });

        // Create a new trip object with adjusted prices
        const updatedTrip = {
          ...trip,
          // Keep the original prices structure in cents but update values
          prices: [{
            ...trip.prices[0],
            prices: {
              ...priceInfo,
              // Store adjusted total back in cents
              total: Math.round(adjustedAmount * 100),
              breakdown: {
                ...priceInfo.breakdown,
                // Also keep breakdown totals in cents, scaled by the same ratio
                total: Math.round(adjustedAmount * 100),
                base: Math.round((priceInfo.breakdown?.base || 0) * ratio),
                passengers: priceInfo.breakdown?.passengers?.map(p => ({
                  ...p,
                  total: Math.round((p.total || 0) * ratio),
                  breakdown: {
                    ...p.breakdown,
                    base: Math.round((p.breakdown?.base || 0) * ratio)
                  }
                }))
              }
            }
          }],
          // Add a top-level price in currency units for frontend consumption
          price: {
            amount: adjustedAmount,
            currency,
            discount: {
              percentage: originalAmount > 0 ? ((discountAmount / originalAmount) * 100) : 0,
              amount: discountAmount
            },
            _originalAmount: originalAmount
          }
        };

        return updatedTrip;
      }

      // Fallback to flat price structure if no nested prices found
      if (!trip.price) {
        logger.warn(`Trip ${trip.id || `#${index}`} has no price information`);
        return trip;
      }

      // Price adjustment logic for flat structure using utility
      const originalAmount = trip.price.originalAmount || trip.price.amount || 0;
      const currency = trip.price.currency || 'USD';
      const adjustedAmount = priceUtils.applyPriceAdjustments(originalAmount, { currency });
      const discountAmount = originalAmount - adjustedAmount;

      logger.debug('🔧 Flat price adjustment:', {
        tripId: trip.id || `#${index}`,
        originalAmount: originalAmount.toFixed(2),
        adjustedAmount: adjustedAmount.toFixed(2),
        discount: {
          amount: discountAmount.toFixed(2),
          percentage: originalAmount > 0 ? (((discountAmount) / originalAmount) * 100).toFixed(2) + '%' : '0%',
          currency
        },
        departure: trip.departure_time
      });

      return {
        ...trip,
        price: {
          amount: adjustedAmount,
          currency,
          discount: {
            percentage: originalAmount > 0 ? ((discountAmount / originalAmount) * 100) : 0,
            amount: discountAmount
          },
          ...(process.env.NODE_ENV === 'development' && { _originalAmount: originalAmount })
        }
      };
    });

    // Deduplicate trips that are effectively equivalent for display purposes
    const dedupedTrips = (() => {
      const seen = new Set();
      const unique = [];

      for (let i = 0; i < processedTrips.length; i++) {
        const trip = processedTrips[i];

        const firstSeg = Array.isArray(trip.segments) && trip.segments.length > 0 ? trip.segments[0] : null;
        const lastSeg = Array.isArray(trip.segments) && trip.segments.length > 0 ? trip.segments[trip.segments.length - 1] : null;

        const originName = firstSeg?.origin?.name || trip.origin || '';
        const destinationName = lastSeg?.destination?.name || trip.destination || '';

        const depTs = firstSeg?.departure_time?.timestamp || firstSeg?.departure_time || trip.departure_time || '';
        const arrTs = lastSeg?.arrival_time?.timestamp || lastSeg?.arrival_time || trip.arrival_time || '';

        const keyParts = [
          trip.id || '',
          String(originName),
          String(destinationName),
          String(depTs),
          String(arrTs)
        ];

        const key = keyParts.join('|');

        if (!seen.has(key)) {
          seen.add(key);
          unique.push(trip);
        } else {
          logger.debug('🔁 Skipping duplicate trip after transformation', {
            tripId: trip.id || `#${i}`,
            origin: originName,
            destination: destinationName,
            departure: depTs,
            arrival: arrTs
          });
        }
      }

      return unique;
    })();

    // Calculate totals using adjusted prices on deduplicated trips
    const totals = dedupedTrips.reduce((acc, trip, index) => {
      if (trip.price) {
        acc.total = (acc.total || 0) + (trip.price.amount || 0);
        acc.tripCount = (acc.tripCount || 0) + 1;
        
        // Log first few trip totals for verification
        if (index < 3) {
          logger.debug(`💳 Trip ${index + 1} total:`, {
            tripId: trip.id || `#${index}`,
            amount: trip.price.amount?.toFixed(2) || '0.00',
            currency: trip.price.currency || 'USD',
            runningTotal: acc.total.toFixed(2)
          });
        }
      }
      return acc;
    }, {});

    // Log final adjustment summary
    logger.info('✅ Price transformation complete', {
      totalTrips: dedupedTrips.length,
      tripsWithPrices: totals.tripCount || 0,
      totalAdjustedAmount: (totals.total || 0).toFixed(2),
      currency: results.currency || 'USD',
      sampleAdjustedTrip: dedupedTrips[0] ? {
        id: dedupedTrips[0].id,
        price: dedupedTrips[0].price,
        departure: dedupedTrips[0].departure_time
      } : 'No trips available'
    });

    // Compute effective discount at aggregate level for metadata
    const originalTotal = results.metadata?.pricing?.total?.amount;
    const adjustedTotal = totals.total || 0;
    const effectiveDiscountPct =
      typeof originalTotal === 'number' && originalTotal > 0
        ? ((originalTotal - adjustedTotal) / originalTotal) * 100
        : 0;

    // Return only adjusted prices in the response
    return {
      ...results,
      trips: dedupedTrips,
      metadata: {
        ...(results.metadata || {}),
        pricing: {
          hasAdjustedPrices: true,
          adjustedAt: new Date().toISOString(),
          currency: results.currency || 'USD',
          total: {
            amount: adjustedTotal,
            currency: results.currency || 'USD'
          },
          discount: {
            percentage: effectiveDiscountPct,
            description:
              effectiveDiscountPct !== 0
                ? `${effectiveDiscountPct.toFixed(2)}% adjustment applied`
                : 'No adjustment applied'
          }
        }
      }
    };
  }

  /**
   * Poll for search results until complete
   * @param {string} pollUrl - The URL to poll for results
   * @param {string} requestId - Unique ID for request tracking
   * @returns {Promise<Object>} The complete search results
   */
  async pollSearchResults(pollUrl, requestId) {
    const startTime = Date.now();
    const maxTotalTime = 120000;
    let currentUrl = pollUrl;
    const maxRetries = 2;
    let attempt = 0;

    const ensureRequiredParams = (rawUrl) => {
      try {
        const u = new URL(rawUrl);
        if (!u.searchParams.has('lang')) u.searchParams.set('lang', 'en');
        if (!u.searchParams.has('locale')) u.searchParams.set('locale', 'en-ca');
        if (!u.searchParams.has('currency')) u.searchParams.set('currency', 'USD');
        return u.toString();
      } catch {
        return rawUrl;
      }
    };

    while (true) {
      if (Date.now() - startTime > maxTotalTime) {
        throw new Error(`Search polling exceeded maximum time limit of ${maxTotalTime}ms`);
      }

      const urlToFetch = ensureRequiredParams(currentUrl);
      let response;

      try {
        response = await axios.get(urlToFetch, {
          headers: this.headers,
          timeout: 120000,
          validateStatus: (status) => status < 500
        });
      } catch (error) {
        const status = error.response?.status;
        const isTimeout = error.code === 'ECONNABORTED';
        const isRetryableHttp = typeof status === 'number' && status >= 500 && status < 600;

        if ((isTimeout || isRetryableHttp) && attempt < maxRetries) {
          attempt += 1;
          const delayMs = 1000 * Math.pow(2, attempt - 1);
          logger.warn('Busbud polling error, retrying', {
            requestId,
            attempt,
            status,
            isTimeout,
            delayMs,
            error: error.message
          });

          const elapsed = Date.now() - startTime;
          if (elapsed + delayMs > maxTotalTime) {
            throw new Error(`Search polling exceeded maximum time limit of ${maxTotalTime}ms`);
          }

          await new Promise((res) => setTimeout(res, delayMs));
          continue;
        }

        // Non-retryable error or retries exhausted
        throw error;
      }

      const data = response.data || {};

      const nextLink = data?.metadata?.links?.poll ?? null;
      const waitMs = Math.max(0, parseInt(data?.metadata?.interval, 10) || 2000);

      if (nextLink === null) {
        return data;
      }

      const nextUrl = nextLink.startsWith('http') ? nextLink : `${this.baseUrl}${nextLink}`;
      await new Promise((res) => setTimeout(res, waitMs));
      currentUrl = nextUrl;
    }
  }

  async getTripDetails(tripId) {
    const cacheKey = `trip_${tripId}`;

    try {
      // Check in-memory cache first (1 hour cache for trip details)
      const cachedTrip = await this.getCachedResponse(cacheKey, 60 * 60 * 1000);
      if (cachedTrip) {
        logger.debug(`[CACHE] Using cached trip details for trip ID: ${tripId}`);
        return cachedTrip;
      }

      logger.debug(`[CACHE] No cached trip details found, fetching from API for trip ID: ${tripId}`);

      // Construct the full URL with any query parameters
      const url = new URL(`${this.baseUrl}/trips/${tripId}`);
      
      // Add any query parameters if needed
      // url.searchParams.append('key', 'value');

      const requestConfig = { 
        headers: this.headers,
        timeout: 15000
      };

      // Log the exact request that will be made
      logger.debug('[DEBUG] Trip Verification Request:', {
        timestamp: new Date().toISOString(),
        method: 'GET',
        url: url.toString(),
        headers: {
          ...this.headers,
          'X-Busbud-Token': '***REDACTED***'  // Redact sensitive information
        },
        timeout: requestConfig.timeout,
        // Include any other request configuration details
        requestConfig: {
          ...requestConfig,
          // Don't log the entire headers object again
          headers: { ...Object.keys(requestConfig.headers).reduce((acc, key) => ({
            ...acc,
            [key]: key.toLowerCase().includes('token') ? '***REDACTED***' : requestConfig.headers[key]
          }), {})}
        }
      });

      // Make the actual request
      const response = await axios.get(url.toString(), requestConfig);

      // Log the response details (excluding sensitive data)
      logger.debug('[DEBUG] Trip Verification Response:', {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        data: response.data ? {
          id: response.data.id,
          status: response.data.status,
          departure_time: response.data.departure_time,
          arrival_time: response.data.arrival_time,
          origin_location: response.data.origin_location,
          destination_location: response.data.destination_location,
          // Add other relevant fields
        } : 'No data in response'
      });

      if (response.status !== 200) {
        throw new Error(`Failed to fetch trip details: ${response.statusText}`);
      }

      const tripData = response.data;

      // Cache trip details in memory
      await this.setCachedResponse(cacheKey, tripData, 60 * 60 * 1000);
      logger.debug(`[CACHE] Cached trip details for trip ID: ${tripId}`);

      return tripData;

    } catch (error) {
      logger.error(`[DEBUG] Error in trip verification for ${tripId}:`, {
        timestamp: new Date().toISOString(),
        message: error.message,
        code: error.code,
        // Request details
        request: error.config ? {
          url: error.config.url,
          method: error.config.method,
          headers: {
            ...error.config.headers,
            'X-Busbud-Token': '***REDACTED***'
          },
          data: error.config.data
        } : 'No request config',
        // Response details if available
        response: error.response ? {
          status: error.response.status,
          statusText: error.response.statusText,
          data: error.response.data
        } : 'No response',
        // Stack trace for debugging
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
      
      return {
        trips: [],
        metadata: {
          totalCount: 0,
          searchId: results?.id || null,
          complete: results?.complete || false,
          progress: results?.progress || null,
          currency: results?.currency || 'USD'
        }
      };
    }
  }

  async bookTrip(bookingDetails) {
    try {
      const response = await axios.post(
        `${this.baseUrl}/bookings`,
        bookingDetails,
        {
          headers: {
            ...this.headers,
            'Content-Type': 'application/json'
          },
          timeout: 45000
        }
      );

      if (response.status !== 201) {
        throw new Error(`Booking failed with status ${response.status}`);
      }

      return response.data;
    } catch (error) {
      logger.error('Booking error:', error);
      throw error;
    }
  }

  async getBookingStatus(bookingId) {
    try {
      const response = await axios.get(
        `${this.baseUrl}/bookings/${bookingId}`,
        { 
          headers: this.headers,
          timeout: 10000
        }
      );
      return response.data;
    } catch (error) {
      logger.error('Error getting booking status:', error);
      throw error;
    }
  }

  async cancelBooking(bookingId) {
    try {
      const response = await axios.post(
        `${this.baseUrl}/bookings/${bookingId}/cancel`,
        {},
        {
          headers: this.headers,
          timeout: 15000
        }
      );

      if (response.status !== 200) {
        throw new Error(`Cancellation failed with status ${response.status}`);
      }

      return response.data;
    } catch (error) {
      logger.error(`Error cancelling booking ${bookingId}:`, error);
      throw error;
    }
  }

  async getTripStops(tripId, options = {}) {
    try {
      const params = new URLSearchParams({
        lang: options.lang || 'en',
        locale: options.locale || 'en-ca'
      });

      const url = `${this.baseUrl}/trips/${tripId}/stops?${params}`;
      
      const response = await axios.get(url, {
        headers: this.headers,
        timeout: 10000
      });

      if (response.status === 200) {
        return response.data;
      }
      
      throw new Error(`Failed to fetch trip stops: ${response.status} ${response.statusText}`);
    } catch (error) {
      const errorDetails = {
        requestId: 'getTripStops',
        cartId: 'none',
        tripId: tripId ? `${tripId.substring(0, 4)}...${tripId.slice(-4)}` : 'none',
        passengerCount: 0,
        error: {
          message: error.message,
          code: error.code,
          status: error.response?.status,
          statusText: error.response?.statusText,
          responseData: error.response?.data
        }
      };
      
      logger.error(`[${errorDetails.requestId}] Error fetching trip stops`, errorDetails);
      
      // Re-throw with additional context
      const enhancedError = new Error(`[${errorDetails.requestId}] ${error.message}`);
      enhancedError.details = errorDetails;
      throw enhancedError;
    }
  }

  /**
   * Poll the Busbud cart to get the latest cart details
   * @param {string} cartId - The cart ID to poll
   * @param {string} locale - Locale for the response (e.g., 'en-ca')
   * @param {string} currency - Currency code (e.g., 'USD')
   * @returns {Promise<Object>} The latest cart details
   */
  async pollBusbudCart(cartId, locale = 'en-ca', currency = 'USD') {
    const startTime = Date.now();
    const logContext = { cartId, locale, currency };

    try {
      logger.info('[pollBusbudCart] Polling cart for latest details', logContext);
      
      if (!cartId) {
        throw new Error('cartId is required');
      }

      const url = `${this.baseUrl}/carts/${encodeURIComponent(cartId)}`;
      const params = new URLSearchParams({ locale, currency });
      
      logger.debug('Making API request to poll cart', { 
        url: `${url}?${params}`, 
        method: 'GET'
      });

      const response = await axios.get(url, {
        params: { locale, currency },
        headers: {
          ...this.headers,
          'X-Busbud-Token': config.busbud.privateToken || this.headers['X-Busbud-Token']
        },
        timeout: 10000 // 10 second timeout
      });

      const responseTime = Date.now() - startTime;
      
      logger.info('✅ Successfully polled cart', {
        ...logContext,
        status: response.status,
        responseTime: `${responseTime}ms`,
        cartStatus: response.data?.status
      });

      // Update Firestore with the latest cart status if we have a firestoreCartId
      if (this.firestoreCartId && this.db) {
        try {
          const cartRef = this.db.collection('carts').doc(this.firestoreCartId);
          await cartRef.set({
            lastUpdated: new Date().toISOString(),
            status: response.data?.status || 'unknown',
            summary: {
              totalPrice: response.data?.price?.total,
              currency: response.data?.currency || currency,
              itemsCount: response.data?.trips?.length || 0
            },
            metadata: {
              ...(response.data?.metadata || {}),
              lastPolled: new Date().toISOString()
            }
          }, { merge: true });
          // Previously mirrored cart status to Postgres (upsertCartFromFirestore). Postgres cart mirroring has been removed.
          
          logger.debug('Updated Firestore with latest cart status', {
            firestoreCartId: this.firestoreCartId,
            status: response.data?.status
          });
        } catch (firestoreError) {
          logger.error('Error updating Firestore with cart status', {
            ...logContext,
            error: firestoreError.message,
            stack: firestoreError.stack
          });
          // Don't fail the whole request if Firestore update fails
        }
      }

      return response.data;
      
    } catch (error) {
      const errorTime = Date.now() - startTime;
      const errorContext = {
        ...logContext,
        error: error.message,
        stack: error.stack,
        response: error.response?.data,
        status: error.response?.status,
        responseTime: `${errorTime}ms`
      };

      logger.error('❌ Error polling cart', errorContext);
      
      // If we have a response with status code, include it in the error
      if (error.response) {
        const err = new Error(`Failed to poll cart: ${error.response.status} ${error.response.statusText}`);
        err.statusCode = error.response.status;
        err.responseData = error.response.data;
        throw err;
      }
      
      throw new Error(`Failed to poll cart: ${error.message}`);
    }
  }

  /**
   * Create a new cart
   * @param {string} currency - Currency code (e.g., 'USD')
   * @param {string|null} branchHint - Optional branch hint (e.g., 'frontend', 'chatbot') for Firestore cart ID encoding
   * @returns {Promise<Object>} The created cart details
   */
  async createCart(currency = 'USD', branchHint = null) {
    try {
      const requestData = {
        user_currency: currency,
        supported_payment_providers: ["iou"]
      };

      // Log the request details
      const requestUrl = `${this.baseUrl}/carts`;
      console.log('\n=== CREATE CART REQUEST ===');
      console.log('URL:', requestUrl);
      console.log('Method: POST');
      console.log('Headers:', JSON.stringify({
        ...this.headers,
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.busbud+json; version=3; profile=https://schema.busbud.com/v3/anything.json',
        'X-Busbud-Token': '***REDACTED***' // Don't log the actual token
      }, null, 2));
      console.log('Body:', JSON.stringify(requestData, null, 2));

      const response = await axios.post(
        requestUrl,
        requestData,
        {
          headers: {
            ...this.headers,
            'Content-Type': 'application/json',
            'Accept': 'application/vnd.busbud+json; version=3; profile=https://schema.busbud.com/v3/anything.json'
          },
          timeout: 15000
        }
      );

      // Log the response details
      console.log('\n=== CREATE CART RESPONSE ===');
      console.log('Status:', response.status, response.statusText);
      console.log('Headers:', JSON.stringify(response.headers, null, 2));
      console.log('Data:', JSON.stringify(response.data, null, 2));

      if (response.status !== 200) {
        throw new Error(`Failed to create cart: ${response.statusText}`);
      }
      
      // Log the API response
      logger.debug('[createCart] API response received');
      console.log('✅ createCart API response received');
      
      // Initialize Firestore if not already initialized
      if (!this.db) {
        logger.debug('Initializing Firestore...');
        this.db = await getFirestore();
        logger.debug('Firestore initialized successfully');
      }
      
      try {
        const firestoreCartId = await ensureFirestoreCartId(response.data.id, branchHint);
        this.firestoreCartId = firestoreCartId;
      } catch (e) {
        logger.warn('Failed to ensure Firestore cart mapping on createCart', { error: e.message });
      }

      return response.data;

    } catch (error) {
      console.error('\n=== CREATE CART ERROR ===');
      if (error.response) {
        console.error('Status:', error.response.status);
        console.error('Headers:', JSON.stringify(error.response.headers, null, 2));
        console.error('Data:', JSON.stringify(error.response.data, null, 2));
      } else if (error.request) {
        console.error('No response received');
        console.error('Request:', error.request);
      } else {
        console.error('Error:', error.message);
      }
      console.error('Config:', {
        url: error.config?.url,
        method: error.config?.method,
        headers: error.config?.headers ? {
          ...error.config.headers,
          'X-Busbud-Token': '***REDACTED***'
        } : undefined,
        data: error.config?.data
      });
      
      throw error;
    }
  }

/**
   * Add one or more trips to the Busbud cart and verify the cart state
   * @param {string} cartId - The cart ID to add the trip to
   * @param {string|Array} tripId - Single trip ID or array of trip objects with {id, type, passengers}
   * @param {Array} [passengers=[]] - Array of passenger objects (used if tripId is a string)
   * @param {string} [locale='en-ca'] - Locale for the request
   * @param {string} [currency='USD'] - Currency code
   * @param {boolean} [verifyCart=true] - Whether to verify cart state after adding
   * @returns {Promise<Object>} The cart details after adding the trip(s)
   */
  /**
   * Add a round trip (both outbound and return) to the cart in a single API call
   * @param {string} cartId - The cart ID to add the trips to
   * @param {string} outboundTripId - The outbound trip ID
   * @param {string} returnTripId - The return trip ID
   * @param {Array} outboundPassengers - Passengers for the outbound trip
   * @param {Array} [returnPassengers=null] - Passengers for the return trip (defaults to outboundPassengers)
   * @param {string} [locale='en-ca'] - Locale for the request
   * @param {string} [currency='USD'] - Currency code
   * @returns {Promise<Object>} The cart details after adding both trips
   */
  async addRoundTripToCart(cartId, outboundTripId, returnTripId, outboundPassengers, returnPassengers = null, locale = 'en-ca', currency = 'USD') {
    const logContext = { 
      cartId, 
      outboundTripId, 
      returnTripId, 
      locale, 
      currency,
      firestoreCartId: this.firestoreCartId
    };

    try {
      logger.info('[addRoundTripToCart] Starting round trip booking', logContext);
      
      // Ensure Firestore is initialized
      if (!this.db) {
        this.db = await getFirestore();
      }
      const firestoreCartId = await ensureFirestoreCartId(cartId);
      this.firestoreCartId = firestoreCartId;
      
      // Prepare the round trip payload according to Busbud API format
      const roundTripPayload = {
        trips: [
          {
            trip_id: outboundTripId,
            passengers: outboundPassengers.map(p => ({
              category: p.category || 'adult',
              wheelchair: Boolean(p.wheelchair),
              discounts: Array.isArray(p.discounts) ? p.discounts : []
            }))
          },
          {
            trip_id: returnTripId,
            passengers: (returnPassengers || outboundPassengers).map(p => ({
              category: p.category || 'adult',
              wheelchair: Boolean(p.wheelchair),
              discounts: Array.isArray(p.discounts) ? p.discounts : []
            }))
          }
        ]
      };

      logger.debug('[addRoundTripToCart] Sending round trip payload to Busbud API', {
        ...logContext,
        payload: JSON.stringify(roundTripPayload, null, 2)
      });
      // Sequential mode: add outbound then return using standard endpoint
      logger.info('[addRoundTripToCart] Using sequential add mode (no batch endpoint)', logContext);
      // Check existing items in cart to avoid duplicate adds if outbound was already added
      let existingCart = null;
      try {
        existingCart = await this.getCart(cartId, locale, currency);
      } catch (e) {
        logger.warn('[addRoundTripToCart] Unable to fetch existing cart, proceeding without duplicate check', { cartId });
      }
      const existingIds = new Set(
        Array.isArray(existingCart?.items) ? existingCart.items.map(item => item.id).filter(Boolean) : []
      );

      const tripsArray = [
        { id: outboundTripId, type: 'outbound', passengers: outboundPassengers },
        { id: returnTripId, type: 'return', passengers: (returnPassengers || outboundPassengers) }
      ];
      const tripsToAdd = tripsArray.filter(t => !existingIds.has(t.id));
      logger.debug('[addRoundTripToCart] Trips to add after duplicate check', {
        cartId,
        existingCount: existingIds.size,
        toAddCount: tripsToAdd.length,
        toAdd: tripsToAdd.map(t => ({ id: t.id, type: t.type }))
      });

      let addResp = existingCart;
      if (tripsToAdd.length > 0) {
        addResp = await this.addTripToCart(cartId, tripsToAdd, [], locale, currency, true);
      }
      const response = { data: addResp };

      // Generate a unique round trip ID
      const roundTripId = `rt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Get the current cart data to preserve existing fields
      const cartRef = this.db.collection('carts').doc(String(firestoreCartId));
      const cartDoc = await cartRef.get();
      const cartData = cartDoc.exists ? cartDoc.data() : {};

      // Calculate total passengers across both trips
      const totalPassengers = outboundPassengers.length + (returnPassengers || outboundPassengers).length;

      // Update Firestore with round trip metadata
      const updateData = {
        'summary': {
          ...(cartData.summary || {}), // Preserve existing summary fields
          isRoundTrip: true,
          tripCount: 2,
          passengerCount: totalPassengers,
          lastUpdated: new Date().toISOString(),
          status: 'active'
        },
        'trip': {
          ...(cartData.trip || {}), // Preserve existing trip data
          tripId: 'multiple',
          roundTripId,
          tripType: 'roundtrip',
          status: 'added',
          addedAt: new Date().toISOString(),
          passengers: [
            ...outboundPassengers,
            ...(returnPassengers || outboundPassengers)
          ]
        },
        'trips': roundTripPayload.trips.map((trip, index) => ({
          tripId: trip.trip_id,
          type: index === 0 ? 'outbound' : 'return',
          status: 'added',
          addedAt: new Date().toISOString(),
          passengers: trip.passengers,
          ...(trip.trip_details || {})
        })),
        'lastUpdated': new Date().toISOString(),
        'updatedAt': new Date().toISOString(),
        'cartId': cartId,
        'firestoreCartId': firestoreCartId,
        'tripId': roundTripId, // Set to roundTripId for reference
        'tripType': 'roundtrip',
        'status': 'active'
      };

      // Merge with existing cart data
      await cartRef.set(updateData, { merge: true });

      // Get the updated cart data to include in the response
      const updatedCart = await cartRef.get();
      const cartResponse = updatedCart.exists ? updatedCart.data() : updateData;

      logger.info('[addRoundTripToCart] Successfully added round trip to cart', {
        ...logContext,
        firestoreCartId: firestoreCartId,
        roundTripId,
        tripCount: 2,
        passengerCount: totalPassengers,
        mode: 'sequential'
      });

      return {
        ...response.data,
        firestoreCartId: firestoreCartId,
        roundTripId,
        tripCount: 2,
        isRoundTrip: true
      };
    } catch (error) {
      const errorContext = {
        ...logContext,
        error: error.message,
        response: error.response?.data,
        stack: error.stack
      };
      
      logger.error('[addRoundTripToCart] Error adding round trip to cart', errorContext);
      
      // Re-throw with additional context
      const enhancedError = new Error(`Failed to add round trip to cart: ${error.message}`);
      enhancedError.context = errorContext;
      throw enhancedError;
    }
  }

  /**
   * Add a trip to the Busbud cart and verify the cart state
   * @param {string} cartId - The cart ID to add the trip to
   * @param {string|Array} tripId - Single trip ID or array of trip objects with {id, type, passengers}
   * @param {Array} [passengers=[]] - Array of passenger objects (used if tripId is a string)
   * @param {string} [locale='en-ca'] - Locale for the request
   * @param {string} [currency='USD'] - Currency code
   * @param {boolean} [verifyCart=true] - Whether to verify cart state after adding
   * @returns {Promise<Object>} The cart details after adding the trip(s)
   */
  async addTripToCart(cartId, tripId, passengers = [], locale = 'en-ca', currency = 'USD', verifyCart = true) {
    const startTime = Date.now();
    const firestoreCartId = await ensureFirestoreCartId(cartId);
    this.firestoreCartId = firestoreCartId;
    const logContext = { cartId, tripId, firestoreCartId, locale, currency };

    try {
        logger.info('[addTripToCart] Starting', logContext);
        
        if (!cartId) throw new Error('cartId is required');
        if (!tripId || (Array.isArray(tripId) && tripId.length === 0)) {
          throw new Error('tripId or array of trips is required');
        }
        if (!firestoreCartId) throw new Error('firestoreCartId is not set');

        // Initialize Firestore if needed
        if (!this.db) {
            logger.debug('Initializing Firestore...');
            this.db = await getFirestore();
            logger.info('Firestore initialized successfully');
        }

        // Pre-validate the Busbud cart exists and is accessible. This helps avoid 400 CartNotSet.
        try {
            logger.debug('[addTripToCart] Pre-validating cart existence', { cartId, locale, currency });
            await this.getCart(cartId, locale, currency);
            logger.debug('[addTripToCart] Cart pre-validation succeeded', { cartId });
        } catch (precheckError) {
            const status = precheckError.response?.status;
            logger.warn('[addTripToCart] Cart pre-validation failed', {
              cartId,
              status,
              error: precheckError.message,
              response: precheckError.response?.data
            });
            if (status === 404) {
              throw new Error(`Busbud cart ${cartId} not found or expired`);
            }
            // For other statuses, proceed to attempt add; the API may still accept the add request
        }

        logger.debug('Formatting passenger data', { passengerCount: passengers.length });
        
        // If we have a single passenger object but need multiple passengers (for backward compatibility)
        let passengerList = [];
        if (passengers.length === 1 && passengers[0].count > 1) {
            // Create multiple passenger entries based on the count
            const basePassenger = passengers[0];
            passengerList = Array(basePassenger.count).fill(0).map(() => ({
                category: basePassenger.category || 'adult',
                wheelchair: !!basePassenger.wheelchair,
                discounts: Array.isArray(basePassenger.discounts) ? basePassenger.discounts : []
            }));
        } else {
            // Standard case - one passenger object per passenger
            passengerList = passengers.map(p => ({
                category: p.category || 'adult',
                wheelchair: !!p.wheelchair,
                discounts: Array.isArray(p.discounts) ? p.discounts : []
            }));
        }
        
        // Process passenger list
        logger.debug('Processed passenger list', {
            service: 'uniglade-api',
            inputPassengers: Array.isArray(passengers) ? passengers.length : 0,
            outputPassengers: Array.isArray(passengerList) ? passengerList.length : 0,
            firstPassenger: Array.isArray(passengerList) && passengerList[0] ? {
                category: passengerList[0].category,
                wheelchair: passengerList[0].wheelchair,
                discountCount: Array.isArray(passengerList[0].discounts) ? passengerList[0].discounts.length : 0
            } : null
        });

        // Handle multiple trips if tripId is an array
        let tripsToAdd = Array.isArray(tripId) ? tripId : [{ id: tripId, type: 'oneway', passengers }];
        let lastResponse = null;

        // Idempotency guard: if this trip was already added (per Firestore), skip adding again
        try {
          const cartRef = this.db.collection('carts').doc(String(firestoreCartId));
          const cartDoc = await cartRef.get();
          if (cartDoc.exists) {
            const existingTrips = Array.isArray(cartDoc.data()?.trips) ? cartDoc.data().trips : [];
            const existingIds = new Set(existingTrips.map(t => t.tripId));
            const beforeCount = tripsToAdd.length;
            tripsToAdd = tripsToAdd.filter(t => !existingIds.has(t.id));
            if (tripsToAdd.length < beforeCount) {
              logger.info('[addTripToCart] Skipping already-added trips for idempotency', {
                cartId,
                skipped: beforeCount - tripsToAdd.length
              });
            }
            if (tripsToAdd.length === 0) {
              const currentCart = await this.getCart(cartId, locale, currency);
              return {
                ...currentCart,
                cartId,
                firestoreCartId,
                idempotent: true,
                firestoreUpdated: false
              };
            }
          }
        } catch (dedupeError) {
          logger.warn('[addTripToCart] Failed to check Firestore for existing trips; proceeding without dedupe', {
            cartId,
            error: dedupeError.message
          });
        }

        // Compute timeout and retry settings from env (with sensible defaults)
        const baseTimeoutMs = parseInt(process.env.BUSBUD_TIMEOUT_MS, 10) || 15000;
        const maxRetries = 2;

        // Process each trip sequentially
        let currentCartId = cartId; // Track cart ID returned by Busbud, ensure subsequent adds use the SAME cart
        for (const trip of tripsToAdd) {
          const tripId = trip.id;
          const tripPassengers = trip.passengers || passengers;
          const tripType = trip.type || 'oneway';
          
          // Make API request to add trip to cart
          const url = `${this.baseUrl}/carts/${encodeURIComponent(currentCartId)}/trips`;
          
          logger.debug('Making API request to add trip to cart', { 
            url,
            method: 'POST',
            tripId,
            tripType,
            passengerCount: tripPassengers.length
          });

          const buildPayload = () => ({
            trip_id: tripId,
            passengers: tripPassengers.map(passenger => {
              const rawCategory = passenger.category || 'adult';
              const normalizedCategory =
                rawCategory === 'child' || rawCategory === 'children'
                  ? 'youth'
                  : rawCategory;

              let age = typeof passenger.age === 'number' ? passenger.age : undefined;
              if (age == null) {
                if (normalizedCategory === 'adult') {
                  age = 30;
                } else if (normalizedCategory === 'youth') {
                  age = 10;
                } else if (normalizedCategory === 'senior') {
                  age = 65;
                }
              }

              const payload = {
                category: normalizedCategory,
                wheelchair: !!passenger.wheelchair,
                discounts: Array.isArray(passenger.discounts) ? passenger.discounts : []
              };

              if (normalizedCategory !== 'pet' && typeof age === 'number') {
                payload.age = age;
              }

              return payload;
            })
          });

          let attempt = 0;
          let response = null;
          // Retry loop for transient timeout errors
          while (true) {
            try {
              const timeoutMs = baseTimeoutMs * Math.pow(2, attempt); // exponential backoff
              response = await axios.post(url, buildPayload(), {
                params: { locale, currency },
                headers: {
                  ...this.headers,
                  'Accept': 'application/vnd.busbud+json; version=3; profile=https://schema.busbud.com/v3/anything.json',
                  'User-Agent': 'busbud-website/1.0 (+http://www.busbud.com)'
                },
                timeout: timeoutMs
              });
              break; // success
            } catch (err) {
              const isTimeout = err.code === 'ECONNABORTED' || /timeout of \d+ms exceeded/i.test(err.message || '');
              if (!isTimeout || attempt >= maxRetries) {
                throw err;
              }
              attempt += 1;
              const delayMs = 1000 * Math.pow(2, attempt - 1);
              logger.warn('[addTripToCart] Timeout when calling Busbud, retrying', {
                cartId: currentCartId,
                tripId,
                attempt,
                timeoutMs: baseTimeoutMs,
                delayMs,
                error: err.message
              });
              await new Promise(resolve => setTimeout(resolve, delayMs));
            }
          }

          lastResponse = response;

          // Only adopt a returned cart ID if the response looks like a CART object.
          // Some endpoints return an item/trip object where `id` equals the trip token (e.g. base64 starting with 'eyJ').
          // Adopting that would break subsequent cart polling.
          const looksLikeCartObject = response?.data && (
            Array.isArray(response.data.items) ||
            typeof response.data.status === 'string' ||
            response.data.charges ||
            response.data.trips
          );
          let returnedCartId = response?.data?.cart?.id;
          if (!returnedCartId && looksLikeCartObject) {
            returnedCartId = response?.data?.id;
          }
          const isTripToken = typeof response?.data?.id === 'string' &&
            (response.data.id === tripId || response.data.id.startsWith('eyJ'));
          if (returnedCartId && !isTripToken && returnedCartId !== currentCartId) {
            logger.info('[addTripToCart] Adopting cart ID from API response for subsequent legs', {
              previousCartId: currentCartId,
              returnedCartId
            });
            currentCartId = returnedCartId;
            cartId = returnedCartId;
            try {
              const newFsId = await ensureFirestoreCartId(currentCartId);
              this.firestoreCartId = newFsId;
            } catch (mapErr) {
              logger.warn('[addTripToCart] Failed to update Firestore cart mapping after cartId change', {
                error: mapErr.message,
                cartId: currentCartId
              });
            }
          }
          
          // Add a small delay between adding trips to avoid rate limiting
          if (tripsToAdd.length > 1) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }

        // Ensure we verify and return details for the final (canonical) cart ID
        // Poll the cart to get the latest state if verification is enabled
        let cartDetails = lastResponse.data;
        let cartExpiryDate = null; // Initialize in outer scope
        
        if (verifyCart) {
          try {
            logger.debug('Verifying cart state after adding trip', { cartId: currentCartId, tripId: tripsToAdd.map(t => t.id).join(',') });
            cartDetails = await this.pollBusbudCart(currentCartId, locale, currency);
            
            // Process prices to include both original and adjusted amounts
            if (cartDetails.items) {
            }
            
            // Use verified cart details as the canonical response
            lastResponse = { data: cartDetails };

            // Update cartExpiryDate from the polled cart details
            cartExpiryDate = cartDetails.metadata?.ttl ? new Date(cartDetails.metadata.ttl) : null;
            // Format cart details for better readability
            const formatSegment = (segment) => ({
              id: segment.id,
              departure: segment.departure_time?.timestamp,
              arrival: segment.arrival_time?.timestamp,
              origin: segment.origin?.name,
              destination: segment.destination?.name,
              operator: segment.operator?.name,
              vehicle: segment.vehicle?.type,
              availableSeats: segment.vehicle?.available_seats
            });

            const formatPassenger = (passenger) => ({
              category: passenger.category,
              name: passenger.first_name ? `${passenger.first_name} ${passenger.last_name || ''}`.trim() : 'Not specified',
              wheelchair: passenger.wheelchair || false,
              phone: passenger.phone || '',
              discountCount: passenger.discounts?.length || 0,
              discounts: passenger.discounts || []
            });

            const formatCharge = (charge) => ({
              type: charge.type,
              amount: charge.amount,
              currency: cartDetails.charges?.currency || 'USD',
              description: charge.trip_id ? `Trip ${charge.trip_id.substring(0, 8)}...` : 'Additional charge'
            });

            // cartExpiryDate is now set in the outer scope
            
            const formattedResponse = {
              cartId: cartDetails.id,
              status: cartDetails.status || 'active',
              expiry: cartExpiryDate,
              summary: {
                total: cartDetails.charges?.total || 0,
                currency: cartDetails.charges?.currency || 'USD',
                subtotal: cartDetails.charges?.subtotal || 0,
                fees: cartDetails.charges?.fees?.total || 0,
                taxes: cartDetails.charges?.taxes || 0,
                itemsCount: cartDetails.items?.length || 0,
                passengerCount: cartDetails.items?.reduce(
                  (sum, item) => sum + (item.passengers?.length || 0), 0
                ) || 0
              },
              items: cartDetails.items?.map((item, index) => ({
                itemNumber: index + 1,
                type: item.type || 'trip',
                segments: item.segments?.map(formatSegment) || [],
                passengers: item.passengers?.map(formatPassenger) || [],
                charges: item.charges?.map(formatCharge) || [],
                metadata: {
                  sellable: item.metadata?.sellable,
                  ticketType: item.ticket_types ? Object.values(item.ticket_types)[0] : 'unknown'
                }
              })) || [],
              charges: cartDetails.charges?.items?.map(formatCharge) || [],
              billing: {
                country: cartDetails.billing_address?.country_code || 'Not specified',
                paymentProvider: cartDetails.payment?.provider || 'Not specified'
              },
              metadata: {
                pollTtl: cartDetails.metadata?.ttl,
                pollInterval: cartDetails.metadata?.interval,
                cartExpiryDate // Also include in metadata for backward compatibility
              },
              _raw: cartDetails // Include full response at the end
            };

            logger.info('✅ Successfully verified cart state', { 
              cartId,
              status: cartDetails.status,
              response: JSON.stringify(formattedResponse, null, 2)
            });
            
            // Format console output for better readability
            console.log('\n=== CART VERIFICATION SUCCESS ===');
            console.log(`Cart ID: ${formattedResponse.cartId}`);
            console.log(`Status: ${formattedResponse.status}`);
            console.log('\n--- SUMMARY ---');
            console.log(`Total: ${formattedResponse.summary.total} ${formattedResponse.summary.currency}`);
            console.log(`Subtotal: ${formattedResponse.summary.subtotal} ${formattedResponse.summary.currency}`);
            console.log(`Fees: ${formattedResponse.summary.fees} ${formattedResponse.summary.currency}`);
            console.log(`Taxes: ${formattedResponse.summary.taxes} ${formattedResponse.summary.currency}`);
            console.log(`Items: ${formattedResponse.summary.itemsCount}`);
            console.log(`Passengers: ${formattedResponse.summary.passengerCount}`);

            // Display each item in the cart
            if (formattedResponse.items.length > 0) {
              console.log('\n--- ITEMS IN CART ---');
              formattedResponse.items.forEach((item, index) => {
                console.log(`\n${index + 1}. ${item.type.toUpperCase()} (${item.passengers.length} passengers)`);
                
                // Display segments (flights/trips)
                item.segments.forEach((segment, segIdx) => {
                  console.log(`   ${segIdx + 1}. ${segment.operator} (${segment.vehicle})`);
                  console.log(`      From: ${segment.origin} at ${segment.departure}`);
                  console.log(`      To:   ${segment.destination} at ${segment.arrival}`);
                  console.log(`      Seats available: ${segment.availableSeats || 'N/A'}`);
                });

                // Display passengers
                if (item.passengers.length > 0) {
                  console.log('   Passengers:');
                  item.passengers.forEach((pax, paxIdx) => {
                    console.log(`      ${paxIdx + 1}. ${pax.name} (${pax.category}${pax.wheelchair ? ', wheelchair' : ''})`);
                  });
                }
              });
            }

            // Display charges
            if (formattedResponse.charges.length > 0) {
              console.log('\n--- CHARGES ---');
              formattedResponse.charges.forEach((charge, idx) => {
                console.log(`${idx + 1}. ${charge.description}: ${charge.amount} ${charge.currency}`);
              });
            }

            console.log('\n--- BILLING ---');
            console.log(`Country: ${formattedResponse.billing.country}`);
            console.log(`Payment: ${formattedResponse.billing.paymentProvider}`);
            
            if (formattedResponse.metadata.pollTtl) {
              console.log(`\nNext poll before: ${formattedResponse.metadata.pollTtl}`);
            }
            
            if (cartExpiryDate) {
              console.log(`\nCart will expire on: ${cartExpiryDate.toLocaleString()} (${cartExpiryDate.toISOString()})`);
            }
            
            console.log('=== END CART VERIFICATION ===\n');
          } catch (pollError) {
            const errorDetails = {
              message: pollError.message,
              status: pollError.statusCode,
              ...(pollError.responseData && { response: pollError.responseData }),
              ...(pollError.stack && { stack: pollError.stack.split('\n').slice(0, 3).join('\n') })
            };
            
            logger.warn('⚠️ Failed to verify cart state after adding trip, using initial response', {
              cartId,
              tripId: tripsToAdd.map(t => t.id).join(','),
              error: errorDetails
            });
            // Continue with the original response if polling fails
          }
        }

        // Prepare trip data with details from API response
        // Clone the raw response to ensure it only contains plain JSON values, then
        // derive a minimal, Firestore-safe trip summary from it.
        const rawData = lastResponse.data || {};
        let safeRaw;
        try {
          safeRaw = JSON.parse(JSON.stringify(rawData));
        } catch (_) {
          safeRaw = {};
        }

        const tripData = {
          tripId: tripsToAdd.length === 1 ? tripsToAdd[0].id : 'multiple',
          addedAt: new Date().toISOString(),
          status: typeof safeRaw?.status === 'string' ? safeRaw.status : 'added',
          tripType: tripsToAdd.length > 1 ? 'multi-leg' : (tripsToAdd[0]?.type || 'oneway'),
          tripCount: tripsToAdd.length,
          currency: typeof safeRaw?.currency === 'string' ? safeRaw.currency : currency,
          operator: (typeof safeRaw?.operator === 'string'
            ? safeRaw.operator
            : (safeRaw?.operator && typeof safeRaw.operator.name === 'string' ? safeRaw.operator.name : null)),
          passengerCount: Array.isArray(passengerList) ? passengerList.length : 0,
          passengers: Array.isArray(passengerList)
            ? passengerList.map((p, index) => ({
                id: index + 1,
                category: p?.category || 'adult',
                wheelchair: !!p?.wheelchair,
                discountCount: Array.isArray(p?.discounts) ? p.discounts.length : 0
              }))
            : []
        };

        // Persist trip selection snapshot in Postgres (non-blocking)
        try {
          await db.insert(tripSelections).values({
            cartId: String(cartId),
            firestoreCartId: firestoreCartId ? String(firestoreCartId) : null,
            tripId: String(tripData.tripId),
            tripType: tripData.tripType,
            isRoundTrip: tripData.tripType === 'roundtrip' || tripData.tripType === 'multi-leg',
            passengerCount: tripData.passengerCount,
            currency: tripData.currency,
            raw: { ...(safeRaw || {}), agent: this.agentCtx || null }
          });
        } catch (dbError) {
          logger.error('Failed to persist trip selection in Postgres', {
            message: dbError.message,
            cartId,
            firestoreCartId,
            tripId: tripData.tripId
          });
        }

        // Read existing trips from Firestore so we can merge with the new ones
        let prevTripsArr = [];
        try {
          const existingDoc = await this.db.collection('carts').doc(String(firestoreCartId)).get();
          if (existingDoc.exists) {
            prevTripsArr = Array.isArray(existingDoc.data()?.trips) ? existingDoc.data().trips : [];
          }
        } catch (firestoreError) {
          logger.warn('[addTripToCart] Failed to load existing trips from Firestore; proceeding with empty list', {
            cartId,
            firestoreCartId,
            error: firestoreError.message
          });
        }

        const baseSeq = Array.isArray(prevTripsArr) ? prevTripsArr.length : 0;
        const newTripsArr = tripsToAdd.map((trip, index) => ({
              tripId: trip.id,
              type: trip.type || 'oneway',
              addedAt: new Date().toISOString(),
              status: 'added',
              passengers: trip.passengers || passengers,
              sequence: baseSeq + index + 1
            }));
        const seenTripIds = new Set(prevTripsArr.map(t => t.tripId));
        const mergedTrips = prevTripsArr.concat(newTripsArr.filter(t => !seenTripIds.has(t.tripId)));
        const cartData = {
            // Core identifiers
            cartId,  // Original cart ID
            busbudCartId: cartId,  // Explicit Busbud cart ID reference
            tripId: tripsToAdd.length === 1 ? tripsToAdd[0].id : 'multiple',
            firestoreCartId,
            lastVerified: new Date().toISOString(),
            
            // Add TTL for automatic document expiration
            expiresAt: cartExpiryDate || new Date(Date.now() + 3600 * 1000), // Default to 1 hour if no expiry
            ttl: cartExpiryDate ? Math.floor(cartExpiryDate.getTime() / 1000) : Math.floor((Date.now() + 3600 * 1000) / 1000), // Unix timestamp in seconds
            
            // Trip details - handle single or multiple trips
            trip: tripData,
            trips: mergedTrips,
            
            // Summary information
            summary: {
                currency: lastResponse.data?.currency || currency,
                passengerCount: Array.isArray(passengerList) ? passengerList.length : 0,
                tripCount: mergedTrips.length,
                totalPrice: lastResponse.data?.price?.total || 0,
                currency: lastResponse.data?.currency || currency,
                itemsCount: lastResponse.data?.items?.length || 0,
                lastUpdated: new Date().toISOString()
            },
            
            // API metadata
            apiMetadata: {
                locale,
                currency,
                apiVersion: lastResponse.config?.headers?.['Accept']?.match(/version=([^;]+)/)?.[1] || 'unknown',
                userAgent: lastResponse.config?.headers?.['User-Agent']
            },
            // Timestamp
            updatedAt: new Date().toISOString()
        };

        // Ensure firestoreCartId is a valid string for Firestore document ID
        const documentId = String(firestoreCartId).trim();
        if (!documentId) {
            throw new Error('Invalid firestoreCartId: cannot be empty');
        }
        
        const documentPath = `carts/${documentId}`;
        const cartRef = this.db.collection('carts').doc(documentId);
        
        // Set up TTL field for Firestore TTL policy
        const firestoreData = {
            ...cartData,
            _ttl: cartExpiryDate || new Date(Date.now() + 3600 * 1000) // Ensure we have a TTL field for Firestore
        };
        
        logger.debug('Preparing to save to Firestore', { 
            collection: 'carts',
            documentId: documentId,
            data: { 
                ...cartData, 
                trip: cartData.trip ? {
                    ...cartData.trip,
                    passengers: Array.isArray(cartData.trip.passengers) 
                        ? cartData.trip.passengers.map(p => ({
                            category: p?.category || 'adult',
                            wheelchair: !!p?.wheelchair,
                            discountCount: p?.discountCount || 0
                        }))
                        : []
                } : null
            }
        });
        const operationStartTime = Date.now();
        
        logger.info('🚀 Starting Firestore operation', {
            context: 'Firestore',
            operation: 'set',
            documentPath,
            data: {
                cartId: cartData.cartId,
                tripId: cartData.tripId,
                firestoreCartId: cartData.firestoreCartId,
                status: cartData.status,
                tripsCount: cartData.trips?.length || 0,
                passengersCount: cartData.trips?.[0]?.passengers?.length || 0
            },
            options: { merge: true },
            timestamp: new Date().toISOString()
        });

        try {
            const writeResult = await cartRef.set(firestoreData, { merge: true });
            const operationDuration = Date.now() - operationStartTime;
            
            // Also create a TTL document if it doesn't exist
            const ttlDocRef = this.db.collection('carts_ttl').doc(documentId);
            await ttlDocRef.set({
                cartId: documentId,
                expiresAt: firestoreData._ttl,
                createdAt: new Date().toISOString()
            }, { merge: true });
            
            logger.info('✅ Firestore operation successful', {
                context: 'Firestore',
                operation: 'set',
                documentPath,
                result: {
                    writeTime: writeResult?.writeTime?.toDate()?.toISOString() || 'N/A',
                    operationDuration: `${operationDuration}ms`,
                    documentSize: JSON.stringify(cartData).length,
                    timestamp: new Date().toISOString()
                },
                performance: {
                    totalDuration: `${Date.now() - startTime}ms`,
                    firestoreDuration: `${operationDuration}ms`
                }
            });
            
            return writeResult;
        } catch (error) {
            const errorDuration = Date.now() - operationStartTime;
            logger.error('❌ Firestore operation failed', {
                context: 'Firestore',
                operation: 'set',
                documentPath,
                error: {
                    message: error.message,
                    code: error.code,
                    details: error.details,
                    stack: error.stack
                },
                timing: {
                    failedAfter: `${errorDuration}ms`,
                    totalDuration: `${Date.now() - startTime}ms`
                },
                timestamp: new Date().toISOString()
            });
            throw error;
        }

        // Handle polling if needed
        if (lastResponse.data.metadata?.links?.poll) {
            logger.debug('Starting cart polling', { 
                pollUrl: lastResponse.data.metadata.links.poll,
                cartId,
                firestoreCartId
            });
            try {
                const pollResult = await this.pollCartUpdates(cartId, lastResponse.data.metadata.links.poll, locale, currency);
                // Update Firestore with polled data if available
                if (pollResult) {
                    const updateData = {
                        updatedAt: new Date().toISOString(),
                        status: pollResult.status || 'polled',
                        'busbudResponse.poll': pollResult,
                        'trips.0.status': pollResult.status,
                        'summary.totalPrice': pollResult.price?.total
                    };

                    await cartRef.update(updateData);

                    logger.info('Updated cart with polled data', {
                        cartId,
                        status: pollResult.status,
                        price: pollResult.price?.total
                    });
                }

                return {
                    ...lastResponse.data,
                    ...(pollResult || {}),
                    firestoreCartId,
                    cartId,
                    firestoreUpdated: true
                };
            } catch (pollError) {
                logger.error('Error during cart polling', {
                    error: pollError.message,
                    cartId,
                    firestoreCartId,
                    stack: pollError.stack
                });
                // Continue with the original response if polling fails
            }
        }

        // Return the complete response with our additions
        return {
            ...lastResponse.data,
            firestoreCartId,
            cartId,
            firestoreUpdated: true,
            _metadata: {
                storedInFirestore: true,
                timestamp: new Date().toISOString()
            }
        };

    } catch (error) {
        const errorContext = {
            ...logContext,
            error: error.message,
            stack: error.stack,
            response: {
                status: error.response?.status,
                data: error.response?.data
            },
            duration: `${Date.now() - startTime}ms`
        };

        if (error.code === 'resource-exhausted') {
            logger.error('Firestore quota exceeded', errorContext);
        } else if (error.code === 'permission-denied') {
            logger.error('Firestore permission denied', errorContext);
        } else {
            logger.error('Error in addTripToCart', errorContext);
        }

        // Re-throw with additional context and raw HTTP response attached
        const enhancedError = new Error(`Failed to add trip to cart: ${error.message}`);
        enhancedError.originalError = error;
        enhancedError.context = errorContext;
        if (error.response) enhancedError.response = error.response;
        enhancedError.errorType = error.response?.data?.error?.type;
        throw enhancedError;
    }
}

  async pollCartUpdates(cartId, pollUrl, locale = 'en-ca', currency = 'USD', maxRetries = 10) {
    let retries = 0;
    
    while (retries < maxRetries) {
      try {
        const response = await axios.get(pollUrl, {
          headers: {
            ...this.headers,
            'Accept': 'application/vnd.busbud+json; version=3; profile=https://schema.busbud.com/v3/anything.json',
            'User-Agent': 'busbud-website/1.0 (+http://www.busbud.com)'
          },
          timeout: 10000
        });

        const data = response.data;
        
        // If there's no more polling needed, return the cart data
        if (!data.metadata?.links?.poll) {
          // Ensure the returned cart object has the correct ID
          return {
            ...data,
            id: cartId  // Always use the original cart ID
          };
        }
        
        // Wait for the specified interval before polling again
        const interval = data.metadata?.interval || 1000;
        await new Promise(resolve => setTimeout(resolve, interval));
        
      } catch (error) {
        retries++;
        if (retries >= maxRetries) {
          throw new Error(`Failed to poll cart updates after ${maxRetries} attempts: ${error.message}`);
        }
        // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, retries)));
      }
    }
    
    throw new Error(`Failed to complete cart update after ${maxRetries} polling attempts`);
  }

  async removeFromCart(cartId, itemId) {
    try {
      if (!cartId) throw new Error('cartId is required');
      if (!itemId) throw new Error('itemId is required');

      const response = await axios.delete(
        `${this.baseUrl}/carts/${cartId}/items/${itemId}`,
        {
          headers: {
            ...this.headers,
            'Accept': 'application/vnd.busbud+json; version=3; profile=https://schema.busbud.com/v3/anything.json'
          },
          timeout: 10000
        }
      );

      return response.data;
    } catch (error) {
      const errorMessage = error.response?.data?.error?.message || error.message;
      const statusCode = error.response?.status;
      logger.error('Error removing from cart:', {
        status: statusCode,
        message: errorMessage,
        cartId,
        itemId,
        error: error.response?.data || error.message
      });
      throw new Error(`Failed to remove item from cart: ${errorMessage} (Status: ${statusCode || 'N/A'})`);
    }
  }

  async removeTrip(cartId, tripId) {
    try {
      if (!cartId) throw new Error('cartId is required');
      if (!tripId) throw new Error('tripId is required');

      const url = `${this.baseUrl}/carts/${encodeURIComponent(cartId)}/trips/${encodeURIComponent(tripId)}`;
      const response = await axios.delete(url, {
        headers: {
          ...this.headers,
          'Accept': 'application/vnd.busbud+json; version=3; profile=https://schema.busbud.com/v3/anything.json',
          'User-Agent': 'busbud-website/1.0 (+http://www.busbud.com)'
        },
        timeout: 15000,
        validateStatus: (status) => status < 500
      });

      if (response.status === 204) {
        return true;
      }
      if (response.status >= 200 && response.status < 300) {
        return true;
      }
      throw new Error(`Remove trip failed with status ${response.status}: ${response.statusText}`);
    } catch (error) {
      const errorMessage = error.response?.data?.error?.message || error.message;
      const statusCode = error.response?.status;
      logger.error('Error removing trip from cart:', {
        status: statusCode,
        message: errorMessage,
        cartId,
        tripId,
        error: error.response?.data || error.message
      });
      throw new Error(`Failed to remove trip from cart: ${errorMessage} (Status: ${statusCode || 'N/A'})`);
    }
  }

  async removeCartItem(cartId, itemId, locale = 'en', currency = 'USD') {
    try {
      if (!cartId) throw new Error('cartId is required');
      if (!itemId) throw new Error('itemId is required');

      const params = new URLSearchParams();
      if (locale) params.append('locale', locale);
      if (currency) params.append('currency', currency);

      const url = `${this.baseUrl}/carts/${encodeURIComponent(cartId)}/items/${encodeURIComponent(itemId)}?${params.toString()}`;
      const response = await axios.delete(url, {
        headers: {
          ...this.headers,
          'Accept': 'application/vnd.busbud+json; version=3; profile=https://schema.busbud.com/v3/anything.json',
          'User-Agent': 'busbud-website/1.0 (+http://www.busbud.com)'
        },
        timeout: 15000,
        validateStatus: (status) => status < 500
      });

      if (response.status === 204) return true;
      if (response.status >= 200 && response.status < 300) return true;
      throw new Error(`Remove cart item failed with status ${response.status}: ${response.statusText}`);
    } catch (error) {
      const errorMessage = error.response?.data?.error?.message || error.message;
      const statusCode = error.response?.status;
      logger.error('Error removing cart item:', {
        status: statusCode,
        message: errorMessage,
        cartId,
        itemId,
        error: error.response?.data || error.message
      });
      throw new Error(`Failed to remove cart item: ${errorMessage} (Status: ${statusCode || 'N/A'})`);
    }
  }

  /**
   * Get cart details
   * @param {string} cartId - The ID of the cart to get details for
   * @param {string} locale - Locale code (e.g., 'en-ca')
   * @param {string} currency - Currency code (e.g., 'USD')
   * @returns {Promise<Object>} The cart details
   */
  async getCart(cartId, locale = 'en-ca', currency = 'USD') {
    try {
      if (!cartId) throw new Error('cartId is required');

      const cacheKey = this.generateCartCacheKey('get', cartId, { locale, currency });
      const cached = await this.getCachedResponse(cacheKey);
      if (cached) {
        return cached;
      }

      const params = new URLSearchParams();
      params.append('locale', locale);
      if (currency) {
        params.append('currency', currency);
      }

      const response = await axios.get(
        `${this.baseUrl}/carts/${cartId}`,
        {
          headers: {
            ...this.headers,
            'Accept': 'application/vnd.busbud+json; version=3; profile=https://schema.busbud.com/v3/anything.json',
            'User-Agent': 'busbud-website/1.0 (+http://www.busbud.com)'
          },
          params,
          timeout: 10000
        }
      );

      // Cache successful responses for 1 minute
      await this.setCachedResponse(cacheKey, response.data, 60 * 1000);
      return response.data;
    } catch (error) {
      const errorMessage = error.response?.data?.error?.message || error.message;
      const statusCode = error.response?.status;
      logger.error('Error getting cart:', {
        status: statusCode,
        message: errorMessage,
        cartId,
        error: error.response?.data || error.message
      });

      if (error.response?.status === 404) {
        throw new Error('Cart not found');
      }
      
      throw new Error(`Failed to get cart: ${errorMessage} (Status: ${statusCode || 'N/A'})`);
    }
  }
 

  async pollCart(cartId, locale = 'en-ca', currency = 'USD', pollUrl = null) {
    let attempt = 0;
    const maxAttempts = 10; // Limit polling attempts to prevent infinite loops
    const maxTotalTime = 30000; // 30 second maximum total time
    const startTime = Date.now();

    console.log(`🔄 [POLLING START] Beginning cart polling for cart: ${cartId}`);
    console.log(`📊 [POLLING CONFIG] Max attempts: ${maxAttempts}, Max time: ${maxTotalTime}ms`);

    try {
      let url, config = {
        headers: {
          ...this.headers,
          'Accept': 'application/vnd.busbud+json; version=3; profile=https://schema.busbud.com/v3/anything.json',
          'User-Agent': 'busbud-website/1.0 (+http://www.busbud.com)'
        },
        timeout: 10000
      };

      if (pollUrl) {
        // For polling URLs, use them as-is
        url = pollUrl;
        console.log(`🔗 [POLLING MODE] Using provided poll URL: ${url.substring(0, 60)}...`);
      } else {
        // For initial request, build the URL with required parameters
        const baseUrl = this.baseUrl || 'https://napi-preview.busbud.com';
        const params = new URLSearchParams();

        // Ensure locale is properly set
        const effectiveLocale = locale || 'en-ca';
        params.append('locale', effectiveLocale);

        // Include currency if provided
        if (currency) {
          params.append('currency', currency);
        }

        url = `${baseUrl}/carts/${cartId}?${params.toString()}`;
        console.log(`🔗 [POLLING MODE] Initial request URL: ${url.substring(0, 60)}...`);
      }

      while (attempt < maxAttempts) {
        attempt++;
        const attemptStartTime = Date.now();

        // Check if we've exceeded max total time
        const elapsedTime = Date.now() - startTime;
        if (elapsedTime > maxTotalTime) {
          console.log(`⏰ [POLLING TIMEOUT] Exceeded maximum time limit (${maxTotalTime}ms) after ${attempt} attempts`);
          throw new Error(`Cart polling exceeded maximum time limit of ${maxTotalTime}ms`);
        }

        console.log(`🔄 [POLLING ATTEMPT ${attempt}/${maxAttempts}] Starting attempt... (${elapsedTime}ms elapsed)`);

        try {
          const response = await axios.get(url, config);

          // Check if we need to poll again
          const nextPollUrl = response.data?.metadata?.links?.poll;
          const interval = response.data.metadata?.interval || 2000;

          console.log(`✅ [POLLING SUCCESS] Attempt ${attempt} completed in ${Date.now() - attemptStartTime}ms`);
          console.log(`📊 [POLLING STATUS] Response status: ${response.status}`);
          console.log(`📦 [POLLING DATA] Items: ${response.data.items?.length || 0}, Passengers: ${response.data.passengers?.length || 0}`);

          if (nextPollUrl && attempt < maxAttempts) {
            const cappedInterval = Math.min(interval, 5000); // Cap interval at 5 seconds
            console.log(`🔄 [POLLING CONTINUE] Need to poll again in ${cappedInterval}ms`);
            console.log(`🔗 [POLLING NEXT] Next URL: ${nextPollUrl.substring(0, 60)}...`);
            console.log(`⏳ [POLLING WAIT] Waiting ${cappedInterval}ms before next attempt...`);
            await new Promise(resolve => setTimeout(resolve, cappedInterval));
            url = nextPollUrl; // Update URL for next iteration
            continue;
          }

          // If no more polling needed or we've reached max attempts, return the data
          console.log(`✅ [POLLING COMPLETE] No more polling needed after ${attempt} attempts`);
          console.log(`📈 [POLLING SUMMARY] Total time: ${elapsedTime}ms, Attempts: ${attempt}`);
          return response.data;

        } catch (error) {
          console.log(`❌ [POLLING ERROR] Attempt ${attempt} failed in ${Date.now() - attemptStartTime}ms`);

          // If this is a network error and we haven't exceeded max attempts, try again
          if (attempt < maxAttempts && (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT')) {
            console.log(`🔄 [POLLING RETRY] Network error (${error.code}), retrying in 1s...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
            continue;
          }

          // For other errors or if we've exceeded attempts, throw the error
          console.log(`🚨 [POLLING FAILED] Final failure after ${attempt} attempts`);
          throw error;
        }
      }

      // If we've exhausted all attempts
      const totalElapsed = Date.now() - startTime;
      console.log(`🚨 [POLLING EXHAUSTED] All ${maxAttempts} attempts used (${totalElapsed}ms total)`);
      throw new Error(`Cart polling failed after ${maxAttempts} attempts`);

    } catch (error) {
      const errorMessage = error.response?.data?.error?.details || error.message;
      const statusCode = error.response?.status;
      const errorDetails = {
        status: statusCode,
        message: `Failed to poll cart: ${errorMessage}`,
        requestUrl: error.config?.url,
        requestMethod: error.config?.method,
        requestParams: error.config?.params,
        totalAttempts: attempt,
        totalTime: Date.now() - startTime
      };

      console.log(`💥 [POLLING CRITICAL ERROR] ${errorMessage}`);
      console.log(`📋 [ERROR DETAILS] Status: ${statusCode}, Attempts: ${attempt}, Time: ${Date.now() - startTime}ms`);

      logger.error('Error polling cart:', errorDetails);
      throw new Error(`Cart polling failed: ${errorMessage} (Status: ${statusCode})`);
    }
  }

  /**
   * Updates the purchaser details for a specific cart
   * @param {string} cartId - The ID of the cart
   * @param {Object} purchaser - The purchaser details to update
   * @param {string} purchaser.first_name - First name of the purchaser
   * @param {string} purchaser.last_name - Last name of the purchaser
   * @param {string} purchaser.email - Email address of the purchaser
   * @param {string} purchaser.phone - Phone number of the purchaser (with country code, e.g., "+14385014388")
   * @param {boolean} [purchaser.opt_in_marketing=false] - Whether the purchaser opts in for marketing
   * @param {string} [locale='en-ca'] - Locale for the request
   * @returns {Promise<Object>} The updated purchaser details
   */
  async updatePurchaser(cartId, purchaser, locale = 'en-ca') {
    const startTime = Date.now();
    
    try {
      if (!cartId) throw new Error('cartId is required');
      if (!purchaser) throw new Error('Purchaser details are required');
  
      logger.debug('=== UPDATE PURCHASER REQUEST ===');
      logger.debug(`URL: ${this.baseUrl}/carts/${cartId}/purchaser`);
      logger.debug(`Cart ID: ${cartId}`);
      logger.debug(`Locale: ${locale}`);
      logger.debug(`Purchaser Details: ${JSON.stringify(purchaser, null, 2)}`);
  
      const requiredFields = ['first_name', 'last_name', 'email', 'phone'];
      const missingFields = requiredFields.filter(field => !purchaser[field]);
      if (missingFields.length > 0) {
        throw new Error(`Missing required purchaser fields: ${missingFields.join(', ')}`);
      }
  
      // Prepare the payload with purchaser object
      const payload = {
        purchaser: {
          first_name: purchaser.first_name,
          last_name: purchaser.last_name,
          email: purchaser.email,
          phone: purchaser.phone,
          opt_in_marketing: purchaser.opt_in_marketing
        }
      };
  
      logger.debug(`Request Payload: ${JSON.stringify(payload, null, 2)}`);
  
      const config = {
        headers: {
          ...this.headers,
          'Content-Type': 'application/json',
          'Accept': 'application/vnd.busbud+json; version=3; profile=https://schema.busbud.com/v3/purchaser.json',
          'User-Agent': 'busbud-website/1.0 (+http://www.busbud.com)'
        },
        timeout: 10000,
        params: { locale }
      };
  
      logger.debug(`Request Config: ${JSON.stringify(config, null, 2)}`);
  
      const response = await axios.put(
        `${this.baseUrl}/carts/${cartId}/purchaser`,
        payload,
        config
      );
      
      const duration = Date.now() - startTime;
      
      logger.info(`Update purchaser request completed in ${duration}ms`, {
        status: response.status,
        cartId,
        duration
      });
      
      // Log the API response
      logger.debug('[updatePurchaser] API response received');
      console.log('✅ updatePurchaser API response received');
      
      logger.debug('=== UPDATE PURCHASER RESPONSE ===');
      logger.debug(`Status: ${response.status}`);
      logger.debug(`Response Data: ${JSON.stringify(response.data, null, 2)}`);

      // Save purchaser details to Firestore under a separate field
      try {
        logger.debug('Saving purchaser details to Firestore...');
        
        // Save to Firestore with dataType='purchaser' to store in a separate field
        await this._saveToFirestore(
          'carts',
          cartId,
          {
            ...purchaser,
            updatedAt: new Date().toISOString()
          },
          'purchaser'  // This will store data under 'purchaserDetails' field
        );
        
        logger.info('Successfully saved purchaser details to Firestore');
      } catch (firestoreError) {
        // Log the error but don't fail the entire operation
        logger.error('Failed to save purchaser details to Firestore:', {
          error: firestoreError.message,
          stack: firestoreError.stack,
          cartId
        });
      }

      return response.data;
    } catch (error) {
      const errorContext = {
        cartId,
        error: error.message,
        stack: error.stack
      };
      
      if (error.response) {
        // The request was made and the server responded with a status code
        // that falls out of the range of 2xx
        errorContext.response = {
          status: error.response.status,
          statusText: error.response.statusText,
          data: error.response.data,
          headers: error.response.headers
        };
      } else if (error.request) {
        // The request was made but no response was received
        errorContext.request = {
          method: error.config?.method,
          url: error.config?.url,
          headers: error.config?.headers,
          data: error.config?.data
        };
      }
      
      const errorMessage = `Failed to update purchaser: ${error.message}`;
      logger.error(errorMessage, errorContext);
      
      // Create a new error with the same message but with the context attached
      const enhancedError = new Error(errorMessage);
      enhancedError.context = errorContext;
      throw enhancedError;
    }
  }
  

  async updateCart(cartId, updates, locale = 'en-ca') {
    try {
      if (!cartId) throw new Error('cartId is required');
      if (!updates || Object.keys(updates).length === 0) {
        throw new Error('No updates provided');
      }

      console.log(`[DEBUG] Updating cart ${cartId} with:`, updates);

      // First, update the cart with the new properties
      const response = await axios.patch(
        `${this.baseUrl}/carts/${cartId}`,
        updates,
        {
          headers: {
            ...this.headers,
            'Content-Type': 'application/json',
            'Accept': 'application/vnd.busbud+json; version=3; profile=https://schema.busbud.com/v3/anything.json',
            'User-Agent': 'busbud-website/1.0 (+http://www.busbud.com)'
          },
          timeout: 10000,
          params: { locale }
        }
      );

      // After updating, fetch the latest cart details with the updated currency
      return await this.getCart(cartId, locale, updates.currency);
    } catch (error) {
      const errorMessage = error.response?.data?.error?.message || error.message;
      const statusCode = error.response?.status;
      
      // Log detailed error information
      const requestHeaders = error.config?.headers ? {
        ...error.config.headers,
        'X-Busbud-Token': '***'
      } : undefined;

      const errorContext = {
        timestamp: new Date().toISOString(),
        status: statusCode,
        statusText: error.response?.statusText,
        code: error.code,
        message: errorMessage,
        cartId,
        request: {
          url: error.config?.url,
          method: error.config?.method,
          payload: error.config?.data ? {
            ...error.config.data,
            email: '***@***',
            phone: error.config.data.phone ? '***' + String(error.config.data.phone).slice(-4) : undefined
          } : undefined,
          headers: requestHeaders
        }
      };
      
      logger.error('Error updating cart:', errorContext);
      throw new Error(`Failed to update cart: ${errorMessage} (Status: ${statusCode || 'N/A'})`);
    }
  }

  /**
   * Update passenger details for a specific trip in the cart
   * @param {string} cartId - The ID of the cart
   * @param {string} tripId - The ID of the trip
   * @param {Object} params - Parameters for the request
   * @param {string} params.locale - Language/locale for the response (e.g., 'en-ca')
   * @param {string} params.currency - Currency code (e.g., 'USD', 'EUR')
   * @param {boolean} [params.savePassengerQuestionAnswers] - Whether to save passenger question answers
   * @param {Array} passengers - Array of passenger objects with their details
   * @param {Object} ticketTypes - Object mapping segment IDs to ticket types
   * @returns {Promise<Object>} The updated trip details
   */
  /**
   * Helper method to save data to Firestore (blocking)
   * @private
   * @param {string} collection - Collection name
   * @param {string} docId - Document ID
   * @param {Object} data - Data to save
   * @param {string} [mergeField] - Optional field name to merge data under
   * @throws {Error} If Firestore operation fails
   * @returns {Promise<void>}
   */
  /**
   * Saves data to Firestore with support for separate passenger and purchaser fields
   * @private
   * @param {string} collection - Collection name (e.g., 'carts')
   * @param {string} docId - Document ID (cart ID)
   * @param {Object} data - Data to save
   * @param {string} [dataType] - Type of data ('passenger' or 'purchaser')
   * @returns {Promise<boolean>} True if successful
   */
  async _saveToFirestore(collection, docId, data, dataType = 'passenger') {
    const startTime = Date.now();
    const operation = `update${dataType.charAt(0).toUpperCase() + dataType.slice(1)}Details`;
    const logContext = { 
      collection, 
      docId: docId ? `${docId.substring(0, 8)}...` : 'undefined',
      dataType,
      operation,
      dataSize: JSON.stringify(data).length 
    };
    
    // Log the start of the operation
    firestoreLogger.info(`Starting ${dataType} update for ${collection}/${docId}`, logContext);
    
    try {
      // Validate input
      if (!docId) {
        const errorMsg = 'Document ID is required';
        firestoreLogger.error(errorMsg, logContext);
        throw new Error(errorMsg);
      }

      // Initialize Firestore if not already done (centralized)
      if (!this.db) {
        firestoreLogger.debug('Initializing Firestore client', logContext);
        try {
          this.db = await getFirestore();
          firestoreLogger.debug('Firestore client initialized (singleton)', logContext);
        } catch (initError) {
          firestoreLogger.error('Failed to initialize Firestore client', {
            ...logContext,
            error: initError.message,
            stack: initError.stack
          });
          throw initError;
        }
      }

      const docRef = this.db.collection(collection).doc(docId);
      
      // Verify the document exists
      firestoreLogger.debug(`Checking if document ${docId} exists`, logContext);
      const docSnapshot = await docRef.get();
      
      if (!docSnapshot.exists) {
        const errorMsg = `Document ${docId} does not exist in collection ${collection}`;
        firestoreLogger.error(errorMsg, {
          ...logContext,
          status: 'not_found'
        });
        throw new Error(errorMsg);
      }

      // Prepare the update data based on data type
      const timestamp = new Date().toISOString();
      const fieldName = dataType === 'purchaser' ? 'purchaserDetails' : 'passengerDetails';
      const updateData = {
        [fieldName]: {
          ...data,
          updatedAt: timestamp
        },
        'updatedAt': timestamp,
        'lastUpdatedBy': operation
      };
      
      // Log the update operation
      firestoreLogger.info(`Updating ${fieldName} in ${collection}/${docId}`, {
        ...logContext,
        fieldName,
        updateData: updateData[fieldName],
        timestamp
      });
      
      const updateStart = Date.now();
      
      try {
        // Use update() to ensure we only update existing documents
        await docRef.update(updateData);

        // Previously mirrored cart updates to Postgres (upsertCartFromFirestore). Postgres cart mirroring has been removed.

        const operationTime = Date.now() - updateStart;
        const totalTime = Date.now() - startTime;
        
        // Log successful update
        firestoreLogger.info(`Successfully updated ${fieldName} in ${collection}/${docId}`, {
          ...logContext,
          status: 'success',
          operationTime: `${operationTime}ms`,
          totalTime: `${totalTime}ms`,
          documentId: docId,
          collection,
          fieldName,
          dataSize: JSON.stringify(updateData[fieldName]).length
        });
        
        return true;
      } catch (updateError) {
        const errorTime = Date.now() - updateStart;
        const totalTime = Date.now() - startTime;
        
        // Log detailed error information
        firestoreLogger.error(`Failed to update ${fieldName} in ${collection}/${docId}`, {
          ...logContext,
          status: 'error',
          error: {
            message: updateError.message,
            code: updateError.code,
            stack: updateError.stack
          },
          operationTime: `${errorTime}ms`,
          totalTime: `${totalTime}ms`,
          documentId: docId,
          collection,
          fieldName,
          updateData: updateData[fieldName]
        });
        
        // Don't throw the error, just log it
        return false;
      }
    } catch (error) {
      const totalTime = Date.now() - startTime;
      const errorContext = {
        ...logContext,
        status: 'error',
        error: {
          message: error.message,
          code: error.code,
          stack: error.stack
        },
        operation: 'saveToFirestore',
        totalTime: `${totalTime}ms`
      };
      
      // Log the error with appropriate level based on error type
      if (error.message.includes('does not exist')) {
        firestoreLogger.warn(`Document not found in ${collection}/${docId}`, errorContext);
      } else {
        firestoreLogger.error(`Error in _saveToFirestore: ${error.message}`, errorContext);
      }
      
      // Don't throw the error, just log it and return false
      return false;
    }
  }

  async _savePassengerSnapshotToPostgres(cartId, requestId) {
    try {
      if (!cartId) {
        return;
      }

      if (!this.db) {
        this.db = await getFirestore();
      }

      const firestoreCartId = this.firestoreCartId || await ensureFirestoreCartId(cartId);
      const cartRef = this.db.collection('carts').doc(String(firestoreCartId));
      const doc = await cartRef.get();

      if (!doc.exists) {
        logger.warn('Skipping Postgres persistence for passenger snapshot: Firestore cart not found', {
          cartId,
          firestoreCartId
        });
        return;
      }

      const data = doc.data() || {};
      const passengerDetails = data.passengerDetails || {};
      let passengers = [];
      if (Array.isArray(passengerDetails.rawPassengers) && passengerDetails.rawPassengers.length) {
        passengers = passengerDetails.rawPassengers;
      } else if (Array.isArray(passengerDetails.passengers) && passengerDetails.passengers.length) {
        passengers = passengerDetails.passengers;
      } else if (Array.isArray(data.passengers) && data.passengers.length) {
        passengers = data.passengers;
      }

      if (!passengers.length) {
        logger.warn('Skipping Postgres persistence for passenger snapshot: no passengers found', {
          cartId,
          firestoreCartId
        });
        return;
      }

      let purchaser =
        data.purchaserDetails ||
        data.purchaser ||
        (data.passengerDetails && data.passengerDetails.purchaser) ||
        null;

      if (!purchaser) {
        purchaser = {
          firstName: data.firstName || (data.passengerDetails && data.passengerDetails.firstName),
          lastName: data.lastName || (data.passengerDetails && data.passengerDetails.lastName),
          email: data.email || (data.passengerDetails && data.passengerDetails.email),
          phone: data.phone || (data.passengerDetails && data.passengerDetails.phone)
        };
      }

      const normalizedPurchaser = {
        first_name: purchaser.first_name || purchaser.firstName || null,
        last_name: purchaser.last_name || purchaser.lastName || null,
        email: purchaser.email || null,
        phone: purchaser.phone || null,
        opt_in_marketing:
          typeof purchaser.opt_in_marketing === 'boolean'
            ? purchaser.opt_in_marketing
            : !!purchaser.optInMarketing
      };

      const passengerCount = passengers.length;
      const tripId =
        passengerDetails.tripId ||
        data.tripId ||
        (data.trip && data.trip.tripId) ||
        null;

      const busbudCartId = data.busbudCartId || (cartId ? String(cartId) : null);

      const rawPayload = {
        passengerDetails,
        purchaserDetails: data.purchaserDetails || null,
        purchaser: normalizedPurchaser,
        busbudCartId,
        pricing_metadata:
          (data.passengerDetails && data.passengerDetails.pricing_metadata) ||
          data.pricing_metadata ||
          null
      };

      await db.insert(cartPassengerDetails).values({
        cartId: String(cartId),
        firestoreCartId: firestoreCartId ? String(firestoreCartId) : null,
        tripId: tripId ? String(tripId) : null,
        passengerCount,
        purchaserFirstName: normalizedPurchaser.first_name,
        purchaserLastName: normalizedPurchaser.last_name,
        purchaserEmail: normalizedPurchaser.email,
        purchaserPhone: normalizedPurchaser.phone,
        optInMarketing: normalizedPurchaser.opt_in_marketing,
        passengers,
        purchaser: normalizedPurchaser,
        raw: { ...(rawPayload || {}), agent: this.agentCtx || null }
      });
    } catch (error) {
      logger.warn('Failed to persist passenger/purchaser snapshot to Postgres', {
        cartId,
        firestoreCartId: this.firestoreCartId,
        message: error.message,
        requestId
      });
    }
  }

  async updateTripPassengers(cartId, tripId, { locale, currency, savePassengerQuestionAnswers }, passengers, ticketTypes) {
    const requestId = Math.random().toString(36).substring(2, 10);
    
    logger.info(`[${requestId}] Starting updateTripPassengers`, {
      cartId: cartId ? `${cartId.substring(0, 4)}...${cartId.slice(-4)}` : 'none',
      tripId: tripId ? `${tripId.substring(0, 4)}...${tripId.slice(-4)}` : 'none',
      passengerCount: passengers?.length || 0,
      hasTicketTypes: Boolean(ticketTypes && Object.keys(ticketTypes).length > 0)
    });

    try {
      if (!cartId || !tripId) {
        const errorMsg = `[${requestId}] Missing required parameters: ${!cartId ? 'cartId ' : ''}${!tripId ? 'tripId' : ''}`;
        logger.error(errorMsg);
        throw new Error(errorMsg);
      }

      if (!this.db) {
        this.db = await getFirestore();
      }

      const firestoreCartId = await ensureFirestoreCartId(cartId);
      this.firestoreCartId = firestoreCartId;

      const params = new URLSearchParams();
      params.append('locale', locale || 'en-ca');
      params.append('currency', currency || 'USD');
      
      if (savePassengerQuestionAnswers !== undefined) {
        params.append('save_passenger_question_answers', savePassengerQuestionAnswers);
      }

      const config = {
        headers: {
          ...this.headers,
          'Accept': 'application/vnd.busbud+json; version=3; profile=https://schema.busbud.com/v3/anything.json',
          'User-Agent': 'busbud-website/1.0 (+http://www.busbud.com)',
          'Content-Type': 'application/json',
          'X-Busbud-Token': this.headers['X-Busbud-Token']
        },
        params,
        timeout: 15000
      };

      // Log incoming passenger data
      logger.debug(`[${requestId}] Processing ${passengers.length} passengers`);
      
      // First create the request body with basic passenger info
      // Ensure ticket types cover all segments for this trip (outbound + return)
      let completeTicketTypes = { ...(ticketTypes || {}) };
      try {
        const cartDetails = await this.getCart(cartId, locale, currency);
        if (cartDetails && Array.isArray(cartDetails.items)) {
          const matchingItems = cartDetails.items.filter(it => it.trip_id === tripId);
          const itemsSource = matchingItems.length > 0 ? matchingItems : cartDetails.items;
          itemsSource.forEach(item => {
            // From segments array
            (item.segments || []).forEach(seg => {
              const segId = seg && seg.id;
              if (segId && !completeTicketTypes[segId]) {
                completeTicketTypes[segId] = 'eticket';
              }
            });
            // From item.ticket_types map
            if (item.ticket_types && typeof item.ticket_types === 'object') {
              Object.keys(item.ticket_types).forEach(segId => {
                if (segId && !completeTicketTypes[segId]) {
                  completeTicketTypes[segId] = 'eticket';
                }
              });
            }
            // From trip_legs.segment_ids
            if (Array.isArray(item.trip_legs)) {
              item.trip_legs.forEach(leg => {
                (leg.segment_ids || []).forEach(segId => {
                  if (segId && !completeTicketTypes[segId]) {
                    completeTicketTypes[segId] = 'eticket';
                  }
                });
              });
            }
          });
        }
      } catch (hydrateErr) {
        logger.warn(`[${requestId}] Unable to hydrate ticket_types from cart`, { error: hydrateErr.message });
      }

      const requestBody = {
        passengers: passengers.map((passenger, index) => {
          // Create passenger object first
          const p = {
            id: (() => {
              const id = passenger.id;
              if (typeof id === 'number' && !isNaN(id) && id > 0) {
                return id;
              }
              if (typeof id === 'string') {
                const numId = Number(id);
                if (!isNaN(numId) && numId > 0) {
                  return numId;
                }
                // Try to extract number from string
                const extracted = id.match(/\d+/) ? Number(id.match(/\d+/)[0]) : null;
                if (extracted && extracted > 0) {
                  return extracted;
                }
              }
              // Fallback to index + 1
              return index + 1;
            })(),
            first_name: passenger.firstName || passenger.first_name,  // Fix: handle both camelCase and snake_case
            last_name: passenger.lastName || passenger.last_name,     // Fix: handle both camelCase and snake_case
            wheelchair: passenger.wheelchair || false,
            discounts: passenger.discounts || [],
            phone: passenger.phone,
            selected_seats: passenger.selectedSeats || [],
            answers: passenger.answers || []
          };

          // Use passenger type from frontend directly
          const rawCategory = passenger.category || passenger.type || 'adult';
          let normalizedCategory = typeof rawCategory === 'string' ? rawCategory.toLowerCase() : 'adult';
          if (normalizedCategory === 'child' || normalizedCategory === 'children') {
            normalizedCategory = 'youth';
          }
          if (!['adult', 'youth', 'senior', 'pet'].includes(normalizedCategory)) {
            normalizedCategory = 'adult';
          }
          p.category = normalizedCategory;

          const ageValue = typeof passenger.age === 'number' ? passenger.age : 25;
          p.age = ageValue; // Required field with fallback

          logger.debug(`[${requestId}] Processing passenger ${index + 1}`, {
            id: passenger.id,
            name: `${passenger.firstName || passenger.first_name || ''} ${passenger.lastName || passenger.last_name || ''}`.trim(),
            rawCategory,
            normalizedCategory: p.category
          });

          logger.debug(`[${requestId}] Mapped passenger ${index + 1} to Busbud format`, {
            id: p.id,
            category: p.category,
            age: p.age,
            name: `${p.first_name} ${p.last_name}`.trim()
          });
          
          // Only include address if all required fields are present
          if (passenger.address) {
            if (passenger.address.address1 && 
                passenger.address.city && 
                passenger.address.postcode && 
                passenger.address.countryCode) {
              p.address = {
                address1: passenger.address.address1,
                address2: passenger.address.address2 || '',
                city: passenger.address.city,
                postcode: passenger.address.postcode,
                country_code: passenger.address.countryCode,
                province: passenger.address.province || ''
              };
              logger.debug(`[${requestId}] Added address for passenger ${passenger.id || index + 1}`);
            } else {
              logger.debug(`[${requestId}] Incomplete address for passenger ${passenger.id || index + 1}`, {
                hasAddress1: !!passenger.address.address1,
                hasCity: !!passenger.address.city,
                hasPostcode: !!passenger.address.postcode,
                hasCountryCode: !!passenger.address.countryCode
              });
            }
          }
          
          return p;
        }),
        ticket_types: completeTicketTypes
      };

      const endpoint = `/carts/${cartId}/trips/${tripId}`;
      // Log the request details before sending
      logger.info(`[${requestId}] Sending updateTripPassengers request`, {
        endpoint,
        cartId: `${cartId.substring(0, 4)}...${cartId.slice(-4)}`,
        tripId: `${tripId.substring(0, 4)}...${tripId.slice(-4)}`,
        passengerCount: passengers.length,
        requestBody: {
          passengerCount: requestBody.passengers.length,
          hasTicketTypes: Boolean(ticketTypes && Object.keys(ticketTypes).length > 0)
        }
      });

      // Log the actual request payload with enhanced formatting
      console.log('\n' + '='.repeat(60));
      console.log('🚀 BUSBUD API REQUEST - UPDATE TRIP PASSENGERS');
      console.log('='.repeat(60));
      console.log(`📍 Endpoint: ${this.baseUrl}${endpoint}`);
      console.log(`🛒 Cart ID: ${cartId}`);
      console.log(`🎫 Trip ID: ${tripId}`);
      console.log(`👥 Passengers: ${passengers.length}`);
      console.log(`🎟️  Ticket Types:`, JSON.stringify(completeTicketTypes, null, 2));
      console.log(`⚙️  Options:`, JSON.stringify({ locale, currency, savePassengerQuestionAnswers }, null, 2));
      console.log('\n📦 REQUEST PAYLOAD:');
      console.log(JSON.stringify(requestBody, null, 2));
      console.log('='.repeat(60) + '\n');

      const startTime = Date.now();
      const response = await axios.put(
        `${this.baseUrl}${endpoint}`,
        requestBody,
        config
      );
      const duration = Date.now() - startTime;

      // Log the response
      console.log('\n' + '='.repeat(60));
      console.log('✅ BUSBUD API RESPONSE - UPDATE TRIP PASSENGERS');
      console.log('='.repeat(60));
      console.log(`📍 Endpoint: ${this.baseUrl}${endpoint}`);
      console.log(`⏱️  Duration: ${duration}ms`);
      console.log(`📊 Status: ${response.status} ${response.statusText}`);
      logger.info(`[${requestId}] Successfully updated trip passengers`, {
        status: response.status,
        data: response.data
      });

      // Save the Busbud response to Firestore (blocking)
      const firestoreStartTime = Date.now();
      
      const documentId = firestoreCartId;
      const documentPath = `carts/${documentId}`;
      const cartRef = this.db.collection('carts').doc(documentId);

      logger.info(`[${requestId}] Starting Firestore save for updateTripPassengers`, {
        documentPath,
        operation: 'update',
        data: {
          passengerDetails: {
            tripId,
            passengers: requestBody.passengers,
            updatedAt: new Date().toISOString()
          },
          updatedAt: new Date().toISOString(),
          // Store the busbudCartId for reference
          busbudCartId: cartId
        }
      });

      try {
        // First verify the document exists
        const docSnapshot = await cartRef.get();
        if (!docSnapshot.exists) {
          logger.warn(`[${requestId}] Cart document not found, creating new document`, { documentPath });
          const createData = {
            cartId: documentId,
            firestoreCartId: this.firestoreCartId,
            busbudCartId: cartId,
            passengerDetails: {
              tripId,
              passengers: requestBody.passengers,
              rawPassengers: passengers,
              updatedAt: new Date().toISOString()
            },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            status: 'active',
            source: 'busbud',
            metadata: {
              createdBy: 'updateTripPassengers',
              lastUpdatedBy: 'updateTripPassengers'
            }
          };
          await cartRef.set(createData);
        } else {
          const updateData = {
            'passengerDetails': {
              tripId,
              passengers: requestBody.passengers,
              rawPassengers: passengers,
              updatedAt: new Date().toISOString()
            },
            'updatedAt': new Date().toISOString(),
            'busbudCartId': cartId,
            'metadata.lastUpdatedBy': 'updateTripPassengers'
          };
          await cartRef.update(updateData);
        }

        logger.info(`[${requestId}] Successfully updated passenger details in Firestore`, {
          documentPath,
          operationTime: `${Date.now() - firestoreStartTime}ms`
        });

        try {
          await db.insert(cartPassengerDetails).values({
            cartId: String(cartId),
            firestoreCartId: this.firestoreCartId ? String(this.firestoreCartId) : null,
            tripId: tripId ? String(tripId) : null,
            passengerCount: Array.isArray(passengers) ? passengers.length : 0,
            purchaserFirstName: null,
            purchaserLastName: null,
            purchaserEmail: null,
            purchaserPhone: null,
            optInMarketing: null,
            passengers,
            purchaser: null,
            raw: {
              passengerDetails: {
                tripId,
                passengers: requestBody.passengers,
                rawPassengers: passengers,
                busbudResponse: response.data,
                updatedAt: new Date().toISOString()
              },
              agent: this.agentCtx || null
            }
          });
        } catch (pgError) {
          logger.warn(`[${requestId}] Failed to persist passenger snapshot to Postgres`, {
            cartId,
            firestoreCartId: this.firestoreCartId,
            message: pgError.message
          });
        }
      } catch (firestoreError) {
        logger.error(`[${requestId}] Failed to save passenger details to Firestore`, {
          error: firestoreError.message,
          stack: firestoreError.stack,
          operationTime: `${Date.now() - firestoreStartTime}ms`
        });
        throw new Error(`Failed to save passenger details: ${firestoreError.message}`);
      }

      return response.data;
    } catch (error) {
      const logContext = {
        cartId: cartId ? `${cartId.substring(0, 4)}...${cartId.slice(-4)}` : 'undefined',
        tripId: tripId ? `${tripId.substring(0, 4)}...${tripId.slice(-4)}` : 'undefined',
        passengerCount: passengers ? passengers.length : 0,
        requestId: requestId || 'unknown'
      };

      const errorData = {
        message: error.message,
        stack: error.stack,
        responseData: error.response?.data,
        ...logContext
      };

      logger.error(`[${requestId}] Error in updateTripPassengers:`, errorData);

      if (error.response) {
        throw new Error(
          `Failed to update trip passengers: ${error.response.status} - ${JSON.stringify(error.response.data)}`
        );
      } else if (error.request) {
        throw new Error('No response received from the server while updating trip passengers');
      } else {
        throw new Error(`Error setting up request: ${error.message}`);
      }
    }
  }


  /**
   * Process charges to apply price adjustments
   * @param {Object} charges - The charges object from Busbud
   * @returns {Object} Processed charges with adjusted prices
   */
  _processCharges(charges) {
    if (!charges || !Array.isArray(charges.billed_totals) || charges.billed_totals.length === 0) {
      logger.warn('Invalid charges format - missing billed_totals array');
      return charges;
    }

    // Create a deep copy to avoid mutating the original
    const processedCharges = JSON.parse(JSON.stringify(charges));

    try {
      // Process each billed total in the array. Busbud provides amounts in cents,
      // so convert to currency units for adjustment, then convert back to cents
      // for storage.
      processedCharges.billed_totals = processedCharges.billed_totals.map(total => {
        if (!total || typeof total.amount !== 'number') return total;

        const originalAmountCents = total.amount;
        const currency = total.currency || charges.currency || 'USD';

        const baseUnits = originalAmountCents / 100;
        let adjustedUnits = baseUnits;
        try {
          const adjMeta = priceUtils.applyPriceAdjustments(baseUnits, {
            currency,
            returnMetadata: true
          });
          adjustedUnits = typeof adjMeta?.amount === 'number' ? adjMeta.amount : baseUnits;
        } catch (_) {
          adjustedUnits = baseUnits;
        }

        const adjustedAmountCents = Math.round(adjustedUnits * 100);
        const discountAmountCents = originalAmountCents - adjustedAmountCents;
        const discountPercentage = originalAmountCents > 0
          ? ((discountAmountCents / originalAmountCents) * 100)
          : 0;

        return {
          ...total,
          original_amount: originalAmountCents,
          amount: adjustedAmountCents,
          discount: {
            amount: discountAmountCents,
            percentage: discountPercentage,
            description:
              discountPercentage !== 0
                ? `${discountPercentage.toFixed(2)}% adjustment applied`
                : 'No adjustment applied',
            currency
          },
          metadata: {
            ...(total.metadata || {}),
            price_adjustment: {
              applied: true,
              percentage: discountPercentage,
              original_amount: originalAmountCents,
              adjusted_amount: adjustedAmountCents,
              adjusted_at: new Date().toISOString()
            }
          }
        };
      });

      // Process items array if it exists (amounts are also in cents)
      if (Array.isArray(processedCharges.items)) {
        const itemAmounts = processedCharges.items.map(item => (item && typeof item.amount === 'number' ? item.amount : null));
        const allNumeric = itemAmounts.every(v => typeof v === 'number');
        const originalTotalCents = (() => {
          if (typeof charges.total === 'number') return charges.total;
          if (typeof processedCharges.total === 'number') return processedCharges.total;
          const bt0 = Array.isArray(charges.billed_totals) ? charges.billed_totals[0] : null;
          if (bt0 && typeof bt0.amount === 'number') return bt0.amount;
          const pbt0 = Array.isArray(processedCharges.billed_totals) ? processedCharges.billed_totals[0] : null;
          if (pbt0 && typeof pbt0.amount === 'number') return pbt0.amount;
          return null;
        })();

        const currency = processedCharges.currency || charges.currency || 'USD';
        const adjustedTotalCents = (() => {
          if (originalTotalCents == null) return null;
          const baseUnits = originalTotalCents / 100;
          let adjustedUnits = baseUnits;
          try {
            const adjMeta = priceUtils.applyPriceAdjustments(baseUnits, {
              currency,
              returnMetadata: true
            });
            adjustedUnits = typeof adjMeta?.amount === 'number' ? adjMeta.amount : baseUnits;
          } catch (_) {
            adjustedUnits = baseUnits;
          }
          return Math.round(adjustedUnits * 100);
        })();

        const allocateByWeights = (totalCents) => {
          const n = itemAmounts.length;
          if (!n) return [];
          const total = Number(totalCents);
          if (!Number.isFinite(total)) return [];
          const weights = itemAmounts.map(v => Number(v) || 0);
          const sumWeights = weights.reduce((acc, v) => acc + v, 0);

          if (sumWeights <= 0) {
            const base = Math.floor(total / n);
            let rem = total - (base * n);
            return Array.from({ length: n }, (_, i) => base + (rem-- > 0 ? 1 : 0));
          }

          const raw = weights.map(w => (w / sumWeights) * total);
          const floored = raw.map(v => Math.floor(v));
          let rem = total - floored.reduce((acc, v) => acc + v, 0);
          const fracOrder = raw
            .map((v, i) => ({ i, frac: v - floored[i] }))
            .sort((a, b) => b.frac - a.frac);

          for (let k = 0; k < rem; k++) {
            const pick = fracOrder[k % fracOrder.length];
            floored[pick.i] += 1;
          }
          return floored;
        };

        if (allNumeric && originalTotalCents != null && adjustedTotalCents != null) {
          const originalAlloc = allocateByWeights(originalTotalCents);
          const adjustedAlloc = allocateByWeights(adjustedTotalCents);

          processedCharges.items = processedCharges.items.map((item, idx) => {
            const originalAmountCents = originalAlloc[idx];
            const adjustedAmountCents = adjustedAlloc[idx];
            const discountAmountCents = originalAmountCents - adjustedAmountCents;
            const discountPercentage = originalAmountCents > 0
              ? ((discountAmountCents / originalAmountCents) * 100)
              : 0;
            return {
              ...item,
              original_amount: originalAmountCents,
              amount: adjustedAmountCents,
              currency: item.currency || currency,
              metadata: {
                ...(item.metadata || {}),
                discount_applied: discountAmountCents !== 0,
                discount_percentage: discountPercentage,
                original_amount: originalAmountCents,
                adjusted_amount: adjustedAmountCents
              }
            };
          });
        }
      }

      // Update the total amount (still stored in cents)
      if (typeof processedCharges.total === 'number') {
        processedCharges.original_total = processedCharges.total;
        const currency = processedCharges.currency || charges.currency || 'USD';
        const baseUnits = processedCharges.total / 100;
        let adjustedUnits = baseUnits;
        try {
          const adjMeta = priceUtils.applyPriceAdjustments(baseUnits, {
            currency,
            returnMetadata: true
          });
          adjustedUnits = typeof adjMeta?.amount === 'number' ? adjMeta.amount : baseUnits;
        } catch (_) {
          adjustedUnits = baseUnits;
        }
        const adjustedTotalCents = Math.round(adjustedUnits * 100);
        processedCharges.total = adjustedTotalCents;
      }

      // Update subtotal if it exists (also in cents)
      if (typeof processedCharges.subtotal === 'number') {
        processedCharges.original_subtotal = processedCharges.subtotal;
        const currency = processedCharges.currency || charges.currency || 'USD';
        const baseUnits = processedCharges.subtotal / 100;
        let adjustedUnits = baseUnits;
        try {
          const adjMeta = priceUtils.applyPriceAdjustments(baseUnits, {
            currency,
            returnMetadata: true
          });
          adjustedUnits = typeof adjMeta?.amount === 'number' ? adjMeta.amount : baseUnits;
        } catch (_) {
          adjustedUnits = baseUnits;
        }
        const adjustedSubtotalCents = Math.round(adjustedUnits * 100);
        processedCharges.subtotal = adjustedSubtotalCents;
      }

      // Add metadata about the price adjustment
      processedCharges.metadata = {
        ...(processedCharges.metadata || {}),
        price_adjustment: {
          applied: true,
          percentage: charges.total && processedCharges.total
            ? ((charges.total - processedCharges.total) / charges.total) * 100
            : 0,
          adjusted_at: new Date().toISOString(),
          original_total: charges.total,
          adjusted_total: processedCharges.total,
          discount_amount: charges.total - processedCharges.total,
          currency: charges.currency || 'USD'
        }
      };

      logger.info('Successfully processed charges with dynamic price adjustment', {
        original_total: charges.total,
        adjusted_total: processedCharges.total,
        discount_amount: charges.total - processedCharges.total,
        currency: charges.currency || 'USD'
      });

      return processedCharges;
    } catch (error) {
      logger.error('Error processing charges:', error);
      // Return original charges if processing fails
      return charges;
    }
  }

  /**
   * Get the latest charges for a cart
   * @param {string} cartId - The ID of the cart to get charges for
   * @param {string} locale - Locale code (e.g., 'en-ca')
   * @param {string} currency - Currency code (e.g., 'USD')
   * @returns {Promise<Object>} The charges object containing billed_totals and other charge details
   */
  async getLatestCharges(cartId, locale = 'en-ca', currency = 'USD') {
    try {
      if (!cartId) throw new Error('cartId is required');
      
      const cacheKey = this.generateCartCacheKey('charges', cartId, { locale, currency });
      const cached = await this.getCachedResponse(cacheKey);
      if (cached) {
        return cached;
      }

      const params = new URLSearchParams();
      params.append('locale', locale);
      if (currency) {
        params.append('currency', currency);
      }

      const response = await axios.get(
        `${this.baseUrl}/carts/${cartId}/charges`,
        {
          headers: {
            ...this.headers,
            'Accept': 'application/vnd.busbud+json; version=3; profile=https://schema.busbud.com/v3/anything.json',
            'User-Agent': 'busbud-website/1.0 (+http://www.busbud.com)'
          },
          params,
          timeout: 10000
        }
      );

      // Cache successful responses for 1 minute
      await this.setCachedResponse(cacheKey, response.data, 60 * 1000);
      
      // Process the charges to apply price adjustments
      const processedCharges = this._processCharges(response.data);
      
      // Prepare the response data with both original and processed charges
      const responseData = {
        success: true,
        cartId,
        ...response.data, // Include original response
        cost_price: response.data,
        adjusted_charges: processedCharges, // Add processed charges
        retail_price: processedCharges,
        timestamp: new Date().toISOString()
      };

      try {
        const agentCtx = this.agentCtx && typeof this.agentCtx === 'object' ? this.agentCtx : null;
        await upsertCartFromBusbud(String(cartId), responseData, {
          firestoreCartId: this.firestoreCartId,
          status: 'processed',
          agentMode: agentCtx ? !!agentCtx.agentMode : null,
          agentId: agentCtx ? agentCtx.agentId : null,
          agentEmail: agentCtx ? agentCtx.agentEmail : null,
          agentName: agentCtx ? agentCtx.agentName : null,
          agent: agentCtx || null
        });
      } catch (_) {
        // ignore
      }

      // Save to Firestore if firestoreCartId is available (blocking operation)
      if (this.firestoreCartId && this.db) {
        const firestoreStartTime = Date.now();
        try {
          // Prepare the document data with proper structure. All core
          // monetary values remain in cents. Canonical totals are also
          // stored in cents for internal reuse.
          const canonicalOriginalTotalCents =
            typeof response.data.total === 'number' ? response.data.total : null;
          const canonicalAdjustedTotalCents =
            typeof processedCharges.total === 'number'
              ? processedCharges.total
              : canonicalOriginalTotalCents;

          const documentData = {
            busbudResponse: {
              charges: responseData,
              cost_price: response.data,
              retail_price: processedCharges,
              lastUpdated: new Date().toISOString()
            },
            agent: this.agentCtx || null,
            agentMode: this.agentCtx ? !!this.agentCtx.agentMode : null,
            agentId: this.agentCtx ? this.agentCtx.agentId : null,
            agentEmail: this.agentCtx ? this.agentCtx.agentEmail : null,
            agentName: this.agentCtx ? this.agentCtx.agentName : null,
            updatedAt: new Date().toISOString(),
            pricing_metadata: {
              adjustment_applied: true,
              adjustment_percentage: response.data.total && processedCharges.total
                ? ((response.data.total - processedCharges.total) / response.data.total) * 100
                : 0,
              adjusted_at: new Date().toISOString(),
              original_total: response.data.total,
              adjusted_total: processedCharges.total,
              discount_amount: response.data.total - processedCharges.total,
              currency: response.data.currency || 'USD',
              canonical_original_total_cents: canonicalOriginalTotalCents,
              canonical_adjusted_total_cents: canonicalAdjustedTotalCents
            },
            // Add top-level fields for easier querying
            cartId: cartId,
            firestoreCartId: this.firestoreCartId,
            status: 'processed',
            processedAt: new Date().toISOString()
          };

          logger.debug('Saving charges to Firestore:', {
            cartId,
            firestoreCartId: this.firestoreCartId,
            original_total: response.data.total,
            adjusted_total: processedCharges.total
          });

          // Save to Firestore
          const saveResult = await this._saveToFirestore(
            'carts',
            this.firestoreCartId,
            documentData,
            'charges'
          );
          
          if (saveResult === false) {
            throw new Error('Failed to save to Firestore');
          }
          
          const duration = Date.now() - firestoreStartTime;
          logger.info(`Successfully saved charges to Firestore for cart ${cartId}`, {
            firestoreCartId: this.firestoreCartId,
            cartId,
            duration: `${duration}ms`,
            timestamp: new Date().toISOString()
          });

        } catch (firestoreError) {
          const duration = Date.now() - firestoreStartTime;
          // Log the error and rethrow to make it blocking
          logger.error('Failed to save charges to Firestore', {
            cartId,
            firestoreCartId: this.firestoreCartId,
            error: firestoreError.message,
            stack: firestoreError.stack,
            duration: `${duration}ms`,
            timestamp: new Date().toISOString()
          });
          throw new Error(`Failed to save charges to Firestore: ${firestoreError.message}`);
        }
      } else {
        logger.warn('Skipping Firestore save - missing firestoreCartId or Firestore not initialized', {
          hasFirestoreCartId: !!this.firestoreCartId,
          hasFirestore: !!this.db,
          cartId
        });
      }
      
      return responseData;
      
    } catch (error) {
      const errorMessage = error.response?.data?.error?.message || error.message;
      const statusCode = error.response?.status;
      
      logger.error(`Failed to get latest charges for cart ${cartId}`, {
        status: statusCode,
        message: errorMessage,
        cartId,
        error: error.response?.data || error.message,
        stack: error.stack
      });
      
      if (error.response?.status === 404) {
        throw new Error('Cart not found');
      }
      
      throw new Error(`Failed to get latest charges: ${errorMessage} (Status: ${statusCode || 'N/A'})`);
    }
  }

  /**
   * Update cart charges with the latest prices
   * @param {string} cartId - The ID of the cart to update charges for
   * @param {Object} charges - The charges to update
   * @param {string} locale - Locale code (e.g., 'en-ca')
   * @param {string} currency - Currency code (e.g., 'USD')
   * @returns {Promise<Object>} The updated charges object
   */
  async putLatestCharges(cartId, charges, locale = 'en-ca', currency = 'USD') {
    try {
      if (!cartId) throw new Error('cartId is required');
      if (!charges || typeof charges !== 'object') {
        throw new Error('Valid charges object is required');
      }

      const params = new URLSearchParams();
      params.append('locale', locale);
      if (currency) {
        params.append('currency', currency);
      }

      const response = await axios.put(
        `${this.baseUrl}/carts/${cartId}/charges`,
        charges,
        {
          headers: {
            ...this.headers,
            'Content-Type': 'application/json',
            'Accept': 'application/vnd.busbud+json; version=3; profile=https://schema.busbud.com/v3/anything.json',
            'User-Agent': 'busbud-website/1.0 (+http://www.busbud.com)'
          },
          params,
          timeout: 10000
        }
      );

      // Invalidate the cached charges for this cart by setting a very short TTL (1ms)
      const cacheKey = this.generateCartCacheKey('charges', cartId, { locale, currency });
      await this.setCachedResponse(cacheKey, null, 1);
      
      // Log the updated charges for debugging
      logger.info(`Updated charges for cart ${cartId}`, {
        cartId,
        charges: response.data,
        timestamp: new Date().toISOString()
      });
      
      return {
        success: true,
        cartId,
        ...response.data,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      const errorMessage = error.response?.data?.error?.message || error.message;
      const statusCode = error.response?.status;
      
      logger.error(`Failed to update charges for cart ${cartId}`, {
        status: statusCode,
        message: errorMessage,
        cartId,
        error: error.response?.data || error.message,
        stack: error.stack
      });
      
      if (error.response?.status === 404) {
        throw new Error('Cart not found');
      } else if (error.response?.status === 400) {
        throw new Error(`Invalid charges data: ${errorMessage}`);
      }
      
      throw new Error(`Failed to update charges: ${errorMessage} (Status: ${statusCode || 'N/A'})`);
    }
  }

  /**
   * Create a purchase for the given cart
   * @param {string} cartId - The ID of the cart to create purchase for
   * @param {Object} options - Purchase options (locale, currency, returnUrl, skipValidation)
   * @param {string} options.locale - Locale code (e.g., 'en-ca')
   * @param {string} options.currency - Currency code (e.g., 'USD')
   * @param {string} options.returnUrl - Return URL for payment
   * @param {boolean} options.skipValidation - Skip cart validation (default: false)
   * @returns {Promise<Object>} The purchase response from Busbud API
   */
  async createPurchase(cartId, options = {}) {
    const { locale = 'en-ca', currency = 'USD', returnUrl, skipValidation = false } = options;
    const requestId = `purchase-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const startTime = Date.now();
    
    logger.info(`[${requestId}] 🛒 STARTING PURCHASE PROCESS`, {
      step: 'purchase_initialization',
      cartId: cartId ? `${cartId.substring(0, 4)}...${cartId.slice(-4)}` : 'none',
      locale,
      currency,
      skipValidation,
      timestamp: new Date().toISOString(),
      memoryUsage: process.memoryUsage().rss / 1024 / 1024 + 'MB'
    });
    
    // Input validation
    logger.debug(`[${requestId}] 🔍 Validating input parameters`, {
      step: 'input_validation',
      hasCartId: !!cartId,
      options: { locale, currency, skipValidation }
    });

    if (!cartId) {
      const error = new Error('cartId is required');
      logger.error(`[${requestId}] ❌ VALIDATION FAILED: ${error.message}`, {
        step: 'input_validation',
        error: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString()
      });
      return {
        success: false,
        error: error.message,
        status: 'validation_error',
        requestId,
        timestamp: new Date().toISOString()
      };
    }

    if (skipValidation) {
      logger.info(`[${requestId}] ⚡ SKIPPING CART VALIDATION - DIRECT PURCHASE`, {
        step: 'purchase_validation',
        reason: 'skipValidation flag is set to true',
        timestamp: new Date().toISOString()
      });
      
      const returnUrlValue = returnUrl || `${process.env.FRONTEND_URL || 'https://your-app.com'}/purchase/confirmation`;
      const payload = {
        cart_id: cartId,
        locale,
        currency,
        payment: {
          provider: 'iou',
          return_url: returnUrlValue
        }
      };
      
      logger.debug(`[${requestId}] 📦 Prepared purchase payload`, {
        step: 'payload_preparation',
        payload: {
          ...payload,
          cart_id: payload.cart_id ? `${payload.cart_id.substring(0, 4)}...${payload.cart_id.slice(-4)}` : 'none',
          payment: {
            ...payload.payment,
            return_url: returnUrlValue
          }
        },
        timestamp: new Date().toISOString()
      });

      const headers = {
        ...this.headers,
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.busbud+json; version=3; profile=https://schema.busbud.com/v3/anything.json',
        'User-Agent': 'uniglade/1.0',
        'X-Request-ID': requestId,
        'X-Busbud-Token': process.env.BUSBUD_API_KEY || this.headers['X-Busbud-Token']
      };
      
      logger.debug(`[${requestId}] 📡 Prepared request headers`, {
        step: 'request_preparation',
        headers: {
          ...headers,
          'X-Busbud-Token': headers['X-Busbud-Token'] ? '***REDACTED***' : 'MISSING',
          'Content-Type': headers['Content-Type'],
          'Accept': headers['Accept'],
          'X-Request-ID': headers['X-Request-ID']
        },
        timestamp: new Date().toISOString()
      });

      try {
        logger.info(`[${requestId}] 📤 Sending purchase request to Busbud API`, {
          url: `${this.baseUrl}/purchases`,
          payload: {
            ...payload,
            cart_id: payload.cart_id ? `${payload.cart_id.substring(0, 4)}...${payload.cart_id.slice(-4)}` : 'none'
          }
        });

        const response = await axios.post(
          `${this.baseUrl}/purchases`,
          payload,
          { 
            headers, 
            timeout: 30000, // 30 seconds timeout
            validateStatus: (status) => status >= 200 && status < 500
          }
        );

        const duration = Date.now() - startTime;
        
        if (response.status >= 400) {
          const errorMessage = response.data?.error?.message || 'Unknown error';
          logger.error(`[${requestId}] ❌ Purchase creation failed`, {
            status: response.status,
            error: errorMessage,
            response: response.data,
            durationMs: duration
          });
          
          return {
            success: false,
            error: `Busbud API error: ${errorMessage}`,
            status: 'api_error',
            statusCode: response.status,
            requestId,
            durationMs: duration
          };
        }

        logger.info(`[${requestId}] ✅ Purchase created successfully`, {
          purchaseId: response.data?.id,
          status: response.data?.status,
          durationMs: duration
        });

        // Save purchase to Firestore if configured
        if (this.firestoreCartId && this.db) {
          try {
            const purchaseData = {
              ...response.data,
              cartId,
              firestoreCartId: this.firestoreCartId,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              status: response.data.status || 'created',
              metadata: {
                source: 'busbud',
                createdBy: 'createPurchase',
                requestId,
                timestamp: new Date().toISOString()
              }
            };
            
            await this._saveToFirestore('carts', this.firestoreCartId, { purchase: purchaseData }, 'purchase');
            
            logger.info(`[${requestId}] 💾 Saved purchase to Firestore`, {
              firestoreCartId: this.firestoreCartId,
              purchaseId: response.data.id
            });
          } catch (firestoreError) {
            logger.error(`[${requestId}] ⚠️ Failed to save purchase to Firestore`, {
              error: firestoreError.message,
              stack: firestoreError.stack,
              firestoreCartId: this.firestoreCartId
            });
            // Continue even if Firestore save fails
          }
        }
        
        return {
          success: true,
          data: response.data,
          status: response.data.status || 'created',
          requestId,
          durationMs: duration
        };
        
      } catch (error) {
        const duration = Date.now() - startTime;
        const errorMessage = error.response?.data?.error?.message || error.message;
        const statusCode = error.response?.status || 500;
        
        logger.error(`[${requestId}] 🚨 Purchase creation failed with error`, {
          error: errorMessage,
          status: statusCode,
          stack: error.stack,
          durationMs: duration,
          response: error.response?.data
        });
        
        return {
          success: false,
          error: errorMessage,
          status: 'error',
          statusCode,
          requestId,
          durationMs: duration
        };
      }
    } else {
      // Use the existing validation flow
      logger.info(`[${requestId}] 🔄 Using cart validation flow`);
      try {
        const cartDetails = await this.getCartDetails(cartId, locale, currency, returnUrl);
        return {
          success: true,
          data: cartDetails,
          status: cartDetails.status || 'created',
          requestId,
          durationMs: Date.now() - startTime
        };
      } catch (error) {
        const errorMessage = error.response?.data?.error?.message || error.message;
        const statusCode = error.response?.status;
        
        logger.error(`[${requestId}] ❌ Cart validation failed`, {
          error: errorMessage,
          stack: error.stack,
          statusCode,
          cartId: cartId ? `${cartId.substring(0, 4)}...${cartId.slice(-4)}` : 'none',
          response: error.response?.data
        });
        
        return {
          success: false,
          error: errorMessage,
          status: 'validation_error',
          statusCode,
          requestId,
          durationMs: Date.now() - startTime
        };
      }
    }
  }

  /**
   * Get cart details
   * @param {string} cartId - The ID of the cart to get details for
   * @param {string} locale - Locale code (e.g., 'en-ca')
   * @param {string} currency - Currency code (e.g., 'USD')
   * @returns {Promise<Object>} The cart details
   */
  async getCart(cartId, locale = 'en-ca', currency = 'USD') {
    try {
      if (!cartId) throw new Error('cartId is required');

      const cacheKey = this.generateCartCacheKey('get', cartId, { locale, currency });
      const cached = await this.getCachedResponse(cacheKey);
      if (cached) {
        return cached;
      }

      const params = new URLSearchParams();
      params.append('locale', locale);
      if (currency) {
        params.append('currency', currency);
      }

      const response = await axios.get(
        `${this.baseUrl}/carts/${cartId}`,
        {
          headers: {
            ...this.headers,
            'Accept': 'application/vnd.busbud+json; version=3; profile=https://schema.busbud.com/v3/anything.json',
            'User-Agent': 'busbud-website/1.0 (+http://www.busbud.com)'
          },
          params,
          timeout: 10000
        }
      );

      // Cache successful responses for 1 minute
      await this.setCachedResponse(cacheKey, response.data, 60 * 1000);
      return response.data;
    } catch (error) {
      const errorMessage = error.response?.data?.error?.message || error.message;
      const statusCode = error.response?.status;
      logger.error('Error getting cart:', {
        status: statusCode,
        message: errorMessage,
        cartId,
        error: error.response?.data || error.message
      });

      if (error.response?.status === 404) {
        throw new Error('Cart not found');
      }
      
      throw new Error(`Failed to get cart: ${errorMessage} (Status: ${statusCode || 'N/A'})`);
    }
  }

  /**
   * Get cart details with polling support
   * @param {string} cartId - The ID of the cart to get details for
   * @param {string} locale - Locale code (e.g., 'en-ca')
   * @param {string} currency - Currency code (e.g., 'USD')
   * @param {string} returnUrl - Return URL for payment (optional)
   * @returns {Promise<Object>} The cart details
   */
  async getCartDetails(cartId, locale = 'en-ca', currency = 'USD', returnUrl = 'https://your-app.com/purchase/confirmation') {
    const requestStartTime = Date.now();

    try {
      if (!cartId) throw new Error('cartId is required');

      console.log('\n=== BUSBUD PURCHASE REQUEST ===');
      console.log(`🔹 Cart ID: ${cartId}`);
      console.log(`🔹 Endpoint: ${this.baseUrl}/purchases`);

      // Get current cart details to extract billed_totals
      console.log('📋 Fetching current cart details...');
      const cartDetails = await this.getCart(cartId, locale, currency);
      const billedTotals = cartDetails.charges?.billed_totals;
      
      if (!billedTotals || !Array.isArray(billedTotals)) {
        throw new Error('Unable to retrieve billed_totals from cart. Cart may not be ready for purchase.');
      }

      const payload = {
        cart_id: cartId,
        billed_totals: billedTotals,
        locale,
        currency,
        payment: {
          provider: 'iou',
          return_url: returnUrl || 'https://your-app.com/purchase/confirmation'
        }
      };

      const headers = {
        ...this.headers,
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.busbud+json; version=3; profile=https://schema.busbud.com/v3/anything.json',
        'User-Agent': 'busbud-website/1.0 (+http://www.busbud.com)',
        'X-Busbud-Token': process.env.BUSBUD_API_KEY || this.headers['X-Busbud-Token']
      };

      console.log('\n--- DEBUG PURCHASE REQUEST ---');
      console.log('URL:', `${this.baseUrl}/purchases`);
      console.log('Headers:', JSON.stringify(headers, null, 2));
      console.log('Payload:', JSON.stringify(payload, null, 2));
      console.log('--- END DEBUG ---\n');

      const response = await axios.post(
        `${this.baseUrl}/purchases`,
        payload,
        { headers, timeout: 45000 }
      );

      console.log('✅ Purchase created successfully!');
      console.log('Response:', JSON.stringify(response.data, null, 2));
      
      // Save purchase to Firestore for the non-validation flow
      if (this.firestoreCartId && this.db) {
        try {
          const purchaseData = {
            ...response.data,
            cartId,
            firestoreCartId: this.firestoreCartId,
            createdAt: new Date().toISOString(),
            status: 'created',
            metadata: {
              source: 'busbud',
              createdBy: 'createPurchase',
              timestamp: new Date().toISOString()
            }
          };
          
          await this._saveToFirestore('carts', this.firestoreCartId, { purchase: purchaseData }, 'purchase');
          
          logger.info(`[${requestId}] Successfully saved purchase to Firestore (non-validation flow)`, {
            cartId: cartId ? `${cartId.substring(0, 4)}...${cartId.slice(-4)}` : 'none',
            firestoreCartId: this.firestoreCartId,
            purchaseId: response.data.id
          });
        } catch (firestoreError) {
          logger.error(`[${requestId}] Failed to save purchase to Firestore (non-validation flow)`, {
            error: firestoreError.message,
            stack: firestoreError.stack,
            cartId: cartId ? `${cartId.substring(0, 4)}...${cartId.slice(-4)}` : 'none',
            firestoreCartId: this.firestoreCartId
          });
        }
      }
      
      return response.data;

    } catch (error) {
      const duration = Date.now() - requestStartTime;
      console.error(`\n❌ Error after ${duration}ms`);

      // Handle different error scenarios
      if (error.response) {
        if (error.response.status === 410) {
          console.warn('⚠️ Cart expired. Cannot refresh for purchase endpoint.');
          throw new Error('Cart has expired and cannot be refreshed for purchase. Please create a new cart.');
        }
        
        if (error.response.status === 303) {
          console.log('📋 A booked purchase already exists for this cart');
          return { status: 'already_booked', message: 'A purchase already exists for this cart' };
        }
        
        if (error.response.status === 409) {
          console.warn('⚠️ Conflict - price may have changed');
          throw new Error('Purchase conflict detected. Price may have changed. Please refresh cart and try again.');
        }
        
        console.error('Response:', error.response.data);
        throw new Error(`Purchase failed (${error.response.status}): ${JSON.stringify(error.response.data)}`);
      } else if (error.request) {
        throw new Error('No response from Busbud API. Check network.');
      } else {
        throw new Error(`Request setup failed: ${error.message}`);
      }
    }
  }

  /**
   * Get purchase status for polling
   * This endpoint should be called every 3-5 seconds until the purchase is either successfully booked or failed
   * @param {number} purchaseId - The ID of the Purchase to query (required)
   * @param {string} purchaseUuid - The purchase UUID for authentication if no private token is provided (optional)
   * @returns {Promise<Object>} The purchase status response
   */
  async getPurchaseStatus(purchaseId, purchaseUuid = null) {
    if (!purchaseId) throw new Error('purchaseId is required');

    console.log('\n=== BUSBUD GET PURCHASE STATUS ===');
    console.log(`🔹 Purchase ID: ${purchaseId}`);
    console.log(`🔹 Purchase UUID: ${purchaseUuid || 'Not provided'}`);

    try {
      // Build query parameters
      const params = new URLSearchParams();
      if (purchaseUuid) {
        params.append('purchase_uuid', purchaseUuid);
      }

      const queryString = params.toString();
      const url = `${this.baseUrl}/purchases/${purchaseId}/status${queryString ? `?${queryString}` : ''}`;

      const headers = {
        'Accept': 'application/vnd.busbud+json; version=3; profile=https://schema.busbud.com/v3/anything.json',
        'User-Agent': 'busbud-website/1.0 (+http://www.busbud.com)',
        'X-Busbud-Token': this.headers['X-Busbud-Token']
      };

      console.log('\n--- DEBUG GET PURCHASE STATUS REQUEST ---');
      console.log('URL:', url);
      console.log('Headers:', JSON.stringify(headers, null, 2));
      console.log('--- END DEBUG ---\n');

      const response = await axios.get(url, {
        headers,
        timeout: 15000,
        validateStatus: (status) => status < 500 // Don't reject on any status code
      });

      const duration = Date.now() - (response.config.startTime || Date.now());
      console.log(`✅ Purchase status retrieved in ${duration}ms`);
      console.log('Response:', JSON.stringify(response.data, null, 2));

      return response.data;

    } catch (error) {
      const duration = Date.now() - (error.config?.startTime || Date.now());
      console.error(`\n❌ Error after ${duration}ms`);

      if (error.response) {
        if (error.response.status === 404) {
          throw new Error(`Purchase with ID ${purchaseId} not found`);
        }
        if (error.response.status === 401) {
          throw new Error('Unauthorized access to purchase status');
        }
        if (error.response.status === 403) {
          throw new Error('Forbidden access to purchase status');
        }

        console.error('Response:', error.response.data);
        throw new Error(`Failed to get purchase status (${error.response.status}): ${JSON.stringify(error.response.data)}`);
      } else if (error.request) {
        throw new Error('No response from Busbud API. Check network.');
      } else {
        throw new Error(`Request setup failed: ${error.message}`);
      }
    }
  }
  async getPurchase(purchaseId, purchaseUuid = null) {
    if (!purchaseId) throw new Error('purchaseId is required');

    console.log('\n=== BUSBUD GET PURCHASE ===');
    console.log(`🔹 Purchase ID: ${purchaseId}`);
    console.log(`🔹 Purchase UUID: ${purchaseUuid || 'Not provided'}`);

    try {
      // Build query parameters
      const params = new URLSearchParams();
      if (purchaseUuid) {
        params.append('purchase_uuid', purchaseUuid);
      }

      const queryString = params.toString();
      const url = `${this.baseUrl}/purchases/${purchaseId}${queryString ? `?${queryString}` : ''}`;

      const headers = {
        'Accept': 'application/vnd.busbud+json; version=3; profile=https://schema.busbud.com/v3/anything.json',
        'User-Agent': 'busbud-website/1.0 (+http://www.busbud.com)',
        'X-Busbud-Token': this.headers['X-Busbud-Token']
      };

      console.log('\n--- DEBUG GET PURCHASE REQUEST ---');
      console.log('URL:', url);
      console.log('Headers:', JSON.stringify(headers, null, 2));
      console.log('--- END DEBUG ---\n');

      const response = await axios.get(url, {
        headers,
        timeout: 15000,
        validateStatus: (status) => status < 500 // Don't reject on any status code
      });

      const duration = Date.now() - (response.config.startTime || Date.now());
      console.log(`✅ Purchase retrieved in ${duration}ms`);
      console.log('Response:', JSON.stringify(response.data, null, 2));

      // Save complete purchase to Firestore if we have a valid user ID and Firestore instance
      if (this.firestoreCartId && this.db) {
        try {
          const purchaseData = {
            ...response.data,
            retrievedAt: new Date().toISOString(),
            status: response.data.status || 'retrieved',
            metadata: {
              source: 'busbud',
              savedBy: 'getPurchase',
              timestamp: new Date().toISOString()
            }
          };

          // Process prices to include both original and adjusted prices
          if (purchaseData.items) {
            purchaseData.items = purchaseData.items.map(item => {
              // If we have charges, check for adjusted prices
              if (item.charges && item.charges.length > 0) {
                item.charges = item.charges.map(charge => {
                  // If this is a price adjustment, store the original price
                  if (charge.type === 'price_adjustment' && charge.original_amount) {
                    return {
                      ...charge,
                      originalAmount: charge.original_amount,
                      adjustedAmount: charge.amount,
                      isAdjusted: true,
                      adjustmentType: 'discount', // or 'surcharge' if applicable
                      adjustmentValue: charge.original_amount - charge.amount
                    };
                  }
                  return charge;
                });
              }
              return item;
            });
          }

          // Save to Firestore with both original and adjusted prices
          await this._saveToFirestore('carts', this.firestoreCartId, { 
            completePurchase: purchaseData,
            pricing: {
              originalTotal: purchaseData.summary?.total || 0,
              adjustedTotal: purchaseData.summary?.total || 0, // Will be updated below if we have adjustments
              currency: purchaseData.summary?.currency || 'USD',
              adjustments: [],
              lastUpdated: new Date().toISOString()
            }
          }, 'completePurchase');

          // If we have adjusted prices, update the totals
          const allCharges = purchaseData.items.flatMap(item => item.charges || []);
          const adjustments = allCharges.filter(charge => charge.isAdjusted);
          
          if (adjustments.length > 0) {
            const totalAdjustment = adjustments.reduce((sum, adj) => sum + (adj.adjustmentValue || 0), 0);
            const originalTotal = purchaseData.summary?.total || 0;
            const adjustedTotal = Math.max(0, originalTotal + totalAdjustment); // Ensure total doesn't go below 0
            
            // Update the pricing information
            await this._saveToFirestore('carts', this.firestoreCartId, { 
              pricing: {
                originalTotal,
                adjustedTotal,
                currency: purchaseData.summary?.currency || 'USD',
                adjustments: adjustments.map(adj => ({
                  type: adj.adjustmentType,
                  value: adj.adjustmentValue,
                  description: adj.description || 'Price adjustment',
                  timestamp: new Date().toISOString()
                })),
                lastUpdated: new Date().toISOString()
              }
            }, 'pricing');
            
            // Update the purchase data with adjusted total
            purchaseData.summary = {
              ...purchaseData.summary,
              originalTotal,
              adjustedTotal,
              totalAdjustment
            };
            
            logger.info('Applied price adjustments to cart', {
              cartId: this.firestoreCartId,
              originalTotal,
              adjustedTotal,
              totalAdjustment,
              adjustmentCount: adjustments.length
            });
          }
        
          logger.info(`Successfully saved complete purchase to Firestore`, {
            purchaseId: purchaseId,
            firestoreCartId: this.firestoreCartId,
            status: purchaseData.status
          });
        } catch (firestoreError) {
          // Log the error but don't fail the operation
          logger.error('Failed to save complete purchase to Firestore', {
            error: firestoreError.message,
            stack: firestoreError.stack,
            purchaseId: purchaseId,
            firestoreCartId: this.firestoreCartId
          });
        }
      } else {
        logger.warn('Skipping Firestore save - missing firestoreCartId or Firestore not initialized', {
          hasfirestoreCartId: !!this.firestoreCartId,
          hasFirestore: !!this.db,
          purchaseId: purchaseId
        });
      }

      return response.data;

    } catch (error) {
      const duration = Date.now() - (error.config?.startTime || Date.now());
      console.error(`\n❌ Error after ${duration}ms`);

      if (error.response) {
        if (error.response.status === 404) {
          throw new Error(`Purchase with ID ${purchaseId} not found`);
        }
        if (error.response.status === 401) {
          throw new Error('Unauthorized access to purchase details');
        }
        if (error.response.status === 403) {
          throw new Error('Forbidden access to purchase details');
        }

        console.error('Response:', error.response.data);
        throw new Error(`Failed to get purchase (${error.response.status}): ${JSON.stringify(error.response.data)}`);
      } else if (error.request) {
        throw new Error('No response from Busbud API. Check network.');
      } else {
        throw new Error(`Request setup failed: ${error.message}`);
      }
    }
  }

  /**
   * Update purchaser details for the cart
   * @param {string} cartId - The ID of the cart
   * @param {Object} purchaser - Purchaser details object
   * @param {string} purchaser.first_name - First name
   * @param {string} purchaser.last_name - Last name
   * @param {string} purchaser.email - Email address
   * @param {string} purchaser.phone - Phone number
   * @param {boolean} purchaser.opt_in_marketing - Marketing opt-in
   * @returns {Promise<Object>} The updated purchaser details
   */
  /**
   * Update purchaser details for a cart
   * @param {string} cartId - The cart ID from Busbud
   * @param {Object} purchaser - The purchaser details
   * @param {string} [firestoreCartId] - Optional user ID to use as Firestore document ID
   * @returns {Promise<Object>} The updated purchaser details
   */
  async updatePurchaserDetails(cartId, purchaser, firestoreCartId = null) {
    const requestId = Math.random().toString(36).substring(2, 10);

    logger.info(`[${requestId}] Starting updatePurchaserDetails`, {
      cartId: cartId ? `${cartId.substring(0, 4)}...${cartId.slice(-4)}` : 'none',
      purchaserName: `${purchaser.first_name} ${purchaser.last_name}`
    });

    try {
      if (!cartId || !purchaser) {
        throw new Error('cartId and purchaser are required');
      }

      const params = new URLSearchParams({
        locale: 'en-US',
        currency: 'USD'
      });

      const config = {
        headers: {
          ...this.headers,
          'Accept': 'application/vnd.busbud+json; version=3; profile=https://schema.busbud.com/v3/anything.json',
          'User-Agent': 'busbud-website/1.0 (+http://www.busbud.com)',
          'Content-Type': 'application/json',
          'X-Busbud-Token': this.headers['X-Busbud-Token']
        },
        params,
        timeout: 15000
      };

      const requestBody = {
        purchaser: {
          first_name: purchaser.first_name,
          last_name: purchaser.last_name,
          email: purchaser.email,
          phone: purchaser.phone,
          opt_in_marketing: purchaser.opt_in_marketing
        }
      };

      const endpoint = `/carts/${cartId}/purchaser`;

      // Log the actual request payload for purchaser details
      console.log('\n' + '='.repeat(60));
      console.log('🚀 BUSBUD API REQUEST - UPDATE PURCHASER DETAILS');
      console.log('='.repeat(60));
      console.log(`📍 Endpoint: ${this.baseUrl}/carts/${cartId}/purchaser`);
      console.log(`🛒 Cart ID: ${cartId}`);
      console.log('\n📦 REQUEST PAYLOAD:');
      console.log(JSON.stringify(requestBody, null, 2));
      console.log('='.repeat(60) + '\n');

      const response = await axios.put(
        `${this.baseUrl}${endpoint}`,
        requestBody,
        config
      );

      // Log the response
      console.log('\n' + '='.repeat(60));
      console.log('✅ BUSBUD API RESPONSE - UPDATE PURCHASER DETAILS');
      console.log('='.repeat(60));
      console.log(`📍 Endpoint: ${this.baseUrl}/carts/${cartId}/purchaser`);
      console.log(`📊 Status: ${response.status} ${response.statusText}`);
      console.log('\n📦 RESPONSE DATA:');
      console.log(JSON.stringify(response.data, null, 2));
      console.log('='.repeat(60) + '\n');

      try {
        const upsertPurchaserPayload =
          (response.data && response.data.purchaser) ||
          (response.data && response.data.data && response.data.data.purchaser) ||
          response.data ||
          purchaser;
        await upsertCartPurchaserFromBusbud(String(cartId), upsertPurchaserPayload);
      } catch (_) {
        // ignore
      }

      logger.info(`[${requestId}] Successfully updated purchaser details`, {
        cartId: `${cartId.substring(0, 4)}...${cartId.slice(-4)}`,
        status: response.status,
        statusText: response.statusText
      });

      return response.data;
    } catch (error) {
      logger.error(`[${requestId}] Error updating purchaser details:`, {
        message: error.message,
        cartId,
        status: error.response?.status,
        responseData: error.response?.data
      });

      if (error.response) {
        throw new Error(
          `Failed to update purchaser details: ${error.response.status} - ${JSON.stringify(error.response.data)}`
        );
      } else if (error.request) {
        throw new Error('No response received from the server while updating purchaser details');
      } else {
        throw new Error(`Error setting up request: ${error.message}`);
      }
    }
  }
}

export default new BusbudService();
