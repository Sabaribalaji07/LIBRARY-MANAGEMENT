/**
 * @fileoverview Student Roster and Circulation Profile API Routes
 * @description Provides registered student listings, active loan counters, and department mappings.
 * @module server/routes/students
 */

const express = require('express');
const router = express.Router();
const { db } = require('../db');

/**
 * GET /api/students
 * @summary Retrieves list of registered students with active loan counts
 * @route GET /api/students
 * @returns {200} Array of student records including computed active_loans_count
 * @returns {500} Error envelope if query fails
 */
router.get('/', (req, res, next) => {
  try {
    const students = db.prepare(`
      SELECT u.id, u.user_id, u.name, u.email, u.department, u.phone,
             (SELECT COUNT(*) FROM borrow_records br WHERE br.user_id = u.id AND br.status IN ('active', 'overdue')) as active_loans_count
      FROM users u
      WHERE u.role = 'student'
      ORDER BY u.name ASC
    `).all();

    res.json(students);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
