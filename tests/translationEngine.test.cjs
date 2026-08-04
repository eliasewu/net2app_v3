/**
 * Translation Engine Unit Tests
 * 
 * Tests the pure applyRules() function from translationEngine.cjs
 * Covers all 6 translation types: number_prefix, content_replace,
 * otp_extract, sid_alias, sid_random, random_content
 * 
 * Run: npx jest tests/translationEngine.test.cjs
 */

const { applyRules } = require('../src/services/translationEngine.cjs');

// ============================================================
// Helpers
// ============================================================

function rule(type, overrides = {}) {
  return {
    translation_type: type,
    source_pattern: '',
    target_value: '',
    strip_prefix_digits: 0,
    add_prefix_text: '',
    match_content: '',
    replace_content: '',
    is_otp_extract: false,
    otp_length_min: 4,
    otp_length_max: 8,
    template_data: null,
    sid_match_type: 'exact',
    ...overrides,
  };
}

function input(destination, senderId, message) {
  return { destination, sender_id: senderId, message };
}

// ============================================================
// 1. number_prefix
// ============================================================
describe('number_prefix', () => {
  test('strip prefix digits — removes first N chars', () => {
    const rules = [rule('number_prefix', { strip_prefix_digits: 2 })];
    const result = applyRules(rules, input('008801712345678', 'SID', 'test'));
    expect(result.destination).toBe('8801712345678');
  });

  test('add prefix — prepends text', () => {
    const rules = [rule('number_prefix', { add_prefix_text: '77' })];
    const result = applyRules(rules, input('8801712345678', 'SID', 'test'));
    expect(result.destination).toBe('778801712345678');
  });

  test('strip + add combined', () => {
    const rules = [rule('number_prefix', { strip_prefix_digits: 2, add_prefix_text: '77' })];
    const result = applyRules(rules, input('008801712345678', 'SID', 'test'));
    expect(result.destination).toBe('778801712345678');
  });

  test('strip more digits than length — returns empty string', () => {
    const rules = [rule('number_prefix', { strip_prefix_digits: 50 })];
    const result = applyRules(rules, input('12345', 'SID', 'test'));
    expect(result.destination).toBe('');
  });

  test('strip 0 does nothing', () => {
    const rules = [rule('number_prefix', { strip_prefix_digits: 0 })];
    const result = applyRules(rules, input('8801712345678', 'SID', 'test'));
    expect(result.destination).toBe('8801712345678');
  });

  test('handles + prefix — strips it before processing', () => {
    const rules = [rule('number_prefix', { strip_prefix_digits: 1 })];
    const result = applyRules(rules, input('+8801712345678', 'SID', 'test'));
    expect(result.destination).toBe('801712345678');
  });

  test('does not affect sender_id or message', () => {
    const rules = [rule('number_prefix', { strip_prefix_digits: 3 })];
    const result = applyRules(rules, input('123456789', 'MY_SID', 'hello world'));
    expect(result.sender_id).toBe('MY_SID');
    expect(result.message).toBe('hello world');
  });
});

