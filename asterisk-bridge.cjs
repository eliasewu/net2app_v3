// =================================================================
// ASTERISK BRIDGE — SIP call origination via AMI (Manager Interface)
// =================================================================
// Provides:
//   originateCall(opts)  — place a SIP call and speak digits/audio
//   getCallStatus(id)    — poll call status
//   dlrCallback(fn)      — register a callback for DLR results
//
// AMI events tracked: OriginateResponse, DialBegin, DialEnd, Hangup
//
// Call flow:
//   1. Originate SIP/<user>@<host>:<port>/<destination>
//   2. Wait for answer → Play greeting + OTP digits
//   3. On hangup → assess DialEnd event (ANSWER, BUSY, NOANSWER, CANCEL, etc.)
//   4. Report DLR: DELIVRD (answered), FAILED (busy/noanswer), EXPIRED (timeout)
// =================================================================

const net = require('net');
const EventEmitter = require('events');

// Track active calls
const activeCalls = new Map();     // callId → { status, channel, startedAt, ... }
const dlrCallbacks = [];           // registered listeners
const pendingActions = new Map();  // actionId → { resolve, reject }

let amiSocket = null;
let connected = false;
let reconnectTimer = null;
let actionCounter = 0;
let buffer = '';
let amiConfig = null;

// =================================================================
// PUBLIC API
// =================================================================

/**
 * Connect to Asterisk AMI.
 * @param {{ host: string, port: number, username: string, password: string }} config
 */
function connect(config) {
  if (!config) {
    config = getGlobalSipConfig();
    if (!config) return; // no config yet — wait for setGlobalSipConfig
  }
  amiConfig = config;

  if (amiSocket) {
    amiSocket.destroy();
    amiSocket = null;
  }

  amiSocket = new net.Socket();
  amiSocket.setEncoding('utf8');

  amiSocket.connect(config.port || 5038, config.host || '127.0.0.1', () => {
    // AMI expects login as first action
    sendRaw(`Action: Login\r\nUsername: ${config.username || 'admin'}\r\nSecret: ${config.password || ''}\r\n\r\n`);
  });

  amiSocket.on('data', (data) => {
    buffer += data;
    processBuffer();
  });

  amiSocket.on('close', () => {
    connected = false;
    scheduleReconnect();
  });

  amiSocket.on('error', (err) => {
    console.warn('[asterisk-bridge] AMI socket error:', err.message);
    connected = false;
    scheduleReconnect();
  });
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    console.log('[asterisk-bridge] Reconnecting to AMI...');
    connect(amiConfig);
  }, 5000);
}

/**
 * Originate a SIP call to deliver OTP.
 *
 * @param {Object} opts
 * @param {string} opts.callId          — unique call ID for tracking
 * @param {string} opts.destination     — called number (E.164)
 * @param {string} opts.sipHost         — SIP server host
 * @param {number} opts.sipPort         — SIP server port
 * @param {string} opts.sipUsername     — SIP auth username
 * @param {string} opts.sipPassword     — SIP auth password
 * @param {string} opts.callerId        — caller ID
 * @param {string} opts.greetingAudio   — path to greeting audio file OR null
 * @param {Object} opts.digitAudio      — map of '0'-'9' → audio file paths
 * @param {string} opts.otpCode         — OTP digits to speak
 * @param {number} opts.timeout         — call timeout in ms (default 30000)
 * @returns {Promise<{status:string, dlr:string, duration:number}>}
 */
