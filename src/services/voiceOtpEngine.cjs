// ============================================================================
// VOICE OTP ENGINE — Complete Pipeline
// ============================================================================
// Pipeline:
//   SMS Body → Extract OTP digits → Resolve country/language → Build audio →
//   Asterisk SIP originate → Call result → Retry engine → Force DLR → Billing
// ============================================================================

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Lazy-loaded: asterisk bridge module
let asteriskBridge = null;
try { asteriskBridge = require('../../asterisk-bridge.cjs'); } catch (e) {
    console.error('[VoiceOTP] Asterisk bridge not available — all calls will be simulated:', e.message);
}

// ============================================================================
// 1. OTP DIGIT EXTRACTION
// ============================================================================

/**
 * Extract OTP digits from SMS body text.
 * 
 * Strategy (per user's confirmed decision):
 *   - If client has otp_extraction_pattern (regex), use it with capture group 1
 *   - Otherwise: find ALL digit sequences, use the longest one (most likely OTP)
 *   - Fallback: generate random 6-digit OTP
 * 
 * @param {string} message - SMS body text
 * @param {string} pattern - Optional regex pattern from client config
 * @returns {{ otp: string, method: string }}
 */
function extractOtpDigits(message, pattern) {
    if (!message) return { otp: generateRandomOtp(6), method: 'generated' };
    
    // If client has a custom extraction pattern, use it
    if (pattern && pattern.trim()) {
        try {
            const regex = new RegExp(pattern, 'i');
            const match = message.match(regex);
            if (match) {
                const captured = match[1] || match[0];
                const digits = captured.replace(/\D/g, '');
                if (digits.length >= 4 && digits.length <= 10) {
                    return { otp: digits, method: 'pattern' };
                }
            }
        } catch (e) { /* invalid regex — fall through */ }
    }
    
    // Strategy: find ALL digit sequences, prefer the longest one
    const sequences = message.match(/\d+/g) || [];
    if (sequences.length === 0) {
        return { otp: generateRandomOtp(6), method: 'generated' };
    }
    
    // Filter to plausible OTP lengths (4-10 digits), sort by length desc
    const plausible = sequences
        .filter(s => s.length >= 4 && s.length <= 10)
        .sort((a, b) => b.length - a.length);
    
    if (plausible.length > 0) {
        return { otp: plausible[0], method: 'longest_sequence' };
    }
    
    // If no plausible sequence found, take the longest overall
    sequences.sort((a, b) => b.length - a.length);
    return { otp: sequences[0], method: 'longest_sequence' };
}

function generateRandomOtp(length) {
    return Array.from({ length }, () => Math.floor(Math.random() * 10)).join('');
}

// ============================================================================
// 2. COUNTRY → LANGUAGE RESOLUTION
// ============================================================================

/**
 * Country code → primary language mapping.
 * Used when no voice_otp_config matches by prefix.
 */
