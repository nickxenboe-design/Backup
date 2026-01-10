import pkg from 'pg';
import config from './index.js';
import logger from '../utils/logger.js';

const { Pool } = pkg;

const pool = new Pool({
  connectionString: config.database.url,
  max: config.database.maxConnections,
  idleTimeoutMillis: config.database.idleTimeoutMs,
  ssl: config.database.ssl
});

pool.on('error', (err) => {
  logger.error('Unexpected PostgreSQL client error', {
    message: err.message,
    stack: err.stack
  });
});

export const query = async (text, params) => {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const durationMs = Date.now() - start;
    logger.debug('Postgres query executed', {
      sql: text,
      params,
      durationMs
    });
    return result;
  } catch (err) {
    const durationMs = Date.now() - start;
    logger.error('Postgres query error', {
      sql: text,
      params,
      durationMs,
      message: err.message
    });
    throw err;
  }
};

export const getClient = () => pool.connect();

export default pool;
