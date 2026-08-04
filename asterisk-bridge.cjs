// =================================================================
// ASTERISK BRIDGE — SIP call origination via AMI + direct UDP SIP
// =================================================================
// Provides:
//   originateCall(opts)  — place a SIP call and speak OTP digits
//   getCallStatus(id)    — poll call status
//   onDlr(fn)            — register a callback for DLR results
//   sendCommand(cmd)     — AMI CLI command
//
// Two backends:
//   1. Asterisk AMI (Manager Interface) — for chan_sip origination
//   2. Direct UDP SIP — when sipHost is set, bypasses Asterisk entirely
//      (includes RTP audio streaming via G.711 μ-law)
// =================================================================

const net = require('net');
const dgram = require('dgram');
const os = require('os');
const fs = require('fs');
const EventEmitter = require('events');

// ── Network ──
function getLocalIp() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces).sort()) {
    if (name.startsWith('vxlan') || name.startsWith('cali') || name === 'lo') continue;
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

// ── G.711 A-law: 16-bit PCM → 8-bit A-law (European telephony codec) ──
// Standard algorithm: extract sign bit, work with absolute value,
// find exponent (MSB position), extract mantissa, invert even bits.
function pcm16ToAlaw(pcm) {
  const CLIP = 32635;
  const sign = (pcm & 0x8000) ? 0x80 : 0x00;  // extract 16-bit sign bit
  if (sign) pcm = -pcm;                         // absolute value (safe now)
  if (pcm > CLIP) pcm = CLIP;
  let exp = 0;
  for (let v = pcm >> 8; v > 0; v >>= 1) exp++;
  const mant = (pcm >> Math.max(exp, 4)) & 0x0F;
  const alaw = sign | ((exp < 4 ? 0 : exp - 4) << 4) | mant;
  return alaw ^ 0x55;
}

// ── G.711 μ-law encoder: 16-bit PCM → 8-bit μ-law ──
// Same fix: use 16-bit sign bit extraction, always work with absolute value.
function pcm16ToUlaw(pcm) {
  const BIAS = 0x84, CLIP = 32635;
  const sign = (pcm & 0x8000) ? 0x80 : 0x00;  // extract 16-bit sign bit
  if (sign) pcm = -pcm;                         // absolute value
  if (pcm > CLIP) pcm = CLIP;
  pcm += BIAS;
  let exp = 0;
  for (let v = pcm >> 8; v > 0; v >>= 1) exp++;
  const mant = (pcm >> (exp + 3)) & 0x0F;
  return ~(sign | (exp << 4) | mant) & 0xFF;
}

// ── DSP: Clean audio — noise gate + normalization for voice quality ──
// Applies in-place to the PCM buffer:
//   1. Noise gate: mute samples below threshold to remove background hiss
//   2. RMS normalization: scale signal to consistent level without clipping
//   3. Soft knee at gate threshold to avoid audible clicks
function cleanAudio(pcmBuf, callId) {
  if (!pcmBuf || pcmBuf.length < 2) return pcmBuf;
  const samples = Math.floor(pcmBuf.length / 2);
  const GATE_THRESHOLD = 100;   // mute abs < 100 (~ -50dBFS — only true background hiss)
  const TARGET_RMS = 7000;      // target RMS (~ -13dBFS — good telephone level)
  const MAX_PEAK = 30000;       // hard clip ceiling to prevent G.711 distortion
  const KNEE_WIDTH = 80;        // soft knee transition zone

  // Pass 1: compute RMS of signal samples (above gate threshold)
  let sigSum = 0, sigCount = 0;
  for (let i = 0; i < pcmBuf.length; i += 2) {
    const v = Math.abs(pcmBuf.readInt16LE(i));
    if (v > GATE_THRESHOLD + KNEE_WIDTH) { sigSum += v * v; sigCount++; }
  }
  const sigRms = sigCount > 0 ? Math.sqrt(sigSum / sigCount) : TARGET_RMS;
  const gain = sigRms > 0 ? TARGET_RMS / sigRms : 1.0;

  // Pass 2: noise gate + normalize
  let gated = 0, normalized = 0;
  for (let i = 0; i < pcmBuf.length; i += 2) {
    let v = pcmBuf.readInt16LE(i);
    const absV = Math.abs(v);

    // Noise gate with soft knee
    if (absV <= GATE_THRESHOLD) {
      v = 0;  // mute
      gated++;
    } else if (absV < GATE_THRESHOLD + KNEE_WIDTH) {
      // Soft knee: gradual transition from muted to passed
      const ratio = (absV - GATE_THRESHOLD) / KNEE_WIDTH;
      v = Math.round(v * ratio * gain);
    } else {
      // Full signal: normalize
      v = Math.round(v * gain);
    }

    // Hard clip to prevent G.711 distortion
    if (v > MAX_PEAK) v = MAX_PEAK;
    else if (v < -MAX_PEAK) v = -MAX_PEAK;
    if (v !== 0 && Math.abs(v) > GATE_THRESHOLD) normalized++;

    pcmBuf.writeInt16LE(v, i);
  }

  const noiseReduction = samples > 0 ? (100 * gated / samples).toFixed(1) : '0';
  console.log('[asterisk-bridge] DSP clean: gate=%s%%, gain=%sx, targetRMS=%d (Call-ID: %s)',
    noiseReduction, gain.toFixed(2), TARGET_RMS, callId);
  return pcmBuf;
}

// ── Read audio file (disk path or base64 data: URL) → raw 16-bit PCM ──
// IMPORTANT: WAV files can have extra chunks (LIST, id3, etc.) between fmt and data.
// We search for the "data" marker instead of assuming it's at offset 36.
function readAudioFile(filePath) {
  try {
    let buf;
    if (filePath.startsWith('data:')) {
      const b64 = filePath.split(',')[1];
      if (!b64) return null;
      buf = Buffer.from(b64, 'base64');
    } else {
      // Resolve disk paths: DB stores URL-style paths like /uploads/audio/...
      // which actually live under ./data/uploads/... on disk.
      let resolved = filePath;
      if (!fs.existsSync(resolved)) {
        const stripped = filePath.replace(/^\/+/, ''); // drop leading /
        if (!stripped.startsWith('data/')) resolved = 'data/' + stripped;
        else resolved = stripped;
      }
      if (!fs.existsSync(resolved)) return null;
      buf = fs.readFileSync(resolved);
    }
    if (!buf || buf.length < 44) return null;
    if (buf.toString('ascii', 0, 4) !== 'RIFF') return null;
    // Find "data" chunk — it may not be at offset 36 if WAV has LIST/id3 metadata
    let dataOffset = -1;
    for (let i = 12; i < buf.length - 8; i++) {
      if (buf.toString('ascii', i, i + 4) === 'data') {
        dataOffset = i;
        break;
      }
    }
    if (dataOffset < 0) return null;
    const dataSize = buf.readUInt32LE(dataOffset + 4);
    const start = dataOffset + 8;
    const end = Math.min(start + dataSize, buf.length);
    return buf.subarray(start, end);
  } catch (e) { return null; }
}

// ── Stream PCM audio as RTP packets with burst-compensated drift correction ──
//
// Timing strategy:
//   1. Track absolute wall-clock deadline (nextAt).
//   2. If event-loop jitter puts us behind by ≥1 packet interval, burst-send
//      all missed packets in this tick and reset the deadline to now+20ms.
//      This prevents permanent drift — jitter is absorbed, not accumulated.
//   3. If on time, send 1 packet and advance deadline by 20ms.
//   4. Schedule next tick with delay = max(0, nextAt - now).
//      Zero-delay timeout fires as soon as the event loop is free,
//      minimising gaps between packets.
//
function streamRtpAudio(rtpSock, rtpIp, rtpPort, rtpPT, pcmData, callId, done) {
  if (!pcmData || pcmData.length === 0) { done(); return; }
  const SAMPLES = 160, INTERVAL_MS = 20;
  const SSRC = Math.floor(Math.random() * 0xFFFFFFFF);
  let seq = 0, ts = 0, offset = 0, sent = 0;
  let nextAt = Date.now();
  const total = Math.ceil(pcmData.length / (SAMPLES * 2));
  const encoder = rtpPT === 8 ? pcm16ToAlaw : pcm16ToUlaw;

  console.log('[asterisk-bridge] RTP streaming %d packets to %s:%s PT=%d (Call-ID: %s)', total, rtpIp, rtpPort, rtpPT, callId);

  // Build and send a single RTP packet
  function sendPacket() {
    const n = Math.min(SAMPLES, Math.floor((pcmData.length - offset) / 2));
    const pkt = Buffer.alloc(12 + n);
    pkt.writeUInt8(0x80, 0);                       // V=2
    pkt.writeUInt8((seq === 0 ? 0x80 : 0) | (rtpPT & 0x7F), 1); // M-bit on first, PT
    pkt.writeUInt16BE(seq, 2);
    pkt.writeUInt32BE(ts, 4);
    pkt.writeUInt32BE(SSRC, 8);
    for (let i = 0; i < n; i++) {
      pkt[12 + i] = encoder(pcmData.readInt16LE(offset + i * 2));
    }
    rtpSock.send(pkt, 0, pkt.length, rtpPort, rtpIp, () => {});
    seq = (seq + 1) & 0xFFFF;
    ts += n;
    offset += n * 2;
  }

  function tick() {
    const now = Date.now();

    if (offset >= pcmData.length) {
      console.log('[asterisk-bridge] RTP done: %d packets (Call-ID: %s)', sent, callId);
      setTimeout(done, 300);
      return;
    }

    // Burst compensation: if we're behind by ≥1 interval, catch up
    const behind = now - nextAt;
    if (behind >= INTERVAL_MS) {
      const missed = Math.min(
        Math.floor(behind / INTERVAL_MS),
        Math.ceil((pcmData.length - offset) / (SAMPLES * 2))
      );
      for (let i = 0; i < missed && offset < pcmData.length; i++) {
        sendPacket();
        sent++;
      }
      // Reset deadline — drift is absorbed, not accumulated
      nextAt = Date.now() + INTERVAL_MS;
    } else {
      // On schedule — send one packet
      sendPacket();
      sent++;
      nextAt += INTERVAL_MS;
    }

    // Drift-compensated delay (0 = run as soon as event loop is free)
    const delay = Math.max(0, nextAt - Date.now());
    setTimeout(tick, delay);
  }

  tick();
}

// ── Track calls ──
const activeCalls = new Map();
const dlrCallbacks = [];
const pendingActions = new Map();

// ── Generate a random E.164 caller ID with FOREIGN country prefix ──
// Carriers (Bangladesh, India, etc.) REJECT same-country ANI.
// Instead, pick a random prefix from a DIFFERENT country than the destination.
// Uses a curated list of common country prefixes that most carriers accept as foreign.
const COUNTRY_PREFIXES = ['1','7','20','27','30','31','32','33','34','36','39','40','41','43','44','45','46','47','48','49','51','52','54','55','56','57','58','60','61','62','63','64','65','66','81','82','84','86','90','91','92','93','94','95','98','211','212','213','216','218','220','221','222','223','224','225','226','227','228','229','230','231','232','233','234','235','236','237','238','239','240','241','242','243','244','245','246','247','248','249','250','251','252','253','254','255','256','257','258','260','261','262','263','264','265','266','267','268','269','290','291','297','298','299','350','351','352','353','354','355','356','357','358','359','370','371','372','373','374','375','376','377','378','380','381','382','383','385','386','387','389','420','421','423','500','501','502','503','504','505','506','507','508','509','590','591','592','593','594','595','596','597','598','599','670','672','673','674','675','676','677','678','679','680','681','682','683','685','686','687','688','689','690','691','850','852','853','855','856','880','886','960','961','962','963','964','965','966','967','968','970','971','972','973','974','975','976','977','992','993','994','995','996','998'];
const SORTED_COUNTRY_PREFIXES = [...COUNTRY_PREFIXES].sort((a, b) => b.length - a.length);

function generateRandomAni(destination) {
  const cleaned = (destination || '').replace(/\D/g, '');
  // Find destination's country prefix
  let destPrefix = '';
  for (const p of SORTED_COUNTRY_PREFIXES) {
    if (cleaned.startsWith(p)) { destPrefix = p; break; }
  }
  // Pick a DIFFERENT foreign country prefix (carriers reject same-country ANI)
  const foreignPrefixes = COUNTRY_PREFIXES.filter(p => p !== destPrefix);
  if (foreignPrefixes.length === 0) {
    return '+' + Array.from({ length: 10 }, () => Math.floor(Math.random() * 10)).join('');
  }
  const prefix = foreignPrefixes[Math.floor(Math.random() * foreignPrefixes.length)];
  const remaining = Math.max(5, 12 - prefix.length);
  const suffix = Array.from({ length: remaining }, () => Math.floor(Math.random() * 10)).join('');
  return '+' + prefix + suffix;
}

let amiSocket = null;
let connected = false;
let reconnectTimer = null;
let actionCounter = 0;
let buffer = '';
let amiConfig = null;

// =================================================================
// PUBLIC: AMI connection
// =================================================================

function connect(config) {
  if (!config) { config = getGlobalSipConfig(); if (!config) return; }
  amiConfig = config;
  if (amiSocket) { amiSocket.destroy(); amiSocket = null; }
  amiSocket = new net.Socket();
  amiSocket.setEncoding('utf8');
  amiSocket.connect(config.port || 5038, config.host || '127.0.0.1', () => {
    sendRaw(`Action: Login\r\nUsername: ${config.username || 'admin'}\r\nSecret: ${config.password || ''}\r\n\r\n`);
  });
  amiSocket.on('data', (d) => { buffer += d; processBuffer(); });
  amiSocket.on('close', () => { connected = false; scheduleReconnect(); });
  amiSocket.on('error', (e) => { connected = false; scheduleReconnect(); });
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(amiConfig); }, 5000);
}