// ============================================================
// 2. content_replace
// ============================================================
describe('content_replace', () => {
  test('simple replace — case insensitive', () => {
    const rules = [rule('content_replace', {
      match_content: 'Your OTP is',
      replace_content: 'Code:',
    })];
    const result = applyRules(rules, input('123', 'SID', 'Your OTP is 123456'));
    expect(result.message).toBe('Code: 123456');
  });

  test('simple replace — case insensitive (uppercase input)', () => {
    const rules = [rule('content_replace', {
      match_content: 'your otp is',
      replace_content: 'Code:',
    })];
    const result = applyRules(rules, input('123', 'SID', 'YOUR OTP IS 987654'));
    expect(result.message).toBe('Code: 987654');
  });

  test('no match — message unchanged', () => {
    const rules = [rule('content_replace', {
      match_content: 'nonexistent',
      replace_content: 'replaced',
    })];
    const result = applyRules(rules, input('123', 'SID', 'Hello world'));
    expect(result.message).toBe('Hello world');
  });

  test('empty match_content — message unchanged', () => {
    const rules = [rule('content_replace', {
      match_content: '',
      replace_content: 'replaced',
    })];
    const result = applyRules(rules, input('123', 'SID', 'Hello world'));
    expect(result.message).toBe('Hello world');
  });

  test('empty message — unchanged', () => {
    const rules = [rule('content_replace', {
      match_content: 'hello',
      replace_content: 'hi',
    })];
    const result = applyRules(rules, input('123', 'SID', ''));
    expect(result.message).toBe('');
  });

  test('OTP-aware replace — extracts OTP and injects into template', () => {
    const rules = [rule('content_replace', {
      match_content: 'Your OTP is',
      replace_content: 'Code: {{OTP}}',
      is_otp_extract: true,
      otp_length_min: 4,
      otp_length_max: 6,
    })];
    const result = applyRules(rules, input('123', 'SID', 'Your OTP is 123456'));
    expect(result.message).toBe('Code: 123456');
  });

  test('OTP-aware — no OTP found, message unchanged', () => {
    const rules = [rule('content_replace', {
      match_content: 'Your OTP is',
      replace_content: 'Code: {{OTP}}',
      is_otp_extract: true,
    })];
    const result = applyRules(rules, input('123', 'SID', 'Your OTP is hello'));
    expect(result.message).toBe('Your OTP is hello');
  });

  test('regex special chars in match_content are escaped', () => {
    const rules = [rule('content_replace', {
      match_content: 'Price: $10.99',
      replace_content: 'Cost: $9.99',
    })];
    const result = applyRules(rules, input('123', 'SID', 'Price: $10.99 today'));
    expect(result.message).toBe('Cost: $9.99 today');
  });

  test('does not affect destination or sender_id', () => {
    const rules = [rule('content_replace', {
      match_content: 'hello',
      replace_content: 'hi',
    })];
    const result = applyRules(rules, input('123456', 'MY_SID', 'hello world'));
    expect(result.destination).toBe('123456');
    expect(result.sender_id).toBe('MY_SID');
  });
});

// ============================================================
// 3. otp_extract
// ============================================================
describe('otp_extract', () => {
  test('extracts OTP and wraps in template', () => {
    const rules = [rule('otp_extract', {
      replace_content: 'Your code: {{OTP}}',
      is_otp_extract: true,
      otp_length_min: 4,
      otp_length_max: 8,
    })];
    const result = applyRules(rules, input('123', 'SID', 'Code: 123456'));
    expect(result.message).toBe('Your code: 123456');
  });

  test('extracts OTP without template — returns raw OTP', () => {
    const rules = [rule('otp_extract', {
      replace_content: '',
      is_otp_extract: true,
      otp_length_min: 4,
      otp_length_max: 8,
    })];
    const result = applyRules(rules, input('123', 'SID', 'Code: 123456'));
    expect(result.message).toBe('123456');
  });

  test('extracts first matching OTP when multiple exist', () => {
    const rules = [rule('otp_extract', {
      replace_content: 'OTP: {{OTP}}',
      is_otp_extract: true,
      otp_length_min: 4,
      otp_length_max: 6,
    })];
    const result = applyRules(rules, input('123', 'SID', 'First 1234 then 5678'));
    expect(result.message).toBe('OTP: 1234');
  });

  test('no OTP found — message unchanged', () => {
    const rules = [rule('otp_extract', {
      replace_content: 'OTP: {{OTP}}',
      is_otp_extract: true,
    })];
    const result = applyRules(rules, input('123', 'SID', 'No numbers here'));
    expect(result.message).toBe('No numbers here');
  });

  test('empty message — unchanged', () => {
    const rules = [rule('otp_extract', {
      replace_content: 'OTP: {{OTP}}',
      is_otp_extract: true,
    })];
    const result = applyRules(rules, input('123', 'SID', ''));
    expect(result.message).toBe('');
  });

  test('does not affect destination or sender_id', () => {
    const rules = [rule('otp_extract', {
      replace_content: 'Code: {{OTP}}',
      is_otp_extract: true,
    })];
    const result = applyRules(rules, input('88017', 'SENDER', 'OTP 8888'));
    expect(result.destination).toBe('88017');
    expect(result.sender_id).toBe('SENDER');
  });
});

