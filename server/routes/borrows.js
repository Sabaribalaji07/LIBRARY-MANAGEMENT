const express = require('express');
const router = express.Router();
const { db } = require('../db');

// Fine policy parameters
const FINE_RATE_PER_DAY = 5;   // ₹5 per day past due date
const FINE_GRACE_DAYS = 0;     // 0 days grace period
const MAX_FINE_CAP = 500;      // Maximum fine capped at ₹500

/**
 * Calculates overdue days and fine amount based on due date and return/current date.
 * @param {string} dueDateStr - ISO date string (YYYY-MM-DD)
 * @param {string|null} returnDateStr - ISO date string (YYYY-MM-DD) or null for active
 * @returns {object} Fine calculation breakdown
 */
function calculateOverdueFine(dueDateStr, returnDateStr = null) {
  if (!dueDateStr) return { days_overdue: 0, fine_amount: 0, is_overdue: false };
  
  const targetDate = returnDateStr ? new Date(returnDateStr + 'T00:00:00') : new Date();
  const dueDate = new Date(dueDateStr + 'T00:00:00');
  
  // Difference in whole calendar days
  const diffTime = targetDate.getTime() - dueDate.getTime();
  const daysOverdue = Math.max(0, Math.floor(diffTime / (1000 * 60 * 60 * 24)));

  if (daysOverdue <= FINE_GRACE_DAYS) {
    return {
      days_overdue: 0,
      billable_days: 0,
      fine_rate: FINE_RATE_PER_DAY,
      fine_amount: 0,
      is_overdue: false
    };
  }

  const billableDays = daysOverdue - FINE_GRACE_DAYS;
  const rawFine = billableDays * FINE_RATE_PER_DAY;
  const fineAmount = Math.min(rawFine, MAX_FINE_CAP);

  return {
    days_overdue: daysOverdue,
    billable_days: billableDays,
    fine_rate: FINE_RATE_PER_DAY,
    fine_amount: fineAmount,
    is_overdue: true
  };
}

// Helper to update overdue status dynamically
function updateOverdueStatuses() {
  const today = new Date().toISOString().split('T')[0];
  db.prepare(`
    UPDATE borrow_records
    SET status = 'overdue'
    WHERE return_date IS NULL AND due_date < ? AND status = 'active'
  `).run(today);
}