// =================================================================
// PUBLIC: originateCall — AMI path OR direct UDP SIP path
// =================================================================

async function originateCall(opts) {
  const {
    callId, destination, sipHost, sipPort = 5060,
    sipUsername, sipPassword, callerId,
    greetingAudio, digitAudio, audioFiles,
    otpCode, language, timeout = 30000,
    playCount, useSecondary, secondaryGreeting, secondaryDigits,
  } = opts;
  const startedAt = Date.now();

  // ALWAYS use direct UDP SIP when sipHost is set.
  // Direct UDP streams actual audio files (greeting + digits) via RTP.
  // AMI+PJSIP only passes OTP_CODE to Asterisk's SayDigits TTS,
  // which requires .gsm sound files that may not match the uploaded audio.
  if (sipHost) {
    console.log('[asterisk-bridge] Using direct UDP SIP for %s → %s:%s', callId, sipHost, sipPort);
    return directSipOriginate(opts, startedAt);
  }

  // ── AMI path ──
  const channel = `SIP/${destination}@${sipHost}:${sipPort}`;
  activeCalls.set(callId, { callId, destination, channel, status: 'initiated', startedAt, otpCode });

  let digitFilesJson = '';
  if (audioFiles && Array.isArray(audioFiles) && audioFiles.length > 1)
    digitFilesJson = JSON.stringify(audioFiles.slice(1));
  else if (digitAudio && Array.isArray(digitAudio._sequence) && digitAudio._sequence.length > 1)
    digitFilesJson = JSON.stringify(digitAudio._sequence.slice(1));

  const actionId = `votp_${nextActionId()}`;
  const vars = [];
  if (callerId) vars.push(`CALLERID(num)=${callerId}`);
  vars.push(`__VOICE_OTP_ID=${callId}`, `__OTP_CODE=${otpCode}`);
  if (greetingAudio) vars.push(`__PRIMARY_GREETING=${greetingAudio}`);
  if (digitFilesJson) vars.push(`__PRIMARY_DIGITS=${encodeURIComponent(digitFilesJson)}`);
  if (playCount > 1) vars.push(`__PLAY_COUNT=${playCount}`);
  if (language) vars.push(`__LANGUAGE=${language}`);

  let orig = `Action: Originate\r\nChannel: ${channel}\r\n`;
  orig += `CallerID: ${callerId || (destination || '').replace(/^\+/, '')}\r\n`;
  orig += `Timeout: ${Math.ceil(timeout / 1000) * 1000}\r\n`;
  orig += `Context: voice-otp\r\nExten: ${destination}\r\nPriority: 1\r\nAsync: true\r\n`;
  if (vars.length) orig += `Variable: ${vars.join(',')}\r\n`;
  orig += `ActionID: ${actionId}\r\n\r\n`;

  const result = await new Promise((resolve) => {
    pendingActions.set(actionId, {
      callId, resolve,
      timeout: setTimeout(() => { pendingActions.delete(actionId);
        resolve({ status: 'timeout', dlr: 'EXPIRED', duration: Date.now() - startedAt }); }, timeout + 5000),
    });
    sendRaw(orig);
  });

  const call = activeCalls.get(callId);
  if (call) { call.duration = result.duration || (Date.now() - startedAt); call.dlr = result.dlr || 'UNKNOWN'; }
  for (const cb of dlrCallbacks) { try { cb(callId, result); } catch (e) {} }
  return result;
}

