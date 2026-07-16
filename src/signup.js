import logger from './logger.js';
import { humanType, humanClick, randomDelay, randomMouseMove } from './anti-detection.js';
import { generateRandomName, generateSecurePassword } from './utils.js';
import { performLogout } from './logout.js';

const SIGNUP_URL = 'https://transcriptapi.com/signup';

/**
 * Special error class thrown when TranscriptAPI rate-limits this IP/profile.
 * Caught by index.js to trigger a profile rotation.
 */
export class TooManyAttemptsError extends Error {
  constructor() {
    super('Too many signup attempts — profile rate-limited');
    this.name = 'TooManyAttemptsError';
  }
}

/**
 * Execute the full signup flow (Steps 1–6).
 * The @duck.com email is generated externally (by ddg-provider.js on the main
 * profile browser) and passed in — this page just types it into the form.
 *
 * @param {import('playwright').Page} page     Signup browser page (fresh profile)
 * @param {Object} config
 * @param {string} email                       Pre-generated @duck.com address
 * @returns {Promise<{email: string, password: string, name: string}>}
 * @throws {TooManyAttemptsError} when the site rate-limits this profile
 */
export async function performSignup(page, config, email) {
  // Step 1: Navigate to signup page
  logger.step('Step 1: Navigating to signup page');
  await page.goto(SIGNUP_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await randomDelay(2500, 3500);

  // Check if we got redirected to the dashboard (already logged in on this profile)
  if (page.url().includes('dashboard')) {
    logger.info('Already logged in (redirected to dashboard) — logging out first...');
    await performLogout(page, config);
    await page.goto(SIGNUP_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await randomDelay(2500, 3500);
  }

  logger.success('Signup page loaded');

  // ── Step 2: Type the pre-generated DDG email ─────────────────────────────
  logger.step('Step 2: Filling email (DDG address from main profile)');

  const emailInput = page.locator('#email, input[type="email"], input[name="email"]').first();
  await emailInput.waitFor({ state: 'visible', timeout: 20000 });
  await emailInput.click();
  await randomDelay(300, 600);
  await humanType(page, emailInput, email);
  logger.success(`Email filled: ${email}`);
  await randomDelay(400, 800);

  // Step 3: Fill name
  logger.step('Step 3: Filling name field');
  const name = generateRandomName();
  const nameInput = page.locator(
    '#name, input[name="name"], input[placeholder="John Doe"], input[placeholder*="name" i]:not([type="email"])'
  ).first();
  await nameInput.waitFor({ state: 'visible', timeout: 10000 });
  await humanType(page, nameInput, name);
  logger.success(`Name filled: ${name}`);
  await randomDelay(300, 700);

  // Step 4: Fill password
  logger.step('Step 4: Generating and filling password');
  const password = generateSecurePassword();
  const passwordInput = page.locator('#password, input[type="password"], input[name="password"]').first();
  await passwordInput.waitFor({ state: 'visible', timeout: 10000 });
  await humanType(page, passwordInput, password);
  logger.success('Password filled');
  await randomDelay(300, 700);
  await randomMouseMove(page);

  // Step 5: Accept terms
  logger.step('Step 5: Accepting terms and conditions');
  try {
    const checkbox = page.locator('#agreeToTerms, input[name="agreeToTerms"], input[type="checkbox"]').first();
    await humanClick(page, checkbox);
  } catch {
    await humanClick(page, page.locator('label[for="agreeToTerms"], label:has-text("I agree")').first());
  }
  logger.success('Terms accepted');
  await randomDelay(500, 1000);

  // Step 6: Submit form
  logger.step('Step 6: Submitting signup form');
  await humanClick(page, page.locator('button:has-text("Create Account"), button[type="submit"]').first());

  // Wait up to 35s for EITHER a redirect to paywall OR an error to appear
  logger.debug('Waiting for navigation to paywall...');
  try {
    await page.waitForURL('**/paywall**', { timeout: 35000 });
    logger.success('Signup successful — reached paywall page');
  } catch {
    // Redirect didn't happen — check why
    const currentUrl = page.url();
    const bodyText = (await page.locator('body').textContent().catch(() => '')).toLowerCase();

    // Check for rate-limit indicators
    if (
      bodyText.includes('too many signup') ||
      bodyText.includes('too many attempts') ||
      bodyText.includes('try again later') ||
      bodyText.includes('rate limit') ||
      currentUrl.includes('/signup')   // still on signup = rejected
    ) {
      // Grab exact error message for logging
      let errorMsg = 'Too many signup attempts';
      try {
        const errEl = page.locator('[class*="error"], [class*="alert"], [role="alert"], p[class*="red"], span[class*="red"]').first();
        if (await errEl.isVisible({ timeout: 2000 })) {
          errorMsg = (await errEl.textContent()).trim();
        }
      } catch { /* use default message */ }
      logger.warn(`⚠️  Rate limit detected on signup page: "${errorMsg}"`);
      throw new TooManyAttemptsError();
    }

    // Unknown failure — re-throw as generic error
    throw new Error(`Signup did not redirect to paywall (current URL: ${currentUrl})`);
  }

  return { email, password, name };
}

export default performSignup;
