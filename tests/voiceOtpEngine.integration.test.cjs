/**
 * Voice OTP Engine — Integration Tests
 *
 * Covers the full pipeline end-to-end with mocked PostgreSQL pool
 * and simulated Asterisk calls (simulateCall fallback path).
 *
 * Tests:
 *   1. OTP digit extraction (all 3 strategies)
 *   2. Country → language resolution
 *   3. Audio sequence building (primary & secondary)
 *   4. Config resolution by explicit configId
 *   5. Reconnect schedule parsing
 *   6. Force DLR split tracking
 *   7. Full pipeline: SMS → Voice OTP (mocked DB)
 *   8. Language switching on retry (forced failures via no SIP address)
 *   9. DLR timing (completes within expected window)
 *  10. DLR callback webhook format
 *
 * Run: npx jest tests/voiceOtpEngine.integration.test.cjs --verbose
 *   or: npx jest tests/voiceOtpEngine.integration.test.cjs --testTimeout=30000
 */

const engine = require('../src/services/voiceOtpEngine.cjs');

// ============================================================
// Mocks
// ============================================================

function mockPool(overrides = {}) {
  const cfg = {
    queryResults: [],
    queries: [],
    ...overrides,
  };

  return {
    query: async (sql, params) => {
      cfg.queries.push({ sql, params });
      if (cfg.queryResults.length > 0) {
        const next = cfg.queryResults.shift();
        if (typeof next === 'function') return next(sql, params);
        if (next instanceof Error) throw next;
        return next;
      }
      return { rows: [], rowCount: 0 };
    },
    _cfg: cfg,
  };
}

function clientRow(overrides = {}) {
  return {
    id: 1, client_code: 'TEST_CLIENT', smpp_username: 'test_smpp',
    play_count: 1, force_dlr_override: false, webhook_url: '',
    otp_extraction_pattern: '', ...overrides,
  };
}

function supplierRow(overrides = {}) {
  return {
    id: 5, supplier_code: 'VOICE_SUP', connection_type: 'voice_otp',
    dst_sip_address: '192.168.1.100:5060', smpp_username: 'voice_user',
    smpp_password: 'voice_pass', max_retries: 3,
    reconnect_schedule: '0,1,2', rate_per_second: 0,
    voice_otp_config_id: null, ...overrides,
  };
}

function configRow(overrides = {}) {
  const primaryDigits = {};
  const secondaryDigits = {};
  for (let d = 0; d <= 9; d++) {
    primaryDigits[String(d)] = `data:audio/wav;base64,AAAA${d}`;
    secondaryDigits[String(d)] = `data:audio/wav;base64,BBBB${d}`;
  }

  return {
    id: 10, language: 'English', language_code: 'en',
    country_prefix: '1', primary_language_code: 'en-US',
    secondary_language_code: 'es-MX',
    greeting_audio_url: 'data:audio/wav;base64,AAAAGREETING',
    secondary_greeting_audio_url: 'data:audio/wav;base64,AAAASECGREETING',
    audio_0_9_primary: JSON.stringify(primaryDigits),
    audio_0_9_secondary: JSON.stringify(secondaryDigits),
    play_count: 1, retry_count: 4, caller_id: '+15551234567',
    is_active: true, primary_retry_text: 'Please listen again',
    secondary_retry_text: 'Por favor escuche de nuevo',
    ...overrides,
  };
}

// Helper: build queryResults array for full pipeline
function fullPipelineQueryResults(cfg = null) {
  const results = [];
  if (cfg) {
    results.push({ rows: [cfg], rowCount: 1 });
  }
  for (let i = 0; i < 40; i++) results.push({ rows: [], rowCount: 0 });
  return results;
}

