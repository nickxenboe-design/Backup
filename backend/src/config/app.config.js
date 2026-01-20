/**
 * Application configuration
 * This file contains default values that can be overridden by environment variables
 */

export const APP_CONFIG = {
  // Default branch code (2 digits)
  DEFAULT_BRANCH_CODE: process.env.DEFAULT_BRANCH_CODE || '01',
  
  // Default ticket type (A, B, or C)
  DEFAULT_TICKET_TYPE: process.env.DEFAULT_TICKET_TYPE || 'A',
  
  // Other app-wide configurations can go here
};

// Validate configuration on startup
if (!/^\d{2}$/.test(APP_CONFIG.DEFAULT_BRANCH_CODE)) {
  console.warn(`⚠️  Invalid DEFAULT_BRANCH_CODE: "${APP_CONFIG.DEFAULT_BRANCH_CODE}". Must be 2 digits.`);
  APP_CONFIG.DEFAULT_BRANCH_CODE = '01'; // Fallback to default
}

if (!/^[A-C]$/i.test(APP_CONFIG.DEFAULT_TICKET_TYPE)) {
  console.warn(`⚠️  Invalid DEFAULT_TICKET_TYPE: "${APP_CONFIG.DEFAULT_TICKET_TYPE}". Must be A, B, or C.`);
  APP_CONFIG.DEFAULT_TICKET_TYPE = 'A'; // Fallback to default
}

export default APP_CONFIG;
