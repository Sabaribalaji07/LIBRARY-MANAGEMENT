/**
 * @fileoverview Analytics, KPI Dashboard, and Database Introspection API Routes
 * @description Computes real-time catalog metrics (total titles, volume count, available stock,
 *              active loans, overdue counts), category distributions, rack layouts, and table exports.
 * @module server/routes/stats
 */

const express = require('express');
const router = express.Router();
const { db } = require('../db');

/**
 * GET /api/stats/overview
 * @summary Real-time Dashboard KPI Metrics & Distribution Breakdown
 * @description Aggregates title counts, total vs available copy volumes, overdue count,
 *              category counts, and rack distribution for librarian analytics.
 * 
 * @route GET /api/stats/overview
 * @returns {200} JSON { totalTitles, totalCopies, availableCopies, issuedCopies, overdueCount, totalStudents, categoryStats, rackDistribution }
 */
router.get('/overview', (req, res, next) => {
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
    next(err);
  }
});

/**
 * GET /api/stats/tables
 * @summary Database Table Introspection for Visual SQLite DB Explorer
 * @route GET /api/stats/tables
 * @returns {200} Sanitized dump of users, books, and borrow records
 */
router.get('/tables', (req, res, next) => {
  try {
    const users = db.prepare('SELECT id, user_id, name, email, role, department, phone FROM users').all();
    const books = db.prepare('SELECT * FROM books').all();
    const borrows = db.prepare(`
      SELECT br.*, b.title as book_title, u.name as user_name
      FROM borrow_records br
      JOIN books b ON br.book_id = b.id
      JOIN users u ON br.user_id = u.id
      ORDER BY br.id DESC
    `).all();

    res.json({ users, books, borrows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