const COUNTRY_LANGUAGE_MAP = {
    '1':   'en-US',    // USA/Canada
    '7':   'ru-RU',    // Russia
    '20':  'ar-EG',    // Egypt
    '27':  'en-ZA',    // South Africa
    '30':  'el-GR',    // Greece
    '31':  'nl-NL',    // Netherlands
    '32':  'nl-BE',    // Belgium
    '33':  'fr-FR',    // France
    '34':  'es-ES',    // Spain
    '36':  'hu-HU',    // Hungary
    '39':  'it-IT',    // Italy
    '40':  'ro-RO',    // Romania
    '41':  'de-CH',    // Switzerland
    '43':  'de-AT',    // Austria
    '44':  'en-GB',    // UK
    '45':  'da-DK',    // Denmark
    '46':  'sv-SE',    // Sweden
    '47':  'no-NO',    // Norway
    '48':  'pl-PL',    // Poland
    '49':  'de-DE',    // Germany
    '51':  'es-PE',    // Peru
    '52':  'es-MX',    // Mexico
    '54':  'es-AR',    // Argentina
    '55':  'pt-BR',    // Brazil
    '56':  'es-CL',    // Chile
    '57':  'es-CO',    // Colombia
    '58':  'es-VE',    // Venezuela
    '60':  'ms-MY',    // Malaysia
    '61':  'en-AU',    // Australia
    '62':  'id-ID',    // Indonesia
    '63':  'fil-PH',   // Philippines
    '64':  'en-NZ',    // New Zealand
    '65':  'en-SG',    // Singapore
    '66':  'th-TH',    // Thailand
    '81':  'ja-JP',    // Japan
    '82':  'ko-KR',    // South Korea
    '84':  'vi-VN',    // Vietnam
    '86':  'zh-CN',    // China
    '90':  'tr-TR',    // Turkey
    '91':  'hi-IN',    // India
    '92':  'ur-PK',    // Pakistan
    '93':  'fa-AF',    // Afghanistan
    '94':  'si-LK',    // Sri Lanka
    '95':  'my-MM',    // Myanmar
    '98':  'fa-IR',    // Iran
    '212': 'ar-MA',    // Morocco
    '213': 'ar-DZ',    // Algeria
    '216': 'ar-TN',    // Tunisia
    '218': 'ar-LY',    // Libya
    '220': 'en-GM',    // Gambia
    '221': 'fr-SN',    // Senegal
    '222': 'ar-MR',    // Mauritania
    '223': 'fr-ML',    // Mali
    '224': 'fr-GN',    // Guinea
    '225': 'fr-CI',    // Ivory Coast
    '226': 'fr-BF',    // Burkina Faso
    '227': 'fr-NE',    // Niger
    '228': 'fr-TG',    // Togo
    '229': 'fr-BJ',    // Benin
    '230': 'en-MU',    // Mauritius
    '231': 'en-LR',    // Liberia
    '232': 'en-SL',    // Sierra Leone
    '233': 'en-GH',    // Ghana
    '234': 'en-NG',    // Nigeria
    '235': 'fr-TD',    // Chad
    '236': 'fr-CF',    // Central African Republic
    '237': 'fr-CM',    // Cameroon
    '238': 'pt-CV',    // Cape Verde
    '239': 'pt-ST',    // Sao Tome
    '240': 'es-GQ',    // Equatorial Guinea
    '241': 'fr-GA',    // Gabon
    '242': 'fr-CG',    // Congo
    '243': 'fr-CD',    // DRC
    '244': 'pt-AO',    // Angola
    '245': 'pt-GW',    // Guinea-Bissau
    '246': 'en-IO',    // British Indian Ocean
    '247': 'en-AC',    // Ascension
    '248': 'fr-SC',    // Seychelles
    '249': 'ar-SD',    // Sudan
    '250': 'rw-RW',    // Rwanda
    '251': 'am-ET',    // Ethiopia
    '252': 'so-SO',    // Somalia
    '253': 'fr-DJ',    // Djibouti
    '254': 'sw-KE',    // Kenya
    '255': 'sw-TZ',    // Tanzania
    '256': 'en-UG',    // Uganda
    '257': 'fr-BI',    // Burundi
    '258': 'pt-MZ',    // Mozambique
    '260': 'en-ZM',    // Zambia
    '261': 'mg-MG',    // Madagascar
    '262': 'fr-RE',    // Reunion
    '263': 'en-ZW',    // Zimbabwe
    '264': 'en-NA',    // Namibia
    '265': 'en-MW',    // Malawi
    '266': 'en-LS',    // Lesotho
    '267': 'en-BW',    // Botswana
    '268': 'en-SZ',    // Eswatini
    '269': 'fr-KM',    // Comoros
    '290': 'en-SH',    // St Helena
    '291': 'ti-ER',    // Eritrea
    '297': 'nl-AW',    // Aruba
    '298': 'fo-FO',    // Faroe Islands
    '299': 'kl-GL',    // Greenland
    '350': 'en-GI',    // Gibraltar
    '351': 'pt-PT',    // Portugal
    '352': 'fr-LU',    // Luxembourg
    '353': 'en-IE',    // Ireland
    '354': 'is-IS',    // Iceland
    '355': 'sq-AL',    // Albania
    '356': 'mt-MT',    // Malta
    '357': 'el-CY',    // Cyprus
    '358': 'fi-FI',    // Finland
    '359': 'bg-BG',    // Bulgaria
    '370': 'lt-LT',    // Lithuania
    '371': 'lv-LV',    // Latvia
    '372': 'et-EE',    // Estonia
    '373': 'ro-MD',    // Moldova
    '374': 'hy-AM',    // Armenia
    '375': 'be-BY',    // Belarus
    '376': 'ca-AD',    // Andorra
    '377': 'fr-MC',    // Monaco
    '378': 'it-SM',    // San Marino
    '380': 'uk-UA',    // Ukraine
    '381': 'sr-RS',    // Serbia
    '382': 'sr-ME',    // Montenegro
    '383': 'sq-XK',    // Kosovo
    '385': 'hr-HR',    // Croatia
    '386': 'sl-SI',    // Slovenia
    '387': 'bs-BA',    // Bosnia
    '389': 'mk-MK',    // North Macedonia
    '420': 'cs-CZ',    // Czech Republic
    '421': 'sk-SK',    // Slovakia
    '423': 'de-LI',    // Liechtenstein
    '500': 'en-FK',    // Falkland Islands
    '501': 'en-BZ',    // Belize
    '502': 'es-GT',    // Guatemala
    '503': 'es-SV',    // El Salvador
    '504': 'es-HN',    // Honduras
    '505': 'es-NI',    // Nicaragua
    '506': 'es-CR',    // Costa Rica
    '507': 'es-PA',    // Panama
    '508': 'fr-PM',    // St Pierre & Miquelon
    '509': 'ht-HT',    // Haiti
    '590': 'fr-GP',    // Guadeloupe
    '591': 'es-BO',    // Bolivia
    '592': 'en-GY',    // Guyana
    '593': 'es-EC',    // Ecuador
    '594': 'fr-GF',    // French Guiana
    '595': 'es-PY',    // Paraguay
    '596': 'fr-MQ',    // Martinique
    '597': 'nl-SR',    // Suriname
    '598': 'es-UY',    // Uruguay
    '599': 'nl-CW',    // Curacao
    '670': 'pt-TL',    // East Timor
    '672': 'en-AQ',    // Antarctica
    '673': 'ms-BN',    // Brunei
    '674': 'en-NR',    // Nauru
    '675': 'en-PG',    // Papua New Guinea
    '676': 'en-TO',    // Tonga
    '677': 'en-SB',    // Solomon Islands
    '678': 'en-VU',    // Vanuatu
    '679': 'en-FJ',    // Fiji
    '680': 'en-PW',    // Palau
    '681': 'fr-WF',    // Wallis & Futuna
    '682': 'en-CK',    // Cook Islands
    '683': 'en-NU',    // Niue
    '685': 'en-WS',    // Samoa
    '686': 'en-KI',    // Kiribati
    '687': 'fr-NC',    // New Caledonia
    '688': 'en-TV',    // Tuvalu
    '689': 'fr-PF',    // French Polynesia
    '690': 'en-TK',    // Tokelau
    '691': 'en-FM',    // Micronesia
    '692': 'en-MH',    // Marshall Islands
    '850': 'ko-KP',    // North Korea
    '852': 'zh-HK',    // Hong Kong
    '853': 'zh-MO',    // Macau
    '855': 'km-KH',    // Cambodia
    '856': 'lo-LA',    // Laos
    '880': 'bn-BD',    // Bangladesh
    '886': 'zh-TW',    // Taiwan
    '960': 'dv-MV',    // Maldives
    '961': 'ar-LB',    // Lebanon
    '962': 'ar-JO',    // Jordan
    '963': 'ar-SY',    // Syria
    '964': 'ar-IQ',    // Iraq
    '965': 'ar-KW',    // Kuwait
    '966': 'ar-SA',    // Saudi Arabia
    '967': 'ar-YE',    // Yemen
    '968': 'ar-OM',    // Oman
    '970': 'ar-PS',    // Palestine
    '971': 'ar-AE',    // UAE
    '972': 'he-IL',    // Israel
    '973': 'ar-BH',    // Bahrain
    '974': 'ar-QA',    // Qatar
    '975': 'dz-BT',    // Bhutan
    '976': 'mn-MN',    // Mongolia
    '977': 'ne-NP',    // Nepal
    '992': 'tg-TJ',    // Tajikistan
    '993': 'tk-TM',    // Turkmenistan
    '994': 'az-AZ',    // Azerbaijan
    '995': 'ka-GE',    // Georgia
    '996': 'ky-KG',    // Kyrgyzstan
    '998': 'uz-UZ',    // Uzbekistan
};

