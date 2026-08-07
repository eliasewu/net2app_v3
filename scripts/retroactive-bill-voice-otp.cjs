#!/usr/bin/env node
/**
 * Retroactive Voice OTP Billing Script
 * 
 * Bills all past Voice OTP DELIVRD calls that haven't been billed yet.
 * Looks up client/supplier rates by destination MCC, creates missing
 * sms_logs entries, deducts balances, and updates voice_otp_logs.
 * 
 * Usage:
 *   node scripts/retroactive-bill-voice-otp.cjs --dry-run    (preview only)
 *   node scripts/retroactive-bill-voice-otp.cjs --execute      (actually bill)
 */

const { Pool } = require('pg');

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'sms_platform',
  user: 'sms_user',
  password: 'Ariya@2024Net2App',
  max: 3,
});

// ── MCC lookup by country prefix ──
function getMCC(destination) {
  const dest = String(destination).replace(/^\+/, '');
  if (dest.startsWith('880')) return '470'; // Bangladesh
  if (dest.startsWith('971')) return '424'; // UAE
  if (dest.startsWith('966')) return '420'; // Saudi Arabia
  if (dest.startsWith('91'))  return '404'; // India
  if (dest.startsWith('92'))  return '410'; // Pakistan
  // Try to match longer prefixes
  const prefixes = ['880','971','966','92','91','20','212','216','234','254','256','255','27','230','233','237','241','242','243','244','245','248','249','251','252','253','260','261','262','263','264','265','266','267','268','269','290','291','297','298','299','30','31','32','33','34','350','351','352','353','354','355','356','357','358','359','36','370','371','372','373','374','375','376','377','378','379','380','381','382','385','386','387','389','39','40','41','420','421','423','43','44','45','46','47','48','49','500','501','502','503','504','505','506','507','508','509','51','52','53','54','55','56','57','58','590','591','592','593','594','595','596','597','598','599','60','61','62','63','64','65','66','670','672','673','674','675','676','677','678','679','680','681','682','683','685','686','687','688','689','690','691','692','7','800','808','81','82','83','84','850','852','853','855','856','86','870','878','880','881','882','883','886','888','90','91','92','93','94','95','960','961','962','963','964','965','966','967','968','970','971','972','973','974','975','976','977','979','98','992','993','994','995','996','998'];
  for (const p of prefixes) {
    if (dest.startsWith(p)) {
      const map = { '880':'470','971':'424','966':'420','91':'404','92':'410' };
      return map[p] || '000';
    }
  }
  return '000';
}

// ── Look up best rate for an entity ──
async function findRate(entityType, entityId, mcc) {
  // Try specific MCC first
  let r = await pool.query(
    `SELECT rate FROM rates WHERE entity_type=$1 AND entity_id=$2 AND mcc=$3 AND is_active=true ORDER BY rate ASC LIMIT 1`,
    [entityType, entityId, mcc]
  );
  if (r.rows.length > 0) return parseFloat(r.rows[0].rate);
  
  // Fall back to wildcard MCC
  r = await pool.query(
    `SELECT rate FROM rates WHERE entity_type=$1 AND entity_id=$2 AND mcc='*' AND is_active=true ORDER BY rate ASC LIMIT 1`,
    [entityType, entityId]
  );
  if (r.rows.length > 0) return parseFloat(r.rows[0].rate);
  
  return null;
}

