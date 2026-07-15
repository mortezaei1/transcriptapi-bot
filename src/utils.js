import crypto from 'crypto';

/**
 * Curated list of realistic first names
 */
const FIRST_NAMES = [
  'James', 'Alex', 'Daniel', 'Ethan', 'Oliver',
  'William', 'Benjamin', 'Lucas', 'Henry', 'Mason',
  'Logan', 'Alexander', 'Sebastian', 'Jack', 'Owen',
  'Liam', 'Noah', 'Elijah', 'Aiden', 'Samuel',
  'Matthew', 'Ryan', 'Nathan', 'Dylan', 'Andrew',
  'Tyler', 'Brandon', 'Justin', 'Aaron', 'Kevin',
  'Jordan', 'Kyle', 'Eric', 'Adam', 'Derek',
  'Marcus', 'Trevor', 'Colin', 'Shane', 'Blake',
  'Cameron', 'Caleb', 'Gavin', 'Evan', 'Ian',
  'Patrick', 'Sean', 'Connor', 'Dominic', 'Chase',
  'Nolan', 'Parker', 'Miles', 'Grant', 'Spencer',
];

const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';
const SYMBOLS = '!@#$%^&*_+-=?';
const ALL_CHARS = UPPERCASE + LOWERCASE + DIGITS + SYMBOLS;

/**
 * Generate a random realistic first name
 * @returns {string} Random first name
 */
export function generateRandomName() {
  const index = crypto.randomInt(0, FIRST_NAMES.length);
  return FIRST_NAMES[index];
}

/**
 * Generate a secure random password
 * @param {number} [minLength=16] Minimum password length
 * @param {number} [maxLength=20] Maximum password length
 * @returns {string} Secure random password
 */
export function generateSecurePassword(minLength = 16, maxLength = 20) {
  const length = crypto.randomInt(minLength, maxLength + 1);

  // Guarantee at least one of each character type
  const required = [
    UPPERCASE[crypto.randomInt(0, UPPERCASE.length)],
    LOWERCASE[crypto.randomInt(0, LOWERCASE.length)],
    DIGITS[crypto.randomInt(0, DIGITS.length)],
    SYMBOLS[crypto.randomInt(0, SYMBOLS.length)],
  ];

  // Fill remaining characters randomly
  const remaining = [];
  for (let i = required.length; i < length; i++) {
    remaining.push(ALL_CHARS[crypto.randomInt(0, ALL_CHARS.length)]);
  }

  // Combine and shuffle using Fisher-Yates
  const chars = [...required, ...remaining];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join('');
}

/**
 * Generate a random integer between min and max (inclusive)
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function randomInt(min, max) {
  return crypto.randomInt(min, max + 1);
}