/**
 * Resolve country prefix → language code.
 * Attempts to match longest prefix first.
 * @param {string} destination - E.164 number (e.g. +8801712345678)
 * @returns {{ countryPrefix: string, languageCode: string }}
 */
function resolveCountryLanguage(destination) {
    const cleaned = destination.replace(/^\+/, '');
    
    // Try longest prefix match first
    const prefixes = Object.keys(COUNTRY_LANGUAGE_MAP).sort((a, b) => b.length - a.length);
    for (const prefix of prefixes) {
        if (cleaned.startsWith(prefix)) {
            return { countryPrefix: prefix, languageCode: COUNTRY_LANGUAGE_MAP[prefix] };
        }
    }
    
    return { countryPrefix: '', languageCode: 'en-US' };
}

/**
 * Find the best-matching voice_otp_config for a destination.
 * @param {object} pool - PostgreSQL pool
 * @param {string} destination - E.164 number
 * @param {string} defaultLanguageCode - fallback language
 * @returns {Promise<object>} voice_otp_config row
 */
async function resolveVoiceOtpConfig(pool, destination, defaultLanguageCode) {
    const cleaned = destination.replace(/^\+/, '');
    
    // 1. Try exact country prefix match
    let result = await pool.query(
        `SELECT * FROM voice_otp_configs 
         WHERE is_active = true AND country_prefix != '' AND $1 LIKE country_prefix || '%'
         ORDER BY LENGTH(country_prefix) DESC LIMIT 1`,
        [cleaned]
    );
    
    if (result.rows.length > 0) return result.rows[0];
    
    // 2. Try language code match
    result = await pool.query(
        `SELECT * FROM voice_otp_configs 
         WHERE is_active = true AND primary_language_code = $1 LIMIT 1`,
        [defaultLanguageCode]
    );
    
    if (result.rows.length > 0) return result.rows[0];
    
    // 3. Fallback to first active config
    result = await pool.query(
        `SELECT * FROM voice_otp_configs 
         WHERE is_active = true ORDER BY id LIMIT 1`
    );
    
    return result.rows[0] || null;
}

