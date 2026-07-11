/**
 * Pre-fill DLR URLs, DLR patterns, and DLR values for all API connectors
 * that don't have them configured yet.
 *
 * Uses known provider patterns + send_url heuristics to derive:
 *   - dlr_url:   where to poll/check delivery status
 *   - dlr_pattern: regex to extract status from DLR response
 *   - dlr_value:  what value means "delivered"
 *
 * Run: node scripts/prefill_dlr_urls.mjs
 */

import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'sms_platform',
  user: process.env.DB_USER || 'sms_user',
  password: process.env.DB_PASS || 'Ariya@2024Net2App',
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// ============= KNOWN PROVIDER DLR CONFIGS =============
const knownProviders = {
  // --- Major Global SMS APIs ---
  twilio: {
    dlr_url: 'https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/Messages/{MessageSid}.json',
    dlr_pattern: 'status.*?"(delivered|undelivered|failed|sent|queued|received)"',
    dlr_value: 'delivered',
  },
  sinch: {
    dlr_url: 'https://api.sinch.com/sms/v1/{service_plan_id}/batches/{batch_id}',
    dlr_pattern: 'status.*?"(Delivered|Failed|Unknown|Queued|Dispatched)"',
    dlr_value: 'Delivered',
  },
  messagebird: {
    dlr_url: 'https://rest.messagebird.com/messages/{id}',
    dlr_pattern: 'recipients.*?status.*?"(delivered|failed|sent|buffered|delivery_failed)"',
    dlr_value: 'delivered',
  },
  infobip: {
    dlr_url: 'https://api.infobip.com/sms/1/reports',
    dlr_pattern: 'groupName.*?"(DELIVERED|UNDELIVERABLE|REJECTED|PENDING|EXPIRED)"',
    dlr_value: 'DELIVERED',
  },
  vonage: {
    dlr_url: 'https://api.nexmo.com/v1/messages/{message_uuid}',
    dlr_pattern: 'status.*?"(delivered|rejected|submitted|failed|buffered|accepted)"',
    dlr_value: 'delivered',
  },
  plivo: {
    dlr_url: 'https://api.plivo.com/v1/Account/{auth_id}/Message/{message_uuid}/',
    dlr_pattern: 'message_state.*?"(delivered|undelivered|rejected|queued|sent)"',
    dlr_value: 'delivered',
  },
  clickatell: {
    dlr_url: 'https://platform.clickatell.com/messages/{messageId}',
    dlr_pattern: 'messageStatus.*?"(DELIVERED|FAILED|QUEUED|SENT|REJECTED)"',
    dlr_value: 'DELIVERED',
  },
  telesign: {
    dlr_url: 'https://rest-api.telesign.com/v1/messaging/{reference_id}',
    dlr_pattern: 'status.*?description.*?"(Delivered|Undelivered|Failed|Sent)"',
    dlr_value: 'Delivered',
  },
  bandwidth: {
    dlr_url: 'https://messaging.bandwidth.com/api/v2/users/{accountId}/messages/{id}',
    dlr_pattern: 'status.*?"(DELIVERED|FAILED|SENT|QUEUED|REJECTED)"',
    dlr_value: 'DELIVERED',
  },
  textlocal: {
    dlr_url: 'https://api.txtlocal.com/get_status/',
    dlr_pattern: 'status.*?"(D|F|U|S)"',
    dlr_value: 'D',
  },
  'route mobile': {
    dlr_url: 'https://api.routemobile.com/restapi/sms/1.0/reports',
    dlr_pattern: 'status.*?\"(Delivered|UnDelivered|Rejected|Submitted|Expired)\"',
    dlr_value: 'Delivered',
  },
  'cm.com': {
    dlr_url: 'https://gw.cmtelecom.com/v1.0/message/{id}',
    dlr_pattern: 'status.*?\"(Delivered|Undelivered|Rejected|Sent|Expired)\"',
    dlr_value: 'Delivered',
  },
  mitto: {
    dlr_url: 'https://rest.mittoapi.com/sms/1.0.1/reports',
    dlr_pattern: 'status.*?\"(Delivered|Undeliverable|Rejected|Sent|Buffered)\"',
    dlr_value: 'Delivered',
  },
  bics: {
    dlr_url: 'https://api.bics.com/sms/v1/reports',
    dlr_pattern: 'dlrStatus.*?\"(DELIVRD|UNDELIV|REJECTD|EXPIRED|DELETED|ACCEPTD)\"',
    dlr_value: 'DELIVRD',
  },
  'tata communications': {
    dlr_url: 'https://api.tatacommunications.com/sms/v2/reports',
    dlr_pattern: 'status.*?\"(Delivered|Failed|Submitted|Rejected|Expired)\"',
    dlr_value: 'Delivered',
  },
  syniverse: {
    dlr_url: 'https://api.syniverse.com/scg-external-api/messaging/v1/message_requests/{id}',
    dlr_pattern: 'delivery_status.*?\"(DELIVERED|UNDELIVERED|EXPIRED|REJECTED|UNKNOWN)\"',
    dlr_value: 'DELIVERED',
  },
  'sap digital': {
    dlr_url: 'https://api.sapdigitalinterconnect.com/sms/v1/reports',
    dlr_pattern: 'deliveryStatus.*?\"(Delivered|Undelivered|Rejected|Expired|Submitted)\"',
    dlr_value: 'Delivered',
  },
  tyntec: {
    dlr_url: 'https://api.tyntec.com/messaging/v1/reports',
    dlr_pattern: 'deliveryState.*?\"(DELIVERED|UNDELIVERED|REJECTED|EXPIRED)\"',
    dlr_value: 'DELIVERED',
  },
  flowroute: {
    dlr_url: 'https://api.flowroute.com/v2/messages/{id}',
    dlr_pattern: 'data.*?attributes.*?status.*?\"(delivered|undelivered|failed|queued|sent)\"',
    dlr_value: 'delivered',
  },
  telstra: {
    dlr_url: 'https://api.telstra.com/v2/messages/sms/{messageId}/status',
    dlr_pattern: 'status.*?\"(DELIVRD|UNDVBL|EXPIRED|REJECTD)\"',
    dlr_value: 'DELIVRD',
  },
  trumpia: {
    dlr_url: 'https://api.trumpia.com/rest/v1/{apiKey}/report',
    dlr_pattern: 'statuscode.*?\"(0|1|2|3)\"',
    dlr_value: '1',
  },
  voximplant: {
    dlr_url: 'https://api.voximplant.com/platform_api/GetSmsDeliveryStatus/',
    dlr_pattern: 'delivery_status.*?\"(DELIVERED|PENDING|FAILED|REJECTED)\"',
    dlr_value: 'DELIVERED',
  },
  'voip.ms': {
    dlr_url: 'https://api.voip.ms/v1/sms/status',
    dlr_pattern: 'status.*?\"(delivered|failed|pending)\"',
    dlr_value: 'delivered',
  },

  // --- Major Carriers ---
  'at&t': {
    dlr_url: 'https://api.att.com/messaging/v3/sms/reports',
    dlr_pattern: 'deliveryStatus.*?\"(Delivered|Undelivered|Failed|Expired)\"',
    dlr_value: 'Delivered',
  },
  verzion: {
    dlr_url: 'https://api.verizon.com/messaging/v1/reports',
    dlr_pattern: 'status.*?\"(Delivered|Undelivered|Expired)\"',
    dlr_value: 'Delivered',
  },
  't-mobile': {
    dlr_url: 'https://api.t-mobile.com/messaging/v1/reports',
    dlr_pattern: 'deliveryStatus.*?\"(Delivered|Failed|Unknown|Pending)\"',
    dlr_value: 'Delivered',
  },
  vodafone: {
    dlr_url: 'https://api.vodafone.com/messaging/sms/v1/reports',
    dlr_pattern: 'deliveryStatus.*?\"(DELIVERED|FAILED|EXPIRED|UNKNOWN)\"',
    dlr_value: 'DELIVERED',
  },
  orange: {
    dlr_url: 'https://api.orange.com/messaging/sms/v1/reports',
    dlr_pattern: 'deliveryStatus.*?\"(DELIVERED|FAILED|PENDING|REJECTED)\"',
    dlr_value: 'DELIVERED',
  },
  'o2': {
    dlr_url: 'https://api.o2.com/messaging/sms/v1/reports',
    dlr_pattern: 'deliveryStatus.*?\"(DELIVERED|FAILED|UNKNOWN)\"',
    dlr_value: 'DELIVERED',
  },
  telefonica: {
    dlr_url: 'https://api.telefonica.com/messaging/sms/v1/reports',
    dlr_pattern: 'deliveryStatus.*?\"(Delivered|Undelivered|Rejected)\"',
    dlr_value: 'Delivered',
  },
  movistar: {
    dlr_url: 'https://api.movistar.com/messaging/sms/v1/reports',
    dlr_pattern: 'deliveryStatus.*?\"(DELIVERED|UNDELIVERED|REJECTED)\"',
    dlr_value: 'DELIVERED',
  },
  mtn: {
    dlr_url: 'https://api.mtn.com/messaging/sms/v1/reports',
    dlr_pattern: 'deliveryStatus.*?\"(Delivered|Undelivered|Rejected|Expired)\"',
    dlr_value: 'Delivered',
  },
  vodacom: {
    dlr_url: 'https://api.vodacom.co.za/messaging/sms/v1/reports',
    dlr_pattern: 'deliveryStatus.*?\"(DELIVERED|FAILED|EXPIRED)\"',
    dlr_value: 'DELIVERED',
  },
  airtel: {
    dlr_url: 'https://api.airtel.com/messaging/sms/v1/reports',
    dlr_pattern: 'status.*?\"(Delivered|Undelivered|Submitted|Rejected)\"',
    dlr_value: 'Delivered',
  },
  stc: {
    dlr_url: 'https://api.stc.com.sa/messaging/sms/v1/reports',
    dlr_pattern: 'status.*?\"(DELIVERED|UNDELIVERED|EXPIRED|REJECTED)\"',
    dlr_value: 'DELIVERED',
  },
  etisalat: {
    dlr_url: 'https://api.etisalat.ae/messaging/sms/v1/reports',
    dlr_pattern: 'status.*?\"(Delivered|Undelivered|Failed|Expired)\"',
    dlr_value: 'Delivered',
  },
  du: {
    dlr_url: 'https://api.du.ae/messaging/sms/v1/reports',
    dlr_pattern: 'deliveryStatus.*?\"(DELIVERED|FAILED|PENDING)\"',
    dlr_value: 'DELIVERED',
  },
  globe: {
    dlr_url: 'https://api.globe.com.ph/messaging/sms/v1/reports',
    dlr_pattern: 'status.*?\"(DELIVERED|FAILED|UNKNOWN)\"',
    dlr_value: 'DELIVERED',
  },
  smart: {
    dlr_url: 'https://api.smart.com.ph/messaging/sms/v1/reports',
    dlr_pattern: 'status.*?\"(Delivered|Failed|Unknown)\"',
    dlr_value: 'Delivered',
  },
  telkomsel: {
    dlr_url: 'https://api.telkomsel.com/messaging/sms/v1/reports',
    dlr_pattern: 'deliveryStatus.*?\"(DELIVERED|UNDELIVERED|EXPIRED)\"',
    dlr_value: 'DELIVERED',
  },
  indosat: {
    dlr_url: 'https://api.indosatooredoo.com/messaging/sms/v1/reports',
    dlr_pattern: 'deliveryStatus.*?\"(DELIVERED|FAILED|UNKNOWN)\"',
    dlr_value: 'DELIVERED',
  },
  telcel: {
    dlr_url: 'https://api.telcel.com/messaging/sms/v1/reports',
    dlr_pattern: 'deliveryStatus.*?\"(ENTREGADO|NO_ENTREGADO|PENDIENTE)\"',
    dlr_value: 'ENTREGADO',
  },
  claro: {
    dlr_url: 'https://api.claro.com/messaging/sms/v1/reports',
    dlr_pattern: 'deliveryStatus.*?\"(Entregado|No_Entregado|Pendiente)\"',
    dlr_value: 'Entregado',
  },
  personal: {
    dlr_url: 'https://api.personal.com.ar/messaging/sms/v1/reports',
    dlr_pattern: 'deliveryStatus.*?\"(Entregado|No_Entregado|Error)\"',
    dlr_value: 'Entregado',
  },
  entel: {
    dlr_url: 'https://api.entel.pe/messaging/sms/v1/reports',
    dlr_pattern: 'deliveryStatus.*?\"(Entregado|No_Entregado|Pendiente)\"',
    dlr_value: 'Entregado',
  },
  robi: {
    dlr_url: 'https://api.robi.com.bd/bulk-sms/v1/reports',
    dlr_pattern: 'status.*?\"(DELIVERED|FAILED|PENDING|EXPIRED)\"',
    dlr_value: 'DELIVERED',
  },
  grameenphone: {
    dlr_url: 'https://api.grameenphone.com/messaging/sms/v1/reports',
    dlr_pattern: 'status.*?\"(DELIVERED|FAILED|UNKNOWN)\"',
    dlr_value: 'DELIVERED',
  },
  banglalink: {
    dlr_url: 'https://api.banglalink.com.bd/messaging/sms/v1/reports',
    dlr_pattern: 'status.*?\"(Delivered|Undelivered|Failed)\"',
    dlr_value: 'Delivered',
  },
  teletalk: {
    dlr_url: 'https://api.teletalk.com.bd/messaging/sms/v1/reports',
    dlr_pattern: 'status.*?\"(DELIVERED|FAILED|UNKNOWN)\"',
    dlr_value: 'DELIVERED',
  },
  metronet: {
    dlr_url: 'https://api.metronet.com.bd/sms/v1/reports',
    dlr_pattern: 'status.*?\"(DELIVERED|FAILED|PENDING|EXPIRED)\"',
    dlr_value: 'DELIVERED',
  },
  bdcom: {
    dlr_url: 'https://api.bdcom.com/sms/v1/reports',
    dlr_pattern: 'status.*?\"(DELIVERED|FAILED|PENDING)\"',
    dlr_value: 'DELIVERED',
  },
  cellc: {
    dlr_url: 'https://api.cellc.co.za/messaging/sms/v1/reports',
    dlr_pattern: 'deliveryStatus.*?\"(Delivered|Failed|Unknown)\"',
    dlr_value: 'Delivered',
  },
  telkom: {
    dlr_url: 'https://api.telkom.co.za/messaging/sms/v1/reports',
    dlr_pattern: 'deliveryStatus.*?\"(DELIVERED|FAILED|UNKNOWN)\"',
    dlr_value: 'DELIVERED',
  },
  starhub: {
    dlr_url: 'https://api.starhub.com/messaging/sms/v1/reports',
    dlr_pattern: 'status.*?\"(Delivered|Failed|Pending)\"',
    dlr_value: 'Delivered',
  },
  'bell canada': {
    dlr_url: 'https://api.bell.ca/messaging/sms/v1/reports',
    dlr_pattern: 'deliveryStatus.*?\"(DELIVERED|FAILED|UNKNOWN)\"',
    dlr_value: 'DELIVERED',
  },
  dna: {
    dlr_url: 'https://api.dna.fi/messaging/sms/v1/reports',
    dlr_pattern: 'deliveryStatus.*?\"(DELIVERED|FAILED|PENDING)\"',
    dlr_value: 'DELIVERED',
  },
  'three uk': {
    dlr_url: 'https://api.three.co.uk/messaging/sms/v1/reports',
    dlr_pattern: 'status.*?\"(Delivered|Undelivered|Unknown)\"',
    dlr_value: 'Delivered',
  },
  zain: {
    dlr_url: 'https://api.zain.com/messaging/sms/v1/reports',
    dlr_pattern: 'status.*?\"(DELIVERED|UNDELIVERED|EXPIRED)\"',
    dlr_value: 'DELIVERED',
  },
  'tata tele': {
    dlr_url: 'https://api.tatatelebusiness.com/sms/v1/reports',
    dlr_pattern: 'status.*?\"(DELIVERED|FAILED|PENDING|EXPIRED)\"',
    dlr_value: 'DELIVERED',
  },
  mobily: {
    dlr_url: 'https://api.mobily.com.sa/messaging/sms/v1/reports',
    dlr_pattern: 'status.*?\"(DELIVERED|UNDELIVERED|EXPIRED)\"',
    dlr_value: 'DELIVERED',
  },
  du: {
    dlr_url: 'https://api.du.ae/messaging/sms/v1/reports',
    dlr_pattern: 'deliveryStatus.*?\"(DELIVERED|FAILED|PENDING)\"',
    dlr_value: 'DELIVERED',
  },
  ooredoo: {
    dlr_url: 'https://api.ooredoo.com/messaging/sms/v1/reports',
    dlr_pattern: 'status.*?\"(DELIVERED|FAILED|EXPIRED|UNKNOWN)\"',
    dlr_value: 'DELIVERED',
  },
  '9mobile': {
    dlr_url: 'https://api.9mobile.com.ng/messaging/sms/v1/reports',
    dlr_pattern: 'deliveryStatus.*?\"(DELIVERED|UNDELIVERED|FAILED)\"',
    dlr_value: 'DELIVERED',
  },
  glo: {
    dlr_url: 'https://api.gloworld.com/messaging/sms/v1/reports',
    dlr_pattern: 'deliveryStatus.*?\"(Delivered|Failed|Pending)\"',
    dlr_value: 'Delivered',
  },

  // --- RCS Providers ---
  'google jibe': {
    dlr_url: 'https://rcsapi.googleapis.com/v1/messages/{id}',
    dlr_pattern: 'status.*?\"(DELIVERED|FAILED|SENT|QUEUED)\"',
    dlr_value: 'DELIVERED',
  },
  'mavenir rcs': {
    dlr_url: 'https://api.mavenir.com/rcs/v1/messages/reports',
    dlr_pattern: 'deliveryStatus.*?\"(delivered|failed|sent)\"',
    dlr_value: 'delivered',
  },
  'samsung rcs': {
    dlr_url: 'https://api.samsung.com/rcs/v1/reports',
    dlr_pattern: 'status.*?\"(Delivered|Failed|Queued)\"',
    dlr_value: 'Delivered',
  },
  'interop rcs': {
    dlr_url: 'https://api.interop.tech/rcs/v1/reports',
    dlr_pattern: 'status.*?\"(DELIVERED|FAILED|SENT)\"',
    dlr_value: 'DELIVERED',
  },
};

