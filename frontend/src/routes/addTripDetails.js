import express from 'express';
import logger from '../utils/logger.js';
import BusbudService from '../services/busbud.service.mjs';
import { generateCartId } from '../utils/idGenerator.js';
import { getOrCreateFirestoreCartId as ensureFirestoreCartId } from '../utils/firestore.js';
import { TravelMasterAPI } from '../integrations/odoo/travelMasterPayment.service.js';
import { applyPriceAdjustments } from '../utils/price.utils.js';
import { FieldValue } from 'firebase-admin/firestore';

// Import Firestore utilities
import { getFirestore } from '../config/firebase.config.mjs';
import { getCartsByUserId } from '../utils/firestore.js';
import axios from 'axios';
import { sendEmail } from '../utils/email.js';
import { upsertCartFromFirestore } from '../utils/postgresCarts.js';

// Initialize Firestore
let db;
try {
  db = await getFirestore();
} catch (error) {
  console.error('❌ Failed to initialize Firestore:', error);
  process.exit(1);
}




// In-memory cart storage
const carts = new Map();

// Simple in-memory cart functions
const saveCart = async (cartData) => {
  // Ensure cartData is an object
  const cartObj = typeof cartData === 'object' ? JSON.parse(JSON.stringify(cartData)) : { id: cartData };

  // Ensure cart has an ID
  if (!cartObj.id) {
    cartObj.id = cartData.id || `cart_${Date.now()}`;
  }

  // Process prices to ensure adjusted prices are preserved
  if (cartObj.busbudResponse?.trips) {
    console.log('Processing trips to preserve adjusted prices...');
    cartObj.busbudResponse.trips = cartObj.busbudResponse.trips.map(trip => {
      // If we have adjusted prices in the trip, ensure they're preserved
      if (trip.price && (trip.price.originalAmount !== undefined || trip.price.isDiscounted)) {
        console.log(`Preserving adjusted price for trip ${trip.id}:`, 
          `Original: ${trip.price.originalAmount}, ` +
          `Adjusted: ${trip.price.amount}, ` +
          `Discount: ${trip.price.discountPercentage || 0}%`
        );
      }
      return trip;
    });
  }

  // Add or update timestamps
  cartObj.updatedAt = new Date().toISOString();
  if (!cartObj.createdAt) {
    cartObj.createdAt = cartObj.updatedAt;
  }

  // Store in memory
  carts.set(cartObj.id, cartObj);
  
  // Also save to Firestore if we have a firestoreCartId
  if (cartObj.firestoreCartId) {
    try {
      const cartRef = db.collection('carts').doc(cartObj.firestoreCartId);
      await cartRef.set({
        ...cartObj,
        updatedAt: FieldValue.serverTimestamp(),
        createdAt: cartObj.createdAt || FieldValue.serverTimestamp()
      }, { merge: true });
      await upsertCartFromFirestore(cartObj.firestoreCartId, cartObj);
      console.log(`✅ Cart ${cartObj.id} saved to Firestore with ID: ${cartObj.firestoreCartId}`);
    } catch (error) {
      console.error('Error saving cart to Firestore:', error);
      // Don't fail the operation if Firestore save fails
    }
  }

  return cartObj;
};

const getCart = async (cartId) => {
  if (!cartId) return null;
  const cart = carts.get(cartId);
  return cart && typeof cart === 'object' ? { ...cart } : null;
};

const router = express.Router();

// POST /api/trips/frontend
// Adds passenger and purchaser details to a Busbud cart, then creates purchase
//
// Expected Request Body:
// {
//   "passengers": [                    // Array of passenger objects
//     {
//       "id": 1,                       // Optional passenger ID (numeric)
//       "firstName": "John",           // Required passenger name
//       "lastName": "Doe",             // Required passenger name
//       "type": "adult",               // Optional passenger type (adult/child/etc)
//       "segmentId": "segment-123",    // Optional segment ID
//       "seat_id": "A1"                // Optional seat assignment
//     }
//   ],
//   "contact_info": {                  // Contact/purchaser information
//     "firstName": "Jane",           // Maps to purchaser first_name
//     "lastName": "Smith",           // Maps to purchaser last_name
//     "email": "jane@example.com",   // Maps to purchaser email
//     "phone": "+1234567890",        // Maps to purchaser phone
//     "optInMarketing": true,        // Maps to purchaser opt_in_marketing
//     "returnUrl": "https://..."     // Optional return URL for purchase
//   }
// }
//
// Processing Flow:
// 1. Validates passengers array and contact info
// 2. Maps passengers to Busbud passenger format
// 3. Maps contact info to Busbud purchaser format
// 4. Sends passengers to Busbud updateTripPassengers API
// 5. Sends purchaser to Busbud updatePurchaserDetails API
// 6. Creates purchase using Busbud createPurchase API (skipping cart validation)
// 7. Route saves: response data to memory
// 8. Returns only the pure purchase response from Busbud API to frontend
//
// @returns {Object} Pure purchase response data directly from Busbud API