// ============================================================================
// 3. AUDIO BUILD (Concatenation)
// ============================================================================

/**
 * Build the audio sequence for a Voice OTP call.
 * Returns an array of audio paths/descriptions in playback order.
 * 
 * Sequence:
 *   [greeting] + [digits 0..9] + [retry]
 * 
 * When useSecondaryLanguage=false → primary language audio
 * When useSecondaryLanguage=true  → secondary language audio (falls back to primary if none)
 * 
 * @param {object} config - voice_otp_configs row
 * @param {string} otpCode - OTP digits to speak
 * @param {number} playCount - repeat count (1-3)
 * @param {boolean} useSecondaryLanguage - whether to use secondary language audio
 * @returns {{ audio: string[], repeat: number, language: string, usedSecondary: boolean }}
 */
function buildAudioSequence(config, otpCode, playCount, useSecondaryLanguage) {
    const digits = otpCode.split('');
    const audio = [];
    const audioDir = path.join(__dirname, '..', '..', 'data', 'uploads', 'audio');
    
    const primaryLang = config.primary_language_code || config.language_code || 'en-US';
    const secondaryLang = config.secondary_language_code || primaryLang;
    const hasSecondaryConfig = !!(config.secondary_greeting_audio_url || (config.audio_0_9_secondary && Object.keys(typeof config.audio_0_9_secondary === 'string' ? JSON.parse(config.audio_0_9_secondary) : (config.audio_0_9_secondary || {})).length > 0));
    
    // Determine which language to use
    const useSecondary = useSecondaryLanguage && (secondaryLang !== primaryLang || hasSecondaryConfig);
    const lang = useSecondary ? secondaryLang : primaryLang;
    
    // Greeting — pick the right one
    const greeting = useSecondary
        ? (config.secondary_greeting_audio_url || config.greeting_audio_url || path.join(audioDir, lang, 'greeting.wav'))
        : (config.greeting_audio_url || path.join(audioDir, lang, 'greeting.wav'));
    audio.push(greeting);
    
    // Helper: parse JSONB safely
    const parseJson = (raw) => {
        if (!raw) return {};
        return typeof raw === 'string' ? JSON.parse(raw) : raw;
    };
    
    // Digits 0-9 — MERGE primary/secondary layer with legacy audio_0_9
    // Uploaded data URLs take priority over legacy disk paths for same digit
    const legacyMap = parseJson(config.audio_0_9);
    const primaryUploadMap = parseJson(config.audio_0_9_primary);
    const secondaryUploadMap = parseJson(config.audio_0_9_secondary);
    
    // Build effective map: legacy < primary-upload < secondary-upload
    let effectiveDigitMap;
    if (useSecondary) {
        // Secondary: merge legacy + primary + secondary, with secondary on top
        effectiveDigitMap = { ...legacyMap, ...primaryUploadMap, ...secondaryUploadMap };
    } else {
        // Primary: merge legacy + primary
        effectiveDigitMap = { ...legacyMap, ...primaryUploadMap };
    }
    
    for (const digit of digits) {
        if (effectiveDigitMap[digit]) {
            audio.push(effectiveDigitMap[digit]);
        } else {
            audio.push(path.join(audioDir, lang, `${digit}.wav`));
        }
    }
    
    // Retry text
    const retryText = useSecondary ? (config.secondary_retry_text || config.retry_text) : (config.primary_retry_text || config.retry_text);
    if (retryText) {
        audio.push(greeting);
    }
    
    return {
        audio,
        repeat: playCount || 1,
        language: lang,
        usedSecondary: useSecondary,
    };
}

/**
 * Concatenate WAV files into a single buffer.
 * Simple header-stripping concatenation for PCM WAV files.
 * Falls back to generating a list of files for Asterisk to play sequentially.
 * 
 * @param {string[]} filePaths - ordered list of WAV file paths
 * @returns {{ buffer: Buffer|null, filePaths: string[] }}
 */
