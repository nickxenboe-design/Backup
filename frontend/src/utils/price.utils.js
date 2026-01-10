import { getPricingSettings } from '../config/runtimeSettings.js';
/**
 * Price utility functions for manipulating trip prices before sending to frontend
 */

/**
 * Applies currency formatting to a price amount
 * @param {number} amount - The price amount
 * @param {string} currency - The currency code (e.g., 'USD', 'EUR')
 * @returns {string} Formatted price string
 */
const formatPrice = (amount, currency = 'USD') => {
  if (typeof amount !== 'number' || isNaN(amount)) {
    console.warn(`Invalid price amount: ${amount}`);
    return 'N/A';
  }

  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  } catch (error) {
    console.error('Error formatting price:', error);
    return `${currency} ${amount.toFixed(2)}`;
  }
};

/**
 * Applies any business rules or transformations to trip prices
 * @param {Object} trip - The trip object containing price information
 * @param {Object} options - Additional options for price processing
 * @returns {Object} Processed trip with updated price information
 */
const processTripPrices = (trip, options = {}) => {
  if (!trip || typeof trip !== 'object') {
    console.warn('Invalid trip object provided to processTripPrices');
    return trip;
  }

  // Create a deep copy to avoid mutating the original object
  const processedTrip = JSON.parse(JSON.stringify(trip));
  const currency = options.currency || 'USD';
  
  // Process prices array if it exists (Busbud API format)
  if (Array.isArray(processedTrip.prices)) {
    processedTrip.prices = processedTrip.prices.map(priceItem => {
      if (priceItem.prices && typeof priceItem.prices.total === 'number') {
        // Treat total as already in correct currency unit (no cents conversion)
        const originalAmount = priceItem.prices.total;
        
        // Apply price adjustments (work directly in same unit as originalAmount)
        const adjustedAmount = applyPriceAdjustments(originalAmount, {
          ...options,
          currency
        });
        
        // Update the price object
        return {
          ...priceItem,
          prices: {
            ...priceItem.prices,
            originalTotal: priceItem.prices.total,
            total: Math.round(adjustedAmount * 100) / 100, // Round to 2 decimals
            formattedTotal: formatPrice(Math.round(adjustedAmount * 100) / 100, currency),
            originalFormattedTotal: formatPrice(originalAmount, currency),
            isDiscounted: adjustedAmount < originalAmount,
            discountAmount: originalAmount - adjustedAmount,
            discountPercentage: originalAmount > 0 ? 
              ((originalAmount - adjustedAmount) / originalAmount * 100).toFixed(2) : 0
          }
        };
      }
      return priceItem;
    });
  }
  
  // Also process the top-level price object if it exists
  if (processedTrip.price && typeof processedTrip.price.amount === 'number') {
    // Treat amount as already in correct currency unit (no cents conversion)
    const originalAmount = processedTrip.price.amount;
    
    const adjustedAmount = applyPriceAdjustments(originalAmount, {
      ...options,
      currency
    });
    
    processedTrip.price = {
      ...processedTrip.price,
      originalAmount: processedTrip.price.amount,
      amount: Math.round(adjustedAmount * 100) / 100, // Round to 2 decimals
      formatted: formatPrice(Math.round(adjustedAmount * 100) / 100, currency),
      originalFormatted: formatPrice(originalAmount, currency),
      isDiscounted: adjustedAmount < originalAmount,
      discountAmount: originalAmount - adjustedAmount,
      discountPercentage: originalAmount > 0 ? 
        ((originalAmount - adjustedAmount) / originalAmount * 100).toFixed(2) : 0
    };
  }

  // Process any nested prices (e.g., for segments or legs)
  if (processedTrip.segments && Array.isArray(processedTrip.segments)) {
    processedTrip.segments = processedTrip.segments.map(segment => {
      if (segment.price) {
        const segmentPrice = segment.price.amount || segment.price.total || 0;
        segment.price = {
          ...segment.price,
          formatted: formatPrice(segmentPrice, currency),
          originalAmount: segmentPrice,
          isDiscounted: false, // Segments typically don't have individual discounts
          currency: segment.price.currency || currency
        };
      }
      return segment;
    });
  }

  return processedTrip;
};

/**
 * Applies business rules and adjustments to prices
 * @private
 */
