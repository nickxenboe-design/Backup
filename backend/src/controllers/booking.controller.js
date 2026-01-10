import { v4 as uuidv4 } from 'uuid';
import { logger } from '../middlewares/logger.js';
import bookingService from '../services/booking.service.js';
import { sendBookingConfirmation } from '../utils/email.service.js';

// In-memory storage
const apiResponses = new Map();
const bookings = new Map();

const saveApiResponse = async (key, data) => {
  const response = { ...data, timestamp: new Date().toISOString() };
  apiResponses.set(key, response);
  return { id: key, ...response };
};

const getCart = async (cartId) => {
  return apiResponses.get(`cart:${cartId}`) || null;
};

const saveBooking = async (id, data) => {
  const booking = { 
    id,
    ...data,
    createdAt: data.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  bookings.set(id, booking);
  return booking;
};

const getBooking = async (id) => {
  return bookings.get(id) || null;
};

const getUserBookings = async (userId) => {
  return Array.from(bookings.values())
    .filter(booking => booking.userId === userId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
};

class BookingController {
  /**
   * Create a booking from cart
   */
  async createFromCart(req, res, next) {
    try {
      const { cartId } = req.params;
      const { payment, contactInfo, notes } = req.body;
      const user = req.user;

      // Process payment (in a real app, this would integrate with a payment provider)
      const paymentResult = await this.processPayment(payment);
      
      if (!paymentResult.success) {
        return res.status(400).json({
          error: 'Payment failed',
          details: paymentResult.error
        });
      }

      // Create booking ID
      const bookingId = `book_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Get cart data
      const cart = await getCart(cartId);
      
      if (!cart) {
        return res.status(404).json({
          error: 'Cart not found',
          code: 'CART_NOT_FOUND'
        });
      }

      // Create booking record
      const booking = {
        id: bookingId,
        cartId,
        userId: user.id,
        status: 'confirmed',
        payment: {
          method: payment.method,
          transactionId: paymentResult.transactionId,
          status: 'completed',
          amount: cart.totalAmount,
          currency: cart.currency || 'USD'
        },
        contactInfo: {
          name: `${user.firstName} ${user.lastName}`.trim(),
          email: user.email,
          phone: user.phone
        },
        tripDetails: cart.tripDetails,
        passengers: cart.passengers || [],
        notes: notes || '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      // Save booking to memory
      await saveBooking(bookingId, booking);
      
      // Save API response for reference
      await saveApiResponse(`booking:${bookingId}`, {
        success: true,
        bookingId,
        cartId,
        paymentResult: {
          status: 'completed',
          transactionId: paymentResult.transactionId,
          method: payment.method
        },
        timestamp: new Date().toISOString()
      });

      // Send confirmation email
      try {
        await sendBookingConfirmation(booking, user.email);
      } catch (emailError) {
        logger.error('Failed to send booking confirmation email:', emailError);
        // Continue even if email fails
      }

      res.status(201).json({
        success: true,
        bookingId,
        message: 'Booking created successfully',
        payment: {
          status: 'completed',
          transactionId: paymentResult.transactionId
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get booking by ID
   */
  async getBooking(req, res, next) {
    try {
      const { id } = req.params;
      
      // Try to get from in-memory storage first
      let booking = await getBooking(id);
      
      // Fallback to service if not found in memory
      if (!booking) {
        booking = await bookingService.getBookingById(id);
        
        if (!booking) {
          return res.status(404).json({ 
            error: 'Booking not found',
            code: 'BOOKING_NOT_FOUND'
          });
        }
        
        // Cache the booking in memory
        await saveBooking(id, booking);
      }
      
      // Check if the user is authorized to view this booking
      if (req.user && req.user.id !== booking.userId && !req.user.isAdmin) {
        return res.status(403).json({
          error: 'Not authorized to view this booking',
          code: 'UNAUTHORIZED'
        });
      }
      
      res.json(booking);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get user's bookings
   */
  async getUserBookings(req, res, next) {
    try {
      const { userId } = req.params;
      
      // Check if the user is authorized to view these bookings
      if (req.user.id !== userId && !req.user.isAdmin) {
        return res.status(403).json({
          error: 'Not authorized to view these bookings',
          code: 'UNAUTHORIZED'
        });
      }
      
      // Get from in-memory storage
      let userBookings = await getUserBookings(userId);
      
      // If no bookings in memory, try service
      if (userBookings.length === 0) {
        userBookings = await bookingService.getUserBookings(userId);
        
        // Cache the bookings in memory
        await Promise.all(
          userBookings.map(booking => 
            saveBooking(booking.id, booking)
          )
        );
      }
      
      res.json({
        data: userBookings,
        pagination: {
          page: 1,
          limit: userBookings.length,
          total: userBookings.length
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Cancel a booking
   */
  async cancelBooking(req, res, next) {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      const userId = req.user.id;
      
      const booking = await bookingService.cancelBooking(id, userId);
      
      res.json({
        success: true,
        booking: await bookingService.generateConfirmation(booking._id)
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get booking confirmation
   */
  async getConfirmation(req, res, next) {
    try {
      const { id } = req.params;
      
      const confirmation = await bookingService.generateConfirmation(id);
      
      if (!confirmation) {
        return res.status(404).json({
          error: 'Booking not found',
          code: 'BOOKING_NOT_FOUND'
        });
      }
      
      res.json(confirmation);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Handle payment webhook
   */
  async handlePaymentWebhook(req, res, next) {
    try {
      const sig = req.headers['stripe-signature'];
      let event;

      try {
        event = stripe.webhooks.constructEvent(
          req.body,
          sig,
          process.env.STRIPE_WEBHOOK_SECRET
        );
      } catch (err) {
        logger.error('Webhook signature verification failed:', err);
        return res.status(400).send(`Webhook Error: ${err.message}`);
      }

      // Handle the event
      switch (event.type) {
        case 'payment_intent.succeeded':
          const paymentIntent = event.data.object;
          logger.info('PaymentIntent was successful:', paymentIntent.id);
          // Update booking status to confirmed
          await bookingService.updatePaymentStatus(
            paymentIntent.metadata.bookingId,
            'completed',
            paymentIntent.id
          );
          break;
          
        case 'payment_intent.payment_failed':
          const failedPayment = event.data.object;
          logger.error('Payment failed:', failedPayment.id);
          // Update booking status to payment failed
          await bookingService.updatePaymentStatus(
            failedPayment.metadata.bookingId,
            'failed',
            failedPayment.id
          );
          break;
          
        default:
          logger.warn(`Unhandled event type: ${event.type}`);
      }

      res.json({ received: true });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Process payment (simplified for example)
   */
  async processPayment(paymentDetails) {
    // In a real app, this would integrate with a payment provider like Stripe
    logger.info('Processing payment:', paymentDetails);
    
    // Simulate payment processing
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Simulate 10% chance of failure
    if (Math.random() < 0.1) {
      return {
        success: false,
        error: 'Payment was declined by the bank'
      };
    }
    
    return {
      success: true,
      transactionId: `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    };
  }
}

export default new BookingController();
