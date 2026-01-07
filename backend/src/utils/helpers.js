/**
 * Validates a PNR (Passenger Name Record) number
 * @param {string} pnr - The PNR to validate
 * @returns {boolean} - True if the PNR is valid, false otherwise
 */
export const validatePNR = (pnr) => {
  if (!pnr) return false;
  const pnrRegex = /^[A-Z0-9]{3,15}$/i;
  return pnrRegex.test(pnr);
};

/**
 * Cleans an object by removing null, undefined, and empty string values
 * @param {Object} obj - The object to clean
 * @returns {Object} - The cleaned object
 */
export const cleanObject = (obj) => {
  if (!obj || typeof obj !== 'object') return obj;
  
  return Object.entries(obj).reduce((acc, [key, value]) => {
    // Skip null, undefined, and empty strings
    if (value === null || value === undefined || value === '') {
      return acc;
    }
    
    // Recursively clean nested objects
    if (typeof value === 'object' && !Array.isArray(value)) {
      const cleaned = cleanObject(value);
      // Only add if the cleaned object is not empty
      if (Object.keys(cleaned).length > 0) {
        acc[key] = cleaned;
      }
      return acc;
    }
    
    // For arrays, clean each item if it's an object
    if (Array.isArray(value)) {
      const cleanedArray = value.map(item => 
        typeof item === 'object' ? cleanObject(item) : item
      ).filter(item => item !== null && item !== undefined && item !== '');
      
      if (cleanedArray.length > 0) {
        acc[key] = cleanedArray;
      }
      return acc;
    }
    
    // For other values, just add them
    acc[key] = value;
    return acc;
  }, {});
};

/**
 * Formats a date string to YYYY-MM-DD format
 * @param {string|Date} date - The date to format
 * @returns {string} - The formatted date string
 */
export const formatDate = (date) => {
  if (!date) return '';
  
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  
  return `${year}-${month}-${day}`;
};

/**
 * Checks if a value is a valid date
 * @param {any} date - The value to check
 * @returns {boolean} - True if the value is a valid date
 */
export const isValidDate = (date) => {
  if (!date) return false;
  const d = new Date(date);
  return !isNaN(d.getTime());
};
