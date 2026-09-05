const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
require('dotenv').config();
const db = require('./db');

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

  // Allow up to 5 minutes in the past to account for slight clock skew during form submission
  const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
  if (start.getTime() < fiveMinutesAgo) {
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
 * Computes the real-time lecture status (scheduled, live, ended) based on time and manual overrides.
 * Automatically updates the database when an active/scheduled class has ended.
 */
function evaluateClassStatus(cls) {
  if (cls.status === 'ended') return 'ended';

  const startTime = new Date(cls.start_time).getTime();
  const durationMinutes = Number(cls.duration_minutes) || 60;
  const now = Date.now();

  // If duration is not unlimited, check if scheduled duration has elapsed
  if (durationMinutes < 999999) {
    const endTime = startTime + (durationMinutes * 60 * 1000);
    if (now >= endTime) {
      // Async update in DB without blocking response
      db.query('UPDATE live_classes SET status = "ended" WHERE id = ?', [cls.id]).catch(err => {
        console.error(`Failed to auto-update class ${cls.id} status to ended:`, err);
      });
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
app.post('/api/classes', verifyToken, async (req, res) => {
  if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Only teachers can schedule classes.' });
  }

  const { title, description, start_time, duration_minutes, student_limit } = req.body;

  // Strict server-side validation
  const validation = validateClassInput({ title, description, start_time, duration_minutes, student_limit });
  if (!validation.valid) {
    return res.status(400).json({ message: validation.error });
  }

  const mysql_start_time = new Date(start_time).toISOString().slice(0, 19).replace('T', ' ');

  try {
    // Generate an unpredictable, high-entropy unique room name for Jitsi
    const meeting_room_id = `Madrastak-${crypto.randomUUID()}`;

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

    res.status(201).json({ 
      message: 'Class scheduled successfully!', 
      classId: result.insertId,
      student_limit: validation.sanitizedLimit,
      status: 'scheduled'
    });
  } catch (error) {
    console.error('Class creation error:', error);
    res.status(500).json({ message: 'Internal server error.', details: error.message });
  }
});

// Get All Public Upcoming / Active Classes
// SECURITY: Explicitly excludes `meeting_room_id` from public catalog
app.get('/api/classes', async (req, res) => {
  try {
    const [classes] = await db.query(`
      SELECT 
        lc.id, 
        lc.teacher_id, 
        lc.title, 
        lc.description, 
        lc.start_time, 
        lc.duration_minutes, 
        lc.student_limit, 
        lc.status, 
        lc.created_at,
        u.full_name AS teacher_name, 
        u.bio AS teacher_bio, 
        u.profile_pic AS teacher_profile_pic,
        (SELECT COUNT(*) FROM class_bookings cb WHERE cb.class_id = lc.id) AS enrolled_count
      FROM live_classes lc 
      JOIN users u ON lc.teacher_id = u.id 
      ORDER BY lc.start_time ASC
    `);

    // Dynamically evaluate status for each class
    for (let cls of classes) {
      cls.status = evaluateClassStatus(cls);
    }

    res.json(classes);
  } catch (error) {
    console.error('Fetch classes error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// Secure Class Access Gateway
// Checks whether the authenticated user is the instructor or an enrolled student
// Only reveals `meeting_room_id` to authorized users.
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
      // Must be an enrolled student
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
      await db.query('UPDATE live_classes SET status = "live" WHERE id = ?', [classId]);
      cls.status = 'live';
    }

    // If student attempts to enter when scheduled and it's too early (>15 mins prior)
    if (!isTeacher && cls.status === 'scheduled') {
      const startTime = new Date(cls.start_time).getTime();
      const fifteenMinutesBefore = startTime - (15 * 60 * 1000);
      if (Date.now() < fifteenMinutesBefore) {
        return res.status(403).json({
          allowed: false,
          status: 'scheduled',
          start_time: cls.start_time,
          message: 'Classroom is scheduled. It will open 15 minutes prior to the start time or once the instructor begins the session.'
        });
      }
    }

    // Access granted: provide room name and metadata
    res.json({
      allowed: true,
      classId: cls.id,
      title: cls.title,
      description: cls.description,
      meeting_room_id: cls.meeting_room_id,
      status: cls.status,
      isHost: isTeacher,
      duration_minutes: cls.duration_minutes,
      start_time: cls.start_time,
      teacher_name: cls.teacher_name
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

    await db.query('UPDATE live_classes SET status = "live" WHERE id = ?', [classId]);
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

    await db.query('UPDATE live_classes SET status = "ended" WHERE id = ?', [classId]);

    // Finalize all open attendance records for this class
    await db.query(`
      UPDATE class_attendance 
      SET left_at = NOW(), 
          duration_seconds = GREATEST(duration_seconds, TIMESTAMPDIFF(SECOND, joined_at, NOW()))
      WHERE class_id = ? AND left_at IS NULL
    `, [classId]);

    res.json({ message: 'Lecture has ended.', status: 'ended' });
  } catch (error) {
    console.error('End class error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// Teacher: Get Classes Created by Current Teacher
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
       ORDER BY lc.start_time ASC`,
      [req.user.id]
    );

    for (let cls of classes) {
      cls.status = evaluateClassStatus(cls);

      const [students] = await db.query(
        `SELECT u.id, u.full_name, u.email, cb.created_at AS booked_at
         FROM class_bookings cb 
         JOIN users u ON cb.student_id = u.id 
         WHERE cb.class_id = ?`,
        [cls.id]
      );
      cls.enrolled_students = students;
    }

    res.json(classes);
  } catch (error) {
    console.error('Teacher classes error:', error);
    res.status(500).json({ message: 'Internal server error.' });
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

    // 1. Lock the class row to prevent race conditions during concurrent bookings
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

    // 2. Check if student already booked
    const [existing] = await connection.query(
      'SELECT id FROM class_bookings WHERE student_id = ? AND class_id = ?',
      [req.user.id, class_id]
    );

    if (existing.length > 0) {
      await connection.rollback();
      return res.status(400).json({ message: 'You are already registered for this class.' });
    }

    // 3. Enforce student capacity limit
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

    // 4. Insert booking safely
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
    // 1. Verify that booking belongs to this student
    const [bookings] = await db.query(
      'SELECT id FROM class_bookings WHERE student_id = ? AND class_id = ?',
      [req.user.id, classId]
    );

    if (bookings.length === 0) {
      return res.status(404).json({ message: 'Booking not found or not owned by you.' });
    }

    // 2. Check if the lecture has already ended
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

    // 3. Remove booking
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
      b.status = evaluateClassStatus(b);
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

// Record Join Session (Resumes recent session if reconnecting within 5 minutes)
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

    // Reuse open session OR resume recently closed session within last 5 minutes (for page reloads/reconnects)
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

    res.status(201).json({ message: 'Attendance recorded', sessionId: result.insertId });
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

    await db.query(query, params);
    res.json({ message: 'Leave recorded.' });
  } catch (error) {
    console.error('Attendance leave error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// Periodic Attendance Heartbeat (every 20s from Classroom UI)
// Detects if class has ended and notifies participant
app.post('/api/classes/:id/attendance/heartbeat', verifyToken, async (req, res) => {
  const classId = req.params.id;
  const userId = req.user.id;
  const { sessionId } = req.body || {};

  try {
    // 1. Check if class has been ended by instructor or duration expired
    const [classRows] = await db.query('SELECT status, start_time, duration_minutes FROM live_classes WHERE id = ?', [classId]);
    if (classRows.length > 0) {
      const status = evaluateClassStatus(classRows[0]);
      if (status === 'ended') {
        // Class ended - stamp attendance and alert client
        await db.query(`
          UPDATE class_attendance 
          SET left_at = NOW(), 
              duration_seconds = GREATEST(duration_seconds, TIMESTAMPDIFF(SECOND, joined_at, NOW()))
          WHERE class_id = ? AND user_id = ? AND left_at IS NULL
        `, [classId, userId]);

        return res.json({ ended: true, message: 'This lecture has concluded.' });
      }
    }

    // 2. Update session duration
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

    await db.query(query, params);
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

    // Get all booked students, left join with their attendance summaries
    const [roster] = await db.query(`
      SELECT 
        u.id AS student_id,
        u.full_name,
        u.email,
        cb.created_at AS booked_at,
        COUNT(ca.id) AS session_count,
        COALESCE(SUM(ca.duration_seconds), 0) AS total_duration_seconds,
        MIN(ca.joined_at) AS first_joined_at,
        MAX(ca.left_at) AS last_left_at
      FROM class_bookings cb
      JOIN users u ON cb.student_id = u.id
      LEFT JOIN class_attendance ca ON ca.class_id = cb.class_id AND ca.user_id = cb.student_id
      WHERE cb.class_id = ?
      GROUP BY u.id, u.full_name, u.email, cb.created_at
      ORDER BY u.full_name ASC
    `, [classId]);

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