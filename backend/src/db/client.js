import { drizzle } from 'drizzle-orm/node-postgres';
import pool from '../config/postgres.js';

export const db = drizzle(pool);