// ── Get or create sms_logs entry ──
async function ensureSmsLog(call, client) {
  // Check if sms_logs entry already exists
  let existing = await pool.query(
    'SELECT id, message_id, is_client_billed, is_supplier_billed FROM sms_logs WHERE message_id = $1',
    [call.call_id]
  );
  if (existing.rows.length > 0) return existing.rows[0];
  
  // Create a new sms_logs entry (sender_id + message are NOT NULL)
  const insert = await pool.query(
    `INSERT INTO sms_logs (message_id, client_id, supplier_id, destination, sender_id, message, status, source, submit_time, message_parts)
     VALUES ($1, $2, $3, $4, 'VoiceOTP', '-', 'delivered', 'voice_otp', $5, 1) RETURNING id, message_id, is_client_billed, is_supplier_billed`,
    [call.call_id, call.client_id, call.supplier_id, call.destination, call.created_at || new Date()]
  );
  console.log(`  → Created sms_logs entry for ${call.call_id.slice(-16)}`);
  return insert.rows[0];
}

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const isExecute = args.includes('--execute');
  
  if (!isDryRun && !isExecute) {
    console.log('Usage: node scripts/retroactive-bill-voice-otp.cjs [--dry-run|--execute]');
    console.log('  --dry-run  Preview what would be billed (no changes)');
    console.log('  --execute  Actually bill all calls');
    process.exit(1);
  }
  
  console.log(`\n🔍 ${isDryRun ? 'DRY RUN' : 'EXECUTING'} — Retroactive Voice OTP Billing\n`);
  
  // ── Fetch all unbilled DELIVRD calls ──
  const calls = await pool.query(
    `SELECT v.*, c.balance as client_balance, c.billing_mode as client_billing_mode,
            s.balance as supplier_balance, s.billing_mode as supplier_billing_mode
     FROM voice_otp_logs v
     LEFT JOIN clients c ON c.id = v.client_id
     LEFT JOIN suppliers s ON s.id = v.supplier_id
     WHERE v.dlr_status = 'DELIVRD' 
       AND (v.billing_status IS NULL OR v.billing_status != 'billed')
       AND (v.client_id IS NOT NULL OR v.supplier_id IS NOT NULL)
     ORDER BY v.id`
  );
  
  console.log(`Found ${calls.rows.length} unbilled DELIVRD calls\n`);
  
  let billed = 0, skipped = 0, errors = 0;
  let totalClientCost = 0, totalSupplierCost = 0;
  const results = [];
  
  for (const call of calls.rows) {
    const mcc = getMCC(call.destination);
    const dest = String(call.destination).replace(/^\+/, '');
    
    // ── Look up rates ──
    let clientRate = null, supplierRate = null;
    
    if (call.client_id) {
      clientRate = await findRate('client', call.client_id, mcc);
    }
    if (call.supplier_id) {
      supplierRate = await findRate('supplier', call.supplier_id, mcc);
    }
    
    const clientCost = clientRate ? parseFloat(clientRate.toFixed(6)) : 0;
    const supplierCost = supplierRate ? parseFloat(supplierRate.toFixed(6)) : 0;
    const profit = clientRate && supplierRate ? parseFloat((clientRate - supplierRate).toFixed(6)) : 0;
    
    const hasClient = call.client_id && clientRate && clientCost > 0;
    const hasSupplier = call.supplier_id && supplierRate && supplierCost > 0;
    
    console.log(`${call.call_id.slice(-20)} | +${dest} | client#${call.client_id||'—'}(${clientRate||'N/A'}) | supplier#${call.supplier_id||'—'}(${supplierRate||'N/A'}) | profit=€${profit}`);
    
    if (!hasClient && !hasSupplier) {
      console.log(`  ⏭ SKIP: no active rate for client or supplier`);
      skipped++;
      continue;
    }
    
    if (isDryRun) {
      console.log(`  📋 DRY RUN — would bill: client=€${clientCost} supplier=€${supplierCost} profit=€${profit}`);
      totalClientCost += clientCost;
      totalSupplierCost += supplierCost;
      billed++;
      continue;
    }
    
    // ── Execute ──
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // 1. Create/verify sms_logs entry
      const smsLog = await ensureSmsLog(call, client);
      
      // 2. Bill client
      let clientBilled = false;
      if (hasClient) {
        // Check not already billed
        const cbCheck = await client.query(
          'SELECT is_client_billed FROM sms_logs WHERE message_id = $1',
          [call.call_id]
        );
        if (cbCheck.rows[0]?.is_client_billed) {
          console.log(`  ⏭ Client already billed, skipping`);
        } else {
          await client.query(
            'UPDATE sms_logs SET is_client_billed = true, client_rate = $2, profit = COALESCE(profit, 0) + $3 WHERE message_id = $1',
            [call.call_id, clientCost, profit]
          );
          await client.query(
            'UPDATE clients SET balance = GREATEST(0, balance - $1), updated_at = NOW() WHERE id = $2',
            [clientCost, call.client_id]
          );
          clientBilled = true;
        }
      }
      
      // 3. Bill supplier
      let supplierBilled = false;
      if (hasSupplier) {
        const sbCheck = await client.query(
          'SELECT is_supplier_billed FROM sms_logs WHERE message_id = $1',
          [call.call_id]
        );
        if (sbCheck.rows[0]?.is_supplier_billed) {
          console.log(`  ⏭ Supplier already billed, skipping`);
        } else {
          await client.query(
            'UPDATE sms_logs SET is_supplier_billed = true, supplier_rate = $2 WHERE message_id = $1',
            [call.call_id, supplierCost]
          );
          await client.query(
            'UPDATE suppliers SET balance = GREATEST(0, balance - $1), updated_at = NOW() WHERE id = $2',
            [supplierCost, call.supplier_id]
          );
          supplierBilled = true;
        }
      }
      
      // 4. Set composite is_billed flag
      const clientDone = clientBilled || !hasClient;
      const supplierDone = supplierBilled || !hasSupplier;
      if (clientDone && supplierDone) {
        await client.query(
          'UPDATE sms_logs SET is_billed = true WHERE message_id = $1 AND is_billed = false',
          [call.call_id]
        );
      }
      
      // 5. Update voice_otp_logs
      const totalCost = parseFloat((clientCost + supplierCost).toFixed(6));
      await client.query(
        `UPDATE voice_otp_logs SET 
           client_cost = $2, total_cost = $3,
           billing_status = 'billed'
         WHERE call_id = $1`,
        [call.call_id, clientCost, totalCost]
      );
      
      await client.query('COMMIT');
      
      totalClientCost += clientCost;
      totalSupplierCost += supplierCost;
      billed++;
      console.log(`  ✅ Billed: client=€${clientCost} supplier=€${supplierCost} profit=€${profit} [${clientBilled?'C':'-'}${supplierBilled?'S':'-'}]`);
      
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error(`  ❌ ERROR: ${err.message}`);
      errors++;
    } finally {
      client.release();
    }
  }
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📊 SUMMARY`);
  console.log(`${'='.repeat(60)}`);
  console.log(`  Total calls processed: ${calls.rows.length}`);
  console.log(`  Billed:               ${billed}`);
  console.log(`  Skipped (no rates):   ${skipped}`);
  console.log(`  Errors:               ${errors}`);
  console.log(`  Total client cost:    €${totalClientCost.toFixed(4)}`);
  console.log(`  Total supplier cost:  €${totalSupplierCost.toFixed(4)}`);
  console.log(`  Net profit:           €${(totalClientCost - totalSupplierCost).toFixed(4)}`);
  console.log(`  Mode:                 ${isDryRun ? 'DRY RUN (no changes)' : 'EXECUTED (balances deducted)'}`);
  console.log();
  
  await pool.end();
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
