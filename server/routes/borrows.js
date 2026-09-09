const express = require('express');
const router = express.Router();
const { db } = require('../db');

// Helper to update overdue status dynamically
function updateOverdueStatuses() {
  const today = new Date().toISOString().split('T')[0];
  db.prepare(`
    UPDATE borrow_records
    SET status = 'overdue'
    WHERE return_date IS NULL AND due_date < ? AND status = 'active'
  `).run(today);
}

// POST /api/borrows/issue - Issue a book to a student
router.post('/issue', (req, res) => {
  try {
    const { student_id, book_id, due_days = 14, custom_due_date, notes } = req.body;

    if (!student_id || !book_id) {
      return res.status(400).json({ error: 'Student and Book are required.' });
    }

    // Verify student
    const student = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'student'").get(student_id);
    if (!student) {
      return res.status(404).json({ error: 'Student not found or invalid role.' });
    }

    // Verify book
    const book = db.prepare('SELECT * FROM books WHERE id = ?').get(book_id);
    if (!book) {
      return res.status(404).json({ error: 'Book not found.' });
    }

    if (book.available_copies <= 0) {
      return res.status(400).json({ error: `No available copies for "${book.title}". All copies are currently issued.` });
    }

    // Check if student already has an active copy of this book
    const existingBorrow = db.prepare(`
      SELECT id FROM borrow_records
      WHERE user_id = ? AND book_id = ? AND status IN ('active', 'overdue')
    `).get(student_id, book_id);

    if (existingBorrow) {
      return res.status(400).json({
        error: `${student.name} already has an active borrowed copy of "${book.title}".`
      });
    }

    // Calculate dates
    const today = new Date();
    const issue_date = today.toISOString().split('T')[0];

    let due_date;
    if (custom_due_date) {
      due_date = custom_due_date;
    } else {
      const due = new Date();
      due.setDate(due.getDate() + parseInt(due_days));
      due_date = due.toISOString().split('T')[0];
    }

    // Execute transaction
    const issueTx = db.transaction(() => {
      // 1. Insert borrow record
      const result = db.prepare(`
        INSERT INTO borrow_records (book_id, user_id, issue_date, due_date, status, notes)
        VALUES (?, ?, ?, ?, 'active', ?)
      `).run(book_id, student_id, issue_date, due_date, notes || 'Regular loan');

      // 2. Decrement available copies & update status if 0
      const newAvailable = book.available_copies - 1;
      const newStatus = newAvailable === 0 ? 'Issued' : 'Available';

      db.prepare(`
        UPDATE books
        SET available_copies = ?, status = ?
        WHERE id = ?
      `).run(newAvailable, newStatus, book_id);

      return result.lastInsertRowid;
    });

    const borrowId = issueTx();

    res.status(201).json({
      message: `"${book.title}" successfully issued to ${student.name} (${student.user_id}).`,
      borrow_id: borrowId,
      due_date: due_date
    });
  } catch (err) {
    console.error('Issue book error:', err);
    res.status(500).json({ error: 'Failed to issue book.' });
  }
});

// POST /api/borrows/return - Return an issued book
router.post('/return', (req, res) => {
  try {
    const { borrow_id, return_notes } = req.body;

    if (!borrow_id) {
      return res.status(400).json({ error: 'Borrow Record ID is required.' });
    }

    const record = db.prepare(`
      SELECT br.*, b.title as book_title, b.total_copies, b.available_copies, u.name as student_name
      FROM borrow_records br
      JOIN books b ON br.book_id = b.id
      JOIN users u ON br.user_id = u.id
      WHERE br.id = ?
    `).get(borrow_id);

    if (!record) {
      return res.status(404).json({ error: 'Borrow record not found.' });
    }

    if (record.status === 'returned') {
      return res.status(400).json({ error: 'This book has already been returned.' });
    }

    const returnDate = new Date().toISOString().split('T')[0];

    // Execute transaction
    const returnTx = db.transaction(() => {
      // 1. Update borrow record
      db.prepare(`
        UPDATE borrow_records
        SET return_date = ?, status = 'returned', notes = COALESCE(notes || ' | ' || ?, notes)
        WHERE id = ?
      `).run(returnDate, return_notes || 'Returned', borrow_id);

      // 2. Increment available copies (up to total_copies)
      const newAvailable = Math.min(record.total_copies, record.available_copies + 1);
      db.prepare(`
        UPDATE books
        SET available_copies = ?, status = 'Available'
        WHERE id = ?
      `).run(newAvailable, record.book_id);
    });

    returnTx();

    res.json({
      message: `"${record.book_title}" returned successfully by ${record.student_name}. Stock restored to Available.`,
      return_date: returnDate
    });
  } catch (err) {
    console.error('Return book error:', err);
    res.status(500).json({ error: 'Failed to return book.' });
  }
});

