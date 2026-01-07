import nodemailer from 'nodemailer';
import path from 'path';
import fs from 'fs';
import handlebars from 'handlebars';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import logger from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Create reusable transporter object using the default SMTP transport
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT || 587,
  secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USERNAME,
    pass: process.env.SMTP_PASSWORD,
  },
  tls: {
    // Do not fail on invalid certs
    rejectUnauthorized: process.env.NODE_ENV === 'production',
  },
});

// Verify connection configuration
transporter.verify((error) => {
  if (error) {
    logger.error('Error connecting to email server:', error);
  } else {
    logger.info('Server is ready to take our messages');
  }
});

/**
 * Compile email template
 * @param {string} templateName - Name of the template file (without extension)
 * @param {Object} data - Data to pass to the template
 * @returns {Promise<string>} Compiled HTML
 */
const compileTemplate = async (templateName, data) => {
  try {
    const templatePath = path.join(
      __dirname,
      '..',
      'templates',
      'emails',
      `${templateName}.hbs`
    );

    const templateContent = await fs.promises.readFile(templatePath, 'utf8');
    const template = handlebars.compile(templateContent);
    return template(data);
  } catch (error) {
    logger.error('Error compiling email template:', error);
    throw new Error('Failed to compile email template');
  }
};

/**
 * Send an email
 * @param {Object} options - Email options
 * @param {string|Array<string>} options.to - Email recipient(s)
 * @param {string} options.subject - Email subject
 * @param {string} [options.text] - Plain text body
 * @param {string} [options.html] - HTML body
 * @param {string} [options.template] - Template name (without extension)
 * @param {Object} [options.context] - Data to pass to the template
 * @param {Array<Object>} [options.attachments] - Email attachments
 * @returns {Promise<Object>} Info object from Nodemailer
 */
export const sendEmail = async ({
  to,
  subject,
  text,
  html,
  template,
  context = {},
  attachments = [],
}) => {
  try {
    // If template is provided, compile it
    let compiledHtml = html;
    if (template) {
      compiledHtml = await compileTemplate(template, {
        ...context,
        appName: process.env.APP_NAME || 'Uniglade',
        appUrl: process.env.CLIENT_URL || 'http://localhost:3000',
        currentYear: new Date().getFullYear(),
      });
    }

    const mailOptions = {
      from: `"${process.env.EMAIL_FROM_NAME || 'Uniglade'}" <${process.env.EMAIL_FROM_ADDRESS || 'noreply@uniglade.com'}>`,
      to: Array.isArray(to) ? to.join(', ') : to,
      subject,
      text,
      html: compiledHtml,
      attachments,
    };

    // Send mail with defined transport object
    const info = await transporter.sendMail(mailOptions);
    
    logger.info(`Email sent: ${info.messageId}`);
    return info;
  } catch (error) {
    logger.error('Error sending email:', error);
    throw new Error('Failed to send email');
  }
};

/**
 * Send verification email
 * @param {Object} user - User object
 * @param {string} verificationUrl - Verification URL
 * @returns {Promise<Object>} Info object from Nodemailer
 */
export const sendVerificationEmail = async (user, verificationUrl) => {
  return sendEmail({
    to: user.email,
    subject: 'Verify Your Email',
    template: 'verify-email',
    context: {
      name: user.name,
      verificationUrl,
    },
  });
};

/**
 * Send password reset email
 * @param {Object} user - User object
 * @param {string} resetUrl - Password reset URL
 * @returns {Promise<Object>} Info object from Nodemailer
 */
export const sendPasswordResetEmail = async (user, resetUrl) => {
  return sendEmail({
    to: user.email,
    subject: 'Password Reset Request',
    template: 'password-reset',
    context: {
      name: user.name,
      resetUrl,
      expiresIn: '10 minutes',
    },
  });
};

/**
 * Send password changed confirmation email
 * @param {Object} user - User object
 * @returns {Promise<Object>} Info object from Nodemailer
 */
export const sendPasswordChangedEmail = async (user) => {
  return sendEmail({
    to: user.email,
    subject: 'Password Changed Successfully',
    template: 'password-changed',
    context: {
      name: user.name,
      loginUrl: `${process.env.CLIENT_URL || 'http://localhost:3000'}/login`,
    },
  });
};

/**
 * Send a welcome email to a new user
 * @param {Object} user - User object
 * @returns {Promise<Object>} Info object from Nodemailer
 */
export const sendWelcomeEmail = async (user) => {
  const dashboardUrl = `${process.env.CLIENT_URL || 'http://localhost:3000'}/dashboard`;
  const helpCenterUrl = `${process.env.CLIENT_URL || 'http://localhost:3000'}/help`;
  const contactUrl = `${process.env.CLIENT_URL || 'http://localhost:3000'}/contact`;
  
  return sendEmail({
    to: user.email,
    subject: `Welcome to ${process.env.APP_NAME || 'Uniglade'}!`,
    template: 'welcome',
    context: {
      name: user.name,
      appName: process.env.APP_NAME || 'Uniglade',
      appUrl: process.env.CLIENT_URL || 'http://localhost:3000',
      helpCenterUrl,
      contactUrl,
      dashboardUrl,
      facebookUrl: process.env.FACEBOOK_URL || 'https://facebook.com/uniglade',
      twitterUrl: process.env.TWITTER_URL || 'https://twitter.com/uniglade',
      instagramUrl: process.env.INSTAGRAM_URL || 'https://instagram.com/uniglade',
      companyAddress: process.env.COMPANY_ADDRESS || '123 Bus St, City, Country',
      currentYear: new Date().getFullYear(),
      unsubscribeUrl: `${process.env.CLIENT_URL || 'http://localhost:3000'}/unsubscribe?email=${encodeURIComponent(user.email)}`
    },
  });
};

export default {
  sendEmail,
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendPasswordChangedEmail,
  sendWelcomeEmail
};
