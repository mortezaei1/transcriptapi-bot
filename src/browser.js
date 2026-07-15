import { chromium } from 'playwright';
import { execSync, execFileSync } from 'child_process';
import logger from './logger.js';

const CDP_PORT = 9222;

/**
 * Kill all running Chrome processes so the profile is not locked
 */
function killExistingChrome() {
  try {
    execSync('taskkill /F /IM chrome.exe /T', { stdio: 'ignore' });
    logger.info('Closed existing Chrome processes');
  } catch {
    // No Chrome running — that's fine
  }
}

/**
 * Sleep helper
 */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Launch Chrome manually with remote debugging port, then connect Playwright via CDP.
 *
 * This approach avoids the "DevTools requires a non-default data directory" error
 * that occurs when Playwright tries to use --remote-debugging-pipe with the real
 * Chrome default profile. Using CDP connection instead has no such restriction.
 *
 * @param {Object} config Application configuration
 * @returns {Promise<{browser: import('playwright').Browser, context: import('playwright').BrowserContext, page: import('playwright').Page}>}
 */
export async function launchBrowser(config) {
  logger.info('Launching browser with existing Chrome profile...');

  // Kill any existing Chrome so the profile is not locked
  killExistingChrome();
  await sleep(2000);

  const chromeArgs = [
    `--user-data-dir=${config.chromeProfilePath}`,
    `--profile-directory=${config.chromeProfileName}`,
    `--remote-debugging-port=${CDP_PORT}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--no-session-restore',
    '--hide-crash-restore-bubble',
    '--disable-blink-features=AutomationControlled',
    '--disable-infobars',
    '--start-maximized',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-features=Translate',
    'about:blank',
  ];

  // Use PowerShell Start-Process to launch Chrome as a fully independent
  // Windows process — avoids Chrome's single-instance handoff that causes
  // the process to immediately exit when spawned from Node.js
  const argsJoined = chromeArgs.map(a => `'${a.replace(/'/g, "''")}'`).join(',');
  const psCmd = `Start-Process -FilePath '${config.chromePath.replace(/\\/g, '\\\\')}' -ArgumentList ${argsJoined}`;

  logger.info('Launching Chrome via PowerShell...');
  execSync(`powershell -NoProfile -Command "${psCmd.replace(/"/g, '\\"')}"`, { stdio: 'ignore' });

  logger.info(`Chrome launched, waiting for DevTools on port ${CDP_PORT}...`);

  // Wait for Chrome DevTools to become available (60s timeout)
  await waitForCDP(CDP_PORT, 60000);
  logger.success('Chrome DevTools ready');

  // Connect Playwright to the running Chrome instance via CDP
  const browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`, {
    timeout: config.navigationTimeout,
  });

  // Get or create a browser context
  const contexts = browser.contexts();
  let context;
  let page;

  if (contexts.length > 0) {
    context = contexts[0];
    const pages = context.pages();
    page = pages.length > 0 ? pages[0] : await context.newPage();
  } else {
    context = await browser.newContext();
    page = await context.newPage();
  }

  // Set timeouts
  page.setDefaultNavigationTimeout(config.navigationTimeout);
  page.setDefaultTimeout(config.navigationTimeout);

  logger.success('Browser connected via CDP successfully');
  // Pass null for chromeProcess since PowerShell manages the lifecycle
  return { browser, context, page, chromeProcess: null };
}

/**
 * Poll http://localhost:{port}/json/version until Chrome DevTools responds
 * @param {number} port
 * @param {number} timeoutMs
 */
async function waitForCDP(port, timeoutMs = 30000) {
  const start = Date.now();
  const url = `http://localhost:${port}/json/version`;

  while (Date.now() - start < timeoutMs) {
    try {
      // Use Node's built-in fetch (Node 18+)
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // Not ready yet
    }
    await sleep(500);
  }

  throw new Error(`Chrome DevTools on port ${port} did not become ready within ${timeoutMs}ms`);
}

/**
 * Close the browser connection gracefully
 * @param {import('playwright').Browser} browser
 * @param {import('child_process').ChildProcess} chromeProcess
 */
export async function closeBrowser(browser, chromeProcess) {
  try {
    await browser.close();
    logger.info('Browser disconnected');
  } catch (err) {
    logger.warn(`Error closing browser: ${err.message}`);
  }

  // Kill the Chrome process we spawned
  try {
    if (chromeProcess && !chromeProcess.killed) {
      chromeProcess.kill('SIGTERM');
      // Force kill after 2 seconds
      setTimeout(() => {
        try { chromeProcess.kill('SIGKILL'); } catch { /* ignore */ }
      }, 2000);
    }
  } catch {
    // Try taskkill as fallback
    try {
      execSync('taskkill /F /IM chrome.exe /T', { stdio: 'ignore' });
    } catch { /* ignore */ }
  }

  logger.info('Browser closed');
}

export default { launchBrowser, closeBrowser };