// POST /api/borrows/issue - Concurrency-safe atomic checkout
router.post('/issue', (req, res) => {
  try {
    const { student_id, book_id, due_days = 14, custom_due_date, notes } = req.body;

    if (!student_id || !book_id) {
      return res.status(400).json({ error: 'Student and Book are required.' });
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

    // Atomic Checkout Transaction: Validates availability INSIDE the transaction to prevent concurrency race conditions
    const issueTx = db.transaction(() => {
      // 1. Verify student inside transaction lock
      const student = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'student'").get(student_id);
      if (!student) {
        throw new Error('STUDENT_NOT_FOUND');
      }

      // 2. Lock & inspect book stock
      const book = db.prepare('SELECT * FROM books WHERE id = ?').get(book_id);
      if (!book) {
        throw new Error('BOOK_NOT_FOUND');
      }

      if (book.available_copies <= 0) {
        throw new Error('NO_COPIES_AVAILABLE');
      }

      // 3. Verify no active duplicate checkout by same student
      const existingBorrow = db.prepare(`
        SELECT id FROM borrow_records
        WHERE user_id = ? AND book_id = ? AND status IN ('active', 'overdue')
      `).get(student_id, book_id);

      if (existingBorrow) {
        throw new Error('ALREADY_BORROWED');
      }

      // 4. Insert borrow record
      const result = db.prepare(`
        INSERT INTO borrow_records (book_id, user_id, issue_date, due_date, status, notes)
        VALUES (?, ?, ?, ?, 'active', ?)
      `).run(book_id, student_id, issue_date, due_date, notes || 'Regular loan');

      // 5. Atomic decrement of available copies
      const newAvailable = book.available_copies - 1;
      const newStatus = newAvailable === 0 ? 'Issued' : 'Available';

      db.prepare(`
        UPDATE books
        SET available_copies = ?, status = ?
        WHERE id = ?
      `).run(newAvailable, newStatus, book_id);

      return {
        borrowId: result.lastInsertRowid,
        bookTitle: book.title,
        studentName: student.name,
        studentCode: student.user_id
      };
    });

    try {
      const outcome = issueTx();
      return res.status(201).json({
        message: `"${outcome.bookTitle}" successfully issued to ${outcome.studentName} (${outcome.studentCode}).`,
        borrow_id: outcome.borrowId,
        due_date: due_date
      });
    } catch (txErr) {
      if (txErr.message === 'STUDENT_NOT_FOUND') {
        return res.status(404).json({ error: 'Student not found or invalid role.' });
      }
      if (txErr.message === 'BOOK_NOT_FOUND') {
        return res.status(404).json({ error: 'Book not found.' });
      }
      if (txErr.message === 'NO_COPIES_AVAILABLE') {
        return res.status(400).json({ error: 'No available copies left. All copies are currently issued.' });
      }
      if (txErr.message === 'ALREADY_BORROWED') {
        return res.status(400).json({ error: 'Student already has an active borrowed copy of this book.' });
      }
      throw txErr;
    }
  } catch (err) {
    console.error('Issue book error:', err);
    res.status(500).json({ error: 'Failed to issue book due to server error.' });
  }
});

// POST /api/borrows/return - Return an issued book with fine computation
router.post('/return', (req, res) => {
  try {
    const { borrow_id, return_notes } = req.body;

    if (!borrow_id) {
      return res.status(400).json({ error: 'Borrow Record ID is required.' });
    }

    const returnDate = new Date().toISOString().split('T')[0];

    const returnTx = db.transaction(() => {
      const record = db.prepare(`
        SELECT br.*, b.title as book_title, b.total_copies, b.available_copies, u.name as student_name
        FROM borrow_records br
        JOIN books b ON br.book_id = b.id
        JOIN users u ON br.user_id = u.id
        WHERE br.id = ?
      `).get(borrow_id);

      if (!record) {
        throw new Error('RECORD_NOT_FOUND');
      }

      if (record.status === 'returned') {
        throw new Error('ALREADY_RETURNED');
      }

      // Calculate fine on return
      const fineDetails = calculateOverdueFine(record.due_date, returnDate);

      // 1. Update borrow record
      db.prepare(`
        UPDATE borrow_records
        SET return_date = ?, status = 'returned', notes = COALESCE(notes || ' | ' || ?, notes)
        WHERE id = ?
      `).run(returnDate, return_notes || `Returned (Fine: ₹${fineDetails.fine_amount})`, borrow_id);

      // 2. Increment available copies
      const newAvailable = Math.min(record.total_copies, record.available_copies + 1);
      db.prepare(`
        UPDATE books
        SET available_copies = ?, status = 'Available'
        WHERE id = ?
      `).run(newAvailable, record.book_id);

      return {
        bookTitle: record.book_title,
        studentName: record.student_name,
        fineDetails: fineDetails
      };
    });

    try {
      const outcome = returnTx();
      return res.json({
        message: `"${outcome.bookTitle}" returned successfully by ${outcome.studentName}. Stock restored to Available.`,
        return_date: returnDate,
        fine_amount: outcome.fineDetails.fine_amount,
        days_overdue: outcome.fineDetails.days_overdue
      });
    } catch (txErr) {
      if (txErr.message === 'RECORD_NOT_FOUND') {
        return res.status(404).json({ error: 'Borrow record not found.' });
      }
      if (txErr.message === 'ALREADY_RETURNED') {
        return res.status(400).json({ error: 'This book has already been returned.' });
      }
      throw txErr;
    }
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
             u.id as student_id, u.user_id as student_roll, u.name as student_name, u.department, u.phone, u.email
      FROM borrow_records br
      JOIN books b ON br.book_id = b.id
      JOIN users u ON br.user_id = u.id
      WHERE br.status IN ('active', 'overdue')
      ORDER BY br.due_date ASC
    `).all();

    const formatted = activeLoans.map(loan => {
      const fineInfo = calculateOverdueFine(loan.due_date);
      return {
        ...loan,
        days_overdue: fineInfo.days_overdue,
        fine_amount: fineInfo.fine_amount
      };
    });

    res.json(formatted);
  } catch (err) {
    console.error('Fetch active borrows error:', err);
    res.status(500).json({ error: 'Failed to fetch active loans.' });
  }
});

// GET /api/borrows/overdue - Overdue books list with fine details
router.get('/overdue', (req, res) => {
  try {
    updateOverdueStatuses();

    const overdueLoans = db.prepare(`
      SELECT br.id as borrow_id, br.issue_date, br.due_date, br.status, br.notes,
             b.id as book_id, b.title as book_title, b.author, b.isbn, b.rack_number, b.category,
             u.id as student_id, u.user_id as student_roll, u.name as student_name, u.department, u.phone, u.email
      FROM borrow_records br
      JOIN books b ON br.book_id = b.id
      JOIN users u ON br.user_id = u.id
      WHERE br.status = 'overdue' OR (br.return_date IS NULL AND br.due_date < date('now'))
      ORDER BY br.due_date ASC
    `).all();

    const formatted = overdueLoans.map(loan => {
      const fineInfo = calculateOverdueFine(loan.due_date);
      return {
        ...loan,
        days_overdue: fineInfo.days_overdue,
        fine_amount: fineInfo.fine_amount
      };
    });

    res.json(formatted);
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
