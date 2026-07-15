import logger from './logger.js';
import { humanClick, randomDelay } from './anti-detection.js';

/**
 * Handle the paywall page (Step 7)
 * Clicks "Continue with 100 Free Credits" and waits for navigation to verify-email
 *
 * @param {import('playwright').Page} page Playwright page
 * @param {Object} config Application config
 */
export async function handlePaywall(page, config) {
  logger.step('Step 7: Handling paywall page');

  // Verify we're on the paywall page
  await page.waitForURL('**/paywall**', { timeout: config.navigationTimeout });
  await randomDelay(1000, 2000);

  logger.info('Paywall page detected');

  // Click "Continue with 100 Free Credits"
  const freeCreditsSelectors = [
    'button:has-text("Continue with 100 Free Credits")',
    'a:has-text("Continue with 100 Free Credits")',
    ':text("100 Free Credits")',
    'button:has-text("Free Credits")',
    'a:has-text("Free Credits")',
    'button:has-text("Continue with")',
  ];

  let clicked = false;
  for (const sel of freeCreditsSelectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 5000 })) {
        await btn.scrollIntoViewIfNeeded();
        await randomDelay(500, 800);
        await btn.click();
        clicked = true;
        logger.debug(`Free credits button found: ${sel}`);
        break;
      }
    } catch {
      continue;
    }
  }

  if (!clicked) {
    // Fallback: scan all buttons and links for matching text
    const allClickables = page.locator('button, a, [role="button"]');
    const count = await allClickables.count();
    for (let i = 0; i < count; i++) {
      const text = await allClickables.nth(i).textContent();
      if (text && (text.includes('100 Free') || text.includes('Free Credits') || text.includes('free credits'))) {
        await allClickables.nth(i).scrollIntoViewIfNeeded();
        await randomDelay(300, 500);
        await allClickables.nth(i).click();
        clicked = true;
        break;
      }
    }
  }

  if (!clicked) {
    throw new Error('Could not find "Continue with 100 Free Credits" button');
  }

  // Wait for navigation away from paywall — use waitForLoadState which doesn't depend on URL
  logger.debug('Waiting for navigation away from paywall...');
  await page.waitForURL(
    url => !url.href.includes('paywall'),
    { timeout: config.navigationTimeout }
  );

  logger.success(`Claimed 100 free credits — navigated to: ${page.url()}`);
}

export default handlePaywall;
