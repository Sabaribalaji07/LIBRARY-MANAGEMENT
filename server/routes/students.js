const express = require('express');
const router = express.Router();
const { db } = require('../db');

// GET /api/students - List all students
router.get('/', (req, res) => {
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
    res.status(500).json({ error: 'Failed to fetch students list.' });
  }
});

module.exports = router;
