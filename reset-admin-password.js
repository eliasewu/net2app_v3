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

async function resetPassword() {
  try {
    // Hash the new password
    const newPassword = 'Ariya@2024Admin';
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    // Delete existing admin user
    await pool.query('DELETE FROM users WHERE username = $1', ['admin']);
    
    // Insert new admin user
    await pool.query(`
      INSERT INTO users (username, password_hash, email, role, permissions, name, is_active, created_at) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
    `, ['admin', hashedPassword, 'admin@net2app.com', 'super_admin', ['all'], 'System Administrator', true]);
    
    console.log('✅ Admin user created/updated successfully!');
    console.log('📝 Username: admin');
    console.log('🔑 Password: Ariya@2024Admin');
    
    // Verify by counting users
    const result = await pool.query('SELECT COUNT(*) FROM users WHERE username = $1', ['admin']);
    console.log(`✅ Admin user exists: ${result.rows[0].count} row(s)`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

resetPassword();
