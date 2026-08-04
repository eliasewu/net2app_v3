/**
 * Translation Engine — Pure rule-application logic.
 * Extracted from server.cjs for testability.
 * 
 * Takes an array of translation rules (already fetched from DB) and
 * applies them sequentially in priority order to SMS message fields.
 */

/**
 * Apply translation rules to SMS message fields.
 * @param {Array} rules - Active translation rules sorted by priority ASC
 * @param {object} input - { destination, sender_id, message }
 * @returns {object} - { destination, sender_id, message } after transformations
 */
function applyRules(rules, input, mccmncId) {
  const result = {
    destination: input.destination || '',
    sender_id: input.sender_id || '',
    message: input.message || '',
  };

  if (!rules || !rules.length) return result;

  for (const t of rules) {
    switch (t.translation_type) {
      // ========== number_prefix ==========
      case 'number_prefix': {
        // Guard: Skip if the destination looks like an IPv4 address
        if (/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(result.destination)) {
          break;
        }
        let num = result.destination.replace(/^\+/, '');
        // If source_pattern is set (e.g. "88", "971", "91"), only strip if number starts with it
        if (t.source_pattern) {
          const pattern = String(t.source_pattern).replace(/^\+/, '');
          if (!num.startsWith(pattern)) break; // Skip — number doesn't match this country prefix
        }
        if (t.strip_prefix_digits > 0) {
          num = num.substring(t.strip_prefix_digits);
        }
        if (t.add_prefix_text) {
          num = t.add_prefix_text + num;
        }
        result.destination = num;
        break;
      }

      // ========== content_replace ==========
      case 'content_replace': {
        if (t.match_content && result.message) {
          // Always verify the match phrase exists in the message first
          const matchFound = result.message.toLowerCase().includes(t.match_content.toLowerCase());
          if (!matchFound) break; // Skip — match phrase not found
          
          if (t.is_otp_extract) {
            // OTP-aware replace: extract OTP, inject into template
            const min = t.otp_length_min || 4;
            const max = t.otp_length_max || 8;
            const re = new RegExp(`\\b(\\d{${min},${max}})\\b`, 'g');
            const matches = result.message.match(re);
            if (matches) {
              result.message = t.replace_content
                ? t.replace_content.replace(/\{\{OTP\}\}/g, matches[0])
                : matches[0];
            }
          } else {
            // Simple search & replace
            const escaped = t.match_content.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            result.message = result.message.replace(
              new RegExp(escaped, 'gi'),
              t.replace_content || ''
            );
          }
        }
        break;
      }

      // ========== otp_extract ==========
      case 'otp_extract': {
        if (result.message) {
          // Guard: if match_content is set, require it to be present before extracting OTP
          if (t.match_content) {
            const matchFound = result.message.toLowerCase().includes(t.match_content.toLowerCase());
            if (!matchFound) break;
          }
          let matches = null;
          // Prefer custom regex pattern (e.g., 'ABC-\\d{6}' for branded OTPs)
          // Uses exec() to support capture groups: 'ABC-(\\d{6})' extracts just digits
          if (t.otp_pattern) {
            try {
              const re = new RegExp(t.otp_pattern, 'g');
              const execResult = re.exec(result.message);
              if (execResult) {
                // Prefer first capture group if present, otherwise full match
                matches = [execResult[1] || execResult[0]];
              }
            } catch (e) {
              console.warn('Translation engine: invalid otp_pattern "' + t.otp_pattern + '" —', e.message);
            }
          }
          // Fallback: digit-length extraction
          if (!matches) {
            const min = t.otp_length_min || 4;
            const max = t.otp_length_max || 8;
            const re = new RegExp(`\\b(\\d{${min},${max}})\\b`, 'g');
            matches = result.message.match(re);
          }
          if (matches) {
            result.message = t.replace_content
              ? t.replace_content.replace(/\{\{OTP\}\}/g, matches[0])
              : matches[0];
          } else {
            // OTP extract rule active but no numeric code found.
            // Strict mode (default): block message — Voice OTP/HTTP suppliers need numeric codes.
            // Lenient mode (otp_strict_mode=false): forward original message unchanged.
            if (t.otp_strict_mode !== false) {
              result.blocked = true;
              result.block_reason = 'OTP_EXTRACT_FAILED: No numeric code found (expected ' + (t.otp_length_min || 4) + '-' + (t.otp_length_max || 8) + ' digits)';
            }
            // Lenient: leave message as-is, no blocking
          }
        }
        break;
      }

      // ========== sid_alias ==========
      case 'sid_alias': {
        if (t.source_pattern && result.sender_id) {
          const pattern = t.source_pattern.replace(/\*/g, '.*');
          const re = new RegExp('^' + pattern + '$', 'i');
          if (re.test(result.sender_id)) {
            result.sender_id = t.target_value || result.sender_id;
          }
        }
        break;
      }

      // ========== sid_random ==========
      case 'sid_random': {
        // Check if this rule targets specific MCCMNCs via mccmnc_list
        const hasMccmncList = t.mccmnc_list && Array.isArray(t.mccmnc_list) && t.mccmnc_list.length > 0;
        
        if (hasMccmncList) {
          // Rule targets specific MCCMNCs — only apply if destination MCCMNC matches
          if (mccmncId != null) {
            const mccmncIds = t.mccmnc_list.map(id => Number(id));
            if (mccmncIds.includes(Number(mccmncId))) {
              // Deterministic: use the first (and only) template as the assigned SID
              let templates = [];
              if (t.template_data && Array.isArray(t.template_data) && t.template_data.length > 0) {
                templates = t.template_data;
              } else if (t.target_value) {
                templates = t.target_value.split('|').map(s => s.trim()).filter(Boolean);
              }
              if (templates.length > 0) {
                result.sender_id = templates[0];
              }
            }
            // If mccmncId doesn't match, skip this rule (don't fall through to pool)
          }
          // If mccmncId is null (lookup failed), skip this rule entirely
          break;
        }
        
        // No MCCMNC targeting — random pool behavior (original)
        let templates = [];
        if (t.template_data && Array.isArray(t.template_data) && t.template_data.length > 0) {
          templates = t.template_data;
        } else if (t.target_value) {
          templates = t.target_value.split('|').map(s => s.trim()).filter(Boolean);
        }
        if (templates.length > 0) {
          result.sender_id = templates[Math.floor(Math.random() * templates.length)];
        }
        break;
      }

      // ========== random_content ==========
      case 'random_content': {
        // Match phrase guard: only fire if match_content is found in the message
        // Prevents rules without match patterns from hijacking ALL messages.
        if (t.match_content && result.message) {
          const matchFound = result.message.toLowerCase().includes(t.match_content.toLowerCase());
          if (!matchFound) break; // Skip — match phrase not found
        }
        let templates = [];
        if (t.template_data && Array.isArray(t.template_data) && t.template_data.length > 0) {
          templates = t.template_data;
        } else if (t.target_value) {
          templates = t.target_value.split('|').map(s => s.trim()).filter(Boolean);
        }
        if (templates.length > 0 && result.message) {
          const randomTmpl = templates[Math.floor(Math.random() * templates.length)];
          const min = t.otp_length_min || 4;
          const max = t.otp_length_max || 8;
          const re = new RegExp(`\\b(\\d{${min},${max}})\\b`, 'g');
          const matches = result.message.match(re);
          const otp = matches ? matches[0] : '';
          result.message = randomTmpl.replace(/\{\{OTP\}\}/g, otp || '');
        }
        break;
      }
    }
  }

  return result;
}