// ============================================================
// 4. sid_alias
// ============================================================
describe('sid_alias', () => {
  test('exact match — replaces sender_id', () => {
    const rules = [rule('sid_alias', {
      source_pattern: 'NET2APP',
      target_value: 'BRANDED',
    })];
    const result = applyRules(rules, input('123', 'NET2APP', 'test'));
    expect(result.sender_id).toBe('BRANDED');
  });

  test('wildcard * at end — matches prefix', () => {
    const rules = [rule('sid_alias', {
      source_pattern: 'NET2APP*',
      target_value: 'BRANDED',
    })];
    const result = applyRules(rules, input('123', 'NET2APP', 'test'));
    expect(result.sender_id).toBe('BRANDED');
  });

  test('wildcard * at start — matches suffix', () => {
    const rules = [rule('sid_alias', {
      source_pattern: '*APP',
      target_value: 'BRANDED',
    })];
    const result = applyRules(rules, input('123', 'NET2APP', 'test'));
    expect(result.sender_id).toBe('BRANDED');
  });

  test('wildcard * in middle — matches pattern', () => {
    const rules = [rule('sid_alias', {
      source_pattern: 'NET*APP',
      target_value: 'BRANDED',
    })];
    const result = applyRules(rules, input('123', 'NET2APP', 'test'));
    expect(result.sender_id).toBe('BRANDED');
  });

  test('case insensitive match', () => {
    const rules = [rule('sid_alias', {
      source_pattern: 'net2app',
      target_value: 'BRANDED',
    })];
    const result = applyRules(rules, input('123', 'NET2APP', 'test'));
    expect(result.sender_id).toBe('BRANDED');
  });

  test('no match — sender_id unchanged', () => {
    const rules = [rule('sid_alias', {
      source_pattern: 'NET2APP',
      target_value: 'BRANDED',
    })];
    const result = applyRules(rules, input('123', 'OTHER_SID', 'test'));
    expect(result.sender_id).toBe('OTHER_SID');
  });

  test('empty sender_id — unchanged', () => {
    const rules = [rule('sid_alias', {
      source_pattern: '*',
      target_value: 'DEFAULT',
    })];
    const result = applyRules(rules, input('123', '', 'test'));
    expect(result.sender_id).toBe('');
  });

  test('does not affect destination or message', () => {
    const rules = [rule('sid_alias', {
      source_pattern: 'OLD*',
      target_value: 'NEW',
    })];
    const result = applyRules(rules, input('88017', 'OLD_SID', 'hello'));
    expect(result.destination).toBe('88017');
    expect(result.message).toBe('hello');
  });
});

// ============================================================
// 5. sid_random
// ============================================================
describe('sid_random', () => {
  test('picks from pipe-separated list', () => {
    const rules = [rule('sid_random', {
      target_value: 'ALPHA|BETA|GAMMA',
    })];
    // Run multiple times to verify it always picks from the set
    for (let i = 0; i < 20; i++) {
      const result = applyRules(rules, input('123', 'ORIGINAL', 'test'));
      expect(['ALPHA', 'BETA', 'GAMMA']).toContain(result.sender_id);
    }
  });

  test('single template — always returns that value', () => {
    const rules = [rule('sid_random', {
      target_value: 'ONLY_ONE',
    })];
    const result = applyRules(rules, input('123', 'ORIGINAL', 'test'));
    expect(result.sender_id).toBe('ONLY_ONE');
  });

  test('does not affect destination or message', () => {
    const rules = [rule('sid_random', {
      target_value: 'A|B|C',
    })];
    const result = applyRules(rules, input('88017', 'ORIGINAL', 'hello world'));
    expect(result.destination).toBe('88017');
    expect(result.message).toBe('hello world');
  });
});