// =================================================================
// AMI PJSIP ORIGINATE — uses Asterisk PJSIP channel driver
// Asterisk handles:
//   - G.729 codec negotiation + G.711→G.729 transcoding
//   - SIP dialog (INVITE/ACK/BYE)
//   - RTP streaming (SayDigits for OTP playback)
// =================================================================

async function amiPjsipOriginate(opts, startedAt) {
  const {
    callId, destination, sipHost, sipPort = 5060, callerId,
    otpCode, timeout = 30000, playCount, language,
  } = opts;

  // PJSIP channel format — uses pre-configured outbound-ep endpoint.
  // PJSIP has codec_g729.so loaded and G.729 allowed in pjsip.conf.
  const channel = `PJSIP/outbound-ep/sip:${destination}@${sipHost}:${sipPort}`;

  activeCalls.set(callId, {
    callId, destination, channel,
    status: 'initiated', startedAt, otpCode,
  });

  const actionId = `votp_${nextActionId()}`;
  const vars = [];
  if (callerId) vars.push(`CALLERID(num)=${callerId}`);
  vars.push(`__VOICE_OTP_ID=${callId}`, `__OTP_CODE=${otpCode}`);
  if (playCount > 1) vars.push(`__PLAY_COUNT=${playCount}`);
  if (language) vars.push(`__LANGUAGE=${language}`);

  let orig = `Action: Originate\r\n`;
  orig += `Channel: ${channel}\r\n`;
  orig += `CallerID: ${callerId || (destination || '').replace(/^\+/, '')}\r\n`;
  orig += `Timeout: ${Math.ceil(timeout / 1000) * 1000}\r\n`;
  if (opts.tempWavPath) {
    // Playback uploaded audio via Asterisk (G.729 fallback path)
    orig += `Application: Playback\r\n`;
    orig += `Data: ${opts.tempWavPath.replace(/\.wav$/i, '')}\r\n`;
  } else {
    // Default: SayDigits TTS via voice-otp dialplan context
    orig += `Context: voice-otp\r\n`;
    orig += `Exten: ${destination}\r\n`;
    orig += `Priority: 1\r\n`;
  }
  orig += `Async: true\r\n`;
  if (vars.length) orig += `Variable: ${vars.join(',')}\r\n`;
  orig += `ActionID: ${actionId}\r\n\r\n`;

  const result = await new Promise((resolve) => {
    pendingActions.set(actionId, {
      callId,
      resolve,
      timeout: setTimeout(() => {
        pendingActions.delete(actionId);
        resolve({ status: 'timeout', dlr: 'EXPIRED', duration: Date.now() - startedAt });
      }, timeout + 5000),
    });
    sendRaw(orig);
  });

  const call = activeCalls.get(callId);
  if (call) {
    call.duration = result.duration || (Date.now() - startedAt);
    call.dlr = result.dlr || 'UNKNOWN';
  }
  for (const cb of dlrCallbacks) {
    try { cb(callId, result); } catch (e) { /* ignore */ }
  }
  return result;
}

