import { ApiError } from '../utils/apiError.js';
import { logger } from '../middlewares/logger.js';

class BookingService {
  constructor() {
    // In-memory storage for bookings
    this.bookings = new Map();
    this.cartService = new CartService();
  }

  // Create booking from cart
  async createBooking(cartId, paymentDetails) {
    // Get cart
    const cart = await this.cartService.findCart(cartId);
    if (!cart) {
      throw new ApiError('Cart not found', 404);
    }

    if (cart.status !== 'active') {
      throw new ApiError('Invalid cart status for booking', 400);
    }

    // Generate unique reference
    const reference = this.generateReference();

    const booking = {
      id: `book_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      reference,
      cartId,
      items: [...cart.items],
      totalAmount: this.calculateTotal(cart.items),
      currency: 'USD',
      status: 'confirmed',
      payment: {
        method: paymentDetails.method,
        transactionId: paymentDetails.transactionId,
        amount: this.calculateTotal(cart.items),
        status: 'completed'
      },
      contactInfo: {
        name: paymentDetails.name,
        email: paymentDetails.email,
        phone: paymentDetails.phone
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    this.bookings.set(booking.id, booking);

    // Update cart status to completed
    await this.cartService.updateCartStatus(cartId, 'completed');

    logger.info(`Booking created: ${booking.id}`);
    return booking;
  }

  // Find booking by ID
  async findBooking(bookingId) {
    const booking = this.bookings.get(bookingId);
    if (!booking) {
      throw new ApiError('Booking not found', 404);
    }
    return booking;
  }

  // Find booking by reference
  async findByReference(reference) {
    // Find booking by reference
    for (const booking of this.bookings.values()) {
      if (booking.reference === reference) {
        return { ...booking };
      }
    }
    return null;
  }

  // Find all bookings
  async findAllBookings() {
    return Array.from(this.bookings.values());
  }

  // Update booking status
  async updateBookingStatus(bookingId, status) {
    const allowedStatuses = ['pending', 'confirmed', 'cancelled', 'completed'];
    if (!allowedStatuses.includes(status)) {
      throw new ApiError('Invalid booking status', 400);
    }

    const booking = this.bookings.get(bookingId);
    if (!booking) {
      throw new ApiError('Booking not found', 404);
    }
    
    const updatedBooking = { ...booking, status, updatedAt: new Date().toISOString() };
    this.bookings.set(bookingId, updatedBooking);
    
    return { ...updatedBooking };
  }

  // Cancel booking
  async cancelBooking(bookingId) {
    const booking = await this.findBooking(bookingId);

    // Check if booking can be cancelled
    if (!this.canBeCancelled(booking)) {
      throw new ApiError('Booking cannot be cancelled', 400);
    }

    const updatedBooking = await this.updateBookingStatus(bookingId, 'cancelled');
    return updatedBooking;
  }

  // Check if booking can be cancelled
  canBeCancelled(booking) {
    if (booking.status !== 'confirmed') return false;

    const now = new Date();
    const departureTime = booking.items?.[0]?.departureTime;

    if (!departureTime) return false;

    // Can't cancel within 24 hours of departure
    const hoursUntilDeparture = (departureTime - now) / (1000 * 60 * 60);
    return hoursUntilDeparture > 24;
  }

  // Generate unique booking reference
  generateReference() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  // Calculate total amount from items
  calculateTotal(items) {
    return items.reduce((total, item) => total + (item.price || 0), 0);
  }

  // Submit booking details from frontend
  async submitBooking(bookingDetails) {
    const { contactInfo, passengers, paymentMethod, tripId, searchQuery } = bookingDetails;

    // Basic validation (more comprehensive validation can be added here)
    if (!contactInfo || !passengers || passengers.length === 0 || !paymentMethod || !tripId) {
      throw new ApiError('Missing required booking details', 400);
    }

    // Generate a unique booking ID (can be more sophisticated)
    const bookingId = `BOOK-${Date.now()}-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;

    // Create booking in memory
    const booking = {
      id: `book_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      reference: this.generateReference(),
      tripId,
      searchQuery,
      contactInfo,
      passengers,
      paymentMethod,
      status: 'pending', // Initial status
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    this.bookings.set(booking.id, booking);

    logger.info(`Booking submitted with ID: ${bookingId}`);

    return { success: true, bookingId: booking.id, message: 'Booking initiated successfully' };
  }
}

export default new BookingService();
