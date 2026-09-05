/**
 * Madrastak Database Migration Script
 * 
 * Safe, idempotent migration script for Madrastak MySQL database.
 * Does NOT drop existing tables or alter existing data destructively.
 * 
 * To run manually:
 *   npm run migrate
 *   OR
 *   node migrate.js
 */

const pool = require('./db');

async function columnExists(tableName, columnName) {
  const [rows] = await pool.query(
    `SELECT COLUMN_NAME 
     FROM INFORMATION_SCHEMA.COLUMNS 
     WHERE TABLE_SCHEMA = DATABASE() 
       AND TABLE_NAME = ? 
       AND COLUMN_NAME = ?`,
    [tableName, columnName]
  );
  return rows.length > 0;
}

async function indexExists(tableName, indexName) {
  const [rows] = await pool.query(
    `SELECT INDEX_NAME 
     FROM INFORMATION_SCHEMA.STATISTICS 
     WHERE TABLE_SCHEMA = DATABASE() 
       AND TABLE_NAME = ? 
       AND INDEX_NAME = ?`,
    [tableName, indexName]
  );
  return rows.length > 0;
}

async function runMigrations() {
  console.log('🚀 Starting Madrastak database migrations...');

  try {
    // 1. Ensure `users` table exists
    console.log('Checking users table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        full_name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        role ENUM('student', 'teacher', 'admin') NOT NULL DEFAULT 'student',
        bio TEXT NULL,
        profile_pic VARCHAR(500) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 2. Ensure `live_classes` table exists
    console.log('Checking live_classes table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS live_classes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        teacher_id INT NOT NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT NULL,
        start_time DATETIME NOT NULL,
        duration_minutes INT NOT NULL DEFAULT 60,
        meeting_room_id VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 3. Add `student_limit` to `live_classes` if missing
    const hasStudentLimit = await columnExists('live_classes', 'student_limit');
    if (!hasStudentLimit) {
      console.log('Adding `student_limit` column to live_classes...');
      await pool.query(`
        ALTER TABLE live_classes 
        ADD COLUMN student_limit INT NULL DEFAULT NULL AFTER meeting_room_id;
      `);
      console.log('✔ Added `student_limit` column.');
    } else {
      console.log('✔ `student_limit` column already exists.');
    }

    // 4. Add `status` to `live_classes` if missing
    const hasStatus = await columnExists('live_classes', 'status');
    if (!hasStatus) {
      console.log('Adding `status` column to live_classes...');
      await pool.query(`
        ALTER TABLE live_classes 
        ADD COLUMN status ENUM('scheduled', 'live', 'ended') NOT NULL DEFAULT 'scheduled' AFTER student_limit;
      `);
      console.log('✔ Added `status` column.');
    } else {
      console.log('✔ `status` column already exists.');
    }

    // 5. Ensure `class_bookings` table exists
    console.log('Checking class_bookings table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS class_bookings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        student_id INT NOT NULL,
        class_id INT NOT NULL,
        booked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (class_id) REFERENCES live_classes(id) ON DELETE CASCADE,
        UNIQUE KEY unique_booking (student_id, class_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 6. Ensure `class_attendance` table exists
    console.log('Checking class_attendance table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS class_attendance (
        id INT AUTO_INCREMENT PRIMARY KEY,
        class_id INT NOT NULL,
        user_id INT NOT NULL,
        joined_at DATETIME NOT NULL,
        left_at DATETIME NULL,
        duration_seconds INT NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (class_id) REFERENCES live_classes(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_attendance_class (class_id),
        INDEX idx_attendance_user (user_id),
        INDEX idx_attendance_session (class_id, user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('✔ `class_attendance` table verified.');

    // 7. Add helpful indexes if missing
    const hasStatusIndex = await indexExists('live_classes', 'idx_classes_status');
    if (!hasStatusIndex) {
      await pool.query('ALTER TABLE live_classes ADD INDEX idx_classes_status (status);');
      console.log('✔ Added index `idx_classes_status`.');
    }

    const hasStartTimeIndex = await indexExists('live_classes', 'idx_classes_start_time');
    if (!hasStartTimeIndex) {
      await pool.query('ALTER TABLE live_classes ADD INDEX idx_classes_start_time (start_time);');
      console.log('✔ Added index `idx_classes_start_time`.');
    }

    console.log('\n🎉 All migrations completed successfully! Database is up to date.');
  } catch (error) {
    console.error('\n❌ Migration failed with error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Only execute if called directly from CLI
if (require.main === module) {
  runMigrations();
}

module.exports = { runMigrations };