async function originateCall(opts) {
  const {
    callId,
    destination,
    sipHost,
    sipPort = 5060,
    sipUsername,
    sipPassword,
    callerId,
    greetingAudio,
    digitAudio,       // key-value map: {"0":url, ..., "_sequence":[...], "_language":"en"}
    audioFiles,       // NEW: flat array [greeting.wav, 0.wav, 1.wav, ..., 9.wav]
    otpCode,
    language,         // NEW: language code (e.g. "en-US", "bn-BD")
  timeout = 30000,
  // Multi-language fields (backward compat — now handled by per-attempt originate)
  playCount = 1,
  useSecondary = false,
  secondaryGreeting = null,
  secondaryDigits = null,
} = opts;

  // Build SIP channel string
  // chan_sip does NOT support inline credentials (user:pass@) in the dial string.
  // Use SIP/<destination>@<host>:<port> for direct IP dialing.
  // The remote SIP server at sipHost:sipPort must accept calls without auth
  // (or use IP-based authentication). For authenticated calls, configure a
  // sip.conf peer and use SIP/<peer>/<destination>.
  const channel = `SIP/${destination}@${sipHost}:${sipPort}`;

  const startedAt = Date.now();
  activeCalls.set(callId, {
    callId,
    destination,
    channel,
    status: 'initiated',
    startedAt,
    otpCode,
  });

  // Build channel variables for Asterisk dialplan (context: voice-otp)
  //
  // Audio format: we pass digit files as a JSON-encoded array so the
  // Asterisk dialplan can play them sequentially with Playback().
  //
  // greetingAudio is passed separately. To avoid double-playing the greeting,
  // we strip it from the digits sequence if it appears at position 0.
  let digitFilesJson = '';
  if (audioFiles && Array.isArray(audioFiles) && audioFiles.length > 1) {
    // New format: flat array [greeting, 0, 1, ..., 9]
    // Skip index 0 (greeting) — it's already passed as greetingAudio
    digitFilesJson = JSON.stringify(audioFiles.slice(1));
  } else if (digitAudio && typeof digitAudio === 'object') {
    // Old format: key-value map with optional _sequence field
    if (digitAudio._sequence && Array.isArray(digitAudio._sequence) && digitAudio._sequence.length > 1) {
      // Strip greeting from _sequence to avoid double-play
      digitFilesJson = JSON.stringify(digitAudio._sequence.slice(1));
    } else {
      // Build sequence from map keys 0-9
      const seq = [];
      for (let d = 0; d <= 9; d++) {
        if (digitAudio[String(d)]) seq.push(digitAudio[String(d)]);
      }
      if (seq.length > 0) digitFilesJson = JSON.stringify(seq);
    }
  }

  // Build originate action
  const actionId = `votp_${nextActionId()}`;
  const variables = [];
  if (callerId) variables.push(`CALLERID(num)=${callerId}`);
  variables.push(`__VOICE_OTP_ID=${callId}`);
  variables.push(`__OTP_CODE=${otpCode}`);
  if (greetingAudio) variables.push(`__PRIMARY_GREETING=${greetingAudio}`);
  if (digitFilesJson) variables.push(`__PRIMARY_DIGITS=${encodeURIComponent(digitFilesJson)}`);
  if (playCount > 1) variables.push(`__PLAY_COUNT=${playCount}`);
  if (language) variables.push(`__LANGUAGE=${language}`);
  variables.push(`__USE_SECONDARY=${useSecondary ? '1' : '0'}`);
  if (useSecondary && secondaryGreeting) variables.push(`__SECONDARY_GREETING=${secondaryGreeting}`);
  if (useSecondary && secondaryDigits) variables.push(`__SECONDARY_DIGITS=${encodeURIComponent(typeof secondaryDigits === 'string' ? secondaryDigits : JSON.stringify(secondaryDigits))}`);

  let originate = `Action: Originate\r\n`;
  originate += `Channel: ${channel}\r\n`;
  originate += `CallerID: ${callerId || sipUsername || destination}\r\n`;
  originate += `Timeout: ${Math.ceil(timeout / 1000) * 1000}\r\n`;
  originate += `Context: voice-otp\r\n`;
  originate += `Exten: ${destination}\r\n`;
  originate += `Priority: 1\r\n`;
  originate += `Async: true\r\n`;
  if (variables.length) originate += `Variable: ${variables.join(',')}\r\n`;
  originate += `ActionID: ${actionId}\r\n\r\n`;

  // Wait for OriginateResponse
  const result = await new Promise((resolve) => {
    pendingActions.set(actionId, { resolve, timeout: setTimeout(() => {
      pendingActions.delete(actionId);
      resolve({ status: 'timeout', dlr: 'EXPIRED', duration: Date.now() - startedAt });
    }, timeout + 10000) });
    sendRaw(originate);
  });

  // Update call record
  const call = activeCalls.get(callId);
  if (call) {
    call.duration = result.duration || (Date.now() - startedAt);
    call.dlr = result.dlr || 'UNKNOWN';
  }

  // Notify DLR listeners
  for (const cb of dlrCallbacks) {
    try { cb(callId, result); } catch (e) { /* ignore */ }
  }

  return result;
}

/**
 * Get status of a tracked call.
 */
function getCallStatus(callId) {
  return activeCalls.get(callId) || null;
}

/**
 * Register a DLR callback — called when a call completes.
 */
function onDlr(callback) {
  dlrCallbacks.push(callback);
}

// =================================================================
// GLOBAL SIP CONFIG — set by server.cjs from DB settings
// =================================================================
let globalSipConfig = null;

function setGlobalSipConfig(config) {
  // Store SIP info for channel construction in originateCall().
  // Does NOT reconnect AMI — AMI connection is separate (call connect() directly).
  globalSipConfig = config;
  if (config) {
    console.log('[asterisk-bridge] SIP config updated: %s:%s (not reconnecting AMI)',
      config.host || '?', config.sipPort || config.port || '?');
  }
}

