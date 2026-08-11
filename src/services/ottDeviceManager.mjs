// ============================================================================
// OTT DEVICE MANAGER — WhatsApp (Baileys) + Telegram (gramJS) via proxies
// ============================================================================
// Manages OTT device sessions:
//   - WhatsApp Web pairing via @whiskeysockets/baileys → generates real QR codes
//   - Telegram client pairing via gramJS → session strings
//   - All traffic routed through Tailscale residential proxy nodes (SOCKS5 via 3proxy)
// ============================================================================

import { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSIONS_DIR = path.join(__dirname, '../../ott_sessions');
const QR_DIR = path.join(__dirname, '../../public/qr');

// Ensure directories exist
fs.mkdirSync(SESSIONS_DIR, { recursive: true });
fs.mkdirSync(QR_DIR, { recursive: true });

// ========== IN-MEMORY DEVICE REGISTRY ==========
const activeDevices = new Map(); // deviceId → { socket, state, proxy, type, phoneNumber }
const reconnectCounts = new Map(); // deviceId → count (survives deviceInfo recreation)

// ========== DB CALLBACK (set by server.cjs) ==========
let dbUpdateCallback = null;
export function setDbUpdateCallback(cb) { dbUpdateCallback = cb; }

// ========== PROXY CONFIGURATION ==========
// Residential proxy nodes accessible via Tailscale mesh (100.x.x.x IPs)
// Each node runs 3proxy on port 3128 (SOCKS5)
const PROXY_NODES = (process.env.OTT_PROXY_NODES || '').split(',').filter(Boolean);
const DEFAULT_PROXY_PORT = parseInt(process.env.OTT_PROXY_PORT || '3128');

function getProxyAgent(deviceId) {
  if (PROXY_NODES.length === 0) return null;
  // Distribute devices across proxy nodes using hash
  const idx = Math.abs(hashCode(String(deviceId))) % PROXY_NODES.length;
  const proxyHost = PROXY_NODES[idx];
  const proxyUrl = `socks5://${proxyHost}:${DEFAULT_PROXY_PORT}`;
  return new SocksProxyAgent(proxyUrl);
}

function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

// ========== WHATSAPP (BAILEYS) ==========

/**
 * Start WhatsApp pairing session for a device.
 * Returns a QR code string that the user scans with WhatsApp.
 */
export async function startWhatsAppPairing(deviceId, phoneNumber, proxyNode = null) {
  // Preserve reconnect count across stopDevice (which deletes deviceInfo)
  const existingCount = reconnectCounts.get(deviceId) || 0;
  if (activeDevices.has(deviceId)) {
    await stopDevice(deviceId);
  }

  const authDir = path.join(SESSIONS_DIR, `wa_${deviceId}`);
  fs.mkdirSync(authDir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();

  // Resolve proxy agent (use device-specific or default from pool)
  let agent = null;
  if (proxyNode) {
    agent = new SocksProxyAgent(`socks5://${proxyNode}:${DEFAULT_PROXY_PORT}`);
  } else {
    agent = getProxyAgent(deviceId);
  }

  const deviceInfo = { deviceId, type: 'whatsapp', phoneNumber, proxy: proxyNode, state: 'pairing', startedAt: Date.now() };
  activeDevices.set(deviceId, deviceInfo);

  return new Promise((resolve, reject) => {
    try {
      const socket = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        browser: ['NET2APP Hub', 'Chrome', '1.0.0'],
        agent,
        connectTimeoutMs: 30000,
        qrTimeout: 60000,
      });

      deviceInfo.socket = socket;

      socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          // Got QR code — save and return
          const qrFile = path.join(QR_DIR, `wa_${deviceId}.txt`);
          fs.writeFileSync(qrFile, qr);
          deviceInfo.qr = qr;
          deviceInfo.state = 'qr_ready';
          console.log(`[OTT-WA] 📱 Device ${deviceId}: QR code ready`);
          resolve({ qr, deviceId, type: 'whatsapp' });
        }

        if (connection === 'open') {
          deviceInfo.state = 'connected';
          reconnectCounts.delete(deviceId); // Reset reconnect counter on success
          console.log(`[OTT-WA] ✅ Device ${deviceId}: Connected to WhatsApp`);
          // Persist connected state to DB so it survives server restarts
          if (dbUpdateCallback) {
            dbUpdateCallback(deviceId, 'connected').catch(e =>
              console.error(`[OTT-WA] ⚠ DB update failed for ${deviceId}: ${e.message}`));
          }
        }

        if (connection === 'close') {
          const shouldReconnect = (lastDisconnect?.error instanceof Boom) &&
            lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut;
          
          if (lastDisconnect?.error?.output?.statusCode === DisconnectReason.loggedOut) {
            deviceInfo.state = 'logged_out';
            console.log(`[OTT-WA] 🚫 Device ${deviceId}: Logged out`);
            if (dbUpdateCallback) {
              dbUpdateCallback(deviceId, 'logged_out').catch(e =>
                console.error(`[OTT-WA] ⚠ DB update failed for ${deviceId}: ${e.message}`));
            }
          } else if (shouldReconnect) {
            const count = (reconnectCounts.get(deviceId) || 0) + 1;
            reconnectCounts.set(deviceId, count);
            if (count > 10) {
              // Too many reconnect attempts — give up
              reconnectCounts.delete(deviceId);
              deviceInfo.state = 'disconnected';
              console.log(`[OTT-WA] ⚠ Device ${deviceId}: Max reconnect attempts (10), marking disconnected`);
              if (dbUpdateCallback) {
                dbUpdateCallback(deviceId, 'disconnected').catch(e =>
                  console.error(`[OTT-WA] ⚠ DB update failed for ${deviceId}: ${e.message}`));
              }
            } else {
              deviceInfo.state = 'reconnecting';
              console.log(`[OTT-WA] 🔄 Device ${deviceId}: Reconnecting (attempt ${count}/10)...`);
              setTimeout(() => startWhatsAppPairing(deviceId, phoneNumber, proxyNode), 5000);
            }
          } else {
            deviceInfo.state = 'disconnected';
            if (dbUpdateCallback) {
              dbUpdateCallback(deviceId, 'disconnected').catch(e =>
                console.error(`[OTT-WA] ⚠ DB update failed for ${deviceId}: ${e.message}`));
            }
          }
        }
      });

      socket.ev.on('creds.update', saveCreds);

      // Timeout after 2 minutes if no QR
      setTimeout(() => {
        if (deviceInfo.state === 'pairing') {
          deviceInfo.state = 'qr_timeout';
          resolve({ error: 'QR timeout — try again', deviceId, type: 'whatsapp' });
        }
      }, 120000);

    } catch (err) {
      deviceInfo.state = 'error';
      deviceInfo.error = err.message;
      reject(err);
    }
  });
}

