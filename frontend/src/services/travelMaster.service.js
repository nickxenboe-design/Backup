import { TravelMasterClient } from '../utils/xmlrpcClient.js';
import { constants } from '../config/constants.js';
import { logger } from '../utils/logger.js';
import { validatePNR } from '../utils/helpers.js';

class TravelMasterService {
  constructor() {
    this.client = new TravelMasterClient();
  }

  async getInvoiceByPNR(pnr) {
    try {
      if (!validatePNR(pnr)) {
        throw new Error(`Invalid PNR format: ${pnr}. PNR should be 3-15 alphanumeric characters.`);
      }

      const invoiceIds = await this.client.execute(
        constants.MODELS.ACCOUNT_MOVE,
        'search',
        [[['payment_reference', '=', pnr]]]
      );

      if (!invoiceIds || invoiceIds.length === 0) {
        return null;
      }

      const invoices = await this.client.execute(
        constants.MODELS.ACCOUNT_MOVE,
        'read',
        [invoiceIds],
        {
          fields: [
            'id',
            'partner_id',
            'payment_reference',
            'amount_total',
            'amount_residual',
            'state',
            'invoice_date',
            'name'
          ]
        }
      );

      return invoices[0] || invoices;
    } catch (error) {
      logger.error('Error getting invoice by PNR:', error);
      throw error;
    }
  }

