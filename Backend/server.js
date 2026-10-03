const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const multer = require('multer');
require('dotenv').config();
const db = require('./db');
const { generateJaasToken } = require('./jaas');
const { seedAdmin } = require('./seed-admin');
const workbookParser = require('./workbookParser');

const app = express();

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Global error handler for body-parser entity too large and syntax errors
app.use((err, req, res, next) => {
  if (err && (err.type === 'entity.too.large' || err.status === 413)) {
    return res.status(413).json({ message: 'Payload Too Large: Request body exceeds the 20 MB limit.' });
  }
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ message: 'Invalid JSON payload.' });
  }
  next(err);
});

// Multer memory storage configuration for 3alamatak Excel/delimited imports
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024, // 20 MB
  },
  fileFilter: (req, file, cb) => {
    const allowed = /\.(xlsx|xls|csv|tsv|txt)$/i.test(file.originalname);
    if (!allowed) {
      const error = new Error('Invalid file format. Please upload an Excel (.xlsx, .xls) or delimited text (.csv, .tsv, .txt) file.');
      error.status = 400;
      return cb(error);
    }
    cb(null, true);
  },
});

function handleUpload(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ message: 'Payload Too Large: File exceeds the 20 MB limit.' });
      }
      return res.status(400).json({ message: `Upload error: ${err.message}` });
    } else if (err) {
      const status = err.status || 400;
      return res.status(status).json({ message: err.message || 'File upload failed.' });
    }
    next();
  });
}

function handleOptionalUpload(req, res, next) {
  const contentType = req.headers['content-type'] || '';
  if (contentType.includes('multipart/form-data')) {
    return handleUpload(req, res, next);
  }
  next();
}


// ==========================================
// Helper Functions
// ==========================================

/**
 * Validates class input fields strictly on the server side.
 */
function validateClassInput({ title, description, start_time, duration_minutes, student_limit }) {
  if (!title || typeof title !== 'string' || title.trim().length < 3 || title.trim().length > 200) {
    return { valid: false, error: 'Title is required and must be between 3 and 200 characters.' };
  }

  if (!description || typeof description !== 'string' || description.trim().length < 5 || description.trim().length > 3000) {
    return { valid: false, error: 'Description is required and must be between 5 and 3000 characters.' };
  }

  const start = new Date(start_time);
  if (isNaN(start.getTime())) {
    return { valid: false, error: 'Invalid start time format.' };
  }

  // Allow up to 10 minutes in the past to account for slight clock skew or user filling the form
  const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
  if (start.getTime() < tenMinutesAgo) {
    return { valid: false, error: 'Start time cannot be in the past.' };
  }

  const twoYearsFromNow = Date.now() + (2 * 365 * 24 * 60 * 60 * 1000);
  if (start.getTime() > twoYearsFromNow) {
    return { valid: false, error: 'Start time cannot be more than 2 years in the future.' };
  }

  const duration = parseInt(duration_minutes, 10);
  if (isNaN(duration) || duration <= 0) {
    return { valid: false, error: 'Duration must be a positive number of minutes.' };
  }

  // 999999 represents unlimited duration; otherwise max 24 hours (1440 minutes)
  if (duration > 1440 && duration !== 999999) {
    return { valid: false, error: 'Duration cannot exceed 24 hours (1440 minutes).' };
  }

  if (student_limit === undefined || student_limit === null || student_limit === '' || student_limit === 'unlimited') {
    return { valid: false, error: 'Student limit is required and must be between 1 and 20 (maximum 20 students).' };
  }

  const parsedLimit = Number(student_limit);
  if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 20) {
    return { valid: false, error: 'Student limit must be an integer between 1 and 20 (maximum 20 students).' };
  }
  const limit = parsedLimit;

  return { valid: true, sanitizedLimit: limit, sanitizedDuration: duration };
}

/**
 * Ensures any date/datetime representation (Date object, UTC string, or MySQL DATETIME)
 * is normalized to a valid ISO 8601 string with UTC indicator 'Z'.
 */
function normalizeToIsoString(dt) {
  if (!dt) return null;
  if (dt instanceof Date) {
    return isNaN(dt.getTime()) ? null : dt.toISOString();
  }
  if (typeof dt === 'string') {
    // If it already contains timezone indicators ('Z' or +HH:mm / -HH:mm)
    if (dt.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(dt)) {
      const parsed = new Date(dt);
      return isNaN(parsed.getTime()) ? null : parsed.toISOString();
    }
    // MySQL format: 'YYYY-MM-DD HH:mm:ss' stored as UTC
    const utcParsed = new Date(dt.replace(' ', 'T') + 'Z');
    if (!isNaN(utcParsed.getTime())) {
      return utcParsed.toISOString();
    }
    const fallback = new Date(dt);
    return isNaN(fallback.getTime()) ? null : fallback.toISOString();
  }
  const fallback = new Date(dt);
  return isNaN(fallback.getTime()) ? null : fallback.toISOString();
}

/**
 * Computes the real-time lecture status (scheduled, live, ended) based on time and manual overrides.
 * Automatically updates the database when an active/scheduled class has ended.
 */
function evaluateClassStatus(cls) {
  if (cls.status === 'ended') return 'ended';

  const normalized = normalizeToIsoString(cls.start_time);
  const startTime = normalized ? new Date(normalized).getTime() : NaN;
  if (isNaN(startTime)) return 'scheduled';

  const durationMinutes = Number(cls.duration_minutes) || 60;
  const now = Date.now();

  // If duration is not unlimited, check if scheduled duration has elapsed
  if (durationMinutes < 999999) {
    const endTime = startTime + (durationMinutes * 60 * 1000);
    if (now >= endTime) {
      // Safe async update only if status column exists
      db.query('UPDATE live_classes SET status = ? WHERE id = ?', ['ended', cls.id]).catch(() => {});
      return 'ended';
    }
  }

  if (cls.status === 'live') {
    return 'live';
  }

  return 'scheduled';
}

// ==========================================
// Authentication Middleware
// ==========================================
const verifyToken = async (req, res, next) => {
  let token = null;
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (req.query && req.query.token) {
    token = req.query.token;
  } else if (req.body && req.body.token) {
    token = req.body.token;
  }

  if (!token) {
    return res.status(401).json({ message: 'Access Denied: No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const [users] = await db.query(
      'SELECT id, role, account_status FROM users WHERE id = ?',
      [decoded.id]
    );

    if (users.length === 0) {
      return res.status(401).json({ message: 'Access Denied: Account not found' });
    }

    const currentUser = users[0];
    if (currentUser.account_status === 'rejected' || currentUser.account_status === 'suspended') {
      return res.status(403).json({ message: 'Account access is not active.' });
    }

    // Use current database state instead of trusting stale role claims in a JWT.
    req.user = {
      ...decoded,
      id: currentUser.id,
      role: currentUser.role,
      account_status: currentUser.account_status
    };
    next();
  } catch (error) {
    res.status(401).json({ message: 'Access Denied: Invalid token' });
  }
};

const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin' || req.user.account_status !== 'active') {
    return res.status(403).json({ message: 'Administrator access required.' });
  }
  next();
};

const requireActiveTeacherOrAdmin = (req, res, next) => {
  const isActiveAdmin = req.user.role === 'admin' && req.user.account_status === 'active';
  const isActiveTeacher = req.user.role === 'teacher' && req.user.account_status === 'active';
  if (!isActiveAdmin && !isActiveTeacher) {
    return res.status(403).json({ message: 'An active teacher account is required.' });
  }
  next();
};

const requireActiveAccount = (req, res, next) => {
  if (req.user.account_status !== 'active') {
    return res.status(403).json({ message: 'Account approval is required for this action.' });
  }
  next();
};

const requireActiveStudentOrAdmin = (req, res, next) => {
  const isActiveAdmin = req.user.role === 'admin' && req.user.account_status === 'active';
  const isActiveStudent = req.user.role === 'student' && req.user.account_status === 'active';
  if (!isActiveAdmin && !isActiveStudent) {
    return res.status(403).json({ message: 'An active student account is required.' });
  }
  next();
};

// ==========================================
// System & Auth Routes
// ==========================================