// =================================================================
// DIRECT SIP ORIGINATE — full RTP audio streaming
// =================================================================

function directSipOriginate(opts, startedAt) {
  const { callId, destination, sipHost, sipPort = 5060, callerId, timeout = 30000, audioFiles, greetingAudio, digitAudio, playCount = 1 } = opts;
  const localIp = getLocalIp();
  const deviceName = 'NET2APP';
  const cleanedDest = (destination || '').replace(/^\+/, '');
  // Caller must be E.164 with a FOREIGN country code — carriers reject same-country ANI
  // Use explicit callerId if set, otherwise generate a random foreign-country ANI
  let caller = callerId || generateRandomAni(destination || '');
  if (caller && /^\d+$/.test(caller)) caller = '+' + caller;

  // Build complete audio file list — merge audioFiles (flat array) with digitAudio (JSONB map)
  let allFiles = [];
  if (audioFiles && Array.isArray(audioFiles)) {
    allFiles = audioFiles;
  } else if (digitAudio) {
    // Fallback: digitAudio is raw JSONB from DB — extract file paths
    let digitMap = digitAudio;
    if (typeof digitMap === 'string') {
      try { digitMap = JSON.parse(digitMap); } catch { digitMap = null; }
    }
    if (digitMap && typeof digitMap === 'object') {
      if (digitMap._sequence && Array.isArray(digitMap._sequence)) {
        // _sequence is full array [greeting, digit0, digit1, ...] — greeting already included
        allFiles = allFiles.concat(digitMap._sequence);
      } else {
        if (greetingAudio) allFiles.push(greetingAudio);
        for (let d = 0; d <= 9; d++) {
          if (digitMap[String(d)]) allFiles.push(digitMap[String(d)]);
        }
      }
    }
  }
  if (allFiles.length === 0 && greetingAudio) allFiles.push(greetingAudio);

  // Pre-load all audio PCM (handles base64 data URLs + disk files)
  let allPcm = Buffer.alloc(0);
  let loadedCount = 0;
  const missing = [];
  for (const fp of allFiles) {
    const pcm = readAudioFile(fp);
    if (pcm) {
      allPcm = Buffer.concat([allPcm, pcm]);
      loadedCount++;
    } else {
      missing.push(String(fp).slice(0, 60));
    }
  }
  console.log('[asterisk-bridge] Audio: %d/%d files → %d bytes PCM x%d playCount (Call-ID: %s)',
    loadedCount, allFiles.length, allPcm.length, playCount, callId);
  if (missing.length > 0) {
    console.warn('[asterisk-bridge] ⚠ %d audio file(s) failed to load (Call-ID: %s): %s', missing.length, callId, missing.join(', '));
  }
  if (allPcm.length === 0) {
    console.warn('[asterisk-bridge] WARNING: 0 bytes PCM — call will have NO AUDIO (Call-ID: %s). Check voice_otp_config audio uploads.', callId);
  }

  // DSP: noise gate + normalization for voice quality
  if (allPcm.length > 0) cleanAudio(allPcm, callId);

  // Repeat the whole sequence playCount times (local_2x / play_count configs)
  if (playCount > 1 && allPcm.length > 0) {
    const repeated = Buffer.alloc(allPcm.length * playCount);
    for (let i = 0; i < playCount; i++) {
      allPcm.copy(repeated, i * allPcm.length);
    }
    allPcm = repeated;
    console.log('[asterisk-bridge] Repeated PCM x%d → %d bytes (Call-ID: %s)', playCount, allPcm.length, callId);
  }

  let connectedStart = 0; // captured when 200 OK arrives (actual audio starts)

  activeCalls.set(callId, { callId, destination, channel: `SIP/${sipHost}:${sipPort}`, status: 'initiated', startedAt });

  // Create RTP socket for audio streaming
  const rtpSock = dgram.createSocket('udp4');

  return new Promise((resolve) => {
      // Step 1: Bind RTP socket FIRST → get real port for SDP.
      // Bind inside 10000-20000 range (iptables allows these).
      // Port 0 = random ephemeral would go outside the range → BLOCKED.
      rtpSock.bind(0, localIp, () => {
      const myRtpPort = rtpSock.address().port;
      console.log('[asterisk-bridge] RTP socket: %s:%s', localIp, myRtpPort);

      // Step 2: Bind SIP socket → send INVITE with correct RTP port in SDP
      const sock = dgram.createSocket('udp4');
      let resolved = false;

      sock.bind(0, localIp, () => {
        sock.removeListener('error', onSipBindErr);
        const sipPortLocal = sock.address().port;
        const branch = 'z9hG4bK' + Math.random().toString(36).slice(2, 12);
        const fromTag = Math.random().toString(36).slice(2, 10);

        // PCMU/PCMA only — proven to work via MicroSIP through same carriers.
        // Keep telephone-event for DTMF RFC2833 (carrier compatibility).
        // No G.729 in SDP — eliminates codec module/transcode/annex issues.
        const sdp = [
          'v=0',
          `o=- ${Date.now()} ${Date.now()} IN IP4 ${localIp}`,
          's=Voice OTP',
          `c=IN IP4 ${localIp}`,
          't=0 0',
          `m=audio ${myRtpPort} RTP/AVP 0 8 101`,
          'a=rtpmap:0 PCMU/8000',
          'a=rtpmap:8 PCMA/8000',
          'a=rtpmap:101 telephone-event/8000',
          'a=fmtp:101 0-16',
          'a=ptime:20',
          'a=sendrecv',
        ].join('\r\n');

        const invite = [
          `INVITE sip:${destination}@${sipHost}:${sipPort} SIP/2.0`,
          `Via: SIP/2.0/UDP ${localIp}:${sipPortLocal};rport;branch=${branch}`,
          'Max-Forwards: 70',
          `From: "OTP" <sip:${caller}@${localIp}>;tag=${fromTag}`,
          `To: <sip:${destination}@${sipHost}>`,
          `Call-ID: ${callId}`,
          'CSeq: 1 INVITE',
          `Contact: <sip:${deviceName}@${localIp}:${sipPortLocal}>`,
          'User-Agent: NET2APP',
          'Allow: INVITE, ACK, CANCEL, BYE, OPTIONS',
          'Content-Type: application/sdp',
          `Content-Length: ${Buffer.byteLength(sdp)}`,
          '', sdp,
        ].join('\r\n');

        const timer = setTimeout(() => {
          if (resolved) return;
          resolved = true; sock.close(); rtpSock.close();
          const r = { status: 'failed', dlr: 'FAILED', duration: Date.now() - startedAt, reason: 'SIP timeout' };
          notifyCallComplete(callId, r); resolve(r);
        }, timeout);

        sock.on('message', async (msg) => {
          if (resolved) return;
          const text = msg.toString();
          const statusLine = text.split('\r\n')[0] || '';
          console.log('[asterisk-bridge] SIP:', statusLine);

          if (/^SIP\/2\.0 1\d\d/.test(statusLine)) return; // provisional

          if (/^SIP\/2\.0 2\d\d/.test(statusLine)) {
            if (resolved) return;
            clearTimeout(timer);

            // Connected timestamp: actual call duration starts NOW (audio time only)
            connectedStart = Date.now();
            // Debug: log raw 200 OK (first 600 chars) for Contact/SDP diagnostics
            console.log('[asterisk-bridge] 200 OK RAW (first 600): %s', text.substring(0, 600));

            // Parse RTP destination + codec from 200 OK SDP answer
            // Extract: c=IN IP4 <dstIp>, m=audio <dstPort> RTP/AVP <selectedPT>
            let dstIp = sipHost, dstPort = myRtpPort, rtpPT = 0;
            let needsAsterisk = false; // G.729 requires Asterisk transcoding
            const cM = text.match(/c=IN IP4 ([\d.]+)/); if (cM) dstIp = cM[1];
            const mFull = text.match(/m=audio (\d+)(?: RTP\/AVP (\d+))?/);
            if (mFull) {
              dstPort = parseInt(mFull[1]);
              const selectedPT = mFull[2] ? parseInt(mFull[2]) : null;
              if (selectedPT === 0 || selectedPT === 8) {
                rtpPT = selectedPT;  // PCMU or PCMA — we can encode directly
              } else if (selectedPT !== null) {
                const rtpmapRe = new RegExp('a=rtpmap:' + selectedPT + ' (\\S+)');
                const rtpmapM = text.match(rtpmapRe);
                if (rtpmapM && /^PCMU/i.test(rtpmapM[1])) { rtpPT = 0; }
                else if (rtpmapM && /^PCMA/i.test(rtpmapM[1])) { rtpPT = 8; }
                else if (selectedPT === 18 || (rtpmapM && /^G729/i.test(rtpmapM[1]))) {
                  // G.729 — we cannot encode this. Route through Asterisk AMI
                  // which has codec_g729.so loaded for transcoding.
                  needsAsterisk = true;
                  console.log('[asterisk-bridge] Carrier selected G.729 — will stream PCMU anyway');
                } else {
                  console.log('[asterisk-bridge] Unsupported codec PT=%d (%s) — failing', selectedPT, rtpmapM?.[1] || 'unknown');
                  resolved = true;
                  sock.close(); rtpSock.close();
                  const r = { status: 'failed', dlr: 'FAILED', duration: Date.now() - startedAt, reason: 'Unsupported codec PT=' + selectedPT };
                  notifyCallComplete(callId, r); resolve(r);
                  return;
                }
              }
              console.log('[asterisk-bridge] Carrier PT=%d → %s', selectedPT ?? 0, needsAsterisk ? 'PCMU fallback (G.729 detected)' : 'direct RTP PT=' + rtpPT);
            }
            const tM = text.match(/^To:.*;tag=([^\s;\r]+)/m);
            const toTag = tM ? tM[1] : '';
            // RFC 3261 §12.2.1.1: ACK/BYE Request-URI MUST be Contact from 200 OK
            const contactM = text.match(/^Contact:\s*<([^>]+)>/im);
            const reqUri = contactM ? contactM[1] : `sip:${destination}@${sipHost}:${sipPort}`;
            console.log('[asterisk-bridge] RTP target: %s:%s PT=%d, To tag: %s, Contact: %s', dstIp, dstPort, rtpPT, toTag || '(none)', reqUri);

            // ACK — send only for direct PCMU/PCMA path.
            // For G.729: tear down this dialog with BYE, then re-originate via Asterisk.
            const ackTo = toTag ? `<sip:${destination}@${sipHost}>;tag=${toTag}` : `<sip:${destination}@${sipHost}>`;
            const toHdr = toTag ? `<sip:${destination}@${sipHost}>;tag=${toTag}` : `<sip:${destination}@${sipHost}>`;

            if (needsAsterisk) {
              // G.729 detected — carrier ignored our PCMU/PCMA offer.
              // No Asterisk available, so send ACK and stream PCMU RTP anyway.
              // Many carriers accept PCMU RTP even when G.729 is "selected" in SDP answer.
              // This is better than ACK+BYE which guarantees call drop.
              rtpPT = 0; // force PCMU
              console.log('[asterisk-bridge] Carrier selected G.729 — streaming PCMU anyway (no Asterisk available)');
            }

            // PCMU/PCMA path: send ACK and stream RTP directly
            const ack = [
              `ACK ${reqUri} SIP/2.0`,
              `Via: SIP/2.0/UDP ${localIp}:${sipPortLocal};rport;branch=${branch}`,
              `From: "OTP" <sip:${caller}@${localIp}>;tag=${fromTag}`,
              `To: ${ackTo}`,
              `Call-ID: ${callId}`, 'CSeq: 1 ACK', 'Max-Forwards: 70', 'Content-Length: 0', '', '',
            ].join('\r\n');
            sock.send(ack, 0, Buffer.byteLength(ack), sipPort, sipHost, () => {});

            const finish = () => {
              const connectedAt = Date.now(); // capture when audio finishes
              const dur = connectedAt - startedAt; // total time INVITE→BYE
              // connectedMs = time from ACK→BYE (actual audio time, not SIP handshake)
              const connectedMs = connectedStart ? (connectedAt - connectedStart) : dur;
              const bye = [
                `BYE ${reqUri} SIP/2.0`,
                `Via: SIP/2.0/UDP ${localIp}:${sipPortLocal};rport;branch=z9hG4bK${Math.random().toString(36).slice(2, 12)}`,
                `From: "OTP" <sip:${caller}@${localIp}>;tag=${fromTag}`,
                `To: ${toHdr}`, `Call-ID: ${callId}`, 'CSeq: 2 BYE', 'Max-Forwards: 70', 'Content-Length: 0',
                '', '',
              ].join('\r\n');
              // Mark call complete and resolve BEFORE closing sockets
              resolved = true;
              // connectedMs = actual audio playback time (ACK→BYE), not SIP handshake
              // dur = total time from INVITE to BYE (kept for reference)
              const r = { status: 'completed', dlr: 'DELIVRD', duration: connectedMs || dur, totalDuration: dur };
              notifyCallComplete(callId, r); resolve(r);
              // Send BYE — close sockets in the callback so the packet isn't dropped.
              // Without this, sock.close() right after send() can kill the pending UDP datagram.
              sock.send(bye, 0, Buffer.byteLength(bye), sipPort, sipHost, (err) => {
                if (err) console.log('[asterisk-bridge] BYE send error:', err.message);
                sock.close();
                rtpSock.close();
                console.log('[asterisk-bridge] Call done: BYE sent, %dms (Call-ID: %s)', dur, callId);
              });
            };

            if (allPcm.length > 0) {
              streamRtpAudio(rtpSock, dstIp, dstPort, rtpPT, allPcm, callId, finish);
            } else {
              setTimeout(finish, 400);
            }
            return;
          }

          // 4xx/5xx/6xx — fail
          resolved = true; clearTimeout(timer);
          const r = { status: 'failed', dlr: 'FAILED', duration: Date.now() - startedAt, reason: statusLine };
          notifyCallComplete(callId, r); sock.close(); rtpSock.close(); resolve(r);
        });

        sock.on('error', (err) => {
          if (!resolved) {
            resolved = true; clearTimeout(timer); sock.close(); rtpSock.close();
            const r = { status: 'failed', dlr: 'FAILED', duration: Date.now() - startedAt, reason: err.message };
            notifyCallComplete(callId, r); resolve(r);
          }
        });

        sock.send(invite, 0, Buffer.byteLength(invite), sipPort, sipHost, (err) => {
          if (err && !resolved) {
            resolved = true; clearTimeout(timer); sock.close(); rtpSock.close();
            const r = { status: 'failed', dlr: 'FAILED', duration: Date.now() - startedAt, reason: err.message };
            notifyCallComplete(callId, r); resolve(r);
          } else if (!err) {
            console.log('[asterisk-bridge] INVITE sent: %s:%s→%s:%s (RTP=%s, Call-ID: %s)',
              localIp, sipPortLocal, sipHost, sipPort, myRtpPort, callId);
          }
        });
      });

      function onSipBindErr(err) {
        if (!resolved) {
          resolved = true; sock.close(); rtpSock.close();
          const r = { status: 'failed', dlr: 'FAILED', duration: Date.now() - startedAt, reason: 'Bind: ' + err.message };
          notifyCallComplete(callId, r); resolve(r);
        }
      }
      sock.once('error', onSipBindErr);
    });

    rtpSock.on('error', (e) => { console.log('[asterisk-bridge] RTP error:', e.message); });
  });
}

