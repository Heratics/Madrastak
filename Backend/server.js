const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const db = require('./db');

const app = express();

app.use(cors());
app.use(express.json());

// Health check route
app.get('/api/health', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT NOW() AS db_time');
    res.json({ status: 'healthy', db_time: rows[0].db_time });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// 1. User Registration Route
app.post('/api/register', async (req, res) => {
  const { full_name, email, password, role } = req.body;

  try {
    // Check if the user already exists
    const [existingUsers] = await db.query('SELECT email FROM users WHERE email = ?', [email]);
    if (existingUsers.length > 0) {
      return res.status(400).json({ message: 'Email is already in use.' });
    }

    // Hash the password with 10 salt rounds
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Default to 'student' if no valid role is provided
    const userRole = role === 'teacher' || role === 'admin' ? role : 'student';

    // Insert user into the database
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

// 2. User Login Route
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    // Find the user
    const [users] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
    if (users.length === 0) {
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    const user = users[0];

    // Compare the submitted password with the stored hash
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    // Generate a JWT
    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    // Send the token and user data (excluding the password)
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

const crypto = require('crypto'); // Built-in Node.js tool to generate unique strings

// --- JWT Middleware (The Security Check) ---
const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ message: 'Access Denied: No token provided' });
  
  const token = authHeader.split(' ')[1]; // Extracts the token after "Bearer"
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // Attaches user ID and role to the request
    next();
  } catch (error) {
    res.status(401).json({ message: 'Access Denied: Invalid token' });
  }
};

// --- 3. Create a Live Class (Teachers Only) ---
app.post('/api/classes', verifyToken, async (req, res) => {
  if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Only teachers can schedule classes.' });
  }

  const { title, description, start_time, duration_minutes } = req.body;

  // FIX: Convert JS ISO String to MySQL format (YYYY-MM-DD HH:MM:SS)
  const mysql_start_time = new Date(start_time).toISOString().slice(0, 19).replace('T', ' ');

  try {
    // 1. Generate a completely unique, random room name for Jitsi
    const meeting_room_id = `Madrastak-${crypto.randomUUID()}`;

    // 2. Save the class and the unique Jitsi room name to MySQL
    const [result] = await db.query(
      'INSERT INTO live_classes (teacher_id, title, description, start_time, duration_minutes, meeting_room_id) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, title, description, mysql_start_time, duration_minutes, meeting_room_id]
    );

    res.status(201).json({ 
      message: 'Class scheduled successfully!', 
      classId: result.insertId, 
      roomName: meeting_room_id 
    });
  } catch (error) {
    console.error('Class creation error:', error);
    res.status(500).json({ message: 'Internal server error.', details: error.message });
  }
});

// --- 4. Book a Class (Students Only) ---
app.post('/api/bookings', verifyToken, async (req, res) => {
  if (req.user.role !== 'student') {
    return res.status(403).json({ message: 'Only students can book classes.' });
  }

  const { class_id } = req.body;

  try {
    await db.query(
      'INSERT INTO class_bookings (student_id, class_id) VALUES (?, ?)',
      [req.user.id, class_id]
    );
    res.status(201).json({ message: 'Successfully booked the class!' });
  } catch (error) {
    // Our UNIQUE KEY constraint catches double-bookings automatically
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ message: 'You are already registered for this class.' });
    }
    console.error('Booking error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// --- 5. Get All Upcoming Classes ---
app.get('/api/classes', async (req, res) => {
  try {
    const [classes] = await db.query(`
      SELECT lc.*, u.full_name AS teacher_name, u.bio AS teacher_bio, u.profile_pic AS teacher_profile_pic 
      FROM live_classes lc 
      JOIN users u ON lc.teacher_id = u.id 
      ORDER BY lc.start_time ASC
    `);
    res.json(classes);
  } catch (error) {
    console.error('Fetch classes error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// --- 6. Get Teacher's Specific Classes & Booked Students ---
app.get('/api/teacher/classes', verifyToken, async (req, res) => {
  if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Access denied.' });
  }

  try {
    // Get classes created by this teacher
    const [classes] = await db.query(
      'SELECT * FROM live_classes WHERE teacher_id = ? ORDER BY start_time ASC',
      [req.user.id]
    );

    // For each class, fetch the students who booked it
    for (let cls of classes) {
      const [students] = await db.query(
        `SELECT u.id, u.full_name, u.email 
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

// --- 7. Delete a Class (Teacher Only) ---
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

// --- 8. Get Student's Booked Classes ---
app.get('/api/student/bookings', verifyToken, async (req, res) => {
  if (req.user.role !== 'student' && req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Access denied.' });
  }

  try {
    const [bookings] = await db.query(
      `SELECT lc.*, u.full_name AS teacher_name 
       FROM class_bookings cb 
       JOIN live_classes lc ON cb.class_id = lc.id 
       JOIN users u ON lc.teacher_id = u.id 
       WHERE cb.student_id = ? 
       ORDER BY lc.start_time ASC`,
      [req.user.id]
    );
    res.json(bookings);
  } catch (error) {
    console.error('Student bookings error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// --- 9. Get Platform Statistics (Real-Time from DB) ---
app.get('/api/stats', async (req, res) => {
  try {
    const [studentRows] = await db.query('SELECT COUNT(*) AS count FROM users WHERE LOWER(role) = "student"');
    const [classRows] = await db.query('SELECT COUNT(*) AS count FROM live_classes');
    const [teacherRows] = await db.query('SELECT COUNT(*) AS count FROM users WHERE LOWER(role) = "teacher"');

    const statsData = {
      students: parseInt(studentRows[0]?.count, 10) || 0,
      classes: parseInt(classRows[0]?.count, 10) || 0,
      teachers: parseInt(teacherRows[0]?.count, 10) || 0
    };

    console.log('Stats fetched from DB:', statsData);
    res.json(statsData);
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// --- Update User Profile ---
app.put('/api/user/profile', verifyToken, async (req, res) => {
  const { full_name } = req.body;
  try {
    await db.query('UPDATE users SET full_name = ? WHERE id = ?', [full_name, req.user.id]);
    res.json({ message: 'Profile updated successfully!' });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// --- Change User Password ---
app.put('/api/user/password', verifyToken, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
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

// --- Update Instructor Profile ---
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

// --- Get User Profile ---
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