// ============================================================
// 6. random_content
// ============================================================
describe('random_content', () => {
  test('picks random template and injects OTP', () => {
    const rules = [rule('random_content', {
      target_value: 'Hello! Your code is {{OTP}}|Hi! Use code {{OTP}} to login',
      is_otp_extract: true,
      otp_length_min: 4,
      otp_length_max: 6,
    })];
    const validMessages = [
      'Hello! Your code is 123456',
      'Hi! Use code 123456 to login',
    ];
    for (let i = 0; i < 20; i++) {
      const result = applyRules(rules, input('123', 'SID', 'Your OTP is 123456'));
      expect(validMessages).toContain(result.message);
    }
  });

  test('no OTP found — substitutes empty string', () => {
    const rules = [rule('random_content', {
      target_value: 'Code: {{OTP}}',
      is_otp_extract: true,
    })];
    const result = applyRules(rules, input('123', 'SID', 'No numbers'));
    expect(result.message).toBe('Code: ');
  });

  test('empty message — unchanged', () => {
    const rules = [rule('random_content', {
      target_value: 'Template {{OTP}}',
    })];
    const result = applyRules(rules, input('123', 'SID', ''));
    expect(result.message).toBe('');
  });

  test('does not affect destination or sender_id', () => {
    const rules = [rule('random_content', {
      target_value: 'A {{OTP}}|B {{OTP}}',
    })];
    const result = applyRules(rules, input('88017', 'MY_SID', 'OTP 9999'));
    expect(result.destination).toBe('88017');
    expect(result.sender_id).toBe('MY_SID');
  });
});

// ============================================================
// 7. Multi-rule pipeline (priority ordering)
// ============================================================
describe('multi-rule pipeline', () => {
  test('number_prefix + content_replace in sequence', () => {
    const rules = [
      rule('number_prefix', { strip_prefix_digits: 2 }),
      rule('content_replace', { match_content: 'Your OTP is', replace_content: 'Code:' }),
    ];
    const result = applyRules(rules, input('008801712345678', 'SID', 'Your OTP is 123456'));
    expect(result.destination).toBe('8801712345678');
    expect(result.message).toBe('Code: 123456');
  });

  test('content_replace + otp_extract in sequence', () => {
    const rules = [
      rule('content_replace', { match_content: 'OTP:', replace_content: 'Code:' }),
      rule('otp_extract', { replace_content: 'Verification: {{OTP}}', is_otp_extract: true }),
    ];
    const result = applyRules(rules, input('123', 'SID', 'OTP: 7777'));
    expect(result.message).toBe('Verification: 7777');
  });

  test('sid_alias + sid_random — last one wins', () => {
    const rules = [
      rule('sid_alias', { source_pattern: 'NET*', target_value: 'BRANDED' }),
      rule('sid_random', { target_value: 'ALPHA|BETA' }),
    ];
    const result = applyRules(rules, input('123', 'NET2APP', 'test'));
    // sid_random runs after sid_alias, so it overrides
    expect(['ALPHA', 'BETA']).toContain(result.sender_id);
  });

  test('all 6 types together', () => {
    const rules = [
      rule('number_prefix', { strip_prefix_digits: 2 }),
      rule('content_replace', { match_content: 'hello', replace_content: 'hi' }),
      rule('otp_extract', { replace_content: 'Code: {{OTP}}', is_otp_extract: true }),
      rule('sid_alias', { source_pattern: 'OLD*', target_value: 'MID' }),
      rule('sid_random', { target_value: 'ALPHA|BETA' }),
      rule('random_content', { target_value: 'Final: {{OTP}}', is_otp_extract: true }),
    ];
    const result = applyRules(rules, input('00880', 'OLD_SID', 'hello 9999'));
    expect(result.destination).toBe('880');
    // After content_replace: "hi 9999", then otp_extract: "Code: 9999", then random_content overrides
    expect(result.message).toBe('Final: 9999');
    expect(['ALPHA', 'BETA']).toContain(result.sender_id);
  });
});

// ============================================================
// 8. Edge cases
// ============================================================
describe('edge cases', () => {
  test('empty rules array — returns input unchanged', () => {
    const inp = input('88017', 'SID', 'hello');
    const result = applyRules([], inp);
    expect(result).toEqual(inp);
  });

  test('null/undefined rules — returns input unchanged', () => {
    const inp = input('88017', 'SID', 'hello');
    expect(applyRules(null, inp)).toEqual(inp);
    expect(applyRules(undefined, inp)).toEqual(inp);
  });

  test('unknown translation type — silently skipped', () => {
    const rules = [{ translation_type: 'unknown_type', source_pattern: 'x', target_value: 'y' }];
    const inp = input('123', 'SID', 'hello');
    const result = applyRules(rules, inp);
    expect(result).toEqual(inp);
  });

  test('rule with no relevant fields — does nothing', () => {
    const rules = [rule('number_prefix', { strip_prefix_digits: 0, add_prefix_text: '' })];
    const inp = input('88017', 'SID', 'hello');
    const result = applyRules(rules, inp);
    expect(result).toEqual(inp);
  });
});

