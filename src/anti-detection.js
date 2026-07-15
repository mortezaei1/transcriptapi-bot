import { randomInt } from './utils.js';

/**
 * Sleep for a random duration between min and max milliseconds
 * @param {number} min Minimum delay in ms
 * @param {number} max Maximum delay in ms
 */
export async function randomDelay(min = 500, max = 1500) {
  const delay = randomInt(min, max);
  return new Promise(resolve => setTimeout(resolve, delay));
}

/**
 * Type text into an element with human-like random delays between keystrokes
 * @param {import('playwright').Page} page
 * @param {string} selector CSS selector for the input
 * @param {string} text Text to type
 */
export async function humanType(page, selector, text) {
  const element = typeof selector === 'string'
    ? page.locator(selector).first()
    : selector;
  await element.click();
  await randomDelay(200, 400);

  for (const char of text) {
    await page.keyboard.type(char, { delay: randomInt(45, 160) });
  }
}

/**
 * Click an element with human-like mouse behavior
 * Moves to the element with a slight random offset before clicking
 * @param {import('playwright').Page} page
 * @param {string} selector CSS selector or Playwright locator string
 * @param {Object} [options]
 * @param {number} [options.delayBefore=300] Min delay before click
 * @param {number} [options.delayAfter=200] Min delay after click
 */
export async function humanClick(page, selector, options = {}) {
  const { delayBefore = 300, delayAfter = 200 } = options;

  await randomDelay(delayBefore, delayBefore + 500);

  const element = typeof selector === 'string'
    ? page.locator(selector).first()
    : selector;

  // Get bounding box for random offset click
  const box = await element.boundingBox();
  if (box) {
    const offsetX = randomInt(Math.floor(box.width * 0.2), Math.floor(box.width * 0.8));
    const offsetY = randomInt(Math.floor(box.height * 0.2), Math.floor(box.height * 0.8));
    await page.mouse.move(box.x + offsetX, box.y + offsetY, {
      steps: randomInt(5, 15),
    });
    await randomDelay(100, 300);
    await page.mouse.click(box.x + offsetX, box.y + offsetY);
  } else {
    // Fallback to direct click
    await element.click();
  }

  await randomDelay(delayAfter, delayAfter + 400);
}

/**
 * Click an element with retry logic
 * @param {import('playwright').Page} page
 * @param {string} selector CSS selector
 * @param {number} [maxRetries=3] Number of retry attempts
 * @param {number} [retryDelay=1000] Delay between retries in ms
 */
export async function retryClick(page, selector, maxRetries = 3, retryDelay = 1000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await humanClick(page, selector);
      return;
    } catch (err) {
      if (attempt === maxRetries) throw err;
      await randomDelay(retryDelay, retryDelay * 2);
    }
  }
}

/**
 * Scroll the page by a random amount to simulate human behavior
 * @param {import('playwright').Page} page
 */
export async function humanScroll(page) {
  const scrollAmount = randomInt(100, 400);
  await page.mouse.wheel(0, scrollAmount);
  await randomDelay(300, 800);
}

/**
 * Move mouse to a random position on the page
 * @param {import('playwright').Page} page
 */
export async function randomMouseMove(page) {
  const viewport = page.viewportSize() || { width: 1280, height: 720 };
  const x = randomInt(100, viewport.width - 100);
  const y = randomInt(100, viewport.height - 100);
  await page.mouse.move(x, y, { steps: randomInt(5, 20) });
}