function notifyCallComplete(callId, result) {
  const call = activeCalls.get(callId);
  if (call) { call.dlr = result.dlr || 'UNKNOWN'; call.duration = result.duration || 0; }
  for (const cb of dlrCallbacks) { try { cb(callId, result); } catch (e) {} }
}

// =================================================================
// PUBLIC
// =================================================================

function getCallStatus(callId) { return activeCalls.get(callId) || null; }
function onDlr(cb) { dlrCallbacks.push(cb); }

// =================================================================
// GLOBAL SIP CONFIG
// =================================================================
let globalSipConfig = null;
function setGlobalSipConfig(c) {
  globalSipConfig = c;
  if (c) console.log('[asterisk-bridge] SIP config: %s:%s', c.host || '?', c.sipPort || c.port || '?');
}
function getGlobalSipConfig() { return globalSipConfig; }

// =================================================================
// AMI protocol
// =================================================================

function sendRaw(data) {
  if (amiSocket) { amiSocket.write(data); }
  else {
    console.warn('[asterisk-bridge] AMI unavailable — failing pending actions');
    for (const [actionId, pending] of pendingActions) {
      clearTimeout(pending.timeout);
      pending.resolve({ status: 'failed', dlr: 'FAILED', duration: 0, reason: 'AMI unavailable' });
      pendingActions.delete(actionId);
    }
  }
}