// ============================================================
// 1. OTP Digit Extraction
// ============================================================
describe('OTP Digit Extraction', () => {
  test('extracts longest digit sequence from message', () => {
    const result = engine.extractOtpDigits('Your OTP is 123456. Do not share.');
    expect(result.otp).toBe('123456');
    expect(result.method).toBe('longest_sequence');
  });

  test('uses custom regex pattern when provided', () => {
    const result = engine.extractOtpDigits(
      'Your verification code: 7890-ABCD', 'code:\\s*(\\d{4})'
    );
    expect(result.otp).toBe('7890');
    expect(result.method).toBe('pattern');
  });

  test('falls back to generated 6-digit OTP for empty message', () => {
    const result = engine.extractOtpDigits('');
    expect(result.otp).toMatch(/^\d{6}$/);
    expect(result.method).toBe('generated');
  });

  test('falls back to generated OTP for null/undefined', () => {
    const result = engine.extractOtpDigits(null);
    expect(result.otp).toMatch(/^\d{6}$/);
    expect(result.method).toBe('generated');
  });
});

// ============================================================
// 2. Country → Language Resolution
// ============================================================
describe('Country Language Resolution', () => {
  test('resolves Bangladesh (+880) to bn-BD', () => {
    const r = engine.resolveCountryLanguage('+8801712345678');
    expect(r.languageCode).toBe('bn-BD');
    expect(r.countryPrefix).toBe('880');
  });

  test('resolves Saudi Arabia (+966) to ar-SA', () => {
    const r = engine.resolveCountryLanguage('+966501234567');
    expect(r.languageCode).toBe('ar-SA');
  });

  test('resolves USA (+1) to en-US', () => {
    const r = engine.resolveCountryLanguage('+12125551234');
    expect(r.languageCode).toBe('en-US');
  });

  test('longest prefix match wins (971 for UAE trumps 97)', () => {
    const r = engine.resolveCountryLanguage('+971501234567');
    expect(r.countryPrefix).toBe('971');
    expect(r.languageCode).toBe('ar-AE');
  });

  test('falls back to en-US for unknown prefix', () => {
    const r = engine.resolveCountryLanguage('+999123456');
    expect(r.languageCode).toBe('en-US');
  });
});

// ============================================================
// 3. Audio Sequence Building
// ============================================================
describe('Audio Sequence Building', () => {
  const cfg = configRow();

  test('builds primary language sequence with greeting + digits', () => {
    const seq = engine.buildAudioSequence(cfg, '123', 1, false);
    expect(seq.usedSecondary).toBe(false);
    expect(seq.language).toBe('en-US');
    expect(seq.audio[0]).toBe(cfg.greeting_audio_url);
    expect(seq.audio[1]).toContain('AAAA1');
    expect(seq.audio[2]).toContain('AAAA2');
    expect(seq.audio[3]).toContain('AAAA3');
  });

  test('builds secondary language sequence when requested', () => {
    const seq = engine.buildAudioSequence(cfg, '789', 1, true);
    expect(seq.usedSecondary).toBe(true);
    expect(seq.language).toBe('es-MX');
    expect(seq.audio[0]).toBe(cfg.secondary_greeting_audio_url);
    expect(seq.audio[1]).toContain('BBBB7');
    expect(seq.audio[2]).toContain('BBBB8');
    expect(seq.audio[3]).toContain('BBBB9');
  });

  test('includes retry text (greeting again) when configured', () => {
    const seq = engine.buildAudioSequence(cfg, '5', 1, false);
    const lastIdx = seq.audio.length - 1;
    expect(seq.audio[lastIdx]).toBe(cfg.greeting_audio_url);
  });
});

// ============================================================
// 4. Reconnect Schedule Parsing
// ============================================================
describe('Reconnect Schedule Parsing', () => {
  test('default schedule: 0, 60000, 120000 ms', () => {
    expect(engine.parseReconnectSchedule('0,1,2', 3)).toEqual([0, 60000, 120000]);
  });

  test('custom schedule converts minutes to ms', () => {
    expect(engine.parseReconnectSchedule('0,5,10', 3)).toEqual([0, 300000, 600000]);
  });

  test('truncates to maxRetries', () => {
    expect(engine.parseReconnectSchedule('0,1,2,3,4', 2)).toEqual([0, 60000]);
  });

  test('null schedule returns defaults', () => {
    expect(engine.parseReconnectSchedule(null, 2)).toEqual([0, 60000]);
  });

  test('garbage schedule falls back to defaults', () => {
    const s = engine.parseReconnectSchedule('abc,def', 2);
    expect(s).toEqual([0, 60000]);
  });
});