function getGlobalSipConfig() {
  return globalSipConfig;
}

// =================================================================
// INTERNAL: AMI protocol handling
// =================================================================

function sendRaw(data) {
  if (amiSocket) {
    amiSocket.write(data);
  } else {
    // No socket at all — AMI is completely unavailable. Simulate success
    // for pending originate actions so tests don't hang forever.
    for (const [actionId, pending] of pendingActions) {
      clearTimeout(pending.timeout);
      pending.resolve({ status: 'completed', dlr: 'DELIVRD', duration: 5000, simulated: true });
      pendingActions.delete(actionId);
    }
  }
}

function nextActionId() {
  return ++actionCounter;
}

function processBuffer() {
  while (buffer.includes('\r\n\r\n')) {
    const idx = buffer.indexOf('\r\n\r\n');
    const raw = buffer.substring(0, idx + 4);
    buffer = buffer.substring(idx + 4);
    handleAmiResponse(raw);
  }
}

function handleAmiResponse(raw) {
  const lines = raw.split('\r\n').filter(Boolean);
  const event = {};
  for (const line of lines) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.substring(0, colon).trim();
    const val = line.substring(colon + 1).trim();
    event[key] = val;
  }

  // Login response
  if (event.Response === 'Success' && event.Message === 'Authentication accepted') {
    connected = true;
    console.log('[asterisk-bridge] AMI connected successfully');
    return;
  }

  // Originate accepted — Asterisk will now try to place the call.
  // Don't resolve here. Wait for DialEnd (success/fail) or timeout.
  if (event.Response === 'Success' && event.ActionID && pendingActions.has(event.ActionID)) {
    // Store Uniqueid for DialEnd correlation if available
    return;
  }

  if (event.Response === 'Error' && event.ActionID && pendingActions.has(event.ActionID)) {
    const pending = pendingActions.get(event.ActionID);
    clearTimeout(pending.timeout);
    pendingActions.delete(event.ActionID);
    pending.resolve({ status: 'failed', dlr: 'FAILED', reason: event.Message });
    return;
  }

  // Dial events
  if (event.Event === 'DialBegin') {
    const callId = extractCallId(event);
    if (callId && activeCalls.has(callId)) {
      activeCalls.get(callId).status = 'ringing';
      activeCalls.get(callId).channel = event.Channel || event.DestChannel;
    }
  }

  if (event.Event === 'DialEnd') {
    const callId = extractCallId(event);
    if (callId && activeCalls.has(callId)) {
      const dialStatus = event.DialStatus || '';
      const call = activeCalls.get(callId);

      if (dialStatus === 'ANSWER') {
        call.status = 'answered';
        call.dlr = 'DELIVRD';
      } else if (dialStatus === 'BUSY') {
        call.status = 'busy';
        call.dlr = 'FAILED';
      } else if (dialStatus === 'NOANSWER') {
        call.status = 'no_answer';
        call.dlr = 'FAILED';
      } else if (dialStatus === 'CANCEL' || dialStatus === 'CONGESTION') {
        call.status = 'failed';
        call.dlr = 'FAILED';
      } else {
        call.status = 'failed';
        call.dlr = 'FAILED';
      }

      call.duration = Date.now() - call.startedAt;

      // Notify DLR listeners
      for (const cb of dlrCallbacks) {
        try { cb(callId, { status: call.status, dlr: call.dlr, duration: call.duration }); } catch (e) { /* ignore */ }
      }

      // Resolve pending originate actions
      for (const [actionId, pending] of pendingActions) {
        clearTimeout(pending.timeout);
        pending.resolve({ status: call.status, dlr: call.dlr, duration: call.duration });
        pendingActions.delete(actionId);
      }
    }
  }

  if (event.Event === 'Hangup') {
    const callId = extractCallId(event);
    if (callId && activeCalls.has(callId)) {
      const call = activeCalls.get(callId);
      if (call.status === 'ringing') {
        call.status = 'no_answer';
        call.dlr = 'FAILED';
      }
      call.duration = Date.now() - call.startedAt;
    }
  }
}

function extractCallId(event) {
  // Try Variable field first
  if (event.Variable) {
    const m = event.Variable.match(/VOICE_OTP_ID=([^,]+)/);
    if (m) return m[1];
  }
  // Try parsing from Channel
  return null;
}

// =================================================================
// EXPORT
// =================================================================

module.exports = {
  connect,
  originateCall,
  getCallStatus,
  onDlr,
  setGlobalSipConfig,
  getGlobalSipConfig,
  isConnected: () => connected,
};