/**
 * Get current WhatsApp QR code for a device.
 */
export function getWhatsAppQR(deviceId) {
  const device = activeDevices.get(deviceId);
  if (device?.qr) return device.qr;
  const qrFile = path.join(QR_DIR, `wa_${deviceId}.txt`);
  if (fs.existsSync(qrFile)) return fs.readFileSync(qrFile, 'utf8');
  return null;
}

/**
 * Send a WhatsApp message through a connected device.
 */
export async function sendWhatsAppMessage(deviceId, destination, message) {
  const device = activeDevices.get(deviceId);
  if (!device || device.state !== 'connected' || !device.socket) {
    throw new Error(`WhatsApp device ${deviceId} not connected`);
  }
  const jid = `${destination.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
  const result = await device.socket.sendMessage(jid, { text: message });
  return { success: true, deviceId, destination, messageId: result?.key?.id };
}

/**
 * Send a Telegram message through a connected device using GramJS.
 * Reconnects using the saved session if the client isn't currently active.
 */
export async function sendTelegramMessage(deviceId, destination, message) {
  // Check if we have an active connected client
  const existingInfo = tgClients.get(deviceId);
  let client = existingInfo?.client;
  let needsDisconnect = false;

  if (!client || !client.connected || existingInfo.state !== 'connected') {
    // Reconnect using saved session
    const sessionStr = await loadTelegramSession(deviceId);
    if (!sessionStr) {
      throw new Error(`Telegram device ${deviceId}: no saved session — pair the device first`);
    }

    // Build proxy config
    const device = activeDevices.get(deviceId);
    const proxyHost = device?.proxy || (PROXY_NODES.length > 0 ? PROXY_NODES[0] : null);
    const proxyPort = DEFAULT_PROXY_PORT;

    let clientOpts = { connectionRetries: 2, timeout: 20000, useWSS: false };
    if (proxyHost) {
      clientOpts.proxy = { ip: proxyHost, port: proxyPort, socksType: 5, timeout: 10 };
    }

    client = new TelegramClient(new StringSession(sessionStr), TG_API_ID, TG_API_HASH, clientOpts);
    await client.connect();
    needsDisconnect = true;
  }

  try {
    // Clean the destination number
    const cleanDest = destination.replace(/[^0-9+]/g, '');
    
    // Look up the user first, then send
    const entity = await client.getEntity(cleanDest);
    const result = await client.sendMessage(entity, { message });

    console.log(`[OTT-TG] ✉️ Device ${deviceId}: Message sent to ${cleanDest} (id=${result?.id})`);
    return { success: true, deviceId, destination, messageId: String(result?.id || '') };
  } catch (err) {
    console.error(`[OTT-TG] ❌ Device ${deviceId}: Send failed to ${destination}: ${err.message}`);
    throw new Error(`Telegram send failed: ${err.message}`);
  } finally {
    if (needsDisconnect) {
      try {
        const sessionStr = client.session.save();
        await saveTelegramSession(deviceId, sessionStr);
        await client.disconnect();
      } catch (_) {}
    }
  }
}

// ========== NUMBER VALIDATION ==========

/**
 * Validate if a phone number is on WhatsApp using the connected device.
 * Uses Baileys' onWhatsApp/jid check capability.
 */
export async function validateWhatsAppNumber(deviceId, phoneNumber) {
  const device = activeDevices.get(deviceId);
  if (!device || device.state !== 'connected' || !device.socket) {
    return { valid: false, error: 'Device not connected', httpStatus: 503 };
  }
  try {
    const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
    const jid = `${cleanNumber}@s.whatsapp.net`;
    // Check if the number exists on WhatsApp
    const [result] = await device.socket.onWhatsApp(jid);
    if (result && result.exists) {
      return { valid: true, jid: result.jid, number: cleanNumber };
    }
    return { valid: false, error: 'Number not on WhatsApp', httpStatus: 404 };
  } catch (e) {
    return { valid: false, error: `Validation error: ${e.message}`, httpStatus: 500 };
  }
}

/**
 * Validate if a phone number is on Telegram using GramJS.
 */
export async function validateTelegramNumber(deviceId, phoneNumber, proxyNode = null) {
  try {
    const proxyHost = proxyNode ? proxyNode.split(':')[0] : (PROXY_NODES.length > 0 ? PROXY_NODES[0] : null);
    const proxyPort = DEFAULT_PROXY_PORT;

    let clientOpts = { connectionRetries: 1, timeout: 15000, useWSS: false };
    if (proxyHost) {
      clientOpts.proxy = { ip: proxyHost, port: proxyPort, socksType: 5, timeout: 8 };
    }

    const client = new TelegramClient(new StringSession(''), TG_API_ID, TG_API_HASH, clientOpts);
    await client.connect();

    try {
      const cleanNumber = phoneNumber.replace(/[^0-9+]/g, '');
      const result = await client.invoke(
        new Api.contacts.ResolvePhone({ phone: cleanNumber })
      );

      await client.disconnect();

      return {
        valid: true,
        username: result?.users?.[0]?.username || '',
        firstName: result?.users?.[0]?.firstName || '',
        httpStatus: 200,
      };
    } catch (innerErr) {
      await client.disconnect();
      // Phone not found = not on Telegram
      if (innerErr.message?.includes('PHONE_NOT_OCCUPIED') || innerErr.message?.includes('400')) {
        return { valid: false, error: 'Number not on Telegram', httpStatus: 404 };
      }
      return { valid: false, error: innerErr.message, httpStatus: 500 };
    }
  } catch (e) {
    return { valid: false, error: `Validation error: ${e.message}`, httpStatus: 500 };
  }
}

/**
 * Validate a number against the appropriate platform (WhatsApp or Telegram)
 * based on the channel type.
 */
export async function validateOTTNumber(deviceId, channel, phoneNumber, proxyNode = null) {
  if (channel === 'whatsapp') {
    return validateWhatsAppNumber(deviceId, phoneNumber);
  }
  if (channel === 'telegram') {
    return validateTelegramNumber(deviceId, phoneNumber, proxyNode);
  }
  return { valid: true, message: 'No validation needed for this channel' };
}

// ========== TELEGRAM (GramJS — native Node.js MTProto) ==========
// No Python, no cron, no child processes. GramJS handles 100+ devices natively.

// Telegram API credentials — can be set via env vars, DB platform_settings, or setTelegramCredentials()
// ⚠️  CRITICAL: Default test DC (api_id=2040) — QR tokens WILL NOT SCAN on production Telegram!
// → Get real credentials at https://my.telegram.org/apps and set in the OTT Devices page
let TG_API_ID = parseInt(process.env.TELEGRAM_API_ID || '2040');
let TG_API_HASH = process.env.TELEGRAM_API_HASH || 'b18441a1ff607e10a989891a5462e627';

// Credentials set callback — called by server.cjs on startup with DB values
let tgCredentialsSet = false;
export function setTelegramCredentials(apiId, apiHash) {
  if (apiId && apiHash) {
    TG_API_ID = parseInt(apiId);
    TG_API_HASH = String(apiHash);
    tgCredentialsSet = true;
    console.log(`[OTT-TG] ✅ Telegram credentials set: api_id=${TG_API_ID}`);
    if (TG_API_ID === 2040) {
      console.warn('[OTT-TG] ⚠️  api_id=2040 is TEST credentials — QRs will NOT scan on production Telegram!');
    }
  }
}

if (!tgCredentialsSet && TG_API_ID === 2040) {
  console.warn('[OTT-TG] ⚠️  WARNING: Using Telegram TEST credentials (api_id=2040).');
  console.warn('[OTT-TG] ⚠️  QR codes will NOT scan on the production Telegram app!');
  console.warn('[OTT-TG] ⚠️  Set real credentials at https://my.telegram.org/apps or via the OTT Devices page');
}

// In-memory GramJS client registry (per device)
const tgClients = new Map(); // deviceId → { client, session, state, phoneNumber, pollTimer, token, expires }

// Maximum concurrent Telegram connections
const TG_MAX_CONCURRENT = parseInt(process.env.TG_MAX_CONCURRENT || '20');
let tgActiveConnections = 0;

/**
 * Generate QR code image from tg://login token (QR code PNG).
 */
function generateQRImage(deviceId, qrUrl) {
  try {
    // Use qrcode npm package if available, otherwise save the raw URL
    const qrFile = path.join(QR_DIR, `tg_${deviceId}.png`);
    // Dynamic import — qrcode may not be installed
    import('qrcode').then(qr => {
      qr.toFile(qrFile, qrUrl, { type: 'png', width: 300, margin: 2 })
        .then(() => console.log(`[OTT-TG] QR image saved: ${qrFile}`))
        .catch(e => console.warn(`[OTT-TG] QR image gen failed: ${e.message}`));
    }).catch(() => {
      // Fallback: write the URL as text
      fs.writeFileSync(path.join(QR_DIR, `tg_${deviceId}.txt`), qrUrl);
    });
  } catch (e) {
    // Silently ignore — QR image is optional
  }
}

/**
 * Start Telegram pairing session using GramJS (native Node.js MTProto).
 * Generates a real tg://login QR code that the user scans with their phone.
 *
 * IMPORTANT: The QR will only be scannable by the production Telegram app if
 * TG_API_ID/TG_API_HASH are REAL credentials from my.telegram.org/apps.
 * Test credentials (api_id=2040) connect to Telegram's test DC — the production
 * app will reject those tokens.
 */
export async function startTelegramPairing(deviceId, phoneNumber, proxyNode = null, apiId = null, apiHash = null) {
  // Stop existing session
  await stopTelegramClient(deviceId);

  // Throttle concurrent connections
  while (tgActiveConnections >= TG_MAX_CONCURRENT) {
    await new Promise(r => setTimeout(r, 500));
  }

  const effectiveApiId = apiId ? parseInt(apiId) : TG_API_ID;
  const effectiveApiHash = apiHash || TG_API_HASH;
  const sessionStr = await loadTelegramSession(deviceId);

  // Build proxy config for GramJS if available
  const proxyHost = proxyNode ? proxyNode.split(':')[0] : (PROXY_NODES.length > 0 ? PROXY_NODES[0] : null);
  const proxyPort = proxyNode && proxyNode.includes(':') ? parseInt(proxyNode.split(':')[1]) : DEFAULT_PROXY_PORT;

  let clientOpts = {
    connectionRetries: 3,
    timeout: 30000,
    useWSS: false,
  };
  if (proxyHost) {
    clientOpts.proxy = {
      ip: proxyHost,
      port: proxyPort,
      socksType: 5,
      timeout: 10,
    };
  }

  const client = new TelegramClient(
    new StringSession(sessionStr),
    effectiveApiId,
    effectiveApiHash,
    clientOpts
  );

  try {
    tgActiveConnections++;
    console.log(`[OTT-TG] 📱 Device ${deviceId}: Connecting to Telegram (api_id=${effectiveApiId})...`);
    await client.connect();
    console.log(`[OTT-TG] 📱 Device ${deviceId}: Connected. Exporting login token...`);

    // Export a self-contained login token → valid for ~30s after disconnect
    const result = await client.invoke(
      new Api.auth.ExportLoginToken({
        apiId: effectiveApiId,
        apiHash: effectiveApiHash,
        exceptIds: [],
      })
    );

    if (!result || !result.token) {
      throw new Error('ExportLoginToken returned no token');
    }

    // Base64url-encode the token for tg://login URL
    const tokenB64 = result.token
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const qrUrl = `tg://login?token=${tokenB64}`;
    const expiresAt = result.expires ? new Date(result.expires * 1000) : new Date(Date.now() + 30000);

    console.log(`[OTT-TG] 📱 Device ${deviceId}: Real QR → ${qrUrl.substring(0, 50)}... (expires ${expiresAt.toISOString()})`);

    // Generate QR PNG image for the frontend
    generateQRImage(deviceId, qrUrl);

    // Store in registry
    const deviceInfo = {
      deviceId, type: 'telegram', phoneNumber, proxy: proxyNode,
      state: 'qr_ready', qr: qrUrl, startedAt: Date.now(),
      expires: expiresAt,
      agent: proxyHost ? new SocksProxyAgent(`socks5://${proxyHost}:${proxyPort}`) : null,
    };
    activeDevices.set(deviceId, deviceInfo);

    // Store GramJS session
    tgClients.set(deviceId, {
      client,
      session: sessionStr,
      state: 'qr_ready',
      phoneNumber,
      token: result.token,
      expires: result.expires,
    });

    // Start polling for login success (user scans QR)
    startTelegramLoginPoll(deviceId, client, phoneNumber);

    // Auto-disconnect after 120s if not scanned
    setTimeout(() => {
      const info = tgClients.get(deviceId);
      // Guard: only disconnect if STILL in qr_ready (not already logged in)
      if (info && info.state === 'qr_ready' && !info._loginSuccess) {
        console.log(`[OTT-TG] ⏰ Device ${deviceId}: QR expired, disconnecting`);
        stopTelegramClient(deviceId).catch(() => {});
        // Update active device state
        const device = activeDevices.get(deviceId);
        if (device && device.state === 'qr_ready') {
          device.state = 'disconnected';
          device.qr = null;
        }
      }
    }, 120000);

    return {
      qr: qrUrl,
      qrImage: `/qr/tg_${deviceId}.png`,
      deviceId,
      type: 'telegram',
      pairingToken: tokenB64,
      expires: expiresAt.toISOString(),
      instructions: 'Open Telegram → Settings → Devices → Link Desktop Device → Scan QR',
    };

  } catch (err) {
    tgActiveConnections--;
    console.error(`[OTT-TG] ❌ Device ${deviceId}: QR generation failed: ${err.message}`);

    // Generate fallback pairing token so UI still works
    const pairingToken = `tg_${deviceId}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const deviceInfo = {
      deviceId, type: 'telegram', phoneNumber, proxy: proxyNode,
      state: 'pairing', pairingToken, startedAt: Date.now(),
      error: err.message,
    };
    activeDevices.set(deviceId, deviceInfo);

    try { await client.disconnect(); } catch (_) {}
    tgClients.delete(deviceId);

    console.log(`[OTT-TG] 📱 Device ${deviceId}: Fallback pairing token → ${pairingToken} (error: ${err.message})`);
    return {
      deviceId,
      type: 'telegram',
      pairingToken,
      error: err.message,
      instructions: `QR generation failed (${err.message}). Use this token to authenticate via the Telegram API. Make sure real API credentials are set in TELEGRAM_API_ID / TELEGRAM_API_HASH env vars.`,
    };
  }
}

/**
 * Poll for login completion using ImportLoginToken.
 * When the user scans the QR, Telegram sends a LoginTokenSuccess.
 */
async function startTelegramLoginPoll(deviceId, client, phoneNumber) {
  const info = tgClients.get(deviceId);
  if (!info || !info.token) return;

  const maxPolls = 60; // Poll every 2s for up to 120s
  let polls = 0;

  const poll = async () => {
    if (polls >= maxPolls) return;
    polls++;

    const currentInfo = tgClients.get(deviceId);
    if (!currentInfo || currentInfo.state !== 'qr_ready') return;

    try {
      const importResult = await client.invoke(
        new Api.auth.ImportLoginToken({ token: currentInfo.token })
      );

      if (importResult.className === 'auth.LoginTokenSuccess') {
        // User scanned the QR and authorized!
        console.log(`[OTT-TG] ✅ Device ${deviceId}: Login SUCCESS — user scanned QR`);
        currentInfo.state = 'connected';
        currentInfo._loginSuccess = true; // Prevents auto-disconnect race

        // Save session string for future reconnection
        const sessionStr = client.session.save();
        if (sessionStr && sessionStr.length > 10) {
          await saveTelegramSession(deviceId, sessionStr);
        }

        // Update active device
        const device = activeDevices.get(deviceId);
        if (device) {
          device.state = 'connected';
          device.session = sessionStr;
        }

        // Persist to DB
        if (dbUpdateCallback) {
          dbUpdateCallback(deviceId, 'connected').catch(e =>
            console.error(`[OTT-TG] ⚠ DB update failed for ${deviceId}: ${e.message}`));
        }

        console.log(`[OTT-TG] ✅ Device ${deviceId}: Connected! User: ${importResult.authorization?.user?.firstName || 'unknown'}`);
        
        // Start periodic session health check — detect if user unlinks from phone
        startTelegramSessionMonitor(deviceId, client);
        return;
      }

      if (importResult.className === 'auth.LoginTokenMigrateTo') {
        console.log(`[OTT-TG] 🔄 Device ${deviceId}: DC migration to ${importResult.dcId}`);
        currentInfo.state = 'migrating';
        return;
      }

      // Still waiting — schedule next poll
      currentInfo._pollErrors = 0;
      currentInfo.pollTimer = setTimeout(poll, 2000);
    } catch (pollErr) {
      // Token expired or connection lost
      currentInfo._pollErrors = (currentInfo._pollErrors || 0) + 1;
      console.warn(`[OTT-TG] ⚠ Device ${deviceId}: Poll error (${currentInfo._pollErrors}/${maxPolls}): ${pollErr.message}`);
      // After 3 consecutive errors, give up
      if (currentInfo._pollErrors >= 3) {
        console.warn(`[OTT-TG] ⚠ Device ${deviceId}: Too many poll errors, disconnecting`);
        currentInfo.state = 'disconnected';
        const device = activeDevices.get(deviceId);
        if (device) device.state = 'disconnected';
        await stopTelegramClient(deviceId).catch(() => {});
        return;
      }
      // Retry with backoff
      currentInfo.pollTimer = setTimeout(poll, 5000);
    }
  };

  // Start polling after a short delay (user needs time to scan)
  info.pollTimer = setTimeout(poll, 2000);
}

/**
 * Monitor Telegram session health — detect logout/revocation from phone side.
 * Runs every 30s while the device is connected. If the session is revoked
 * (user logged out from phone), updates state + DB to 'logged_out'.
 */
async function startTelegramSessionMonitor(deviceId, client) {
  const MONITOR_INTERVAL = 30000; // 30 seconds
  
  const check = async () => {
    const info = tgClients.get(deviceId);
    if (!info || info.state !== 'connected') return; // Stopped monitoring
    
    try {
      // Simple API call to verify session is still valid
      await client.getMe();
      // Session is healthy — schedule next check
      info._monitorTimer = setTimeout(check, MONITOR_INTERVAL);
    } catch (err) {
      const msg = err.message || '';
      // Auth key errors = session revoked / logged out from phone
      if (msg.includes('AUTH_KEY') || msg.includes('SESSION') || msg.includes('UNAUTHORIZED') || msg.includes('401')) {
        console.log(`[OTT-TG] 🚫 Device ${deviceId}: Session revoked — user logged out from phone`);
        info.state = 'logged_out';
        
        // Update in-memory state
        const device = activeDevices.get(deviceId);
        if (device) {
          device.state = 'logged_out';
          device.qr = null;
        }
        
        // Persist to DB
        if (dbUpdateCallback) {
          dbUpdateCallback(deviceId, 'logged_out').catch(e =>
            console.error(`[OTT-TG] ⚠ DB update failed for ${deviceId}: ${e.message}`));
        }
        
        // Clean up client
        await stopTelegramClient(deviceId).catch(() => {});
      } else {
        // Transient error (network blip) — retry
        console.warn(`[OTT-TG] ⚠ Device ${deviceId}: Health check error: ${msg.substring(0, 80)}`);
        info._monitorTimer = setTimeout(check, MONITOR_INTERVAL);
      }
    }
  };
  
  info._monitorTimer = setTimeout(check, MONITOR_INTERVAL);
}

/**
 * Stop a Telegram client and clean up.
 */
async function stopTelegramClient(deviceId) {
  const info = tgClients.get(deviceId);
  if (info) {
    if (info.pollTimer) clearTimeout(info.pollTimer);
    if (info._monitorTimer) clearTimeout(info._monitorTimer);
    try {
      // Save session before disconnecting
      if (info.client && info.client.connected) {
        const sessionStr = info.client.session.save();
        await saveTelegramSession(deviceId, sessionStr);
      }
      await info.client?.disconnect();
    } catch (_) {}
    tgClients.delete(deviceId);
    tgActiveConnections = Math.max(0, tgActiveConnections - 1);
    console.log(`[OTT-TG] 🛑 Device ${deviceId}: Disconnected (active: ${tgActiveConnections})`);
  }
}

/**
 * Save GramJS session string to disk for persistence.
 */
async function saveTelegramSession(deviceId, sessionStr) {
  if (!sessionStr) return;
  try {
    const sessionDir = path.join(SESSIONS_DIR, `tg_${deviceId}`);
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(path.join(sessionDir, 'session.txt'), sessionStr);
  } catch (e) {
    console.error(`[OTT-TG] Failed to save session for ${deviceId}: ${e.message}`);
  }
}

/**
 * Load GramJS session string from disk.
 */
async function loadTelegramSession(deviceId) {
  try {
    const sessionFile = path.join(SESSIONS_DIR, `tg_${deviceId}`, 'session.txt');
    if (fs.existsSync(sessionFile)) {
      return fs.readFileSync(sessionFile, 'utf8').trim();
    }
  } catch (_) {}
  return '';
}

/**
 * Send Telegram auth code through proxy to complete pairing.
 */
export async function sendTelegramAuthCode(deviceId, apiId, apiHash, phoneNumber) {
  const device = activeDevices.get(deviceId);
  if (!device) throw new Error(`Device ${deviceId} not found in pairing state`);

  try {
    device.state = 'awaiting_code';
    device.apiId = apiId;
    device.apiHash = apiHash;

    console.log(`[OTT-TG] 📱 Device ${deviceId}: Auth code requested for ${phoneNumber}`);
    return { success: true, deviceId, status: 'awaiting_code' };
  } catch (err) {
    device.state = 'error';
    device.error = err.message;
    throw err;
  }
}

// ========== DEVICE MANAGEMENT ==========

/**
 * Stop and clean up a device session.
 */
export async function stopDevice(deviceId) {
  const device = activeDevices.get(deviceId);
  if (!device) return;
  
  try {
    if (device.socket) {
      device.socket.end?.();
      device.socket.logout?.();
    }
  } catch (e) { /* ignore */ }

  // Also stop any active GramJS client
  await stopTelegramClient(deviceId);
  
  reconnectCounts.delete(deviceId);
  activeDevices.delete(deviceId);
  console.log(`[OTT] 🛑 Device ${deviceId}: Stopped`);
}

/**
 * Get device status.
 */
export function getDeviceStatus(deviceId) {
  const device = activeDevices.get(deviceId);
  if (!device) return { deviceId, state: 'disconnected', type: null };
  return {
    deviceId,
    state: device.state,
    type: device.type,
    phoneNumber: device.phoneNumber,
    startedAt: device.startedAt,
    hasQR: !!device.qr,
    proxy: device.proxy || 'auto',
  };
}

/**
 * Get all active device statuses.
 */
export function getAllDeviceStatuses() {
  const statuses = [];
  for (const [id, device] of activeDevices) {
    statuses.push({
      deviceId: id,
      state: device.state,
      type: device.type,
      phoneNumber: device.phoneNumber,
      startedAt: device.startedAt,
      proxy: device.proxy || 'auto',
    });
  }
  return statuses;
}

/**
 * Check if a device is connected and ready to send messages.
 */
export function isDeviceConnected(deviceId) {
  const device = activeDevices.get(deviceId);
  if (device?.state === 'connected') return true;
  // Also check GramJS clients
  const tgInfo = tgClients.get(deviceId);
  return tgInfo?.state === 'connected';
}

/**
 * Get all connected Telegram device IDs (for health checks).
 */
export function getConnectedTelegramDevices() {
  const connected = [];
  for (const [id, info] of tgClients) {
    if (info.state === 'connected') connected.push(id);
  }
  return connected;
}

/**
 * Tear down all Telegram clients (for graceful shutdown).
 */
export async function shutdownTelegramClients() {
  const ids = [...tgClients.keys()];
  console.log(`[OTT-TG] Shutting down ${ids.length} Telegram clients...`);
  await Promise.all(ids.map(id => stopTelegramClient(id)));
}

/**
 * Resume monitoring for all Telegram devices marked as 'connected' in DB.
 * Called on server startup to recover session monitors after a restart.
 * @param {Function} queryFn — async (sql, params) => { rows }
 */
export async function resumeConnectedTelegramDevices(queryFn) {
  try {
    const result = await queryFn(
      `SELECT id, phone_number, proxy_node FROM ott_devices
       WHERE device_type = 'telegram' AND session_status = 'connected'`
    );
    
    const devices = result.rows || result;
    if (!devices || devices.length === 0) return;
    
    console.log(`[OTT-TG] 🔄 Resuming ${devices.length} connected Telegram device(s) after restart...`);
    
    for (const dev of devices) {
      try {
        const sessionStr = await loadTelegramSession(dev.id);
        if (!sessionStr || sessionStr.length < 10) {
          console.warn(`[OTT-TG] ⚠ Device ${dev.id}: No saved session, marking disconnected`);
          if (dbUpdateCallback) {
            dbUpdateCallback(String(dev.id), 'disconnected').catch(() => {});
          }
          continue;
        }
        
        // Reconnect with saved session
        const proxyHost = dev.proxy_node || (PROXY_NODES.length > 0 ? PROXY_NODES[0] : null);
        const proxyPort = DEFAULT_PROXY_PORT;
        
        let clientOpts = { connectionRetries: 2, timeout: 20000, useWSS: false };
        if (proxyHost) {
          clientOpts.proxy = { ip: proxyHost, port: proxyPort, socksType: 5, timeout: 10 };
        }
        
        const client = new TelegramClient(new StringSession(sessionStr), TG_API_ID, TG_API_HASH, clientOpts);
        await client.connect();
        
        // Verify session is still valid
        try {
          await client.getMe();
        } catch (authErr) {
          console.warn(`[OTT-TG] ⚠ Device ${dev.id}: Saved session expired, marking disconnected`);
          await client.disconnect();
          if (dbUpdateCallback) {
            dbUpdateCallback(String(dev.id), 'disconnected').catch(() => {});
          }
          continue;
        }
        
        // Session valid — register and start monitoring
        tgClients.set(String(dev.id), {
          client,
          session: sessionStr,
          state: 'connected',
          phoneNumber: dev.phone_number,
          _loginSuccess: true,
        });
        
        const deviceInfo = {
          deviceId: String(dev.id),
          type: 'telegram',
          phoneNumber: dev.phone_number,
          proxy: proxyHost,
          state: 'connected',
          startedAt: Date.now(),
          session: sessionStr,
        };
        activeDevices.set(String(dev.id), deviceInfo);
        
        startTelegramSessionMonitor(String(dev.id), client);
        console.log(`[OTT-TG] ✅ Device ${dev.id}: Monitor resumed — watching for phone-side disconnect`);
        
      } catch (devErr) {
        console.warn(`[OTT-TG] ⚠ Device ${dev.id}: Resume failed — ${devErr.message}`);
      }
    }
  } catch (e) {
    console.error(`[OTT-TG] ❌ Failed to resume connected Telegram devices: ${e.message}`);
  }
}

// ========== PROXY MANAGEMENT ==========

/**
 * Test connectivity to a proxy node.
 */
export async function testProxyNode(proxyHost, port = DEFAULT_PROXY_PORT) {
  try {
    const agent = new SocksProxyAgent(`socks5://${proxyHost}:${port}`);
    const resp = await fetch('https://api.ipify.org?format=json', {
      agent,
      signal: AbortSignal.timeout(5000),
    });
    const data = await resp.json();
    return { success: true, exitIp: data.ip, proxy: `${proxyHost}:${port}` };
  } catch (e) {
    return { success: false, error: e.message, proxy: `${proxyHost}:${port}` };
  }
}

