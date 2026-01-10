import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import BusbudService from '../services/busbud.service.mjs';
import { logger } from '../utils/logger.js';

const router = express.Router();
const activeRequests = new Map();

router.post('/select', async (req, res) => {
  const requestId = `${Date.now()}-${uuidv4().substring(0, 8)}`;
  const startTime = Date.now();
  
  logger.info(`[${requestId}] [START] /api/trips/select`, {
    timestamp: new Date().toISOString(),
    method: req.method,
    url: req.originalUrl,
    headers: {
      'content-type': req.get('content-type'),
      'user-agent': req.get('user-agent'),
      'x-request-id': requestId
    },
    body: {
      ...req.body,
      // Mask sensitive data if present
      paymentInfo: req.body.paymentInfo ? '***MASKED***' : undefined
    }
  });

  try {
    const { tripId } = req.body;

    // 1. Validate required fields
    if (!tripId) {
      const error = new Error('tripId is required');
      logger.error(`[${requestId}] Validation failed`, {
        error: error.message,
        requestBody: req.body,
        requiredFields: ['tripId']
      });
      throw error;
    }

   
    // 3. Use composite key (tripId + optional returnTripId) for request dedupe
    const compositeKey = req.body.returnTripId ? `${tripId}_${req.body.returnTripId}` : tripId;
    const requestKey = `select_${compositeKey}`;
    if (activeRequests.has(requestKey)) {
      const errorMessage = 'Duplicate request detected';
      logger.warn(`[${requestId}] ${errorMessage}`, {
        requestKey,
        activeRequests: Array.from(activeRequests.keys())
      });
      return res.status(429).json({
        success: false,
        error: errorMessage,
        requestId,
        responseTime: Date.now() - startTime
      });
    }

    activeRequests.set(requestKey, true);
    logger.debug(`[${requestId}] Added to active requests`, { requestKey });

    // Always create a NEW Busbud cart for this selection (one-way or round-trip)
    const hasReturn = Boolean(req.body.returnTripId);
    let cartIdToUse = null;
    let cartResponse = await BusbudService.createCart(req.body?.currency || "USD");
    cartIdToUse = cartResponse.id;
    logger.info(`[${requestId}] Cart created successfully`, { 
      cartId: cartResponse.id,
      response: {
        id: cartResponse.id,
        status: cartResponse.status,
        itemsCount: cartResponse.items?.length || 0
      },
      timing: {
        elapsed: `${Date.now() - startTime}ms`,
        timestamp: new Date().toISOString()
      }
    });

    // 5. Add trip to cart with correct passenger count
    const adultCount = parseInt(req.body.passengers?.adults || 1);
    const childCount = parseInt(req.body.passengers?.children || 0);
    const childAges = Array.isArray(req.body.passengers?.childrenAges)
      ? req.body.passengers.childrenAges
      : [];
    const defaultAdultAge = typeof req.body.passengers?.adultAge === 'number'
      ? req.body.passengers.adultAge
      : 30;

    // Create passenger array based on the count from request
    const passengers = [];

    // Add adult passengers
    for (let i = 0; i < adultCount; i++) {
      passengers.push({
        category: 'adult',
        age: defaultAdultAge,
        wheelchair: false,
        discounts: [],
        count: adultCount // Include count for backward compatibility
      });
    }

    // Add child passengers if any
    for (let i = 0; i < childCount; i++) {
      const age = typeof childAges[i] === 'number' ? childAges[i] : 10;
      passengers.push({
        category: 'youth',
        age,
        wheelchair: false,
        discounts: [],
        count: childCount // Include count for backward compatibility
      });
    }
    
    const returnTripId = req.body.returnTripId;

    if (returnTripId) {
      // We already created a fresh cart above; use it for both legs of the round trip
      logger.info(`[${requestId}] Using newly created cart for round trip`, { cartId: cartIdToUse });

      logger.debug(`[${requestId}] Adding outbound leg to cart`, {
        cartId: cartIdToUse,
        outboundTripId: tripId,
        passengerCount: passengers.length,
        adults: adultCount,
        children: childCount
      });

      let firstLegResp;
      try {
        firstLegResp = await BusbudService.addTripToCart(
          cartIdToUse,
          tripId,
          passengers
        );
      } catch (err) {
        const errType = err?.response?.data?.error?.type || err?.errorType || err?.context?.response?.data?.error?.type;
        const status = err?.response?.status;
        if (errType === 'CartNotSet' || status === 404 || /Cart not found/i.test(err?.message || '')) {
          logger.warn(`[${requestId}] Provided cart is invalid or expired for round trip`, { cartId: cartIdToUse, errType, status });
          return res.status(410).json({
            success: false,
            error: 'Provided busbudCartId is invalid or has expired. Please create a new cart and retry.',
            requestId,
            responseTime: Date.now() - startTime
          });
        }
        throw err;
      }

      // If service switched carts (e.g., due to CartNotSet), adopt the new cartId
      cartIdToUse = firstLegResp.cartId || cartIdToUse;

      // Fetch the same cart before adding the return leg
      await BusbudService.getCart(cartIdToUse, 'en-ca', req.body?.currency || 'USD');

      logger.debug(`[${requestId}] Adding return leg to same cart`, {
        cartId: cartIdToUse,
        returnTripId,
        passengerCount: passengers.length
      });

      let secondLegResp;
      try {
        secondLegResp = await BusbudService.addTripToCart(
          cartIdToUse,
          returnTripId,
          passengers
        );
      } catch (err) {
        const errType = err?.response?.data?.error?.type || err?.errorType || err?.context?.response?.data?.error?.type;
        if (errType === 'CartNotSet') {
          logger.warn(`[${requestId}] Return leg failed with CartNotSet. Retrying once on the SAME cart after short delay`, { cartId: cartIdToUse });
          await new Promise(r => setTimeout(r, 600));
          await BusbudService.getCart(cartIdToUse, 'en-ca', req.body?.currency || 'USD');
          secondLegResp = await BusbudService.addTripToCart(
            cartIdToUse,
            returnTripId,
            passengers
          );
        } else {
          throw err;
        }
      }

      const finalCartIdRt = secondLegResp.cartId || cartIdToUse;
      logger.info(`[${requestId}] Successfully added both legs to the same cart`, {
        cartId: finalCartIdRt,
        outboundTripId: tripId,
        returnTripId,
        itemsCount: secondLegResp.items?.length || 0
      });

      return res.json({
        success: true,
        cartId: finalCartIdRt,
        busbudCartId: finalCartIdRt,
        requestId,
        responseTime: Date.now() - startTime,
        status: secondLegResp.status || 'active',
        itemsCount: secondLegResp.items?.length || 0,
        tripCount: 2,
        isRoundTrip: true,
        trip: {
          tripType: 'roundtrip',
          trips: [
            { id: tripId, type: 'outbound' },
            { id: returnTripId, type: 'return' }
          ]
        }
      });
    }

    logger.debug(`[${requestId}] Adding trip to cart`, {
      cartId: cartIdToUse,
      tripId,
      passengerCount: passengers.length,
      adults: adultCount,
      children: childCount
    });

    let cartWithTrip;
    try {
      cartWithTrip = await BusbudService.addTripToCart(
        cartIdToUse,
        tripId,
        passengers
      );
    } catch (err) {
      const errType = err?.response?.data?.error?.type || err?.context?.response?.data?.error?.type;
      if (errType === 'CartNotSet') {
        logger.warn(`[${requestId}] Provided cart invalid (CartNotSet). Creating a new cart and retrying`, {
          providedCartId: cartIdToUse
        });
        const newCart = await BusbudService.createCart(req.body?.currency || "USD");
        cartIdToUse = newCart.id;
        await BusbudService.getCart(cartIdToUse, 'en-ca', req.body?.currency || 'USD');
        cartWithTrip = await BusbudService.addTripToCart(
          cartIdToUse,
          tripId,
          passengers
        );
      } else {
        throw err;
      }
    }

    const finalCartIdOw = cartWithTrip.cartId || cartIdToUse;
    logger.info(`[${requestId}] Successfully added trip to cart`, {
      cartId: finalCartIdOw,
      tripId,
      status: cartWithTrip.status,
      itemsCount: cartWithTrip.items?.length || 0,
      passengerCount: passengers.length
    });

    return res.json({
      success: true,
      cartId: finalCartIdOw,
      busbudCartId: finalCartIdOw,
      requestId,
      responseTime: Date.now() - startTime,
      status: cartWithTrip.status || 'active',
      itemsCount: cartWithTrip.items?.length || 0
    });

  } catch (error) {
    const errorContext = {
      requestId,
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
        code: error.code,
        details: error.details
      },
      request: {
        method: req.method,
        url: req.originalUrl,
        params: req.params,
        query: req.query,
        body: {
          ...req.body,
          // Mask sensitive data
          paymentInfo: req.body.paymentInfo ? '***MASKED***' : undefined
        },
        headers: {
          'content-type': req.get('content-type'),
          'user-agent': req.get('user-agent')
        }
      },
      timing: {
        elapsed: `${Date.now() - startTime}ms`,
        timestamp: new Date().toISOString()
      }
    };

    // Log the full error context
    logger.error(`[${requestId}] Request failed`, errorContext);

    // Return sanitized error to client
    return res.status(500).json({
      success: false,
      error: process.env.NODE_ENV === 'production' 
        ? 'An unexpected error occurred. Please try again.' 
        : error.message,
      requestId,
      responseTime: Date.now() - startTime,
      ...(process.env.NODE_ENV !== 'production' && {
        debug: {
          error: error.message,
          type: error.name
        }
      })
    });
  } finally {
    // Clean up request tracking
    try {
      const compositeKey = req.body.returnTripId ? `${req.body.tripId}_${req.body.returnTripId}` : (req.body.tripId || 'unknown');
      const requestKey = `select_${compositeKey}`;
      
      activeRequests.delete(requestKey);
      
      logger.debug(`[${requestId}] Request completed and cleaned up`, {
        requestKey,
        activeRequestCount: activeRequests.size,
        timing: {
          totalDuration: `${Date.now() - startTime}ms`,
          timestamp: new Date().toISOString()
        }
      });
    } catch (cleanupError) {
      logger.error(`[${requestId}] Error during request cleanup:`, {
        error: cleanupError.message,
        stack: cleanupError.stack
      });
    }
  }
});

export default router;