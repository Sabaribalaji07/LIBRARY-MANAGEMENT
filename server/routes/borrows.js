/**
 * @fileoverview Book Circulation, Checkout, Return, and Overdue Fine API Routes
 * @description Implements atomic ACID checkout transactions to prevent concurrency race
 *              conditions, handles 1-click book returns with automated overdue fine calculation,
 *              and provides active circulation audit feeds.
 * @module server/routes/borrows
 */

const express = require('express');
const router = express.Router();
const { db } = require('../db');

/**
 * Institutional Fine Policy Parameters
 * @constant {number} FINE_RATE_PER_DAY - Standard overdue fine rate per calendar day (₹5)
 * @constant {number} FINE_GRACE_DAYS - Permissible grace period before fine accrual begins (0 days)
 * @constant {number} MAX_FINE_CAP - Ceiling limit on fine accumulation per borrow instance (₹500)
 */
const FINE_RATE_PER_DAY = 5;
const FINE_GRACE_DAYS = 0;
const MAX_FINE_CAP = 500;

/**
 * Calculates overdue calendar days and accrued fine amount based on due date and return/current date.
 * 
 * Mathematical Formulation:
 *   Days Overdue = max(0, floor((Target Date - Due Date) / 86400000 ms))
 *   Billable Days = max(0, Days Overdue - Grace Days)
 *   Fine Amount = min(Billable Days * Daily Rate, Max Cap)
 * 
 * @param {string} dueDateStr - ISO date string (YYYY-MM-DD)
 * @param {string|null} [returnDateStr=null] - ISO date string (YYYY-MM-DD) or null for active loans
 * @returns {{ days_overdue: number, billable_days: number, fine_rate: number, fine_amount: number, is_overdue: boolean }}
 */