// GET /api/borrows/active - All currently issued books
router.get('/active', (req, res) => {
  try {
    updateOverdueStatuses();

    const activeLoans = db.prepare(`
      SELECT br.id as borrow_id, br.issue_date, br.due_date, br.status, br.notes,
             b.id as book_id, b.title as book_title, b.author, b.isbn, b.rack_number, b.category,
             u.id as student_id, u.user_id as student_roll, u.name as student_name, u.department, u.phone, u.email,
             CAST((julianday('now') - julianday(br.due_date)) AS INTEGER) as days_overdue
      FROM borrow_records br
      JOIN books b ON br.book_id = b.id
      JOIN users u ON br.user_id = u.id
      WHERE br.status IN ('active', 'overdue')
      ORDER BY br.due_date ASC
    `).all();

    res.json(activeLoans);
  } catch (err) {
    console.error('Fetch active borrows error:', err);
    res.status(500).json({ error: 'Failed to fetch active loans.' });
  }
});

// GET /api/borrows/overdue - Overdue books list
router.get('/overdue', (req, res) => {
  try {
    updateOverdueStatuses();

    const overdueLoans = db.prepare(`
      SELECT br.id as borrow_id, br.issue_date, br.due_date, br.status, br.notes,
             b.id as book_id, b.title as book_title, b.author, b.isbn, b.rack_number, b.category,
             u.id as student_id, u.user_id as student_roll, u.name as student_name, u.department, u.phone, u.email,
             CAST((julianday('now') - julianday(br.due_date)) AS INTEGER) as days_overdue
      FROM borrow_records br
      JOIN books b ON br.book_id = b.id
      JOIN users u ON br.user_id = u.id
      WHERE br.status = 'overdue' OR (br.return_date IS NULL AND br.due_date < date('now'))
      ORDER BY br.due_date ASC
    `).all();

    res.json(overdueLoans);
  } catch (err) {
    console.error('Fetch overdue error:', err);
    res.status(500).json({ error: 'Failed to fetch overdue books.' });
  }
});

// GET /api/borrows/history - Full audit history
router.get('/history', (req, res) => {
  try {
    updateOverdueStatuses();
    const { student_id, status } = req.query;

    let query = `
      SELECT br.id as borrow_id, br.issue_date, br.due_date, br.return_date, br.status, br.notes,
             b.id as book_id, b.title as book_title, b.author, b.isbn, b.rack_number, b.category,
             u.id as student_id, u.user_id as student_roll, u.name as student_name, u.department
      FROM borrow_records br
      JOIN books b ON br.book_id = b.id
      JOIN users u ON br.user_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (student_id) {
      query += ` AND br.user_id = ?`;
      params.push(student_id);
    }

    if (status && status !== 'All') {
      query += ` AND br.status = ?`;
      params.push(status);
    }

    query += ` ORDER BY br.id DESC`;

    const history = db.prepare(query).all(...params);
    res.json(history);
  } catch (err) {
    console.error('Fetch history error:', err);
    res.status(500).json({ error: 'Failed to fetch borrowing history.' });
  }
});

// GET /api/borrows/my-books/:userId - Student personal active and history
router.get('/my-books/:userId', (req, res) => {
  try {
    updateOverdueStatuses();
    const { userId } = req.params;

    const activeBooks = db.prepare(`
      SELECT br.id as borrow_id, br.issue_date, br.due_date, br.status, br.notes,
             b.id as book_id, b.title as book_title, b.author, b.isbn, b.rack_number, b.category, b.floor, b.section,
             CAST((julianday('now') - julianday(br.due_date)) AS INTEGER) as days_overdue
      FROM borrow_records br
      JOIN books b ON br.book_id = b.id
      WHERE br.user_id = ? AND br.status IN ('active', 'overdue')
      ORDER BY br.due_date ASC
    `).all(userId);

    const history = db.prepare(`
      SELECT br.id as borrow_id, br.issue_date, br.due_date, br.return_date, br.status, br.notes,
             b.id as book_id, b.title as book_title, b.author, b.isbn, b.rack_number, b.category
      FROM borrow_records br
      JOIN books b ON br.book_id = b.id
      WHERE br.user_id = ? AND br.status = 'returned'
      ORDER BY br.return_date DESC
    `).all(userId);

    res.json({
      active: activeBooks,
      history: history
    });
  } catch (err) {
    console.error('Fetch my-books error:', err);
    res.status(500).json({ error: 'Failed to fetch student books.' });
  }
});

module.exports = router;
