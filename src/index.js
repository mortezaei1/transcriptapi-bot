import fs from 'fs';
import path from 'path';
import { loadConfig } from './config.js';
import logger from './logger.js';
import { launchBrowser, closeBrowser } from './browser.js';
import { authorizeGmail } from './gmail.js';
import { performSignup } from './signup.js';
import { handlePaywall } from './paywall.js';
import { handleVerification } from './verification.js';
import { handleOnboarding } from './onboarding.js';
import { saveAccountData } from './storage.js';
import { performLogout } from './logout.js';
import { randomDelay, humanClick } from './anti-detection.js';

const SIGNUP_URL = 'https://transcriptapi.com/signup';

/**
 * Save error diagnostic data (screenshot + HTML) for debugging
 *
 * @param {import('playwright').Page} page
 * @param {string} errorsDir
 * @param {number} accountNum
 * @param {string} stepName
 * @param {Error} error
 */
async function saveErrorDiagnostics(page, errorsDir, accountNum, stepName, error) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const prefix = `${timestamp}_account${accountNum}_${stepName}`;

  try {
    fs.mkdirSync(errorsDir, { recursive: true });

    // Screenshot
    const screenshotPath = path.join(errorsDir, `${prefix}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    logger.debug(`Error screenshot saved: ${screenshotPath}`);
  } catch (screenshotErr) {
    logger.warn(`Could not save screenshot: ${screenshotErr.message}`);
  }

  try {
    // HTML dump
    const htmlPath = path.join(errorsDir, `${prefix}.html`);
    const html = await page.content();
    fs.writeFileSync(htmlPath, html, 'utf-8');
    logger.debug(`Error HTML saved: ${htmlPath}`);
  } catch (htmlErr) {
    logger.warn(`Could not save HTML: ${htmlErr.message}`);
  }

  // Error log
  try {
    const logPath = path.join(errorsDir, `${prefix}.log`);
    const logContent = [
      `Account: #${accountNum}`,
      `Step: ${stepName}`,
      `Time: ${new Date().toISOString()}`,
      `URL: ${page.url()}`,
      `Error: ${error.message}`,
      `Stack: ${error.stack}`,
    ].join('\n');
    fs.writeFileSync(logPath, logContent, 'utf-8');
  } catch {
    // Silently ignore
  }
}

/**
 * Execute one complete account creation cycle
 *
 * @param {import('playwright').Page} page
 * @param {import('googleapis').Auth.OAuth2Client} gmailAuth
 * @param {Object} config
 * @param {number} accountNum
 * @returns {Promise<boolean>} true if successful, false if failed
 */
async function createOneAccount(page, gmailAuth, config, accountNum) {
  logger.newCycle(accountNum);

  let currentStep = 'signup';

  try {
    // Steps 1–6: Signup
    currentStep = 'signup';
    const { email, password, name } = await performSignup(page, config);

    // Step 7: Paywall
    currentStep = 'paywall';
    await handlePaywall(page, config);

    // Steps 8–10: Email verification
    currentStep = 'verification';
    await handleVerification(page, email, gmailAuth, config);

    // Step 11: Onboarding — collect API key
    currentStep = 'onboarding';
    const apiKey = await handleOnboarding(page, config);

    // Step 12: Save data
    currentStep = 'save';
    const createdAt = new Date().toISOString();
    await saveAccountData({ email, password, apiKey, createdAt }, config);

    // Step 13: Logout
    currentStep = 'logout';
    await performLogout(page, config);

    logger.separator();
    logger.success(`Account #${accountNum} created successfully!`);
    logger.info(`  Email:   ${email}`);
    logger.info(`  API Key: ${apiKey.substring(0, 8)}...`);
    logger.separator();

    return true;
  } catch (error) {
    logger.error(`Account #${accountNum} failed at step "${currentStep}": ${error.message}`);

    // Save error diagnostics
    try {
      await saveErrorDiagnostics(page, config.errorsDir, accountNum, currentStep, error);
    } catch {
      logger.warn('Could not save error diagnostics');
    }

    // Attempt recovery — navigate back to signup
    try {
      logger.info('Attempting recovery — navigating to signup page...');
      await page.goto(SIGNUP_URL, { waitUntil: 'networkidle', timeout: 25000 });
      await randomDelay(2000, 3000);
      logger.info('Recovery successful — ready for next account');
    } catch (recoveryErr) {
      // Try one more time with domcontentloaded
      try {
        await page.goto(SIGNUP_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await randomDelay(3000, 4000);
        logger.info('Recovery successful (domcontentloaded) — ready for next account');
      } catch (err2) {
        logger.error(`Recovery failed: ${err2.message}`);
      }
    }

    return false;
  }
}

/**
 * Main entry point — runs the account creation loop
 */
async function main() {
  console.log(`
  ╔══════════════════════════════════════════════════╗
  ║      TranscriptAPI Account Automation Bot        ║
  ║                   v1.0.0                         ║
  ╚══════════════════════════════════════════════════╝
  `);

  // Load configuration
  const config = loadConfig();

  // Authorize Gmail API
  logger.info('Initializing Gmail API...');
  const gmailAuth = await authorizeGmail(config);

  // Launch browser
  const { browser, context, page, chromeProcess } = await launchBrowser(config);

  const maxAccounts = config.maxAccounts;
  let accountNum = 0;
  let successCount = 0;
  let failCount = 0;

  try {
    // Warmup: navigate to signup page once to let extensions fully initialize
  // before starting the first account cycle
  logger.info('Warming up browser — giving extensions 8s to initialize...');
  try {
    await page.goto('https://transcriptapi.com/signup', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await randomDelay(8000, 10000);
    logger.info('Warmup complete — starting account loop');
  } catch {
    logger.warn('Warmup navigation failed — continuing anyway');
  }

  while (maxAccounts === 0 || accountNum < maxAccounts) {
      accountNum++;

      const success = await createOneAccount(page, gmailAuth, config, accountNum);

      if (success) {
        successCount++;
      } else {
        failCount++;
      }

      // Stats
      logger.info(`Stats: ${successCount} successful, ${failCount} failed, ${accountNum} total`);

      // Check if we should continue
      if (maxAccounts > 0 && accountNum >= maxAccounts) {
        logger.info(`Reached maximum account limit (${maxAccounts}). Stopping.`);
        break;
      }

      // Delay between accounts
      const delay = config.delayBetweenAccounts;
      logger.info(`Waiting ${delay / 1000}s before next account...`);
      await randomDelay(delay, delay + 2000);
    }
  } catch (fatalError) {
    logger.error(`Fatal error: ${fatalError.message}`);
    logger.error(fatalError.stack);
  } finally {
    // Final stats
    logger.separator();
    logger.info('=== Final Report ===');
    logger.info(`Total attempts: ${accountNum}`);
    logger.success(`Successful: ${successCount}`);
    if (failCount > 0) logger.error(`Failed: ${failCount}`);
    logger.separator();

    // Close browser
    await closeBrowser(browser, chromeProcess);
    logger.info('Bot shutdown complete');
  }
}

// Run
main().catch(err => {
  logger.error(`Unhandled error: ${err.message}`);
  logger.error(err.stack);
  process.exit(1);
});
