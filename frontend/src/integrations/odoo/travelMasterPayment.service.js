import xmlrpc from 'xmlrpc';
import { promisify } from 'util';
import util from 'util';

class TravelMasterAPI {
  constructor(config = {}) {
    this.config = {
      url: config.url || 'https://odoo-187207-0.cloudclusters.net',
      db: config.db || 'admin',
      username: config.username || '',
      password: config.password || '',
      ...config
    };

    this.uid = null;
    this.commonClient = null;
    this.modelsClient = null;
    this.initializeClients();

    // Bind all methods to maintain 'this' context
    const methods = [
      'authenticate', 'executeMethod', 'findOrCreatePartner', 'createInvoice',
      'postInvoice', 'validateInvoice', 'findOrCreateInvoice', 'searchInvoices',
      'readInvoices', 'searchReadInvoices', 'createPartner', 'searchByPNR',
      'getModelFields', 'checkAndExpireInvoice', 'initializeClients', 'countInvoices',
      'updateBookingStatus'
    ];
    
    methods.forEach(method => {
      if (typeof this[method] === 'function') {
        this[method] = this[method].bind(this);
      }
    });
  }

  initializeClients() {
    this.commonClient = xmlrpc.createClient({ url: `${this.config.url}/xmlrpc/2/common` });
    this.modelsClient = xmlrpc.createClient({ url: `${this.config.url}/xmlrpc/2/object` });

    this.commonClient.methodCall = promisify(this.commonClient.methodCall.bind(this.commonClient));
    this.modelsClient.methodCall = promisify(this.modelsClient.methodCall.bind(this.modelsClient));
  }

  async getModelFields(model) {
    try {
      const fieldsInfo = await this.executeMethod(model, 'fields_get', [], {
        attributes: ['string', 'type', 'required', 'readonly', 'relation']
      });
      return fieldsInfo;
    } catch (error) {
      console.error(`❌ Failed to fetch fields for model ${model}:`, error);
      throw error;
    }
  }

  // ──────────────────────────────── AUTHENTICATION ────────────────────────────────
  async authenticate() {
    try {
      this.uid = await this.commonClient.methodCall('authenticate', [
        this.config.db,
        this.config.username,
        this.config.password,
        {}
      ]);
      console.log('✅ Authentication successful. User ID:', this.uid);
      return this.uid;
    } catch (error) {
      console.error('❌ Authentication failed:', error);
      throw error;
    }
  }

  async executeMethod(model, method, args = [], kwargs = {}) {
    if (!this.uid) throw new Error('Not authenticated. Call authenticate() first.');
    const params = [this.config.db, this.uid, this.config.password, model, method, args, kwargs];
    try {
      return await this.modelsClient.methodCall('execute_kw', params);
    } catch (error) {
      console.error(`❌ API call failed (${model}.${method}):`, error);
      throw error;
    }
  }

  // ──────────────────────────────── INVOICE METHODS ────────────────────────────────
  async searchInvoices(domain = [], options = {}) {
    return await this.executeMethod('account.move', 'search', [domain], options);
  }

  async countInvoices(domain = []) {
    return await this.executeMethod('account.move', 'search_count', [domain]);
  }

  async readInvoices(ids, fields = []) {
    const kwargs = fields.length > 0 ? { fields } : {};
    return await this.executeMethod('account.move', 'read', [ids], kwargs);
  }

  async searchReadInvoices(domain = [], fields = [], options = {}) {
    const kwargs = { ...options };
    if (fields.length > 0) kwargs.fields = fields;
    return await this.executeMethod('account.move', 'search_read', [domain], kwargs);
  }

  // ──────────────────────────────── PARTNER METHODS ────────────────────────────────
  async createPartner(partnerData) {
    return await this.executeMethod('res.partner', 'create', [partnerData]);
  }

  async findOrCreatePartner(name, email = '', phone = '') {
    const existing = await this.executeMethod('res.partner', 'search', [[['name', '=', name]]]);
    if (existing.length > 0) {
      console.log('✅ Found existing partner:', existing[0]);
      return existing[0];
    }
    const partnerId = await this.createPartner({ name, email, phone });
    console.log('✅ Created new partner:', partnerId);
    return partnerId;
  }

