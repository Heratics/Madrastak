-- =======================================================
-- Madrastak Database Schema (MySQL)
-- =======================================================

-- 1. Users Table
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('student', 'teacher', 'admin') NOT NULL DEFAULT 'student',
  account_status ENUM('active', 'pending', 'rejected', 'suspended') NOT NULL DEFAULT 'active',
  bio TEXT NULL,
  profile_pic VARCHAR(500) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_users_role (role),
  INDEX idx_users_account_status (account_status),
  INDEX idx_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Administrative action history
CREATE TABLE IF NOT EXISTS admin_actions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  admin_id INT NOT NULL,
  target_user_id INT NOT NULL,
  action ENUM('approve_teacher', 'reject_teacher') NOT NULL,
  previous_status ENUM('active', 'pending', 'rejected', 'suspended') NOT NULL,
  new_status ENUM('active', 'pending', 'rejected', 'suspended') NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_admin_actions_admin (admin_id),
  INDEX idx_admin_actions_target (target_user_id),
  INDEX idx_admin_actions_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. One-time first-admin bootstrap marker
CREATE TABLE IF NOT EXISTS admin_bootstrap (
  id TINYINT UNSIGNED PRIMARY KEY,
  admin_id INT NULL,
  completed_at TIMESTAMP NULL,
  FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. 3alamatak persistent gradebook domain
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS alamatak_students (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS alamatak_assessments (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS alamatak_assessment_components (
  id INT AUTO_INCREMENT PRIMARY KEY,
  assessment_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  maximum_score DECIMAL(10,2) NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  FOREIGN KEY (assessment_id) REFERENCES alamatak_assessments(id) ON DELETE CASCADE,
  INDEX idx_alamatak_components_assessment (assessment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS alamatak_marks (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS alamatak_grading_schemes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  gradebook_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  source_import_id INT NULL,
  is_fallback BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (gradebook_id) REFERENCES alamatak_gradebooks(id) ON DELETE CASCADE,
  INDEX idx_alamatak_schemes_gradebook (gradebook_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS alamatak_grading_components (
  id INT AUTO_INCREMENT PRIMARY KEY,
  scheme_id INT NOT NULL,
  component_key VARCHAR(100) NOT NULL,
  label VARCHAR(255) NOT NULL,
  maximum_score DECIMAL(10,2) NULL,
  FOREIGN KEY (scheme_id) REFERENCES alamatak_grading_schemes(id) ON DELETE CASCADE,
  UNIQUE KEY uq_alamatak_scheme_component (scheme_id, component_key),
  INDEX idx_alamatak_grading_components_scheme (scheme_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS alamatak_grade_thresholds (
  id INT AUTO_INCREMENT PRIMARY KEY,
  grading_component_id INT NOT NULL,
  grade_label VARCHAR(16) NOT NULL,
  minimum_score DECIMAL(10,2) NOT NULL,
  FOREIGN KEY (grading_component_id) REFERENCES alamatak_grading_components(id) ON DELETE CASCADE,
  UNIQUE KEY uq_alamatak_threshold (grading_component_id, grade_label),
  INDEX idx_alamatak_threshold_component (grading_component_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS alamatak_imports (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS alamatak_import_sheets (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS alamatak_historical_records (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Live Classes Table
CREATE TABLE IF NOT EXISTS live_classes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  teacher_id INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  start_time DATETIME NOT NULL,
  duration_minutes INT NOT NULL DEFAULT 60,
  meeting_room_id VARCHAR(255) NOT NULL,
  student_limit INT NULL DEFAULT NULL, -- NULL indicates unlimited capacity
  status ENUM('scheduled', 'live', 'ended') NOT NULL DEFAULT 'scheduled',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_classes_teacher (teacher_id),
  INDEX idx_classes_start_time (start_time),
  INDEX idx_classes_status (status),
  INDEX idx_classes_room (meeting_room_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Class Bookings Table
CREATE TABLE IF NOT EXISTS class_bookings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  student_id INT NOT NULL,
  class_id INT NOT NULL,
  booked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (class_id) REFERENCES live_classes(id) ON DELETE CASCADE,
  UNIQUE KEY unique_booking (student_id, class_id),
  INDEX idx_bookings_student (student_id),
  INDEX idx_bookings_class (class_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Class Attendance / Session Tracking Table
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
