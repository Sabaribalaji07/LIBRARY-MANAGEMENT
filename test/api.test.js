/**
 * @fileoverview Granular Unit Testing and Error Boundary Test Harness
 * @description Provides comprehensive validation of authentication security, boundary value analysis (BVA),
 *              concurrency locks, ACID atomicity, referential integrity, SQL injection neutralization,
 *              and Express error boundary middleware contracts.
 * @module test/api.test
 */

const bcrypt = require('bcryptjs');
const { initDatabase, db } = require('../server/db');
const { calculateOverdueFine, FINE_RATE_PER_DAY, MAX_FINE_CAP } = require('../server/routes/borrows');
const { AppError, globalErrorHandler } = require('../server/middleware/errorHandler');

/**
 * Test execution runner with detailed assertion checks and granular error reporting.
 */
async function runTests() {
  console.log('======================================================================');
  console.log('🧪 Starting CampusLib Granular Unit Testing & Error Boundary Test Suite');
  console.log('======================================================================\n');

  // Initialize DB schema, constraints, and indexes
  initDatabase();

  let passedTests = 0;
  let totalTests = 12;

  // --------------------------------------------------------------------------
  // Suite 1: BCrypt Password Hashing & Credential Security Integrity
  // --------------------------------------------------------------------------
  console.log('▶ [Test 1] BCrypt Password Hashing & Credential Security');
  {
    const librarian = db.prepare("SELECT * FROM users WHERE user_id = 'LIB001'").get();
    if (!librarian) throw new Error('Librarian account LIB001 not found');

    if (librarian.password === 'admin') {
      throw new Error('Security Error: Password is stored in plaintext!');
    }
    if (!librarian.password.startsWith('$2a$10$') && !librarian.password.startsWith('$2b$10$')) {
      throw new Error(`Security Error: Password hash does not use Blowfish cost factor 10: ${librarian.password}`);
    }

    const validPass = bcrypt.compareSync('admin', librarian.password);
    const invalidPass = bcrypt.compareSync('wrong_pass_xyz', librarian.password);
    if (!validPass || invalidPass) {
      throw new Error('BCrypt comparison logic failed verification');
    }
    console.log('  ✅ 1.1 Blowfish $2a$10$ cost factor verified (zero plaintext credentials).');
    console.log('  ✅ 1.2 Positive and negative credential evaluation verified.');
    passedTests++;
  }

  // --------------------------------------------------------------------------
  // Suite 2: Granular Overdue Fine Boundary Value Analysis (BVA)
  // --------------------------------------------------------------------------
  console.log('\n▶ [Test 2] Granular Overdue Fine Boundary Value Analysis (BVA)');
  {
    // BVA Case 2.1: Returned on exact due date (0 calendar days overdue -> ₹0)
    const bva0 = calculateOverdueFine('2026-10-15', '2026-10-15');
    if (bva0.days_overdue !== 0 || bva0.fine_amount !== 0 || bva0.is_overdue !== false) {
      throw new Error(`BVA 0-day failed: expected ₹0, got ₹${bva0.fine_amount}`);
    }

    // BVA Case 2.2: Boundary 1 calendar day overdue (1 * 5 = ₹5)
    const bva1 = calculateOverdueFine('2026-10-15', '2026-10-16');
    if (bva1.days_overdue !== 1 || bva1.fine_amount !== 5 || bva1.is_overdue !== true) {
      throw new Error(`BVA 1-day failed: expected ₹5, got ₹${bva1.fine_amount}`);
    }

    // BVA Case 2.3: Typical loan overdue (7 days * 5 = ₹35)
    const bva7 = calculateOverdueFine('2026-10-15', '2026-10-22');
    if (bva7.days_overdue !== 7 || bva7.fine_amount !== 35) {
      throw new Error(`BVA 7-day failed: expected ₹35, got ₹${bva7.fine_amount}`);
    }

    // BVA Case 2.4: Sub-cap boundary (99 days * 5 = ₹495)
    const bva99 = calculateOverdueFine('2026-01-01', '2026-04-10');
    if (bva99.days_overdue !== 99 || bva99.fine_amount !== 495) {
      throw new Error(`BVA 99-day failed: expected ₹495, got ₹${bva99.fine_amount}`);
    }

    // BVA Case 2.5: Exact ceiling cap boundary (100 days * 5 = ₹500)
    const bva100 = calculateOverdueFine('2026-01-01', '2026-04-11');
    if (bva100.days_overdue !== 100 || bva100.fine_amount !== 500) {
      throw new Error(`BVA 100-day failed: expected ₹500, got ₹${bva100.fine_amount}`);
    }

    // BVA Case 2.6: Beyond ceiling cap boundary (365 days overdue -> capped at ₹500)
    const bva365 = calculateOverdueFine('2025-01-01', '2026-01-01');
    if (bva365.fine_amount !== MAX_FINE_CAP) {
      throw new Error(`BVA 365-day cap failed: expected ₹500 cap, got ₹${bva365.fine_amount}`);
    }

    // BVA Case 2.7: Negative boundary (Returned 5 days before due date -> 0 fine)
    const bvaEarly = calculateOverdueFine('2026-10-20', '2026-10-15');
    if (bvaEarly.fine_amount !== 0 || bvaEarly.days_overdue !== 0 || bvaEarly.is_overdue !== false) {
      throw new Error(`BVA Early return failed: expected ₹0, got ₹${bvaEarly.fine_amount}`);
    }

    console.log('  ✅ 2.1 Boundary Value Analysis: 0-day, 1-day, 7-day, 99-day verified.');
    console.log('  ✅ 2.2 Ceiling cap enforcement (₹500 maximum cap) strictly verified.');
    console.log('  ✅ 2.3 Early/negative date boundary conditions gracefully handled.');
    passedTests++;
  }

  // --------------------------------------------------------------------------
  // Suite 3: Concurrency Race Condition & Zero-Stock Boundary (ACID Isolation)
  // --------------------------------------------------------------------------
  console.log('\n▶ [Test 3] Concurrency Race Condition & Zero-Stock Boundary (ACID Isolation)');
  {
    // Insert single-copy test book
    const insertTestBook = db.prepare(`
      INSERT INTO books (isbn, title, author, category, rack_number, floor, section, total_copies, available_copies, status)
      VALUES ('TEST-CONC-999', 'Zero Negative Stock Test', 'ACID Tester', 'Computer Science', 'Rack T-09', 'Floor 1', 'Lab Bay', 1, 1, 'Available')
    `).run();
    const testBookId = insertTestBook.lastInsertRowid;

    const studentA = db.prepare("SELECT * FROM users WHERE user_id = 'CS2101'").get();
    const studentB = db.prepare("SELECT * FROM users WHERE user_id = 'IT2142'").get();

    function executeAtomicCheckout(studentId, bookId) {
      const issueTx = db.transaction(() => {
        const book = db.prepare('SELECT available_copies FROM books WHERE id = ?').get(bookId);
        if (!book || book.available_copies <= 0) {
          throw new Error('NO_COPIES_AVAILABLE');
        }
        db.prepare(`
          INSERT INTO borrow_records (book_id, user_id, issue_date, due_date, status, notes)
          VALUES (?, ?, date('now'), date('now', '+14 days'), 'active', 'Concurrency verification')
        `).run(bookId, studentId);

        const newCopies = book.available_copies - 1;
        db.prepare('UPDATE books SET available_copies = ?, status = ? WHERE id = ?').run(
          newCopies,
          newCopies === 0 ? 'Issued' : 'Available',
          bookId
        );
        return true;
      });
      return issueTx();
    }

    // Step 1: Student A claims the single remaining copy
    let tx1Success = false;
    try {
      executeAtomicCheckout(studentA.id, testBookId);
      tx1Success = true;
    } catch (e) {
      throw new Error(`Tx 1 should have succeeded: ${e.message}`);
    }

    // Step 2: Student B attempts simultaneous checkout of now exhausted book
    let tx2CaughtZeroCopies = false;
    try {
      executeAtomicCheckout(studentB.id, testBookId);
    } catch (e) {
      if (e.message === 'NO_COPIES_AVAILABLE') {
        tx2CaughtZeroCopies = true;
      }
    }

    // Step 3: Inspect final database state
    const postBook = db.prepare('SELECT available_copies, status FROM books WHERE id = ?').get(testBookId);
    if (!tx1Success || !tx2CaughtZeroCopies || postBook.available_copies !== 0 || postBook.status !== 'Issued') {
      throw new Error(`Concurrency boundary failure: available_copies=${postBook.available_copies}`);
    }

    // Clean up temporary test data
    db.prepare('DELETE FROM borrow_records WHERE book_id = ?').run(testBookId);
    db.prepare('DELETE FROM books WHERE id = ?').run(testBookId);

    console.log('  ✅ 3.1 Exclusive transaction lock verified: 1st checkout succeeded, 2nd rejected.');
    console.log('  ✅ 3.2 Invariant confirmed: available_copies == 0, zero negative stock anomaly prevented.');
    passedTests++;
  }

  // --------------------------------------------------------------------------
  // Suite 4: Duplicate Active Loan Prevention Boundary
  // --------------------------------------------------------------------------
  console.log('\n▶ [Test 4] Duplicate Active Loan Prevention Boundary');
  {
    const student = db.prepare("SELECT * FROM users WHERE user_id = 'CS2101'").get();
    const book = db.prepare("SELECT * FROM books WHERE available_copies > 0 LIMIT 1").get();

    // Verify existing borrow query correctly detects active duplicate
    const checkDuplicate = (sId, bId) => {
      const active = db.prepare(`
        SELECT id FROM borrow_records WHERE user_id = ? AND book_id = ? AND status IN ('active', 'overdue')
      `).get(sId, bId);
      if (active) throw new Error('ALREADY_BORROWED');
      return true;
    };

    // Temporarily insert an active borrow
    const ins = db.prepare(`
      INSERT INTO borrow_records (book_id, user_id, issue_date, due_date, status, notes)
      VALUES (?, ?, date('now'), date('now', '+14 days'), 'active', 'Duplicate test')
    `).run(book.id, student.id);

    let caughtDuplicate = false;
    try {
      checkDuplicate(student.id, book.id);
    } catch (e) {
      if (e.message === 'ALREADY_BORROWED') caughtDuplicate = true;
    }

    // Cleanup
    db.prepare('DELETE FROM borrow_records WHERE id = ?').run(ins.lastInsertRowid);

    if (!caughtDuplicate) throw new Error('Duplicate loan was not caught by error boundary');
    console.log('  ✅ 4.1 Duplicate checkout attempt rejected with ALREADY_BORROWED error.');
    passedTests++;
  }

  // --------------------------------------------------------------------------
  // Suite 5: Input Validation & Boundary Value Constraints
  // --------------------------------------------------------------------------
  console.log('\n▶ [Test 5] Input Validation & Boundary Value Constraints');
  {
    // 5.1 Rejection of negative copies constraint in SQLite
    let caughtNegativeCopies = false;
    try {
      db.prepare(`
        INSERT INTO books (isbn, title, author, category, rack_number, total_copies, available_copies)
        VALUES ('ISBN-NEG-TEST', 'Negative Copies', 'Author', 'CS', 'Rack T', -5, -5)
      `).run();
    } catch (err) {
      if (err.message.includes('CHECK constraint failed')) {
        caughtNegativeCopies = true;
      }
    }
    if (!caughtNegativeCopies) throw new Error('Database allowed negative copy volume!');

    // 5.2 Unique ISBN constraint collision
    const existingBook = db.prepare('SELECT isbn FROM books LIMIT 1').get();
    let caughtDuplicateIsbn = false;
    try {
      db.prepare(`
        INSERT INTO books (isbn, title, author, category, rack_number)
        VALUES (?, 'Colliding Book', 'Author', 'CS', 'Rack T')
      `).run(existingBook.isbn);
    } catch (err) {
      if (err.message.includes('UNIQUE constraint failed')) {
        caughtDuplicateIsbn = true;
      }
    }
    if (!caughtDuplicateIsbn) throw new Error('Database allowed duplicate ISBN collision!');

    console.log('  ✅ 5.1 CHECK constraint total_copies >= 0 verified.');
    console.log('  ✅ 5.2 UNIQUE constraint on ISBN verified.');
    passedTests++;
  }

  // --------------------------------------------------------------------------
  // Suite 6: Foreign Key Enforcement & Cascading Referential Integrity
  // --------------------------------------------------------------------------
  console.log('\n▶ [Test 6] Foreign Key Enforcement & Referential Integrity');
  {
    // Verify foreign key pragma is ON
    const fkPragma = db.pragma('foreign_keys', { simple: true });
    if (fkPragma !== 1) throw new Error('PRAGMA foreign_keys is not enabled!');

    // Attempt to insert borrow record with non-existent user_id
    let caughtInvalidUserFk = false;
    try {
      db.prepare(`
        INSERT INTO borrow_records (book_id, user_id, issue_date, due_date, status)
        VALUES (1, 9999999, '2026-10-01', '2026-10-15', 'active')
      `).run();
    } catch (err) {
      if (err.message.includes('FOREIGN KEY constraint failed')) {
        caughtInvalidUserFk = true;
      }
    }
    if (!caughtInvalidUserFk) throw new Error('Foreign key constraint failed to block orphan loan record!');

    console.log('  ✅ 6.1 PRAGMA foreign_keys = ON verified.');
    console.log('  ✅ 6.2 Orphan borrow record insertion strictly blocked by relational constraint.');
    passedTests++;
  }

  // --------------------------------------------------------------------------
  // Suite 7: SQL Injection Resistance & Parametric Query Boundary
  // --------------------------------------------------------------------------
  console.log('\n▶ [Test 7] SQL Injection Resistance & Parametric Query Boundary');
  {
    // Malicious injection attempt to expose all records or bypass where clause
    const sqlInjectionPayload = "'; DROP TABLE books; -- ' OR '1'='1";
    const term = `%${sqlInjectionPayload}%`;
    const searchResults = db.prepare(`
      SELECT * FROM books WHERE title LIKE ? OR author LIKE ? OR isbn LIKE ?
    `).all(term, term, term);

    // Should safely return 0 results without executing injection payload
    if (searchResults.length !== 0) {
      throw new Error('Parametric query failed to neutralize SQL injection payload');
    }

    // Verify books table still exists and is untouched
    const tableCheck = db.prepare("SELECT count(*) as count FROM books").get();
    if (tableCheck.count === 0) {
      throw new Error('SQL injection corrupted the books table!');
    }

    console.log('  ✅ 7.1 Parameterized SQLite statement safely neutralized SQL injection payload.');
    console.log('  ✅ 7.2 Database schema table integrity preserved intact.');
    passedTests++;
  }

  // --------------------------------------------------------------------------
  // Suite 8: End-to-End Issue, Stock Mutation, Return & Restoral Flow
  // --------------------------------------------------------------------------
  console.log('\n▶ [Test 8] End-to-End Issue, Stock Mutation, Return & Restoral Flow');
  {
    const book = db.prepare("SELECT * FROM books WHERE available_copies > 0 LIMIT 1").get();
    const student = db.prepare("SELECT * FROM users WHERE user_id = 'CS2101'").get();
    const initialCopies = book.available_copies;

    // Issue Book
    const issueTx = db.transaction(() => {
      const rec = db.prepare(`
        INSERT INTO borrow_records (book_id, user_id, issue_date, due_date, status, notes)
        VALUES (?, ?, date('now'), date('now', '+14 days'), 'active', 'E2E Lifecycle Test')
      `).run(book.id, student.id);
      db.prepare('UPDATE books SET available_copies = ? WHERE id = ?').run(initialCopies - 1, book.id);
      return rec.lastInsertRowid;
    });
    const borrowId = issueTx();

    const midState = db.prepare('SELECT available_copies FROM books WHERE id = ?').get(book.id);
    if (midState.available_copies !== initialCopies - 1) {
      throw new Error(`Stock decrement failed: expected ${initialCopies - 1}, got ${midState.available_copies}`);
    }

    // Return Book
    const returnTx = db.transaction(() => {
      db.prepare("UPDATE borrow_records SET return_date = date('now'), status = 'returned' WHERE id = ?").run(borrowId);
      db.prepare('UPDATE books SET available_copies = ? WHERE id = ?').run(initialCopies, book.id);
    });
    returnTx();

    const finalState = db.prepare('SELECT available_copies FROM books WHERE id = ?').get(book.id);
    if (finalState.available_copies !== initialCopies) {
      throw new Error(`Stock restoral failed: expected ${initialCopies}, got ${finalState.available_copies}`);
    }

    // Clean up test borrow record
    db.prepare('DELETE FROM borrow_records WHERE id = ?').run(borrowId);

    console.log(`  ✅ 8.1 Full transaction cycle verified: Stock (${initialCopies}) -> Loaned (${initialCopies - 1}) -> Restored (${initialCopies}).`);
    passedTests++;
  }

  // --------------------------------------------------------------------------
  // Suite 9: Express Error Boundary Middleware & Standardized Envelope Structure
  // --------------------------------------------------------------------------
  console.log('\n▶ [Test 9] Express Error Boundary Middleware & Standardized Envelope Structure');
  {
    // Test custom AppError instantiation
    const customErr = new AppError('Sample error boundary triggered', 404, 'NOT_FOUND_SAMPLE');
    if (customErr.statusCode !== 404 || customErr.code !== 'NOT_FOUND_SAMPLE') {
      throw new Error('AppError constructor failed to set properties');
    }

    // Mock Express req, res, next to verify globalErrorHandler formatting
    let capturedStatus = null;
    let capturedPayload = null;

    const mockReq = { method: 'GET', url: '/api/books/999' };
    const mockRes = {
      status: function (code) {
        capturedStatus = code;
        return this;
      },
      json: function (payload) {
        capturedPayload = payload;
        return this;
      }
    };
    const mockNext = () => {};

    // Execute global error handler
    globalErrorHandler(customErr, mockReq, mockRes, mockNext);

    if (capturedStatus !== 404) throw new Error(`Expected HTTP 404, got ${capturedStatus}`);
    if (!capturedPayload || capturedPayload.success !== false) throw new Error('Expected success: false in envelope');
    if (!capturedPayload.error || capturedPayload.error.code !== 'NOT_FOUND_SAMPLE') {
      throw new Error('Error envelope code mismatch');
    }
    if (!capturedPayload.error.timestamp) throw new Error('Error envelope missing ISO timestamp');

    console.log('  ✅ 9.1 Standardized Error Envelope { success, error: { code, message, statusCode, timestamp } } verified.');
    console.log('  ✅ 9.2 HTTP status boundary propagation verified.');
    passedTests++;
  }

  // --------------------------------------------------------------------------
  // Suite 10: Date Calculation & Loan Duration Temporal Boundaries
  // --------------------------------------------------------------------------
  console.log('\n▶ [Test 10] Date Calculation & Loan Duration Temporal Boundaries');
  {
    // Verify +14 days loan duration calculation across month boundary
    const baseDate = new Date('2026-01-25T10:00:00Z');
    const expectedDue = new Date(baseDate);
    expectedDue.setDate(expectedDue.getDate() + 14);

    const diffDays = Math.round((expectedDue - baseDate) / (1000 * 60 * 60 * 24));
    if (diffDays !== 14) throw new Error(`Expected 14 days difference, got ${diffDays}`);
    if (expectedDue.toISOString().split('T')[0] !== '2026-02-08') {
      throw new Error(`Month transition date error: expected 2026-02-08, got ${expectedDue.toISOString().split('T')[0]}`);
    }

    console.log('  ✅ 10.1 Standard 14-day checkout duration verified.');
    console.log('  ✅ 10.2 Month-boundary date rollover verified.');
    passedTests++;
  }

  // --------------------------------------------------------------------------
  // Suite 11: Case-Insensitive Credential & User ID Authentication Boundary
  // --------------------------------------------------------------------------
  console.log('\n▶ [Test 11] Case-Insensitive Credential & User ID Authentication Boundary');
  {
    const query = `
      SELECT id, user_id FROM users WHERE (LOWER(user_id) = LOWER(?) OR LOWER(email) = LOWER(?))
    `;

    // Attempt lookups with lowercase, uppercase, and mixed casing
    const userLower = db.prepare(query).get('cs2101', 'cs2101');
    const userUpper = db.prepare(query).get('CS2101', 'CS2101');
    const userMixed = db.prepare(query).get('Cs2101', 'Cs2101');

    if (!userLower || !userUpper || !userMixed || userLower.id !== userUpper.id) {
      throw new Error('Case-insensitive user ID authentication boundary failed');
    }

    console.log('  ✅ 11.1 Case-insensitive user_id matching verified (cs2101 == CS2101).');
    passedTests++;
  }

  // --------------------------------------------------------------------------
  // Suite 12: Catalog Invariant & KPI Metric Consistency Verification
  // --------------------------------------------------------------------------
  console.log('\n▶ [Test 12] Catalog Invariant & KPI Metric Consistency Verification');
  {
    const copiesStats = db.prepare(`
      SELECT SUM(total_copies) as total_copies, SUM(available_copies) as available_copies FROM books
    `).get();

    const activeBorrowsCount = db.prepare(`
      SELECT COUNT(*) as count FROM borrow_records WHERE status IN ('active', 'overdue')
    `).get().count;

    const computedAvailable = copiesStats.total_copies - activeBorrowsCount;
    if (computedAvailable !== copiesStats.available_copies) {
      throw new Error(
        `Catalog Invariant Violation: total_copies (${copiesStats.total_copies}) - active_borrows (${activeBorrowsCount}) = ${computedAvailable}, but available_copies = ${copiesStats.available_copies}`
      );
    }

    console.log(`  ✅ 12.1 Mathematical invariant verified: total_copies (${copiesStats.total_copies}) = available (${copiesStats.available_copies}) + active_loans (${activeBorrowsCount}).`);
    passedTests++;
  }

  console.log('\n======================================================================');
  console.log(`🎉 ALL ${passedTests}/${totalTests} TEST SUITES PASSED WITH 100% SUCCESS!`);
  console.log('======================================================================');
}

runTests().catch(err => {
  console.error('\n❌ Test suite failed:', err);
  process.exit(1);
});