router.post('/frontend', async (req, res) => {
  try {
    console.log('🚀 === ENTERING /frontend ROUTE ===');
    console.log(`📊 Request Method: ${req.method}`);
    console.log(`🔗 Request URL: ${req.originalUrl}`);
    console.log(`📦 Raw request body:`, JSON.stringify(req.body, null, 2));
    console.log(`📏 Request body keys:`, Object.keys(req.body));
    console.log(`👥 Request headers:`, JSON.stringify(req.headers, null, 2));

    console.log('📝 Step 1: Extracting data from request body...');
    // Support both camelCase and snake_case for all fields
    const {
      passengers,
      busbudCartId, busbud_cart_id,
      tripId, trip_id,
      returnTripId, return_trip_id,
      contactInfo, contact_info
    } = req.body;

    console.log('📋 Step 2: Validating extracted data...');
    console.log(`   - passengers:`, passengers);
    console.log(`   - passengers type:`, typeof passengers);
    console.log(`   - passengers length:`, passengers ? passengers.length : 'undefined');
    console.log(`   - busbudCartId:`, busbudCartId || busbud_cart_id);
    console.log(`   - tripId:`, tripId);
    console.log(`   - returnTripId:`, returnTripId || return_trip_id);
    console.log(`   - contactInfo (camelCase):`, contactInfo);
    console.log(`   - contact_info (snake_case):`, contact_info);

    // Handle field names for Busbud cart ID (use only busbudCartId)
    const actualCartId = busbudCartId || busbud_cart_id;
    const actualTripId = tripId || trip_id;
    const actualReturnTripId = returnTripId || return_trip_id;
    const actualContactInfo = contactInfo || contact_info;

    console.log('🔄 Step 2.1: Handling field name variations...');
    console.log(`   - Actual cartId: ${actualCartId}`);
    console.log(`   - Actual tripId: ${actualTripId}`);
    console.log(`   - Actual returnTripId: ${actualReturnTripId || 'none'}`);
    console.log(`   - Actual contactInfo:`, actualContactInfo);

    if (!actualCartId) {
      console.error('❌ VALIDATION FAILED: Missing busbudCartId');
      return res.status(400).json({
        error: 'Missing busbudCartId',
        details: 'busbudCartId is required'
      });
    }

    if (!actualTripId) {
      console.error('❌ VALIDATION FAILED: Missing tripId');
      return res.status(400).json({
        error: 'Missing tripId',
        details: 'tripId or trip_id is required'
      });
    }

    console.log('🔍 Step 3: Checking passengers array...');
    if (!passengers || !passengers.length) {
      console.error('❌ VALIDATION FAILED: No passengers provided');
      console.log(`   - passengers value:`, passengers);
      console.log(`   - passengers type:`, typeof passengers);
      console.log(`   - passengers length:`, passengers ? passengers.length : 'N/A');
      return res.status(400).json({ error: 'No passengers provided' });
    }
    console.log(`✅ Step 3 PASSED: Found ${passengers.length} passengers`);

    console.log('🔍 Step 4: Checking contactInfo...');
    if (!actualContactInfo) {
      console.error('❌ VALIDATION FAILED: Missing contactInfo');
      console.log(`   - contactInfo value:`, actualContactInfo);
      console.log(`   - contactInfo type:`, typeof actualContactInfo);
      console.error('📦 Full received body:', JSON.stringify(req.body, null, 2));
      return res.status(400).json({
        error: 'Missing contactInfo for purchaser',
        details: 'contactInfo (camelCase) or contact_info (snake_case) is required and must include: firstName, lastName, email, phone'
      });
    }
    console.log(`✅ Step 4 PASSED: contactInfo found`);
    console.log(`   - contactInfo keys:`, Object.keys(actualContactInfo));

    console.log('🔍 Step 5: Validating required passenger fields...');
    const requiredPassengerFields = ['firstName', 'lastName'];
    for (let i = 0; i < passengers.length; i++) {
      const passenger = passengers[i];
      console.log(`   - Checking passenger ${i + 1}:`, JSON.stringify(passenger, null, 2));
      console.log(`   - Passenger ${i + 1} keys:`, Object.keys(passenger));

      // Check for both camelCase and snake_case field names
      const missingFields = requiredPassengerFields.filter(field => {
        const camelCase = field;
        const snakeCase = field.replace(/([A-Z])/g, '_$1').toLowerCase();
        return !passenger[camelCase] && !passenger[snakeCase];
      });

      console.log(`   - Required fields check for passenger ${i + 1}:`, requiredPassengerFields);
      console.log(`   - Missing fields for passenger ${i + 1}:`, missingFields);

      if (missingFields.length > 0) {
        console.error(`❌ VALIDATION FAILED: Missing required fields for passenger ${i + 1}`);
        console.error(`   - Missing: ${missingFields.join(', ')}`);
        console.error(`   - Received passenger data:`, JSON.stringify(passenger, null, 2));
        return res.status(400).json({
          error: `Missing required fields for passenger ${i + 1}`,
          details: `Required fields: ${missingFields.join(', ')}. Frontend sent: ${Object.keys(passenger).join(', ')}`,
          expectedFields: requiredPassengerFields,
          receivedData: passenger
        });
      }
      console.log(`✅ Step 5 PASSED: Passenger ${i + 1} has all required fields`);
    }

    console.log('✅ Step 6: All validations passed, mapping data...');

    // =================================================================
    // FRONTEND PAYLOAD STRUCTURE (Expected Format):
    // =================================================================
    // {
    //   "passengers": [                    // Array of passenger objects
    //     {
    //       "id": 1,                       // Optional passenger ID
    //       "firstName": "John",           // Required (or first_name)
    //       "lastName": "Doe",             // Required (or last_name)
    //       "type": "adult",               // Optional passenger type
    //       "segmentId": "segment-123",    // Optional segment ID
    //       "seat_id": "A1"                // Optional seat assignment
    //     }
    //   ],
    //   "contact_info": {                  // Contact/purchaser information
    //     "firstName": "Jane",           // Maps to purchaser first_name
    //     "lastName": "Smith",           // Maps to purchaser last_name
    //     "email": "jane@example.com",   // Maps to purchaser email
    //     "phone": "+1234567890",        // Maps to purchaser phone
    //     "optInMarketing": true         // Maps to purchaser opt_in_marketing
    //   }
    // }
    // =================================================================

    // =================================================================
    // PROCESSING FLOW:
    // =================================================================
    // 1. Frontend sends: { passengers: [...], contact_info: {...} }
    // 2. Route validates: passengers array and contact info
    // 3. Route maps: passengers → Busbud passenger format
    // 4. Route maps: contact_info → Busbud purchaser format
    // 5. Route sends: passengers to Busbud updateTripPassengers API
    // 6. Route sends: purchaser to Busbud updatePurchaserDetails API
    // 7. Route saves: response data to memory
    // =================================================================

    // ✅ Map purchaser details from contact info
    console.log('👤 Step 7: Mapping purchaser details...');
    const purchaser = {
      first_name: actualContactInfo.firstName || actualContactInfo.first_name || '',
      last_name: actualContactInfo.lastName || actualContactInfo.last_name || '',
      email: actualContactInfo.email || '',
      phone: actualContactInfo.phone || actualContactInfo.phoneNumber || '',
      opt_in_marketing: actualContactInfo.optInMarketing || actualContactInfo.opt_in_marketing || false
    };
    console.log('✅ Step 7 PASSED: Purchaser mapped:', JSON.stringify(purchaser, null, 2));

    console.log('🔍 Step 8: Logging passenger data structure...');
    console.log('🔍 Passenger data received from frontend:');
    passengers.forEach((p, index) => {
      console.log(`  Passenger ${index + 1}:`, JSON.stringify(p, null, 2));
    });

    console.log('🔍 Step 8.1: Getting cart from in-memory storage...');
    console.log('   - Cart ID:', actualCartId);
    // Create a new cart object in memory
    let existingCart = null;
    try {
      existingCart = await BusbudService.getCart(actualCartId, 'en-ca', 'USD');
      console.log('   - Using live cart with items:', Array.isArray(existingCart?.items) ? existingCart.items.length : 0);
    } catch (e) {
      existingCart = {
        id: actualCartId,
        status: 'new',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      console.log('   - Using in-memory cart with ID:', existingCart.id);
    }

    console.log('🗺️  Step 9: Mapping passengers to Busbud format...');
    const passengersMapped = passengers.map((p, index) => {
      console.log(`   - Mapping passenger ${index + 1}...`);

      // Generate fallback ID if neither idNumber nor id is provided
      const passengerId = p.idNumber || p.id || `passenger-${index + 1}-${Date.now()}`;
      console.log(`   - Passenger ${index + 1} ID: ${passengerId}`);

      if (!p.idNumber && !p.id) {
        console.warn(`⚠️  Missing idNumber and id for passenger ${index + 1}, using generated ID: ${passengerId}`);
      }

      // Get segment ID from passenger's selected_seats if available
      const segmentId = (() => {
        // First try to get from selected_seats array
        if (p.selected_seats && p.selected_seats.length > 0 && p.selected_seats[0].segment_id) {
          const segId = p.selected_seats[0].segment_id;
          console.log(`   - Using segment ID from selected_seats: ${segId}`);
          return segId;
        }

        // Then try direct segment ID fields
        if (p.segmentId) {
          console.log(`   - Using segmentId: ${p.segmentId}`);
          return p.segmentId;
        }
        if (p.segment_id) {
          console.log(`   - Using segment_id: ${p.segment_id}`);
          return p.segment_id;
        }
        if (p.segment) {
          console.log(`   - Using segment: ${p.segment}`);
          return p.segment;
        }

        // If no segment ID from frontend, try to get it from the existing cart's first segment
        if (existingCart?.items?.length > 0) {
          const matchItem = existingCart.items.find(it => it.trip_id === actualTripId) || existingCart.items[0];
          const firstSegment = matchItem?.segments?.[0];
          if (firstSegment?.id) {
            console.log(`   - Using first trip segment ID from cart: ${firstSegment.id}`);
            return firstSegment.id;
          }
        }

        // Final fallback - should not happen in normal operation
        const fallbackId = 'default-segment';
        console.warn(`   - No segment ID found for passenger ${index + 1}, using fallback: ${fallbackId}`);
        return fallbackId;
      })();

      // Define seatId for selected_seats
      const seatId = p.seat_id || `A${index + 1}`; // fallback seat

      // Handle both camelCase and snake_case field names
      const firstName = p.firstName || p.first_name || 'Unknown';
      const lastName = p.lastName || p.last_name || 'Unknown';
      const passengerType = p.type || p.category || 'adult';

      // Use passenger type from frontend directly
      const busbudCategory = passengerType;

      // Convert ID to number - use frontend ID directly if available (user's requirement)
      const passengerIdNum = (() => {
        // First try to use the frontend's idNumber if it's provided and numeric
        if (p.idNumber !== undefined && p.idNumber !== null && p.idNumber !== '') {
          const numId = Number(p.idNumber);
          if (!isNaN(numId) && numId > 0) {
            console.log(`   - Using frontend idNumber: ${numId}`);
            return numId;
          }
        }
        // Try to use the frontend's id field if it's provided and numeric
        if (p.id !== undefined && p.id !== null && p.id !== '') {
          const numId = Number(p.id);
          if (!isNaN(numId) && numId > 0) {
            console.log(`   - Using frontend id: ${numId}`);
            return numId;
          }
        }
        // If frontend provides a non-empty string ID, try to extract a number from it
        if ((p.idNumber !== undefined && p.idNumber !== null && p.idNumber !== '') ||
          (p.id !== undefined && p.id !== null && p.id !== '')) {
          const frontendId = p.idNumber || p.id;
          // Try to extract numbers from the string (e.g., "passenger-1-1761128032772" -> 1)
          const extractedNumber = frontendId.match(/\d+/) ? Number(frontendId.match(/\d+/)[0]) : null;
          if (extractedNumber && extractedNumber > 0) {
            console.log(`   - Extracted number from frontend ID: ${extractedNumber}`);
            return extractedNumber;
          }
        }
        // Only fallback to generated numeric ID if no valid ID from frontend
        console.warn(`⚠️  No valid numeric ID from frontend for passenger ${index + 1}, using fallback`);
        return index + 1;
      })();

      console.log(`   - Passenger ${index + 1} details: ID=${passengerIdNum}, Category=${busbudCategory}, Name=${firstName} ${lastName}`);

      console.log(`   - Passenger ${index + 1} final details: ID=${passengerIdNum}, Category=${busbudCategory}, Name=${firstName} ${lastName}`);

      const mappedPassenger = {
        id: passengerIdNum, // Busbud expects number
        first_name: firstName,
        last_name: lastName,
        category: busbudCategory, // Use Busbud's expected category values
        age: 25, // Required field with fallback value
        wheelchair: false,
        discounts: [],
        phone: purchaser.phone || '+1 (438) 501-4388',
        address: {
          address1: '123 Casgrain Ave',
          address2: 'Suite 300',
          city: 'Montreal',
          postcode: 'H1B 0X3',
          country_code: actualContactInfo.country || 'CA',
          province: 'QC'
        },
        selected_seats: [
          {
            segment_id: segmentId,
            seat_id: seatId
          }
        ],
        answers: []
      };

      console.log(`   - Mapped passenger ${index + 1}:`, JSON.stringify(mappedPassenger, null, 2));
      return mappedPassenger;
    });

    console.log('\n' + '='.repeat(60));
    console.log('🔄 PASSENGER MAPPING PROCESS');
    console.log('='.repeat(60));
    console.log(`📋 Processing ${passengers.length} passengers...`);
    console.log('📦 Original passenger data:');
    passengers.forEach((p, index) => {
      console.log(`  Passenger ${index + 1}:`, JSON.stringify(p, null, 2));
    });
    console.log('='.repeat(60) + '\n');

    // Ensure we have a Firestore cart mapped to this specific Busbud cartId early
    const firestoreCartId = await ensureFirestoreCartId(actualCartId);
    BusbudService.setfirestoreCartId(firestoreCartId);

    // Try to load Firestore cart to enrich ticket types with round-trip segments
    let fsCartData = null;
    let fsRawTripItem = null;
    try {
      const fsCartDoc = await db.collection('carts').doc(String(firestoreCartId)).get();
      if (fsCartDoc.exists) {
        fsCartData = fsCartDoc.data();
        fsRawTripItem = fsCartData?.trip?._raw?.items?.[0] || null;
        console.log('🗂️ Loaded Firestore cart for ticket types:', {
          firestoreCartId,
          hasTripRaw: !!fsRawTripItem,
          hasFsSegments: Array.isArray(fsRawTripItem?.segments) ? fsRawTripItem.segments.length : 0,
          hasFsTicketTypes: fsRawTripItem && fsRawTripItem.ticket_types ? Object.keys(fsRawTripItem.ticket_types).length : 0,
          hasFsTripLegs: Array.isArray(fsRawTripItem?.trip_legs) ? fsRawTripItem.trip_legs.length : 0
        });
      }
    } catch (e) {
      console.warn('⚠️ Failed to load Firestore cart for ticket types:', e.message);
    }

    console.log('🎫 Step 10: Building ticket types...');

    // Get existing cart to access trip details and segments
    console.log('🔍 Step 10.1: Getting existing cart for segment information...');
    console.log(`   - Existing cart found:`, !!existingCart);

    const ticketTypes = {};

    // First, try to build ticket types from all cart items (covers outbound + return)
    if (Array.isArray(existingCart?.items) && existingCart.items.length > 0) {
      console.log('📋 Using ALL cart items for ticket types (outbound + return)');
      const sourceItems = existingCart.items;

      sourceItems.forEach(item => {
        // 1) From explicit segments array
        (item.segments || []).forEach(segment => {
          if (segment?.id) {
            ticketTypes[segment.id] = 'eticket';
            console.log(`   - Added ticket type for segment ${segment.id} from item.segments`);
          }
        });

        // 2) From item.ticket_types map (keys are segment IDs)
        if (item.ticket_types && typeof item.ticket_types === 'object') {
          Object.keys(item.ticket_types).forEach(segId => {
            if (!ticketTypes[segId]) {
              ticketTypes[segId] = 'eticket';
              console.log(`   - Added ticket type for segment ${segId} from item.ticket_types`);
            }
          });
        }

        // 3) From trip_legs.segment_ids (handles round trips)
        if (Array.isArray(item.trip_legs)) {
          item.trip_legs.forEach(leg => {
            (leg.segment_ids || []).forEach(segId => {
              if (segId && !ticketTypes[segId]) {
                ticketTypes[segId] = 'eticket';
                console.log(`   - Added ticket type for segment ${segId} from trip_legs`);
              }
            });
          });
        }
      });
    }

    // Also hydrate ticket types from Firestore trip raw (covers round trip reliably)
    if (fsRawTripItem) {
      // From fsRawTripItem.segments
      (fsRawTripItem.segments || []).forEach(seg => {
        if (seg?.id && !ticketTypes[seg.id]) {
          ticketTypes[seg.id] = 'eticket';
          console.log(`   - Added ticket type for segment ${seg.id} from Firestore raw segments`);
        }
      });
      // From fsRawTripItem.ticket_types
      if (fsRawTripItem.ticket_types && typeof fsRawTripItem.ticket_types === 'object') {
        Object.keys(fsRawTripItem.ticket_types).forEach(segId => {
          if (segId && !ticketTypes[segId]) {
            ticketTypes[segId] = 'eticket';
            console.log(`   - Added ticket type for segment ${segId} from Firestore raw ticket_types`);
          }
        });
      }
      // From fsRawTripItem.trip_legs.segment_ids
      if (Array.isArray(fsRawTripItem.trip_legs)) {
        fsRawTripItem.trip_legs.forEach(leg => {
          (leg.segment_ids || []).forEach(segId => {
            if (segId && !ticketTypes[segId]) {
              ticketTypes[segId] = 'eticket';
              console.log(`   - Added ticket type for segment ${segId} from Firestore raw trip_legs`);
            }
          });
        });
      }
    } else {
      console.log('⚠️  No trip segments found in existing cart, building from passenger seats...');
      console.log('   - Existing cart structure:', existingCart ? Object.keys(existingCart) : 'null');
    }

    // Then, ensure all passenger-selected segments have ticket types
    console.log('🔍 Step 10.2: Ensuring passenger segments have ticket types...');
    passengersMapped.forEach(p => {
      p.selected_seats.forEach(seat => {
        if (seat.segment_id && !ticketTypes[seat.segment_id]) {
          ticketTypes[seat.segment_id] = 'eticket';
          console.log(`   - Added ticket type for passenger segment ${seat.segment_id}`);
        }
      });
    });

    // Finally, ensure ALL segments for this cart have a ticket type (outbound + return)
    console.log('🔍 Step 10.3: Ensuring all segments for cart have ticket types (outbound + return)...');
    if (Array.isArray(existingCart?.items) && existingCart.items.length > 0) {
      const allSegmentIds = existingCart.items
        .flatMap(item => item.segments || [])
        .map(segment => segment && segment.id)
        .filter(Boolean);

      allSegmentIds.forEach(segId => {
        if (!ticketTypes[segId]) {
          ticketTypes[segId] = 'eticket';
          console.log(`   - Ensured ticket type for cart segment ${segId}`);
        }
      });
    }

    // Debug: Show all ticket types we have
    console.log('📋 Current ticket types:', JSON.stringify(ticketTypes, null, 2));

    // Final check: ensure we have at least one ticket type
    if (Object.keys(ticketTypes).length === 0) {
      console.warn('⚠️  No ticket types found, using default');
      ticketTypes['default'] = 'eticket';
      console.log('   - Using default ticket type');
    }

    console.log('\n' + '='.repeat(60));
    console.log('✅ PASSENGER MAPPING COMPLETE');
    console.log('='.repeat(60));
    console.log('📋 Final mapped passengers for Busbud API:');
    passengersMapped.forEach((p, index) => {
      console.log(`  Passenger ${index + 1}:`, JSON.stringify(p, null, 2));
    });
    console.log('='.repeat(60) + '\n');

    console.log('📤 Calling BusbudService.updateTripPassengers...');

    console.log(`   - cartId: ${actualCartId}`);
    console.log(`   - tripId: ${actualTripId}`);
    console.log(`   - passengers count: ${passengersMapped.length}`);
    console.log(`   - ticket types:`, JSON.stringify(ticketTypes, null, 2));

    const busbudResponse = await BusbudService.updateTripPassengers(
      actualCartId,
      actualTripId,
      { locale: 'en-US', currency: 'USD', savePassengerQuestionAnswers: true },
      passengersMapped,
      ticketTypes
    );

    // If return trip provided, update its passengers as well
    if (actualReturnTripId) {
      console.log('📤 Calling BusbudService.updateTripPassengers for return trip...');
      await BusbudService.updateTripPassengers(
        actualCartId,
        actualReturnTripId,
        { locale: 'en-US', currency: 'USD', savePassengerQuestionAnswers: true },
        passengersMapped,
        ticketTypes
      );
    }

    console.log('📥 Step 11 PASSED: Busbud passenger response:', JSON.stringify(busbudResponse, null, 2));

    console.log('💰 Step 12: Updating purchaser details...');
    const purchaserPayload = {
      first_name: purchaser.first_name,
      last_name: purchaser.last_name,
      email: purchaser.email,
      phone: purchaser.phone,
      opt_in_marketing: purchaser.opt_in_marketing
    };

    console.log(`📤 Calling BusbudService.updatePurchaserDetails for cartId: ${actualCartId}`);
    console.log('📝 Purchaser payload:', JSON.stringify(purchaserPayload, null, 2));

    const purchaserResponse = await BusbudService.updatePurchaserDetails(actualCartId, purchaserPayload);
    console.log('📥 Step 12 PASSED: Purchaser response:', JSON.stringify(purchaserResponse, null, 2));

    if (!purchaserResponse || purchaserResponse.error) {
      console.error(`❌ API ERROR: Busbud API error for purchaser details:`, JSON.stringify(purchaserResponse, null, 2));
      throw new Error(`Failed to update purchaser details for cartId: ${actualCartId}`);
    }


    const charges = await BusbudService.getLatestCharges(actualCartId);
    console.log('💰 Step 13 PASSED: Busbud charges response:', JSON.stringify(charges, null, 2));

    if (!charges || charges.error) {
      console.error(`❌ API ERROR: Busbud API error for charges:`, JSON.stringify(charges, null, 2));
      throw new Error(`Failed to get charges for cartId: ${actualCartId}`);
    }


    const acceptCharges = await BusbudService.putLatestCharges(actualCartId, charges);
    console.log('💰 Step 14 PASSED: Busbud accept charges response:', JSON.stringify(acceptCharges, null, 2));

    if (!acceptCharges || acceptCharges.error) {
      console.error(`❌ API ERROR: Busbud API error for accept charges:`, JSON.stringify(acceptCharges, null, 2));
      throw new Error(`Failed to accept charges for cartId: ${actualCartId}`);
    }

    const pricing = (() => {
      try {
        const cents =
          (charges && charges.adjusted_charges && typeof charges.adjusted_charges.total === 'number'
            ? charges.adjusted_charges.total
            : (typeof charges?.total === 'number' ? charges.total : null)) ??
          (acceptCharges && typeof acceptCharges.total === 'number' ? acceptCharges.total : null);

        const currency =
          (charges && (charges.currency || charges.adjusted_charges?.currency)) ||
          (acceptCharges && (acceptCharges.currency || acceptCharges.adjusted_charges?.currency)) ||
          'USD';

        if (typeof cents !== 'number' || !Number.isFinite(cents)) return null;
        return { total: Math.round((cents / 100) * 100) / 100, currency };
      } catch {
        return null;
      }
    })();



    //   ODOO INTEGRATION --- ------  iNVOICE CREATION

    // Create initial confirmation object
    const confirmation = {
      success: true,
      cartId: actualCartId,
      firestoreCartId: BusbudService.firestoreCartId || null,
      status: 'pending_payment',
      message: 'Cart is ready for payment processing',
      requiresPayment: true,
      invoice: null,
      paymentStatus: 'pending',
      nextSteps: [
        'Proceed with payment to complete the purchase',
        'You will receive a confirmation once payment is processed'
      ]
    };

    // Check if hold is true to create invoice
    if (req.body.hold === true || req.body.hold === 'true') {
      console.log('🔄 Hold is true, creating invoice...');
        // Log environment variables for debugging (without sensitive data)
        console.log('🔍 Environment variables:', {
          hasUrl: !!process.env.TRAVELMASTER_URL,
          hasDb: !!process.env.TRAVELMASTER_DB,
          hasUsername: !!process.env.TRAVELMASTER_USERNAME,
          hasPassword: !!(process.env.TRAVELMASTER_PASSWORD || process.env.TRAVELMASTER_API_KEY)
        });

        // Verify required environment variables with detailed error messages
        const missingVars = [];
        if (!process.env.TRAVELMASTER_URL) missingVars.push('TRAVELMASTER_URL');
        if (!process.env.TRAVELMASTER_DB) missingVars.push('TRAVELMASTER_DB');
        if (!process.env.TRAVELMASTER_USERNAME) missingVars.push('TRAVELMASTER_USERNAME');
        if (!process.env.TRAVELMASTER_PASSWORD && !process.env.TRAVELMASTER_API_KEY) {
          missingVars.push('TRAVELMASTER_PASSWORD or TRAVELMASTER_API_KEY');
        }

        if (missingVars.length > 0) {
          const errorMsg = `Missing required TravelMaster API credentials: ${missingVars.join(', ')}`;
          console.error(`❌ ${errorMsg}`);
          throw new Error(errorMsg);
        }

        // Initialize TravelMaster API with environment variables
        const travelMaster = new TravelMasterAPI({
          url: process.env.TRAVELMASTER_URL,
          db: process.env.TRAVELMASTER_DB,
          username: process.env.TRAVELMASTER_USERNAME,
          password: process.env.TRAVELMASTER_PASSWORD || process.env.TRAVELMASTER_API_KEY
        });

        console.log('🔑 Using API Key as password for authentication');

        console.log('🔑 Initialized TravelMaster API with provided credentials');

        // Authenticate with TravelMaster
        try {
          const uid = await travelMaster.authenticate();
          if (!uid) {
            throw new Error('Authentication failed: No UID returned');
          }
          console.log('✅ Successfully authenticated with TravelMaster, UID:', uid);
        } catch (error) {
          console.error('❌ Failed to authenticate with TravelMaster:', error);
          throw new Error(`Failed to authenticate with TravelMaster service: ${error.message}`);
        }

        // Get the firestoreCartId from BusbudService
        const firestoreCartId = BusbudService.firestoreCartId;
        if (!firestoreCartId) {
          throw new Error('firestoreCartId is not set in BusbudService');
        }

        // Get cart data using the firestoreCartId as the document ID
        const cartDoc = await db.collection('carts').doc(firestoreCartId).get();

        if (!cartDoc.exists) {
          throw new Error(`Cart with ID ${firestoreCartId} not found in Firestore`);
        }

        const cartData = cartDoc.data();
        console.log(`✅ Found cart in Firestore with ID: ${firestoreCartId}`);

        // Log the complete cart data structure for debugging
        console.log('📦 Cart data structure:', JSON.stringify({
          keys: Object.keys(cartData),
          passengerDetails: cartData.passengerDetails ? Object.keys(cartData.passengerDetails) : 'No passengerDetails',
          hasPurchaser: !!cartData.purchaser,
          hasPassengers: Array.isArray(cartData.passengers) ? cartData.passengers.length : 0,
          hasBusbudResponse: !!cartData.busbudResponse,
          busbudResponseKeys: cartData.busbudResponse ? Object.keys(cartData.busbudResponse) : 'No busbudResponse',
          hasTrips: Array.isArray(cartData.trips) ? cartData.trips.length : 'No trips array'
        }, null, 2));

        // Log the full busbudResponse if it exists
        if (cartData.busbudResponse) {
          console.log('🔍 Full busbudResponse:', JSON.stringify(cartData.busbudResponse, null, 2));
        }

        // Try to find purchaser data in various possible locations
        let purchaser = cartData.purchaserDetails ||
          cartData.purchaser ||
          cartData.passengerDetails?.purchaser ||
          (Array.isArray(cartData.passengers) && cartData.passengers[0]) ||
          null;

        // If purchaser is still not found, check the root level for individual fields
        if (!purchaser) {
          purchaser = {
            firstName: cartData.firstName || cartData.passengerDetails?.firstName,
            lastName: cartData.lastName || cartData.passengerDetails?.lastName,
            email: cartData.email || cartData.passengerDetails?.email,
            phone: cartData.phone || cartData.passengerDetails?.phone
          };

          // Check if we have at least some purchaser data
          if (!purchaser.firstName && !purchaser.lastName && !purchaser.email && !purchaser.phone) {
            console.error('❌ Purchaser data not found in cart. Available data keys:',
              Object.keys(cartData));
            throw new Error('Purchaser data is missing from cart');
          }
        }

        // Log the found purchaser data
        console.log('👤 Found purchaser data:', JSON.stringify(purchaser, null, 2));

        // Normalize field names to handle both snake_case and camelCase
        const normalizedPurchaser = {
          // Use snake_case if present, otherwise use camelCase
          firstName: purchaser.first_name || purchaser.firstName,
          lastName: purchaser.last_name || purchaser.lastName,
          email: purchaser.email,
          phone: purchaser.phone,
          // Include any other fields that might be needed
          ...purchaser
        };

        // Update the purchaser reference
        purchaser = normalizedPurchaser;

        // Validate required fields with default values
        const requiredFields = ['firstName', 'lastName', 'email', 'phone'];
        const missingFields = requiredFields.filter(field => !purchaser[field]);

        if (missingFields.length > 0) {
          console.warn('⚠️ Some required purchaser fields are missing:', missingFields.join(', '));
          console.warn('Available purchaser data:', JSON.stringify(purchaser, null, 2));

          // Provide default values for missing required fields
          purchaser = {
            firstName: purchaser.firstName || 'Unknown',
            lastName: purchaser.lastName || 'Customer',
            email: purchaser.email || 'no-email@example.com',
            phone: purchaser.phone || '000-000-0000',
            ...purchaser // Keep any existing data
          };

          console.warn('⚠️ Using default values for missing fields. Updated purchaser:', purchaser);
        }

        // Create or find partner with detailed logging
        console.log('🔍 Looking up or creating partner...', {
          name: `${purchaser.firstName} ${purchaser.lastName}`.trim(),
          email: purchaser.email,
          phone: purchaser.phone
        });

        const partnerId = await travelMaster.findOrCreatePartner(
          `${purchaser.firstName} ${purchaser.lastName}`.trim(),
          purchaser.email,
          purchaser.phone
        );
        console.log(`✅ Partner ID: ${partnerId}`);

        // Try to get cart data from Firestore using firestoreCartId
        let firestoreCartData = null;
        try {
          const firestoreCarts = await getCartsByUserId(BusbudService.firestoreCartId);
          if (firestoreCarts && firestoreCarts.length > 0) {
            firestoreCartData = firestoreCarts[0]; // Get the first matching cart
            console.log('✅ Retrieved cart from Firestore:', {
              cartId: firestoreCartData.id,
              busbudCartId: firestoreCartData.busbudCartId,
              hasTrips: Array.isArray(firestoreCartData.trips)
            });

            // If we found trips in Firestore but not in the original cartData, use them
            if ((!cartData || !Array.isArray(cartData.trips)) && Array.isArray(firestoreCartData.trips)) {
              console.log('🔍 Using trips from Firestore cart data');
              cartData = { ...cartData, trips: firestoreCartData.trips };
            }
          }
        } catch (firestoreError) {
          console.error('❌ Error fetching cart from Firestore:', firestoreError.message);
        }

        // Log complete cart data structure for debugging
        console.log('🔍 Full Cart Data Structure:', JSON.stringify({
          cartId: BusbudService.firestoreCartId,
          firestoreCartData: firestoreCartData ? {
            id: firestoreCartData.id,
            hasTrips: Array.isArray(firestoreCartData.trips),
            tripsCount: firestoreCartData.trips?.length || 0
          } : 'No Firestore cart data',
          cartData: cartData || 'No cart data',
          cartDataKeys: cartData ? Object.keys(cartData) : [],
          hasTrips: Array.isArray(cartData?.trips),
          tripsCount: cartData?.trips?.length || 0,
          cartDataTypes: cartData ? Object.entries(cartData).reduce((acc, [key, value]) => ({
            ...acc,
            [key]: {
              type: typeof value,
              isArray: Array.isArray(value),
              value: value === null ? 'null' : (typeof value === 'object' ? 'object/array' : value)
            }
          }), {}) : {},
          timestamp: new Date().toISOString()
        }, null, 2));

        if (!cartData) {
          const errorMsg = '❌ Cart data is null or undefined';
          console.error(errorMsg);
          throw new Error('No cart data available');
        }

        // Try to find trips in different possible locations
        let trips = [];

        // First, check if we have busbudResponse with trip details
        if (cartData.busbudResponse) {
          // Check if trips are directly in busbudResponse
          if (Array.isArray(cartData.busbudResponse.trips)) {
            trips = cartData.busbudResponse.trips;
            console.log('ℹ️ Found trips in cartData.busbudResponse.trips');
          }
          // Check if we have a single trip in busbudResponse
          else if (cartData.busbudResponse.trip) {
            trips = [cartData.busbudResponse.trip];
            console.log('ℹ️ Found single trip in cartData.busbudResponse.trip');
          }
          // Check if we have a legs array in busbudResponse
          else if (Array.isArray(cartData.busbudResponse.legs)) {
            trips = cartData.busbudResponse.legs;
            console.log('ℹ️ Found trips in cartData.busbudResponse.legs');
          }
          // Check if we have a journey object with segments
          else if (cartData.busbudResponse.journey && Array.isArray(cartData.busbudResponse.journey.segments)) {
            trips = cartData.busbudResponse.journey.segments;
            console.log('ℹ️ Found trips in cartData.busbudResponse.journey.segments');
          }
        }

        // If no trips found in busbudResponse, try other locations
        if (trips.length === 0) {
          if (Array.isArray(cartData.trips)) {
            // Standard case: cartData.trips is an array
            trips = cartData.trips;
            console.log('ℹ️ Found trips in cartData.trips');
          } else if (cartData.data && Array.isArray(cartData.data.trips)) {
            // Case: trips are in cartData.data.trips
            trips = cartData.data.trips;
            console.log('ℹ️ Found trips in cartData.data.trips');
          } else if (cartData.items && Array.isArray(cartData.items)) {
            // Case: trips are in cartData.items
            trips = cartData.items;
            console.log('ℹ️ Found trips in cartData.items');
          } else if (cartData.cart && Array.isArray(cartData.cart.trips)) {
            // Case: trips are in cartData.cart.trips
            trips = cartData.cart.trips;
            console.log('ℹ️ Found trips in cartData.cart.trips');
          } else if (cartData.trips && typeof cartData.trips === 'object') {
            // Case: trips is an object, convert to array
            trips = Object.values(cartData.trips);
            console.log('ℹ️ Found trips as object, converted to array');
          }
        }

        // Log the cart data structure to understand the full context
        console.log('🔍 Full cart data structure:', JSON.stringify(cartData, null, 2));

        // Log the first trip to see its structure
        if (trips.length > 0) {
          console.log('🔍 First trip structure:', JSON.stringify(trips[0], null, 2));
          console.log('🔍 First trip keys:', Object.keys(trips[0]));

          // Log any nested structures that might contain trip details
          if (cartData.tripsData) {
            console.log('🔍 Found tripsData in cart:', Object.keys(cartData.tripsData));
          }
          if (cartData.details) {
            console.log('🔍 Found details in cart:', Object.keys(cartData.details));
          }
        }

        // Strictly require structured Firestore cart data for invoice lines
        // Prefer passengerDetails.busbudResponse when present, but fall back to root busbudResponse
        const passengerBusbud = cartData.passengerDetails?.busbudResponse || cartData.busbudResponse;
        if (!passengerBusbud) {
          throw new Error('Missing Busbud charges data in cart; cannot build invoice lines');
        }

        const adjustedCharges = passengerBusbud.adjusted_charges;
        const charges = passengerBusbud.charges || passengerBusbud;

        // Try to base invoice pricing on Busbud's original_charges (cart total in cents)
        // and apply the SAME price adjustments we use for search results, so the
        // invoice matches the frontend trip price.
        const originalCharges =
          passengerBusbud.original_charges ||
          (adjustedCharges && adjustedCharges.metadata && adjustedCharges.metadata.original_charges);

        let invoiceBaseAmount;
        let currency;

        // Prefer a single canonical adjusted price saved in Firestore when available
        const pricingMeta = cartData.passengerDetails?.pricing_metadata || cartData.pricing_metadata;
        if (pricingMeta && typeof pricingMeta.canonical_adjusted_total_cents === 'number' && pricingMeta.canonical_adjusted_total_cents > 0) {
          const baseCents = pricingMeta.canonical_adjusted_total_cents;
          invoiceBaseAmount = baseCents / 100;
          currency = pricingMeta.currency || charges?.currency || 'USD';
        } else if (originalCharges && typeof originalCharges.total === 'number') {
          const baseCents = originalCharges.total;
          const baseAmount = baseCents / 100;
          const adjMeta = applyPriceAdjustments(baseAmount, {
            currency: originalCharges.currency || charges?.currency || 'USD',
            returnMetadata: true
          });

          const adjusted = typeof adjMeta?.amount === 'number' ? adjMeta.amount : baseAmount;
          const roundedAdjusted = Math.round(adjusted * 100) / 100;

          invoiceBaseAmount = roundedAdjusted;
          currency = originalCharges.currency || charges?.currency || 'USD';
        } else {
          if (!adjustedCharges || typeof adjustedCharges.total !== 'number' || !Array.isArray(adjustedCharges.items) || adjustedCharges.items.length === 0) {
            throw new Error('Missing or invalid adjusted_charges data in cart; expected adjusted_charges.total and at least one item');
          }

          const rawInvoiceBaseCents =
            (typeof cartData.totalAmount === 'number' ? cartData.totalAmount : null) ??
            adjustedCharges.total;

          const baseAmount = rawInvoiceBaseCents / 100;
          const adjMeta = applyPriceAdjustments(baseAmount, {
            currency: adjustedCharges.currency || charges?.currency || 'USD',
            returnMetadata: true
          });

          const adjusted = typeof adjMeta?.amount === 'number' ? adjMeta.amount : baseAmount;
          const roundedAdjusted = Math.round(adjusted * 100) / 100;

          invoiceBaseAmount = roundedAdjusted;
          currency = adjustedCharges.currency || charges?.currency || 'USD';
        }

        console.log('💵 Price data for invoice:', {
          firestoreTotalAmount: cartData.totalAmount,
          busbudAdjustedTotal: adjustedCharges.total,
          chosenInvoiceBaseAmount: invoiceBaseAmount,
          originalChargesTotal: charges?.total,
          currency,
          itemAmounts: adjustedCharges.items.map(it => it.amount)
        });

        // Extract segment details from existing Busbud cart data or busbudResponse.
        // We no longer persist trip._raw in Firestore, so rely on safer sources.
        let segments = [];
        let tripLegs = [];

        // Prefer segments/trip_legs from the live Busbud cart we fetched earlier
        if (Array.isArray(existingCart?.items) && existingCart.items.length > 0) {
          const matchItem = existingCart.items.find(it => it && it.trip_id === actualTripId) || existingCart.items[0];
          if (matchItem) {
            if (Array.isArray(matchItem.segments)) {
              segments = matchItem.segments;
            }
            if (Array.isArray(matchItem.trip_legs)) {
              tripLegs = matchItem.trip_legs;
            }
          }
        }

        // Fallback to segments/trip_legs embedded in busbudResponse on the cart
        if (segments.length === 0 && cartData.busbudResponse) {
          const br = cartData.busbudResponse;
          if (Array.isArray(br.trip?.segments)) {
            segments = br.trip.segments;
          } else if (Array.isArray(br.segments)) {
            segments = br.segments;
          } else if (Array.isArray(br.journey?.segments)) {
            segments = br.journey.segments;
          } else if (Array.isArray(br.trips) && br.trips[0] && Array.isArray(br.trips[0].segments)) {
            segments = br.trips[0].segments;
          }

          if (tripLegs.length === 0) {
            if (Array.isArray(br.trip_legs)) {
              tripLegs = br.trip_legs;
            } else if (Array.isArray(br.trips) && Array.isArray(br.trips[0]?.trip_legs)) {
              tripLegs = br.trips[0].trip_legs;
            }
          }
        }

        // Determine outbound and optional return segments using trip_legs when available
        let outboundSegment = Array.isArray(segments) && segments.length ? segments[0] : null;
        let returnSegment = null;

        if (Array.isArray(tripLegs) && tripLegs.length > 0 && Array.isArray(segments) && segments.length) {
          const leg1SegId = tripLegs[0]?.segment_ids?.[0];
          const leg2SegId = tripLegs[1]?.segment_ids?.[0];

          if (leg1SegId) {
            const foundOutbound = segments.find(s => s && s.id === leg1SegId);
            if (foundOutbound) outboundSegment = foundOutbound;
          }

          if (leg2SegId) {
            returnSegment = segments.find(s => s && s.id === leg2SegId) || null;
          }
        } else if (Array.isArray(segments) && segments.length > 1) {
          // Fallback: treat second segment as return leg when no explicit trip_legs
          returnSegment = segments[1];
        }

        const tripDetails = {
          origin: outboundSegment?.origin?.name || 'Unknown',
          originCity: outboundSegment?.origin?.city?.name || outboundSegment?.origin?.name || 'Unknown',
          destination: outboundSegment?.destination?.name || 'Unknown',
          destinationCity: outboundSegment?.destination?.city?.name || outboundSegment?.destination?.name || 'Unknown',
          departureTime: outboundSegment?.departure_time?.timestamp ? new Date(outboundSegment.departure_time.timestamp) : null,
          arrivalTime: outboundSegment?.arrival_time?.timestamp ? new Date(outboundSegment.arrival_time.timestamp) : null,
          operator: outboundSegment?.operator?.name || 'Unknown',
          vehicleType: outboundSegment?.vehicle?.type || 'Bus',
          availableSeats: outboundSegment?.vehicle?.available_seats || 0,
          tripId: cartData.tripId || cartData.trip?.tripId || 'unknown-trip-id'
        };

        let returnTripDetails = null;
        if (returnSegment) {
          returnTripDetails = {
            origin: returnSegment.origin?.name || 'Unknown',
            originCity: returnSegment.origin?.city?.name || returnSegment.origin?.name || 'Unknown',
            destination: returnSegment.destination?.name || 'Unknown',
            destinationCity: returnSegment.destination?.city?.name || returnSegment.destination?.name || 'Unknown',
            departureTime: returnSegment.departure_time?.timestamp ? new Date(returnSegment.departure_time.timestamp) : null,
            arrivalTime: returnSegment.arrival_time?.timestamp ? new Date(returnSegment.arrival_time.timestamp) : null,
            operator: returnSegment.operator?.name || 'Unknown',
            vehicleType: returnSegment.vehicle?.type || 'Bus',
            availableSeats: returnSegment.vehicle?.available_seats || 0
          };
        }

        console.log('🔍 Outbound trip details from cart data:', JSON.stringify(tripDetails, null, 2));
        if (returnTripDetails) {
          console.log('🔍 Return trip details from cart data:', JSON.stringify(returnTripDetails, null, 2));
        }

        // Determine passenger count from summary/trips/adjusted charges
        const passengerCount =
          cartData.summary?.passengerCount ||
          (Array.isArray(cartData.trips)
            ? cartData.trips.reduce((sum, t) => sum + (t.passengers?.reduce((s, p) => s + (p.count || 0), 0) || 0), 0)
            : 0) ||
          adjustedCharges.items.length ||
          1;

        const totalAdjusted = invoiceBaseAmount;
        const linePrice = totalAdjusted / passengerCount;
        const isAdjusted = true;

        console.log('💰 Invoice price breakdown (using adjusted amount for invoice):', {
          passengerCount,
          linePrice,
          currency
        });

        // Prepare invoice lines
        console.log('📝 Preparing invoice lines');
        let invoiceLines = [];

        let lineName =
          `Trip: ${tripDetails.originCity} to ${tripDetails.destinationCity}\n` +
          `Departure: ${tripDetails.departureTime ? tripDetails.departureTime.toLocaleString() : 'Unknown'}\n` +
          `Arrival: ${tripDetails.arrivalTime ? tripDetails.arrivalTime.toLocaleString() : 'Unknown'}\n`;

        if (returnTripDetails) {
          lineName +=
            `\nReturn Trip: ${returnTripDetails.originCity} to ${returnTripDetails.destinationCity}\n` +
            `Return Departure: ${returnTripDetails.departureTime ? returnTripDetails.departureTime.toLocaleString() : 'Unknown'}\n` +
            `Return Arrival: ${returnTripDetails.arrivalTime ? returnTripDetails.arrivalTime.toLocaleString() : 'Unknown'}\n`;
        }

        lineName +=
          `\nPassenger: ${purchaser.firstName || 'N/A'} ${purchaser.lastName || ''}\n` +
          `Email: ${purchaser.email || 'N/A'}\n` +
          `Phone: ${purchaser.phone || 'N/A'}\n\n`;

        const line = {
          name: lineName,

          quantity: passengerCount,
          price_unit: linePrice,
          price_total: totalAdjusted,
          product_id: 92, // Updated product ID
          product_uom_id: 1, // Default UoM ID
          tax_ids: []
        };

        console.log('✅ Built invoice line from Firestore cart:', {
          quantity: line.quantity,
          price_unit: line.price_unit,
          price_total: line.price_total,
          passengerCount,
          adjustedTotal: totalAdjusted
        });

        invoiceLines.push(line);

        // Invoice lines already use the adjusted price; nothing further to do here

        const invoiceData = {
          partner_id: partnerId,
          payment_reference: BusbudService.firestoreCartId,
          invoice_date: new Date().toISOString().split('T')[0],
          move_type: 'out_invoice',
          invoice_line_ids: invoiceLines.map(line => [0, 0, line]),
          amount_untaxed: totalAdjusted,
          amount_tax: 0, // Set to 0 as we're handling tax inclusive pricing
          amount_total: totalAdjusted,
          state: 'draft',
          x_studio_notes: 'Invoice generated from Busbud cart via National Tickets Global gateway',
          created_at: new Date().toISOString()
        };

        console.log('📄 Invoice data prepared with adjusted prices:', JSON.stringify({
          amount_untaxed: invoiceData.amount_untaxed,
          amount_total: invoiceData.amount_total,
          currency,
          passengerCount,
          linePrice
        }, null, 2));

        console.log('📄 Invoice data prepared:', JSON.stringify({
          partner_id: invoiceData.partner_id,
          payment_reference: invoiceData.payment_reference,
          line_count: invoiceData.invoice_line_ids.length,
          amount_total: invoiceData.amount_total,
          amount_tax: invoiceData.amount_tax,
          amount_untaxed: invoiceData.amount_untaxed
        }, null, 2));

        // Get cart expiration date from busbud response
        const cartExpiryDate = cartData.busbudResponse?.metadata?.ttl || 
                             cartData.metadata?.ttl || 
                             cartData._ttl;
        
        if (!cartExpiryDate) {
          throw new Error('Cart expiration date not found in cart data');
        }

        // Ensure the expiration date is a valid date
        const expiryDate = new Date(cartExpiryDate);
        if (isNaN(expiryDate.getTime())) {
          throw new Error(`Invalid cart expiration date format: ${cartExpiryDate}`);
        }

        console.log('⏰ Using cart expiration date:', expiryDate.toISOString());

        // Create invoice with detailed logging
        console.log('🔄 Creating invoice in Odoo...');
        const startTime = Date.now();
        
        // Create the invoice with the cart's expiration date
        const invoiceId = await travelMaster.findOrCreateInvoice(
          invoiceData.partner_id,
          invoiceData.payment_reference,
          invoiceData.invoice_line_ids,
          expiryDate
        );
        
        const createDuration = Date.now() - startTime;

        console.log(`✅ Invoice created in ${createDuration}ms`, {
          invoiceId,
          durationMs: createDuration,
          timestamp: new Date().toISOString()
        });

        try {
          console.log('🔄 Posting invoice...');
          const postStartTime = Date.now();
          const posted = await travelMaster.postInvoice(invoiceId);
          const postDuration = Date.now() - postStartTime;

          console.log(`✅ Invoice posted in ${postDuration}ms`, {
            invoiceId,
            posted,
            durationMs: postDuration,
            timestamp: new Date().toISOString()
          });

          if (!posted) {
            const errorMsg = `❌ Invoice posting returned false. Invoice ID: ${invoiceId}`;
            console.error(errorMsg, { invoiceId, posted });
            throw new Error('Failed to post invoice: Post operation returned false');
          }

          // Update confirmation
          confirmation.invoice = {
            id: invoiceId,
            pnr: actualCartId,
            number: `INV-${invoiceId}`,
            total: cartData.totalAmount || 0,
            status: 'posted'
          };

          confirmation.requiresPayment = true;

          let responseFirestoreCartId = BusbudService.firestoreCartId || null;
          if (!responseFirestoreCartId) {
            try {
              const snap = await db.collection('carts').where('busbudCartId', '==', actualCartId).limit(1).get();
              if (!snap.empty) {
                responseFirestoreCartId = snap.docs[0].id;
              }
            } catch (e) {}
          }

          const paymentRef = invoiceData.payment_reference;

          return res.json({
            success: true,
            message: 'Invoice created and posted',
            cartId: actualCartId,
            firestoreCartId: responseFirestoreCartId,
            status: 'awaiting_payment',
            pricing,
            invoice: confirmation.invoice,
            nextSteps: [
              'Proceed with payment to complete your booking',
              'You will receive a confirmation once payment is processed',
              'For any issues, please contact support with your cart ID: ' + actualCartId
            ]
          });
        } catch (postError) {
          console.error('❌ Error posting invoice:', {
            invoiceId,
            error: postError.message,
            stack: postError.stack,
            response: postError.response?.data || 'No response data'
          });
          throw new Error(`Failed to post invoice: ${postError.message}`);
        }
    } else {
      console.log('⏭️ Hold is false, invoice will be created during payment processing');
      confirmation.message = 'Payment processing will create the invoice';
    }

    // Send the confirmation response
    console.log('✅ Cart and invoice processing completed successfully');
    console.log('🔄 Purchase will be completed after payment confirmation via webhook');
    
    let responseFirestoreCartId = BusbudService.firestoreCartId || null;
    if (!responseFirestoreCartId) {
      try {
        const snap = await db.collection('carts').where('busbudCartId', '==', actualCartId).limit(1).get();
        if (!snap.empty) {
          responseFirestoreCartId = snap.docs[0].id;
        }
      } catch (e) {}
    }

    // Final response
    res.json({
      success: true,
      message: 'Cart is ready for payment processing',
      cartId: actualCartId,
      firestoreCartId: responseFirestoreCartId,
      status: 'awaiting_payment',
      pricing,
      invoice: confirmation.invoice,
      nextSteps: [
        'Proceed with payment to complete your booking',
        'You will receive a confirmation once payment is processed',
        'For any issues, please contact support with your cart ID: ' + actualCartId
      ]
    });

  } catch (error) {
    console.error('❌ Error in purchase process:', error);

    // Create response data for failure case
    const responseData = {
      success: false,
      error: 'An error occurred during purchase processing',
      details: error.message,
      firestoreCartId: BusbudService.firestoreCartId || null,
      timestamp: new Date().toISOString(),
      requiresAttention: true
    };

    try {
      // Send error response
      console.log('📤 Sending error response to client');
      res.status(500).json(responseData);
    } catch (sendError) {
      console.error('❌ Failed to send error response:', sendError);
      // If we can't send the response, we've done all we can
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: 'An internal server error occurred',
          timestamp: new Date().toISOString()
        });
      }
    }
  }
});

// Helper function to format Firestore timestamp to YYYY-MM-DD HH:MM:SS
// This format is compatible with Odoo's expected datetime format
function formatTtlToDateString(ttl) {
  try {
    // Handle both Firestore timestamp format and direct date string
    const date = ttl._seconds 
      ? new Date(ttl._seconds * 1000 + (ttl._nanoseconds || 0) / 1000000)
      : new Date(ttl);
      
    const pad = num => num.toString().padStart(2, '0');
    
    // Format as YYYY-MM-DD HH:MM:SS for Odoo compatibility
    return [
      date.getFullYear(),
      pad(date.getMonth() + 1),
      pad(date.getDate())
    ].join('-') + ' ' + [
      pad(date.getHours()),
      pad(date.getMinutes()),
      pad(date.getSeconds())
    ].join(':');
  } catch (error) {
    console.error('Error formatting TTL date:', error);
    return null;
  }
}

export default router;
