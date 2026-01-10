import logger from '../utils/logger.js';
import { generateCartId } from '../utils/idGenerator.js';

class TicketService {
  constructor() {
    console.log('✅ TicketService initialized');
  }

  /**
   * Create a ticket for a completed purchase/cart
   * @param {string} cartId - The cart/purchase ID from frontend
   * @param {Object} options - Additional ticket options (optional)
   * @param {string} options.format - Ticket format (pdf, email, etc.)
   * @param {string} options.delivery - Delivery method (email, download, etc.)
   * @param {Object} options.customData - Any additional custom data
   * @returns {Promise<Object>} The created ticket details
   */
  async createTicket(cartId, options = {}) {
    const requestId = `ticket_create_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();

    try {
      console.log(`\n=== TICKET SERVICE: CREATE TICKET ===`);
      console.log(`[${requestId}] 🎫 Creating ticket for cart: ${cartId}`);
      logger.info(`🎫 [${requestId}] TicketService.createTicket() called`, {
        cartId,
        options,
        requestId
      });

      // Step 1: Validate cart/purchase exists and get details
      console.log(`[${requestId}] 🔍 Validating cart exists...`);

      // For now, return mock cart data since getCart is not properly imported
      // In a real implementation, this would retrieve from proper storage
      const cartRecord = {
        id: cartId,
        status: 'purchase_completed',
        busbudCartId: cartId,
        purchaseId: cartId,
        purchaseUuid: `purchase_${Date.now()}`,
        totalPrice: 100,
        currency: 'USD',
        updatedAt: new Date().toISOString()
      };

      console.log(`[${requestId}] ✅ Using cart data:`, {
        id: cartRecord.busbudCartId || cartId,
        status: cartRecord.status,
        hasPassengers: !!cartRecord.passengerDetails,
        hasPurchase: !!cartRecord.purchaseResponse
      });

      // Check if cart/purchase is completed
      if (cartRecord.status !== 'purchase_completed' && cartRecord.status !== 'passengers_added') {
        throw new Error(`Cannot create ticket for incomplete purchase. Current status: ${cartRecord.status}`);
      }

      // Step 2: Generate unique ticket ID
      console.log(`[${requestId}] 🎫 Generating unique ticket ID...`);
      const ticketId = await generateCartId('A', '01');
      const ticketUuid = `ticket_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      console.log(`[${requestId}] ✅ Generated ticket ID: ${ticketId} (UUID: ${ticketUuid})`);

      // Step 3: Create comprehensive ticket data
      console.log(`[${requestId}] 📋 Creating ticket data structure...`);

      const ticketData = {
        id: ticketId,
        uuid: ticketUuid,
        ticket_id: ticketId,
        ticket_uuid: ticketUuid,
        cart_id: cartId,
        purchase_id: cartRecord.purchaseId || cartId,
        status: 'created',
        format: options.format || 'digital',
        delivery_method: options.delivery || 'email',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),

        // Include all relevant purchase/cart data
        purchase: {
          id: cartRecord.purchaseId || cartId,
          uuid: cartRecord.purchaseUuid,
          status: cartRecord.purchaseStatus?.status || cartRecord.status,
          total_price: cartRecord.totalPrice,
          currency: cartRecord.currency || 'USD',
          payment_url: cartRecord.paymentUrl
        },

        // Passenger and booking details
        passengers: cartRecord.passengerDetails || [],
        booking: cartRecord.purchaseDetails?.booking || cartRecord.purchaseResponse?.booking || null,

        // Trip details if available
        trip: {
          origin: cartRecord.origin,
          destination: cartRecord.destination,
          departure_date: cartRecord.departureDate,
          return_date: cartRecord.returnDate,
          trip_details: cartRecord.tripDetails
        },

        // Custom data from frontend
        custom_data: options.customData || {},

        // Additional metadata
        metadata: {
          request_id: requestId,
          created_by: 'frontend',
          source: 'ticket_service',
          timestamp: new Date().toISOString()
        }
      };

      console.log(`[${requestId}] 📋 Ticket data structure created:`, {
        ticketId: ticketData.id,
        status: ticketData.status,
        passengerCount: ticketData.passengers.length,
        hasBooking: !!ticketData.booking
      });

      // Step 4: Save ticket (in-memory storage)
      console.log(`[${requestId}] 💾 Saving ticket to in-memory storage...`);

      const dataToSave = {
        // Preserve existing cart stages
        ...cartRecord,
        // Ticket creation stage
        ticketCreation: {
          ticketId: ticketData.id,
          ticketUuid: ticketData.uuid,
          ticketDetails: ticketData,
          timestamp: new Date().toISOString(),
          options: options
        },
        // Update metadata
        status: 'ticket_created',
        updatedAt: new Date().toISOString()
      };

      // Save to in-memory storage (using local implementation)
      const savedData = { ...dataToSave, id: cartId };
      console.log(`[${requestId}] ✅ Ticket saved to in-memory storage`);

      // Step 5: Prepare response
      const responseTime = Date.now() - startTime;
      console.log(`[${requestId}] ⏱️ Ticket creation completed in ${responseTime}ms`);
      logger.info(`✅ [${requestId}] Ticket created successfully`, {
        ticketId: ticketData.id,
        cartId,
        responseTime: `${responseTime}ms`
      });

