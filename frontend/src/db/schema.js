import { pgTable, serial, varchar, integer, timestamp, boolean, jsonb, text, numeric } from 'drizzle-orm/pg-core';

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

export const payments = pgTable('payments', {
  id: serial('id').primaryKey(),
  tripId: integer('trip_id'),
  amount: numeric('amount', { precision: 10, scale: 2 }).notNull(),
  method: varchar('method', { length: 64 }).notNull(),
  status: varchar('status', { length: 64 }).notNull(),
  transactionRef: text('transaction_ref').notNull().unique(),
  rawResponse: jsonb('raw_response').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
});
