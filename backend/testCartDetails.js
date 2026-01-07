import { getCart } from './src/utils/firestore.js';
import logger from './src/utils/logger.js';
import { Command } from 'commander';

const program = new Command();

/**
 * Fetches and displays cart details by cart ID
 * @param {string} cartId - The ID of the cart to retrieve
 */
function formatTimestamp(timestamp) {
  if (!timestamp) return 'N/A';
  try {
    const date = new Date(timestamp.timestamp || timestamp);
    return date.toLocaleString();
  } catch (e) {
    return 'Invalid date';
  }
}

function formatPrice(amount, currency = 'CAD') {
  if (amount === undefined || amount === null) return '0.00';
  const num = parseFloat(amount);
  if (isNaN(num)) return '0.00';
  // If the number is greater than 1000, assume it's in cents
  const value = num > 1000 ? num / 100 : num;
  return `${value.toFixed(2)} ${currency}`;
}

function printSection(title) {
  console.log(`\n${'='.repeat(40)}`);
  console.log(`  ${title.toUpperCase()}`);
  console.log('='.repeat(40));
}

async function getCartDetails(cartId) {
  try {
    console.log(`\n${'*'.repeat(60)}`);
    console.log(`  FETCHING CART DETAILS: ${cartId}`);
    console.log('*'.repeat(60));
    
    // Get cart details from Firestore
    const cart = await getCart(cartId);
    
    if (!cart) {
      console.error('❌ Cart not found');
      process.exit(1);
    }

    // Display complete cart object
    printSection('Complete Cart Data');
    console.log(JSON.stringify(cart, null, 2));
    
    // Display cart metadata in a more readable format
    printSection('Cart Summary');
    console.log(`🆔 Cart ID: ${cartId}`);
    console.log(`📅 Created: ${formatTimestamp(cart.createdAt || cart.timestamp)}`);
    console.log(`🔄 Status: ${cart.status || 'N/A'}`);
    console.log(`🔗 Reference: ${cart.reference || 'N/A'}`);
    
    // Display trip information from Busbud response if available
    if (cart.busbudResponse) {
      printSection('Trip Information');
      
      // Function to display a single trip segment
      const displayTripSegment = (segment, isReturn = false) => {
        if (!segment) return;
        
        const operator = segment.operator?.name || 'N/A';
        const departureTime = new Date(segment.departure_time.timestamp).toLocaleString();
        const arrivalTime = new Date(segment.arrival_time.timestamp).toLocaleString();
        const duration = segment.duration ? `${Math.floor(segment.duration / 3600)}h ${Math.floor((segment.duration % 3600) / 60)}m` : 'N/A';
        
        console.log(`\n${isReturn ? '🔄 RETURN TRIP' : '🚌 OUTBOUND TRIP'}`);
        console.log('─'.repeat(40));
        console.log(`From: ${segment.origin.name} (${segment.origin.city?.name || 'N/A'})`);
        console.log(`To: ${segment.destination.name} (${segment.destination.city?.name || 'N/A'})`);
        console.log(`Operator: ${operator}`);
        console.log(`Departure: ${departureTime}`);
        console.log(`Arrival: ${arrivalTime}`);
        console.log(`Duration: ${duration}`);
        
        // Display vehicle information if available
        if (segment.vehicle) {
          console.log(`\nVehicle Type: ${segment.vehicle.type || 'Bus'}`);
          console.log(`Available Seats: ${segment.vehicle.available_seats || 'N/A'}`);
        }
        
        // Display amenities if available
        if (segment.amenities && Object.keys(segment.amenities).length > 0) {
          console.log('\nAmenities:');
          Object.entries(segment.amenities).forEach(([key, value]) => {
            if (value) {
              const displayKey = key.split('_').map(word => 
                word.charAt(0).toUpperCase() + word.slice(1)
              ).join(' ');
              console.log(`  • ${displayKey}`);
            }
          });
        }
      };
      
      // Display outbound trip (first segment)
      if (cart.busbudResponse?.segments?.length > 0) {
        displayTripSegment(cart.busbudResponse.segments[0], false);
        
        // Check for return trip (second segment)
        if (cart.busbudResponse.segments.length > 1 && cart.busbudResponse.segments[1]) {
          displayTripSegment(cart.busbudResponse.segments[1], true);
        }
      } else {
        console.log('No trip segments found in cart');
      }
    }
    
    // Display pricing information with breakdown for round trips
    printSection('Price Breakdown');
    
    // Check if this is a round trip
    const isRoundTrip = cart.busbudResponse?.segments?.length > 1;
    if (isRoundTrip) {
      console.log('🔁 Round Trip Booking');
      console.log('─'.repeat(40));
    }
    
    // Log raw fares data for debugging
    if (process.env.DEBUG) {
      console.log('\n[DEBUG] Raw fares data:', JSON.stringify(cart.busbudResponse?.fares?.[0] || {}, null, 2));
    }
    
    if (cart.busbudResponse?.fares?.[0]?.terms) {
      const terms = cart.busbudResponse.fares[0].terms;
      const currency = terms.currency || 'CAD';
      
      // Try to find price information in multiple possible locations
      const fare = cart.busbudResponse.fares[0];
      const price = {
        // First try the direct price object
        ...(fare.price || {}),
        // Then try top-level fare properties
        ...(fare.total_price && { total: fare.total_price }),
        ...(fare.base_price && { base: fare.base_price }),
        // Then check terms for any price information
        ...(terms.price && { base: terms.price }),
        ...(terms.total_price && { total: terms.total_price })
      };
      
      console.log('Debug - Combined price object:', JSON.stringify(price, null, 2));
      
      // Parse price values with better handling
      const formatPrice = (value) => {
        if (value === undefined || value === null) return '0.00';
        const num = parseFloat(value);
        if (isNaN(num)) return '0.00';
        // If the number is greater than 1000, assume it's in cents
        return (num > 1000 ? num / 100 : num).toFixed(2);
      };
      
      // Get prices with fallbacks
      const total = formatPrice(price.total || fare.total_price || 0);
      const base = formatPrice(price.base || price.total || 0);
      const taxes = formatPrice(price.taxes || 0);
      const fees = formatPrice(price.fees || 0);
      const discount = formatPrice(price.discount || 0);
      
      // Display detailed price breakdown
      console.log('Fare Components:');
      console.log(`  • Base Fare: ${base} ${currency}`);
      
      // Display all available price components
      const priceComponents = [
        { key: 'base', label: 'Base Fare' },
        { key: 'tax', label: 'Tax' },
        { key: 'taxes', label: 'Taxes' },
        { key: 'fee', label: 'Fee' },
        { key: 'fees', label: 'Fees' },
        { key: 'service_fee', label: 'Service Fee' },
        { key: 'booking_fee', label: 'Booking Fee' },
        { key: 'baggage_fee', label: 'Baggage Fee' },
        { key: 'seat_fee', label: 'Seat Selection' },
        { key: 'insurance', label: 'Insurance' },
        { key: 'discount', label: 'Discount' }
      ];
      
      // Display all non-zero price components
      let hasComponents = false;
      priceComponents.forEach(({ key, label }) => {
        const value = price[key];
        if (value !== undefined && value !== null && parseFloat(value) > 0) {
          if (!hasComponents) {
            console.log('\nFare Components:');
            hasComponents = true;
          }
          const isDiscount = key === 'discount';
          console.log(`  • ${label}: ${isDiscount ? '-' : ''}${formatPrice(value)} ${currency}`);
        }
      });
      
      // If no components found, show a message
      if (!hasComponents) {
        console.log('\nNo price components found in the response.');
        console.log('Please check the debug output above for available data.');
      }
      
      // Display taxes and fees if they exist
      if (parseFloat(taxes) > 0 || parseFloat(fees) > 0) {
        console.log('\nTaxes & Fees:');
        if (parseFloat(taxes) > 0) console.log(`  • Taxes: ${taxes} ${currency}`);
        if (parseFloat(fees) > 0) console.log(`  • Fees: ${fees} ${currency}`);
      }
      
      // Display discount if it exists
      if (parseFloat(discount) > 0) {
        console.log('\nDiscounts:');
        console.log(`  • Promotional Discount: -${discount} ${currency}`);
      }
      
      // Display total with breakdown for round trips
      console.log('\n' + '='.repeat(40));
      if (isRoundTrip) {
        // If it's a round trip, show the per-person price and total
        const perPersonPrice = (parseFloat(total) / 2).toFixed(2);
        console.log(`  Outbound: ${perPersonPrice} ${currency}`.padStart(30 + perPersonPrice.length + currency.length));
        console.log(`  Return:   ${perPersonPrice} ${currency}`.padStart(30 + perPersonPrice.length + currency.length));
        console.log('  ' + '─'.repeat(38));
      }
      console.log(`  TOTAL: ${total} ${currency}`.padStart(25 + total.length + currency.length) + '\n');
      
      // Display baggage information
      console.log('=== Baggage Allowance ===');
      console.log(`Checked Bags: ${terms.nb_checked_bags || 0} (${terms.kg_by_bag || 'N/A'} kg each)`);
      console.log(`Carry-on: ${terms.nb_carry_on || 0} (${terms.personal_item_permitted ? 'Personal item allowed' : 'No personal item'})`);
      
      // Display refund policies if available
      if (terms.refund_policies?.length > 0) {
        console.log('\n=== Refund Policies ===');
        terms.refund_policies.forEach((policy, index) => {
          const fee = policy.flat_fee ? `${(parseFloat(policy.flat_fee) / 100).toFixed(2)} ${policy.flat_fee_currency || currency}` : 'Non-refundable';
          const timeWindow = policy.cutoff_from !== null || policy.cutoff_to !== null 
            ? `${policy.cutoff_from || '0'}h to ${policy.cutoff_to || 'departure'}h before departure` 
            : 'Any time';
          console.log(`  ${index + 1}. ${policy.type}: ${fee} (${timeWindow})`);
        });
      }
    } else {
      console.log('No pricing information available');
    }
    
    // Display passenger information
    if (cart.busbudResponse?.passengers?.length > 0) {
      printSection('Passenger Information');
      cart.busbudResponse.passengers.forEach((passenger, index) => {
        console.log(`\n👤 Passenger ${index + 1}:`);
        console.log(`  • Type: ${passenger.category || 'N/A'}`);
        if (passenger.first_name || passenger.last_name) {
          console.log(`  • Name: ${passenger.first_name || ''} ${passenger.last_name || ''}`.trim());
        }
        if (passenger.email) {
          console.log(`  • Email: ${passenger.email}`);
        }
        if (passenger.phone) {
          console.log(`  • Phone: ${passenger.phone}`);
        }
        if (passenger.birthdate) {
          console.log(`  • Birthdate: ${passenger.birthdate}`);
        }
        if (passenger.gender) {
          console.log(`  • Gender: ${passenger.gender}`);
        }
        if (passenger.document) {
          console.log(`  • Document: ${passenger.document.type || 'ID'} - ${passenger.document.number || 'N/A'}`);
        }
      });
    }
    
    // Display additional cart metadata if available
    if (cart.metadata || cart.payment || cart.notes) {
      printSection('Additional Information');
      
      if (cart.metadata) {
        console.log('\n📋 Metadata:');
        Object.entries(cart.metadata).forEach(([key, value]) => {
          console.log(`  • ${key}: ${JSON.stringify(value)}`);
        });
      }
      
      if (cart.payment) {
        console.log('\n💳 Payment Information:');
        console.log(`  • Status: ${cart.payment.status || 'N/A'}`);
        if (cart.payment.amount) {
          console.log(`  • Amount: ${formatPrice(cart.payment.amount, cart.payment.currency || 'CAD')}`);
        }
        if (cart.payment.method) {
          console.log(`  • Method: ${cart.payment.method}`);
        }
      }
      
      if (cart.notes) {
        console.log('\n📝 Notes:');
        console.log(`  ${cart.notes}`);
      }
    }
    
    // Display any error information if present
    if (cart.error) {
      printSection('Error Information');
      console.error('❌ Error:', cart.error.message || JSON.stringify(cart.error));
      if (cart.error.stack) {
        console.error('\nStack trace:');
        console.error(cart.error.stack);
      }
    }
    
  } catch (error) {
    printSection('Error');
    console.error('❌ Error fetching cart details:');
    console.error(`  Message: ${error.message}`);
    
    if (error.response) {
      console.error('\nResponse Details:');
      console.error(`  Status: ${error.response.status} ${error.response.statusText}`);
      if (error.response.data) {
        console.error('  Data:', JSON.stringify(error.response.data, null, 2));
      }
    }
    
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    
    logger.error('Error in getCartDetails:', { 
      cartId, 
      error: error.message, 
      stack: error.stack,
      response: error.response?.data 
    });
    
    process.exit(1);
  } finally {
    console.log('\n' + '='.repeat(60));
    console.log('  CART DETAILS FETCH COMPLETE');
    console.log('='.repeat(60) + '\n');
  }
}

// Set up command line interface
program
  .name('cart-details')
  .description('🛒 CLI tool to fetch and display comprehensive cart details by ID from Firestore')
  .version('1.1.0')
  .option('-d, --debug', 'enable debug output', false);

program
  .command('get <cartId>')
  .description('Get cart details by ID')
  .action((cartId) => {
    getCartDetails(cartId);
  });

// Parse command line arguments
if (process.argv.length < 3) {
  program.help();
} else {
  const options = program.parse(process.argv).opts();
  if (options.debug) {
    process.env.DEBUG = 'true';
    console.log('🔍 Debug mode enabled');
  }
}