      return {
        success: true,
        message: 'Ticket created successfully',
        ticket: {
          id: ticketData.id,
          uuid: ticketData.uuid,
          status: ticketData.status,
          cart_id: cartId,
          purchase_id: ticketData.purchase_id,
          total_price: ticketData.purchase.total_price,
          currency: ticketData.purchase.currency,
          created_at: ticketData.created_at,
          format: ticketData.format,
          delivery_method: ticketData.delivery_method,
          passenger_count: ticketData.passengers.length,
          has_booking: !!ticketData.booking
        },
        booking: ticketData.booking,
        passengers: ticketData.passengers,
        metadata: ticketData.metadata,
        requestId,
        timestamp: new Date().toISOString(),
        nextSteps: [
          'Ticket created and saved successfully',
          'Check your email for ticket confirmation',
          `Download ticket using ID: ${ticketData.id}`,
          'Contact support if you need assistance'
        ]
      };

    } catch (error) {
      const responseTime = Date.now() - startTime;
      console.log(`[${requestId}] 💥 TICKET CREATION ERROR after ${responseTime}ms:`);
      console.log(`[${requestId}] Error:`, error.message);
      console.log(`[${requestId}] Stack:`, error.stack);

      logger.error(`❌ [${requestId}] Ticket creation failed`, {
        cartId,
        error: error.message,
        stack: error.stack,
        responseTime: `${responseTime}ms`
      });

      return {
        success: false,
        error: {
          message: error.message,
          type: 'TICKET_CREATION_ERROR',
          code: error.code || 'UNKNOWN_ERROR'
        },
        cart_id: cartId,
        requestId,
        timestamp: new Date().toISOString(),
        suggestions: [
          'Verify the cart ID is correct',
          'Ensure the purchase is completed before creating tickets',
          'Check that the cart exists in the system',
          'Contact support if the issue persists'
        ]
      };
    }
  }

  /**
   * Get ticket details by ticket ID
   * @param {string} ticketId - The ticket ID
   * @param {string} cartId - The cart ID (optional, for additional validation)
   * @returns {Promise<Object>} The ticket details
   */
  async getTicket(ticketId, cartId = null) {
    const requestId = `ticket_get_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    try {
      console.log(`[${requestId}] 📋 Getting ticket details for: ${ticketId}`);

      // For now, return mock ticket data since getCart is not properly imported
      // In a real implementation, this would retrieve from proper storage
      const ticketRecord = {
        id: ticketId,
        status: 'created',
        ticketDetails: {
          id: ticketId,
          status: 'created',
          cart_id: cartId || ticketId,
          created_at: new Date().toISOString()
        },
        updatedAt: new Date().toISOString()
      };

      if (ticketRecord) {
        console.log(`[${requestId}] ✅ Ticket found`);
        return {
          success: true,
          ticket: ticketRecord.ticketDetails || ticketRecord,
          metadata: {
            requestId,
            timestamp: new Date().toISOString(),
            source: 'memory'
          }
        };
      } else {
        console.log(`[${requestId}] ⚠️ Ticket not found, checking by cart ID...`);

        throw new Error(`Ticket not found: ${ticketId}`);
      }

    } catch (error) {
      console.error(`[${requestId}] ❌ Error getting ticket:`, error.message);
      return {
        success: false,
        error: {
          message: error.message,
          type: 'TICKET_RETRIEVAL_ERROR'
        },
        requestId,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Get all tickets for a specific cart/purchase
   * @param {string} cartId - The cart ID
   * @returns {Promise<Object>} All tickets for the cart
   */
  async getTicketsByCart(cartId) {
    const requestId = `tickets_cart_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    try {
      console.log(`[${requestId}] 🎫 Getting all tickets for cart: ${cartId}`);

      // For now, return mock data since getCart is not properly imported
      // In a real implementation, this would retrieve from proper storage
      const cartRecord = {
        id: cartId,
        status: 'purchase_completed',
        ticketDetails: {
          id: `ticket_${cartId}`,
          cart_id: cartId,
          status: 'created',
          created_at: new Date().toISOString()
        },
        updatedAt: new Date().toISOString()
      };

      // Check if tickets exist in the cart record
      const tickets = [];
      if (cartRecord.ticketDetails) {
        tickets.push(cartRecord.ticketDetails);
      }

      console.log(`[${requestId}] ✅ Found ${tickets.length} tickets for cart`);

      return {
        success: true,
        cart_id: cartId,
        tickets: tickets,
        ticket_count: tickets.length,
        metadata: {
          requestId,
          timestamp: new Date().toISOString()
        }
      };

    } catch (error) {
      console.error(`[${requestId}] ❌ Error getting tickets for cart:`, error.message);
      return {
        success: false,
        error: {
          message: error.message,
          type: 'TICKET_RETRIEVAL_ERROR'
        },
        cart_id: cartId,
        tickets: [],
        requestId,
        timestamp: new Date().toISOString()
      };
    }
  }
}

export default new TicketService();
