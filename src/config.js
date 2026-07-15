import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

const DEFAULTS = {
  chromePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  chromeProfilePath: '',
  chromeProfileName: 'Default',
  gmailCredentialsPath: './credentials.json',
  gmailTokenPath: './token.json',
  outputCsvPath: './data/accounts.csv',
  outputJsonPath: './data/accounts.json',
  errorsDir: './errors',
  maxAccounts: 0,
  delayBetweenAccounts: 5000,
  headless: false,
  maxRetries: 3,
  navigationTimeout: 30000,
  gmailPollInterval: 3000,
  gmailPollTimeout: 120000,
};

/**
 * Load and validate configuration from config.json
 */
export function loadConfig() {
  const configPath = path.resolve(PROJECT_ROOT, 'config.json');
  let userConfig = {};

  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    userConfig = JSON.parse(raw);
    logger.info('Configuration loaded from config.json');
  } catch (err) {
    logger.warn(`Could not load config.json: ${err.message}. Using defaults.`);
  }

  const config = { ...DEFAULTS, ...userConfig };

  // Resolve relative paths to absolute from project root
  const pathKeys = [
    'gmailCredentialsPath', 'gmailTokenPath',
    'outputCsvPath', 'outputJsonPath', 'errorsDir',
  ];
  for (const key of pathKeys) {
    if (config[key] && !path.isAbsolute(config[key])) {
      config[key] = path.resolve(PROJECT_ROOT, config[key]);
    }
  }

  // Auto-detect Chrome profile path on Windows if not set
  if (!config.chromeProfilePath) {
    const localAppData = process.env.LOCALAPPDATA || '';
    config.chromeProfilePath = path.join(localAppData, 'Google', 'Chrome', 'User Data');
  }

  // Validate Chrome executable exists
  if (!fs.existsSync(config.chromePath)) {
    logger.warn(`Chrome not found at: ${config.chromePath}`);
  }

  // Ensure output directories exist
  const outputDirs = [
    path.dirname(config.outputCsvPath),
    path.dirname(config.outputJsonPath),
    config.errorsDir,
  ];
  for (const dir of outputDirs) {
    fs.mkdirSync(dir, { recursive: true });
  }

  logger.debug(`Chrome: ${config.chromePath}`);
  logger.debug(`Profile: ${config.chromeProfilePath} (${config.chromeProfileName})`);
  logger.debug(`Max accounts: ${config.maxAccounts === 0 ? 'unlimited' : config.maxAccounts}`);

  return config;
}

export default loadConfig;
