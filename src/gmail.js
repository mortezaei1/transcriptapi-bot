import fs from 'fs';
import http from 'http';
import { exec } from 'child_process';
import { google } from 'googleapis';
import logger from './logger.js';

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.modify'];

/**
 * Load OAuth2 client credentials from file
 * @param {string} credentialsPath Path to credentials.json
 * @returns {Object} Parsed credentials
 */
function loadCredentials(credentialsPath) {
  const raw = fs.readFileSync(credentialsPath, 'utf-8');
  return JSON.parse(raw);
}

/**
 * Create an OAuth2 client from credentials
 * @param {Object} credentials
 * @returns {import('googleapis').Auth.OAuth2Client}
 */
function createOAuth2Client(credentials) {
  const { client_id, client_secret, redirect_uris } = credentials.installed || credentials.web;
  // Use localhost for the redirect
  const redirectUri = 'http://localhost:3847';
  return new google.auth.OAuth2(client_id, client_secret, redirectUri);
}

/**
 * Authorize Gmail API access
 * On first run: opens browser for user consent, saves token
 * On subsequent runs: reuses saved refresh token
 *
 * @param {Object} config Application config
 * @returns {Promise<import('googleapis').Auth.OAuth2Client>} Authorized client
 */
export async function authorizeGmail(config) {
  const credentials = loadCredentials(config.gmailCredentialsPath);
  const oAuth2Client = createOAuth2Client(credentials);

  // Try to load existing token
  if (fs.existsSync(config.gmailTokenPath)) {
    try {
      const tokenData = JSON.parse(fs.readFileSync(config.gmailTokenPath, 'utf-8'));
      oAuth2Client.setCredentials(tokenData);
      logger.success('Gmail API authorized (using saved token)');
      return oAuth2Client;
    } catch (err) {
      logger.warn(`Saved token invalid: ${err.message}. Re-authorizing...`);
    }
  }

  // First-time authorization flow
  logger.info('Gmail authorization required. Opening browser for consent...');

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });

  // Start a temporary local server to receive the OAuth callback
  const code = await new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url, 'http://localhost:3847');
        const authCode = url.searchParams.get('code');

        if (authCode) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body style="font-family: Arial; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #1a1a2e; color: #e0e0e0;">
                <div style="text-align: center; padding: 40px; background: #16213e; border-radius: 16px; box-shadow: 0 4px 30px rgba(0,0,0,0.3);">
                  <h1 style="color: #4ecca3;">✓ Gmail Authorized</h1>
                  <p>You can close this tab and return to the bot.</p>
                </div>
              </body>
            </html>
          `);
          server.close();
          resolve(authCode);
        }
      } catch (err) {
        reject(err);
      }
    });

    server.listen(3847, () => {
      logger.info('Waiting for Gmail authorization callback on http://localhost:3847');
      // Open browser natively (Windows)
      exec(`start "" "${authUrl}"`);
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      server.close();
      reject(new Error('Gmail authorization timed out (5 minutes)'));
    }, 300000);
  });

  // Exchange code for tokens
  const { tokens } = await oAuth2Client.getToken(code);
  oAuth2Client.setCredentials(tokens);

  // Save token for future use
  fs.writeFileSync(config.gmailTokenPath, JSON.stringify(tokens, null, 2));
  logger.success('Gmail API authorized and token saved');

  return oAuth2Client;
}

/**
 * Poll Gmail for a verification email from TranscriptAPI
 * Searches recent unread emails and extracts the verification code
 *
 * @param {import('googleapis').Auth.OAuth2Client} auth Authorized Gmail client
 * @param {string} recipientEmail The DuckDuckGo email to filter for
 * @param {Object} config Application config
 * @returns {Promise<string>} The verification code
 */
export async function pollForVerificationCode(auth, recipientEmail, config) {
  const gmail = google.gmail({ version: 'v1', auth });

  const pollInterval = config.gmailPollInterval || 5000;
  const pollTimeout = config.gmailPollTimeout || 180000;
  // Record time just before polling — only accept emails that arrive AFTER this
  const requestSentAt = Math.floor(Date.now() / 1000);
  const startTime = Date.now();

  logger.info(`Polling Gmail for verification email (to: ${recipientEmail})...`);
  logger.debug(`Only accepting emails received after Unix timestamp: ${requestSentAt}`);

  // Give TranscriptAPI time to send and DDG time to forward (at least 15s)
  logger.debug('Waiting 15s for email delivery...');
  await new Promise(resolve => setTimeout(resolve, 15000));

  while (Date.now() - startTime < pollTimeout) {
    try {
      // Search for recent unread emails from TranscriptAPI sent to this duck.com address
      const query = `from:transcriptapi is:unread after:${requestSentAt - 60}`;

      const listRes = await gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: 10,
      });

      const messages = listRes.data.messages;

      if (messages && messages.length > 0) {
        for (const msg of messages) {
          const fullMsg = await gmail.users.messages.get({
            userId: 'me',
            id: msg.id,
            format: 'full',
          });

          // Check internal date — must be newer than when we sent the request
          const internalDate = parseInt(fullMsg.data.internalDate || '0') / 1000;
          const subject = fullMsg.data.payload?.headers?.find(h => h.name === 'Subject')?.value || '(no subject)';
          logger.debug(`Found email: "${subject}" (received: ${new Date(internalDate * 1000).toISOString()})`);

          if (internalDate < requestSentAt - 60) {
            logger.debug(`Skipping old email (received before request was sent)`);
            continue;
          }

          const body = extractEmailBody(fullMsg.data);

          // Strategy 1: find 6-digit code near verification keywords (most precise)
          const contextMatch = body.match(/(?:verification code|your code|use.*code)[^\d]*(\d{6})/i);
          // Strategy 2: any standalone 6-digit number NOT preceded by # (avoids CSS hex like #000000)
          const standaloneMatch = body.match(/(?<!#)\b([0-9]{6})\b/);

          const rawCode = contextMatch?.[1] || standaloneMatch?.[1];

          if (rawCode) {
            if (rawCode === '000000') {
              logger.debug('Ignoring code 000000 (CSS hex color or placeholder)');
              continue;
            }
            const code = rawCode;
            logger.success(`Verification code found: ${code}`);

            // Mark as read
            try {
              await gmail.users.messages.modify({
                userId: 'me',
                id: msg.id,
                requestBody: { removeLabelIds: ['UNREAD'] },
              });
            } catch { /* non-critical */ }

            return code;
          }
        }
      }
    } catch (err) {
      logger.warn(`Gmail poll error: ${err.message}`);
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    logger.debug(`No verification email yet... (${elapsed}s elapsed)`);
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  throw new Error(`Verification email not received within ${pollTimeout / 1000} seconds`);
}

/**
 * Extract the text body from a Gmail message
 * Handles both simple and multipart messages
 *
 * @param {Object} message Gmail message object
 * @returns {string} Decoded email body text
 */
function extractEmailBody(message) {
  const payload = message.payload;

  // Simple message with body data directly
  if (payload.body && payload.body.data) {
    return Buffer.from(payload.body.data, 'base64url').toString('utf-8');
  }

  // Multipart message — search parts recursively
  if (payload.parts) {
    for (const part of payload.parts) {
      // Prefer text/plain, fall back to text/html
      if (part.mimeType === 'text/plain' && part.body && part.body.data) {
        return Buffer.from(part.body.data, 'base64url').toString('utf-8');
      }
      if (part.mimeType === 'text/html' && part.body && part.body.data) {
        return Buffer.from(part.body.data, 'base64url').toString('utf-8');
      }
      // Nested multipart
      if (part.parts) {
        for (const subPart of part.parts) {
          if (subPart.body && subPart.body.data) {
            return Buffer.from(subPart.body.data, 'base64url').toString('utf-8');
          }
        }
      }
    }
  }

  return '';
}

// Allow running standalone for initial Gmail auth: node src/gmail.js
const isMainModule = process.argv[1] && (
  process.argv[1].endsWith('gmail.js') ||
  process.argv[1].endsWith('gmail')
);

if (isMainModule) {
  (async () => {
    const { loadConfig } = await import('./config.js');
    const config = loadConfig();
    await authorizeGmail(config);
    logger.success('Gmail authorization complete. You can now run the bot.');
    process.exit(0);
  })();
}

export default { authorizeGmail, pollForVerificationCode };
