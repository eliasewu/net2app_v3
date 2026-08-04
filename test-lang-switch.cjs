/**
 * LANGUAGE SWITCHING TEST: Primary Bangla fails → Secondary English on retry
 *
 * Scenario:
 *   1. Config #85: primary=bn-BD (Bangla), secondary=en-US (English)
 *   2. Supplier has empty SIP address → all calls fail immediately
 *   3. Attempt 0 uses bn-BD → FAILED
 *   4. Attempt 1 switches to en-US → FAILED (expected, but switch verified)
 *   5. Verify reconnect_trace shows :pri: then :sec: entries
 *   6. Verify buildAudioSequence picks the right language per attempt
 *
 * Usage: node test-lang-switch.cjs
 */

const engine = require('./src/services/voiceOtpEngine.cjs');
const { Pool } = require('pg');

const pool = new Pool({
  host: 'localhost', port: 5432,
  database: 'sms_platform', user: 'sms_user',
  password: 'Ariya@2024Net2App',
});

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  LANGUAGE SWITCHING TEST');
  console.log('  Primary (bn-BD) fails → Secondary (en-US) retry');
  console.log('═══════════════════════════════════════════════\n');

  // === Load config #85 from DB ===
  const cfgRes = await pool.query(
    "SELECT * FROM voice_otp_configs WHERE id = 85 AND is_active = true"
  );
  const config = cfgRes.rows[0];
  if (!config) {
    console.error('❌ Config #85 not found!');
    process.exit(1);
  }
  console.log('[Config]');
  console.log(`  Language:    ${config.language} (${config.language_code})`);
  console.log(`  Primary:     ${config.primary_language_code}`);
  console.log(`  Secondary:   ${config.secondary_language_code}`);
  console.log(`  Has audio:   ${!!config.audio_0_9}`);
  console.log(`  Greeting:    ${config.greeting_audio_url || 'default'}`);
  console.log('');

  // === Verify language codes are different ===
  if (config.primary_language_code === config.secondary_language_code) {
    console.error('❌ Primary and secondary language codes are the SAME — no switching needed!');
    console.error(`   Both: ${config.primary_language_code}`);
    process.exit(1);
  }
  console.log(`✅ Primary (${config.primary_language_code}) ≠ Secondary (${config.secondary_language_code}) — switching possible`);
  console.log('');

  // === Test 1: buildAudioSequence — primary (no retry) ===
  console.log('═══════════════════════════════════════════════');
  console.log('  TEST 1: buildAudioSequence — primary (useSecondary=false)');
  console.log('═══════════════════════════════════════════════');
  const pri = engine.buildAudioSequence(config, '252525', 1, false);
  console.log(`  Language:       ${pri.language}`);
  console.log(`  UsedSecondary:  ${pri.usedSecondary}`);
  console.log(`  Expected lang:  ${config.primary_language_code}`);
  const priOk = pri.language === config.primary_language_code && pri.usedSecondary === false;
  console.log(`  ${priOk ? '✅ PASS' : '❌ FAIL'}`);
  console.log('');

  // === Test 2: buildAudioSequence — secondary (retry) ===
  console.log('═══════════════════════════════════════════════');
  console.log('  TEST 2: buildAudioSequence — secondary (useSecondary=true)');
  console.log('═══════════════════════════════════════════════');
  const sec = engine.buildAudioSequence(config, '252525', 1, true);
  console.log(`  Language:       ${sec.language}`);
  console.log(`  UsedSecondary:  ${sec.usedSecondary}`);
  console.log(`  Expected lang:  ${config.secondary_language_code}`);
  const secOk = sec.language === config.secondary_language_code && sec.usedSecondary === true;
  console.log(`  ${secOk ? '✅ PASS' : '❌ FAIL'}`);
  console.log('');

  // === Test 3: executeWithRetry — force all calls to fail, verify trace ===
  console.log('═══════════════════════════════════════════════');
  console.log('  TEST 3: executeWithRetry — force failures, check trace');
  console.log('═══════════════════════════════════════════════');

  const supplier = {
    id: 99,
    supplier_code: 'LANG_TEST',
    connection_type: 'voice_otp',
    dst_sip_address: '',          // EMPTY — forces all calls to fail
    max_retries: 3,
    reconnect_schedule: '0,0.01,0.01',  // 0ms, 600ms, 600ms — fast retries
    rate_per_second: 0,
  };

  const client = {
    id: 1,
    client_code: 'LANG_TEST_CLIENT',
    otp_extraction_pattern: '',
    play_count: 1,
    force_dlr_override: false,
  };

  const startTime = Date.now();
  const callId = `LSWITCH_${Date.now()}`;

  const result = await engine.executeWithRetry(pool, {
    callId,
    destination: '+8801615069178',
    otpCode: '252525',
    supplier,
    config,
    playCount: 1,
    timeout: 5000,
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n  Result:`);
  console.log(`    Final status:   ${result.finalStatus}`);
  console.log(`    Final DLR:      ${result.finalDlr}`);
  console.log(`    Attempts:       ${result.attempts}`);
  console.log(`    Total duration: ${result.totalDuration}ms`);
  console.log(`    Elapsed:        ${elapsed}s`);
  console.log(`    Language:       ${result.language || '?'}`);
  console.log(`    UsedSecondary:  ${result.usedSecondary || false}`);
  console.log(`    Trace entries:  ${result.reconnectTrace.length}`);

  console.log('\n  Reconnect Trace:');
  for (const entry of result.reconnectTrace) {
    console.log(`    ${entry}`);
  }
  console.log('');

  // === Analyze trace ===
  const priEntries = result.reconnectTrace.filter(e => e.includes(':pri:'));
  const secEntries = result.reconnectTrace.filter(e => e.includes(':sec:'));

  console.log(`  Summary:`);
  console.log(`    Primary (bn-BD) attempts:  ${priEntries.length}`);
  console.log(`    Secondary (en-US) attempts: ${secEntries.length}`);

  let traceOk = true;

  // Check attempt 0 used primary
  if (result.reconnectTrace[0]) {
    if (result.reconnectTrace[0].includes(':pri:')) {
      console.log(`    ✅ Attempt 1 → primary (bn-BD)`);
    } else {
      console.log(`    ❌ Attempt 1 → NOT primary: ${result.reconnectTrace[0]}`);
      traceOk = false;
    }
  }

  // Check attempt 1 used secondary
  if (result.reconnectTrace[1]) {
    if (result.reconnectTrace[1].includes(':sec:')) {
      console.log(`    ✅ Attempt 2 → secondary (en-US)`);
    } else {
      console.log(`    ❌ Attempt 2 → NOT secondary: ${result.reconnectTrace[1]}`);
      traceOk = false;
    }
  } else {
    console.log(`    ⚠ Only 1 attempt total — couldn't verify secondary`);
    traceOk = false;
  }

  // Check attempt 2 used primary again
  if (result.reconnectTrace[2]) {
    if (result.reconnectTrace[2].includes(':pri:')) {
      console.log(`    ✅ Attempt 3 → primary (bn-BD) again`);
    } else {
      console.log(`    ⚠ Attempt 3 not primary: ${result.reconnectTrace[2]}`);
    }
  }

  console.log('');

  // === Test 4: Same scenario but secondary should succeed ===
  // We can only test this if Asterisk bridge is available for real calls.
  // For now, verify the engine correctly tracks `usedSecondary` in trace.
  console.log('═══════════════════════════════════════════════');
  console.log('  TEST 4: usedSecondary flag propagation');
  console.log('═══════════════════════════════════════════════');

  // Call originateCall directly with useSecondary=true and verify it passes through
  const directResult = await engine.originateCall(pool, {
    callId: `DIRECT_${Date.now()}`,
    destination: '+8801615069178',
    otpCode: '252525',
    supplier,
    config,
    playCount: 1,
    timeout: 5000,
    useSecondaryLanguage: true,
  });

  console.log(`  Called with useSecondary=true`);
  console.log(`  Result language:   ${directResult.language || '?'}`);
  console.log(`  Result usedSecondary: ${directResult.usedSecondary}`);
  const propOk = directResult.usedSecondary === true;
  console.log(`  ${propOk ? '✅ PASS' : '❌ FAIL'} — usedSecondary flag propagated`);
  console.log('');

  // === Final verdict ===
  const allOk = priOk && secOk && traceOk && propOk;
  console.log('═══════════════════════════════════════════════');
  console.log(`  FINAL VERDICT: ${allOk ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
  console.log('═══════════════════════════════════════════════');

  await pool.end();
  process.exit(allOk ? 0 : 1);
}

main().catch(err => {
  console.error('FATAL:', err);
  pool.end().catch(() => {});
  process.exit(2);
});
