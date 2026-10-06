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
        account_status ENUM('active', 'pending', 'rejected', 'suspended') NOT NULL DEFAULT 'active',
        bio TEXT NULL,
        profile_pic VARCHAR(500) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 1b. Add account status without changing existing users' access.
    const hasAccountStatus = await columnExists('users', 'account_status');
    if (!hasAccountStatus) {
      console.log('Adding `account_status` column to users...');
      await pool.query(`
        ALTER TABLE users
        ADD COLUMN account_status ENUM('active', 'pending', 'rejected', 'suspended')
        NOT NULL DEFAULT 'active' AFTER role;
      `);
      console.log('✔ Added `account_status` column; existing users remain active.');
    } else {
      console.log('✔ `account_status` column already exists.');
    }

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

    const hasAccountStatusIndex = await indexExists('users', 'idx_users_account_status');
    if (!hasAccountStatusIndex) {
      await pool.query('ALTER TABLE users ADD INDEX idx_users_account_status (account_status);');
      console.log('✔ Added index `idx_users_account_status`.');
    }

    // 8. Keep approval changes auditable without exposing authentication data.
    console.log('Checking admin_actions table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admin_actions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        admin_id INT NOT NULL,
        target_user_id INT NULL,
        action VARCHAR(50) NOT NULL,
        previous_status VARCHAR(50) NULL,
        new_status VARCHAR(50) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE RESTRICT,
        FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE SET NULL,
        INDEX idx_admin_actions_admin (admin_id),
        INDEX idx_admin_actions_target (target_user_id),
        INDEX idx_admin_actions_created (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('✔ `admin_actions` table verified.');

    // 9. Singleton marker used by the optional startup admin bootstrap.
    console.log('Checking admin_bootstrap table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admin_bootstrap (
        id TINYINT UNSIGNED PRIMARY KEY,
        admin_id INT NULL,
        completed_at TIMESTAMP NULL,
        FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    await pool.query(
      'INSERT INTO admin_bootstrap (id) VALUES (1) ON DUPLICATE KEY UPDATE id = id'
    );
    console.log('✔ `admin_bootstrap` table verified.');

    // 10. 3alamatak relational gradebook foundation.
    console.log('Checking 3alamatak tables...');
    const alamatakStatements = [
      `
      CREATE TABLE IF NOT EXISTS alamatak_gradebooks (
        id INT AUTO_INCREMENT PRIMARY KEY,
        owner_user_id INT NOT NULL,
        madrastak_class_id INT NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT NULL,
        subject VARCHAR(100) NULL,
        academic_year VARCHAR(32) NOT NULL,
        status ENUM('active', 'archived') NOT NULL DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (madrastak_class_id) REFERENCES live_classes(id) ON DELETE SET NULL,
        INDEX idx_alamatak_gradebooks_owner (owner_user_id),
        INDEX idx_alamatak_gradebooks_class (madrastak_class_id),
        INDEX idx_alamatak_gradebooks_year (academic_year),
        INDEX idx_alamatak_gradebooks_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,
      `CREATE TABLE IF NOT EXISTS alamatak_students (
        id INT AUTO_INCREMENT PRIMARY KEY,
        gradebook_id INT NOT NULL,
        linked_user_id INT NULL,
        external_student_id VARCHAR(128) NULL,
        first_name VARCHAR(255) NOT NULL DEFAULT '',
        last_name VARCHAR(255) NOT NULL DEFAULT '',
        display_name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NULL,
        status ENUM('active', 'inactive', 'archived') NOT NULL DEFAULT 'active',
        notes TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (gradebook_id) REFERENCES alamatak_gradebooks(id) ON DELETE CASCADE,
        FOREIGN KEY (linked_user_id) REFERENCES users(id) ON DELETE SET NULL,
        UNIQUE KEY uq_alamatak_student_external (gradebook_id, external_student_id),
        INDEX idx_alamatak_students_gradebook (gradebook_id),
        INDEX idx_alamatak_students_linked_user (linked_user_id),
        INDEX idx_alamatak_students_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,
      `CREATE TABLE IF NOT EXISTS alamatak_assessments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        gradebook_id INT NOT NULL,
        title VARCHAR(255) NOT NULL,
        strand VARCHAR(100) NULL,
        topic VARCHAR(255) NULL,
        assessment_date DATE NULL,
        source_import_id INT NULL,
        is_historical BOOLEAN NOT NULL DEFAULT FALSE,
        source_year VARCHAR(32) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (gradebook_id) REFERENCES alamatak_gradebooks(id) ON DELETE CASCADE,
        INDEX idx_alamatak_assessments_gradebook (gradebook_id),
        INDEX idx_alamatak_assessments_date (assessment_date),
        INDEX idx_alamatak_assessments_historical (is_historical)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,
      `CREATE TABLE IF NOT EXISTS alamatak_assessment_components (
        id INT AUTO_INCREMENT PRIMARY KEY,
        assessment_id INT NOT NULL,
        name VARCHAR(255) NOT NULL,
        maximum_score DECIMAL(10,2) NOT NULL DEFAULT 0,
        sort_order INT NOT NULL DEFAULT 0,
        component_type VARCHAR(32) NOT NULL DEFAULT 'input',
        calculation_type VARCHAR(32) NULL,
        source_component_ids JSON NULL,
        formula_definition JSON NULL,
        FOREIGN KEY (assessment_id) REFERENCES alamatak_assessments(id) ON DELETE CASCADE,
        INDEX idx_alamatak_components_assessment (assessment_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,
      `CREATE TABLE IF NOT EXISTS alamatak_marks (
        id INT AUTO_INCREMENT PRIMARY KEY,
        component_id INT NOT NULL,
        student_id INT NOT NULL,
        score DECIMAL(10,2) NULL,
        mark_status VARCHAR(32) NULL,
        comment TEXT NULL,
        follow_up_required BOOLEAN NOT NULL DEFAULT FALSE,
        provenance JSON NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (component_id) REFERENCES alamatak_assessment_components(id) ON DELETE CASCADE,
        FOREIGN KEY (student_id) REFERENCES alamatak_students(id) ON DELETE CASCADE,
        UNIQUE KEY uq_alamatak_mark (component_id, student_id),
        INDEX idx_alamatak_marks_student (student_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,
      `CREATE TABLE IF NOT EXISTS alamatak_grading_schemes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        gradebook_id INT NOT NULL,
        name VARCHAR(255) NOT NULL,
        source_import_id INT NULL,
        is_fallback BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (gradebook_id) REFERENCES alamatak_gradebooks(id) ON DELETE CASCADE,
        INDEX idx_alamatak_schemes_gradebook (gradebook_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,
      `CREATE TABLE IF NOT EXISTS alamatak_grading_components (
        id INT AUTO_INCREMENT PRIMARY KEY,
        scheme_id INT NOT NULL,
        component_key VARCHAR(100) NOT NULL,
        label VARCHAR(255) NOT NULL,
        maximum_score DECIMAL(10,2) NULL,
        FOREIGN KEY (scheme_id) REFERENCES alamatak_grading_schemes(id) ON DELETE CASCADE,
        UNIQUE KEY uq_alamatak_scheme_component (scheme_id, component_key),
        INDEX idx_alamatak_grading_components_scheme (scheme_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,
      `CREATE TABLE IF NOT EXISTS alamatak_grade_thresholds (
        id INT AUTO_INCREMENT PRIMARY KEY,
        grading_component_id INT NOT NULL,
        grade_label VARCHAR(16) NOT NULL,
        minimum_score DECIMAL(10,2) NOT NULL,
        FOREIGN KEY (grading_component_id) REFERENCES alamatak_grading_components(id) ON DELETE CASCADE,
        UNIQUE KEY uq_alamatak_threshold (grading_component_id, grade_label),
        INDEX idx_alamatak_threshold_component (grading_component_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,
      `CREATE TABLE IF NOT EXISTS alamatak_imports (
        id INT AUTO_INCREMENT PRIMARY KEY,
        gradebook_id INT NOT NULL,
        uploaded_by INT NOT NULL,
        original_filename VARCHAR(512) NOT NULL,
        academic_year VARCHAR(32) NULL,
        detected_class VARCHAR(255) NULL,
        detected_subject VARCHAR(100) NULL,
        workbook_type VARCHAR(64) NULL,
        metadata JSON NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (gradebook_id) REFERENCES alamatak_gradebooks(id) ON DELETE CASCADE,
        FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE RESTRICT,
        INDEX idx_alamatak_imports_gradebook (gradebook_id),
        INDEX idx_alamatak_imports_uploaded_by (uploaded_by)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,
      `CREATE TABLE IF NOT EXISTS alamatak_import_sheets (
        id INT AUTO_INCREMENT PRIMARY KEY,
        import_id INT NOT NULL,
        sheet_name VARCHAR(255) NOT NULL,
        visibility ENUM('visible', 'hidden') NOT NULL DEFAULT 'visible',
        classification VARCHAR(64) NOT NULL,
        source_year VARCHAR(32) NULL,
        selected BOOLEAN NOT NULL DEFAULT FALSE,
        row_count INT NOT NULL DEFAULT 0,
        column_count INT NOT NULL DEFAULT 0,
        raw_rows JSON NULL,
        diagnostics JSON NULL,
        FOREIGN KEY (import_id) REFERENCES alamatak_imports(id) ON DELETE CASCADE,
        INDEX idx_alamatak_import_sheets_import (import_id),
        INDEX idx_alamatak_import_sheets_classification (classification)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,
      `CREATE TABLE IF NOT EXISTS alamatak_historical_records (
        id INT AUTO_INCREMENT PRIMARY KEY,
        gradebook_id INT NOT NULL,
        student_id INT NULL,
        import_id INT NULL,
        record_type VARCHAR(64) NOT NULL,
        source_year VARCHAR(32) NOT NULL,
        payload JSON NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (gradebook_id) REFERENCES alamatak_gradebooks(id) ON DELETE CASCADE,
        FOREIGN KEY (student_id) REFERENCES alamatak_students(id) ON DELETE SET NULL,
        FOREIGN KEY (import_id) REFERENCES alamatak_imports(id) ON DELETE SET NULL,
        INDEX idx_alamatak_history_gradebook (gradebook_id),
        INDEX idx_alamatak_history_student (student_id),
        INDEX idx_alamatak_history_year (source_year)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`
    ];
    for (const statement of alamatakStatements) {
      await pool.query(statement);
    }
    try {
      await pool.query('ALTER TABLE alamatak_gradebooks ADD COLUMN description TEXT NULL AFTER title');
    } catch (error) {
      if (!/duplicate column/i.test(error.message || '')) throw error;
    }
    try {
      await pool.query('ALTER TABLE alamatak_marks ADD COLUMN provenance JSON NULL AFTER follow_up_required');
    } catch (error) {
      if (!/duplicate column/i.test(error.message || '')) throw error;
    }
    try { await pool.query('ALTER TABLE alamatak_students ADD COLUMN source_import_id INT NULL AFTER notes'); } catch (error) { if (!/duplicate column/i.test(error.message || '')) throw error; }
    try { await pool.query("ALTER TABLE alamatak_assessment_components ADD COLUMN component_type VARCHAR(32) NOT NULL DEFAULT 'input' AFTER sort_order"); } catch (error) { if (!/duplicate column/i.test(error.message || '')) throw error; }
    try { await pool.query("ALTER TABLE alamatak_assessment_components ADD COLUMN calculation_type VARCHAR(32) NULL AFTER component_type"); } catch (error) { if (!/duplicate column/i.test(error.message || '')) throw error; }
    try { await pool.query("ALTER TABLE alamatak_assessment_components ADD COLUMN source_component_ids JSON NULL AFTER calculation_type"); } catch (error) { if (!/duplicate column/i.test(error.message || '')) throw error; }
    try { await pool.query("ALTER TABLE alamatak_assessment_components ADD COLUMN formula_definition JSON NULL AFTER source_component_ids"); } catch (error) { if (!/duplicate column/i.test(error.message || '')) throw error; }
    try { await pool.query('ALTER TABLE alamatak_students ADD CONSTRAINT fk_alamatak_student_import FOREIGN KEY (source_import_id) REFERENCES alamatak_imports(id) ON DELETE SET NULL'); } catch (error) { if (!/(duplicate|already exists)/i.test(error.message || '')) throw error; }
    try { await pool.query('ALTER TABLE alamatak_imports ADD COLUMN source_fingerprint CHAR(64) NULL AFTER metadata'); } catch (error) { if (!/duplicate column/i.test(error.message || '')) throw error; }
    try { await pool.query("ALTER TABLE alamatak_imports ADD COLUMN status ENUM('completed','rolled_back','failed') NOT NULL DEFAULT 'completed' AFTER source_fingerprint"); } catch (error) { if (!/duplicate column/i.test(error.message || '')) throw error; }
    try { await pool.query('ALTER TABLE alamatak_imports ADD COLUMN completed_at TIMESTAMP NULL AFTER status'); } catch (error) { if (!/duplicate column/i.test(error.message || '')) throw error; }
    try { await pool.query('ALTER TABLE alamatak_imports ADD COLUMN rolled_back_at TIMESTAMP NULL AFTER completed_at'); } catch (error) { if (!/duplicate column/i.test(error.message || '')) throw error; }
    try { await pool.query('ALTER TABLE alamatak_imports ADD UNIQUE KEY uq_alamatak_import_fingerprint (gradebook_id, source_fingerprint)'); } catch (error) { if (!/duplicate (key name|entry)/i.test(error.message || '')) throw error; }
    await pool.query(`CREATE TABLE IF NOT EXISTS alamatak_student_aliases (
      id INT AUTO_INCREMENT PRIMARY KEY, student_id INT NOT NULL, alias_name VARCHAR(255) NOT NULL,
      normalized_alias VARCHAR(255) NOT NULL, source VARCHAR(64) NOT NULL DEFAULT 'teacher',
      created_by INT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (student_id) REFERENCES alamatak_students(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
      UNIQUE KEY uq_alamatak_student_alias (student_id, normalized_alias),
      INDEX idx_alamatak_alias_normalized (normalized_alias)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`);
    await pool.query(`CREATE TABLE IF NOT EXISTS alamatak_student_merge_audits (
      id INT AUTO_INCREMENT PRIMARY KEY, actor_user_id INT NOT NULL, gradebook_id INT NOT NULL,
      source_student_id INT NULL, destination_student_id INT NULL, summary JSON NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE RESTRICT,
      FOREIGN KEY (gradebook_id) REFERENCES alamatak_gradebooks(id) ON DELETE CASCADE,
      FOREIGN KEY (source_student_id) REFERENCES alamatak_students(id) ON DELETE SET NULL,
      FOREIGN KEY (destination_student_id) REFERENCES alamatak_students(id) ON DELETE SET NULL,
      INDEX idx_alamatak_merge_gradebook (gradebook_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`);
    await pool.query(`CREATE TABLE IF NOT EXISTS alamatak_final_grade_configs (
      id INT AUTO_INCREMENT PRIMARY KEY, gradebook_id INT NOT NULL UNIQUE, scheme_id INT NULL,
      status ENUM('draft','finalized') NOT NULL DEFAULT 'draft', finalized_by INT NULL,
      finalized_at TIMESTAMP NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (gradebook_id) REFERENCES alamatak_gradebooks(id) ON DELETE CASCADE,
      FOREIGN KEY (scheme_id) REFERENCES alamatak_grading_schemes(id) ON DELETE SET NULL,
      FOREIGN KEY (finalized_by) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`);
    await pool.query(`CREATE TABLE IF NOT EXISTS alamatak_final_grade_categories (
      id INT AUTO_INCREMENT PRIMARY KEY, config_id INT NOT NULL, name VARCHAR(255) NOT NULL,
      weight DECIMAL(8,3) NOT NULL DEFAULT 0, calculation_method VARCHAR(32) NOT NULL DEFAULT 'weighted_average',
      sort_order INT NOT NULL DEFAULT 0, FOREIGN KEY (config_id) REFERENCES alamatak_final_grade_configs(id) ON DELETE CASCADE,
      INDEX idx_alamatak_final_categories_config (config_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`);
    await pool.query(`CREATE TABLE IF NOT EXISTS alamatak_final_grade_items (
      id INT AUTO_INCREMENT PRIMARY KEY, category_id INT NOT NULL, assessment_id INT NOT NULL, component_id INT NOT NULL,
      weight DECIMAL(8,3) NOT NULL DEFAULT 1, FOREIGN KEY (category_id) REFERENCES alamatak_final_grade_categories(id) ON DELETE CASCADE,
      FOREIGN KEY (assessment_id) REFERENCES alamatak_assessments(id) ON DELETE CASCADE,
      FOREIGN KEY (component_id) REFERENCES alamatak_assessment_components(id) ON DELETE CASCADE,
      UNIQUE KEY uq_alamatak_final_item (category_id, component_id), INDEX idx_alamatak_final_items_assessment (assessment_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`);
    await pool.query(`CREATE TABLE IF NOT EXISTS alamatak_analytics_settings (
      id INT AUTO_INCREMENT PRIMARY KEY, gradebook_id INT NOT NULL UNIQUE,
      low_average_threshold DECIMAL(5,2) NOT NULL DEFAULT 50,
      missing_assessments_threshold INT NOT NULL DEFAULT 2,
      completion_threshold DECIMAL(5,2) NOT NULL DEFAULT 80,
      decline_threshold DECIMAL(5,2) NOT NULL DEFAULT 5,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (gradebook_id) REFERENCES alamatak_gradebooks(id) ON DELETE CASCADE,
      INDEX idx_alamatak_analytics_settings_gradebook (gradebook_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`);
    await pool.query(`CREATE TABLE IF NOT EXISTS alamatak_checkpoints (
      id INT AUTO_INCREMENT PRIMARY KEY,
      gradebook_id INT NOT NULL,
      created_by INT NOT NULL,
      reason VARCHAR(100) NOT NULL DEFAULT 'pre_restore',
      description VARCHAR(255) NULL,
      manifest JSON NOT NULL,
      snapshot JSON NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (gradebook_id) REFERENCES alamatak_gradebooks(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_alamatak_checkpoints_gradebook (gradebook_id),
      INDEX idx_alamatak_checkpoints_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`);
    console.log('✔ 3alamatak tables verified.');

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