// ============================================================
// BLOCKING RULES — check if message should be rejected
// ============================================================

/**
 * Check blocking/filtering rules against an SMS message.
 * Returns the FIRST blocking rule that fires, or null if message passes all checks.
 * 
 * Rule types:
 *   number_blacklist — block destination numbers matching source_pattern (subtype: exact|prefix)
 *   keyword_blacklist — block messages containing any of the match_content keywords
 *   keyword_whitelist — allow ONLY messages containing match_content keywords (block everything else)
 *   url_block — block messages containing URLs (http://, https://, www., etc.)
 * 
 * @param {Array} rules - Active blocking rules sorted by priority ASC
 * @param {object} input - { destination, sender_id, message }
 * @returns {object|null} - { blocked: true, reason: string, ruleId: number, ruleName: string } or null
 */
function checkBlocks(rules, input) {
  if (!rules || !rules.length) return null;

  const dest = (input.destination || '').replace(/^\+/, '');
  const msg = input.message || '';

  for (const t of rules) {
    switch (t.translation_type) {
      // ========== number_blacklist ==========
      case 'number_blacklist': {
        const pattern = t.source_pattern || '';
        if (!pattern) break;
        const cleanPattern = pattern.replace(/^\+/, '');
        const mode = t.subtype || 'prefix'; // 'exact' or 'prefix'
        const blocked = mode === 'exact'
          ? dest === cleanPattern
          : dest.startsWith(cleanPattern);
        if (blocked) {
          console.error(`[BLOCKS] 🚫 ${t.name || 'rule'}: Number blacklist match — ${dest} matches ${pattern} (${mode})`);
          return { blocked: true, reason: `Number blacklisted: ${pattern}`, ruleId: t.id, ruleName: t.name || 'Number Blacklist' };
        }
        break;
      }

      // ========== keyword_blacklist ==========
      case 'keyword_blacklist': {
        const keywords = (t.match_content || '').toLowerCase();
        if (!keywords) break;
        const msgLower = msg.toLowerCase();
        // Support comma-separated keywords
        const keywordList = keywords.split(',').map(k => k.trim()).filter(Boolean);
        for (const kw of keywordList) {
          if (msgLower.includes(kw)) {
            console.error(`[BLOCKS] 🚫 ${t.name || 'rule'}: Keyword blacklist match — found "${kw}" in message`);
            return { blocked: true, reason: `Keyword blocked: "${kw}"`, ruleId: t.id, ruleName: t.name || 'Keyword Blacklist' };
          }
        }
        break;
      }

      // ========== keyword_whitelist ==========
      case 'keyword_whitelist': {
        const keywords = (t.match_content || '').toLowerCase();
        if (!keywords) break;
        const msgLower = msg.toLowerCase();
        const keywordList = keywords.split(',').map(k => k.trim()).filter(Boolean);
        // At least one keyword must be present
        const found = keywordList.some(kw => msgLower.includes(kw));
        if (!found) {
          console.error(`[BLOCKS] 🚫 ${t.name || 'rule'}: Keyword whitelist — no allowed keyword found in message`);
          return { blocked: true, reason: `No whitelisted keyword found`, ruleId: t.id, ruleName: t.name || 'Keyword Whitelist' };
        }
        break;
      }

      // ========== url_block ==========
      case 'url_block': {
        if (!msg) break;
        // Detect URLs: http://, https://, www., URL shorteners, or domain-like patterns
        const urlPattern = /(https?:\/\/[^\s]+|www\.[^\s]+|\b[a-z0-9][-a-z0-9]*\.(com|net|org|io|co|biz|info|me|xyz|tk|ml|ga|cf|gq|top|online|site|shop|store|click|link|ly|gl|gg|app|dev|page|blog|news|win|live|world|today|media|network|digital|center|support|email|company|solutions|systems|technology|consulting)[^\s]*\b)/i;
        if (urlPattern.test(msg)) {
          console.error(`[BLOCKS] 🚫 ${t.name || 'rule'}: URL detected in message`);
          return { blocked: true, reason: 'URL detected in message', ruleId: t.id, ruleName: t.name || 'URL Block' };
        }
        break;
      }
    }
  }

  return null; // All checks passed
}

module.exports = { applyRules, checkBlocks };