  // ──────────────────────────────── INVOICE CREATION ────────────────────────────────
  async createInvoice(invoiceData) {
    console.log('📤 Creating invoice in Odoo...', {
      partner_id: invoiceData.partner_id,
      payment_reference: invoiceData.payment_reference,
      line_count: invoiceData.invoice_line_ids?.length || 0,
      amount_total: invoiceData.amount_total
    });
    
    try {
      const startTime = Date.now();
      const result = await this.executeMethod('account.move', 'create', [invoiceData]);
      const duration = Date.now() - startTime;
      
      console.log(`✅ Invoice created successfully in ${duration}ms`, {
        invoiceId: result,
        durationMs: duration,
        timestamp: new Date().toISOString()
      });
      
      return result;
    } catch (error) {
      console.error('❌ Failed to create invoice:', {
        error: error.message,
        response: error.response?.data || 'No response data',
        stack: error.stack
      });
      throw error;
    }
  }

  async findOrCreateInvoice(partnerId, paymentReference, lines = [], expirationDate = null) {
    try {
      // Check for existing invoice first
      const existing = await this.searchInvoices([['payment_reference', '=', paymentReference]]);
      if (existing.length > 0) {
        const invoiceId = existing[0];
        console.log('✅ Found existing invoice:', invoiceId);

        // If expirationDate provided, validate and format it to set on invoice
        if (!expirationDate) {
          console.warn('⚠️ No expiration date provided for existing invoice; keeping current expiry');
        }

        let formattedExpiration = null;
        if (expirationDate) {
          const expiresAt = new Date(expirationDate);
          if (isNaN(expiresAt.getTime())) {
            throw new Error(`Invalid expiration date format: ${expirationDate}. Expected ISO 8601 format.`);
          }
          const pad = (n) => String(n).padStart(2, '0');
          formattedExpiration = `${expiresAt.getFullYear()}-${pad(expiresAt.getMonth() + 1)}-${pad(expiresAt.getDate())} ${pad(expiresAt.getHours())}:${pad(expiresAt.getMinutes())}:${pad(expiresAt.getSeconds())}`;
        }

        // Normalize incoming lines to Odoo one2many format [(0,0,{...}), ...]
        const cleanInvoiceLines = (lines || []).map(line => {
          try {
            let lineObject;
            if (Array.isArray(line)) {
              if (line.length === 3 && line[0] === 0 && line[1] === 0 && typeof line[2] === 'object') {
                lineObject = { ...line[2] };
              } else if (line.length === 2 && typeof line[1] === 'object') {
                lineObject = { ...line[1] };
              }
            } else if (typeof line === 'object') {
              lineObject = { ...line };
            } else {
              console.warn('⚠️ Invalid line format, skipping:', line);
              return null;
            }
            if (lineObject && lineObject.x_datetime) delete lineObject.x_datetime;
            return [0, 0, lineObject];
          } catch (e) {
            console.error('❌ Error processing invoice line:', e);
            return null;
          }
        }).filter(Boolean);

        // Build update payload
        const updates = {};
        if (cleanInvoiceLines.length > 0) {
          updates.invoice_line_ids = cleanInvoiceLines;
        }
        if (formattedExpiration) {
          updates.x_datetime = formattedExpiration;
        }

        if (Object.keys(updates).length === 0) {
          console.log('ℹ️ No updates to apply to existing invoice');
          return invoiceId;
        }

        console.log('🛠️ Updating existing invoice with new lines/expiry...', {
          invoiceId,
          lineCount: cleanInvoiceLines.length,
          hasExpiry: Boolean(formattedExpiration)
        });
        const writeOk = await this.executeMethod('account.move', 'write', [[invoiceId], updates]);
        if (!writeOk) {
          throw new Error('Failed to update existing invoice');
        }
        console.log('✅ Existing invoice updated successfully');
        return invoiceId;
      }

      // Validate expiration date is provided
      if (!expirationDate) {
        throw new Error('Expiration date is required');
      }

      // Parse and validate the expiration date
      const expiresAt = new Date(expirationDate);
      if (isNaN(expiresAt.getTime())) {
        throw new Error(`Invalid expiration date format: ${expirationDate}. Expected ISO 8601 format.`);
      }

      // Ensure expiration is in the future
      const now = new Date();
      if (expiresAt <= now) {
        throw new Error(`Expiration date must be in the future. Provided: ${expiresAt.toISOString()}, Current: ${now.toISOString()}`);
      }

      console.log('⏰ Using provided expiration date:', expiresAt.toISOString());

      // Format as YYYY-MM-DD HH:MM:SS for Odoo
      const formatDatePart = (date) => String(date).padStart(2, '0');
      const formattedExpiration = [
        expiresAt.getFullYear(),
        formatDatePart(expiresAt.getMonth() + 1),
        formatDatePart(expiresAt.getDate())
      ].join('-') + ' ' + [
        formatDatePart(expiresAt.getHours()),
        formatDatePart(expiresAt.getMinutes()),
        formatDatePart(expiresAt.getSeconds())
      ].join(':');

      console.log('⏰ Setting invoice expiration to:', formattedExpiration, '(UTC)');
      console.log('   Local time equivalent:', new Date(formattedExpiration).toString());
      
      // Format invoice lines for Odoo, ensuring no x_datetime in line items
      const cleanInvoiceLines = lines.map(line => {
        try {
          let lineObject;
          
          // Handle different line formats
          if (Array.isArray(line)) {
            // Handle Odoo format: [0, 0, {...}]
            if (line.length === 3 && line[0] === 0 && line[1] === 0 && typeof line[2] === 'object') {
              lineObject = { ...line[2] };
            } else if (line.length === 2 && typeof line[1] === 'object') {
              // Handle format: [id, {...}]
              lineObject = { ...line[1] };
            }
          } else if (typeof line === 'object') {
            // Handle plain object
            lineObject = { ...line };
          } else {
            console.warn('⚠️ Invalid line format, skipping:', line);
            return null;
          }
          
          // Ensure no x_datetime in line items
          if (lineObject.x_datetime) {
            console.warn('⚠️ Removing x_datetime from line item - should only be set at invoice level');
            delete lineObject.x_datetime;
          }
          
          return [0, 0, lineObject];
          
        } catch (error) {
          console.error('❌ Error processing invoice line:', error);
          return null;
        }
      }).filter(Boolean);

      const nowDate = new Date();
      const invoiceData = {
        partner_id: partnerId,
        payment_reference: paymentReference,
        move_type: 'out_invoice',
        invoice_date: nowDate.toISOString().slice(0, 10),
        x_datetime: formattedExpiration,  // Set at invoice level only
        invoice_line_ids: cleanInvoiceLines
      };

      console.log('📄 Invoice data being created:', JSON.stringify({
        ...invoiceData,
        invoice_line_ids: `[${invoiceData.invoice_line_ids.length} items]`,
        x_datetime: formattedExpiration
      }, null, 2));

      const invoiceId = await this.createInvoice(invoiceData);
      console.log(`✅ Created invoice ${invoiceId} with expiration: ${formattedExpiration}`);
      
      return invoiceId;
      
    } catch (error) {
      console.error('❌ Error in findOrCreateInvoice:', error);
      throw error;
    }

    try {
      const invoiceId = await this.createInvoice(invoiceData);
      console.log(`✅ Created new invoice: ${invoiceId} (expires in 24h: ${formattedExpiration})`);
      return invoiceId;
    } catch (error) {
      console.error('❌ Failed to create invoice:', error);
      throw new Error(`Failed to create invoice: ${error.message}`);
    }
  }

