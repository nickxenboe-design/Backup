import inquirer from 'inquirer';
import chalk from 'chalk';

export async function collectPassengerDetails(passengerCount) {
  const passengers = [];
  
  for (let i = 1; i <= passengerCount; i++) {
    console.log(chalk.blue(`\n=== Passenger ${i} Details ===`));
    
    const answers = await inquirer.prompt([
      {
        type: 'list',
        name: 'title',
        message: 'Title:',
        choices: ['Mr', 'Mrs', 'Miss', 'Ms', 'Dr'],
        default: 'Mr'
      },
      {
        type: 'input',
        name: 'firstName',
        message: 'First Name:',
        validate: input => input.trim() ? true : 'First name is required'
      },
      {
        type: 'input',
        name: 'lastName',
        message: 'Last Name:',
        validate: input => input.trim() ? true : 'Last name is required'
      },
      {
        type: 'input',
        name: 'email',
        message: 'Email Address:',
        validate: input => 
          /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input) 
            ? true 
            : 'Please enter a valid email address'
      },
      {
        type: 'input',
        name: 'phone',
        message: 'Phone Number (with country code):',
        validate: input => 
          /^\+?[0-9\s-]{8,}$/.test(input) 
            ? true 
            : 'Please enter a valid phone number'
      },
      {
        type: 'list',
        name: 'seatPreference',
        message: 'Seat Preference:',
        choices: ['Window', 'Aisle', 'No Preference'],
        default: 'No Preference'
      }
    ]);

    passengers.push({
      id: i,
      ...answers,
      specialAssistance: false
    });

    // Only ask about special assistance if not the last passenger
    if (i < passengerCount) {
      const { addMore } = await inquirer.prompt([{
        type: 'confirm',
        name: 'addMore',
        message: 'Add special assistance for this passenger?',
        default: false
      }]);

      if (addMore) {
        const { specialAssistance } = await inquirer.prompt([{
          type: 'checkbox',
          name: 'specialAssistance',
          message: 'Select special assistance requirements:',
          choices: [
            'Wheelchair assistance',
            'Visual impairment assistance',
            'Hearing impairment assistance',
            'Mobility assistance',
            'Other (please specify)'
          ]
        }]);

        passengers[i - 1].specialAssistance = specialAssistance;
      }
    }
  }

  return passengers;
}

export async function collectPaymentDetails() {
  console.log(chalk.blue('\n=== Payment Details ==='));
  
  const { paymentMethod } = await inquirer.prompt([{
    type: 'list',
    name: 'paymentMethod',
    message: 'Select payment method:',
    choices: ['Credit/Debit Card', 'PayPal', 'Bank Transfer'],
    default: 'Credit/Debit Card'
  }]);

  if (paymentMethod === 'Credit/Debit Card') {
    return await inquirer.prompt([
      {
        type: 'input',
        name: 'cardNumber',
        message: 'Card Number:',
        validate: input => 
          /^\d{16}$/.test(input.replace(/\s+/g, '')) 
            ? true 
            : 'Please enter a valid 16-digit card number'
      },
      {
        type: 'input',
        name: 'expiryDate',
        message: 'Expiry Date (MM/YY):',
        validate: input => 
          /^(0[1-9]|1[0-2])\/([0-9]{2})$/.test(input) 
            ? true 
            : 'Please enter a valid expiry date (MM/YY)'
      },
      {
        type: 'password',
        name: 'cvv',
        message: 'CVV:',
        validate: input => 
          /^\d{3,4}$/.test(input) 
            ? true 
            : 'Please enter a valid CVV (3 or 4 digits)'
      },
      {
        type: 'input',
        name: 'cardholderName',
        message: 'Cardholder Name:',
        validate: input => input.trim() ? true : 'Cardholder name is required'
      }
    ]);
  }
  
  // For other payment methods, we'll just return the method
  return { paymentMethod };
}