const applyPriceAdjustments = (basePrice, options = {}) => {
  // Default to 15% discount if not specified
  const originalPrice = Number(basePrice) || 0;
  let adjustedPrice = originalPrice;
  let changes = [];

  // Merge runtime settings with options (options override UI settings)
  const ui = getPricingSettings();
  const apply = options.apply !== undefined ? !!options.apply : !!ui.apply;
  const discount =
    options.discount !== undefined && !isNaN(Number(options.discount))
      ? Number(options.discount)
      : Number(ui.discount || 0);
  const markup =
    options.markup !== undefined && !isNaN(Number(options.markup))
      ? Number(options.markup)
      : Number(ui.markup || 0);
  const charges =
    options.charges !== undefined && !isNaN(Number(options.charges))
      ? Number(options.charges)
      : Number(ui.charges || 0);
  const roundToNearest =
    options.roundToNearest !== undefined && !isNaN(Number(options.roundToNearest))
      ? Number(options.roundToNearest)
      : Number(ui.roundToNearest || 0);

  // Log initial price
  console.log(`[Price Utility] Original price: ${originalPrice} ${options.currency || ''}`);

  if (apply) {
    // New rule: retail price = base + (base * markup%) + charges - (base * discount%)
    const before = adjustedPrice;
    const markupAmount = !isNaN(markup) ? (before * (markup / 100)) : 0;
    const discountAmountPct = !isNaN(discount) ? (before * (discount / 100)) : 0;
    adjustedPrice = before + markupAmount + charges - discountAmountPct;
    changes.push(
      `base ${before.toFixed(2)} + markup ${markup.toFixed(2)}% (${markupAmount.toFixed(2)}) + charges ${charges.toFixed(2)} - discount ${discount.toFixed(2)}% (${discountAmountPct.toFixed(2)}) = ${adjustedPrice.toFixed(2)}`
    );
  }

  // Apply rounding if specified
  if (!isNaN(roundToNearest) && roundToNearest > 0) {
    const before = adjustedPrice;
    adjustedPrice = Math.round(adjustedPrice / roundToNearest) * roundToNearest;
    changes.push(`Rounded to nearest ${roundToNearest} (${before.toFixed(2)}  ${adjustedPrice.toFixed(2)})`);
  }

  // If adjustments are applied and there is a fractional part, round up to the next whole dollar
  if (apply) {
    const before = adjustedPrice;
    const fractional = adjustedPrice - Math.floor(adjustedPrice);
    if (fractional > 0.000001) {
      adjustedPrice = Math.floor(adjustedPrice) + 1;
      changes.push(`Rounded up to next whole dollar (${before.toFixed(2)}  ${adjustedPrice.toFixed(2)})`);
    }
  }

  // Ensure price is never negative
  adjustedPrice = Math.max(0, adjustedPrice);

  // Prepare adjustment metadata
  const adjustment = {
    applied: changes.length > 0,
    originalAmount: originalPrice,
    adjustedAmount: adjustedPrice,
    discountAmount: originalPrice - adjustedPrice,
    discountPercentage: originalPrice > 0 ? ((originalPrice - adjustedPrice) / originalPrice) * 100 : 0,
    currency: options.currency || 'USD',
    timestamp: new Date().toISOString(),
    changes
  };

  // Log the final price and all changes
  if (changes.length > 0) {
    console.log(`[Price Utility] Price adjustments applied to ${originalPrice} ${options.currency || ''}:`);
    changes.forEach(change => console.log(`  • ${change}`));
    console.log(`[Price Utility] Final price: ${adjustedPrice.toFixed(2)} ${options.currency || ''}`);
  } else {
    console.log(`[Price Utility] No price adjustments applied to ${originalPrice} ${options.currency || ''}`);
  }

  // Return both the adjusted price and the adjustment details
  if (options.returnMetadata) {
    return {
      amount: adjustedPrice,
      ...adjustment
    };
  }

  return adjustedPrice;
};

/**
 * Processes an array of trips with price formatting and adjustments
 * @param {Array} trips - Array of trip objects
 * @param {Object} options - Options for price processing
 * @returns {Array} Processed array of trips
 */
const processTripsPrices = (trips, options = {}) => {
  if (!Array.isArray(trips)) {
    console.warn('Expected an array of trips, got:', typeof trips);
    return [];
  }
  
  return trips.map(trip => processTripPrices(trip, options));
};

export {
  formatPrice,
  processTripPrices,
  processTripsPrices,
  applyPriceAdjustments
};

export default {
  formatPrice,
  processTripPrices,
  processTripsPrices,
  applyPriceAdjustments
};
