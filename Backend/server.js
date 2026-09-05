const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
require('dotenv').config();
const db = require('./db');
const { generateJaasToken } = require('./jaas');

const app = express();

app.use(cors());
app.use(express.json());

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

  let limit = null;
  if (student_limit !== undefined && student_limit !== null && student_limit !== '' && student_limit !== 'unlimited') {
    const parsedLimit = parseInt(student_limit, 10);
    if (isNaN(parsedLimit) || parsedLimit <= 0) {
      return { valid: false, error: 'Student limit must be a positive number or "unlimited".' };
    }
    if (parsedLimit > 1000) {
      return { valid: false, error: 'Student limit cannot exceed 1000 students.' };
    }
    limit = parsedLimit;
  }

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
      db.query('UPDATE live_classes SET status = "ended" WHERE id = ?', [cls.id]).catch(() => {});
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
const verifyToken = (req, res, next) => {
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
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ message: 'Access Denied: Invalid token' });
  }
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
    const userRole = role === 'teacher' || role === 'admin' ? role : 'student';

    const [result] = await db.query(
      'INSERT INTO users (full_name, email, password_hash, role) VALUES (?, ?, ?, ?)',
      [full_name, email, hashedPassword, userRole]
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
    const [users] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
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
      { expiresIn: '8h' }
    );

    res.json({
      message: 'Login successful!',
      token,
      user: { id: user.id, full_name: user.full_name, email: user.email, role: user.role }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// ==========================================
// Live Class Management Routes
// ==========================================

// Create a Live Class (Teachers/Admins Only)
// Resilient to whether migrations have been executed yet
app.post('/api/classes', verifyToken, async (req, res) => {
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
app.get('/api/classes/:id/access', verifyToken, async (req, res) => {
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

    const isTeacher = (req.user.id === cls.teacher_id || req.user.role === 'admin');

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
      await db.query('UPDATE live_classes SET status = "live" WHERE id = ?', [classId]).catch(() => {});
      cls.status = 'live';
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

    res.json({
      allowed: true,
      classId: cls.id,
      title: cls.title,
      description: cls.description,
      meeting_room_id: cls.meeting_room_id,
      status: cls.status,
      isHost: isTeacher,
      duration_minutes: cls.duration_minutes,
      start_time: normalizeToIsoString(cls.start_time),
      teacher_name: cls.teacher_name,
      jaas: jaasData ? {
        appId: jaasData.appId,
        jwt: jaasData.token
      } : null
    });
  } catch (error) {
    console.error('Access check error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// Teacher: Explicitly Start Lecture
app.post('/api/classes/:id/start', verifyToken, async (req, res) => {
  const classId = req.params.id;

  try {
    const [rows] = await db.query('SELECT teacher_id, status FROM live_classes WHERE id = ?', [classId]);
    if (rows.length === 0) return res.status(404).json({ message: 'Class not found.' });

    if (rows[0].teacher_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied.' });
    }

    await db.query('UPDATE live_classes SET status = "live" WHERE id = ?', [classId]).catch(() => {});
    res.json({ message: 'Lecture is now live!', status: 'live' });
  } catch (error) {
    console.error('Start class error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// Teacher: Explicitly End Lecture
app.post('/api/classes/:id/end', verifyToken, async (req, res) => {
  const classId = req.params.id;

  try {
    const [rows] = await db.query('SELECT teacher_id, status FROM live_classes WHERE id = ?', [classId]);
    if (rows.length === 0) return res.status(404).json({ message: 'Class not found.' });

    if (rows[0].teacher_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied.' });
    }

    await db.query('UPDATE live_classes SET status = "ended" WHERE id = ?', [classId]).catch(() => {});

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
app.get('/api/teacher/classes', verifyToken, async (req, res) => {
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
app.delete('/api/classes/:id', verifyToken, async (req, res) => {
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

// ==========================================
// Booking & Capacity Routes
// ==========================================

// Student: Book a Class (Concurrency-Safe Transaction)
app.post('/api/bookings', verifyToken, async (req, res) => {
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
app.get('/api/student/bookings', verifyToken, async (req, res) => {
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
app.post('/api/classes/:id/attendance/join', verifyToken, async (req, res) => {
  const classId = req.params.id;
  const userId = req.user.id;

  try {
    const [classRows] = await db.query('SELECT teacher_id FROM live_classes WHERE id = ?', [classId]);
    if (classRows.length === 0) return res.status(404).json({ message: 'Class not found.' });

    const isTeacher = (classRows[0].teacher_id === userId || req.user.role === 'admin');

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
app.post('/api/classes/:id/attendance/leave', verifyToken, async (req, res) => {
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
app.post('/api/classes/:id/attendance/heartbeat', verifyToken, async (req, res) => {
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
    res.json({ ended: false, message: 'Heartbeat recorded.' });
  } catch (error) {
    console.error('Attendance heartbeat error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// Teacher: View Class Attendance Roster
app.get('/api/teacher/classes/:id/attendance', verifyToken, async (req, res) => {
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

app.put('/api/teacher/profile', verifyToken, async (req, res) => {
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
    const [users] = await db.query('SELECT id, full_name, email, role, bio, profile_pic FROM users WHERE id = ?', [req.user.id]);
    if (users.length === 0) return res.status(404).json({ message: 'User not found' });
    res.json(users[0]);
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});