function concatenateWavFiles(filePaths) {
    const allData = [];
    let sampleRate = 8000;
    let bitsPerSample = 16;
    let channels = 1;
    let totalDataSize = 0;
    
    for (const fp of filePaths) {
        try {
            if (!fs.existsSync(fp)) continue;
            const data = fs.readFileSync(fp);
            
            // Parse WAV header
            if (data.length >= 44 && data.toString('ascii', 0, 4) === 'RIFF') {
                const dataSize = data.readUInt32LE(40);
                const audioData = data.subarray(44, 44 + dataSize);
                allData.push(audioData);
                totalDataSize += audioData.length;
            }
        } catch (e) {
            // Skip missing files — Asterisk will handle gaps
        }
    }
    
    if (allData.length === 0) return { buffer: null, filePaths };
    if (allData.length === 1) return { buffer: Buffer.concat(allData), filePaths };
    
    // Build WAV header for concatenated data
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + totalDataSize, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);          // fmt chunk size
    header.writeUInt16LE(1, 20);           // PCM format
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28);
    header.writeUInt16LE(channels * (bitsPerSample / 8), 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write('data', 36);
    header.writeUInt32LE(totalDataSize, 40);
    
    const concatenated = Buffer.concat([header, ...allData]);
    return { buffer: concatenated, filePaths };
}

// ============================================================================
// 4. ASTERISK SIP ORIGINATE
// ============================================================================

/**
 * Originate a Voice OTP call via Asterisk AMI.
 * 
 * @param {object} pool - PostgreSQL pool
 * @param {object} options
 * @param {string} options.callId - unique call ID
 * @param {string} options.destination - called number (E.164)
 * @param {string} options.otpCode - OTP digits
 * @param {object} options.supplier - supplier row (has dst_sip_address, audio_codec)
 * @param {object} options.config - voice_otp_configs row
 * @param {number} options.playCount - repeat count
 * @param {number} options.timeout - call timeout ms
 * @returns {Promise<{status:string, dlr:string, duration:number, error?:string}>}
 */
async function originateCall(pool, options) {
    const { callId, destination, otpCode, supplier, config, playCount, timeout = 45000, useSecondaryLanguage = false } = options;
    
    // Build audio sequence FIRST — so language info is available even in error paths
    const audioSeq = buildAudioSequence(config, otpCode, playCount, useSecondaryLanguage);
    
    // Parse supplier SIP address
    const sipAddr = parseSipAddress(supplier.dst_sip_address || '');
    if (!sipAddr) {
        return { status: 'failed', dlr: 'FAILED', duration: 0,
                 error: 'No SIP address configured for supplier',
                 language: audioSeq.language,
                 usedSecondary: audioSeq.usedSecondary };
    }
    
    // If asterisk bridge is available, use it
    if (asteriskBridge && typeof asteriskBridge.originateCall === 'function') {
        try {
            const digitMap = buildDigitAudioMap(audioSeq);
            const result = await asteriskBridge.originateCall({
                callId,
                destination,
                sipHost: sipAddr.host,
                sipPort: sipAddr.port,
                sipUsername: supplier.smpp_username || '',
                sipPassword: supplier.smpp_password || '',
                callerId: config.caller_id || otpCode,
                greetingAudio: audioSeq.audio[0] || null,
                digitAudio: digitMap,       // key-value map for backward compat
                audioFiles: audioSeq.audio, // flat array for sequential playback
                otpCode,
                language: audioSeq.language,
                timeout,
            });
            
            return {
                status: result.status || 'completed',
                dlr: result.dlr || 'DELIVRD',
                duration: result.duration || 0,
                language: audioSeq.language,
                usedSecondary: audioSeq.usedSecondary,
            };
        } catch (e) {
            return { status: 'failed', dlr: 'FAILED', duration: 0,
                     error: e.message,
                     language: audioSeq.language,
                     usedSecondary: audioSeq.usedSecondary };
        }
    }
    
    // Fallback: simulate call (for testing without Asterisk)
    const simResult = simulateCall(callId, destination, otpCode, playCount);
    return { ...simResult, language: audioSeq.language, usedSecondary: audioSeq.usedSecondary };
}

function parseSipAddress(addr) {
    if (!addr) return null;
    const parts = addr.split(':');
    return {
        host: parts[0] || '127.0.0.1',
        port: parseInt(parts[1]) || 5060,
    };
}

function buildDigitAudioMap(audioSeq) {
    // audioSeq.audio is a flat array: [greeting, digit0, digit1, ..., digit9]
    // Build a key-value map for codec-agnostic playback
    const map = {};
    if (!audioSeq || !audioSeq.audio || !Array.isArray(audioSeq.audio)) return map;
    // First element is greeting, skip it (already passed separately)
    for (let i = 0; i < 10; i++) {
        const idx = i + 1; // +1 to skip greeting
        if (idx < audioSeq.audio.length) {
            map[String(i)] = audioSeq.audio[idx];
        }
    }
    // Also provide the full sequence for sequential playback
    map['_sequence'] = audioSeq.audio;
    map['_language'] = audioSeq.language || 'unknown';
    return map;
}

function simulateCall(callId, destination, otpCode, playCount) {
    const baseDuration = playCount * 12000; // ~12s per play_count
    const duration = baseDuration + Math.floor(Math.random() * 3000);
    const success = Math.random() > 0.25; // 75% success rate
    
    return {
        status: success ? 'answered' : 'failed',
        dlr: success ? 'DELIVRD' : 'FAILED',
        duration,
        simulated: true,
    };
}

