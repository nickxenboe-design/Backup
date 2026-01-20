import { drizzle } from 'drizzle-orm/node-postgres';
import pool from '../config/postgres.js';
import * as schema from './schema.js';
import logger from '../utils/logger.js';

class DrizzleLogger {
  logQuery(query, params) {
    logger.debug('Drizzle query executed', {
      sql: query,
      params
    });
  }
}

// Drizzle client using the existing pg Pool
const db = drizzle(pool, { schema, logger: new DrizzleLogger() });

export default db;
export { schema };
export const {
  users,
  branches,
  agents,
  admins,
  tripSelections,
  cartPassengerDetails,
  carts,
  payments,
  tickets,
  cities
} = schema;