// ============================================================
// 9. Additional coverage (code-reviewer suggestions)
// ============================================================
describe('template_data JSON array path', () => {
  test('sid_random uses template_data JSON array', () => {
    const rules = [rule('sid_random', { 
      template_data: ['SID_A', 'SID_B', 'SID_C'],
      target_value: '', // fallback not used
    })];
    for (let i = 0; i < 20; i++) {
      const result = applyRules(rules, input('123', 'ORIG', 'test'));
      expect(['SID_A', 'SID_B', 'SID_C']).toContain(result.sender_id);
    }
  });

  test('random_content uses template_data JSON array', () => {
    const rules = [rule('random_content', {
      template_data: ['TmplA: {{OTP}}', 'TmplB: {{OTP}}'],
      target_value: '',
      is_otp_extract: true,
    })];
    const valid = ['TmplA: 9999', 'TmplB: 9999'];
    for (let i = 0; i < 20; i++) {
      const result = applyRules(rules, input('123', 'SID', 'OTP 9999'));
      expect(valid).toContain(result.message);
    }
  });

  test('sid_random with empty template_data falls back to target_value', () => {
    const rules = [rule('sid_random', {
      template_data: [],
      target_value: 'FALLBACK',
    })];
    const result = applyRules(rules, input('123', 'ORIG', 'test'));
    expect(result.sender_id).toBe('FALLBACK');
  });
});

describe('defensive edge cases', () => {
  test('negative strip_prefix_digits — treated as 0 by substring', () => {
    const rules = [rule('number_prefix', { strip_prefix_digits: -5 })];
    const result = applyRules(rules, input('12345', 'SID', 'test'));
    // substring(-5) === substring(0) in JS, returns full string
    expect(result.destination).toBe('12345');
  });

  test('null add_prefix_text — no prefix added', () => {
    const rules = [rule('number_prefix', { add_prefix_text: null })];
    const result = applyRules(rules, input('12345', 'SID', 'test'));
    expect(result.destination).toBe('12345');
  });

  test('empty source_pattern — sid_alias skipped', () => {
    const rules = [rule('sid_alias', { source_pattern: '', target_value: 'NEW' })];
    const result = applyRules(rules, input('123', 'OLD', 'test'));
    expect(result.sender_id).toBe('OLD');
  });

  test('random_content with custom OTP length bounds', () => {
    const rules = [rule('random_content', {
      target_value: 'Code: {{OTP}}',
      is_otp_extract: true,
      otp_length_min: 6,
      otp_length_max: 6,
    })];
    // Only 6-digit numbers should be extracted
    const result6 = applyRules(rules, input('123', 'SID', 'Your code: 123456'));
    expect(result6.message).toBe('Code: 123456');
    // 4-digit number should NOT match (min is 6)
    const result4 = applyRules(rules, input('123', 'SID', 'Your code: 1234'));
    expect(result4.message).toBe('Code: ');
  });

  test('null message — all types handle gracefully', () => {
    const rules = [
      rule('number_prefix', { strip_prefix_digits: 2 }),
      rule('content_replace', { match_content: 'x', replace_content: 'y' }),
      rule('otp_extract', { is_otp_extract: true }),
      rule('sid_alias', { source_pattern: '*', target_value: 'NEW' }),
      rule('sid_random', { target_value: 'A|B' }),
      rule('random_content', { target_value: '{{OTP}}' }),
    ];
    // Should not throw
    const result = applyRules(rules, input('123', '', null));
    expect(result.destination).toBe('3');  // 123 stripped 2 digits
    expect(['A', 'B']).toContain(result.sender_id);  // sid_alias(*) matches empty, sid_random picks A|B
    expect(result.message).toBe('');  // engine converts null to ''
  });
});