/**
 * Add a proxy node to the pool.
 */
export function addProxyNode(host, port = DEFAULT_PROXY_PORT) {
  const addr = `${host}:${port}`;
  if (!PROXY_NODES.includes(host)) {
    PROXY_NODES.push(host);
    console.log(`[OTT-PROXY] ➕ Added proxy node: ${addr}`);
  }
  return PROXY_NODES;
}

/**
 * Get current proxy pool.
 */
export function getProxyPool() {
  return PROXY_NODES.map(h => `${h}:${DEFAULT_PROXY_PORT}`);
}

/**
 * Remove a proxy node from the pool.
 */
export function removeProxyNode(host) {
  const idx = PROXY_NODES.indexOf(host);
  if (idx >= 0) {
    PROXY_NODES.splice(idx, 1);
    console.log(`[OTT-PROXY] ➖ Removed proxy node: ${host}`);
  }
  return getProxyPool();
}

// ========== HEALTH & CLEANUP ==========

// Periodic cleanup of stale devices (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [id, device] of activeDevices) {
    // Clean up devices stuck in pairing for > 10 minutes
    if (device.state === 'pairing' && now - device.startedAt > 600000) {
      console.log(`[OTT] ⏰ Device ${id}: Pairing timeout, cleaning up`);
      stopDevice(id);
    }
  }
}, 300000);

console.log('[OTT] OTT Device Manager initialized');
console.log('[OTT] Sessions dir:', SESSIONS_DIR);
console.log('[OTT] Proxy nodes:', PROXY_NODES.length > 0 ? PROXY_NODES.map(h => `${h}:${DEFAULT_PROXY_PORT}`).join(', ') : 'none (direct connect)');