// ============================================================================
// 5. RETRY ENGINE (reconnect_schedule)
// ============================================================================

/**
 * Parse reconnect_schedule into delay intervals.
 * Format: "0,1,2" = immediate, +1 minute, +2 minutes after previous
 * Returns array of delays in milliseconds.
 * 
 * @param {string} schedule - comma-separated minute delays
 * @param {number} maxRetries - max total attempts
 * @returns {number[]} delays in ms
 */
function parseReconnectSchedule(schedule, maxRetries) {
    if (!schedule || schedule === '0,1,2') {
        // Default schedule
        return [0, 60000, 120000].slice(0, maxRetries || 3);
    }
    
    try {
        const delays = schedule.split(',').map(s => parseInt(s.trim()) * 60000);
        const filtered = delays.filter(d => !isNaN(d) && d >= 0);
        if (filtered.length === 0) return [0, 60000, 120000].slice(0, maxRetries || 3);
        return filtered.slice(0, maxRetries || filtered.length);
    } catch (e) {
        return [0, 60000, 120000].slice(0, maxRetries || 3);
    }
}

/**
 * Execute a Voice OTP call with retry logic.
 * 
 * @param {object} pool - PostgreSQL pool
 * @param {object} options - originateCall options + retry config
 * @param {object} options.supplier - supplier row with reconnect_schedule, max_retries
 * @returns {Promise<{finalStatus:string, finalDlr:string, attempts:number, totalDuration:number}>}
 */
async function executeWithRetry(pool, options) {
    const { supplier, config } = options;
    // max_retries: supplier > config.retry_count > default 3
    const maxRetries = supplier.max_retries
        ?? (config?.retry_count)
        ?? 3;
    // reconnect_schedule: supplier > config > default '0,1,2'
    const reconnectSchedule = supplier.reconnect_schedule
        ?? (config?.reconnect_schedule)
        ?? '0,1,2';
    const schedule = parseReconnectSchedule(reconnectSchedule, maxRetries);
    const reconnectTrace = [];
    let totalDuration = 0;
    
    // Determine if secondary language is available
    const secondaryLang = (config && config.secondary_language_code) || '';
    const primaryLang = (config && config.primary_language_code) || (config && config.language_code) || 'en-US';
    const hasSecondary = secondaryLang && secondaryLang !== primaryLang;
    
    for (let attempt = 0; attempt < schedule.length; attempt++) {
        // Wait for the scheduled delay before this attempt
        if (attempt > 0 && schedule[attempt] > 0) {
            await new Promise(resolve => setTimeout(resolve, schedule[attempt]));
        }
        
        // --- Language switching on retry ---
        // Attempt 0 → primary language
        // Attempt 1 → secondary language (if available)
        // Attempt 2 → primary language again
        // Attempt 3 → secondary language again
        const useSecondaryLanguage = hasSecondary && (attempt % 2 === 1);
        
        // Update log: retrying with language info
        if (attempt > 0) {
            const langLabel = useSecondaryLanguage ? `secondary(${secondaryLang})` : `primary(${primaryLang})`;
            await pool.query(
                `UPDATE voice_otp_logs SET status = 'retrying', retry_count = $1, 
                 language = $2, reconnect_trace = array_append(reconnect_trace, $3)
                 WHERE call_id = $4`,
                [attempt, langLabel, `${new Date().toISOString()}:retry_${attempt}:lang=${langLabel}`, options.callId]
            ).catch(() => {});
        }
        
        // Attempt the call with the selected language
        const callOpts = { ...options, useSecondaryLanguage };
        const result = await originateCall(pool, callOpts);
        totalDuration += result.duration || 0;
        const langTag = useSecondaryLanguage ? 'sec' : 'pri';
        reconnectTrace.push(`${new Date().toISOString()}:attempt_${attempt + 1}:${langTag}:${result.dlr}`);
        
        if (result.dlr === 'DELIVRD' || result.status === 'answered' || result.status === 'completed') {
            // Success! Return the language that worked
            return {
                finalStatus: 'completed',
                finalDlr: 'DELIVRD',
                attempts: attempt + 1,
                totalDuration,
                reconnectTrace,
                language: result.language || (useSecondaryLanguage ? secondaryLang : primaryLang),
                usedSecondary: result.usedSecondary || useSecondaryLanguage,
            };
        }
        
        // Log failed attempt
        await pool.query(
            `UPDATE voice_otp_logs SET reconnect_trace = $1 WHERE call_id = $2`,
            [reconnectTrace, options.callId]
        ).catch(() => {});
    }
    
    // All retries exhausted
    const lastUsedSecondary = hasSecondary && ((schedule.length - 1) % 2 === 1);
    return {
        finalStatus: 'failed',
        finalDlr: 'FAILED',
        attempts: schedule.length,
        totalDuration,
        reconnectTrace,
        language: lastUsedSecondary ? secondaryLang : primaryLang,
        usedSecondary: lastUsedSecondary,
    };
}