  async postInvoice(invoiceId) {
    const startTime = Date.now();
    logger.info(`[${invoiceId}] Starting invoice posting...`);

    try {
      // First, check the current state of the invoice
      logger.info(`[${invoiceId}] Checking current invoice state...`);
      const [currentInvoice] = await this.client.execute(
        constants.MODELS.ACCOUNT_MOVE,
        'read',
        [[invoiceId], ['state', 'name', 'payment_state', 'amount_total']]
      );

      if (!currentInvoice) {
        throw new Error(`Invoice ${invoiceId} not found`);
      }

      logger.info(`[${invoiceId}] Current state: ${currentInvoice.state}`, {
        invoice_number: currentInvoice.name,
        amount_total: currentInvoice.amount_total,
        payment_state: currentInvoice.payment_state
      });

      // If already posted, return early
      if (currentInvoice.state === 'posted') {
        logger.info(`[${invoiceId}] Invoice already posted`);
        return {
          success: true,
          invoice_number: currentInvoice.name,
          state: currentInvoice.state,
          payment_state: currentInvoice.payment_state,
          already_posted: true
        };
      }

      // Post the invoice
      logger.info(`[${invoiceId}] Sending post request...`);
      const result = await this.client.execute(
        constants.MODELS.ACCOUNT_MOVE,
        'action_post',
        [[invoiceId]]
      );

      // Add a small delay to ensure the state is updated
      await new Promise(resolve => setTimeout(resolve, 500));

      // Verify the invoice was actually posted
      logger.info(`[${invoiceId}] Verifying invoice state...`);
      const [postedInvoice] = await this.client.execute(
        constants.MODELS.ACCOUNT_MOVE,
        'read',
        [[invoiceId], ['state', 'name', 'payment_state', 'amount_total', 'invoice_date']]
      );

      if (!postedInvoice) {
        throw new Error(`Failed to verify invoice ${invoiceId}: Invoice not found after posting`);
      }

      if (postedInvoice.state !== 'posted') {
        throw new Error(`Invoice posting verification failed. Expected state 'posted' but got '${postedInvoice.state}'`);
      }

      const duration = Date.now() - startTime;
      logger.info(`[${invoiceId}] Invoice posted and verified in ${duration}ms`, {
        invoice_number: postedInvoice.name,
        state: postedInvoice.state,
        payment_state: postedInvoice.payment_state,
        amount_total: postedInvoice.amount_total,
        invoice_date: postedInvoice.invoice_date,
        due_date: postedInvoice.x_datetime
      });

      return {
        success: true,
        invoice_number: postedInvoice.name,
        state: postedInvoice.state,
        payment_state: postedInvoice.payment_state,
        amount_total: postedInvoice.amount_total,
        invoice_date: postedInvoice.invoice_date,
        duration_ms: duration
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(`[${invoiceId}] Failed to post invoice after ${duration}ms:`, {
        error: error.message,
        stack: error.stack,
        duration_ms: duration
      });
      
      // Try to get more details about the error
      try {
        const [errorDetails] = await this.client.execute(
          constants.MODELS.ACCOUNT_MOVE,
          'read',
          [[invoiceId], ['state', 'name', 'amount_total', 'payment_state']]
        );
        logger.error(`[${invoiceId}] Current invoice state:`, errorDetails);
      } catch (e) {
        logger.error(`[${invoiceId}] Could not fetch error details:`, e.message);
      }
      
      throw new Error(`Failed to post invoice ${invoiceId}: ${error.message}`);
    }
  }

  async createInvoice(invoiceData) {
    try {
      // Use the provided partner_id or default to 1 (admin)
      const partnerId = invoiceData.partner_id || 1;
      
      logger.info('Creating new invoice in TravelMaster...', { 
        pnr: invoiceData.pnr,
        partnerId
      });

      // Create a minimal invoice with required fields only
      const invoiceDataToSend = {
        move_type: 'out_invoice',
        partner_id: partnerId,
        invoice_date: invoiceData.invoice_date || new Date().toISOString().split('T')[0],
        x_datetime: invoiceData.due_date || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        payment_reference: invoiceData.pnr || `INV-${Date.now()}`,
        ref: invoiceData.pnr || `INV-${Date.now()}`,
        company_id: 1, // Default company ID
        currency_id: 1, // Default currency ID
        journal_id: 1, // Default sales journal ID
        // Add a simple invoice line using the correct format for Odoo's one2many field
        'invoice_line_ids': [
          {
            'command': 'create',
            'data': {
              'name': 'Test Line Item',
              'quantity': 1,
              'price_unit': 0.01,
              'account_id': 1, // Default account ID
              'product_id': 80, // Updated product ID
              'x_datetime': invoiceData.due,
            }
          }
        ]
      };

      logger.info('Sending invoice data to Odoo:', JSON.stringify(invoiceDataToSend, null, 2));

      // Create the invoice
      const invoiceId = await this.client.execute(
        constants.MODELS.ACCOUNT_MOVE,
        'create',
        [invoiceDataToSend],
        {}
      );
      
      logger.info('Successfully created invoice with ID:', invoiceId);

      if (!invoiceId) {
        throw new Error('Failed to create invoice: No ID returned');
      }

      logger.info('Created invoice with ID:', invoiceId);

      // Post the invoice
      await this.client.execute(
        constants.MODELS.ACCOUNT_MOVE,
        'action_post',
        [[invoiceId]]
      );

      logger.info('Posted invoice with ID:', invoiceId);

      return {
        success: true,
        invoiceId,
        partnerId,
        invoiceNumber: `INV-${invoiceId}`
      };
    } catch (error) {
      logger.error('Error in createInvoice:', error);
      throw new Error(`Failed to create invoice: ${error.message}`);
    }
  }

  async createAndPostInvoice(invoiceData) {
    try {
      // Create invoice first
      const invoice = await this.createInvoice(invoiceData);
      
      // Auto-post the invoice
      await this.postInvoice(invoice.id);
      
      // Return the posted invoice
      const postedInvoice = await this.client.execute(
        constants.MODELS.ACCOUNT_MOVE,
        'read',
        [[invoice.id]],
        {
          fields: [
            'id',
            'name',
            'payment_reference',
            'amount_total',
            'amount_residual',
            'state',
            'invoice_date',
            'x_datetime'
          ]
        }
      );
      
      return postedInvoice[0] || postedInvoice;
    } catch (error) {
      logger.error('Error creating and posting invoice:', error);
      throw error;
    }
  }

  async searchInvoicesByCustomer(email) {
    try {
      // First find the partner by email
      const partnerIds = await this.client.execute(
        constants.MODELS.RES_PARTNER,
        'search',
        [[['email', '=', email]]]
      );

      if (!partnerIds || partnerIds.length === 0) {
        return [];
      }

      // Then find invoices for this partner
      const invoiceIds = await this.client.execute(
        constants.MODELS.ACCOUNT_MOVE,
        'search',
        [[['partner_id', 'in', partnerIds]]],
        { limit: 50 }
      );

      if (!invoiceIds || invoiceIds.length === 0) {
        return [];
      }

      const invoices = await this.client.execute(
        constants.MODELS.ACCOUNT_MOVE,
        'read',
        [invoiceIds],
        {
          fields: [
            'id',
            'name',
            'payment_reference',
            'amount_total',
            'amount_residual',
            'state',
            'invoice_date',
            'x_datetime'
          ]
        }
      );

      return invoices;
    } catch (error) {
      logger.error('Error searching invoices by customer:', error);
      throw error;
    }
  }

  async processPayment(invoiceId, paymentData) {
    try {
      // Step 1: First, ensure invoice is posted
      const invoice = await this.client.execute(
        constants.MODELS.ACCOUNT_MOVE,
        'read',
        [[invoiceId]],
        {
          fields: ['id', 'state', 'payment_reference']
        }
      );

      const invoiceState = invoice[0]?.state || invoice.state;
      
      if (invoiceState === 'draft') {
        logger.info(`Invoice ${invoiceId} is in draft state, posting it first...`);
        await this.postInvoice(invoiceId);
      }

      // Step 2: Process payment with proper error handling
      const paymentDataArray = [{
        journal_id: paymentData.journal_id || constants.PAYMENT.DEFAULT_JOURNAL_ID,
        amount: parseFloat(paymentData.amount),
        payment_date: paymentData.payment_date || new Date().toISOString().split('T')[0],
        bank_reference: paymentData.bank_reference || `BANK-${Date.now()}`,
        payment_method_line_id: paymentData.payment_method_line_id || constants.PAYMENT.PAYMENT_METHOD_ID,
        partner_type: constants.PAYMENT.PARTNER_TYPE,
        payment_type: constants.PAYMENT.PAYMENT_TYPE,
        communication: paymentData.pnr || paymentData.communication || `Payment for invoice ${invoiceId}`
      }];

      const context = {
        active_model: constants.MODELS.ACCOUNT_MOVE,
        active_ids: [invoiceId]
      };

      logger.info('Creating payment wizard...', { 
        invoiceId, 
        amount: paymentData.amount,
        journal_id: paymentDataArray[0].journal_id
      });

      // Create payment wizard
      const wizardId = await this.client.execute(
        constants.MODELS.PAYMENT_REGISTER,
        'create',
        paymentDataArray,
        { context }
      );

      logger.info(`Payment wizard created: ${wizardId}`);

      // Execute payment
      const paymentResult = await this.executePayment(wizardId);

      logger.info(`Payment processed successfully for invoice ${invoiceId}`);
      return paymentResult;
    } catch (error) {
      logger.error('Error processing payment:', error);
      
      // Handle specific Odoo errors
      if (error.message.includes('You can only register payment for posted journal entries')) {
        throw new Error('Invoice must be posted before payment can be processed. Please ensure the invoice is validated first.');
      }
      
      if (error.message.includes('Journal not found')) {
        throw new Error('Payment journal not found. Please check journal configuration.');
      }
      
      throw error;
    }
  }

  async executePayment(wizardId) {
    try {
      return await this.client.execute(
        constants.MODELS.PAYMENT_REGISTER,
        'action_create_payments',
        [[wizardId]]
      );
    } catch (error) {
      logger.error('Error executing payment:', error);
      throw error;
    }
  }

  async getPaymentStatus(pnr) {
    try {
      const invoice = await this.getInvoiceByPNR(pnr);
      
      if (!invoice) {
        return null;
      }

      return {
        pnr: invoice.payment_reference,
        amount_total: invoice.amount_total,
        amount_residual: invoice.amount_residual,
        status: invoice.amount_residual === 0 ? 'paid' : 'pending',
        invoice_state: invoice.state
      };
    } catch (error) {
      logger.error('Error getting payment status:', error);
      throw error;
    }
  }
}

export { TravelMasterService };
