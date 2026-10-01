const bcrypt = require('bcrypt');
const pool = require('./db');

async function seedAdmin() {
  const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME } = process.env;
  const adminEmail = ADMIN_EMAIL?.trim();
  const adminName = ADMIN_NAME?.trim();

  if (!adminEmail || !ADMIN_PASSWORD || !adminName) {
    console.log('Admin bootstrap skipped: required ADMIN_* variables are not configured.');
    return { created: false, skipped: true, reason: 'missing_configuration' };
  }

  if (ADMIN_PASSWORD.length < 12) {
    throw new Error('ADMIN_PASSWORD must be at least 12 characters long.');
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      'INSERT INTO admin_bootstrap (id) VALUES (1) ON DUPLICATE KEY UPDATE id = id'
    );
    await connection.query('SELECT id, completed_at FROM admin_bootstrap WHERE id = 1 FOR UPDATE');

    const [admins] = await connection.query(
      "SELECT id FROM users WHERE role = 'admin' LIMIT 1 FOR UPDATE"
    );
    if (admins.length > 0) {
      await connection.rollback();
      console.log('Admin bootstrap skipped: an administrator already exists.');
      return { created: false, skipped: true, reason: 'admin_exists' };
    }

    const [sameEmail] = await connection.query(
      'SELECT id, role FROM users WHERE email = ? FOR UPDATE',
      [adminEmail]
    );
    if (sameEmail.length > 0) {
      throw new Error('ADMIN_EMAIL already belongs to a non-admin account.');
    }

    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
    const [result] = await connection.query(
      `INSERT INTO users (full_name, email, password_hash, role, account_status)
       VALUES (?, ?, ?, 'admin', 'active')`,
      [adminName, adminEmail, passwordHash]
    );
    await connection.query(
      `UPDATE admin_bootstrap
       SET admin_id = ?, completed_at = CURRENT_TIMESTAMP
       WHERE id = 1`,
      [result.insertId]
    );
    await connection.commit();
    console.log('Admin account bootstrap completed.');
    return { created: true, skipped: false, reason: 'created' };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

if (require.main === module) {
  seedAdmin()
    .catch((error) => {
      console.error('Admin seed failed:', error.message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}

module.exports = { seedAdmin };