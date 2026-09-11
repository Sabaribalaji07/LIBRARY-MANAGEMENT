const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { db } = require('../db');

// In-memory session store for authentication tokens
const activeSessions = new Map();

// POST /api/auth/login
router.post('/login', (req, res) => {
  try {
    const { identifier, password, role } = req.body;

    if (!identifier || !password) {
      return res.status(400).json({ error: 'User ID / Email and Password are required.' });
    }

    const query = `
      SELECT id, user_id, name, email, password, role, department, phone
      FROM users
      WHERE (user_id = ? OR LOWER(email) = LOWER(?))
    `;

    const user = db.prepare(query).get(identifier.trim(), identifier.trim());

    if (!user) {
      return res.status(401).json({ error: 'Invalid User ID or Email.' });
    }

    // Role check if provided
    if (role && user.role !== role) {
      return res.status(401).json({ error: `Account found, but it is not registered as a ${role}.` });
    }

    // Password verification via bcrypt (with fallback for legacy plaintext migration)
    const isBcryptHash = user.password.startsWith('$2a$') || user.password.startsWith('$2b$');
    const isPasswordValid = isBcryptHash 
      ? bcrypt.compareSync(password, user.password)
      : (user.password === password);

    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Incorrect password.' });
    }

    // If legacy plaintext was matched, seamlessly upgrade hash in database
    if (!isBcryptHash) {
      const newHash = bcrypt.hashSync(password, 10);
      db.prepare('UPDATE users SET password = ? WHERE id = ?').run(newHash, user.id);
    }

    // Generate secure session token
    const token = crypto.randomBytes(32).toString('hex');
    const sessionData = {
      id: user.id,
      user_id: user.user_id,
      name: user.name,
      email: user.email,
      role: user.role,
      department: user.department,
      phone: user.phone,
      loginAt: new Date().toISOString()
    };
    activeSessions.set(token, sessionData);

    // Return sanitized user object & session token (never return password hash)
    res.json({
      message: 'Login successful',
      token: token,
      user: sessionData
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error during login.' });
  }
});

// GET /api/auth/demo-users (For convenient 1-click viva/demo login)
router.get('/demo-users', (req, res) => {
  try {
    const users = db.prepare(`
      SELECT id, user_id, name, email, role, department
      FROM users
      ORDER BY role DESC, name ASC
    `).all();

    // Map known display passwords for 1-click demo interface helper
    const demoPayload = users.map(u => ({
      ...u,
      password: u.role === 'librarian' ? 'admin' : '123'
    }));

    res.json(demoPayload);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch demo users.' });
  }
});

module.exports = router;
