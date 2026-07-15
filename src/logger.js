import fs from 'fs';
import path from 'path';

const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  magenta: '\x1b[35m',
};

const LOG_LEVELS = {
  INFO: { color: COLORS.cyan, label: 'INFO' },
  SUCCESS: { color: COLORS.green, label: '  OK' },
  WARN: { color: COLORS.yellow, label: 'WARN' },
  ERROR: { color: COLORS.red, label: ' ERR' },
  STEP: { color: COLORS.magenta, label: 'STEP' },
  DEBUG: { color: COLORS.dim, label: ' DBG' },
};

class Logger {
  constructor(logFilePath = 'bot.log') {
    this.logFilePath = logFilePath;
    this.accountNumber = 0;

    // Ensure log file directory exists
    const dir = path.dirname(this.logFilePath);
    if (dir && dir !== '.') {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Set the current account number for log context
   */
  setAccount(num) {
    this.accountNumber = num;
  }

  /**
   * Get formatted timestamp [HH:MM:SS]
   */
  _timestamp() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    return `${h}:${m}:${s}`;
  }

  /**
   * Core log method
   */
  _log(level, message) {
    const { color, label } = LOG_LEVELS[level] || LOG_LEVELS.INFO;
    const ts = this._timestamp();
    const accountTag = this.accountNumber > 0 ? ` [#${this.accountNumber}]` : '';

    // Console output (colored)
    const consoleLine = `${COLORS.dim}[${ts}]${COLORS.reset} ${color}${COLORS.bright}${label}${COLORS.reset}${COLORS.dim}${accountTag}${COLORS.reset} ${message}`;
    console.log(consoleLine);

    // File output (plain)
    const fileLine = `[${ts}] ${label}${accountTag} ${message}\n`;
    try {
      fs.appendFileSync(this.logFilePath, fileLine);
    } catch {
      // Silently ignore file write errors
    }
  }

  info(msg) { this._log('INFO', msg); }
  success(msg) { this._log('SUCCESS', msg); }
  warn(msg) { this._log('WARN', msg); }
  error(msg) { this._log('ERROR', msg); }
  step(msg) { this._log('STEP', msg); }
  debug(msg) { this._log('DEBUG', msg); }

  /**
   * Log a separator line for visual clarity
   */
  separator() {
    const line = '─'.repeat(60);
    console.log(`${COLORS.dim}${line}${COLORS.reset}`);
    try {
      fs.appendFileSync(this.logFilePath, `${line}\n`);
    } catch {
      // Silently ignore
    }
  }

  /**
   * Log the start of a new account cycle
   */
  newCycle(accountNum) {
    this.setAccount(accountNum);
    this.separator();
    this.info(`Starting account creation cycle #${accountNum}`);
    this.separator();
  }
}

// Singleton instance
const logger = new Logger();

export default logger;
