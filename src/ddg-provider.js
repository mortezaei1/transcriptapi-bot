import logger from './logger.js';
import { randomDelay } from './anti-detection.js';

const SIGNUP_URL = 'https://transcriptapi.com/signup';

// Track the last email DDG gave us so we can detect when it reuses it
let lastUsedEmail = '';

/**
 * Custom error class thrown when DuckDuckGo keeps returning the same email address.
 */
export class DdgBlockedError extends Error {
  constructor(email) {
    super(`DuckDuckGo is stuck reusing the same email address: "${email}"`);
    this.name = 'DdgBlockedError';
    this.email = email;
  }
}

/**
 * Get a FRESH DuckDuckGo private email from the MAIN browser context by opening a new tab.
 * Keeps generating until it gets a brand new email that differs from lastUsedEmail.
 * If DDG is stuck reusing the same email, throws DdgBlockedError.
 *
 * @param {import('playwright').BrowserContext} ddgContext — the main browser context with DDG extension
 * @param {Object} config
 * @returns {Promise<string>} fresh duck.com email address
 * @throws {DdgBlockedError} when DDG is stuck reusing the same email
 */
export async function getDDGEmail(ddgContext, config) {
  logger.debug('[DDG] Creating a fresh tab for email generation...');
  const ddgPage = await ddgContext.newPage();

  try {
    logger.debug('[DDG] Navigating to signup page on main profile...');
    await ddgPage.goto(SIGNUP_URL, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await randomDelay(2000, 3000);

    const emailInput = ddgPage.locator('#email, input[type="email"], input[name="email"]').first();
    await emailInput.waitFor({ state: 'visible', timeout: 15000 });

    // Locate DDG icon once
    let ddgIcon = null;
    const ddgSelectors = [
      '[data-ddg-inputtype]',
      '.ddg-autofill-button',
      '[class*="ddg-autofill"]',
      '[class*="duckduckgo"]',
      'button[class*="ddg"]',
      '[aria-label*="duck" i]',
      '[aria-label*="email protection" i]',
    ];

    await emailInput.click();
    logger.debug('[DDG] Clicked email field — waiting for DDG icon...');

    for (let attempt = 0; attempt < 30; attempt++) {
      for (const sel of ddgSelectors) {
        try {
          const el = ddgPage.locator(sel).first();
          if (await el.isVisible({ timeout: 300 })) {
            ddgIcon = el;
            logger.debug(`[DDG] Icon found via ${sel} (attempt ${attempt + 1})`);
            break;
          }
        } catch { continue; }
      }
      if (ddgIcon) break;
      await randomDelay(500, 600);
    }

    if (!ddgIcon) {
      await ddgPage.screenshot({
        path: `${config.errorsDir}/ddg_main_icon_missing_${Date.now()}.png`,
        fullPage: true,
      }).catch(() => {});
      throw new Error('[DDG] Could not locate DDG extension icon on main profile');
    }

    const iconBox = await ddgIcon.boundingBox();
    logger.debug(`[DDG] Icon box: x=${Math.round(iconBox.x)}, y=${Math.round(iconBox.y)}, w=${Math.round(iconBox.width)}, h=${Math.round(iconBox.height)}`);

    const iconRight  = iconBox.x + iconBox.width;
    const iconCenterY = iconBox.y + iconBox.height / 2;
    const fallbackX  = iconBox.x + iconBox.width / 2;
    const fallbackY  = iconBox.y + iconBox.height + 80;

    let candidate = '';
    const maxAttempts = 5;

    for (let gen = 0; gen < maxAttempts; gen++) {
      // NOTE: We do NOT clear the field here. If it contains lastUsedEmail,
      // the extension sees it is filled and is forced to offer a new address.

      // Open the DDG dropdown
      await ddgPage.mouse.click(iconRight - 20, iconCenterY);
      logger.debug(`[DDG] Opened dropdown (gen ${gen + 1})`);
      await randomDelay(600, 900);

      // Try .js-use-private button first, then coordinate fallback
      try {
        const generateBtn = ddgPage.locator('.js-use-private').first();
        await generateBtn.waitFor({ state: 'visible', timeout: 5000 });
        await generateBtn.click();
        logger.debug('[DDG] Clicked .js-use-private button');
      } catch {
        logger.debug('[DDG] .js-use-private not found — coordinate fallback');
        await ddgPage.mouse.click(fallbackX, fallbackY);
      }

      await randomDelay(2000, 3000);

      // Read the current input value
      candidate = await emailInput.inputValue().catch(() => '');
      if (!candidate) candidate = await emailInput.evaluate(el => el.value).catch(() => '');

      logger.debug(`[DDG] Candidate email (gen ${gen + 1}): ${candidate}`);

      if (candidate && candidate.includes('@duck.com')) {
        if (candidate !== lastUsedEmail) {
          // Fresh new email!
          lastUsedEmail = candidate;
          logger.success(`[DDG] Fresh email obtained: ${candidate}`);
          return candidate;
        } else {
          // Same as last time — DDG reused it. Keep it in the field and try again.
          logger.debug(`[DDG] DDG reused "${candidate}". Keeping it in the field to force a new one on next attempt...`);
          await ddgPage.keyboard.press('Escape');
          await randomDelay(500, 800);
        }
      } else {
        logger.debug(`[DDG] No duck.com email in field — retrying...`);
        await ddgPage.keyboard.press('Escape');
        await randomDelay(500, 800);
      }
    }

    // If we finished the loop and the candidate is still the same reused email, throw DdgBlockedError
    if (candidate && candidate === lastUsedEmail) {
      throw new DdgBlockedError(lastUsedEmail);
    }

    await ddgPage.screenshot({
      path: `${config.errorsDir}/ddg_email_missing_${Date.now()}.png`,
      fullPage: true,
    }).catch(() => {});
    throw new Error('[DDG] Failed to generate any duck.com email');
  } finally {
    // Always close the tab when done
    logger.debug('[DDG] Closing temporary email generation tab...');
    await ddgPage.close().catch(() => {});
  }
}

export default getDDGEmail;