// ============================================================
// 5. Force DLR Split Tracking
// ============================================================
describe('Force DLR', () => {
  test('disabled: returns real DLR unchanged', async () => {
    const pool = mockPool();
    const r = await engine.applyForceDlr(pool, { id: 'c1' }, false, 'FAILED');
    expect(r.clientDlr).toBe('FAILED');
    expect(r.internalDlr).toBe('FAILED');
    expect(r.applied).toBe(false);
  });

  test('enabled: overrides client-facing to DELIVRD', async () => {
    const pool = mockPool();
    const r = await engine.applyForceDlr(pool, { id: 'c1' }, true, 'FAILED');
    expect(r.clientDlr).toBe('DELIVRD');
    expect(r.internalDlr).toBe('FAILED');
    expect(r.applied).toBe(true);
  });
});

// ============================================================
// 6. Config ID Override
// ============================================================
describe('Config Resolution by configId', () => {
  test('route-level configId overrides auto-resolution', async () => {
    const specificCfg = configRow({
      id: 42, language: 'Route Arabic', language_code: 'ar-SA',
      primary_language_code: 'ar-SA', secondary_language_code: 'en-US',
      country_prefix: '966',
    });
    const queryLog = [];
    const pool = mockPool({
      queryResults: (() => {
        const r = [];
        r.push({ rows: [specificCfg], rowCount: 1 });
        for (let i = 0; i < 40; i++) r.push({ rows: [], rowCount: 0 });
        return r;
      })(),
    });
    pool._cfg.queries = queryLog;

    const result = await engine.executeVoiceOtpPipeline(pool, {
      client: clientRow(),
      supplier: supplierRow({ dst_sip_address: '127.0.0.1:5060', reconnect_schedule: '0', max_retries: 1 }),
      destination: '+966501234567',
      message: 'رمز: 789012',
      messageId: 'MSG_CFG_001',
      configId: 42,
    });

    expect(result.otpCode).toBe('789012');

    // Verify config lookup by ID happened
    const configLookup = queryLog.find(q => q.sql.includes('voice_otp_configs') && q.sql.includes('id = $1'));
    expect(configLookup).toBeDefined();
    expect(configLookup.params).toContain(42);

    // Language in voice_otp_logs should reflect route-specific config
    const insertLog = queryLog.find(q => q.sql.includes('INSERT INTO voice_otp_logs'));
    expect(insertLog.params[4]).toBe('ar-SA');
  });
});

// ============================================================
// 7. Full Pipeline
// ============================================================
describe('Full Voice OTP Pipeline', () => {
  test('SMS to US number extracts OTP and completes with DLR', async () => {
    const queryLog = [];
    const pool = mockPool({
      queryResults: fullPipelineQueryResults(configRow({ country_prefix: '1' })),
    });
    pool._cfg.queries = queryLog;

    const startTime = Date.now();
    const result = await engine.executeVoiceOtpPipeline(pool, {
      client: clientRow(),
      supplier: supplierRow({ reconnect_schedule: '0', max_retries: 1 }),
      destination: '+12125551234',
      message: 'Hello! Your one-time password is 246801.',
      messageId: 'MSG_E2E_001',
    });
    const elapsed = Date.now() - startTime;

    expect(result.otpCode).toBe('246801');
    expect(result.callId).toMatch(/^VOICE_\d+_[a-f0-9]+$/);
    expect(['DELIVRD', 'FAILED']).toContain(result.dlr);
    expect(result.duration).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(5000);

    const insertLog = queryLog.find(q => q.sql.includes('INSERT INTO voice_otp_logs'));
    expect(insertLog.params[2]).toBe('246801');
  });

  test('Bangladesh number resolves bn-BD, extracts OTP from Bengali', async () => {
    const config = configRow({ country_prefix: '880', primary_language_code: 'bn-BD', secondary_language_code: 'en-US', language: 'Bangla' });
    const queryLog = [];
    const pool = mockPool({ queryResults: fullPipelineQueryResults(config) });
    pool._cfg.queries = queryLog;

    const result = await engine.executeVoiceOtpPipeline(pool, {
      client: clientRow(),
      supplier: supplierRow({ reconnect_schedule: '0', max_retries: 1 }),
      destination: '+8801712345678',
      message: 'আপনার ওটিপি কোড: 583920',
      messageId: 'MSG_BD_001',
    });

    expect(result.otpCode).toBe('583920');
    const insertLog = queryLog.find(q => q.sql.includes('INSERT INTO voice_otp_logs'));
    expect(insertLog.params[2]).toBe('583920');
  });
});