// Health check route
app.get('/api/health', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT NOW() AS db_time');
    res.json({ status: 'healthy', db_time: rows[0].db_time });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// User Registration Route
app.post('/api/register', async (req, res) => {
  const { full_name, email, password, role } = req.body;

  if (!full_name || !email || !password) {
    return res.status(400).json({ message: 'Full name, email, and password are required.' });
  }

  try {
    const [existingUsers] = await db.query('SELECT email FROM users WHERE email = ?', [email]);
    if (existingUsers.length > 0) {
      return res.status(400).json({ message: 'Email is already in use.' });
    }

    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    // Public registration can create students or pending teachers only.
    const userRole = role === 'teacher' ? 'teacher' : 'student';
    const accountStatus = userRole === 'teacher' ? 'pending' : 'active';

    const [result] = await db.query(
      'INSERT INTO users (full_name, email, password_hash, role, account_status) VALUES (?, ?, ?, ?, ?)',
      [full_name, email, hashedPassword, userRole, accountStatus]
    );

    res.status(201).json({ message: 'User registered successfully!', userId: result.insertId });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// User Login Route
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required.' });
  }

  try {
    const [users] = await db.query(
      'SELECT id, full_name, email, password_hash, role, account_status FROM users WHERE email = ?',
      [email]
    );
    if (users.length === 0) {
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    const user = users[0];
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      message: 'Login successful!',
      token,
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        role: user.role,
        account_status: user.account_status
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// ==========================================
// Administrator Routes
// ==========================================
app.get('/api/admin/overview', verifyToken, requireAdmin, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        COUNT(*) AS total_users,
        SUM(role = 'student') AS total_students,
        SUM(role = 'teacher') AS total_teachers,
        SUM(role = 'teacher' AND account_status = 'pending') AS pending_teachers,
        SUM(role = 'admin') AS total_admins
      FROM users
    `);
    const overview = rows[0] || {};
    res.json({
      total_users: Number(overview.total_users) || 0,
      total_students: Number(overview.total_students) || 0,
      total_teachers: Number(overview.total_teachers) || 0,
      pending_teachers: Number(overview.pending_teachers) || 0,
      total_admins: Number(overview.total_admins) || 0
    });
  } catch (error) {
    console.error('Admin overview error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

app.get('/api/admin/users', verifyToken, requireAdmin, async (req, res) => {
  const { search = '', role, status } = req.query;
  const conditions = [];
  const values = [];

  if (search.trim()) {
    conditions.push('(full_name LIKE ? OR email LIKE ?)');
    values.push(`%${search.trim()}%`, `%${search.trim()}%`);
  }
  if (['student', 'teacher', 'admin'].includes(role)) {
    conditions.push('role = ?');
    values.push(role);
  }
  if (['active', 'pending', 'rejected', 'suspended'].includes(status)) {
    conditions.push('account_status = ?');
    values.push(status);
  }

  try {
    const [users] = await db.query(
      `SELECT id, full_name, email, role, account_status, created_at
       FROM users
       ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
       ORDER BY created_at DESC`,
      values
    );
    res.json(users);
  } catch (error) {
    console.error('Admin users error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

app.get('/api/admin/pending-teachers', verifyToken, requireAdmin, async (req, res) => {
  try {
    const [teachers] = await db.query(
      `SELECT id, full_name, email, account_status, created_at
       FROM users
       WHERE role = 'teacher' AND account_status = 'pending'
       ORDER BY created_at ASC`
    );
    res.json(teachers);
  } catch (error) {
    console.error('Pending teachers error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

async function decideTeacherStatus(req, res, nextStatus, action) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [teachers] = await connection.query(
      `SELECT id, role, account_status
       FROM users
       WHERE id = ?
       FOR UPDATE`,
      [req.params.id]
    );

    if (teachers.length === 0 || teachers[0].role !== 'teacher') {
      await connection.rollback();
      return res.status(404).json({ message: 'Teacher account not found.' });
    }
    if (teachers[0].account_status !== 'pending') {
      await connection.rollback();
      return res.status(409).json({ message: 'Only pending teachers can be reviewed.' });
    }

    await connection.query(
      'UPDATE users SET account_status = ? WHERE id = ?',
      [nextStatus, req.params.id]
    );
    await connection.query(
      `INSERT INTO admin_actions
       (admin_id, target_user_id, action, previous_status, new_status)
       VALUES (?, ?, ?, ?, ?)`,
      [req.user.id, req.params.id, action, teachers[0].account_status, nextStatus]
    );
    await connection.commit();

    console.info(`[Admin] ${action} admin=${req.user.id} teacher=${req.params.id}`);
    res.json({ message: `Teacher ${nextStatus === 'active' ? 'approved' : 'rejected'} successfully.` });
  } catch (error) {
    await connection.rollback();
    console.error(`Admin ${action} error:`, error);
    next(error);
  } finally {
    connection.release();
  }
}

app.post('/api/admin/teachers/:id/approve', verifyToken, requireAdmin, (req, res, next) => {
  decideTeacherStatus(req, res, 'active', 'approve_teacher').catch(next);
});

app.post('/api/admin/teachers/:id/reject', verifyToken, requireAdmin, (req, res, next) => {
  decideTeacherStatus(req, res, 'rejected', 'reject_teacher').catch(next);
});

app.post('/api/admin/users/:id/reset-password', verifyToken, requireAdmin, async (req, res) => {
  const targetUserId = parseInt(req.params.id, 10);
  if (isNaN(targetUserId) || targetUserId <= 0) {
    return res.status(400).json({ message: 'Invalid target user ID.' });
  }

  const { new_password } = req.body || {};
  if (!new_password || typeof new_password !== 'string') {
    return res.status(400).json({ message: 'New password is required.' });
  }

  if (new_password.length < 8) {
    return res.status(400).json({ message: 'New password must be at least 8 characters long.' });
  }

  if (new_password.length > 128) {
    return res.status(400).json({ message: 'New password must not exceed 128 characters.' });
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const [users] = await connection.query(
      'SELECT id, full_name, email, role, account_status FROM users WHERE id = ? FOR UPDATE',
      [targetUserId]
    );

    if (users.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: 'User not found.' });
    }

    const targetUser = users[0];
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(new_password, saltRounds);

    await connection.query(
      'UPDATE users SET password_hash = ? WHERE id = ?',
      [hashedPassword, targetUserId]
    );

    await connection.query(
      `INSERT INTO admin_actions
       (admin_id, target_user_id, action, previous_status, new_status)
       VALUES (?, ?, 'password_reset', ?, ?)`,
      [req.user.id, targetUserId, targetUser.account_status, targetUser.account_status]
    );

    await connection.commit();

    console.info(`[Admin] password_reset admin=${req.user.id} target_user=${targetUserId}`);
    return res.json({
      message: 'Password reset successfully. The user must now log in with the new password.'
    });
  } catch (error) {
    await connection.rollback();
    console.error('Admin password reset error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  } finally {
    connection.release();
  }
});

app.post('/api/admin/users/:id/suspend', verifyToken, requireAdmin, async (req, res) => {
  const targetUserId = parseInt(req.params.id, 10);
  if (isNaN(targetUserId) || targetUserId <= 0) {
    return res.status(400).json({ message: 'Invalid target user ID.' });
  }
  if (targetUserId === req.user.id) {
    return res.status(400).json({ message: 'You cannot suspend your own administrative account.' });
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [users] = await connection.query(
      'SELECT id, full_name, email, role, account_status FROM users WHERE id = ? FOR UPDATE',
      [targetUserId]
    );

    if (users.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: 'User not found.' });
    }

    const targetUser = users[0];
    if (targetUser.account_status === 'suspended') {
      await connection.rollback();
      return res.status(400).json({ message: 'User account is already suspended.' });
    }

    await connection.query('UPDATE users SET account_status = ? WHERE id = ?', ['suspended', targetUserId]);
    await connection.query(
      `INSERT INTO admin_actions
       (admin_id, target_user_id, action, previous_status, new_status)
       VALUES (?, ?, 'suspend_user', ?, 'suspended')`,
      [req.user.id, targetUserId, targetUser.account_status]
    );
    await connection.commit();

    console.info(`[Admin] suspend_user admin=${req.user.id} target_user=${targetUserId}`);
    return res.json({ message: 'User account suspended successfully.' });
  } catch (error) {
    await connection.rollback();
    console.error('Admin suspend user error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  } finally {
    connection.release();
  }
});

app.post('/api/admin/users/:id/reactivate', verifyToken, requireAdmin, async (req, res) => {
  const targetUserId = parseInt(req.params.id, 10);
  if (isNaN(targetUserId) || targetUserId <= 0) {
    return res.status(400).json({ message: 'Invalid target user ID.' });
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [users] = await connection.query(
      'SELECT id, full_name, email, role, account_status FROM users WHERE id = ? FOR UPDATE',
      [targetUserId]
    );

    if (users.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: 'User not found.' });
    }

    const targetUser = users[0];
    if (targetUser.account_status === 'active') {
      await connection.rollback();
      return res.status(400).json({ message: 'User account is already active.' });
    }

    await connection.query('UPDATE users SET account_status = ? WHERE id = ?', ['active', targetUserId]);
    await connection.query(
      `INSERT INTO admin_actions
       (admin_id, target_user_id, action, previous_status, new_status)
       VALUES (?, ?, 'reactivate_user', ?, 'active')`,
      [req.user.id, targetUserId, targetUser.account_status]
    );
    await connection.commit();

    console.info(`[Admin] reactivate_user admin=${req.user.id} target_user=${targetUserId}`);
    return res.json({ message: 'User account reactivated successfully.' });
  } catch (error) {
    await connection.rollback();
    console.error('Admin reactivate user error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  } finally {
    connection.release();
  }
});

app.delete('/api/admin/users/:id', verifyToken, requireAdmin, async (req, res) => {
  const targetUserId = parseInt(req.params.id, 10);
  if (isNaN(targetUserId) || targetUserId <= 0) {
    return res.status(400).json({ message: 'Invalid target user ID.' });
  }
  if (targetUserId === req.user.id) {
    return res.status(400).json({ message: 'You cannot delete your own administrative account.' });
  }

  try {
    // Check foreign keys and dependent records before deletion to prevent data corruption
    const [
      [classes],
      [bookings],
      [gradebooks],
      [imports],
      [attendance],
      [adminActions]
    ] = await Promise.all([
      db.query('SELECT COUNT(*) AS count FROM live_classes WHERE teacher_id = ?', [targetUserId]),
      db.query('SELECT COUNT(*) AS count FROM class_bookings WHERE student_id = ?', [targetUserId]),
      db.query('SELECT COUNT(*) AS count FROM alamatak_gradebooks WHERE owner_user_id = ?', [targetUserId]),
      db.query('SELECT COUNT(*) AS count FROM alamatak_imports WHERE uploaded_by = ?', [targetUserId]),
      db.query('SELECT COUNT(*) AS count FROM class_attendance WHERE user_id = ?', [targetUserId]),
      db.query('SELECT COUNT(*) AS count FROM admin_actions WHERE admin_id = ?', [targetUserId]),
    ]);

    const conflicts = [];
    if (classes[0].count > 0) conflicts.push(`${classes[0].count} live class(es)`);
    if (bookings[0].count > 0) conflicts.push(`${bookings[0].count} class booking(s)`);
    if (gradebooks[0].count > 0) conflicts.push(`${gradebooks[0].count} 3alamatak gradebook(s)`);
    if (imports[0].count > 0) conflicts.push(`${imports[0].count} gradebook import(s)`);
    if (attendance[0].count > 0) conflicts.push(`${attendance[0].count} attendance record(s)`);
    if (adminActions[0].count > 0) conflicts.push(`${adminActions[0].count} admin action log(s)`);

    if (conflicts.length > 0) {
      return res.status(409).json({
        message: `Cannot delete account because it is referenced by existing records (${conflicts.join(', ')}). Consider suspending the account instead to preserve educational history.`
      });
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [users] = await connection.query(
        'SELECT id, full_name, email, role, account_status FROM users WHERE id = ? FOR UPDATE',
        [targetUserId]
      );

      if (users.length === 0) {
        await connection.rollback();
        return res.status(404).json({ message: 'User not found.' });
      }

      const targetUser = users[0];

      // Audit log the deletion before removing user record (target_user_id is set to null on cascade)
      await connection.query(
        `INSERT INTO admin_actions
         (admin_id, target_user_id, action, previous_status, new_status)
         VALUES (?, ?, 'delete_account', ?, 'deleted')`,
        [req.user.id, targetUserId, targetUser.account_status]
      );

      await connection.query('DELETE FROM users WHERE id = ?', [targetUserId]);
      await connection.commit();

      console.info(`[Admin] delete_account admin=${req.user.id} target_user=${targetUserId} email=${targetUser.email}`);
      return res.json({ message: 'User account deleted successfully.' });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Admin delete user error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});


// ==========================================
// 3alamatak Gradebook Routes
// ==========================================
async function getAlamatakGradebook(req, gradebookId) {
  const params = [gradebookId];
  let ownership = '';
  if (req.user.role !== 'admin') {
    ownership = ' AND g.owner_user_id = ?';
    params.push(req.user.id);
  }

  const [rows] = await db.query(
    `SELECT g.id, g.owner_user_id, g.madrastak_class_id, g.title, g.subject,
            g.academic_year, g.status, g.created_at, g.updated_at
     FROM alamatak_gradebooks g
     WHERE g.id = ?${ownership}`,
    params
  );
  return rows[0] || null;
}

function validateGradebookPayload({ title, academic_year }) {
  if (!title || typeof title !== 'string' || title.trim().length < 2 || title.trim().length > 255) {
    return 'A gradebook title between 2 and 255 characters is required.';
  }
  if (!academic_year || typeof academic_year !== 'string' || academic_year.trim().length > 32) {
    return 'An academic year is required.';
  }
  return null;
}

function validateStudentPayload({ display_name, first_name, last_name }) {
  const displayName = String(display_name || `${first_name || ''} ${last_name || ''}`).trim();
  if (!displayName || displayName.length > 255) return null;
  return displayName;
}

async function validateLinkedStudent(linkedUserId) {
  if (linkedUserId === undefined || linkedUserId === null || linkedUserId === '') return null;
  const [rows] = await db.query(
    `SELECT id FROM users
     WHERE id = ? AND role = 'student' AND account_status = 'active'`,
    [linkedUserId]
  );
  return rows.length ? Number(rows[0].id) : false;
}

app.get('/api/3alamatak/gradebooks', verifyToken, requireActiveTeacherOrAdmin, async (req, res) => {
  try {
    const params = [];
    const ownership = req.user.role === 'admin' ? '' : 'WHERE g.owner_user_id = ?';
    if (req.user.role !== 'admin') params.push(req.user.id);
    const [gradebooks] = await db.query(
      `SELECT g.id, g.owner_user_id, g.madrastak_class_id, g.title, g.subject,
              g.academic_year, g.status, g.created_at, g.updated_at,
              COUNT(DISTINCT s.id) AS student_count
       FROM alamatak_gradebooks g
       LEFT JOIN alamatak_students s ON s.gradebook_id = g.id AND s.status <> 'archived'
       ${ownership}
       GROUP BY g.id
       ORDER BY g.updated_at DESC`,
      params
    );
    res.json(gradebooks);
  } catch (error) {
    console.error('3alamatak gradebook list error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

app.post('/api/3alamatak/gradebooks', verifyToken, requireActiveTeacherOrAdmin, async (req, res) => {
  const { title, subject = null, academic_year, madrastak_class_id = null } = req.body || {};
  const validationError = validateGradebookPayload({ title, academic_year });
  if (validationError) return res.status(400).json({ message: validationError });

  try {
    let classId = madrastak_class_id || null;
    if (classId !== null) {
      const [classes] = await db.query(
        'SELECT id, teacher_id FROM live_classes WHERE id = ?',
        [classId]
      );
      if (!classes.length) return res.status(400).json({ message: 'Linked Madrastak class was not found.' });
      if (req.user.role !== 'admin' && Number(classes[0].teacher_id) !== Number(req.user.id)) {
        return res.status(403).json({ message: 'You cannot link a gradebook to another teacher’s class.' });
      }
    }

    const [result] = await db.query(
      `INSERT INTO alamatak_gradebooks
       (owner_user_id, madrastak_class_id, title, subject, academic_year)
       VALUES (?, ?, ?, ?, ?)`,
      [req.user.id, classId, title.trim(), subject ? String(subject).trim() : null, academic_year.trim()]
    );
    const gradebook = await getAlamatakGradebook(req, result.insertId);
    res.status(201).json(gradebook);
  } catch (error) {
    console.error('3alamatak gradebook create error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

app.get('/api/3alamatak/gradebooks/:id', verifyToken, requireActiveTeacherOrAdmin, async (req, res) => {
  try {
    const gradebook = await getAlamatakGradebook(req, req.params.id);
    if (!gradebook) return res.status(404).json({ message: 'Gradebook not found.' });
    res.json(gradebook);
  } catch (error) {
    console.error('3alamatak gradebook fetch error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

app.put('/api/3alamatak/gradebooks/:id', verifyToken, requireActiveTeacherOrAdmin, async (req, res) => {
  const { title, subject = null, academic_year, status } = req.body || {};
  const validationError = validateGradebookPayload({ title, academic_year });
  if (validationError) return res.status(400).json({ message: validationError });
  if (status !== undefined && !['active', 'archived'].includes(status)) {
    return res.status(400).json({ message: 'Invalid gradebook status.' });
  }

  try {
    const gradebook = await getAlamatakGradebook(req, req.params.id);
    if (!gradebook) return res.status(404).json({ message: 'Gradebook not found.' });
    await db.query(
      `UPDATE alamatak_gradebooks
       SET title = ?, subject = ?, academic_year = ?, status = COALESCE(?, status)
       WHERE id = ?`,
      [title.trim(), subject ? String(subject).trim() : null, academic_year.trim(), status || null, gradebook.id]
    );
    res.json(await getAlamatakGradebook(req, gradebook.id));
  } catch (error) {
    console.error('3alamatak gradebook update error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

app.delete('/api/3alamatak/gradebooks/:id', verifyToken, requireActiveTeacherOrAdmin, async (req, res) => {
  try {
    const gradebook = await getAlamatakGradebook(req, req.params.id);
    if (!gradebook) return res.status(404).json({ message: 'Gradebook not found.' });
    // Archive instead of deleting relational history and imported provenance.
    await db.query("UPDATE alamatak_gradebooks SET status = 'archived' WHERE id = ?", [gradebook.id]);
    res.json({ message: 'Gradebook archived.' });
  } catch (error) {
    console.error('3alamatak gradebook archive error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

app.get('/api/3alamatak/gradebooks/:id/students', verifyToken, requireActiveTeacherOrAdmin, async (req, res) => {
  try {
    const gradebook = await getAlamatakGradebook(req, req.params.id);
    if (!gradebook) return res.status(404).json({ message: 'Gradebook not found.' });
    const [students] = await db.query(
      `SELECT id, gradebook_id, linked_user_id, external_student_id, first_name,
              last_name, display_name, email, status, notes, created_at, updated_at
       FROM alamatak_students
       WHERE gradebook_id = ?
       ORDER BY display_name ASC`,
      [gradebook.id]
    );
    res.json(students);
  } catch (error) {
    console.error('3alamatak student list error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

app.post('/api/3alamatak/gradebooks/:id/students', verifyToken, requireActiveTeacherOrAdmin, async (req, res) => {
  const { first_name = '', last_name = '', display_name, email = null, external_student_id = null, linked_user_id = null, notes = null } = req.body || {};
  const displayName = validateStudentPayload({ display_name, first_name, last_name });
  if (!displayName) return res.status(400).json({ message: 'A valid student name is required.' });

  try {
    const gradebook = await getAlamatakGradebook(req, req.params.id);
    if (!gradebook) return res.status(404).json({ message: 'Gradebook not found.' });
    const linkedStudent = await validateLinkedStudent(linked_user_id);
    if (linkedStudent === false) return res.status(400).json({ message: 'linked_user_id must reference an active student account.' });
    const externalId = external_student_id ? String(external_student_id).trim() : null;
    if (externalId) {
      const [existing] = await db.query(
        'SELECT id FROM alamatak_students WHERE gradebook_id = ? AND external_student_id = ?',
        [gradebook.id, externalId]
      );
      if (existing.length) return res.status(409).json({ message: 'That external student ID already exists in this gradebook.' });
    }
    const [result] = await db.query(
      `INSERT INTO alamatak_students
       (gradebook_id, linked_user_id, external_student_id, first_name, last_name, display_name, email, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [gradebook.id, linkedStudent, externalId, String(first_name).trim(), String(last_name).trim(), displayName, email ? String(email).trim() : null, notes]
    );
    const [students] = await db.query('SELECT * FROM alamatak_students WHERE id = ?', [result.insertId]);
    res.status(201).json(students[0]);
  } catch (error) {
    console.error('3alamatak student create error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

app.put('/api/3alamatak/gradebooks/:id/students/:studentId', verifyToken, requireActiveTeacherOrAdmin, async (req, res) => {
  const { first_name = '', last_name = '', display_name, email = null, external_student_id = null, linked_user_id = null, status = 'active', notes = null } = req.body || {};
  const displayName = validateStudentPayload({ display_name, first_name, last_name });
  if (!displayName) return res.status(400).json({ message: 'A valid student name is required.' });
  if (!['active', 'inactive', 'archived'].includes(status)) return res.status(400).json({ message: 'Invalid student status.' });

  try {
    const gradebook = await getAlamatakGradebook(req, req.params.id);
    if (!gradebook) return res.status(404).json({ message: 'Gradebook not found.' });
    const linkedStudent = await validateLinkedStudent(linked_user_id);
    if (linkedStudent === false) return res.status(400).json({ message: 'linked_user_id must reference an active student account.' });
    const externalId = external_student_id ? String(external_student_id).trim() : null;
    const [result] = await db.query(
      `UPDATE alamatak_students
       SET linked_user_id = ?, external_student_id = ?, first_name = ?, last_name = ?,
           display_name = ?, email = ?, status = ?, notes = ?
       WHERE id = ? AND gradebook_id = ?`,
      [linkedStudent, externalId, String(first_name).trim(), String(last_name).trim(), displayName, email ? String(email).trim() : null, status, notes, req.params.studentId, gradebook.id]
    );
    if (!result.affectedRows) return res.status(404).json({ message: 'Student not found.' });
    const [students] = await db.query('SELECT * FROM alamatak_students WHERE id = ?', [req.params.studentId]);
    res.json(students[0]);
  } catch (error) {
    console.error('3alamatak student update error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

app.delete('/api/3alamatak/gradebooks/:id/students/:studentId', verifyToken, requireActiveTeacherOrAdmin, async (req, res) => {
  try {
    const gradebook = await getAlamatakGradebook(req, req.params.id);
    if (!gradebook) return res.status(404).json({ message: 'Gradebook not found.' });
    const [result] = await db.query(
      "UPDATE alamatak_students SET status = 'archived' WHERE id = ? AND gradebook_id = ?",
      [req.params.studentId, gradebook.id]
    );
    if (!result.affectedRows) return res.status(404).json({ message: 'Student not found.' });
    res.json({ message: 'Student archived.' });
  } catch (error) {
    console.error('3alamatak student archive error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

async function getOwnedAssessment(req, assessmentId) {
  const params = [assessmentId];
  const ownership = req.user.role === 'admin' ? '' : ' AND g.owner_user_id = ?';
  if (req.user.role !== 'admin') params.push(req.user.id);
  const [rows] = await db.query(
    `SELECT a.id, a.gradebook_id, a.title, a.strand, a.topic, a.assessment_date,
            a.source_import_id, a.is_historical, a.source_year
     FROM alamatak_assessments a
     JOIN alamatak_gradebooks g ON g.id = a.gradebook_id
     WHERE a.id = ?${ownership}`,
    params
  );
  return rows[0] || null;
}

function normalizeAssessmentComponents(components) {
  if (!Array.isArray(components) || components.length === 0) return null;
  const normalized = components.map((component, index) => ({
    name: String(component.name || '').trim(),
    maximum_score: Number(component.maximum_score ?? component.max),
    sort_order: Number.isInteger(component.sort_order) ? component.sort_order : index,
  }));
  if (normalized.some((component) => !component.name || !Number.isFinite(component.maximum_score) || component.maximum_score < 0)) return null;
  return normalized;
}

app.get('/api/3alamatak/gradebooks/:id/assessments', verifyToken, requireActiveTeacherOrAdmin, async (req, res) => {
  try {
    const gradebook = await getAlamatakGradebook(req, req.params.id);
    if (!gradebook) return res.status(404).json({ message: 'Gradebook not found.' });
    const [assessments] = await db.query(
      `SELECT id, gradebook_id, title, strand, topic, assessment_date,
              source_import_id, is_historical, source_year
       FROM alamatak_assessments
       WHERE gradebook_id = ?
       ORDER BY assessment_date IS NULL, assessment_date DESC, id DESC`,
      [gradebook.id]
    );
    const [components] = await db.query(
      `SELECT c.id, c.assessment_id, c.name, c.maximum_score, c.sort_order
       FROM alamatak_assessment_components c
       JOIN alamatak_assessments a ON a.id = c.assessment_id
       WHERE a.gradebook_id = ?
       ORDER BY c.assessment_id, c.sort_order, c.id`,
      [gradebook.id]
    );
    res.json(assessments.map((assessment) => ({
      ...assessment,
      components: components.filter((component) => component.assessment_id === assessment.id),
    })));
  } catch (error) {
    console.error('3alamatak assessment list error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

app.post('/api/3alamatak/gradebooks/:id/assessments', verifyToken, requireActiveTeacherOrAdmin, async (req, res) => {
  const { title, strand = null, topic = null, assessment_date = null, source_import_id = null, is_historical = false, source_year = null } = req.body || {};
  const components = normalizeAssessmentComponents(req.body?.components);
  if (!title || String(title).trim().length > 255 || !components) {
    return res.status(400).json({ message: 'Assessment title and valid components are required.' });
  }
  try {
    const gradebook = await getAlamatakGradebook(req, req.params.id);
    if (!gradebook) return res.status(404).json({ message: 'Gradebook not found.' });
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [assessmentResult] = await connection.query(
        `INSERT INTO alamatak_assessments
         (gradebook_id, title, strand, topic, assessment_date, source_import_id, is_historical, source_year)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [gradebook.id, String(title).trim(), strand, topic, assessment_date || null, source_import_id || null, Boolean(is_historical), source_year || null]
      );
      for (const component of components) {
        await connection.query(
          `INSERT INTO alamatak_assessment_components
           (assessment_id, name, maximum_score, sort_order) VALUES (?, ?, ?, ?)`,
          [assessmentResult.insertId, component.name, component.maximum_score, component.sort_order]
        );
      }
      await connection.commit();
      const [savedAssessment] = await db.query(
        'SELECT id, gradebook_id, title, strand, topic, assessment_date, source_import_id, is_historical, source_year FROM alamatak_assessments WHERE id = ?',
        [assessmentResult.insertId]
      );
      const [savedComponents] = await db.query(
        'SELECT id, assessment_id, name, maximum_score, sort_order FROM alamatak_assessment_components WHERE assessment_id = ? ORDER BY sort_order, id',
        [assessmentResult.insertId]
      );
      res.status(201).json({ ...savedAssessment[0], components: savedComponents });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('3alamatak assessment create error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

app.put('/api/3alamatak/assessments/:id', verifyToken, requireActiveTeacherOrAdmin, async (req, res) => {
  const { title, strand = null, topic = null, assessment_date = null, source_import_id = null, is_historical = false, source_year = null } = req.body || {};
  const components = normalizeAssessmentComponents(req.body?.components);
  if (!title || String(title).trim().length > 255 || !components) {
    return res.status(400).json({ message: 'Assessment title and valid components are required.' });
  }
  try {
    const assessment = await getOwnedAssessment(req, req.params.id);
    if (!assessment) return res.status(404).json({ message: 'Assessment not found.' });
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query(
        `UPDATE alamatak_assessments
         SET title = ?, strand = ?, topic = ?, assessment_date = ?, source_import_id = ?, is_historical = ?, source_year = ?
         WHERE id = ?`,
        [String(title).trim(), strand, topic, assessment_date || null, source_import_id || null, Boolean(is_historical), source_year || null, assessment.id]
      );
      await connection.query('DELETE FROM alamatak_assessment_components WHERE assessment_id = ?', [assessment.id]);
      for (const component of components) {
        await connection.query(
          `INSERT INTO alamatak_assessment_components
           (assessment_id, name, maximum_score, sort_order) VALUES (?, ?, ?, ?)`,
          [assessment.id, component.name, component.maximum_score, component.sort_order]
        );
      }
      await connection.commit();
      res.json({ id: assessment.id, gradebook_id: assessment.gradebook_id, title: String(title).trim(), components });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('3alamatak assessment update error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

app.delete('/api/3alamatak/assessments/:id', verifyToken, requireActiveTeacherOrAdmin, async (req, res) => {
  try {
    const assessment = await getOwnedAssessment(req, req.params.id);
    if (!assessment) return res.status(404).json({ message: 'Assessment not found.' });
    await db.query('DELETE FROM alamatak_assessments WHERE id = ?', [assessment.id]);
    res.json({ message: 'Assessment deleted.' });
  } catch (error) {
    console.error('3alamatak assessment delete error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

app.get('/api/3alamatak/assessments/:id/marks', verifyToken, requireActiveTeacherOrAdmin, async (req, res) => {
  try {
    const assessment = await getOwnedAssessment(req, req.params.id);
    if (!assessment) return res.status(404).json({ message: 'Assessment not found.' });
    const [marks] = await db.query(
      `SELECT m.id, m.component_id, m.student_id, m.score, m.mark_status,
              m.comment, m.follow_up_required
       FROM alamatak_marks m
       JOIN alamatak_assessment_components c ON c.id = m.component_id
       WHERE c.assessment_id = ?`,
      [assessment.id]
    );
    res.json(marks);
  } catch (error) {
    console.error('3alamatak marks list error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

app.put('/api/3alamatak/assessments/:id/marks', verifyToken, requireActiveTeacherOrAdmin, async (req, res) => {
  const entries = Array.isArray(req.body?.marks) ? req.body.marks : [];
  if (!entries.length) return res.status(400).json({ message: 'At least one mark entry is required.' });
  try {
    const assessment = await getOwnedAssessment(req, req.params.id);
    if (!assessment) return res.status(404).json({ message: 'Assessment not found.' });
    const [components] = await db.query(
      'SELECT id, maximum_score FROM alamatak_assessment_components WHERE assessment_id = ?',
      [assessment.id]
    );
    const componentMap = new Map(components.map((component) => [Number(component.id), Number(component.maximum_score)]));
    const studentIds = [...new Set(entries.map((entry) => Number(entry.student_id)).filter(Boolean))];
    const [students] = await db.query(
      `SELECT id FROM alamatak_students WHERE gradebook_id = ? AND id IN (?)`,
      [assessment.gradebook_id, studentIds]
    );
    const studentSet = new Set(students.map((student) => Number(student.id)));
    for (const entry of entries) {
      const studentId = Number(entry.student_id);
      const componentId = Number(entry.component_id);
      if (!studentSet.has(studentId) || !componentMap.has(componentId)) return res.status(400).json({ message: 'Mark entry references an invalid student or component.' });
      const score = entry.score === '' || entry.score === null || entry.score === undefined ? null : Number(entry.score);
      if (score !== null && (!Number.isFinite(score) || score < 0 || score > componentMap.get(componentId))) {
        return res.status(400).json({ message: 'A mark is outside its component maximum.' });
      }
    }
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      for (const entry of entries) {
        const score = entry.score === '' || entry.score === null || entry.score === undefined ? null : Number(entry.score);
        await connection.query(
          `INSERT INTO alamatak_marks
           (component_id, student_id, score, mark_status, comment, follow_up_required)
           VALUES (?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE score = VALUES(score), mark_status = VALUES(mark_status),
             comment = VALUES(comment), follow_up_required = VALUES(follow_up_required)`,
          [Number(entry.component_id), Number(entry.student_id), score, entry.mark_status || null, entry.comment || null, Boolean(entry.follow_up_required)]
        );
      }
      await connection.commit();
      res.json({ message: 'Marks saved.', saved: entries.length });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('3alamatak marks save error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

app.get('/api/3alamatak/gradebooks/:id/analytics', verifyToken, requireActiveTeacherOrAdmin, async (req, res) => {
  try {
    const gradebook = await getAlamatakGradebook(req, req.params.id);
    if (!gradebook) return res.status(404).json({ message: 'Gradebook not found.' });
    const [summary] = await db.query(
      `SELECT
         (SELECT COUNT(*) FROM alamatak_students WHERE gradebook_id = ? AND status <> 'archived') AS students,
         (SELECT COUNT(*) FROM alamatak_assessments WHERE gradebook_id = ?) AS assessments,
         (SELECT COUNT(*) FROM alamatak_marks m JOIN alamatak_assessment_components c ON c.id = m.component_id JOIN alamatak_assessments a ON a.id = c.assessment_id WHERE a.gradebook_id = ?) AS recorded_marks`,
      [gradebook.id, gradebook.id, gradebook.id]
    );
    const [averages] = await db.query(
      `SELECT s.id AS student_id, s.display_name,
              SUM(m.score) AS score, SUM(c.maximum_score) AS maximum_score
       FROM alamatak_students s
       LEFT JOIN alamatak_marks m ON m.student_id = s.id
       LEFT JOIN alamatak_assessment_components c ON c.id = m.component_id
       WHERE s.gradebook_id = ? AND s.status <> 'archived'
       GROUP BY s.id, s.display_name
       ORDER BY s.display_name`,
      [gradebook.id]
    );
    const rows = averages.map((row) => ({
      ...row,
      percent: row.maximum_score > 0 ? Number(row.score || 0) / Number(row.maximum_score) * 100 : null,
    }));
    const populated = rows.filter((row) => row.percent !== null);
    res.json({
      summary: summary[0],
      students: rows,
      class_average: populated.length ? populated.reduce((sum, row) => sum + row.percent, 0) / populated.length : null,
      highest: populated.length ? Math.max(...populated.map((row) => row.percent)) : null,
      lowest: populated.length ? Math.min(...populated.map((row) => row.percent)) : null,
    });
  } catch (error) {
    console.error('3alamatak analytics error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

app.get('/api/3alamatak/gradebooks/:id/export', verifyToken, requireActiveTeacherOrAdmin, async (req, res) => {
  try {
    const gradebook = await getAlamatakGradebook(req, req.params.id);
    if (!gradebook) return res.status(404).json({ message: 'Gradebook not found.' });
    const [students] = await db.query('SELECT * FROM alamatak_students WHERE gradebook_id = ? ORDER BY display_name', [gradebook.id]);
    const [assessments] = await db.query('SELECT * FROM alamatak_assessments WHERE gradebook_id = ? ORDER BY id', [gradebook.id]);
    const [components] = await db.query(
      `SELECT c.* FROM alamatak_assessment_components c
       JOIN alamatak_assessments a ON a.id = c.assessment_id WHERE a.gradebook_id = ? ORDER BY c.assessment_id, c.sort_order`,
      [gradebook.id]
    );
    const [marks] = await db.query(
      `SELECT m.* FROM alamatak_marks m
       JOIN alamatak_assessment_components c ON c.id = m.component_id
       JOIN alamatak_assessments a ON a.id = c.assessment_id WHERE a.gradebook_id = ?`,
      [gradebook.id]
    );
    const [schemes] = await db.query('SELECT * FROM alamatak_grading_schemes WHERE gradebook_id = ?', [gradebook.id]);
    const schemeIds = schemes.map((s) => s.id);
    let schemeComponents = [];
    let thresholds = [];
    if (schemeIds.length) {
      [schemeComponents] = await db.query('SELECT * FROM alamatak_grading_components WHERE scheme_id IN (?)', [schemeIds]);
      const compIds = schemeComponents.map((c) => c.id);
      if (compIds.length) {
        [thresholds] = await db.query('SELECT * FROM alamatak_grade_thresholds WHERE grading_component_id IN (?)', [compIds]);
      }
    }
    const [historicalRecords] = await db.query('SELECT * FROM alamatak_historical_records WHERE gradebook_id = ?', [gradebook.id]);
    res.json({
      version: 1,
      exported_at: new Date().toISOString(),
      gradebook,
      students,
      assessments,
      components,
      marks,
      schemes,
      scheme_components: schemeComponents,
      thresholds,
      historical_records: historicalRecords
    });
  } catch (error) {
    console.error('3alamatak export error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

app.get('/api/3alamatak/gradebooks/:id/schemes', verifyToken, requireActiveTeacherOrAdmin, async (req, res) => {
  try {
    const gradebook = await getAlamatakGradebook(req, req.params.id);
    if (!gradebook) return res.status(404).json({ message: 'Gradebook not found.' });
    const [schemes] = await db.query(
      'SELECT id, gradebook_id, name, source_import_id, is_fallback, created_at, updated_at FROM alamatak_grading_schemes WHERE gradebook_id = ? ORDER BY is_fallback DESC, id ASC',
      [gradebook.id]
    );
    if (!schemes.length) return res.json([]);
    const schemeIds = schemes.map((s) => s.id);
    const [components] = await db.query(
      'SELECT id, scheme_id, component_key, label, maximum_score FROM alamatak_grading_components WHERE scheme_id IN (?) ORDER BY id ASC',
      [schemeIds]
    );
    const componentIds = components.map((c) => c.id);
    let thresholds = [];
    if (componentIds.length) {
      [thresholds] = await db.query(
        'SELECT id, grading_component_id, grade_label, minimum_score FROM alamatak_grade_thresholds WHERE grading_component_id IN (?) ORDER BY minimum_score DESC',
        [componentIds]
      );
    }
    const thresholdMap = new Map();
    for (const t of thresholds) {
      if (!thresholdMap.has(t.grading_component_id)) thresholdMap.set(t.grading_component_id, {});
      thresholdMap.get(t.grading_component_id)[t.grade_label] = Number(t.minimum_score);
    }
    const compMap = new Map();
    for (const c of components) {
      if (!compMap.has(c.scheme_id)) compMap.set(c.scheme_id, {});
      compMap.get(c.scheme_id)[c.component_key] = {
        id: c.id,
        label: c.label,
        maximum_score: c.maximum_score != null ? Number(c.maximum_score) : null,
        thresholds: thresholdMap.get(c.id) || {},
      };
    }
    const result = schemes.map((s) => ({
      ...s,
      components: compMap.get(s.id) || {},
    }));
    res.json(result);
  } catch (error) {
    console.error('3alamatak schemes list error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

app.post('/api/3alamatak/gradebooks/:id/schemes', verifyToken, requireActiveTeacherOrAdmin, async (req, res) => {
  const { name, is_fallback, components } = req.body || {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ message: 'A scheme name is required.' });
  }
  try {
    const gradebook = await getAlamatakGradebook(req, req.params.id);
    if (!gradebook) return res.status(404).json({ message: 'Gradebook not found.' });

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [schemeRes] = await connection.query(
        `INSERT INTO alamatak_grading_schemes (gradebook_id, name, is_fallback)
         VALUES (?, ?, ?)`,
        [gradebook.id, name.trim(), Boolean(is_fallback)]
      );
      const schemeId = schemeRes.insertId;

      if (components && typeof components === 'object') {
        for (const [key, comp] of Object.entries(components)) {
          const [compRes] = await connection.query(
            `INSERT INTO alamatak_grading_components (scheme_id, component_key, label, maximum_score)
             VALUES (?, ?, ?, ?)`,
            [schemeId, key, comp.label || key, comp.maximum_score != null ? Number(comp.maximum_score) : null]
          );
          const compId = compRes.insertId;
          const thresholds = comp.thresholds || {};
          for (const [gradeLabel, minScore] of Object.entries(thresholds)) {
            if (minScore !== null && minScore !== undefined && !isNaN(Number(minScore))) {
              await connection.query(
                `INSERT INTO alamatak_grade_thresholds (grading_component_id, grade_label, minimum_score)
                 VALUES (?, ?, ?)`,
                [compId, gradeLabel, Number(minScore)]
              );
            }
          }
        }
      }
      await connection.commit();
      res.status(201).json({ id: schemeId, message: 'Grading scheme created.' });
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('3alamatak scheme create error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

app.delete('/api/3alamatak/gradebooks/:id/schemes/:schemeId', verifyToken, requireActiveTeacherOrAdmin, async (req, res) => {
  try {
    const gradebook = await getAlamatakGradebook(req, req.params.id);
    if (!gradebook) return res.status(404).json({ message: 'Gradebook not found.' });
    await db.query('DELETE FROM alamatak_grading_schemes WHERE id = ? AND gradebook_id = ?', [req.params.schemeId, gradebook.id]);
    res.json({ message: 'Grading scheme deleted.' });
  } catch (error) {
    console.error('3alamatak scheme delete error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

app.get('/api/3alamatak/gradebooks/:id/historical-records', verifyToken, requireActiveTeacherOrAdmin, async (req, res) => {
  try {
    const gradebook = await getAlamatakGradebook(req, req.params.id);
    if (!gradebook) return res.status(404).json({ message: 'Gradebook not found.' });
    const { record_type, source_year } = req.query;
    const conditions = ['h.gradebook_id = ?'];
    const params = [gradebook.id];
    if (record_type) {
      conditions.push('h.record_type = ?');
      params.push(record_type);
    }
    if (source_year) {
      conditions.push('h.source_year = ?');
      params.push(source_year);
    }
    const [records] = await db.query(
      `SELECT h.id, h.gradebook_id, h.student_id, h.import_id, h.record_type, h.source_year, h.payload, h.created_at,
              s.display_name AS student_name, s.external_student_id
       FROM alamatak_historical_records h
       LEFT JOIN alamatak_students s ON s.id = h.student_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY h.created_at DESC`,
      params
    );
    res.json(records);
  } catch (error) {
    console.error('3alamatak historical records error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

app.post('/api/3alamatak/gradebooks/:id/imports/analyze', verifyToken, requireActiveTeacherOrAdmin, handleUpload, async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'An Excel or delimited text file is required for analysis.' });
  }
  try {
    const gradebook = await getAlamatakGradebook(req, req.params.id);
    if (!gradebook) return res.status(404).json({ message: 'Gradebook not found.' });

    const isXlsx = /\.xlsx?$/i.test(req.file.originalname);
    const sheets = isXlsx
      ? await workbookParser.readXlsxWorkbook(req.file.buffer)
      : [{ name: req.file.originalname.replace(/\.[^.]+$/, ''), rows: workbookParser.parseDelimited(req.file.buffer.toString('utf8')) }];

    const [existingStudents] = await db.query(
      'SELECT id, external_student_id, display_name, first_name, last_name, email FROM alamatak_students WHERE gradebook_id = ? AND status = "active"',
      [gradebook.id]
    );

    const pkg = workbookParser.buildWorkbookImportPackage(sheets, req.file.originalname, {
      existingStudents,
      academicYear: gradebook.academic_year,
    });

    res.json({ pkg, sheets });
  } catch (error) {
    console.error('3alamatak analyze error:', error);
    res.status(400).json({ message: error.message || 'Failed to analyze workbook.' });
  }
});

app.post('/api/3alamatak/gradebooks/:id/imports', verifyToken, requireActiveTeacherOrAdmin, handleOptionalUpload, async (req, res) => {
  try {
    const gradebook = await getAlamatakGradebook(req, req.params.id);
    if (!gradebook) return res.status(404).json({ message: 'Gradebook not found.' });

    let payload = req.body || {};

    if (req.file) {
      const isXlsx = /\.xlsx?$/i.test(req.file.originalname);
      const rawSheets = isXlsx
        ? await workbookParser.readXlsxWorkbook(req.file.buffer)
        : [{ name: req.file.originalname.replace(/\.[^.]+$/, ''), rows: workbookParser.parseDelimited(req.file.buffer.toString('utf8')) }];

      let sheetSelections = [];
      if (req.body.sheetSelections) {
        try {
          sheetSelections = typeof req.body.sheetSelections === 'string'
            ? JSON.parse(req.body.sheetSelections)
            : req.body.sheetSelections;
        } catch (_) {}
      }
      if (Array.isArray(sheetSelections) && sheetSelections.length) {
        const selectionMap = new Map(sheetSelections.map((s) => [s.name, Boolean(s.selected)]));
        rawSheets.forEach((s) => {
          if (selectionMap.has(s.name)) {
            s.selected = selectionMap.get(s.name);
          }
        });
      }

      const [existingStudents] = await db.query(
        'SELECT id, external_student_id, display_name, first_name, last_name, email FROM alamatak_students WHERE gradebook_id = ? AND status = "active"',
        [gradebook.id]
      );

      const pkg = workbookParser.buildWorkbookImportPackage(rawSheets, req.file.originalname, {
        existingStudents,
        academicYear: req.body.academicYear || gradebook.academic_year,
      });

      let studentResolutions = {};
      if (req.body.studentResolutions || req.body.resolutions) {
        try {
          const rawRes = req.body.studentResolutions || req.body.resolutions;
          studentResolutions = typeof rawRes === 'string' ? JSON.parse(rawRes) : rawRes;
        } catch (_) {}
      }

      const finalStudents = [];
      const studentKeyToTargetMap = new Map();

      (pkg.matched_students || []).forEach((m) => {
        const res = studentResolutions[m.key] || { resolution: m.resolution, include: true };
        if (!res.include || res.resolution === 'skip') return;

        if (res.resolution === 'new' || !res.resolution) {
          finalStudents.push({
            key: m.key,
            display_name: m.display_name,
            first_name: m.first_name,
            last_name: m.last_name,
            external_student_id: m.external_student_id,
            email: m.email,
          });
          studentKeyToTargetMap.set(m.key, m.key);
        } else {
          studentKeyToTargetMap.set(m.key, res.resolution);
        }
      });

      payload = {
        ...pkg,
        students: finalStudents,
        assessments: (pkg.assessments || []).map((ass) => ({
          ...ass,
          marks: (ass.marks || []).map((mk) => ({
            ...mk,
            student_key: studentKeyToTargetMap.get(mk.student_key) || mk.student_key,
          })),
        })),
        historical_records: (pkg.historical_records || []).map((rec) => ({
          ...rec,
          student_key: studentKeyToTargetMap.get(rec.student_key) || rec.student_key,
        })),
      };
    }

    if (!payload.original_filename || !Array.isArray(payload.sheets)) {
      return res.status(400).json({ message: 'An import filename and worksheet package are required.' });
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [importResult] = await connection.query(
        `INSERT INTO alamatak_imports
         (gradebook_id, uploaded_by, original_filename, academic_year, detected_class, detected_subject, workbook_type, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [gradebook.id, req.user.id, String(payload.original_filename).slice(0, 512), payload.academic_year || null, payload.detected_class || null, payload.detected_subject || null, payload.workbook_type || null, JSON.stringify(payload.metadata || {})]
      );
      for (const sheet of payload.sheets) {
        const rows = Array.isArray(sheet.rows) ? sheet.rows : [];
        await connection.query(
          `INSERT INTO alamatak_import_sheets
           (import_id, sheet_name, visibility, classification, source_year, selected, row_count, column_count, raw_rows, diagnostics)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [importResult.insertId, String(sheet.name || 'Sheet').slice(0, 255), sheet.hidden ? 'hidden' : 'visible', sheet.type || 'reference', sheet.source_year || null, Boolean(sheet.selected), rows.length, Math.max(0, ...rows.map((row) => row.length)), JSON.stringify(rows), JSON.stringify(sheet.diagnostics || [])]
        );
      }

      const studentMap = new Map();
      for (const student of Array.isArray(payload.students) ? payload.students : []) {
        const displayName = String(student.display_name || student.name || '').trim();
        if (!displayName) continue;
        const externalId = student.external_student_id ? String(student.external_student_id).trim() : null;
        let existing = null;
        if (externalId) {
          const [rows] = await connection.query('SELECT id FROM alamatak_students WHERE gradebook_id = ? AND external_student_id = ?', [gradebook.id, externalId]);
          existing = rows[0];
        }
        if (!existing) {
          const [rows] = await connection.query('SELECT id FROM alamatak_students WHERE gradebook_id = ? AND display_name = ?', [gradebook.id, displayName]);
          existing = rows[0];
        }
        if (existing) {
          studentMap.set(student.key || externalId || displayName, existing.id);
        } else {
          const [result] = await connection.query(
            `INSERT INTO alamatak_students
             (gradebook_id, linked_user_id, external_student_id, first_name, last_name, display_name, email, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [gradebook.id, null, externalId, student.first_name || '', student.last_name || '', displayName, student.email || null, student.notes || null]
          );
          studentMap.set(student.key || externalId || displayName, result.insertId);
        }
      }

      for (const assessment of Array.isArray(payload.assessments) ? payload.assessments : []) {
        const components = normalizeAssessmentComponents(assessment.components);
        if (!assessment.title || !components) continue;
        const [assessmentResult] = await connection.query(
          `INSERT INTO alamatak_assessments
           (gradebook_id, title, strand, topic, assessment_date, source_import_id, is_historical, source_year)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [gradebook.id, assessment.title, assessment.strand || null, assessment.topic || null, assessment.assessment_date || null, importResult.insertId, Boolean(assessment.is_historical), assessment.source_year || null]
        );
        const componentIds = [];
        for (const component of components) {
          const [componentResult] = await connection.query(
            `INSERT INTO alamatak_assessment_components
             (assessment_id, name, maximum_score, sort_order) VALUES (?, ?, ?, ?)`,
            [assessmentResult.insertId, component.name, component.maximum_score, component.sort_order]
          );
          componentIds.push(componentResult.insertId);
        }
        for (const mark of Array.isArray(assessment.marks) ? assessment.marks : []) {
          const studentId = studentMap.get(mark.student_key || mark.external_student_id || mark.display_name) || (typeof mark.student_key === 'number' || /^\d+$/.test(mark.student_key) ? Number(mark.student_key) : null);
          const componentId = componentIds[Number(mark.component_index)];
          if (!studentId || !componentId) continue;
          await connection.query(
            `INSERT INTO alamatak_marks
             (component_id, student_id, score, mark_status, comment, follow_up_required)
             VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE score = VALUES(score), mark_status = VALUES(mark_status), comment = VALUES(comment), follow_up_required = VALUES(follow_up_required)`,
            [componentId, studentId, mark.score ?? null, mark.mark_status || null, mark.comment || null, Boolean(mark.follow_up_required)]
          );
        }
      }

      for (const scheme of Array.isArray(payload.schemes) ? payload.schemes : []) {
        if (!scheme.name) continue;
        const [schemeResult] = await connection.query(
          `INSERT INTO alamatak_grading_schemes
           (gradebook_id, name, source_import_id, is_fallback)
           VALUES (?, ?, ?, ?)`,
          [gradebook.id, scheme.name, importResult.insertId, Boolean(scheme.is_fallback)]
        );
        const schemeId = schemeResult.insertId;
        for (const [key, comp] of Object.entries(scheme.components || {})) {
          const [compResult] = await connection.query(
            `INSERT INTO alamatak_grading_components
             (scheme_id, component_key, label, maximum_score)
             VALUES (?, ?, ?, ?)`,
            [schemeId, key, comp.label || key, comp.maximum_score != null ? Number(comp.maximum_score) : null]
          );
          const compId = compResult.insertId;
          const thresholds = comp.thresholds || {};
          for (const [gradeLabel, minScore] of Object.entries(thresholds)) {
            if (minScore !== null && minScore !== undefined && !isNaN(Number(minScore))) {
              await connection.query(
                `INSERT INTO alamatak_grade_thresholds
                 (grading_component_id, grade_label, minimum_score)
                 VALUES (?, ?, ?)`,
                [compId, gradeLabel, Number(minScore)]
              );
            }
          }
        }
      }

      for (const record of Array.isArray(payload.historical_records) ? payload.historical_records : []) {
        const studentId = record.student_key ? (studentMap.get(record.student_key) || (typeof record.student_key === 'number' || /^\d+$/.test(record.student_key) ? Number(record.student_key) : null)) : null;
        await connection.query(
          `INSERT INTO alamatak_historical_records
           (gradebook_id, student_id, import_id, record_type, source_year, payload)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [gradebook.id, studentId || null, importResult.insertId, record.record_type || 'imported', record.source_year || payload.academic_year || 'unknown', JSON.stringify(record.payload || record)]
        );
      }
      await connection.commit();
      res.status(201).json({ import_id: importResult.insertId, message: 'Import persisted.' });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('3alamatak import error:', error);
    res.status(500).json({ message: error.message || 'Internal server error.' });
  }
});

// ==========================================
// Live Class Management Routes
// ==========================================

// Create a Live Class (Teachers/Admins Only)
// Resilient to whether migrations have been executed yet
app.post('/api/classes', verifyToken, requireActiveTeacherOrAdmin, async (req, res) => {
  if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Only teachers can schedule classes.' });
  }

  const { title, description, start_time, duration_minutes, student_limit } = req.body;

  const validation = validateClassInput({ title, description, start_time, duration_minutes, student_limit });
  if (!validation.valid) {
    return res.status(400).json({ message: validation.error });
  }

  const startIso = normalizeToIsoString(start_time);
  const mysql_start_time = new Date(startIso).toISOString().slice(0, 19).replace('T', ' ');
  const meeting_room_id = `Madrastak-${crypto.randomUUID()}`;

  try {
    let insertResult;

    // Resilient Schema Strategy:
    // 1. Try full schema with student_limit and status
    try {
      const [result] = await db.query(
        `INSERT INTO live_classes 
         (teacher_id, title, description, start_time, duration_minutes, meeting_room_id, student_limit, status) 
         VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled')`,
        [
          req.user.id, 
          title.trim(), 
          description.trim(), 
          mysql_start_time, 
          validation.sanitizedDuration, 
          meeting_room_id, 
          validation.sanitizedLimit
        ]
      );
      insertResult = result;
    } catch (insertErr) {
      if (insertErr.code === 'ER_BAD_FIELD_ERROR') {
        // 2. Fallback without status (if only student_limit exists)
        try {
          const [result2] = await db.query(
            `INSERT INTO live_classes 
             (teacher_id, title, description, start_time, duration_minutes, meeting_room_id, student_limit) 
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              req.user.id, 
              title.trim(), 
              description.trim(), 
              mysql_start_time, 
              validation.sanitizedDuration, 
              meeting_room_id, 
              validation.sanitizedLimit
            ]
          );
          insertResult = result2;
        } catch (insertErr2) {
          if (insertErr2.code === 'ER_BAD_FIELD_ERROR') {
            // 3. Fallback to base columns (before migrations)
            const [result3] = await db.query(
              `INSERT INTO live_classes 
               (teacher_id, title, description, start_time, duration_minutes, meeting_room_id) 
               VALUES (?, ?, ?, ?, ?, ?)`,
              [
                req.user.id, 
                title.trim(), 
                description.trim(), 
                mysql_start_time, 
                validation.sanitizedDuration, 
                meeting_room_id
              ]
            );
            insertResult = result3;
          } else {
            throw insertErr2;
          }
        }
      } else {
        throw insertErr;
      }
    }

    res.status(201).json({ 
      message: 'Class scheduled successfully!', 
      classId: insertResult.insertId,
      student_limit: validation.sanitizedLimit,
      status: 'scheduled'
    });
  } catch (error) {
    console.error('Class creation error:', error);
    res.status(500).json({ message: 'Internal server error.', details: error.message });
  }
});

// Get All Public Classes (Includes Scheduled, Live, and Concluded)
// SECURITY: Explicitly excludes `meeting_room_id`
app.get('/api/classes', async (req, res) => {
  try {
    const [classes] = await db.query(`
      SELECT 
        lc.*,
        u.full_name AS teacher_name, 
        u.bio AS teacher_bio, 
        u.profile_pic AS teacher_profile_pic,
        (SELECT COUNT(*) FROM class_bookings cb WHERE cb.class_id = lc.id) AS enrolled_count
      FROM live_classes lc 
      JOIN users u ON lc.teacher_id = u.id 
      ORDER BY lc.start_time DESC
    `);

    for (let cls of classes) {
      delete cls.meeting_room_id; // SECURITY: Never expose meeting_room_id in public class lists
      if (cls.student_limit === undefined) cls.student_limit = null;
      cls.status = evaluateClassStatus(cls);
      cls.start_time = normalizeToIsoString(cls.start_time);
    }

    res.json(classes);
  } catch (error) {
    console.error('Fetch classes error:', error);
    res.status(500).json({ message: 'Internal server error.', details: error.message });
  }
});

// Secure Class Access Gateway
app.get('/api/classes/:id/access', verifyToken, requireActiveAccount, async (req, res) => {
  const classId = req.params.id;

  try {
    const [rows] = await db.query(`
      SELECT 
        lc.id, 
        lc.teacher_id, 
        lc.title, 
        lc.description, 
        lc.start_time, 
        lc.duration_minutes, 
        lc.meeting_room_id, 
        lc.student_limit, 
        lc.status,
        u.full_name AS teacher_name
      FROM live_classes lc
      JOIN users u ON lc.teacher_id = u.id
      WHERE lc.id = ?
    `, [classId]);

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Class not found.' });
    }

    const cls = rows[0];
    const currentStatus = evaluateClassStatus(cls);
    cls.status = currentStatus;

    const isTeacher = req.user.account_status === 'active' && (
      Number(req.user.id) === Number(cls.teacher_id) || req.user.role === 'admin'
    );

    if (!isTeacher) {
      const [booking] = await db.query(
        'SELECT id FROM class_bookings WHERE class_id = ? AND student_id = ?',
        [classId, req.user.id]
      );

      if (booking.length === 0) {
        return res.status(403).json({ 
          allowed: false, 
          message: 'Access Denied: You are not registered for this lecture.' 
        });
      }
    }

    if (currentStatus === 'ended') {
      return res.status(400).json({ 
        allowed: false, 
        status: 'ended', 
        message: 'This lecture has already ended.' 
      });
    }

    // If scheduled and user is teacher, entering can auto-start lecture
    if (isTeacher && cls.status === 'scheduled') {
      try {
        await db.query('UPDATE live_classes SET status = ? WHERE id = ?', ['live', classId]);
        cls.status = 'live';
      } catch (err) {
        console.error('[ClassAccess] Failed to auto-start class:', err.message);
      }
    }

    // Students must not enter before the professor starts the lecture
    if (!isTeacher && cls.status === 'scheduled') {
      return res.status(403).json({
        allowed: false,
        status: 'scheduled',
        start_time: normalizeToIsoString(cls.start_time),
        teacher_name: cls.teacher_name,
        title: cls.title,
        message: 'The lecture has not started yet. Please wait for your instructor.'
      });
    }

    // Generate JaaS token for authenticated user
    let jaasData = null;
    try {
      jaasData = generateJaasToken({
        user: req.user,
        roomName: cls.meeting_room_id,
        isTeacher,
        durationMinutes: cls.duration_minutes
      });
    } catch (tokenErr) {
      console.error('[JaaS] Failed to generate token for access request:', tokenErr.message);
    }

    if (!jaasData || !jaasData.token) {
      return res.status(503).json({
        allowed: false,
        message: 'Live classroom is currently unavailable. JaaS authentication is not configured on the server.'
      });
    }

    res.json({
      allowed: true,
      classId: cls.id,
      title: cls.title,
      description: cls.description,
      meeting_room_id: jaasData.roomName,
      status: cls.status,
      isHost: isTeacher,
      duration_minutes: cls.duration_minutes,
      start_time: normalizeToIsoString(cls.start_time),
      teacher_name: cls.teacher_name,
      jaas: {
        appId: jaasData.appId,
        jwt: jaasData.token,
        roomName: jaasData.roomName,
        qualifiedRoomName: jaasData.qualifiedRoomName
      }
    });
  } catch (error) {
    console.error('Access check error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// Teacher: Explicitly Start Lecture
app.post('/api/classes/:id/start', verifyToken, requireActiveTeacherOrAdmin, async (req, res) => {
  const classId = req.params.id;

  try {
    const [rows] = await db.query('SELECT teacher_id, status FROM live_classes WHERE id = ?', [classId]);
    if (rows.length === 0) return res.status(404).json({ message: 'Class not found.' });

    if (Number(rows[0].teacher_id) !== Number(req.user.id) && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied.' });
    }

    await db.query('UPDATE live_classes SET status = ? WHERE id = ?', ['live', classId]);
    res.json({ message: 'Lecture is now live!', status: 'live' });
  } catch (error) {
    console.error('Start class error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// Teacher: Explicitly End Lecture
app.post('/api/classes/:id/end', verifyToken, requireActiveTeacherOrAdmin, async (req, res) => {
  const classId = req.params.id;

  try {
    const [rows] = await db.query('SELECT teacher_id, status FROM live_classes WHERE id = ?', [classId]);
    if (rows.length === 0) return res.status(404).json({ message: 'Class not found.' });

    if (Number(rows[0].teacher_id) !== Number(req.user.id) && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied.' });
    }

    await db.query('UPDATE live_classes SET status = ? WHERE id = ?', ['ended', classId]);

    // Finalize open attendance records if table exists
    await db.query(`
      UPDATE class_attendance 
      SET left_at = NOW(), 
          duration_seconds = GREATEST(duration_seconds, TIMESTAMPDIFF(SECOND, joined_at, NOW()))
      WHERE class_id = ? AND left_at IS NULL
    `).catch(() => {});

    res.json({ message: 'Lecture has ended.', status: 'ended' });
  } catch (error) {
    console.error('End class error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// Teacher: Get Classes Created by Current Teacher
// Safe queries ensuring no failure if columns are absent
app.get('/api/teacher/classes', verifyToken, requireActiveTeacherOrAdmin, async (req, res) => {
  if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Access denied.' });
  }

  try {
    const [classes] = await db.query(
      `SELECT 
        lc.*,
        (SELECT COUNT(*) FROM class_bookings cb WHERE cb.class_id = lc.id) AS enrolled_count
       FROM live_classes lc 
       WHERE lc.teacher_id = ? 
       ORDER BY lc.start_time DESC`,
      [req.user.id]
    );

    for (let cls of classes) {
      if (cls.student_limit === undefined) cls.student_limit = null;
      cls.status = evaluateClassStatus(cls);
      cls.start_time = normalizeToIsoString(cls.start_time);

      // Safe query: select standard user columns + cb.booked_at from bookings
      try {
        const [students] = await db.query(
          `SELECT u.id, u.full_name, u.email, cb.booked_at 
           FROM class_bookings cb 
           JOIN users u ON cb.student_id = u.id 
           WHERE cb.class_id = ?`,
          [cls.id]
        );
        cls.enrolled_students = students || [];
      } catch (err) {
        cls.enrolled_students = [];
      }
    }

    res.json(classes);
  } catch (error) {
    console.error('Teacher classes error:', error);
    res.status(500).json({ message: 'Internal server error.', details: error.message });
  }
});

// Teacher: Delete Class
app.delete('/api/classes/:id', verifyToken, requireActiveTeacherOrAdmin, async (req, res) => {
  if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Access denied.' });
  }

  try {
    const [result] = await db.query(
      'DELETE FROM live_classes WHERE id = ? AND teacher_id = ?',
      [req.params.id, req.user.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Class not found or unauthorized.' });
    }

    res.json({ message: 'Class deleted successfully.' });
  } catch (error) {
    console.error('Delete class error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// Teacher: Edit Existing Course
app.put('/api/classes/:id', verifyToken, requireActiveTeacherOrAdmin, async (req, res) => {
  if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Only teachers can edit classes.' });
  }

  const classId = req.params.id;
  const { title, description, start_time, duration_minutes, student_limit } = req.body;

  try {
    const [rows] = await db.query(
      'SELECT id, teacher_id, title, description, start_time, duration_minutes, student_limit, status FROM live_classes WHERE id = ?',
      [classId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Class not found.' });
    }

    const cls = rows[0];
    if (Number(cls.teacher_id) !== Number(req.user.id) && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied: You do not own this course.' });
    }

    // Validate using validateClassInput
    const validation = validateClassInput({ title, description, start_time, duration_minutes, student_limit });
    if (!validation.valid) {
      // If start_time validation failed solely because it was unchanged from the existing time, permit it
      const currentStartIso = normalizeToIsoString(cls.start_time);
      const incomingStart = new Date(start_time);
      const existingStart = currentStartIso ? new Date(currentStartIso) : null;
      const isSameStartTime = existingStart && Math.abs(incomingStart.getTime() - existingStart.getTime()) < 60000;

      if (!isSameStartTime || validation.error !== 'Start time cannot be in the past.') {
        return res.status(400).json({ message: validation.error });
      }
    }

    const startIso = normalizeToIsoString(start_time);
    const mysql_start_time = new Date(startIso).toISOString().slice(0, 19).replace('T', ' ');

    await db.query(
      `UPDATE live_classes 
       SET title = ?, description = ?, start_time = ?, duration_minutes = ?, student_limit = ?
       WHERE id = ?`,
      [
        title.trim(),
        description.trim(),
        mysql_start_time,
        validation.sanitizedDuration,
        validation.sanitizedLimit,
        classId
      ]
    );

    res.json({
      message: 'Course updated successfully!',
      class: {
        id: Number(classId),
        title: title.trim(),
        description: description.trim(),
        start_time: startIso,
        duration_minutes: validation.sanitizedDuration,
        student_limit: validation.sanitizedLimit
      }
    });
  } catch (error) {
    console.error('Update class error:', error);
    res.status(500).json({ message: 'Internal server error.', details: error.message });
  }
});

// Teacher: Relaunch Course (Relaunch Now OR Pick Date & Time)
app.post('/api/classes/:id/relaunch', verifyToken, requireActiveTeacherOrAdmin, async (req, res) => {
  if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Only teachers can relaunch classes.' });
  }

  const classId = req.params.id;
  const { immediate, start_time } = req.body || {};

  try {
    const [rows] = await db.query(
      'SELECT id, teacher_id, title, description, duration_minutes, student_limit FROM live_classes WHERE id = ?',
      [classId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Original class not found.' });
    }

    const original = rows[0];
    if (Number(original.teacher_id) !== Number(req.user.id) && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied: You do not own this course.' });
    }

    let targetStartTime;
    if (immediate || !start_time) {
      // Relaunch Now: scheduled for right now
      targetStartTime = new Date();
    } else {
      targetStartTime = new Date(start_time);
      if (isNaN(targetStartTime.getTime())) {
        return res.status(400).json({ message: 'Invalid start time format.' });
      }
      const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
      if (targetStartTime.getTime() < tenMinutesAgo) {
        return res.status(400).json({ message: 'Scheduled start time cannot be in the past.' });
      }
    }

    const mysql_start_time = targetStartTime.toISOString().slice(0, 19).replace('T', ' ');
    const meeting_room_id = `Madrastak-${crypto.randomUUID()}`;

    // Insert as an independent new class record with 0 bookings and 0 attendance
    const [insertResult] = await db.query(
      `INSERT INTO live_classes 
       (teacher_id, title, description, start_time, duration_minutes, meeting_room_id, student_limit, status) 
       VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled')`,
      [
        req.user.id,
        original.title, // Exact same title (do NOT append date/time)
        original.description,
        mysql_start_time,
        original.duration_minutes || 60,
        meeting_room_id,
        original.student_limit || 20
      ]
    );

    res.status(201).json({
      message: 'Course relaunched successfully!',
      classId: insertResult.insertId,
      meeting_room_id,
      title: original.title,
      start_time: targetStartTime.toISOString(),
      duration_minutes: original.duration_minutes || 60,
      student_limit: original.student_limit || 20,
      status: 'scheduled'
    });
  } catch (error) {
    console.error('Relaunch class error:', error);
    res.status(500).json({ message: 'Internal server error.', details: error.message });
  }
});

// Teacher: Extend Active Live Class
app.post('/api/classes/:id/extend', verifyToken, requireActiveTeacherOrAdmin, async (req, res) => {
  if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Only instructors can extend live classes.' });
  }

  const classId = req.params.id;
  const { extensionMinutes } = req.body || {};

  const minutesToAdd = parseInt(extensionMinutes, 10);
  if (isNaN(minutesToAdd) || minutesToAdd <= 0 || minutesToAdd > 240) {
    return res.status(400).json({ message: 'Extension minutes must be a positive integer (up to 240 minutes).' });
  }

  try {
    const [rows] = await db.query(
      'SELECT id, teacher_id, title, start_time, duration_minutes, status FROM live_classes WHERE id = ?',
      [classId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Class not found.' });
    }

    const cls = rows[0];
    if (Number(cls.teacher_id) !== Number(req.user.id) && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied: Only the course instructor can extend this lecture.' });
    }

    if (cls.status === 'ended') {
      return res.status(400).json({ message: 'Cannot extend a lecture that has already ended.' });
    }

    const currentDuration = Number(cls.duration_minutes) || 60;
    const newDuration = currentDuration + minutesToAdd;

    await db.query(
      'UPDATE live_classes SET duration_minutes = ? WHERE id = ?',
      [newDuration, classId]
    );

    res.json({
      message: `Lecture extended by ${minutesToAdd} minutes. New duration: ${newDuration} minutes.`,
      classId: Number(classId),
      addedMinutes: minutesToAdd,
      newDurationMinutes: newDuration
    });
  } catch (error) {
    console.error('Extend class error:', error);
    res.status(500).json({ message: 'Internal server error.', details: error.message });
  }
});

// ==========================================
// Booking & Capacity Routes
// ==========================================

// Student: Book a Class (Concurrency-Safe Transaction)
app.post('/api/bookings', verifyToken, requireActiveStudentOrAdmin, async (req, res) => {
  if (req.user.role !== 'student' && req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Only students can book classes.' });
  }

  const { class_id } = req.body;
  if (!class_id) {
    return res.status(400).json({ message: 'class_id is required.' });
  }

  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const [classRows] = await connection.query(
      'SELECT id, student_limit, status, start_time, duration_minutes FROM live_classes WHERE id = ? FOR UPDATE',
      [class_id]
    );

    if (classRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: 'Class not found.' });
    }

    const cls = classRows[0];
    const currentStatus = evaluateClassStatus(cls);

    if (currentStatus === 'ended') {
      await connection.rollback();
      return res.status(400).json({ message: 'Cannot book a lecture that has already ended.' });
    }

    const [existing] = await connection.query(
      'SELECT id FROM class_bookings WHERE student_id = ? AND class_id = ?',
      [req.user.id, class_id]
    );

    if (existing.length > 0) {
      await connection.rollback();
      return res.status(400).json({ message: 'You are already registered for this class.' });
    }

    if (cls.student_limit !== null && cls.student_limit !== undefined) {
      const [countRows] = await connection.query(
        'SELECT COUNT(*) AS booked_count FROM class_bookings WHERE class_id = ?',
        [class_id]
      );
      const bookedCount = countRows[0].booked_count;

      if (bookedCount >= cls.student_limit) {
        await connection.rollback();
        return res.status(409).json({ 
          message: `This class is full. Capacity limit of ${cls.student_limit} students reached.` 
        });
      }
    }

    await connection.query(
      'INSERT INTO class_bookings (student_id, class_id) VALUES (?, ?)',
      [req.user.id, class_id]
    );

    await connection.commit();
    res.status(201).json({ message: 'Successfully booked the class!' });
  } catch (error) {
    await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ message: 'You are already registered for this class.' });
    }
    console.error('Booking error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  } finally {
    connection.release();
  }
});

// Student: Cancel a Booking
app.delete('/api/bookings/:classId', verifyToken, async (req, res) => {
  const classId = req.params.classId;

  try {
    const [bookings] = await db.query(
      'SELECT id FROM class_bookings WHERE student_id = ? AND class_id = ?',
      [req.user.id, classId]
    );

    if (bookings.length === 0) {
      return res.status(404).json({ message: 'Booking not found or not owned by you.' });
    }

    const [clsRows] = await db.query(
      'SELECT status, start_time, duration_minutes FROM live_classes WHERE id = ?',
      [classId]
    );

    if (clsRows.length > 0) {
      const status = evaluateClassStatus(clsRows[0]);
      if (status === 'ended') {
        return res.status(400).json({ message: 'Cannot cancel a booking for a completed lecture.' });
      }
    }

    await db.query(
      'DELETE FROM class_bookings WHERE student_id = ? AND class_id = ?',
      [req.user.id, classId]
    );

    res.json({ message: 'Booking cancelled successfully.' });
  } catch (error) {
    console.error('Cancel booking error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// Student: Get Booked Classes
app.get('/api/student/bookings', verifyToken, requireActiveStudentOrAdmin, async (req, res) => {
  if (req.user.role !== 'student' && req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Access denied.' });
  }

  try {
    const [bookings] = await db.query(
      `SELECT 
        lc.id, 
        lc.teacher_id, 
        lc.title, 
        lc.description, 
        lc.start_time, 
        lc.duration_minutes, 
        lc.student_limit, 
        lc.status, 
        cb.booked_at,
        u.full_name AS teacher_name,
        (SELECT COUNT(*) FROM class_bookings cb2 WHERE cb2.class_id = lc.id) AS enrolled_count
       FROM class_bookings cb 
       JOIN live_classes lc ON cb.class_id = lc.id 
       JOIN users u ON lc.teacher_id = u.id 
       WHERE cb.student_id = ? 
       ORDER BY lc.start_time ASC`,
      [req.user.id]
    );

    for (let b of bookings) {
      if (b.student_limit === undefined) b.student_limit = null;
      b.status = evaluateClassStatus(b);
      b.start_time = normalizeToIsoString(b.start_time);
    }

    res.json(bookings);
  } catch (error) {
    console.error('Student bookings error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// ==========================================
// Attendance & Session Tracking Routes
// ==========================================

// Record Join Session
app.post('/api/classes/:id/attendance/join', verifyToken, requireActiveAccount, async (req, res) => {
  const classId = req.params.id;
  const userId = req.user.id;

  try {
    const [classRows] = await db.query('SELECT teacher_id FROM live_classes WHERE id = ?', [classId]);
    if (classRows.length === 0) return res.status(404).json({ message: 'Class not found.' });

    const isTeacher = req.user.account_status === 'active' && (
      Number(classRows[0].teacher_id) === Number(userId) || req.user.role === 'admin'
    );

    if (!isTeacher) {
      const [booking] = await db.query(
        'SELECT id FROM class_bookings WHERE class_id = ? AND student_id = ?',
        [classId, userId]
      );
      if (booking.length === 0) {
        return res.status(403).json({ message: 'Unauthorized: Not registered for this class.' });
      }
    }

    // Reuse open session OR resume recently closed session within last 5 minutes
    try {
      const [recentSessions] = await db.query(
        `SELECT id, joined_at, duration_seconds, left_at
         FROM class_attendance 
         WHERE class_id = ? AND user_id = ? 
           AND (left_at IS NULL OR left_at >= NOW() - INTERVAL 5 MINUTE)
           AND joined_at >= NOW() - INTERVAL 6 HOUR 
         ORDER BY id DESC LIMIT 1`,
        [classId, userId]
      );

      if (recentSessions.length > 0) {
        const existing = recentSessions[0];
        if (existing.left_at !== null) {
          await db.query('UPDATE class_attendance SET left_at = NULL WHERE id = ?', [existing.id]);
        }
        return res.json({ message: 'Session resumed', sessionId: existing.id });
      }

      const [result] = await db.query(
        'INSERT INTO class_attendance (class_id, user_id, joined_at, duration_seconds) VALUES (?, ?, NOW(), 0)',
        [classId, userId]
      );

      return res.status(201).json({ message: 'Attendance recorded', sessionId: result.insertId });
    } catch (attendanceErr) {
      // If table class_attendance not yet migrated, gracefully return success
      return res.json({ message: 'Attendance pending migration', sessionId: null });
    }
  } catch (error) {
    console.error('Attendance join error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// Record Leave Session
app.post('/api/classes/:id/attendance/leave', verifyToken, requireActiveAccount, async (req, res) => {
  const classId = req.params.id;
  const userId = req.user.id;
  const { sessionId } = req.body || {};

  try {
    let query = `
      UPDATE class_attendance 
      SET left_at = NOW(), 
          duration_seconds = GREATEST(duration_seconds, TIMESTAMPDIFF(SECOND, joined_at, NOW()))
      WHERE class_id = ? AND user_id = ? AND left_at IS NULL
    `;
    const params = [classId, userId];

    if (sessionId) {
      query += ' AND id = ?';
      params.push(sessionId);
    }

    await db.query(query, params).catch(() => {});
    res.json({ message: 'Leave recorded.' });
  } catch (error) {
    console.error('Attendance leave error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// Periodic Attendance Heartbeat (every 20s from Classroom UI)
app.post('/api/classes/:id/attendance/heartbeat', verifyToken, requireActiveAccount, async (req, res) => {
  const classId = req.params.id;
  const userId = req.user.id;
  const { sessionId } = req.body || {};

  try {
    const [classRows] = await db.query('SELECT status, start_time, duration_minutes FROM live_classes WHERE id = ?', [classId]);
    if (classRows.length > 0) {
      const status = evaluateClassStatus(classRows[0]);
      if (status === 'ended') {
        await db.query(`
          UPDATE class_attendance 
          SET left_at = NOW(), 
              duration_seconds = GREATEST(duration_seconds, TIMESTAMPDIFF(SECOND, joined_at, NOW()))
          WHERE class_id = ? AND user_id = ? AND left_at IS NULL
        `, [classId, userId]).catch(() => {});

        return res.json({ ended: true, message: 'This lecture has concluded.' });
      }
    }

    let query = `
      UPDATE class_attendance 
      SET duration_seconds = GREATEST(duration_seconds, TIMESTAMPDIFF(SECOND, joined_at, NOW()))
      WHERE class_id = ? AND user_id = ? AND left_at IS NULL
    `;
    const params = [classId, userId];

    if (sessionId) {
      query += ' AND id = ?';
      params.push(sessionId);
    }

    await db.query(query, params).catch(() => {});
    res.json({ 
      ended: false, 
      message: 'Heartbeat recorded.',
      duration_minutes: classRows[0]?.duration_minutes ? Number(classRows[0].duration_minutes) : undefined
    });
  } catch (error) {
    console.error('Attendance heartbeat error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// Teacher: View Class Attendance Roster
app.get('/api/teacher/classes/:id/attendance', verifyToken, requireActiveTeacherOrAdmin, async (req, res) => {
  const classId = req.params.id;

  try {
    const [classRows] = await db.query('SELECT teacher_id, title FROM live_classes WHERE id = ?', [classId]);
    if (classRows.length === 0) return res.status(404).json({ message: 'Class not found.' });

    if (classRows[0].teacher_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied.' });
    }

    let roster = [];
    try {
      const [rows] = await db.query(`
        SELECT 
          u.id AS student_id,
          u.full_name,
          u.email,
          cb.booked_at,
          COUNT(ca.id) AS session_count,
          COALESCE(SUM(ca.duration_seconds), 0) AS total_duration_seconds,
          MIN(ca.joined_at) AS first_joined_at,
          MAX(ca.left_at) AS last_left_at
        FROM class_bookings cb
        JOIN users u ON cb.student_id = u.id
        LEFT JOIN class_attendance ca ON ca.class_id = cb.class_id AND ca.user_id = cb.student_id
        WHERE cb.class_id = ?
        GROUP BY u.id, u.full_name, u.email, cb.booked_at
        ORDER BY u.full_name ASC
      `, [classId]);
      roster = rows;
    } catch (err) {
      // Fallback if class_attendance doesn't exist
      const [simpleRows] = await db.query(`
        SELECT u.id AS student_id, u.full_name, u.email, cb.booked_at
        FROM class_bookings cb
        JOIN users u ON cb.student_id = u.id
        WHERE cb.class_id = ?
        ORDER BY u.full_name ASC
      `, [classId]);
      roster = simpleRows.map(s => ({
        ...s,
        session_count: 0,
        total_duration_seconds: 0,
        first_joined_at: null,
        last_left_at: null
      }));
    }

    const attendanceData = roster.map(r => ({
      student_id: r.student_id,
      full_name: r.full_name,
      email: r.email,
      booked_at: r.booked_at,
      attended: Number(r.session_count) > 0,
      total_duration_minutes: Math.round(Number(r.total_duration_seconds) / 60),
      first_joined_at: r.first_joined_at,
      last_left_at: r.last_left_at
    }));

    res.json({
      classId,
      title: classRows[0].title,
      totalBooked: roster.length,
      totalAttended: attendanceData.filter(a => a.attended).length,
      roster: attendanceData
    });
  } catch (error) {
    console.error('Fetch attendance error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// ==========================================
// Platform Statistics Route
// ==========================================
app.get('/api/stats', async (req, res) => {
  try {
    const [studentsResult] = await db.query("SELECT COUNT(*) AS total FROM users WHERE role = 'student'");
    const [classesResult] = await db.query("SELECT COUNT(*) AS total FROM live_classes");
    const [teachersResult] = await db.query("SELECT COUNT(*) AS total FROM users WHERE role = 'teacher'");

    const totalStudents = studentsResult?.[0]?.total ? Number(studentsResult[0].total) : 0;
    const totalClasses = classesResult?.[0]?.total ? Number(classesResult[0].total) : 0;
    const totalTeachers = teachersResult?.[0]?.total ? Number(teachersResult[0].total) : 0;

    res.json({
      students: totalStudents,
      classes: totalClasses,
      teachers: totalTeachers
    });
  } catch (error) {
    console.error('Stats endpoint error:', error);
    res.status(500).json({ message: 'Internal server error.', details: error.message });
  }
});

// ==========================================
// User Profile Routes
// ==========================================
app.put('/api/user/profile', verifyToken, async (req, res) => {
  const { full_name } = req.body;
  if (!full_name || full_name.trim().length === 0) {
    return res.status(400).json({ message: 'Full name cannot be empty.' });
  }

  try {
    await db.query('UPDATE users SET full_name = ? WHERE id = ?', [full_name.trim(), req.user.id]);
    res.json({ message: 'Profile updated successfully!' });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

app.put('/api/user/password', verifyToken, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ message: 'Current and new password are required.' });
  }

  try {
    const [users] = await db.query('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (users.length === 0) return res.status(404).json({ message: 'User not found.' });

    const user = users[0];
    const isPasswordValid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isPasswordValid) {
      return res.status(400).json({ message: 'Incorrect current password.' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await db.query('UPDATE users SET password_hash = ? WHERE id = ?', [hashedPassword, req.user.id]);
    res.json({ message: 'Password updated successfully!' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

app.put('/api/teacher/profile', verifyToken, requireActiveTeacherOrAdmin, async (req, res) => {
  if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Access denied.' });
  }

  const { full_name, bio, profile_pic } = req.body;
  try {
    await db.query(
      'UPDATE users SET full_name = ?, bio = ?, profile_pic = ? WHERE id = ?', 
      [full_name, bio, profile_pic, req.user.id]
    );
    res.json({ message: 'Profile updated successfully!' });
  } catch (error) {
    console.error('Update teacher profile error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

app.get('/api/user/profile', verifyToken, async (req, res) => {
  try {
    const [users] = await db.query('SELECT id, full_name, email, role, account_status, bio, profile_pic FROM users WHERE id = ?', [req.user.id]);
    if (users.length === 0) return res.status(404).json({ message: 'User not found' });
    res.json(users[0]);
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

const PORT = process.env.PORT || 5000;

async function startServer() {
  const bootstrapConfigured = Boolean(
    process.env.ADMIN_EMAIL?.trim() &&
    process.env.ADMIN_PASSWORD &&
    process.env.ADMIN_NAME?.trim()
  );
  console.log(`Admin bootstrap configuration: ${bootstrapConfigured ? 'present' : 'absent'}`);

  try {
    const result = await seedAdmin();
    console.log(`Admin bootstrap result: ${result.created ? 'created' : result.reason}`);
  } catch (error) {
    // Bootstrap failures must not prevent normal API startup or expose credentials.
    console.error('Admin bootstrap unavailable:', error.message);
  }

  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };