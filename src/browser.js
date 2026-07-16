import { chromium } from 'playwright';
import { execSync } from 'child_process';
import logger from './logger.js';

const CDP_PORT_MAIN   = 9222;   // main profile (DDG extension)
const CDP_PORT_SIGNUP = 9223;   // fresh profiles (signup only)
const CDP_PORT = CDP_PORT_MAIN; // backward-compat alias

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
    `--remote-debugging-port=${CDP_PORT_MAIN}`,
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

/**
 * Launch a FRESH Chrome profile for signup (no DDG extension needed).
 * Uses a separate CDP port so it can run alongside the main DDG browser.
 *
 * @param {string} profilePath  Absolute path to the fresh profile directory
 * @param {Object} config
 * @returns {Promise<{browser, context, page}>}
 */
export async function launchSignupBrowser(profilePath, config) {
  const port = config.signupCdpPort || CDP_PORT_SIGNUP;
  logger.info(`Launching signup browser (port ${port}, profile: ${profilePath})...`);

  // Kill any existing Chrome on this debug port
  try {
    const existing = await fetch(`http://localhost:${port}/json/version`);
    if (existing.ok) {
      // There's already something on this port — try to close it gracefully
      logger.debug(`Killing stale signup browser on port ${port}...`);
      // We can't taskkill selectively by port so we'll just reuse the connection
    }
  } catch { /* nothing on the port — good */ }

  const chromeArgs = [
    `--user-data-dir=${profilePath}`,
    `--remote-debugging-port=${port}`,
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

  const argsJoined = chromeArgs.map(a => `'${a.replace(/'/g, "''")}'`).join(',');
  const psCmd = `Start-Process -FilePath '${config.chromePath.replace(/\\/g, '\\\\')}' -ArgumentList ${argsJoined}`;
  execSync(`powershell -NoProfile -Command "${psCmd.replace(/"/g, '\\"')}"`, { stdio: 'ignore' });

  await waitForCDP(port, 60000);
  logger.success(`Signup Chrome DevTools ready on port ${port}`);

  const browser = await chromium.connectOverCDP(`http://localhost:${port}`, {
    timeout: config.navigationTimeout,
  });

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

  page.setDefaultNavigationTimeout(config.navigationTimeout);
  page.setDefaultTimeout(config.navigationTimeout);

  logger.success('Signup browser connected via CDP');
  return { browser, context, page };
}

/**
 * Close ONLY the signup browser (port 9223), leaving the DDG browser running.
 *
 * @param {import('playwright').Browser} browser
 * @param {Object} config
 */
export async function closeSignupBrowser(browser, config) {
  const port = config.signupCdpPort || CDP_PORT_SIGNUP;
  try {
    await browser.close();
    logger.debug('Signup browser CDP connection closed');
  } catch { /* ignore */ }

  // Kill Chrome process listening on our signup port via netstat
  try {
    const out = execSync(
      `netstat -ano | findstr :${port}`,
      { encoding: 'utf8', stdio: ['pipe','pipe','ignore'] }
    );
    const pids = [...new Set(
      out.split('\n')
        .map(l => l.trim().split(/\s+/).pop())
        .filter(p => /^\d+$/.test(p) && p !== '0')
    )];
    for (const pid of pids) {
      try { execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' }); } catch { }
    }
    logger.debug(`Killed signup Chrome PID(s): ${pids.join(', ')}`);
  } catch { /* port not found or already closed */ }

  // Brief pause so the OS releases the port
  await sleep(1500);
  logger.info('Signup browser closed');
}

export default { launchBrowser, launchSignupBrowser, closeSignupBrowser, closeBrowser };
