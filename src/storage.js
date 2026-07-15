import fs from 'fs';
import path from 'path';
import logger from './logger.js';

/**
 * Save account data to both CSV and JSON files
 * Appends new records — never overwrites existing data
 *
 * @param {Object} accountData
 * @param {string} accountData.email
 * @param {string} accountData.password
 * @param {string} accountData.apiKey
 * @param {string} accountData.createdAt
 * @param {Object} config Application config
 */
export async function saveAccountData(accountData, config) {
  const { email, password, apiKey, createdAt } = accountData;

  // ── CSV ─────────────────────────────────────────────
  try {
    const csvPath = config.outputCsvPath;
    const csvDir = path.dirname(csvPath);
    fs.mkdirSync(csvDir, { recursive: true });

    // Create file with header if it doesn't exist
    if (!fs.existsSync(csvPath)) {
      fs.writeFileSync(csvPath, 'Email,Password,API_Key,Created_At\n', 'utf-8');
      logger.debug('CSV file created with headers');
    }

    // Escape CSV values (handle commas, quotes in passwords)
    const escapeCsv = (val) => {
      if (val.includes(',') || val.includes('"') || val.includes('\n')) {
        return `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    };

    const csvLine = [email, password, apiKey, createdAt]
      .map(escapeCsv)
      .join(',') + '\n';

    fs.appendFileSync(csvPath, csvLine, 'utf-8');
    logger.success(`Data saved to CSV: ${csvPath}`);
  } catch (err) {
    logger.error(`Failed to save CSV: ${err.message}`);
  }

  // ── JSON ────────────────────────────────────────────
  try {
    const jsonPath = config.outputJsonPath;
    const jsonDir = path.dirname(jsonPath);
    fs.mkdirSync(jsonDir, { recursive: true });

    // Load existing array or create new one
    let accounts = [];
    if (fs.existsSync(jsonPath)) {
      try {
        const raw = fs.readFileSync(jsonPath, 'utf-8');
        accounts = JSON.parse(raw);
        if (!Array.isArray(accounts)) {
          accounts = [];
        }
      } catch {
        logger.warn('JSON file was corrupted, starting fresh array');
        accounts = [];
      }
    }

    // Append new record
    accounts.push({
      email,
      password,
      apiKey,
      createdAt,
    });

    // Write back atomically (write to temp, then rename)
    const tempPath = jsonPath + '.tmp';
    fs.writeFileSync(tempPath, JSON.stringify(accounts, null, 2), 'utf-8');
    fs.renameSync(tempPath, jsonPath);

    logger.success(`Data saved to JSON: ${jsonPath} (${accounts.length} total accounts)`);
  } catch (err) {
    logger.error(`Failed to save JSON: ${err.message}`);
  }
}

export default saveAccountData;