// ============= HEURISTIC: Derive DLR URL from send_url =============
function deriveDlrUrl(sendUrl, provider) {
  if (!sendUrl) return '';

  // Strip trailing slashes and query params
  let base = sendUrl.replace(/\/+$/, '').split('?')[0];

  // Common patterns: replace send/message paths with report/status paths
  const replacements = [
    // Replace "send" or "messages" with "reports" or "status"
    [/\/send\/?$/, '/reports'],
    [/\/send$/, '/reports'],
    [/\/messages\/?$/, '/reports'],
    [/\/messages$/, '/reports'],
    [/\/sms\/send\/?$/, '/sms/reports'],
    [/\/sms\/v\d+\/send\/?$/, '/sms/v1/reports'],
    [/\/v\d+\/messages\/?$/, '/v1/reports'],
    [/\/v\d+\/message\/?$/, '/v1/reports'],
    [/\/restapi\/sms\/\d+\.\d+\/messages\/?$/, '/restapi/sms/1.0/reports'],
    [/\/messaging\/sms\/v\d+\/?$/, '/messaging/sms/v1/reports'],
    [/\/messaging\/v\d+\/sms\/?$/, '/messaging/v1/reports'],
    [/\/messaging\/sms\/send\/?$/, '/messaging/sms/reports'],
    [/\/bulk-sms\/v\d+\/send\/?$/, '/bulk-sms/v1/reports'],
    [/\/sms\/v\d+\/send\/?$/, '/sms/v1/status'],
    [/\/outbound\/?$/, '/reports'],
    [/\/api\/sms\/send\/?$/, '/api/sms/reports'],
    [/\/v\d+\/sms\/?$/, '/v1/reports'],
    [/\/SMS\/send\/?$/i, '/SMS/reports'],
    [/\/sms\/outbound\/?$/, '/sms/reports'],
  ];

  for (const [pattern, replacement] of replacements) {
    const result = base.replace(pattern, replacement);
    if (result !== base) return result;
  }

  // If no pattern matched, append /reports to the base URL
  // but skip if it already has "report" or "status" or "dlr" in the path
  if (base.match(/\/(report|status|dlr|callback)/i)) return base;
  return base + '/reports';
}

