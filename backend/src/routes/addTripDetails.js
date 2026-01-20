import express from 'express';
import logger from '../utils/logger.js';
import BusbudService from '../services/busbud.service.mjs';
import { generateCartId } from '../utils/idGenerator.js';
import { getOrCreateFirestoreCartId as ensureFirestoreCartId, updateCart } from '../utils/firestore.js';
import { TravelMasterAPI } from '../integrations/odoo/travelMasterPayment.service.js';
import { applyPriceAdjustments } from '../utils/price.utils.js';
import { FieldValue } from 'firebase-admin/firestore';

// Import Firestore utilities
import { getFirestore } from '../config/firebase.config.mjs';
import { getCartsByUserId } from '../utils/firestore.js';
import axios from 'axios';
import { sendEmail } from '../utils/email.js';
import drizzleDb, { tripSelections, carts as cartsPgTable } from '../db/drizzleClient.js';
import { eq, desc, sql } from 'drizzle-orm';
import { getCartFromPostgres } from '../utils/postgresCarts.js';
import { getAgentById } from '../services/agent.service.js';

const isProduction = process.env.NODE_ENV === 'production';

// Initialize Firestore
let db;
try {
  db = await getFirestore();
} catch (error) {
  console.error('❌ Failed to initialize Firestore:', error);
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
  db = null;
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
    if (!isProduction) {
      console.log('Processing trips to preserve adjusted prices...');
    }
    cartObj.busbudResponse.trips = cartObj.busbudResponse.trips.map(trip => {
      // If we have adjusted prices in the trip, ensure they're preserved
      if (trip.price && (trip.price.originalAmount !== undefined || trip.price.isDiscounted)) {
        if (!isProduction) {
          console.log(`Preserving adjusted price for trip ${trip.id}:`, 
            `Original: ${trip.price.originalAmount}, ` +
            `Adjusted: ${trip.price.amount}, ` +
            `Discount: ${trip.price.discountPercentage || 0}%`
          );
        }
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
      if (!isProduction) {
        console.log(`✅ Cart ${cartObj.id} saved to Firestore with ID: ${cartObj.firestoreCartId}`);
      }
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
    const debug = process.env.NODE_ENV !== 'production';

    if (debug) {
      console.log('🚀 === ENTERING /frontend ROUTE ===');
      console.log(`📊 Request Method: ${req.method}`);
      console.log(`🔗 Request URL: ${req.originalUrl}`);
      console.log(`📦 Raw request body:`, JSON.stringify(req.body, null, 2));
      console.log(`📏 Request body keys:`, Object.keys(req.body));

      console.log('📝 Step 1: Extracting data from request body...');
    }
    // Support both camelCase and snake_case for all fields
    const {
      passengers,
      busbudCartId, busbud_cart_id,
      tripId, trip_id,
      returnTripId, return_trip_id,
      contactInfo, contact_info
    } = req.body;

    if (debug) {
      console.log('📋 Step 2: Validating extracted data...');
      console.log(`   - passengers:`, passengers);
      console.log(`   - passengers type:`, typeof passengers);
      console.log(`   - passengers length:`, passengers ? passengers.length : 'undefined');
      console.log(`   - busbudCartId:`, busbudCartId || busbud_cart_id);
      console.log(`   - tripId:`, tripId);
      console.log(`   - returnTripId:`, returnTripId || return_trip_id);
      console.log(`   - contactInfo (camelCase):`, contactInfo);
      console.log(`   - contact_info (snake_case):`, contact_info);
    }

    // Handle field names for Busbud cart ID (use only busbudCartId)
    const actualCartId = busbudCartId || busbud_cart_id;
    const actualTripId = tripId || trip_id;
    const actualReturnTripId = returnTripId || return_trip_id;
    const actualContactInfo = contactInfo || contact_info;

    if (debug) {
      console.log('🔄 Step 2.1: Handling field name variations...');
      console.log(`   - Actual cartId: ${actualCartId}`);
      console.log(`   - Actual tripId: ${actualTripId}`);
      console.log(`   - Actual returnTripId: ${actualReturnTripId || 'none'}`);
      console.log(`   - Actual contactInfo:`, actualContactInfo);
    }

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

    if (debug) console.log('🔍 Step 3: Checking passengers array...');
    if (!passengers || !passengers.length) {
      console.error('❌ VALIDATION FAILED: No passengers provided');
      if (debug) {
        console.log(`   - passengers value:`, passengers);
        console.log(`   - passengers type:`, typeof passengers);
        console.log(`   - passengers length:`, passengers ? passengers.length : 'N/A');
      }
      return res.status(400).json({ error: 'No passengers provided' });
    }
    if (debug) console.log(`✅ Step 3 PASSED: Found ${passengers.length} passengers`);

    if (debug) console.log('🔍 Step 4: Checking contactInfo...');
    if (!actualContactInfo) {
      console.error('❌ VALIDATION FAILED: Missing contactInfo');
      if (debug) {
        console.log(`   - contactInfo value:`, actualContactInfo);
        console.log(`   - contactInfo type:`, typeof actualContactInfo);
        console.error('📦 Full received body:', JSON.stringify(req.body, null, 2));
      }
      return res.status(400).json({
        error: 'Missing contactInfo for purchaser',
        details: 'contactInfo (camelCase) or contact_info (snake_case) is required and must include: firstName, lastName, email, phone'
      });
    }
    if (debug) {
      console.log(`✅ Step 4 PASSED: contactInfo found`);
      console.log(`   - contactInfo keys:`, Object.keys(actualContactInfo));
    }

    if (debug) console.log('🔍 Step 5: Validating required passenger fields...');
    const requiredPassengerFields = ['firstName', 'lastName'];
    for (let i = 0; i < passengers.length; i++) {
      const passenger = passengers[i];
      if (debug) {
        console.log(`   - Checking passenger ${i + 1}:`, JSON.stringify(passenger, null, 2));
        console.log(`   - Passenger ${i + 1} keys:`, Object.keys(passenger));
      }

      // Check for both camelCase and snake_case field names
      const missingFields = requiredPassengerFields.filter(field => {
        const camelCase = field;
        const snakeCase = field.replace(/([A-Z])/g, '_$1').toLowerCase();
        return !passenger[camelCase] && !passenger[snakeCase];
      });

      if (debug) {
        console.log(`   - Required fields check for passenger ${i + 1}:`, requiredPassengerFields);
        console.log(`   - Missing fields for passenger ${i + 1}:`, missingFields);
      }

      if (missingFields.length > 0) {
        console.error(`❌ VALIDATION FAILED: Missing required fields for passenger ${i + 1}`);
        console.error(`   - Missing: ${missingFields.join(', ')}`);
        if (debug) {
          console.error(`   - Received passenger data:`, JSON.stringify(passenger, null, 2));
        }
        return res.status(400).json({
          error: `Missing required fields for passenger ${i + 1}`,
          details: `Required fields: ${missingFields.join(', ')}. Frontend sent: ${Object.keys(passenger).join(', ')}`,
          expectedFields: requiredPassengerFields,
          receivedData: passenger
        });
      }
      if (debug) console.log(`✅ Step 5 PASSED: Passenger ${i + 1} has all required fields`);
    }

    if (debug) console.log('✅ Step 6: All validations passed, mapping data...');

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
    if (debug) console.log('👤 Step 7: Mapping purchaser details...');
    const purchaser = {
      first_name: actualContactInfo.firstName || actualContactInfo.first_name || '',
      last_name: actualContactInfo.lastName || actualContactInfo.last_name || '',
      email: actualContactInfo.email || '',
      phone: actualContactInfo.phone || actualContactInfo.phoneNumber || '',
      opt_in_marketing: actualContactInfo.optInMarketing || actualContactInfo.opt_in_marketing || false
    };
    if (debug) console.log('✅ Step 7 PASSED: Purchaser mapped:', JSON.stringify(purchaser, null, 2));

    if (debug) {
      console.log('🔍 Step 8: Logging passenger data structure...');
      console.log('🔍 Passenger data received from frontend:');
      passengers.forEach((p, index) => {
        console.log(`  Passenger ${index + 1}:`, JSON.stringify(p, null, 2));
      });
    }

    if (debug) console.log('🔍 Step 8.1: Getting cart from in-memory storage...');
    if (debug) console.log('   - Cart ID:', actualCartId);
    // Create a new cart object in memory
    let existingCart = null;
    try {
      existingCart = await BusbudService.getCart(actualCartId, 'en-ca', 'USD', { bypassCache: true });
      if (debug) console.log('   - Using live cart with items:', Array.isArray(existingCart?.items) ? existingCart.items.length : 0);
    } catch (e) {
      existingCart = {
        id: actualCartId,
        items: []
      };
    }

    const normalizeQuestionKey = (value) => {
      try {
        const raw = String(value || '').trim();
        if (!raw) return '';

        const withUnderscores = raw.replace(/([a-z0-9])([A-Z])/g, '$1_$2');
        const normalized = withUnderscores
          .trim()
          .toLowerCase()
          .replace(/[\s-]+/g, '_')
          .replace(/[^a-z0-9_]/g, '');

        if (normalized === 'idtype') return 'id_type';
        if (normalized === 'idnumber') return 'id_number';

        return normalized;
      } catch (_) {
        return '';
      }
    };

    const extractPassengerQuestionsFromCart = (cart, tripIds = []) => {
      try {
        const tripIdSet = new Set((tripIds || []).map((t) => String(t || '').trim()).filter(Boolean));
        const required = new Set();
        const optional = new Set();

        const pushKey = (key, isRequired) => {
          const k = normalizeQuestionKey(key);
          if (!k) return;
          required.add(k);
        };

        const scanQuestionList = (list) => {
          if (!Array.isArray(list)) return;
          for (const q of list) {
            if (!q) continue;
            const key = q.question_key || q.questionKey || q.key || q.name || q.id;
            if (key) pushKey(key);
          }
        };

        const scanAny = (node, depth = 0) => {
          if (!node || depth > 6) return;
          if (Array.isArray(node)) {
            for (const x of node) scanAny(x, depth + 1);
            return;
          }
          if (typeof node !== 'object') return;

          const listKeys = [
            'passenger_questions',
            'passengerQuestions',
            'passenger_questionnaire',
            'passengerQuestionnaire',
            'questions',
          ];
          for (const k of listKeys) {
            if (Array.isArray(node[k])) {
              scanQuestionList(node[k]);
            }
          }

          for (const [k, v] of Object.entries(node)) {
            if (k === 'metadata') continue;
            scanAny(v, depth + 1);
          }
        };

        const items = Array.isArray(cart && cart.items) ? cart.items : [];
        if (items.length) {
          for (const it of items) {
            const tid = it && it.trip_id ? String(it.trip_id) : '';
            if (tripIdSet.size && tid && !tripIdSet.has(tid)) continue;

            scanQuestionList(it && (it.passenger_questions || it.passengerQuestions));

            const reqMap = it && (it.required_passenger_questions || it.requiredPassengerQuestions);
            if (reqMap && typeof reqMap === 'object') {
              for (const key of Object.keys(reqMap)) {
                pushKey(key);
              }
            }

            scanAny(it);
          }
        }

        scanAny(cart);

        const requiredArr = Array.from(required);
        const allArr = Array.from(new Set([...requiredArr]));
        return { required: requiredArr, optional: [], all: allArr };
      } catch (_) {
        return { required: [], optional: [], all: [] };
      }
    };

    const passengerQuestions = extractPassengerQuestionsFromCart(existingCart, [actualTripId, actualReturnTripId].filter(Boolean));
    const allowedQuestionKeys = Array.isArray(passengerQuestions?.all) && passengerQuestions.all.length
      ? new Set(passengerQuestions.all.map((k) => normalizeQuestionKey(k)).filter(Boolean))
      : null;
    const requiredQuestionKeys = new Set(
      (Array.isArray(passengerQuestions?.required) ? passengerQuestions.required : [])
        .map((k) => normalizeQuestionKey(k))
        .filter(Boolean)
    );

    if (debug) console.log('🗺️  Step 9: Mapping passengers to Busbud format...');
    const mappedPassengers = passengers.map((passenger, index) => {
      if (process.env.NODE_ENV !== 'production') {
        console.log(`   - Mapping passenger ${index + 1}...`);
      }

      const p = passenger || {};

      // Generate fallback ID if neither idNumber nor id is provided
      const passengerId = p.idNumber || p.id || `passenger-${index + 1}-${Date.now()}`;

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

      const normalizeGender = (value) => {
        try {
          const s = String(value || '').trim().toLowerCase();
          if (!s) return '';
          if (s === 'm' || s === 'male' || s === 'man') return 'male';
          if (s === 'f' || s === 'female' || s === 'woman') return 'female';
          return s;
        } catch (_) {
          return '';
        }
      };

      const baseAnswers = Array.isArray(p.answers) ? p.answers : [];
      const answers = baseAnswers
        .map((a) => {
          if (!a || typeof a !== 'object') return null;
          const key = a.question_key || a.questionKey || a.key || a.question;
          const value = a.value ?? a.answer ?? a.response;
          if (key == null) return null;
          if (value == null) return null;
          const k = String(key).trim();
          const v = String(value).trim();
          if (!k || !v) return null;
          return { question_key: k, value: v };
        })
        .filter(Boolean);

      if (allowedQuestionKeys) {
        for (let i = answers.length - 1; i >= 0; i--) {
          const a = answers[i];
          const k = normalizeQuestionKey(a && a.question_key);
          if (!k || !allowedQuestionKeys.has(k)) {
            answers.splice(i, 1);
          }
        }
      }

      const hasGenderAnswer = answers.some((a) => String(a.question_key || '').trim().toLowerCase() === 'gender');
      if (!hasGenderAnswer) {
        const gender = normalizeGender(p.gender || p.sex || p.gender_identity);
        if (gender) {
          if (!allowedQuestionKeys || allowedQuestionKeys.has('gender')) {
            answers.push({ question_key: 'gender', value: gender });
          }
        }
      }

      const normalizeDob = (value) => {
        try {
          const s = String(value || '').trim();
          if (!s) return '';
          const d = s.includes('T') ? s.slice(0, 10) : s;
          return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : d;
        } catch (_) {
          return '';
        }
      };

      const hasDobAnswer = answers.some((a) => String(a.question_key || '').trim().toLowerCase() === 'dob');
      if (!hasDobAnswer) {
        const dob = normalizeDob(p.dateOfBirth || p.dob || p.date_of_birth);
        if (dob) {
          if (!allowedQuestionKeys || allowedQuestionKeys.has('dob')) {
            answers.push({ question_key: 'dob', value: dob });
          }
        }
      }

      const normalizeIdType = (value) => {
        try {
          const raw = String(value || '').trim().toLowerCase();
          if (!raw) return '';
          const s = raw.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
          if (s === 'passport') return 'passport';
          if (s === 'national_id' || s === 'nationalid' || s === 'nat_id' || s === 'id') return 'national_id';
          if (s === 'id_card' || s === 'idcard' || s === 'identity_card' || s === 'identitycard') return 'id_card';
          if (s === 'drivers_license' || s === 'driver_license' || s === 'driving_license' || s === 'driverslicence') return 'drivers_license';
          return s;
        } catch (_) {
          return '';
        }
      };

      const hasIdTypeAnswer = answers.some((a) => String(a.question_key || '').trim().toLowerCase() === 'id_type');
      if (!hasIdTypeAnswer) {
        const idType = normalizeIdType(p.idType || p.id_type || p.id_type_code);
        if (idType) {
          if (!allowedQuestionKeys || allowedQuestionKeys.has('id_type')) {
            answers.push({ question_key: 'id_type', value: idType });
          }
        }
      }

      const hasIdNumberAnswer = answers.some((a) => String(a.question_key || '').trim().toLowerCase() === 'id_number');
      if (!hasIdNumberAnswer) {
        const idNumberRaw = p.idNumber || p.id_number || (p.document && (p.document.number || p.document.id_number));
        const idNumber = String(idNumberRaw || '').trim();
        if (idNumber) {
          if (!allowedQuestionKeys || allowedQuestionKeys.has('id_number')) {
            answers.push({ question_key: 'id_number', value: idNumber });
          }
        }
      }

      const hasNationalityAnswer = answers.some((a) => String(a.question_key || '').trim().toLowerCase() === 'nationality');
      if (!hasNationalityAnswer) {
        const nationalityRaw = p.nationality || p.nationality_code || (p.document && (p.document.nationality || p.document.nationality_code));
        const nationality = String(nationalityRaw || '').trim();
        if (nationality) {
          if (!allowedQuestionKeys || allowedQuestionKeys.has('nationality')) {
            answers.push({ question_key: 'nationality', value: nationality });
          }
        }
      }

      try {
        for (const a of answers) {
          if (!a || typeof a !== 'object') continue;
          const k = String(a.question_key || '').trim().toLowerCase();
          if (!k) continue;
          if (k === 'gender') {
            a.value = normalizeGender(a.value);
          } else if (k === 'dob') {
            a.value = normalizeDob(a.value);
          } else if (k === 'id_type') {
            a.value = normalizeIdType(a.value);
          }
        }
        for (let i = answers.length - 1; i >= 0; i--) {
          const a = answers[i];
          if (!a || typeof a !== 'object') {
            answers.splice(i, 1);
            continue;
          }
          const k = String(a.question_key || '').trim();
          const v = String(a.value || '').trim();
          if (!k || !v) answers.splice(i, 1);
        }

        if (allowedQuestionKeys) {
          for (let i = answers.length - 1; i >= 0; i--) {
            const a = answers[i];
            const k = normalizeQuestionKey(a && a.question_key);
            if (!k || !allowedQuestionKeys.has(k)) {
              answers.splice(i, 1);
            }
          }
        }
      } catch (_) {
      }

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
        answers
      };

      if (process.env.NODE_ENV !== 'production') {
        console.log(`   - Mapped passenger ${index + 1}:`, JSON.stringify(mappedPassenger, null, 2));
      }
      return mappedPassenger;
    });

    const passengersMapped = mappedPassengers;

    try {
      if (requiredQuestionKeys && requiredQuestionKeys.size) {
        const requiredList = Array.from(requiredQuestionKeys);
        for (const key of requiredList) {
          if (!key) continue;
          const missingIndex = passengersMapped.findIndex((pp) => {
            const list = Array.isArray(pp && pp.answers) ? pp.answers : [];
            return !list.some((a) => normalizeQuestionKey((a && a.question_key) || '') === key && String((a && a.value) || '').trim());
          });
          if (missingIndex >= 0) {
            return res.status(400).json({
              success: false,
              error: 'PASSENGER_QUESTIONS_UNANSWERED',
              message: `PassengerQuestionsUnanswered: ${key}`,
              details: { index: missingIndex + 1 }
            });
          }
        }
      }
    } catch (_) {
    }

    if (process.env.NODE_ENV !== 'production') {
      console.log('\n' + '='.repeat(60));
      console.log('🔄 PASSENGER MAPPING PROCESS');
      console.log('='.repeat(60));
      console.log(`📋 Processing ${passengers.length} passengers...`);
      console.log('📦 Original passenger data:');
      passengers.forEach((p, index) => {
        console.log(`  Passenger ${index + 1}:`, JSON.stringify(p, null, 2));
      });
      console.log('='.repeat(60) + '\n');
    }

    // Ensure we have a Firestore cart mapped to this specific Busbud cartId early
    let firestoreCartId = null;
    firestoreCartId = await ensureFirestoreCartId(actualCartId, req.clientBranchCode || req.clientBranch || null);
    BusbudService.setfirestoreCartId(firestoreCartId);

    try {
      const now = new Date();
      await drizzleDb
        .insert(cartsPgTable)
        .values({
          cartId: firestoreCartId ? String(firestoreCartId) : String(actualCartId),
          busbudCartId: String(actualCartId),
          updatedAt: now,
          createdAt: now
        })
        .onConflictDoUpdate({
          target: cartsPgTable.cartId,
          set: {
            busbudCartId: String(actualCartId),
            updatedAt: now
          }
        });
    } catch (_) {
    }
    try {
      if (firestoreCartId) {
        const truthy = (v) => ['true', '1', 'yes', 'on'].includes(String(v || '').trim().toLowerCase());
        const agentObj = (req.body && (req.body.agent || req.body.agentContext || req.body.agent_context)) || null;
        const modeHdr = (req.get && req.get('x-agent-mode')) || (req.headers && req.headers['x-agent-mode']);
        const modeBody = req.body && (req.body.agentMode || req.body.agent_mode || (agentObj && (agentObj.agentMode || agentObj.agent_mode)));
        const modeQuery = req.query && (req.query.agentMode || req.query.agent_mode);
        const resolvedMode = truthy(modeHdr || modeBody || modeQuery);

        const agentIdHdr = (req.get && req.get('x-agent-id')) || (req.headers && req.headers['x-agent-id']);
        const agentId = agentIdHdr || (req.body && (req.body.agentId || req.body.agent_id)) || (req.query && (req.query.agentId || req.query.agent_id)) || (agentObj && (agentObj.agentId || agentObj.agent_id || agentObj.id)) || null;

        const agentEmailHdr = (req.get && req.get('x-agent-email')) || (req.headers && req.headers['x-agent-email']);
        const agentEmailRaw = agentEmailHdr || (req.body && (req.body.agentEmail || req.body.agent_email)) || (req.query && (req.query.agentEmail || req.query.agent_email)) || (agentObj && (agentObj.agentEmail || agentObj.agent_email || agentObj.emailLower || agentObj.email)) || null;

        let agentEmailFromId = null;
        if (!agentEmailRaw && agentId && String(agentId).trim()) {
          try {
            const agentRec = await getAgentById(agentId);
            const email = agentRec && (agentRec.emailLower || agentRec.email || agentRec.agentEmail) ? (agentRec.emailLower || agentRec.email || agentRec.agentEmail) : null;
            if (email && String(email).trim()) agentEmailFromId = String(email).trim().toLowerCase();
          } catch (_) {}
        }

        let fsAgentEmail = null;
        let fsAgentMode = null;
        try {
          const snap = await db.collection('carts').doc(String(firestoreCartId)).get();
          const data = snap && snap.exists ? (snap.data() || {}) : null;
          fsAgentEmail = data && (data.agentEmail || (data.agent && data.agent.agentEmail) || null);
          fsAgentMode = data && (data.agentMode || data.agent_mode || (data.agent && (data.agent.agentMode || data.agent.agent_mode)) || null);
        } catch (_) {}

        const hasAnyAgentSignal = Boolean(
          resolvedMode ||
          req.agentEmail ||
          truthy(fsAgentMode) ||
          (agentId && String(agentId).trim()) ||
          (agentEmailRaw && String(agentEmailRaw).trim()) ||
          (agentEmailFromId && String(agentEmailFromId).trim()) ||
          (fsAgentEmail && String(fsAgentEmail).trim())
        );
        const isAgentMode = Boolean(hasAnyAgentSignal);

        const busbudAgentEmailCandidate = (BusbudService && BusbudService.agentCtx && BusbudService.agentCtx.agentEmail)
          ? String(BusbudService.agentCtx.agentEmail).trim().toLowerCase()
          : null;
        const busbudAgentEmail = hasAnyAgentSignal ? busbudAgentEmailCandidate : null;

        const agentEmail = isAgentMode ? (agentEmailRaw || agentEmailFromId || req.agentEmail || fsAgentEmail || busbudAgentEmail || null) : null;

        if (debug) {
          console.log('🕵️ Agent context resolution (early)', {
            busbudCartId: actualCartId,
            firestoreCartId,
            modeHdr,
            modeBody,
            modeQuery,
            resolvedMode,
            reqAgentEmail: req.agentEmail || null,
            agentId,
            agentEmailHdr,
            agentEmailRaw,
            agentEmailFromId,
            fsAgentMode,
            fsAgentEmail,
            busbudAgentEmailCandidate,
            busbudAgentEmail,
            hasAnyAgentSignal,
            isAgentMode,
            agentEmail,
            agentName
          });
        }

        const agentNameHdr = (req.get && req.get('x-agent-name')) || (req.headers && req.headers['x-agent-name']);
        const agentName = agentNameHdr || (req.body && (req.body.agentName || req.body.agent_name)) || (req.query && (req.query.agentName || req.query.agent_name)) || (agentObj && (agentObj.agentName || agentObj.agent_name || agentObj.name)) || null;

        if (resolvedMode && !agentEmail) {
          throw new Error('AGENT_CONTEXT_MISSING');
        }

        if (isAgentMode && agentEmail) {
          if (debug) {
            console.log('🧾 Persisting agent context to Firestore cart', {
              firestoreCartId,
              agentId: agentId || null,
              agentEmail: String(agentEmail).trim().toLowerCase(),
              agentName: agentName || null
            });
          }
          await updateCart(String(firestoreCartId), {
            agentMode: true,
            ...(agentId ? { agentId } : {}),
            agentEmail: String(agentEmail).trim().toLowerCase(),
            ...(agentName ? { agentName } : {})
          });

          BusbudService.setAgentContext({
            agentMode: true,
            agentId: agentId || null,
            agentEmail: String(agentEmail).trim().toLowerCase(),
            agentName: agentName || null,
            firstName: null,
            lastName: null
          });
        }

        // Ensure a canonical Postgres carts row exists for this Firestore cart id (PNR)
        // so Recent Bookings can match the agent by bookedBy and display consistent details.
        if (isAgentMode && agentEmail) {
          try {
            const now = new Date();
            const bookedBySafe = String(agentName || '').trim() || String(agentEmail || '').trim().toLowerCase();
            if (debug) {
              console.log('🧾 Upserting canonical Postgres cart booked_by', {
                cartId: String(firestoreCartId),
                bookedBySafe: bookedBySafe || null
              });
            }
            await drizzleDb
              .insert(cartsPgTable)
              .values({
                cartId: String(firestoreCartId),
                busbudCartId: String(actualCartId),
                bookedBy: bookedBySafe || null,
                updatedAt: now,
                createdAt: now,
              })
              .onConflictDoUpdate({
                target: cartsPgTable.cartId,
                set: {
                  busbudCartId: String(actualCartId),
                  ...(bookedBySafe ? { bookedBy: bookedBySafe } : {}),
                  updatedAt: now,
                }
              });
          } catch (updateError) {
            console.warn('⚠️ Failed to upsert PostgreSQL cart booked_by:', updateError.message);
          }
        }
      }
    } catch (e) {
      if (e && e.message === 'AGENT_CONTEXT_MISSING') throw e;
    }

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
      (p.selected_seats || []).forEach(seat => {
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
    if (!isProduction) {
      console.log('📋 Current ticket types:', JSON.stringify(ticketTypes, null, 2));
    }

    // Final check: ensure we have at least one ticket type
    if (Object.keys(ticketTypes).length === 0) {
      console.warn('⚠️  No ticket types found, using default');
      ticketTypes['default'] = 'eticket';
      console.log('   - Using default ticket type');
    }

    if (!isProduction) {
      console.log('\n' + '='.repeat(60));
      console.log('✅ PASSENGER MAPPING COMPLETE');
      console.log('='.repeat(60));
      console.log('📋 Final mapped passengers for Busbud API:');
    }
    if (!isProduction) {
      passengersMapped.forEach((p, index) => {
        console.log(`  Passenger ${index + 1}:`, JSON.stringify(p, null, 2));
      });
      console.log('='.repeat(60) + '\n');
    }

    if (!isProduction) {
      console.log('📤 Calling BusbudService.updateTripPassengers...');

      console.log(`   - cartId: ${actualCartId}`);
      console.log(`   - tripId: ${actualTripId}`);
    }
    if (!isProduction) {
      console.log(`   - passengers count: ${passengersMapped.length}`);
      console.log(`   - ticket types:`, JSON.stringify(ticketTypes, null, 2));
    }

    const busbudResponse = await BusbudService.updateTripPassengers(
      actualCartId,
      actualTripId,
      { locale: 'en-US', currency: 'USD', savePassengerQuestionAnswers: true },
      passengersMapped,
      ticketTypes
    );

    // If return trip provided, update its passengers as well
    if (actualReturnTripId) {
      if (!isProduction) {
        console.log('📤 Calling BusbudService.updateTripPassengers for return trip...');
      }
      await BusbudService.updateTripPassengers(
        actualCartId,
        actualReturnTripId,
        { locale: 'en-US', currency: 'USD', savePassengerQuestionAnswers: true },
        passengersMapped,
        ticketTypes
      );
    }

    if (!isProduction) {
      console.log('📥 Step 11 PASSED: Busbud passenger response:', JSON.stringify(busbudResponse, null, 2));
      console.log('💰 Step 12: Updating purchaser details...');
    }
    const purchaserPayload = {
      first_name: purchaser.first_name,
      last_name: purchaser.last_name,
      email: purchaser.email,
      phone: purchaser.phone,
      opt_in_marketing: purchaser.opt_in_marketing
    };

    if (!isProduction) {
      console.log(`📤 Calling BusbudService.updatePurchaserDetails for cartId: ${actualCartId}`);
      console.log('📝 Purchaser payload:', JSON.stringify(purchaserPayload, null, 2));
    }

    const purchaserResponse = await BusbudService.updatePurchaserDetails(actualCartId, purchaserPayload);
    if (!isProduction) {
      console.log('📥 Step 12 PASSED: Purchaser response:', JSON.stringify(purchaserResponse, null, 2));
    }

    if (!purchaserResponse || purchaserResponse.error) {
      if (!isProduction) {
        console.error(`❌ API ERROR: Busbud API error for purchaser details:`, JSON.stringify(purchaserResponse, null, 2));
      }
      throw new Error(`Failed to update purchaser details for cartId: ${actualCartId}`);
    }


    const charges = await BusbudService.getLatestCharges(actualCartId);
    if (!isProduction) {
      console.log('💰 Step 13 PASSED: Busbud charges response:', JSON.stringify(charges, null, 2));
    }

    if (!charges || charges.error) {
      if (!isProduction) {
        console.error(`❌ API ERROR: Busbud API error for charges:`, JSON.stringify(charges, null, 2));
      }
      throw new Error(`Failed to get charges for cartId: ${actualCartId}`);
    }


    const acceptCharges = await BusbudService.putLatestCharges(actualCartId, charges);
    if (!isProduction) {
      console.log('💰 Step 14 PASSED: Busbud accept charges response:', JSON.stringify(acceptCharges, null, 2));
    }

    if (!acceptCharges || acceptCharges.error) {
      if (!isProduction) {
        console.error(`❌ API ERROR: Busbud API error for accept charges:`, JSON.stringify(acceptCharges, null, 2));
      }
      throw new Error(`Failed to accept charges for cartId: ${actualCartId}`);
    }



    //   ODOO INTEGRATION --- ------  iNVOICE CREATION

    // Create initial confirmation object
    const confirmation = {
      success: true,
      cartId: actualCartId,
      firestoreCartId: firestoreCartId || null,
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
      if (!isProduction) {
        console.log('🔄 Hold is true, creating invoice...');
        // Log environment variables for debugging (without sensitive data)
        console.log('🔍 Environment variables:', {
          hasUrl: !!process.env.TRAVELMASTER_URL,
          hasDb: !!process.env.TRAVELMASTER_DB,
          hasUsername: !!process.env.TRAVELMASTER_USERNAME,
          hasPassword: !!(process.env.TRAVELMASTER_PASSWORD || process.env.TRAVELMASTER_API_KEY)
        });
      }

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

        // Use request-scoped Firestore cart id (do not rely on global BusbudService state)
        const fsCartId = firestoreCartId;
        if (!fsCartId) throw new Error('firestoreCartId is not set');

        const pgCart = await getCartFromPostgres(actualCartId);
        let cartData = null;
        if (pgCart) {
          cartData = {
            busbudCartId: pgCart.busbudCartId,
            status: pgCart.status,
            currency: pgCart.currency,
            purchaser: pgCart.purchaser,
            purchaserDetails: pgCart.purchaser,
            passengers: pgCart.passengers,
            busbudResponse: pgCart.busbudResponse,
            passengerDetails: {
              busbudResponse: pgCart.busbudResponse
            },
            pricing_metadata: null
          };
        } else {
          // Get cart data using the firestoreCartId as the document ID
          const cartDoc = await db.collection('carts').doc(fsCartId).get();

          if (!cartDoc.exists) {
            throw new Error(`Cart with ID ${fsCartId} not found in Firestore`);
          }

          cartData = cartDoc.data();
          console.log(`✅ Found cart in Firestore with ID: ${fsCartId}`);
        }

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
          const firestoreCarts = await getCartsByUserId(firestoreCartId);
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
          cartId: firestoreCartId,
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

        const retailPrice = passengerBusbud.retail_price || passengerBusbud.adjusted_charges;
        const charges = passengerBusbud.charges || passengerBusbud;

        // Try to base invoice pricing on Busbud's original_charges (cart total in cents)
        // and apply the SAME price adjustments we use for search results, so the
        // invoice matches the frontend trip price.
        const originalCharges =
          passengerBusbud.cost_price ||
          passengerBusbud.original_charges ||
          (retailPrice && retailPrice.metadata && retailPrice.metadata.original_charges);

        let invoiceBaseAmount;
        let currency;

        if (retailPrice && typeof retailPrice.total === 'number' && retailPrice.total > 0) {
          invoiceBaseAmount = retailPrice.total / 100;
          currency = retailPrice.currency || charges?.currency || 'USD';
        } else {
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
            throw new Error('Missing or invalid retail_price data in cart; expected retail_price.total and at least one item');
          }
        }

console.log('💵 Price data for invoice:', {
  firestoreTotalAmount: cartData.totalAmount,
  busbudAdjustedTotal: retailPrice && retailPrice.total,
  chosenInvoiceBaseAmount: invoiceBaseAmount,
  originalChargesTotal: charges?.total,
  currency,
  itemAmounts: retailPrice && Array.isArray(retailPrice.items) ? retailPrice.items.map(it => it.amount) : []
});

        // Extract segment details from existing Busbud cart data, Postgres snapshots, or busbudResponse.
        // We no longer persist trip._raw in Firestore, so rely on safer sources.
        let segments = [];
        let tripLegs = [];

        // Prefer trip selection snapshot from Postgres when available for this cart
        let pgSegments = [];
        let pgTripLegs = [];
        try {
          const pgRows = await drizzleDb
            .select({ raw: tripSelections.raw })
            .from(tripSelections)
            .where(eq(tripSelections.cartId, String(actualCartId)))
            .orderBy(desc(tripSelections.createdAt))
            .limit(1);

          if (pgRows && pgRows.length && pgRows[0].raw) {
            const pgRaw = pgRows[0].raw;
            console.log('✅ Loaded trip selection from Postgres for trip details', {
              cartId: actualCartId
            });

            if (Array.isArray(pgRaw.items) && pgRaw.items.length > 0) {
              const item0 = pgRaw.items[0];
              if (Array.isArray(item0.segments)) {
                pgSegments = item0.segments;
              }
              if (Array.isArray(item0.trip_legs)) {
                pgTripLegs = item0.trip_legs;
              }
            }

            if (pgSegments.length === 0) {
              if (Array.isArray(pgRaw.segments)) {
                pgSegments = pgRaw.segments;
              } else if (Array.isArray(pgRaw.trips) && pgRaw.trips[0] && Array.isArray(pgRaw.trips[0].segments)) {
                pgSegments = pgRaw.trips[0].segments;
              }
            }

            if (pgTripLegs.length === 0) {
              if (Array.isArray(pgRaw.trip_legs)) {
                pgTripLegs = pgRaw.trip_legs;
              } else if (Array.isArray(pgRaw.trips) && Array.isArray(pgRaw.trips[0]?.trip_legs)) {
                pgTripLegs = pgRaw.trips[0].trip_legs;
              }
            }
          }
        } catch (pgError) {
          console.warn('⚠️ Failed to load trip selection from Postgres for trip details', {
            cartId: actualCartId,
            error: pgError.message
          });
        }

        if (pgSegments.length > 0) {
          segments = pgSegments;
          if (pgTripLegs.length > 0) {
            tripLegs = pgTripLegs;
          }
        }

        // Prefer segments/trip_legs from the live Busbud cart we fetched earlier
        if (segments.length === 0 && Array.isArray(existingCart?.items) && existingCart.items.length > 0) {
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
          (Array.isArray(retailPrice?.items)
            ? retailPrice.items.length
            : Array.isArray(charges?.items)
              ? charges.items.length
              : 0) ||
          1;

        const totalAdjusted = invoiceBaseAmount;
        const totalAdjustedNum = (typeof totalAdjusted === 'number' && Number.isFinite(totalAdjusted))
          ? totalAdjusted
          : Number(totalAdjusted);
        const totalAdjustedSafe = (Number.isFinite(totalAdjustedNum) && totalAdjustedNum > 0)
          ? Number(totalAdjustedNum.toFixed(2))
          : 0;
        const linePrice = totalAdjustedSafe;
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

          quantity: 1,
          price_unit: linePrice,
          price_total: totalAdjustedSafe,
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
          payment_reference: firestoreCartId,
          invoice_date: new Date().toISOString().split('T')[0],
          move_type: 'out_invoice',
          invoice_line_ids: invoiceLines.map(line => [0, 0, line]),
          amount_untaxed: totalAdjustedSafe,
          amount_tax: 0, // Set to 0 as we're handling tax inclusive pricing
          amount_total: totalAdjustedSafe,
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

        // Get cart expiration date/ttl from busbud response
        // Prefer Postgres carts.expires_at (expiresAt) over legacy TTL fields.
        let cartExpiryDate =
          cartData.expiresAt ||
          cartData.expires_at ||
          cartData.busbudResponse?.metadata?.ttl ||
          cartData.busbudResponse?.metadata?.pollTtl ||
          cartData.metadata?.ttl ||
          cartData._ttl ||
          existingCart?.metadata?.ttl ||
          existingCart?._ttl;

        if (!cartExpiryDate) {
          try {
            let ttlFirestoreCartId = firestoreCartId || null;
            if (!ttlFirestoreCartId) {
              const snap = await db.collection('carts').where('busbudCartId', '==', actualCartId).limit(1).get();
              if (!snap.empty) {
                ttlFirestoreCartId = snap.docs[0].id;
              }
            }

            if (ttlFirestoreCartId) {
              const doc = await db.collection('carts').doc(ttlFirestoreCartId).get();
              const d = doc.exists ? doc.data() : null;
              cartExpiryDate = d?.expiresAt || d?._ttl || d?.metadata?.ttl || null;
            }
          } catch (e) {}
        }

        if (!cartExpiryDate) {
          console.warn('⚠️ Cart expiration date not found; defaulting to +24h', { cartId: actualCartId });
          cartExpiryDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
        }

        // Parse TTL robustly: supports ISO date, epoch ms, or seconds offset
        let expiryDate = null;
        try {
          if (cartExpiryDate instanceof Date) {
            expiryDate = cartExpiryDate;
          } else if (typeof cartExpiryDate === 'number') {
            // Heuristic: big numbers are epoch ms, small numbers are seconds from now
            expiryDate = cartExpiryDate > 1e12
              ? new Date(cartExpiryDate)
              : new Date(Date.now() + cartExpiryDate * 1000);
          } else if (typeof cartExpiryDate === 'string') {
            const trimmed = cartExpiryDate.trim();
            const asNum = Number(trimmed);
            if (trimmed && /^\d+$/.test(trimmed) && Number.isFinite(asNum)) {
              expiryDate = asNum > 1e12
                ? new Date(asNum)
                : new Date(Date.now() + asNum * 1000);
            } else {
              expiryDate = new Date(trimmed);
            }
          }
        } catch (_) {}
        if (!expiryDate || isNaN(expiryDate.getTime())) {
          console.warn('⚠️ Could not parse cart TTL, defaulting to +24h', { cartExpiryDate });
          expiryDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
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
            // IMPORTANT: use the exact payment reference used in Odoo (Firestore cart ID),
            // so agent confirmation and downstream flows reference the same PNR.
            pnr: invoiceData.payment_reference,
            number: `INV-${invoiceId}`,
            total: totalAdjusted,
            currency,
            expiresAt: expiryDate.toISOString(),
            status: 'posted'
          };

          confirmation.requiresPayment = true;

          let responseFirestoreCartId = firestoreCartId || null;
          if (!responseFirestoreCartId) {
            try {
              const snap = await db.collection('carts').where('busbudCartId', '==', actualCartId).limit(1).get();
              if (!snap.empty) {
                responseFirestoreCartId = snap.docs[0].id;
              }
            } catch (e) {}
          }

          const paymentRef = invoiceData.payment_reference;

          // Persist hold metadata on the cart for frontend to render a reserved ticket
          try {
            if (responseFirestoreCartId) {
              await updateCart(String(responseFirestoreCartId), {
                status: 'awaiting_payment',
                invoice: {
                  id: invoiceId,
                  pnr: paymentRef,
                  number: `INV-${invoiceId}`,
                  total: totalAdjusted,
                  currency,
                  expiresAt: expiryDate.toISOString(),
                  posted: true
                }
              });
            }
          } catch (e) {
            console.warn('⚠️ Failed to persist hold invoice metadata to Firestore cart', { cartId: responseFirestoreCartId, error: e.message });
          }

          // Persist awaiting-payment status + price to Postgres carts table.
          // Recent bookings (awaiting payment) must display the amount from Postgres.
          try {
            const now = new Date();
            const retail = typeof totalAdjusted === 'number' ? totalAdjusted : Number(totalAdjusted);
            const currencySafe = (currency && String(currency).trim()) ? String(currency).trim() : 'USD';

            const canonicalCartId = responseFirestoreCartId
              ? String(responseFirestoreCartId)
              : (paymentRef ? String(paymentRef) : String(actualCartId));

            const truthy = (v) => ['true', '1', 'yes', 'on'].includes(String(v || '').trim().toLowerCase());
            const agentObj = (req.body && (req.body.agent || req.body.agentContext || req.body.agent_context)) || null;
            const modeHdr = (req.get && req.get('x-agent-mode')) || (req.headers && req.headers['x-agent-mode']);
            const modeBody = req.body && (req.body.agentMode || req.body.agent_mode || (agentObj && (agentObj.agentMode || agentObj.agent_mode)));
            const modeQuery = req.query && (req.query.agentMode || req.query.agent_mode);
            const resolvedMode = truthy(modeHdr || modeBody || modeQuery);

            const agentIdHdr = (req.get && req.get('x-agent-id')) || (req.headers && req.headers['x-agent-id']);
            const agentId = agentIdHdr || (req.body && (req.body.agentId || req.body.agent_id)) || (req.query && (req.query.agentId || req.query.agent_id)) || (agentObj && (agentObj.agentId || agentObj.agent_id || agentObj.id)) || null;

            const agentEmailHdr = (req.get && req.get('x-agent-email')) || (req.headers && req.headers['x-agent-email']);
            const agentEmailRaw = agentEmailHdr || (req.body && (req.body.agentEmail || req.body.agent_email)) || (req.query && (req.query.agentEmail || req.query.agent_email)) || (agentObj && (agentObj.agentEmail || agentObj.agent_email || agentObj.emailLower || agentObj.email)) || null;

            let agentEmailFromId = null;
            if (!agentEmailRaw && agentId && String(agentId).trim()) {
              try {
                const agentRec = await getAgentById(agentId);
                const email = agentRec && (agentRec.emailLower || agentRec.email || agentRec.agentEmail) ? (agentRec.emailLower || agentRec.email || agentRec.agentEmail) : null;
                if (email && String(email).trim()) agentEmailFromId = String(email).trim().toLowerCase();
              } catch (_) {}
            }

            const hasAnyAgentSignal = Boolean(
              resolvedMode ||
              req.agentEmail ||
              (agentId && String(agentId).trim()) ||
              (agentEmailRaw && String(agentEmailRaw).trim()) ||
              (agentEmailFromId && String(agentEmailFromId).trim())
            );

            const busbudAgentEmailCandidate = (BusbudService && BusbudService.agentCtx && BusbudService.agentCtx.agentEmail)
              ? String(BusbudService.agentCtx.agentEmail).trim().toLowerCase()
              : null;
            const busbudAgentEmail = hasAnyAgentSignal ? busbudAgentEmailCandidate : null;

            let bookedBySafe = null;
            const direct = agentEmailRaw || agentEmailFromId || req.agentEmail || busbudAgentEmail || null;
            if (direct && String(direct).trim()) bookedBySafe = String(direct).trim().toLowerCase();

            if (debug) {
              console.log('🕵️ Agent context resolution (awaiting_payment upsert)', {
                busbudCartId: actualCartId,
                responseFirestoreCartId,
                canonicalCartId,
                modeHdr,
                modeBody,
                modeQuery,
                resolvedMode,
                reqAgentEmail: req.agentEmail || null,
                agentId,
                agentEmailHdr,
                agentEmailRaw,
                agentEmailFromId,
                busbudAgentEmailCandidate,
                busbudAgentEmail,
                hasAnyAgentSignal,
                bookedBySafe
              });
            }

            if (!bookedBySafe && responseFirestoreCartId) {
              try {
                const snap = await db.collection('carts').doc(String(responseFirestoreCartId)).get();
                const data = snap && snap.exists ? (snap.data() || {}) : null;
                const fsAgentEmail = data && (data.agentEmail || (data.agent && data.agent.agentEmail) || null);
                const fsAgentMode = data && (data.agentMode || data.agent_mode || (data.agent && (data.agent.agentMode || data.agent.agent_mode)) || null);
                if (fsAgentEmail && String(fsAgentEmail).trim()) {
                  bookedBySafe = String(fsAgentEmail).trim().toLowerCase();
                }
                if (!bookedBySafe && resolvedMode && truthy(fsAgentMode)) {
                  throw new Error('AGENT_CONTEXT_MISSING');
                }
              } catch (e) {
                if (e && e.message === 'AGENT_CONTEXT_MISSING') throw e;
              }
            }

            if (resolvedMode && !bookedBySafe) {
              throw new Error('AGENT_CONTEXT_MISSING');
            }

            if (debug) {
              console.log('🧾 Upserting awaiting_payment Postgres cart', {
                cartId: canonicalCartId,
                status: 'awaiting_payment',
                bookedBy: bookedBySafe || null,
                currency: currencySafe,
                retailPrice: Number.isFinite(retail) ? retail : null
              });
            }

            const safeIso = (v) => {
              try {
                if (!v) return null;
                const d = v instanceof Date ? v : new Date(v);
                const t = d.getTime();
                return Number.isNaN(t) ? null : d.toISOString();
              } catch (_) {
                return null;
              }
            };

            const originSafe = (tripDetails && (tripDetails.originCity || tripDetails.origin)) ? String(tripDetails.originCity || tripDetails.origin) : null;
            const destinationSafe = (tripDetails && (tripDetails.destinationCity || tripDetails.destination)) ? String(tripDetails.destinationCity || tripDetails.destination) : null;
            const departAtSafe = safeIso(tripDetails && (tripDetails.departureTime || tripDetails.departure_time || tripDetails.departAt || tripDetails.depart_at));
            const arriveAtSafe = safeIso(tripDetails && (tripDetails.arrivalTime || tripDetails.arrival_time || tripDetails.arriveAt || tripDetails.arrive_at));
            const returnOriginSafe = (returnTripDetails && (returnTripDetails.originCity || returnTripDetails.origin)) ? String(returnTripDetails.originCity || returnTripDetails.origin) : null;
            const returnDestinationSafe = (returnTripDetails && (returnTripDetails.destinationCity || returnTripDetails.destination)) ? String(returnTripDetails.destinationCity || returnTripDetails.destination) : null;
            const returnDepartAtSafe = safeIso(returnTripDetails && (returnTripDetails.departureTime || returnTripDetails.departure_time || returnTripDetails.departAt || returnTripDetails.depart_at));
            const returnArriveAtSafe = safeIso(returnTripDetails && (returnTripDetails.arrivalTime || returnTripDetails.arrival_time || returnTripDetails.arriveAt || returnTripDetails.arrive_at));
            const passengerCountSafe = (typeof passengerCount === 'number' && passengerCount > 0) ? passengerCount : null;

            await drizzleDb
              .insert(cartsPgTable)
              .values({
                cartId: canonicalCartId,
                busbudCartId: String(actualCartId),
                bookedBy: bookedBySafe,
                status: 'awaiting_payment',
                currency: currencySafe,
                retailPrice: Number.isFinite(retail) ? retail : null,
                origin: originSafe,
                destination: destinationSafe,
                departAt: departAtSafe,
                arriveAt: arriveAtSafe,
                returnOrigin: returnOriginSafe,
                returnDestination: returnDestinationSafe,
                returnDepartAt: returnDepartAtSafe,
                returnArriveAt: returnArriveAtSafe,
                passengerCount: passengerCountSafe,
                updatedAt: now,
                createdAt: now,
              })
              .onConflictDoUpdate({
                target: cartsPgTable.cartId,
                set: {
                  busbudCartId: String(actualCartId),
                  ...(bookedBySafe ? { bookedBy: bookedBySafe } : {}),
                  status: sql`CASE WHEN ${cartsPgTable.status} IN ('confirmed','paid') THEN ${cartsPgTable.status} ELSE 'awaiting_payment' END`,
                  currency: currencySafe,
                  retailPrice: Number.isFinite(retail) ? retail : undefined,
                  origin: originSafe || undefined,
                  destination: destinationSafe || undefined,
                  departAt: departAtSafe || undefined,
                  arriveAt: arriveAtSafe || undefined,
                  returnOrigin: returnOriginSafe || undefined,
                  returnDestination: returnDestinationSafe || undefined,
                  returnDepartAt: returnDepartAtSafe || undefined,
                  returnArriveAt: returnArriveAtSafe || undefined,
                  passengerCount: passengerCountSafe != null ? passengerCountSafe : undefined,
                  updatedAt: now,
                }
              });
          } catch (e) {
            if (e && e.message === 'AGENT_CONTEXT_MISSING') throw e;
            console.warn('⚠️ Failed to persist awaiting-payment price to Postgres cart', { cartId: actualCartId, error: e.message });
          }

          // Auto-create a hold ticket document so the frontend can render it without an extra API call
          try {
            if (responseFirestoreCartId) {
              const fmt2 = (n) => String(n).padStart(2, '0');
              const fmtDate = (d) => `${fmt2(d.getDate())}/${fmt2(d.getMonth() + 1)}/${d.getFullYear()}`;
              const fmtTime = (d) => `${fmt2(d.getHours())}:${fmt2(d.getMinutes())}`;

              const departDate = tripDetails && tripDetails.departureTime ? fmtDate(tripDetails.departureTime) : '—';
              const departTime = tripDetails && tripDetails.departureTime ? fmtTime(tripDetails.departureTime) : '—';
              const arriveDate = tripDetails && tripDetails.arrivalTime ? fmtDate(tripDetails.arrivalTime) : '—';
              const arriveTime = tripDetails && tripDetails.arrivalTime ? fmtTime(tripDetails.arrivalTime) : '—';

              const passengerCountSafe = typeof passengerCount === 'number' && passengerCount > 0 ? passengerCount : 1;
              const perPassenger = Number(totalAdjusted) / passengerCountSafe;
              const perLeg = returnTripDetails ? perPassenger / 2 : perPassenger;
              const unitPriceText = Number.isFinite(perLeg) ? perLeg.toFixed(2) : null;
              const paymentMethodLabel = 'Awaiting payment';

              const holdOptions = {
                pnr: paymentRef,
                ref_no: paymentRef,
                ticket: {
                  ref_no: paymentRef,
                  ticket_no: null,
                  seat_no: '—',
                  price: unitPriceText ? `$${unitPriceText} [${paymentMethodLabel}]` : null,
                  booked_by: (purchaser && (purchaser.email || purchaser.firstName)) || 'online'
                },
                passenger: {
                  name: `${purchaser && purchaser.firstName ? purchaser.firstName : ''} ${purchaser && purchaser.lastName ? purchaser.lastName : ''}`.trim(),
                  phone: purchaser && (purchaser.phone || purchaser.phoneNumber) || null
                },
                itinerary: {
                  depart_city: tripDetails && (tripDetails.originCity || tripDetails.origin) || '—',
                  depart_date: departDate,
                  depart_time: departTime,
                  arrive_city: tripDetails && (tripDetails.destinationCity || tripDetails.destination) || '—',
                  arrive_date: arriveDate,
                  arrive_time: arriveTime
                },
                contact: {
                  phone: (purchaser && (purchaser.phone || purchaser.phoneNumber)) || null
                },
                qrDataUrl: null,
                price: (typeof totalAdjusted === 'number') ? `${totalAdjusted.toFixed(2)} ${currency || 'USD'}` : null,
                operatorName: tripDetails && tripDetails.operator || null
              };

              const ticketId = `ticket_${Date.now()}`;
              await db.collection('carts').doc(String(responseFirestoreCartId)).collection('tickets').doc(ticketId).set({
                id: ticketId,
                cartId: String(responseFirestoreCartId),
                status: 'pending',
                type: 'hold',
                isHold: true,
                pnr: paymentRef,
                options: holdOptions,
                updatedAt: new Date().toISOString()
              });

              try {
                const __base = process.env.INTERNAL_API_BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
                axios
                  .get(`${__base}/api/ticket/hold/pdf/${encodeURIComponent(String(responseFirestoreCartId))}`)
                  .catch(() => {});
              } catch (_) {}
            }
          } catch (e) {
            console.warn('⚠️ Failed to auto-create hold ticket document', { cartId: responseFirestoreCartId, error: e.message });
          }

          return res.json({
            success: true,
            message: 'Invoice created and posted',
            cartId: actualCartId,
            firestoreCartId: responseFirestoreCartId,
            status: 'awaiting_payment',
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
    
    let responseFirestoreCartId = firestoreCartId || null;
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
      firestoreCartId: (firestoreCartId || BusbudService.firestoreCartId) || null,
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
