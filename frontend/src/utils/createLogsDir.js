import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Creates a logs directory if it doesn't exist
 * @returns {void}
 */
const createLogsDir = () => {
  try {
    const logsPath = path.join(__dirname, '../../logs');
    
    // Create logs directory if it doesn't exist
    if (!fs.existsSync(logsPath)) {
      fs.mkdirSync(logsPath, { recursive: true });
      console.log('Created logs directory at:', logsPath);
    }
    
    // Create error logs directory if it doesn't exist
    const errorLogsPath = path.join(logsPath, 'error');
    if (!fs.existsSync(errorLogsPath)) {
      fs.mkdirSync(errorLogsPath, { recursive: true });
    }
    
    // Create combined logs directory if it doesn't exist
    const combinedLogsPath = path.join(logsPath, 'combined');
    if (!fs.existsSync(combinedLogsPath)) {
      fs.mkdirSync(combinedLogsPath, { recursive: true });
    }
    
  } catch (error) {
    console.error('Failed to create logs directory:', error);
    // Don't throw error, just log it since this is not critical
  }
};

export { createLogsDir };
export default createLogsDir;
