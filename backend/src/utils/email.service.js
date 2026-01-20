import nodemailer from 'nodemailer';
import { logger } from '../middlewares/logger.js';
import { format } from 'date-fns';

// Configure email transport
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT || 587,
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD,
  },
});

/**
 * Send booking confirmation email
 */
export const sendBookingConfirmation = async (booking, to) => {
  const { reference, items, totalAmount, currency, contactInfo } = booking;
  
  const subject = `Booking Confirmation #${reference}`;
  const bookingDate = format(new Date(booking.createdAt), 'MMMM d, yyyy');
  
  const html = `
    <div>
      <h1>Booking Confirmed!</h1>
      <p>Hello ${contactInfo?.name || 'Customer'},</p>
      <p>Your booking is confirmed. Reference: ${reference}</p>
      <p>Total: ${totalAmount} ${currency}</p>
      <p>Booking Date: ${bookingDate}</p>
      <p>Thank you for choosing our service!</p>
    </div>
  `;
  
  const text = `Booking Confirmation #${reference}\n\n` +
    `Hello ${contactInfo?.name || 'Customer'},\n    Your booking is confirmed.\n` +
    `Reference: ${reference}\n` +
    `Total: ${totalAmount} ${currency}\n` +
    `Booking Date: ${bookingDate}`;

  return sendEmail({ to, subject, text, html });
};

/**
 * Send cart reminder email
 */
export const sendCartReminder = async (cart, to) => {
  const { _id, items, expiresAt } = cart;
  const expiryDate = format(new Date(expiresAt), 'MMMM d, yyyy \'at\' h:mm a');
  
  const subject = 'Your Cart is About to Expire';
  const html = `
    <div>
      <h1>Don't Lose Your Selections!</h1>
      <p>Your cart will expire on: ${expiryDate}</p>
      <p>Items in cart: ${items.length}</p>
      <a href="${process.env.FRONTEND_URL}/cart/${_id}">Complete Your Booking</a>
    </div>
  `;
  
  const text = `Your cart has ${items.length} items and will expire on ${expiryDate}. ` +
    `Visit ${process.env.FRONTEND_URL}/cart/${_id} to complete your booking.`;

  return sendEmail({ to, subject, text, html });
};

/**
 * Generic email sender
 */
async function sendEmail({ to, subject, text, html }) {
  try {
    const info = await transporter.sendMail({
      from: `"${process.env.EMAIL_FROM_NAME || 'Uniglade'}" <${process.env.EMAIL_FROM || 'noreply@uniglade.com'}>`,
      to,
      subject,
      text,
      html,
    });
    logger.info(`Email sent to ${to}: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    logger.error('Email send failed:', error);
    throw error;
  }
}
