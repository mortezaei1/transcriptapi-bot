import fs from 'fs';
import path from 'path';
import logger from './logger.js';
import { humanClick, randomDelay, randomMouseMove } from './anti-detection.js';

/**
 * Handle the onboarding page / dashboard page (Step 11)
 * Go to api-keys page, click visibility eye icon, and extract key.
 * Save keys to a simple txt file in the project.
 *
 * @param {import('playwright').Page} page Playwright page
 * @param {Object} config Application config
 * @returns {Promise<string>} The API key
 */
export async function handleOnboarding(page, config) {
  logger.step('Step 11: Collecting API key from dashboard/api-keys');

  const targetUrl = 'https://transcriptapi.com/dashboard/api-keys?page=1&page_size=10';
  logger.info(`Navigating to API keys page: ${targetUrl}`);
  
  await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 30000 });
  await randomDelay(2000, 3000);

  // Take a diagnostic screenshot to verify the page loaded
  await page.screenshot({ path: `${config.errorsDir}/api_keys_page_${Date.now()}.png`, fullPage: true }).catch(() => {});

  // 1. Click the eye button to make the API key visible
  // The user shared:
  // <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-eye w-5 h-5"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"></path><circle cx="12" cy="12" r="3"></circle></svg>
  
  logger.debug('Looking for visibility/eye icon to click...');
  
  const eyeSelectors = [
    '.lucide-eye',
    'svg.lucide-eye',
    'button:has(svg.lucide-eye)',
    'svg[class*="lucide-eye"]',
    'button svg',
  ];

  let eyeClicked = false;
  for (const selector of eyeSelectors) {
    try {
      const eyeBtn = page.locator(selector).first();
      if (await eyeBtn.isVisible({ timeout: 3000 })) {
        // Try to click the parent button if it exists, otherwise click the svg
        const parentButton = page.locator(`button:has(${selector})`).first();
        if (await parentButton.isVisible({ timeout: 1000 })) {
          await parentButton.click();
        } else {
          await eyeBtn.click();
        }
        eyeClicked = true;
        logger.debug(`Clicked eye icon with selector: ${selector}`);
        break;
      }
    } catch (e) {
      continue;
    }
  }

  if (!eyeClicked) {
    logger.warn('Could not find eye icon to click, trying to read text anyway...');
  } else {
    await randomDelay(1000, 2000);
  }

  // 2. Read the code block text
  // The user shared:
  // <code class="inline-block bg-muted px-2 py-1 rounded border border-border overflow-hidden text-ellipsis whitespace-nowrap font-mono w-48">••••••••••••••••</code>
  
  const codeSelectors = [
    'code.font-mono',
    'code',
    '.font-mono',
    'code[class*="font-mono"]',
  ];

  let apiKey = '';
  for (const selector of codeSelectors) {
    try {
      const codeEl = page.locator(selector).first();
      if (await codeEl.isVisible({ timeout: 3000 })) {
        const text = (await codeEl.textContent() || '').trim();
        // Ensure we got the actual revealed key (not dots)
        if (text && !text.includes('•') && text.length > 5) {
          apiKey = text;
          logger.debug(`Found API key with selector: ${selector}`);
          break;
        }
      }
    } catch {
      continue;
    }
  }

  // Fallback: Check if there's any copy button/click functionality that reveals it
  if (!apiKey) {
    // Let's check all code/input elements to see if any have text
    const elements = page.locator('code, input, span');
    const count = await elements.count();
    for (let i = 0; i < count; i++) {
      try {
        const text = (await elements.nth(i).textContent() || '').trim();
        if (text && text.length > 10 && !text.includes('•') && /^[a-zA-Z0-9_\-]+$/.test(text)) {
          apiKey = text;
          logger.debug('Found API key via fallback text scanning');
          break;
        }
      } catch {
        continue;
      }
    }
  }

  if (!apiKey) {
    // If still not found, let's take another screenshot to debug
    await page.screenshot({ path: `${config.errorsDir}/api_keys_failed_${Date.now()}.png`, fullPage: true }).catch(() => {});
    throw new Error('Could not extract API key (remained masked or element not found)');
  }

  logger.success(`API key successfully collected: ${apiKey.substring(0, 8)}...`);

  // 3. Save the key to a simple text file in the project directory
  // We will save to a file called "keys.txt" in the root directory.
  // We append each key and don't remove the file.
  try {
    const keysFilePath = path.join(process.cwd(), 'keys.txt');
    const fileContent = `${new Date().toISOString()} | ${apiKey}\n`;
    fs.appendFileSync(keysFilePath, fileContent, 'utf-8');
    logger.info(`API Key appended to ${keysFilePath}`);
  } catch (err) {
    logger.error(`Failed to write API key to file: ${err.message}`);
  }

  await randomMouseMove(page);
  return apiKey;
}

export default handleOnboarding;
