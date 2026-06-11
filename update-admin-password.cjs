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

async function updatePassword() {
  try {
    const newPassword = 'Ariya2015@22';
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    const result = await pool.query(
      'UPDATE users SET password_hash = $1 WHERE username = $2 RETURNING username, email',
      [hashedPassword, 'admin']
    );
    
    if (result.rows.length > 0) {
      console.log('✅ Admin password updated successfully!');
      console.log(`   Username: ${result.rows[0].username}`);
      console.log(`   New Password: ${newPassword}`);
      console.log(`   Email: ${result.rows[0].email}`);
      
      // Verify the password works
      const verifyResult = await pool.query(
        'SELECT password_hash FROM users WHERE username = $1',
        ['admin']
      );
      const isValid = await bcrypt.compare(newPassword, verifyResult.rows[0].password_hash);
      console.log(`   Password verification: ${isValid ? 'SUCCESS' : 'FAILED'}`);
    } else {
      console.log('❌ Admin user not found!');
    }
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

updatePassword();
