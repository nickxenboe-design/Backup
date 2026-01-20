import { pgTable, serial, varchar, integer, timestamp, boolean, jsonb, text, numeric, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// Authentication / identity tables
export const users = pgTable('users', {
  id: uuid('id').default(sql`gen_random_uuid()`).primaryKey(),
  email: text('email').notNull(),
  emailLower: text('email_lower').notNull().unique(),
  passwordHash: text('password_hash'),
  firstName: text('first_name'),
  lastName: text('last_name'),
  phone: text('phone'),
  role: text('role').default('user'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
});

export const branches = pgTable('branches', {
  id: uuid('id').default(sql`gen_random_uuid()`).primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  active: boolean('active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
});

export const agents = pgTable('agents', {
  id: uuid('id').default(sql`gen_random_uuid()`).primaryKey(),
  userId: uuid('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  branchId: uuid('branch_id')
    .references(() => branches.id, { onDelete: 'set null' }),
  emailLower: text('email_lower').notNull().unique(),
  firstName: text('first_name'),
  lastName: text('last_name'),
  phone: text('phone'),
  active: boolean('active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
});

export const admins = pgTable('admins', {
  id: uuid('id').default(sql`gen_random_uuid()`).primaryKey(),
  userId: uuid('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  emailLower: text('email_lower').notNull().unique(),
  firstName: text('first_name'),
  lastName: text('last_name'),
  phone: text('phone'),
  active: boolean('active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
});

// Cities table tailored to provided JSON fields (no extra columns)
export const cities = pgTable('cities', {
  countryCode2: varchar('country_code2', { length: 3 }),
  cityName: text('city_name'),
  cityId: text('city_id'),
  cityGeohash: text('city_geohash'),
  cityLat: numeric('city_lat', { precision: 10, scale: 7 }),
  cityLon: numeric('city_lon', { precision: 10, scale: 7 }),
  cityUriTemplate: text('city_uri_template')
});

// Stores a snapshot of the Busbud response when a user selects a trip
export const tripSelections = pgTable('trip_selections', {
  id: serial('id').primaryKey(),
  // Core identifiers
  cartId: text('cart_id').notNull(),
  firestoreCartId: text('firestore_cart_id'),
  tripId: text('trip_id').notNull(),
  tripType: varchar('trip_type', { length: 32 }).notNull(),
  isRoundTrip: boolean('is_round_trip').notNull().default(false),
  // Context
  passengerCount: integer('passenger_count'),
  currency: varchar('currency', { length: 8 }),
  // Raw Busbud payload (cart/trip details)
  raw: jsonb('raw').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
});

export const cartPassengerDetails = pgTable('cart_passenger_details', {
  id: serial('id').primaryKey(),
  cartId: text('cart_id').notNull(),
  firestoreCartId: text('firestore_cart_id'),
  tripId: text('trip_id'),
  passengerCount: integer('passenger_count'),
  purchaserFirstName: varchar('purchaser_first_name', { length: 128 }),
  purchaserLastName: varchar('purchaser_last_name', { length: 128 }),
  purchaserEmail: varchar('purchaser_email', { length: 256 }),
  purchaserPhone: varchar('purchaser_phone', { length: 64 }),
  optInMarketing: boolean('opt_in_marketing'),
  passengers: jsonb('passengers').notNull(),
  purchaser: jsonb('purchaser').notNull(),
  raw: jsonb('raw').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
});

export const carts = pgTable('carts', {
  id: serial('id').primaryKey(),
  cartId: text('cart_id').notNull().unique(),
  busbudCartId: text('busbud_cart_id'),
  bookedBy: text('booked_by'),
  status: text('status'),
  purchaseId: text('purchase_id'),
  purchaseUuid: text('purchase_uuid'),
  purchaseUpdatedAt: timestamp('purchase_updated_at', { withTimezone: true }),
  currency: text('currency'),
  origin: text('origin'),
  destination: text('destination'),
  departAt: text('depart_at'),
  arriveAt: text('arrive_at'),
  returnOrigin: text('return_origin'),
  returnDestination: text('return_destination'),
  returnDepartAt: text('return_depart_at'),
  returnArriveAt: text('return_arrive_at'),
  passengerCount: integer('passenger_count'),
  purchaser: jsonb('purchaser'),
  passengers: jsonb('passengers'),
  busbudResponse: jsonb('busbud_response'),
  costPrice: numeric('cost_price', { precision: 10, scale: 2 }),
  discount: numeric('discount', { precision: 10, scale: 2 }),
  markup: numeric('markup', { precision: 10, scale: 2 }),
  charges: numeric('charges', { precision: 10, scale: 2 }),
  commission: numeric('commission', { precision: 10, scale: 2 }),
  roundDiff: numeric('round_diff', { precision: 10, scale: 2 }),
  retailPrice: numeric('retail_price', { precision: 10, scale: 2 }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).default(sql`now() + interval '1 hour'`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
});

export const payments = pgTable('payments', {
  id: serial('id').primaryKey(),
  tripId: integer('trip_id'),
  amount: numeric('amount', { precision: 10, scale: 2 }).notNull(),
  costPrice: numeric('cost_price', { precision: 10, scale: 2 }),
  discount: numeric('discount', { precision: 10, scale: 2 }),
  markup: numeric('markup', { precision: 10, scale: 2 }),
  charges: numeric('charges', { precision: 10, scale: 2 }),
  commission: numeric('commission', { precision: 10, scale: 2 }),
  roundDiff: numeric('round_diff', { precision: 10, scale: 2 }),
  method: varchar('method', { length: 64 }).notNull(),
  status: varchar('status', { length: 64 }).notNull(),
  transactionRef: text('transaction_ref').notNull().unique(),
  bookedBy: text('booked_by'),
  rawResponse: jsonb('raw_response').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
});

export const tickets = pgTable('tickets', {
  id: serial('id').primaryKey(),
  pnr: text('pnr').notNull().unique(),
  bookedBy: text('booked_by'),
  url: text('url').notNull(),
  holdPdfBase64: text('hold_pdf_base64'),
  finalPdfBase64: text('final_pdf_base64'),
  finalZipBase64: text('final_zip_base64'),
  holdPdfUpdatedAt: timestamp('hold_pdf_updated_at', { withTimezone: true }),
  finalPdfUpdatedAt: timestamp('final_pdf_updated_at', { withTimezone: true }),
  finalZipUpdatedAt: timestamp('final_zip_updated_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
});