function calculateOverdueFine(dueDateStr, returnDateStr = null) {
  if (!dueDateStr) {
    return { days_overdue: 0, billable_days: 0, fine_rate: FINE_RATE_PER_DAY, fine_amount: 0, is_overdue: false };
  }
  
  const targetDate = returnDateStr ? new Date(returnDateStr + 'T00:00:00') : new Date();
  const dueDate = new Date(dueDateStr + 'T00:00:00');
  
  // Calculate difference in whole calendar days (86,400,000 ms per standard day)
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

/**
 * Synchronizes overdue statuses for all unreturned records whose due date has lapsed.
 */
function updateOverdueStatuses() {
  const today = new Date().toISOString().split('T')[0];
  db.prepare(`
    UPDATE borrow_records
    SET status = 'overdue'
    WHERE return_date IS NULL AND due_date < ? AND status = 'active'
  `).run(today);
}

/**
 * POST /api/borrows/issue
 * @summary Atomic Concurrency-Safe Book Checkout
 * @description Executes an ACID transaction checking stock availability under exclusive lock,
 *              verifying student eligibility, preventing duplicate active loans, and decrementing
 *              available copies to ensure zero negative stock anomalies.
 * 
 * @route POST /api/borrows/issue
 * @param {number} req.body.student_id - Internal database ID of student user
 * @param {number} req.body.book_id - Internal database ID of book catalog item
 * @param {number} [req.body.due_days=14] - Loan duration in days (default 14 days)
 * @param {string} [req.body.custom_due_date] - Optional explicit due date override (YYYY-MM-DD)
 * @param {string} [req.body.notes] - Loan annotations / audit note
 * 
 * @returns {201} Issue confirmation with borrow_id and due_date
 * @returns {400} If missing parameters, no stock available, or student already holds active copy
 * @returns {404} If student or book is not found
 */
router.post('/issue', (req, res, next) => {
  try {
    const { student_id, book_id, due_days = 14, custom_due_date, notes } = req.body;

    // Error Boundary: Mandatory parameter validation
    if (!student_id || !book_id) {
      return res.status(400).json({
        success: false,
        error: 'Student and Book are required.'
      });
    }

    // Determine issue date and target due date
    const today = new Date();
    const issue_date = today.toISOString().split('T')[0];

    let due_date;
    if (custom_due_date) {
      due_date = custom_due_date;
    } else {
      const due = new Date();
      due.setDate(due.getDate() + parseInt(due_days, 10));
      due_date = due.toISOString().split('T')[0];
    }

    // ACID Transaction Boundary: Isolates stock check & mutation from concurrent requests
    const issueTx = db.transaction(() => {
      // 1. Verify student eligibility under transaction lock
      const student = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'student'").get(student_id);
      if (!student) {
        throw new Error('STUDENT_NOT_FOUND');
      }

      // 2. Lock & inspect book inventory availability
      const book = db.prepare('SELECT * FROM books WHERE id = ?').get(book_id);
      if (!book) {
        throw new Error('BOOK_NOT_FOUND');
      }

      // Concurrency Boundary: Reject checkout if stock is exhausted
      if (book.available_copies <= 0) {
        throw new Error('NO_COPIES_AVAILABLE');
      }

      // 3. Duplicate Active Loan Boundary: Reject multiple checkouts of same title by same student
      const existingBorrow = db.prepare(`
        SELECT id FROM borrow_records
        WHERE user_id = ? AND book_id = ? AND status IN ('active', 'overdue')
      `).get(student_id, book_id);

      if (existingBorrow) {
        throw new Error('ALREADY_BORROWED');
      }

      // 4. Create transactional loan record
      const result = db.prepare(`
        INSERT INTO borrow_records (book_id, user_id, issue_date, due_date, status, notes)
        VALUES (?, ?, ?, ?, 'active', ?)
      `).run(book_id, student_id, issue_date, due_date, notes || 'Regular loan');

      // 5. Atomic decrement of inventory stock
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
        success: true,
        message: `"${outcome.bookTitle}" successfully issued to ${outcome.studentName} (${outcome.studentCode}).`,
        borrow_id: outcome.borrowId,
        due_date: due_date
      });
    } catch (txErr) {
      if (txErr.message === 'STUDENT_NOT_FOUND') {
        return res.status(404).json({ success: false, error: 'Student not found or invalid role.' });
      }
      if (txErr.message === 'BOOK_NOT_FOUND') {
        return res.status(404).json({ success: false, error: 'Book not found.' });
      }
      if (txErr.message === 'NO_COPIES_AVAILABLE') {
        return res.status(400).json({ success: false, error: 'No available copies left. All copies are currently issued.' });
      }
      if (txErr.message === 'ALREADY_BORROWED') {
        return res.status(400).json({ success: false, error: 'Student already has an active borrowed copy of this book.' });
      }
      throw txErr;
    }
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/borrows/return
 * @summary 1-Click Book Return & Automated Overdue Fine Settlement
 * @description Concurrency-safe return transaction that marks record returned, calculates
 *              due-date difference and fine amount, logs audit notes, and increments available copies.
 * 
 * @route POST /api/borrows/return
 * @param {number} req.body.borrow_id - Primary key of the borrow record
 * @param {string} [req.body.return_notes] - Optional condition or fine receipt notes
 * 
 * @returns {200} Return confirmation with fine calculation breakdown
 * @returns {400} If missing borrow_id or if book has already been returned
 * @returns {404} If borrow record does not exist
 */
router.post('/return', (req, res, next) => {
  try {
    const { borrow_id, return_notes } = req.body;

    if (!borrow_id) {
      return res.status(400).json({ success: false, error: 'Borrow Record ID is required.' });
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

      // Compute fine based on formal institutional algorithm
      const fineDetails = calculateOverdueFine(record.due_date, returnDate);

      // 1. Mark borrow record as returned with fine audit notes
      db.prepare(`
        UPDATE borrow_records
        SET return_date = ?, status = 'returned', notes = COALESCE(notes || ' | ' || ?, notes)
        WHERE id = ?
      `).run(returnDate, return_notes || `Returned (Fine: ₹${fineDetails.fine_amount})`, borrow_id);

      // 2. Increment stock count (bounded by total_copies)
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
        success: true,
        message: `"${outcome.bookTitle}" returned successfully by ${outcome.studentName}. Stock restored to Available.`,
        return_date: returnDate,
        fine_amount: outcome.fineDetails.fine_amount,
        days_overdue: outcome.fineDetails.days_overdue
      });
    } catch (txErr) {
      if (txErr.message === 'RECORD_NOT_FOUND') {
        return res.status(404).json({ success: false, error: 'Borrow record not found.' });
      }
      if (txErr.message === 'ALREADY_RETURNED') {
        return res.status(400).json({ success: false, error: 'This book has already been returned.' });
      }
      throw txErr;
    }
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/borrows/active
 * @summary Retrieves all currently active and overdue book loans
 * @route GET /api/borrows/active
 * @returns {200} Array of active loan records with real-time fine calculation
 */
router.get('/active', (req, res, next) => {
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
    next(err);
  }
});

/**
 * GET /api/borrows/overdue
 * @summary Retrieves loans exceeding due date with detailed fine breakdown
 * @route GET /api/borrows/overdue
 * @returns {200} Array of overdue borrow items with calculated fine metrics
 */
router.get('/overdue', (req, res, next) => {
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
    next(err);
  }
});

/**
 * GET /api/borrows/history
 * @summary Audit log of all completed and active borrow transactions
 * @route GET /api/borrows/history
 * @param {string} [req.query.student_id] - Filter by specific student user ID
 * @param {string} [req.query.status] - Filter by status ('active', 'returned', 'overdue', 'All')
 * @returns {200} Array of historical borrow records
 */
router.get('/history', (req, res, next) => {
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
    next(err);
  }
});

/**
 * GET /api/borrows/my-books/:userId
 * @summary Retrieves a student's personal active loans and completed borrow history
 * @route GET /api/borrows/my-books/:userId
 * @param {number} req.params.userId - Student user ID
 * @returns {200} Object with active and history arrays
 */
router.get('/my-books/:userId', (req, res, next) => {
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
    next(err);
  }
});

module.exports = router;
module.exports.calculateOverdueFine = calculateOverdueFine;
module.exports.FINE_RATE_PER_DAY = FINE_RATE_PER_DAY;
module.exports.FINE_GRACE_DAYS = FINE_GRACE_DAYS;
module.exports.MAX_FINE_CAP = MAX_FINE_CAP;