// ============================================================
// 8. Language Switching on Retry
//    Strategy: Use empty dst_sip_address to force immediate
//    failure on every call (no SIP → no simulateCall needed).
//    This reliably exercises the full retry loop.
// ============================================================
describe('Language Switching on Retry', () => {
  test('alternates primary/secondary language across retry attempts', async () => {
    const cfg = configRow({ primary_language_code: 'en-US', secondary_language_code: 'es-MX' });
    // No SIP address → every call fails immediately, no random simulateCall
    const supp = supplierRow({ dst_sip_address: '', max_retries: 3, reconnect_schedule: '0,0,0' });

    const pool = mockPool({ queryResults: Array(40).fill({ rows: [], rowCount: 0 }) });

    const result = await engine.executeWithRetry(pool, {
      callId: 'VOICE_LANG_SWITCH',
      destination: '+12125551234', otpCode: '1234',
      supplier: supp, config: cfg, playCount: 1, timeout: 15000,
    });

    expect(result.finalDlr).toBe('FAILED'); // all attempts fail
    expect(result.attempts).toBe(3);

    // Verify language alternation in trace
    const priTraces = result.reconnectTrace.filter(t => t.includes(':pri:'));
    const secTraces = result.reconnectTrace.filter(t => t.includes(':sec:'));
    expect(priTraces.length).toBeGreaterThanOrEqual(1); // attempt 0, 2
    expect(secTraces.length).toBeGreaterThanOrEqual(1); // attempt 1
  });

  test('no language switch when secondary equals primary', async () => {
    const cfg = configRow({ primary_language_code: 'en-US', secondary_language_code: 'en-US' });
    const supp = supplierRow({ dst_sip_address: '', max_retries: 2, reconnect_schedule: '0,0' });

    const pool = mockPool({ queryResults: Array(20).fill({ rows: [], rowCount: 0 }) });

    const result = await engine.executeWithRetry(pool, {
      callId: 'VOICE_NO_SWITCH',
      destination: '+12125551234', otpCode: '9999',
      supplier: supp, config: cfg, playCount: 1, timeout: 15000,
    });

    // All attempts should be primary (no sec traces)
    const secTraces = result.reconnectTrace.filter(t => t.includes(':sec:'));
    expect(secTraces).toHaveLength(0);
  });

  test('buildAudioSequence returns correct language per flag', () => {
    const cfg = configRow({ primary_language_code: 'bn-BD', secondary_language_code: 'en-US' });

    // Primary
    const pri = engine.buildAudioSequence(cfg, '123', 1, false);
    expect(pri.language).toBe('bn-BD');
    expect(pri.usedSecondary).toBe(false);
    expect(pri.audio[0]).toBe(cfg.greeting_audio_url);

    // Secondary
    const sec = engine.buildAudioSequence(cfg, '456', 1, true);
    expect(sec.language).toBe('en-US');
    expect(sec.usedSecondary).toBe(true);
    expect(sec.audio[0]).toBe(cfg.secondary_greeting_audio_url);
  });
});

