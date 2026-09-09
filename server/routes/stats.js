const express = require('express');
const router = express.Router();
const { db } = require('../db');

// GET /api/stats/overview - Dashboard stats
router.get('/overview', (req, res) => {
  try {
    const totalTitles = db.prepare('SELECT COUNT(*) as count FROM books').get().count;
    const copiesStats = db.prepare(`
      SELECT SUM(total_copies) as total_copies, SUM(available_copies) as available_copies
      FROM books
    `).get();

    const totalCopies = copiesStats.total_copies || 0;
    const availableCopies = copiesStats.available_copies || 0;
    const issuedCopies = totalCopies - availableCopies;

    const totalStudents = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'student'").get().count;

    const today = new Date().toISOString().split('T')[0];
    const overdueCount = db.prepare(`
      SELECT COUNT(*) as count FROM borrow_records
      WHERE return_date IS NULL AND due_date < ?
    `).get(today).count;

    const categoryStats = db.prepare(`
      SELECT category, COUNT(*) as count, SUM(total_copies) as copies
      FROM books
      GROUP BY category
      ORDER BY count DESC
    `).all();

    const rackDistribution = db.prepare(`
      SELECT rack_number, floor, section, COUNT(*) as book_count
      FROM books
      GROUP BY rack_number
      ORDER BY rack_number ASC
    `).all();

    res.json({
      totalTitles,
      totalCopies,
      availableCopies,
      issuedCopies,
      overdueCount,
      totalStudents,
      categoryStats,
      rackDistribution
    });
  } catch (err) {
    console.error('Stats overview error:', err);
    res.status(500).json({ error: 'Failed to fetch statistics.' });
  }
});

// GET /api/stats/tables - Direct table data for DB inspection
router.get('/tables', (req, res) => {
  try {
    const users = db.prepare('SELECT * FROM users').all();
    const books = db.prepare('SELECT * FROM books').all();
    const borrow_records = db.prepare(`
      SELECT br.*, u.name as student_name, u.user_id as student_code, b.title as book_title, b.isbn as book_isbn 
      FROM borrow_records br 
      LEFT JOIN users u ON br.user_id = u.id 
      LEFT JOIN books b ON br.book_id = b.id
    `).all();

    res.json({ users, books, borrow_records });
  } catch (err) {
    console.error('Tables export error:', err);
    res.status(500).json({ error: 'Failed to fetch tables.' });
  }
});

module.exports = router;