function nextActionId() { return ++actionCounter; }

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
    const c = line.indexOf(':'); if (c === -1) continue;
    event[line.substring(0, c).trim()] = line.substring(c + 1).trim();
  }

  if (event.Response === 'Success' && event.Message === 'Authentication accepted') {
    connected = true; console.log('[asterisk-bridge] AMI connected'); return;
  }

  // Command response
  if (event.Response === 'Follows' && event.ActionID && commandPending.has(event.ActionID)) {
    const h = commandPending.get(event.ActionID);
    clearTimeout(h.timeout); commandPending.delete(event.ActionID);
    let out = raw.substring(raw.indexOf('\r\n\r\n') + 4);
    const ei = out.lastIndexOf('--END COMMAND--');
    if (ei >= 0) out = out.substring(0, ei);
    h.resolve(out.trim()); return;
  }

  if (event.Response === 'Success' && event.ActionID && pendingActions.has(event.ActionID)) return;
  if (event.Response === 'Error' && event.ActionID && pendingActions.has(event.ActionID)) {
    const p = pendingActions.get(event.ActionID);
    clearTimeout(p.timeout); pendingActions.delete(event.ActionID);
    p.resolve({ status: 'failed', dlr: 'FAILED', reason: event.Message }); return;
  }

  if (event.Event === 'DialBegin') {
    const cid = extractCallId(event);
    if (cid && activeCalls.has(cid)) { activeCalls.get(cid).status = 'ringing'; activeCalls.get(cid).channel = event.Channel || event.DestChannel; }
  }

  if (event.Event === 'DialEnd') {
    const cid = extractCallId(event);
    if (cid && activeCalls.has(cid)) {
      const call = activeCalls.get(cid);
      const ds = event.DialStatus || '';
      if (ds === 'ANSWER') { call.status = 'answered'; call.dlr = 'DELIVRD'; }
      else if (ds === 'BUSY') { call.status = 'busy'; call.dlr = 'FAILED'; }
      else if (ds === 'NOANSWER') { call.status = 'no_answer'; call.dlr = 'FAILED'; }
      else { call.status = 'failed'; call.dlr = 'FAILED'; }
      call.duration = Date.now() - call.startedAt;
      for (const cb of dlrCallbacks) { try { cb(cid, { status: call.status, dlr: call.dlr, duration: call.duration }); } catch (e) {} }
      resolveMatchingPending(cid, { status: call.status, dlr: call.dlr, duration: call.duration });
    }
  }

  if (event.Event === 'Hangup') {
    const cid = extractCallId(event);
    if (cid && activeCalls.has(cid)) {
      const call = activeCalls.get(cid);
      if (call.status === 'ringing') { call.status = 'no_answer'; call.dlr = 'FAILED'; }
      call.duration = Date.now() - call.startedAt;
      resolveMatchingPending(cid, { status: call.status, dlr: call.dlr, duration: call.duration });
    }
  }
}

function resolveMatchingPending(callId, result) {
  for (const [actionId, pending] of pendingActions) {
    if (pending.callId === callId) {
      clearTimeout(pending.timeout); pending.resolve(result);
      pendingActions.delete(actionId); return;
    }
  }
}

function extractCallId(event) {
  if (event.Variable) { const m = event.Variable.match(/VOICE_OTP_ID=([^,]+)/); if (m) return m[1]; }
  return null;
}

// =================================================================
// AMI COMMAND
// =================================================================
const commandPending = new Map();
let commandCounter = 0;

function sendCommand(cmd, timeoutMs = 5000) {
  return new Promise((resolve) => {
    if (!amiSocket || !connected) { resolve(''); return; }
    const actionId = `cmd_${++commandCounter}`;
    const h = { resolve, timeout: null };
    commandPending.set(actionId, h);
    h.timeout = setTimeout(() => { commandPending.delete(actionId); resolve(''); }, timeoutMs);
    sendRaw(`Action: Command\r\nCommand: ${cmd}\r\nActionID: ${actionId}\r\n\r\n`);
  });
}

// =================================================================
module.exports = { connect, originateCall, getCallStatus, onDlr, sendCommand, setGlobalSipConfig, getGlobalSipConfig, isConnected: () => connected };
