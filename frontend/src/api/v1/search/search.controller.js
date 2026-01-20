import axios from 'axios';
import ApiError from '../../../utils/apiError.js';
import logger from '../../../utils/logger.js';
import { cache } from '../../../utils/cache.js';
import { promisify } from 'util';

const sleep = promisify(setTimeout);

// Cache TTL in seconds
const CACHE_TTL = 3600; // 1 hour

/**
 * Search for available trips between locations
 */
export const searchTrips = async (req, res, next) => {
  try {
    const { from, to, date, passengers = 1 } = req.query;
    
    // Create a cache key based on search parameters
    const cacheKey = `search:${from}:${to}:${date}:${passengers}`;
    
    // Try to get cached results first
    const cachedResults = await cache.get(cacheKey);
    if (cachedResults) {
      return res.status(200).json({
        status: 'success',
        fromCache: true,
        data: cachedResults
      });
    }

    // If not in cache, fetch from the bus API
    const busApiUrl = process.env.BUS_API_URL || 'https://api.busprovider.com/v1';
    const apiKey = process.env.BUS_API_KEY;
    
    if (!apiKey) {
      throw new ApiError(500, 'Bus API configuration is missing');
    }

    // Make request to the bus API
    const response = await axios.get(`${busApiUrl}/search`, {
      params: {
        origin: from,
        destination: to,
        departureDate: date,
        passengers: parseInt(passengers, 10),
      },
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
      },
    });

    // Cache the results
    if (response.data && response.data.trips) {
      await cache.set(cacheKey, response.data, CACHE_TTL);
    }

    res.status(200).json({
      status: 'success',
      fromCache: false,
      data: response.data
    });
  } catch (error) {
    logger.error('Search error:', error);
    next(
      new ApiError(
        error.response?.status || 500,
        error.response?.data?.message || 'Error searching for trips'
      )
    );
  }
};

/**
 * Get details for a specific trip
 */
export const getTripDetails = async (req, res, next) => {
  try {
    const { tripId } = req.params;
    const { date } = req.query;
    
    if (!tripId || !date) {
      throw new ApiError(400, 'Trip ID and date are required');
    }

    const cacheKey = `trip:${tripId}:${date}`;
    const cachedTrip = await cache.get(cacheKey);
    
    if (cachedTrip) {
      return res.status(200).json({
        status: 'success',
        fromCache: true,
        data: cachedTrip
      });
    }

    const busApiUrl = process.env.BUS_API_URL || 'https://api.busprovider.com/v1';
    const response = await axios.get(`${busApiUrl}/trips/${tripId}`, {
      params: { date },
      headers: {
        'Authorization': `Bearer ${process.env.BUS_API_KEY}`,
        'Accept': 'application/json',
      },
    });

    // Cache the trip details
    if (response.data) {
      await cache.set(cacheKey, response.data, CACHE_TTL);
    }

    res.status(200).json({
      status: 'success',
      fromCache: false,
      data: response.data
    });
  } catch (error) {
    next(
      new ApiError(
        error.response?.status || 500,
        error.response?.data?.message || 'Error fetching trip details'
      )
    );
  }
};

/**
 * Get available seats for a specific trip
 */
export const getAvailableSeats = async (req, res, next) => {
  try {
    const { tripId } = req.params;
    const { date } = req.query;
    
    if (!tripId || !date) {
      throw new ApiError(400, 'Trip ID and date are required');
    }

    const cacheKey = `seats:${tripId}:${date}`;
    const cachedSeats = await cache.get(cacheKey);
    
    if (cachedSeats) {
      return res.status(200).json({
        status: 'success',
        fromCache: true,
        data: cachedSeats
      });
    }

    const busApiUrl = process.env.BUS_API_URL || 'https://api.busprovider.com/v1';
    const response = await axios.get(`${busApiUrl}/trips/${tripId}/seats`, {
      params: { date },
      headers: {
        'Authorization': `Bearer ${process.env.BUS_API_KEY}`,
        'Accept': 'application/json',
      },
    });

    // Cache the seats data with a shorter TTL (15 minutes) as seat availability changes frequently
    if (response.data) {
      await cache.set(cacheKey, response.data, 900);
    }

    res.status(200).json({
      status: 'success',
      fromCache: false,
      data: response.data
    });
  } catch (error) {
    next(
      new ApiError(
        error.response?.status || 500,
        error.response?.data?.message || 'Error fetching available seats'
      )
    );
  }
};

/**
 * Get available locations (cities, terminals, etc.)
 */
export const getLocations = async (req, res, next) => {
  try {
    const { query } = req.query;
    const cacheKey = `locations:${query || 'all'}`;
    
    // Try to get from cache first
    const cachedLocations = await cache.get(cacheKey);
    if (cachedLocations) {
      return res.status(200).json({
        status: 'success',
        fromCache: true,
        data: cachedLocations
      });
    }

    // If not in cache, fetch from the bus API
    const busApiUrl = process.env.BUS_API_URL || 'https://api.busprovider.com/v1';
    const response = await axios.get(`${busApiUrl}/locations`, {
      params: { query },
      headers: {
        'Authorization': `Bearer ${process.env.BUS_API_KEY}`,
        'Accept': 'application/json',
      },
    });

    // Cache the locations
    if (response.data) {
      await cache.set(cacheKey, response.data, 86400); // Cache for 24 hours
    }

    res.status(200).json({
      status: 'success',
      fromCache: false,
      data: response.data
    });
  } catch (error) {
    next(
      new ApiError(
        error.response?.status || 500,
        error.response?.data?.message || 'Error fetching locations'
      )
    );
  }
};

/**
 * Poll for search results (for long-running searches)
 */
export const pollSearchResults = async (req, res, next) => {
  try {
    const { searchId } = req.params;
    const maxAttempts = 10;
    const pollInterval = 2000; // 2 seconds
    
    // Check cache first
    const cachedResults = await cache.get(`search:poll:${searchId}`);
    if (cachedResults) {
      return res.status(200).json({
        status: 'success',
        complete: true,
        data: cachedResults
      });
    }

    // If not in cache, poll the API
    const busApiUrl = process.env.BUS_API_URL || 'https://api.busprovider.com/v1';
    let attempts = 0;
    let results = null;

    while (attempts < maxAttempts) {
      try {
        const response = await axios.get(`${busApiUrl}/search/${searchId}`, {
          headers: {
            'Authorization': `Bearer ${process.env.BUS_API_KEY}`,
            'Accept': 'application/json',
          },
        });

        if (response.data.status === 'complete') {
          results = response.data;
          // Cache the complete results
          await cache.set(`search:poll:${searchId}`, results, 3600); // Cache for 1 hour
          break;
        }
      } catch (error) {
        // If it's a 404, the search might not be ready yet
        if (error.response?.status !== 404) {
          throw error;
        }
      }

      attempts++;
      if (attempts < maxAttempts) {
        await sleep(pollInterval);
      }
    }

    if (!results) {
      throw new ApiError(408, 'Search timed out');
    }

    res.status(200).json({
      status: 'success',
      complete: true,
      data: results
    });
  } catch (error) {
    next(
      new ApiError(
        error.response?.status || 500,
        error.response?.data?.message || 'Error polling search results'
      )
    );
  }
};
