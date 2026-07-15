import logger from './logger.js';
import { humanType, humanClick, randomDelay, randomMouseMove } from './anti-detection.js';
import { generateRandomName, generateSecurePassword } from './utils.js';
import { performLogout } from './logout.js';

const SIGNUP_URL = 'https://transcriptapi.com/signup';

/**
 * Execute the full signup flow (Steps 1–6)
 * @param {import('playwright').Page} page
 * @param {Object} config
 * @returns {Promise<{email: string, password: string, name: string}>}
 */
export async function performSignup(page, config) {
  // Step 1: Navigate to signup page
  logger.step('Step 1: Navigating to signup page');
  await page.goto(SIGNUP_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  // Wait for the page's JS framework to render the form
  await randomDelay(2500, 3500);

  // Check if we got redirected to the dashboard (already logged in)
  if (page.url().includes('dashboard')) {
    logger.info('Already logged in (redirected to dashboard) — logging out first...');
    await performLogout(page, config);
    logger.info('Navigating back to signup page...');
    await page.goto(SIGNUP_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await randomDelay(2500, 3500);
  }

  logger.success('Signup page loaded');

  // Step 2: DuckDuckGo email generation
  logger.step('Step 2: Generating DuckDuckGo private email');

  const emailInput = page.locator('#email, input[type="email"], input[name="email"]').first();
  await emailInput.waitFor({ state: 'visible', timeout: 20000 });

  // Click email field to wake up DDG content script
  await emailInput.click();
  logger.debug('Clicked email field — waiting for DDG icon to appear...');

  // Poll every 500ms for up to 15s for DDG icon
  let ddgIcon = null;
  const ddgSelectors = [
    '[data-ddg-inputtype]',
    '.ddg-autofill-button',
    '[class*="ddg-autofill"]',
    '[class*="duckduckgo"]',
    'button[class*="ddg"]',
    '[aria-label*="duck" i]',
    '[aria-label*="email protection" i]',
    '[title*="duck" i]',
  ];

  for (let attempt = 0; attempt < 30; attempt++) {
    for (const sel of ddgSelectors) {
      try {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 300 })) {
          ddgIcon = el;
          logger.debug(`DDG icon found via selector: ${sel} (attempt ${attempt + 1})`);
          break;
        }
      } catch { continue; }
    }
    if (ddgIcon) break;
    await randomDelay(500, 600);
  }

  if (!ddgIcon) {
    await page.screenshot({ path: `${config.errorsDir}/ddg_icon_not_found_${Date.now()}.png`, fullPage: true }).catch(() => {});
    throw new Error('Could not locate DuckDuckGo extension icon on email field after 15s');
  }

  // Get the icon's position BEFORE clicking (for coordinate fallback)
  const iconBox = await ddgIcon.boundingBox();
  logger.debug(`DDG icon bounding box: x=${Math.round(iconBox?.x)}, y=${Math.round(iconBox?.y)}, w=${Math.round(iconBox?.width)}, h=${Math.round(iconBox?.height)}`);

  // Click the DDG icon — dropdown will appear injected into page DOM
  // Use direct mouse click on the duck icon (right edge of input)
  const iconRight = iconBox.x + iconBox.width;
  const iconCenterY = iconBox.y + iconBox.height / 2;
  await page.mouse.click(iconRight - 20, iconCenterY);
  logger.debug('DDG icon clicked via mouse — waiting for .js-use-private button...');

  // The DDG extension injects the dropdown HTML into the page DOM.
  // Use waitFor() which keeps polling until visible (up to 8s).
  let emailInserted = false;

  try {
    const generateBtn = page.locator('.js-use-private').first();
    await generateBtn.waitFor({ state: 'visible', timeout: 8000 });
    await generateBtn.click();
    logger.debug('Clicked .js-use-private button via waitFor');
    emailInserted = true;
  } catch {
    logger.debug('.js-use-private waitFor failed — trying coordinate click immediately after re-clicking icon...');
  }

  // Coordinate fallback: re-click icon then immediately click 2nd item
  if (!emailInserted) {
    try {
      // Re-open dropdown
      await page.mouse.click(iconRight - 20, iconCenterY);
      await page.waitForTimeout(350); // minimal wait for dropdown to render
      // 2nd item is ~80px below the input bottom (corrected from earlier attempts)
      const x = iconBox.x + iconBox.width / 2;
      const y = iconBox.y + iconBox.height + 80;
      await page.mouse.click(x, y);
      logger.debug(`Coordinate click at (${Math.round(x)}, ${Math.round(y)})`);
      emailInserted = true;
    } catch (e) {
      logger.warn(`Coordinate click failed: ${e.message}`);
    }
  }

  // Wait for DDG to fill the email field
  await randomDelay(2000, 3000);

  // Read the generated @duck.com email
  let email = '';
  for (let attempt = 0; attempt < 20; attempt++) {
    email = await emailInput.inputValue();
    if (email && email.includes('@duck.com')) break;
    await randomDelay(400, 700);
  }

  if (!email || !email.includes('@duck.com')) {
    email = await emailInput.evaluate(el => el.value);
  }

  if (!email || !email.includes('@duck.com')) {
    await page.screenshot({ path: `${config.errorsDir}/ddg_email_missing_${Date.now()}.png`, fullPage: true }).catch(() => {});
    throw new Error('DuckDuckGo email was not inserted into the field');
  }

  logger.success(`DuckDuckGo email generated: ${email}`);
  await randomMouseMove(page);
  await randomDelay(500, 1000);

  // Step 3: Fill name — exclude email-type inputs (placeholder "name@example.com" would match otherwise)
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

  // Wait for navigation to paywall
  logger.debug('Waiting for navigation to paywall...');
  await page.waitForURL('**/paywall**', { timeout: config.navigationTimeout });
  logger.success('Signup successful — reached paywall page');

  return { email, password, name };
}

export default performSignup;
