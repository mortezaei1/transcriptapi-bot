import logger from './logger.js';
import { humanClick, humanType, randomDelay } from './anti-detection.js';
import { pollForVerificationCode } from './gmail.js';

/**
 * Handle email verification flow (Steps 8–10)
 *
 * 1. Click "Send Verification Code"
 * 2. Poll Gmail for the code
 * 3. Enter the code and submit
 *
 * @param {import('playwright').Page} page Playwright page
 * @param {string} email The DuckDuckGo email used for signup
 * @param {import('googleapis').Auth.OAuth2Client} gmailAuth Authorized Gmail client
 * @param {Object} config Application config
 */
export async function handleVerification(page, email, gmailAuth, config) {
  // Step 8: Click Send Verification Code
  logger.step('Step 8: Requesting verification code');

  // Wait to land on verify-email page (may have query params)
  // NOTE: Playwright passes URL object to predicate, must use .href.includes()
  await page.waitForURL(url => url.href.includes('verify'), { timeout: config.navigationTimeout });
  await randomDelay(1500, 2500);

  // Save diagnostic screenshot so we can see the exact page layout
  await page.screenshot({ path: `${config.errorsDir}/verify_email_page_${Date.now()}.png`, fullPage: true }).catch(() => {});
  logger.debug(`On verify-email page: ${page.url()}`);

  // Button HTML: <button class="...bg-primary...">Send verification code</button>
  // NOTE: Playwright CSS has-text is case-sensitive, use exact lowercase text
  const sendCodeSelectors = [
    'button:has-text("Send verification code")',
    'button:has-text("Send Verification Code")',
    'button.bg-primary',
    'button:has-text("Send Code")',
    'button:has-text("Send")',
    'button:has-text("Resend")',
    'button:has-text("Verify Email")',
    'button:has-text("Get Code")',
    'a:has-text("Send verification code")',
    'button[type="submit"]',
  ];

  let codeSent = false;
  for (const sel of sendCodeSelectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 3000 })) {
        await btn.scrollIntoViewIfNeeded();
        await btn.click();
        codeSent = true;
        logger.debug(`Send code button clicked: ${sel}`);
        break;
      }
    } catch { continue; }
  }

  if (!codeSent) {
    // Fallback: scan all buttons
    const buttons = page.locator('button, a, [role="button"]');
    const count = await buttons.count();
    for (let i = 0; i < count; i++) {
      const text = (await buttons.nth(i).textContent() || '').trim();
      logger.debug(`Button ${i}: "${text}"`);
      if (text && /send|verify|code|email/i.test(text)) {
        await buttons.nth(i).click();
        codeSent = true;
        logger.debug(`Fallback: clicked button "${text}"`);
        break;
      }
    }
  }

  if (!codeSent) {
    throw new Error('Could not find "Send Verification Code" button on verify-email page');
  }

  logger.success('Verification code requested');
  await randomDelay(1000, 2000);

  // Wait for the code input field to appear
  logger.debug('Waiting for verification code input to appear...');

  const codeInputSelectors = [
    'input[name="code"]',
    'input[name="verificationCode"]',
    'input[placeholder*="code" i]',
    'input[placeholder*="verification" i]',
    'input[type="text"]',
    'input[type="number"]',
    'input[inputmode="numeric"]',
  ];

  let codeInput = null;
  for (const sel of codeInputSelectors) {
    try {
      const input = page.locator(sel).first();
      if (await input.isVisible({ timeout: 5000 })) {
        codeInput = input;
        break;
      }
    } catch {
      continue;
    }
  }

  if (!codeInput) {
    throw new Error('Verification code input field not found');
  }

  // Step 9: Poll Gmail for the verification code
  logger.step('Step 9: Polling Gmail for verification code');

  const verificationCode = await pollForVerificationCode(gmailAuth, email, config);
  logger.success(`Verification code received: ${verificationCode}`);

  // Step 10: Enter the code and submit
  logger.step('Step 10: Entering verification code');

  await randomDelay(500, 1000);
  await humanType(page, codeInput, verificationCode);

  await randomDelay(500, 1000);

  // Look for a submit/verify button
  const verifySubmitSelectors = [
    'button:has-text("Verify")',
    'button:has-text("Submit")',
    'button:has-text("Confirm")',
    'button[type="submit"]',
    'input[type="submit"]',
  ];

  let submitted = false;
  for (const sel of verifySubmitSelectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 3000 })) {
        await humanClick(page, btn);
        submitted = true;
        break;
      }
    } catch {
      continue;
    }
  }

  if (!submitted) {
    // Try pressing Enter as fallback
    logger.debug('No submit button found, pressing Enter...');
    await page.keyboard.press('Enter');
  }

  // Wait for navigation to onboarding or dashboard
  logger.debug('Waiting for navigation to onboarding page...');
  await page.waitForURL(
    url => url.href.includes('onboarding') || url.href.includes('dashboard') || url.href.includes('api-key'),
    { timeout: config.navigationTimeout }
  );

  logger.success('Email verified — reached onboarding page');
}

export default handleVerification;