// ============================================================================
// 6. FORCE DLR SPLIT TRACKING
// ============================================================================

/**
 * Apply Force DLR logic: client-facing status vs internal billing.
 * 
 * If force_dlr_override is true:
 *   - client sees "Delivered" regardless of actual outcome
 *   - internal billing/CDR records the TRUE outcome and cost
 *   - voice_otp_logs.force_dlr_applied = true
 *   - voice_otp_logs.dlr_status_internal = real outcome
 *   - voice_otp_logs.dlr_status = 'DELIVRD' (client-facing)
 * 
 * @param {object} pool - PostgreSQL pool
 * @param {object} log - voice_otp_logs row
 * @param {boolean} forceDlrOverride - client's force_dlr_override setting
 * @param {string} realDlr - the actual DLR status
 */
async function applyForceDlr(pool, log, forceDlrOverride, realDlr) {
    if (!forceDlrOverride) {
        // No override — both client and internal see the same status
        return { clientDlr: realDlr, internalDlr: realDlr, applied: false };
    }
    
    // Split tracking: override client-facing, preserve internal truth
    await pool.query(
        `UPDATE voice_otp_logs 
         SET dlr_status = 'DELIVRD', 
             force_dlr_applied = true
         WHERE call_id = $1`,
        [log.call_id || log.id]
    ).catch(() => {});
    
    return { clientDlr: 'DELIVRD', internalDlr: realDlr, applied: true };
}

// ============================================================================
// 7. FULL PIPELINE: SMS → Voice OTP
// ============================================================================

/**
 * Execute the complete Voice OTP pipeline from an SMS message.
 * This is the main entry point called by the SMS routing engine.
 * 
 * @param {object} pool - PostgreSQL pool
 * @param {object} ctx - pipeline context
 * @param {object} ctx.client - client row
 * @param {object} ctx.supplier - supplier row (connection_type=voice_otp)
 * @param {string} ctx.destination - called number (E.164)
 * @param {string} ctx.message - SMS body text
 * @param {string} ctx.messageId - SMS log message_id for correlation
 * @returns {Promise<{callId:string, otpCode:string, dlr:string, duration:number}>}
 */
