const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'net2app_hub',
  user: process.env.DB_USER || 'net2app_user',
  password: process.env.DB_PASS || 'Ariya@2024Net2App',
});

async function setupAdmin() {
  try {
    const adminHash = await bcrypt.hash('Ariya@2024Admin', 10);
    const supportHash = await bcrypt.hash('Ariya@2024Support', 10);
    const billingHash = await bcrypt.hash('Ariya@2024Billing', 10);

    // Clear existing users
    await pool.query("DELETE FROM users WHERE username IN ('admin', 'support', 'billing')");
    
    // Insert new users
    await pool.query(`
      INSERT INTO users (username, password_hash, email, role, permissions, name, is_active) VALUES
      ('admin', $1, 'admin@net2app.com', 'super_admin', ARRAY['all'], 'System Administrator', true),
      ('support', $2, 'support@net2app.com', 'support', ARRAY['view_clients','view_suppliers','view_sms_logs','test_sms','manage_bind','view_reports'], 'Support Team', true),
      ('billing', $3, 'billing@net2app.com', 'billing', ARRAY['manage_invoices','manage_payments','view_reports','view_clients','view_suppliers'], 'Billing Team', true)
    `, [adminHash, supportHash, billingHash]);
    
    console.log('✅ Admin users created successfully');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔐 LOGIN CREDENTIALS:');
    console.log('   Admin:   admin@net2app.com / Ariya@2024Admin');
    console.log('   Support: support@net2app.com / Ariya@2024Support');
    console.log('   Billing: billing@net2app.com / Ariya@2024Billing');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

setupAdmin();
