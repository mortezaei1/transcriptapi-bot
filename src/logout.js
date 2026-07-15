import logger from './logger.js';
import { humanClick, randomDelay } from './anti-detection.js';

const SIGNUP_URL = 'https://transcriptapi.com/signup';

/**
 * Perform logout and navigate back to signup
 *
 * @param {import('playwright').Page} page
 * @param {Object} config
 */
export async function performLogout(page, config) {
  logger.step('Step 13: Logging out');

  const logoutSelectors = [
    'button:has(svg.lucide-log-out)',
    'button:has-text("Logout")',
    'button:has-text("Log out")',
    'button:has-text("Sign out")',
    'a:has-text("Logout")',
    'a:has-text("Log out")',
    'a:has-text("Sign out")',
    '[aria-label="Logout"]',
    '[aria-label="Log out"]',
  ];

  let loggedOut = false;
  for (const sel of logoutSelectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 3000 })) {
        await humanClick(page, btn);
        loggedOut = true;
        break;
      }
    } catch {
      continue;
    }
  }

  if (!loggedOut) {
    // Try finding logout in menus (click avatar/profile first)
    const menuSelectors = [
      '[class*="avatar"]',
      '[class*="profile"]',
      '[class*="user-menu"]',
      'button[class*="menu"]',
      'img[class*="avatar"]',
    ];

    for (const menuSel of menuSelectors) {
      try {
        const menu = page.locator(menuSel).first();
        if (await menu.isVisible({ timeout: 2000 })) {
          await humanClick(page, menu);
          await randomDelay(500, 1000);

          // Now try logout selectors again
          for (const sel of logoutSelectors) {
            try {
              const btn = page.locator(sel).first();
              if (await btn.isVisible({ timeout: 2000 })) {
                await humanClick(page, btn);
                loggedOut = true;
                break;
              }
            } catch {
              continue;
            }
          }
          if (loggedOut) break;
        }
      } catch {
        continue;
      }
    }
  }

  if (loggedOut) {
    logger.success('Logged out successfully');
    await randomDelay(2000, 3000);
  } else {
    logger.warn('Could not find logout button — navigating directly to signup');
  }

  // Ensure we're back at signup
  await page.goto(SIGNUP_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await randomDelay(1000, 2000);
  logger.info('Returned to signup page');
}

export default performLogout;
