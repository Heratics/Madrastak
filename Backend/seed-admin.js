const bcrypt = require('bcrypt');
const pool = require('./db');

async function seedAdmin() {
  const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME = 'Madrastak Administrator' } = process.env;

  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD must be provided through the server environment.');
  }

  if (ADMIN_PASSWORD.length < 12) {
    throw new Error('ADMIN_PASSWORD must be at least 12 characters long.');
  }

  const [existing] = await pool.query(
    'SELECT id, role FROM users WHERE email = ?',
    [ADMIN_EMAIL]
  );

  if (existing.length > 0) {
    if (existing[0].role !== 'admin') {
      throw new Error('The requested admin email already belongs to a non-admin account.');
    }
    console.log('Admin account already exists; no credentials were changed.');
    return;
  }

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
  await pool.query(
    `INSERT INTO users (full_name, email, password_hash, role, account_status)
     VALUES (?, ?, ?, 'admin', 'active')`,
    [ADMIN_NAME, ADMIN_EMAIL, passwordHash]
  );
  console.log('Admin account created successfully.');
}

seedAdmin()
  .catch((error) => {
    console.error('Admin seed failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());