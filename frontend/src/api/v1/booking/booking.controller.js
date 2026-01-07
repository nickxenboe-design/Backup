import Booking from '../../../models/booking.model.js';
import Trip from '../../../models/trip.model.js';
import User from '../../../models/user.model.js';
import ApiError from '../../../utils/apiError.js';
import logger from '../../../utils/logger.js';
import { sendEmail } from '../../../services/notification/email.service.js';
import { processPayment } from '../../../services/payment/payment.service.js';
import { generateTicket } from '../../../services/booking/ticket.service.js';

/**
 * Create a new booking
 */
export const createBooking = async (req, res, next) => {
  const session = await Booking.startSession();
  session.startTransaction();
  
  try {
    const { tripId, date, passengers, contactEmail, contactPhone, notes } = req.body;
    const userId = req.user.id;

    // 1) Get the trip and check availability
    const trip = await Trip.findById(tripId).session(session);
    if (!trip) {
      throw new ApiError(404, 'Trip not found');
    }

    // 2) Check seat availability
    const availableSeats = await checkSeatAvailability(tripId, date, passengers);
    if (!availableSeats.available) {
      throw new ApiError(400, 'One or more selected seats are no longer available');
    }

    // 3) Calculate total amount
    const totalAmount = calculateTotalAmount(trip, passengers);

    // 4) Create booking
    const booking = await Booking.create([{
      user: userId,
      trip: tripId,
      date: new Date(date),
      passengers,
      contactEmail,
      contactPhone,
      notes,
      totalAmount,
      status: 'pending_payment',
      paymentStatus: 'pending',
      createdAt: new Date(),
      updatedAt: new Date()
    }], { session });

    // 5) Update seat availability
    await updateSeatAvailability(tripId, date, passengers, session);

    // 6) If everything is successful, commit the transaction
    await session.commitTransaction();
    session.endSession();

    // 7) Send booking confirmation email
    try {
      await sendBookingConfirmation(booking[0], req.user);
    } catch (emailError) {
      logger.error('Error sending booking confirmation email:', emailError);
      // Don't fail the request if email fails
    }

    res.status(201).json({
      status: 'success',
      data: {
        booking: booking[0],
        paymentUrl: `${process.env.API_URL}/api/v1/bookings/${booking[0]._id}/pay`
      }
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    next(error);
  }
};

/**
 * Get booking details
 */
export const getBooking = async (req, res, next) => {
  try {
    const { bookingId } = req.params;
    const userId = req.user.id;

    const booking = await Booking.findOne({
      _id: bookingId,
      $or: [
        { user: userId },
        { 'passengers.email': req.user.email } // Allow access if user is a passenger
      ]
    })
      .populate('trip')
      .populate('user', 'firstName lastName email phone');

    if (!booking) {
      throw new ApiError(404, 'Booking not found or access denied');
    }

    res.status(200).json({
      status: 'success',
      data: { booking }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get all bookings for the authenticated user
 */
export const getUserBookings = async (req, res, next) => {
  try {
    const { status, startDate, endDate, page = 1, limit = 10 } = req.query;
    const userId = req.user.id;

    const query = { user: userId };
    
    // Apply filters
    if (status) {
      query.status = status;
    }
    
    if (startDate && endDate) {
      query.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    // Execute query with pagination
    const bookings = await Booking.find(query)
      .populate('trip')
      .sort('-createdAt')
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .exec();

    // Get total count for pagination
    const count = await Booking.countDocuments(query);

    res.status(200).json({
      status: 'success',
      results: bookings.length,
      total: count,
      totalPages: Math.ceil(count / limit),
      currentPage: page,
      data: { bookings }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Cancel a booking
 */
export const cancelBooking = async (req, res, next) => {
  const session = await Booking.startSession();
  session.startTransaction();

  try {
    const { bookingId } = req.params;
    const userId = req.user.id;

    // Find the booking
    const booking = await Booking.findOne({
      _id: bookingId,
      user: userId,
      status: { $ne: 'cancelled' } // Can't cancel an already cancelled booking
    }).session(session);

    if (!booking) {
      throw new ApiError(404, 'Booking not found or already cancelled');
    }

    // Check if cancellation is allowed (e.g., not too close to departure)
    const canCancel = await checkCancellationPolicy(booking);
    if (!canCancel) {
      throw new ApiError(400, 'Cancellation is not allowed for this booking');
    }

    // Update booking status
    booking.status = 'cancelled';
    booking.cancelledAt = new Date();
    await booking.save({ session });

    // Release seats
    await releaseSeats(booking.trip, booking.date, booking.passengers, session);

    // If already paid, process refund
    if (booking.paymentStatus === 'paid') {
      await processRefund(booking, session);
    }

    // Commit transaction
    await session.commitTransaction();
    session.endSession();

    // Send cancellation email
    try {
      await sendCancellationConfirmation(booking);
    } catch (emailError) {
      logger.error('Error sending cancellation email:', emailError);
    }

    res.status(200).json({
      status: 'success',
      message: 'Booking cancelled successfully',
      data: { booking }
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    next(error);
  }
};

/**
 * Initiate payment for a booking
 */
export const makePayment = async (req, res, next) => {
  try {
    const { bookingId } = req.params;
    const { paymentMethod, paymentDetails } = req.body;
    const userId = req.user.id;

    // Find the booking
    const booking = await Booking.findOne({
      _id: bookingId,
      user: userId,
      status: 'pending_payment'
    });

    if (!booking) {
      throw new ApiError(404, 'Booking not found or already paid');
    }

    // Process payment
    const paymentResult = await processPayment({
      bookingId: booking._id,
      amount: booking.totalAmount,
      currency: 'USD', // or get from trip
      paymentMethod,
      paymentDetails,
      customerEmail: booking.contactEmail,
      description: `Payment for booking #${booking.bookingNumber}`
    });

    // Update booking with payment details
    booking.paymentStatus = paymentResult.status;
    booking.paymentId = paymentResult.paymentId;
    booking.paymentMethod = paymentMethod;
    
    if (paymentResult.status === 'succeeded') {
      booking.status = 'confirmed';
      booking.paidAt = new Date();
    }

    await booking.save();

    // Send booking confirmation with ticket if payment successful
    if (paymentResult.status === 'succeeded') {
      try {
        await sendBookingConfirmation(booking, req.user);
      } catch (emailError) {
        logger.error('Error sending booking confirmation email:', emailError);
      }
    }

    res.status(200).json({
      status: 'success',
      data: {
        booking,
        payment: paymentResult
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Verify payment status
 */
export const verifyPayment = async (req, res, next) => {
  try {
    const { bookingId } = req.params;
    const { reference } = req.body;
    const userId = req.user.id;

    const booking = await Booking.findOne({
      _id: bookingId,
      user: userId,
      paymentStatus: 'pending'
    });

    if (!booking) {
      throw new ApiError(404, 'Booking not found or already processed');
    }

    // Verify payment with payment provider
    const paymentStatus = await verifyPaymentWithProvider(reference);

    // Update booking status based on payment verification
    booking.paymentStatus = paymentStatus === 'success' ? 'paid' : 'failed';
    booking.status = paymentStatus === 'success' ? 'confirmed' : 'payment_failed';
    
    if (paymentStatus === 'success') {
      booking.paidAt = new Date();
    }

    await booking.save();

    // Send appropriate notifications
    if (paymentStatus === 'success') {
      try {
        await sendBookingConfirmation(booking, req.user);
      } catch (emailError) {
        logger.error('Error sending booking confirmation email:', emailError);
      }
    } else {
      try {
        await sendPaymentFailedNotification(booking, req.user);
      } catch (emailError) {
        logger.error('Error sending payment failed email:', emailError);
      }
    }

    res.status(200).json({
      status: 'success',
      data: {
        booking,
        paymentStatus
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Download ticket for a booking
 */
export const downloadTicket = async (req, res, next) => {
  try {
    const { bookingId } = req.params;
    const userId = req.user.id;

    const booking = await Booking.findOne({
      _id: bookingId,
      $or: [
        { user: userId },
        { 'passengers.email': req.user.email } // Allow if user is a passenger
      ],
      status: { $in: ['confirmed', 'completed'] },
      paymentStatus: 'paid'
    }).populate('trip').populate('user');

    if (!booking) {
      throw new ApiError(404, 'Ticket not found or not available for download');
    }

    // Generate ticket PDF
    const ticketPdf = await generateTicket(booking);

    // Set response headers for PDF download
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=ticket-${booking.bookingNumber}.pdf`);
    
    // Send the PDF
    res.send(ticketPdf);
  } catch (error) {
    next(error);
  }
};

// Helper functions

async function checkSeatAvailability(tripId, date, passengers) {
  // Implementation depends on your seat management system
  // This is a simplified example
  const bookedSeats = await Booking.aggregate([
    {
      $match: {
        trip: tripId,
        date: new Date(date),
        status: { $ne: 'cancelled' }
      }
    },
    { $unwind: '$passengers' },
    { $group: { _id: null, seats: { $addToSet: '$passengers.seatNumber' } } }
  ]);

  const unavailableSeats = new Set(bookedSeats[0]?.seats || []);
  const requestedSeats = passengers.map(p => p.seatNumber);
  
  const unavailable = requestedSeats.filter(seat => unavailableSeats.has(seat));
  
  return {
    available: unavailable.length === 0,
    unavailableSeats: unavailable
  };
}

function calculateTotalAmount(trip, passengers) {
  // Simple calculation - can be enhanced with discounts, taxes, etc.
  return passengers.reduce((total, passenger) => {
    let price = trip.basePrice;
    // Apply any passenger type discounts
    if (passenger.type === 'child') {
      price *= 0.75; // 25% discount for children
    } else if (passenger.type === 'senior') {
      price *= 0.8; // 20% discount for seniors
    }
    return total + price;
  }, 0);
}

async function updateSeatAvailability(tripId, date, passengers, session) {
  // Implementation depends on your seat management system
  // This would typically update a seat inventory collection
  // or mark seats as reserved in the database
  // This is a simplified example
  const seatUpdates = passengers.map(passenger => ({
    updateOne: {
      filter: {
        trip: tripId,
        date: new Date(date),
        seatNumber: passenger.seatNumber,
        status: 'available'
      },
      update: {
        $set: { status: 'reserved', reservedUntil: new Date(Date.now() + 15 * 60 * 1000) }
      }
    }
  }));

  if (seatUpdates.length > 0) {
    await Seat.bulkWrite(seatUpdates, { session });
  }
}

async function checkCancellationPolicy(booking) {
  // Check if the booking can be cancelled based on your policy
  // For example, no cancellation within 24 hours of departure
  const departureTime = new Date(booking.date);
  const now = new Date();
  const hoursUntilDeparture = (departureTime - now) / (1000 * 60 * 60);
  
  return hoursUntilDeparture > 24; // Allow cancellation if more than 24 hours before departure
}

async function releaseSeats(tripId, date, passengers, session) {
  // Implementation to release seats back to available
  const seatNumbers = passengers.map(p => p.seatNumber);
  
  await Seat.updateMany(
    {
      trip: tripId,
      date: new Date(date),
      seatNumber: { $in: seatNumbers },
      status: 'reserved'
    },
    {
      $set: { status: 'available', reservedUntil: null }
    },
    { session }
  );
}

async function processRefund(booking, session) {
  // Implementation depends on your payment provider
  // This would typically involve calling the payment provider's API
  // to initiate a refund
  
  // For example, with a hypothetical payment service:
  try {
    const refund = await paymentService.createRefund({
      paymentId: booking.paymentId,
      amount: booking.totalAmount,
      reason: 'customer_request'
    });

    // Update booking with refund details
    booking.refundId = refund.id;
    booking.refundStatus = refund.status;
    booking.refundedAt = new Date();
    await booking.save({ session });

    return refund;
  } catch (error) {
    logger.error('Error processing refund:', error);
    // Optionally, you might want to log this but not fail the entire operation
    // since the booking is still being cancelled
    throw new ApiError(500, 'Error processing refund. Please contact support.');
  }
}

async function sendBookingConfirmation(booking, user) {
  // Generate ticket
  const ticketPdf = await generateTicket(booking);
  
  // Send email with ticket attachment
  await sendEmail({
    to: booking.contactEmail,
    subject: `Booking Confirmation - #${booking.bookingNumber}`,
    template: 'booking-confirmation',
    context: {
      user: user.firstName,
      bookingNumber: booking.bookingNumber,
      tripDetails: booking.trip,
      passengers: booking.passengers,
      totalAmount: booking.totalAmount,
      bookingDate: booking.createdAt.toLocaleDateString()
    },
    attachments: [
      {
        filename: `ticket-${booking.bookingNumber}.pdf`,
        content: ticketPdf,
        contentType: 'application/pdf'
      }
    ]
  });
}

async function sendCancellationConfirmation(booking) {
  await sendEmail({
    to: booking.contactEmail,
    subject: `Booking Cancelled - #${booking.bookingNumber}`,
    template: 'booking-cancellation',
    context: {
      bookingNumber: booking.bookingNumber,
      tripDetails: booking.trip,
      cancellationDate: new Date().toLocaleDateString(),
      refundStatus: booking.paymentStatus === 'paid' ? 'processing' : 'not_applicable'
    }
  });
}

async function verifyPaymentWithProvider(reference) {
  // Implementation depends on your payment provider
  // This is a simplified example
  try {
    const response = await axios.get(`${process.env.PAYMENT_API_URL}/verify/${reference}`, {
      headers: {
        'Authorization': `Bearer ${process.env.PAYMENT_API_KEY}`
      }
    });
    
    return response.data.status; // 'success', 'failed', 'pending', etc.
  } catch (error) {
    logger.error('Error verifying payment:', error);
    return 'failed';
  }
}
