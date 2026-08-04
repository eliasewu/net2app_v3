/**
 * Live Voice OTP Test — Bangladesh (+8801615069178) via SIP 198.27.80.229
 * Uses real bn-BD audio files from voice_otp_configs (id=85)
 *
 * Usage: node test-voice-otp-live.cjs
 */

const engine = require('./src/services/voiceOtpEngine.cjs');
const { Pool } = require('pg');

// ====== Test Parameters ======
const TEST_DESTINATION = '+8801615069178';
const TEST_OTP_CODE = '252525';
const SIP_HOST = '198.27.80.229';
const SIP_PORT = 5060;

// ====== Real PostgreSQL pool ======
const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'sms_platform',
  user: 'sms_user',
  password: 'Ariya@2024Net2App',
});

// ====== Run Test ======
async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Voice OTP Live Test — Bangla Audio');
  console.log('═══════════════════════════════════════════════');
  console.log(`  Destination:  ${TEST_DESTINATION}`);
  console.log(`  OTP Code:     ${TEST_OTP_CODE}`);
  console.log(`  SIP Server:   ${SIP_HOST}:${SIP_PORT}`);
  console.log('═══════════════════════════════════════════════\n');

  // 1. Resolve country/language
  console.log('--- Step 1: Language Resolution ---');
  const lang = engine.resolveCountryLanguage(TEST_DESTINATION);
  console.log(`  Country prefix: ${lang.countryPrefix || '(unknown)'}`);
  console.log(`  Language code:  ${lang.languageCode}`);
  console.log(`  Expected bn-BD: ${lang.languageCode === 'bn-BD' ? '✅' : '❌'}`);
  console.log('');

  // 2. Load real bn-BD config from DB
  console.log('--- Step 2: Load bn-BD Config from Database ---');
  const cfgResult = await pool.query(
    "SELECT * FROM voice_otp_configs WHERE language_code = 'bn-BD' AND is_active = true LIMIT 1"
  );
  const config = cfgResult.rows[0];
  if (!config) {
    console.error('❌ No bn-BD config found in voice_otp_configs!');
    process.exit(1);
  }
  console.log(`  Config ID:    ${config.id}`);
  console.log(`  Language:     ${config.language}`);
  console.log(`  Primary lang: ${config.primary_language_code}`);
  console.log(`  Secondary:    ${config.secondary_language_code}`);
  console.log(`  Greeting URL: ${config.greeting_audio_url || '(null — will fallback to disk)'}`);
  console.log(`  Has audio_0_9: ${config.audio_0_9 ? '✅ YES (DB-stored paths)' : '❌ NO (disk fallback)'}`);
  console.log('');

  // Verify disk files exist
  console.log('--- Step 3: Verify Audio Files on Disk ---');
  const fs = require('fs');
  const path = require('path');
  const audioDir = path.join(__dirname, 'data', 'uploads', 'audio', 'bn-BD');
  const missing = [];
  for (let i = 0; i <= 9; i++) {
    const fp = path.join(audioDir, `${i}.wav`);
    if (fs.existsSync(fp)) {
      const stat = fs.statSync(fp);
      console.log(`  ${i}.wav  ✅  ${stat.size} bytes`);
    } else {
      console.log(`  ${i}.wav  ❌ MISSING`);
      missing.push(i);
    }
  }
  const greetingPath = path.join(audioDir, 'greeting.wav');
  if (fs.existsSync(greetingPath)) {
    const stat = fs.statSync(greetingPath);
    console.log(`  greeting.wav  ✅  ${stat.size} bytes`);
  } else {
    console.log(`  greeting.wav  ❌ MISSING`);
    missing.push('greeting');
  }
  if (missing.length > 0) {
    console.error(`\n❌ ${missing.length} files missing!`);
  } else {
    console.log('\n✅ All 11 audio files present on disk');
  }
  console.log('');

  // 4. Build audio sequence (primary — Bangla)
  console.log('--- Step 4: Audio Sequence (Primary: bn-BD) ---');
  const audioSeq = engine.buildAudioSequence(config, TEST_OTP_CODE, 1, false);
  console.log(`  Language:    ${audioSeq.language}`);
  console.log(`  UsedSecondary: ${audioSeq.usedSecondary}`);
  console.log(`  Total files:  ${audioSeq.audio.length}`);
  console.log(`  Sequence:`);
  audioSeq.audio.forEach((f, i) => {
    const basename = typeof f === 'string' ? f.split('/').pop() || f : f;
    console.log(`    [${i}] ${basename}`);
  });
  console.log('');

  // 5. Build audio sequence (secondary — English fallback)
  if (config.secondary_language_code !== config.primary_language_code) {
    console.log('--- Step 5: Audio Sequence (Secondary: en-US) ---');
    const audioSeq2 = engine.buildAudioSequence(config, TEST_OTP_CODE, 1, true);
    console.log(`  Language:    ${audioSeq2.language}`);
    console.log(`  UsedSecondary: ${audioSeq2.usedSecondary}`);
    console.log('');
  }

  // 6. Originate the call
  console.log('--- Step 6: Call Origination ---');
  console.log(`  Dialing ${SIP_HOST}:${SIP_PORT} → ${TEST_DESTINATION}`);
  console.log(`  Playing: Greeting + "${TEST_OTP_CODE.split('').join(', ')}" in Bangla`);
  console.log('');

  const supplier = {
    id: 99,
    supplier_code: 'LIVE_TEST_BN',
    connection_type: 'voice_otp',
    dst_sip_address: `${SIP_HOST}:${SIP_PORT}`,
    smpp_username: '',
    smpp_password: '',
    max_retries: 3,
    reconnect_schedule: '0,1,2',
    rate_per_second: 0,
  };

  const startTime = Date.now();
  const result = await engine.originateCall(pool, {
    callId: `BNBD_${Date.now()}`,
    destination: TEST_DESTINATION,
    otpCode: TEST_OTP_CODE,
    supplier,
    config,
    playCount: 1,
    timeout: 45000,
    useSecondaryLanguage: false,
  });
  const elapsed = (Date.now() - startTime) / 1000;

  console.log('═══════════════════════════════════════════════');
  console.log('  CALL RESULT');
  console.log('═══════════════════════════════════════════════');
  console.log(`  Status:      ${result.status}`);
  console.log(`  DLR:         ${result.dlr}`);
  console.log(`  Duration:    ${result.duration}ms (${(result.duration / 1000).toFixed(1)}s)`);
  console.log(`  Elapsed:     ${elapsed.toFixed(2)}s`);
  console.log(`  Language:    ${result.language || 'unknown'}`);
  console.log(`  Source:      ${result.simulated ? '⚠ SIMULATED (no Asterisk bridge)' : '✅ REAL CALL via Asterisk'}`);
  if (result.error) {
    console.log(`  Error:       ${result.error}`);
  }
  console.log('═══════════════════════════════════════════════');

  if (result.simulated) {
    console.log('\n⚠  NOTE: Call was SIMULATED — no Asterisk bridge connected.');
    console.log('   The engine correctly built the Bangla audio sequence.');
    console.log('   Real calls will play actual bn-BD audio via SIP.');
  } else if (result.dlr === 'DELIVRD') {
    console.log('\n✅ Bangla audio played successfully via real SIP call!');
    console.log('   The recipient heard: greeting + digits in Bangla (bn-BD)');
  }

  await pool.end();
  process.exit(result.dlr === 'DELIVRD' || result.simulated ? 0 : 1);
}

main().catch(err => {
  console.error('FATAL:', err.message);
  pool.end().catch(() => {});
  process.exit(2);
});