async function executeVoiceOtpPipeline(pool, ctx) {
    const { client, supplier, destination, message, messageId, configId } = ctx;
    
    // 1. Extract OTP digits
    const { otp, method } = extractOtpDigits(message, client.otp_extraction_pattern);
    
    // 2. Resolve language and config
    // Priority: explicit configId (manual override) > auto-resolution by prefix/language
    let config = null;
    if (configId) {
        const cfgResult = await pool.query(
            'SELECT * FROM voice_otp_configs WHERE id = $1 AND is_active = true LIMIT 1',
            [configId]
        );
        config = cfgResult.rows[0] || null;
        if (config) {
            console.log(`[VoiceOTP] Using explicit config #${configId}: ${config.language}`);
        }
    }
    
    if (!config) {
        const { languageCode } = resolveCountryLanguage(destination);
        config = await resolveVoiceOtpConfig(pool, destination, languageCode);
    }
    
    // 2b. Apply voice_otp_mode overrides (supplier-level dynamic behavior)
    // One config per country — the mode dynamically adjusts play_count and language switching.
    // This avoids needing 3+ duplicate config rows per country.
    const voiceOtpMode = supplier.voice_otp_mode || null;
    if (config && voiceOtpMode) {
        if (voiceOtpMode === 'local_1x') {
            config = { ...config, play_count: 1, secondary_language_code: config.primary_language_code };
        } else if (voiceOtpMode === 'local_2x') {
            config = { ...config, play_count: 2, secondary_language_code: config.primary_language_code };
        } else if (voiceOtpMode === 'local_international') {
            config = { ...config, play_count: config.play_count || 1, secondary_language_code: 'en-US' };
        }
        console.log(`[VoiceOTP] Mode '${voiceOtpMode}' applied: play_count=${config.play_count}, secondary=${config.secondary_language_code}`);
    }
    
    // 3. Determine play count (client-level > mode-override > config-level > default 1)
    const playCount = client.play_count || (config ? config.play_count : 1) || 1;
    
    // 4. Build call ID
    const callId = `VOICE_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    
    // 5. Insert voice_otp_logs entry (status=sent as soon as handed to engine)
    // max_retries: supplier > config.retry_count > default 3
    const effectiveMaxRetries = supplier.max_retries
        ?? (config?.retry_count)
        ?? 3;
    await pool.query(
        `INSERT INTO voice_otp_logs 
         (call_id, destination, otp_code, extracted_otp, language, status, dlr_status,
          retry_count, max_retries, client_id, supplier_id, channel,
          reconnect_trace, created_at)
         VALUES ($1,$2,$3,$4,$5,'sent','SENT',0,$6,$7,$8,'voice_otp','{}',NOW())`,
        [callId, destination, otp, otp, config ? config.language_code : languageCode,
         effectiveMaxRetries, client.id, supplier.id]
    );
    
    // 6. Update sms_logs: mark as sent via voice_otp
    await pool.query(
        `UPDATE sms_logs SET status = 'sent', channel = 'voice_otp',
         supplier_id = $1, supplier_code = $2
         WHERE message_id = $3`,
        [supplier.id, supplier.supplier_code, messageId]
    ).catch(() => {});
    
    // 7. Execute call with retry
    const result = await executeWithRetry(pool, {
        callId,
        destination,
        otpCode: otp,
        supplier,
        config,
        playCount,
        timeout: playCount * 15000, // scale timeout with play_count
    });
    
    // 8. Update voice_otp_logs with final result
    const duration = result.totalDuration || 0;
    const realDlr = result.finalDlr || 'FAILED';
    
    // Calculate costs
    const supplierRatePerSec = supplier.rate_per_second || 0;
    const totalCost = (duration / 1000) * supplierRatePerSec;
    
    await pool.query(
        `UPDATE voice_otp_logs 
         SET status = $1, dlr_status = $2, duration = $3, 
             reconnect_trace = $4, retry_count = $5,
             total_cost = $6, completed_at = NOW()
         WHERE call_id = $7`,
        [result.finalStatus, realDlr, duration,
         result.reconnectTrace || [], result.attempts || 0,
         totalCost, callId]
    );
    
    // 9. Apply Force DLR if enabled
    const forceDlr = await applyForceDlr(
        pool,
        { id: callId }, // voice_otp_logs reference
        client.force_dlr_override || false,
        realDlr
    );
    
    // 10. Update sms_logs with final delivery status
    const clientFacingDlr = forceDlr.applied ? forceDlr.clientDlr : realDlr;
    await pool.query(
        `UPDATE sms_logs 
         SET status = $1, dlr_status = $2, delivery_time = NOW(),
             is_force_dlr = $3
         WHERE message_id = $4`,
        [clientFacingDlr === 'DELIVRD' ? 'delivered' : 'failed',
         clientFacingDlr, forceDlr.applied, messageId]
    );
    
    // 11. Trigger client DLR callback if webhook configured
    if (client.dlr_callback_url) {
        sendDlrCallback(client.dlr_callback_url, {
            message_id: messageId,
            destination,
            status: clientFacingDlr,
            dlr_status: clientFacingDlr,
            channel: 'voice_otp',
            duration_ms: duration,
            call_id: callId,
            timestamp: new Date().toISOString(),
        }).catch(() => {}); // fire-and-forget
    }
    
    return {
        callId,
        otpCode: otp,
        dlr: clientFacingDlr,
        duration,
        attempts: result.attempts,
        forceDlrApplied: forceDlr.applied,
    };
}

// ============================================================================
// 8. DLR CALLBACK (Client Webhook)
// ============================================================================

/**
 * POST DLR status to client's webhook URL (fire-and-forget).
 */
async function sendDlrCallback(url, payload) {
    try {
        const https = require('https');
        const http = require('http');
        const body = JSON.stringify(payload);
        const parsedUrl = new URL(url);
        const mod = parsedUrl.protocol === 'https:' ? https : http;
        
        return new Promise((resolve) => {
            const req = mod.request(parsedUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body),
                    'User-Agent': 'Net2App-VoiceOTP/3.0',
                },
                timeout: 10000,
            }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve({ status: res.statusCode, body: data }));
            });
            req.on('error', () => resolve({ status: 0, error: 'connection_failed' }));
            req.on('timeout', () => { req.destroy(); resolve({ status: 0, error: 'timeout' }); });
            req.write(body);
            req.end();
        });
    } catch (e) {
        // Silently fail — DLR callback is best-effort
        return { status: 0, error: e.message };
    }
}

// ============================================================================
// EXPORT
// ============================================================================

module.exports = {
    // Core pipeline
    executeVoiceOtpPipeline,
    
    // Individual steps (for testing/custom use)
    extractOtpDigits,
    resolveCountryLanguage,
    resolveVoiceOtpConfig,
    buildAudioSequence,
    concatenateWavFiles,
    originateCall,
    
    // Retry
    executeWithRetry,
    parseReconnectSchedule,
    
    // Force DLR
    applyForceDlr,
    
    // DLR callback
    sendDlrCallback,
    
    // Country mapping
    COUNTRY_LANGUAGE_MAP,
    
    // Utils
    generateRandomOtp,
    parseSipAddress,
};
