/**
 * @fileoverview Authentication and Session Management API Routes
 * @description Provides credential verification with BCrypt hashing, role boundary
 *              validation, cryptographically secure session token issuance, and
 *              evaluation demo user rosters.
 * @module server/routes/auth
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { db } = require('../db');

/**
 * In-memory token store for active sessions.
 * Maps cryptographic bearer hex tokens to user session metadata payloads.
 * @type {Map<string, object>}
 */
const activeSessions = new Map();

/**
 * POST /api/auth/login
 * @summary Authenticates user credentials (student or librarian)
 * @description Validates user identifier against user_id or email, checks BCrypt hash,
 *              enforces role boundaries, and issues a 256-bit cryptographically secure session token.
 * 
 * @route POST /api/auth/login
 * @param {string} req.body.identifier - Student Roll No or Librarian ID / Email
 * @param {string} req.body.password - Plaintext password input
 * @param {string} [req.body.role] - Optional expected role ('student' | 'librarian')
 * 
 * @returns {200} JSON { message, token, user: { id, user_id, name, email, role, department, phone, loginAt } }
 * @returns {400} JSON { error: 'User ID / Email and Password are required.' }
 * @returns {401} JSON { error: 'Invalid credentials or role mismatch.' }
 * @returns {500} JSON { error: 'Server error during login.' }
 */
router.post('/login', (req, res, next) => {
  try {
    const { identifier, password, role } = req.body;

    // Error Boundary: Mandatory parameter validation
    if (!identifier || !password) {
      return res.status(400).json({
        success: false,
        error: 'User ID / Email and Password are required.'
      });
    }

    const cleanIdentifier = identifier.trim();

    // Query user profile by user_id or case-insensitive email
    const query = `
      SELECT id, user_id, name, email, password, role, department, phone
      FROM users
      WHERE (LOWER(user_id) = LOWER(?) OR LOWER(email) = LOWER(?))
    `;

    const user = db.prepare(query).get(cleanIdentifier, cleanIdentifier);

    // Error Boundary: Unknown user identifier
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid User ID or Email.'
      });
    }

    // Error Boundary: Role authorization boundary check
    if (role && user.role !== role) {
      return res.status(401).json({
        success: false,
        error: `Account found, but it is not registered as a ${role}.`
      });
    }

    // Password verification via BCrypt (with backwards-compatible plaintext auto-upgrade)
    const isBcryptHash = user.password.startsWith('$2a$') || user.password.startsWith('$2b$');
    const isPasswordValid = isBcryptHash 
      ? bcrypt.compareSync(password, user.password)
      : (user.password === password);

    // Error Boundary: Invalid password
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        error: 'Incorrect password.'
      });
    }

    // Auto-migration: Upgrade any unhashed legacy password to BCrypt cost factor 10
    if (!isBcryptHash) {
      const newHash = bcrypt.hashSync(password, 10);
      db.prepare('UPDATE users SET password = ? WHERE id = ?').run(newHash, user.id);
    }

    // Issue 256-bit entropy cryptographic session token
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

    // Return sanitized session payload (password hash is strictly filtered out)
    res.json({
      success: true,
      message: 'Login successful',
      token: token,
      user: sessionData
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/auth/demo-users
 * @summary Returns preset demo accounts for evaluation / viva demonstration
 * @description Provides a listing of accounts configured with demonstration credentials
 *              for fast 1-click login testing.
 * 
 * @route GET /api/auth/demo-users
 * @returns {200} Array of demo user objects with pre-filled demo passwords
 */
router.get('/demo-users', (req, res, next) => {
  try {
    const users = db.prepare(`
      SELECT id, user_id, name, email, role, department
      FROM users
      ORDER BY role DESC, name ASC
    `).all();

    // Attach demonstration passwords to facilitate 1-click evaluation login
    const demoPayload = users.map(u => ({
      ...u,
      password: u.role === 'librarian' ? 'admin' : '123'
    }));

    res.json(demoPayload);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
