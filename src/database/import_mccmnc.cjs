// Import the full MCC/MNC reference dataset (src/database/mccmnc_full.json)
// into the mccmnc table. Idempotent: wipes and re-inserts in one transaction.
//
// Usage (from project root, on the server):
//   node src/database/import_mccmnc.cjs
//
// DB connection uses the same defaults as server.cjs / deploy_to_newserver.sh
// (sms_platform / sms_user). Override via DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASS.

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'sms_platform',
  user: process.env.DB_USER || 'sms_user',
  password: process.env.DB_PASS || '',
});

const DATA_FILE = path.join(__dirname, 'mccmnc_full.json');
const BATCH_SIZE = 500;

async function main() {
  if (!fs.existsSync(DATA_FILE)) {
    throw new Error(`Missing ${DATA_FILE} — run scripts/generate_mccmnc.py first`);
  }
  const rows = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('mccmnc_full.json is empty or malformed');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Wipe first so the unique index can be created even if the table
    // currently holds duplicate (mcc, mnc) rows from an older import.
    await client.query('DELETE FROM mccmnc');
    await client.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_mccmnc_mcc_mnc ON mccmnc(mcc, mnc)');

    const cols = 'country, country_code, mcc, mnc, operator, network_type, status, calling_code, is_deleted, created_at';
    let inserted = 0;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const chunk = rows.slice(i, i + BATCH_SIZE);
      const values = [];
      const params = [];
      chunk.forEach((r, j) => {
        const base = j * 10;
        params.push(r.country, r.country_code, r.mcc, r.mnc, r.operator,
          r.network_type, r.status, r.calling_code || '', false, new Date());
        values.push(`($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10})`);
      });
      await client.query(`INSERT INTO mccmnc (${cols}) VALUES ${values.join(',')}`, params);
      inserted += chunk.length;
      console.log(`  inserted ${inserted}/${rows.length}`);
    }

    await client.query('COMMIT');
    console.log(`✅ Imported ${inserted} MCCMNC rows`);

    const stats = await pool.query(
      `SELECT COUNT(*) AS total,
              COUNT(DISTINCT country_code) AS countries,
              COUNT(DISTINCT calling_code) AS calling_codes,
              COUNT(*) FILTER (WHERE status = 'active') AS active
       FROM mccmnc`
    );
    console.log('Summary:', stats.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

main()
  .then(() => pool.end())
  .catch((e) => {
    console.error('❌ Import failed:', e.message);
    pool.end().finally(() => process.exit(1));
  });