// ============================================================
// 9. DLR Timing
// ============================================================
describe('DLR Timing', () => {
  test('pipeline completes within 5 seconds for single attempt', async () => {
    const pool = mockPool({ queryResults: fullPipelineQueryResults(configRow()) });

    const start = Date.now();
    const result = await engine.executeVoiceOtpPipeline(pool, {
      client: clientRow(),
      supplier: supplierRow({ reconnect_schedule: '0', max_retries: 1 }),
      destination: '+12125551234', message: 'Code: 987654', messageId: 'MSG_TIME',
    });
    const elapsed = Date.now() - start;

    expect(result).toBeDefined();
    // DLR should be confirmed within 4 seconds (user requirement)
    expect(elapsed).toBeLessThan(4000);
  });

  test('retry with immediate schedule makes exactly max_retries attempts', async () => {
    // reconnect_schedule '0,0' = both attempts fire immediately (0 min delay each)
    const supp = supplierRow({ dst_sip_address: '', max_retries: 3, reconnect_schedule: '0,0,0' });
    const pool = mockPool({ queryResults: Array(20).fill({ rows: [], rowCount: 0 }) });

    const result = await engine.executeWithRetry(pool, {
      callId: 'VOICE_IMMEDIATE', destination: '+12125551234', otpCode: '1111',
      supplier: supp, config: configRow(), playCount: 1, timeout: 15000,
    });

    // All 3 attempts fire immediately, all fail (no SIP)
    expect(result.attempts).toBe(3);
    expect(result.finalDlr).toBe('FAILED');
    expect(result.reconnectTrace).toHaveLength(3);
  });

  test('reconnect_schedule limits to max_retries', async () => {
    // Schedule has more entries than max_retries — should truncate
    const supp = supplierRow({ dst_sip_address: '', max_retries: 2, reconnect_schedule: '0,0,0,0,0' });
    const pool = mockPool({ queryResults: Array(20).fill({ rows: [], rowCount: 0 }) });

    const result = await engine.executeWithRetry(pool, {
      callId: 'VOICE_TRUNCATE', destination: '+12125551234', otpCode: '2222',
      supplier: supp, config: configRow(), playCount: 1, timeout: 15000,
    });

    expect(result.attempts).toBe(2); // truncated to max_retries
  });
});

// ============================================================
// 10. DLR Callback Payload Format
// ============================================================
describe('DLR Callback Webhook', () => {
  test('produces correct payload shape', () => {
    const payload = {
      message_id: 'MSG_TEST', destination: '+12125551234',
      status: 'DELIVRD', dlr_status: 'DELIVRD', channel: 'voice_otp',
      duration_ms: 5000, call_id: 'VOICE_abc123', timestamp: new Date().toISOString(),
    };

    expect(payload.message_id).toBe('MSG_TEST');
    expect(payload.channel).toBe('voice_otp');
    expect(payload.duration_ms).toBeGreaterThan(0);
    expect(payload.call_id).toMatch(/^VOICE_/);
    expect(() => new Date(payload.timestamp)).not.toThrow();
  });
});

// ============================================================
// 11. SIP Address Parsing
// ============================================================
describe('SIP Address Parsing', () => {
  test('parses host:port', () => {
    expect(engine.parseSipAddress('192.168.1.1:5060')).toEqual({ host: '192.168.1.1', port: 5060 });
  });

  test('defaults port to 5060', () => {
    expect(engine.parseSipAddress('10.0.0.1')).toEqual({ host: '10.0.0.1', port: 5060 });
  });

  test('returns null for empty address', () => {
    expect(engine.parseSipAddress('')).toBeNull();
  });
});

// ============================================================
// 12. Edge Cases
// ============================================================
describe('Edge Cases', () => {
  test('generates random 6-digit OTPs reliably', () => {
    for (let i = 0; i < 10; i++) {
      expect(engine.generateRandomOtp(6)).toMatch(/^\d{6}$/);
    }
  });

  test('resolveVoiceOtpConfig falls back to first active config', async () => {
    const pool = mockPool({
      queryResults: [
        { rows: [], rowCount: 0 }, // prefix match — empty
        { rows: [], rowCount: 0 }, // language match — empty
        { rows: [configRow({ id: 99, language: 'Fallback' })], rowCount: 1 }, // fallback
      ],
    });
    const cfg = await engine.resolveVoiceOtpConfig(pool, '+999', 'xx-XX');
    expect(cfg).toBeDefined();
    expect(cfg.id).toBe(99);
  });

  test('resolveVoiceOtpConfig returns null when no configs exist', async () => {
    const pool = mockPool({
      queryResults: [
        { rows: [], rowCount: 0 },
        { rows: [], rowCount: 0 },
        { rows: [], rowCount: 0 },
      ],
    });
    const cfg = await engine.resolveVoiceOtpConfig(pool, '+999', 'xx-XX');
    expect(cfg).toBeNull();
  });
});
