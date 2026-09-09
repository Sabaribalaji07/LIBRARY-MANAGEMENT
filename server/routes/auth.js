const express = require('express');
const router = express.Router();
const { db } = require('../db');

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

    // Password check (plain text for beginner simplicity & presentation)
    if (user.password !== password) {
      return res.status(401).json({ error: 'Incorrect password.' });
    }

    // Return sanitized user object
    const { password: _, ...userData } = user;
    res.json({
      message: 'Login successful',
      user: userData
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
      SELECT id, user_id, name, email, password, role, department
      FROM users
      ORDER BY role DESC, name ASC
    `).all();

    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch demo users.' });
  }
});

module.exports = router;