// ============= MAIN =============
async function main() {
  console.log('[PRE-FILL] Starting DLR URL batch pre-fill...');

  // Get all connectors missing DLR
  const { rows } = await pool.query(
    `SELECT id, name, provider, send_url, submit_pattern FROM api_connectors
     WHERE is_active = true AND (dlr_url IS NULL OR dlr_url = '')`
  );

  console.log(`[PRE-FILL] Found ${rows.length} connectors needing DLR config`);

  let matched = 0;
  let heuristic = 0;
  let skipped = 0;
  const updates = [];

  for (const conn of rows) {
    const providerKey = (conn.provider || '').toLowerCase().trim();
    const nameKey = (conn.name || '').toLowerCase().trim();

    let dlrUrl = '';
    let dlrPattern = '';
    let dlrValue = '';

    // 1. Try exact provider match
    if (knownProviders[providerKey]) {
      const k = knownProviders[providerKey];
      dlrUrl = k.dlr_url;
      dlrPattern = k.dlr_pattern;
      dlrValue = k.dlr_value;
      matched++;
    }
    // 2. Try partial provider name match
    else {
      for (const [key, config] of Object.entries(knownProviders)) {
        if (providerKey.includes(key) || nameKey.includes(key) ||
            (conn.send_url || '').toLowerCase().includes(key)) {
          dlrUrl = config.dlr_url;
          dlrPattern = config.dlr_pattern;
          dlrValue = config.dlr_value;
          matched++;
          break;
        }
      }
    }

    // 3. Fallback: heuristic derivation
    if (!dlrUrl) {
      dlrUrl = deriveDlrUrl(conn.send_url, conn.provider);
      heuristic++;
    }

    // Default DLR pattern (generic JSON status extraction)
    if (!dlrPattern) {
      dlrPattern = 'status.*?"([^"]+)"|"delivery_status"\\s*:\\s*"([^"]+)"';
      dlrValue = 'DELIVERED';
    }

    if (dlrUrl) {
      updates.push({
        id: conn.id,
        name: conn.name,
        dlr_url: dlrUrl,
        dlr_pattern: dlrPattern,
        dlr_value: dlrValue,
      });
    } else {
      skipped++;
    }
  }

  console.log(`[PRE-FILL] Matched by known provider: ${matched}`);
  console.log(`[PRE-FILL] Derived by heuristics: ${heuristic}`);
  console.log(`[PRE-FILL] Skipped (no send_url): ${skipped}`);

  // Apply updates in batches
  let applied = 0;
  for (const u of updates) {
    try {
      await pool.query(
        `UPDATE api_connectors SET dlr_url = $1, dlr_pattern = $2, dlr_value = $3 WHERE id = $4`,
        [u.dlr_url, u.dlr_pattern, u.dlr_value, u.id]
      );
      applied++;
    } catch (e) {
      console.error(`[PRE-FILL] Error updating ${u.name} (id=${u.id}): ${e.message}`);
    }
  }

  console.log(`[PRE-FILL] Applied ${applied} updates successfully`);

  // Verify
  const { rows: verify } = await pool.query(
    `SELECT COUNT(*) as total,
            COUNT(dlr_url) FILTER (WHERE dlr_url IS NOT NULL AND dlr_url != '') as have_dlr
     FROM api_connectors WHERE is_active = true`
  );
  console.log(`[PRE-FILL] Verification: ${verify[0].have_dlr}/${verify[0].total} connectors now have DLR URLs`);
  console.log('[PRE-FILL] Done!');

  await pool.end();
}

main().catch(e => { console.error('[PRE-FILL] Fatal:', e.message); pool.end(); process.exit(1); });