  // ──────────────────────────────── VALIDATION & POSTING ────────────────────────────────
  async postInvoice(invoiceId) {
    const startTime = Date.now();
    const logContext = { invoiceId };
    
    try {
      console.log(`🔍 [${invoiceId}] Fetching current invoice state...`);
      
      // Fetch more details about the invoice to help with debugging
      const [invoice] = await this.executeMethod('account.move', 'read', [[invoiceId], [
        'state', 'name', 'amount_total', 'payment_state', 'invoice_line_ids',
        'partner_id', 'invoice_date', 'invoice_payment_term_id'
      ]]);
      
      const currentState = invoice?.state;
      logContext.currentState = currentState;
      logContext.invoiceNumber = invoice?.name;
      logContext.amount = invoice?.amount_total;
      
      console.log(`ℹ️ [${invoiceId}] Current invoice state:`, {
        ...logContext,
        payment_state: invoice?.payment_state,
        line_count: invoice?.invoice_line_ids?.length || 0,
        partner_id: invoice?.partner_id?.[0],
        invoice_date: invoice?.invoice_date,
        due_date: invoice?.invoice_due_date,
        payment_terms: invoice?.invoice_payment_term_id?.[1]
      });

      if (currentState === 'posted') {
        console.log(`ℹ️ [${invoiceId}] Invoice already posted.`);
        return { 
          success: true, 
          message: 'Invoice already posted',
          invoice_number: invoice?.name,
          state: 'posted'
        };
      }

      // Validate the invoice before posting
      try {
        console.log(`🔍 [${invoiceId}] Validating invoice before posting...`);
        const [invoiceDetails] = await this.executeMethod('account.move', 'read', [[invoiceId], [
          'state', 'line_ids', 'amount_total', 'invoice_date', 'invoice_line_ids'
        ]]);

        // Log detailed line information
        if (invoiceDetails.invoice_line_ids?.length > 0) {
          console.log(`📋 [${invoiceId}] Fetching invoice line details...`);
          const lines = await this.executeMethod('account.move.line', 'read', [
            invoiceDetails.invoice_line_ids,
            ['name', 'quantity', 'price_unit', 'price_total', 'account_id', 'tax_ids']
          ]);
          
          console.log(`ℹ️ [${invoiceId}] Invoice lines:`, JSON.stringify(
            lines.map(l => ({
              name: l.name,
              quantity: l.quantity,
              price_unit: l.price_unit,
              price_total: l.price_total,
              account_id: l.account_id?.[0] || 'N/A',
              tax_count: l.tax_ids?.length || 0
            })), 
            null, 2
          ));
        } else {
          console.warn(`⚠️ [${invoiceId}] Invoice has no lines!`);
        }

        // Basic validation
        if (invoiceDetails.line_ids.length === 0) {
          throw new Error('Invoice has no lines!');
        }
        
        if (!invoiceDetails.amount_total || invoiceDetails.amount_total <= 0) {
          console.warn(`⚠️ [${invoiceId}] Invoice amount is zero or negative:`, invoiceDetails.amount_total);
        }

        console.log(`✅ [${invoiceId}] Invoice validation passed`);
      } catch (validationError) {
        console.error(`❌ [${invoiceId}] Invoice validation failed:`, validationError);
        // Try to get more detailed validation errors
        try {
          const invoiceData = await this.executeMethod('account.move', 'read', [[invoiceId], ['name', 'state', 'invoice_line_ids']]);
          const lineData = await this.executeMethod('account.move.line', 'read', [invoiceData[0].invoice_line_ids, ['name', 'quantity', 'price_unit', 'price_total']]);
          console.error(`📄 [${invoiceId}] Invoice data at time of failure:`, JSON.stringify({
            invoice: invoiceData[0],
            lines: lineData
          }, null, 2));
        } catch (e) {
          console.error(`⚠️ [${invoiceId}] Could not fetch additional invoice details:`, e);
        }
        throw new Error(`Invoice validation failed: ${validationError.message}`);
      }

      // Post the invoice
      console.log(`🔄 [${invoiceId}] Attempting to post invoice...`);
      const postStartTime = Date.now();
      
      const result = await this.executeMethod('account.move', 'action_post', [[invoiceId]]);
      
      const postDuration = Date.now() - postStartTime;
      
      if (result.state === 'posted') {
        const errorMsg = `❌ [${invoiceId}] Invoice posting failed: Odoo returned false`;
        console.error(errorMsg);
        throw new Error(errorMsg);
      }

      // Verify the invoice was actually posted and get full details
      console.log(`🔍 [${invoiceId}] Verifying invoice state after posting...`);
      const [updatedInvoice] = await this.executeMethod('account.move', 'read', [[invoiceId], [
        'name', 'state', 'payment_state', 'amount_total', 'amount_residual',
        'invoice_date', 'invoice_line_ids', 'partner_id', 'ref',
        'invoice_payment_term_id', 'move_type'
      ]]);
      
      // Log all invoice details for verification
      console.log(`📋 [${invoiceId}] Posted invoice verification:`, {
        invoice_number: updatedInvoice.name,
        state: updatedInvoice.state,
        payment_state: updatedInvoice.payment_state,
        amount_total: updatedInvoice.amount_total,
        amount_residual: updatedInvoice.amount_residual,
        invoice_date: updatedInvoice.invoice_date,
        due_date: updatedInvoice.x_datetime,
        reference: updatedInvoice.ref,
        move_type: updatedInvoice.move_type,
        line_count: updatedInvoice.invoice_line_ids?.length || 0,
        partner_id: updatedInvoice.partner_id?.[0],
        payment_terms: updatedInvoice.invoice_payment_term_id?.[1],
      });

      // Verify the state
      if (updatedInvoice.state !== 'posted') {
        const errorMsg = `❌ [${invoiceId}] Invoice posting verification failed. Expected state 'posted' but got '${updatedInvoice.state}'`;
        console.error(errorMsg);
        throw new Error(errorMsg);
      }

      const totalDuration = Date.now() - startTime;
      
      // Log success with detailed timing information
      console.log(`✅ [${invoiceId}] Invoice posted and verified in ${postDuration}ms (total: ${totalDuration}ms)`, {
        invoice_number: updatedInvoice.name,
        state: updatedInvoice.state,
        payment_state: updatedInvoice.payment_state,
        total_duration_ms: totalDuration,
        posting_duration_ms: postDuration,
        verification_duration_ms: Date.now() - (startTime + postDuration)
      });
      
      // Return comprehensive success response
      return { 
        success: true, 
        message: 'Invoice posted and verified successfully',
        invoice_number: updatedInvoice.name,
        state: updatedInvoice.state,
        payment_state: updatedInvoice.payment_state,
        amount_total: updatedInvoice.amount_total,
        amount_residual: updatedInvoice.amount_residual,
        invoice_date: updatedInvoice.invoice_date,
        due_date: updatedInvoice.x_datetime,
        duration_ms: totalDuration,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      const errorDuration = Date.now() - startTime;
      console.error(`❌ [${invoiceId}] Failed to post invoice after ${errorDuration}ms:`, {
        ...logContext,
        error: error.message,
        stack: error.stack,
        response: error.response?.data || 'No response data',
        duration_ms: errorDuration
      });
      throw new Error(`Failed to post invoice ${invoiceId}: ${error.message}`);
    }
  }

  async validateInvoice(invoiceId) {
    const invoices = await this.readInvoices([invoiceId], [
      'state',
      'invoice_line_ids',
      'partner_id',
      'amount_total'
    ]);
    
    if (!invoices || invoices.length === 0) {
      throw new Error(`Invoice ${invoiceId} not found`);
    }

    const inv = invoices[0];

    if (!inv.partner_id?.length) {
      throw new Error(`Invoice ${invoiceId} has no partner assigned`);
    }
    
    if (!inv.invoice_line_ids?.length) {
      throw new Error(`Invoice ${invoiceId} has no invoice lines`);
    }
    
    if (inv.amount_total <= 0) {
      throw new Error(`Invoice ${invoiceId} total amount is zero or negative`);
    }

    if (inv.state === 'posted') {
      console.log(`✅ Invoice ${invoiceId} already posted.`);
      return true;
    }

    await this.postInvoice(invoiceId);
    console.log(`✅ Invoice ${invoiceId} validated and posted successfully.`);
    return true;
  }

  async searchByPNR(pnr) {
    try {
      const domain = [['payment_reference', '=', pnr]];
      const fields = [
        'name', 'payment_reference', 'invoice_date',
        'amount_total', 'amount_residual', 'payment_state', 'state',
        'partner_id', 'invoice_line_ids'
      ];
      
      const invoices = await this.searchReadInvoices(domain, fields);
      return invoices;
    } catch (error) {
      console.error('❌ Error searching by PNR:', error);
      throw error;
    }
  }

  // ──────────────────────────────── BOOKING STATUS (NO-OP) ────────────────────────────────
  async updateBookingStatus(bookingId, details = {}) {
    try {
      const payload = {
        status: details.status || 'unknown',
        invoiceReference: details.invoiceReference || null,
        confirmedAt: details.confirmedAt || null,
        cancelledAt: details.cancelledAt || null,
        failedAt: details.failedAt || null,
        updatedAt: details.updatedAt || new Date().toISOString(),
        metadata: details.metadata || {}
      };
      console.log(`[TravelMasterAPI] updateBookingStatus (noop)`, { bookingId, ...payload });
      // Integration point: update a booking in Odoo when a model is defined.
      return { success: true, bookingId, ...payload, noop: true };
    } catch (error) {
      console.warn(`[TravelMasterAPI] updateBookingStatus error`, { error: error.message, bookingId });
      // Best-effort: do not throw to avoid breaking payment flow
      return { success: false, error: error.message };
    }
  }

  // ──────────────────────────────── EXPIRATION CHECK ────────────────────────────────
  async checkAndExpireInvoice(invoiceId) {
    console.log(`\n⏳ Checking expiration for invoice ${invoiceId}...`);

    try {
      // Read the invoice info with x_datetime
      const invoices = await this.readInvoices([invoiceId], [
        'id', 
        'payment_state', 
        'x_datetime',
        'payment_reference',
        'name',
        'amount_total',
        'invoice_date',
        'state'
      ]);

      if (!invoices || invoices.length === 0) {
        console.log(`✅ Invoice ${invoiceId} not found.`);
        return { success: false, status: 'not_found', message: 'Invoice not found' };
      }

      const inv = invoices[0];
      console.log(`🔍 Invoice ${inv.id} (${inv.name || 'No name'}) - Status: ${inv.payment_state}`);

      // Check if invoice is already paid
      if (inv.payment_state === 'paid') {
        console.log(`✅ Invoice ${inv.id} is already paid.`);
        return { 
          success: true, 
          status: 'already_paid', 
          invoiceId: inv.id,
          payment_state: inv.payment_state
        };
      }

      // Check if invoice is already cancelled
      if (inv.state === 'cancel') {
        console.log(`ℹ️ Invoice ${inv.id} is already cancelled.`);
        return { 
          success: true, 
          status: 'already_cancelled', 
          invoiceId: inv.id,
          state: inv.state
        };
      }

      // Validate x_datetime exists
      if (!inv.x_datetime) {
        console.warn(`⚠️ Invoice ${inv.id} has no x_datetime set. Using default 24h expiration.`);
        const defaultExpiry = new Date();
        defaultExpiry.setDate(defaultExpiry.getDate() + 1);
        inv.x_datetime = defaultExpiry.toISOString();
      }

      // Parse the expiration date
      let dueDate;
      try {
        dueDate = new Date(inv.x_datetime);
        if (isNaN(dueDate.getTime())) {
          throw new Error(`Invalid date format: ${inv.x_datetime}`);
        }
      } catch (error) {
        console.error(`❌ Error parsing x_datetime for invoice ${inv.id}:`, error.message);
        // Fallback to 24 hours from now
        dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + 1);
        console.warn(`⚠️ Using fallback expiration: ${dueDate.toISOString()}`);
      }

      const now = new Date();
      const timeDiff = dueDate - now;
      const hoursRemaining = Math.ceil(timeDiff / (1000 * 60 * 60));
      
      console.log(`📅 Invoice ${inv.id} expires on: ${dueDate.toISOString()}`);
      console.log(`⏰ Time remaining: ~${hoursRemaining} hours`);

      // Check if invoice has expired
      if (timeDiff <= 0) {
        console.log(`⚠️ Invoice ${inv.id} (${inv.name || 'No name'}) has expired.`);
        
        try {
          // Cancel the invoice
          console.log(`🔄 Attempting to cancel expired invoice ${inv.id}...`);
          await this.executeMethod('account.move', 'button_cancel', [[inv.id]]);
          
          // Verify cancellation
          const [updated] = await this.readInvoices([inv.id], ['state']);
          if (updated.state === 'cancel') {
            console.log(`✅ Successfully cancelled expired invoice ${inv.id}`);
            return { 
              success: true, 
              status: 'expired_cancelled', 
              invoiceId: inv.id,
              cancelled_at: new Date().toISOString(),
              original_expiry: inv.x_datetime
            };
          } else {
            throw new Error('Invoice state not updated to cancelled');
          }
        } catch (error) {
          console.error(`❌ Failed to cancel expired invoice ${inv.id}:`, error.message);
          return { 
            success: false, 
            status: 'cancel_failed', 
            invoiceId: inv.id,
            error: error.message,
            original_expiry: inv.x_datetime
          };
        }
      }

      // Invoice is still active
      console.log(`✅ Invoice ${inv.id} is still active. Expires in ~${hoursRemaining} hours.`);
      return { 
        success: true, 
        status: 'active', 
        invoiceId: inv.id,
        expiresInHours: hoursRemaining,
        expiresAt: dueDate.toISOString(),
        original_expiry: inv.x_datetime
      };

    } catch (error) {
      console.error(`❌ Error in checkAndExpireInvoice for invoice ${invoiceId}:`, error);
      return { 
        success: false, 
        status: 'error', 
        invoiceId: invoiceId,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}

export { TravelMasterAPI };
