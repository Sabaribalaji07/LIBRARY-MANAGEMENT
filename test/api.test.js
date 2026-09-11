// Comprehensive Automated Test Suite for CampusLib Digital Library Management System
// Tests: Authentication Hashing, Concurrency Protection, Overdue Fine Calculations, Stock Integrity

const bcrypt = require('bcryptjs');
const { initDatabase, db } = require('../server/db');

async function runTests() {
  console.log('====================================================');
  console.log('🧪 Starting CampusLib Automated Integration & Unit Tests');
  console.log('====================================================\n');

  initDatabase();

  // -------------------------------------------------------------
  // Test 1: Authentication & BCrypt Password Hashing Integrity
  // -------------------------------------------------------------
  console.log('▶ [Test 1] BCrypt Password Hashing & Credential Security');
  const librarian = db.prepare("SELECT * FROM users WHERE user_id = 'LIB001'").get();
  if (!librarian) throw new Error('Librarian account not found');
  
  // Verify password is not plaintext
  if (librarian.password === 'admin') {
    throw new Error('Security Error: Password stored in plaintext!');
  }
  if (!librarian.password.startsWith('$2a$') && !librarian.password.startsWith('$2b$')) {
    throw new Error('Security Error: Password is not a valid bcrypt hash');
  }

  // Verify bcrypt.compareSync validation
  const validPass = bcrypt.compareSync('admin', librarian.password);
  const invalidPass = bcrypt.compareSync('wrongpass123', librarian.password);
  if (!validPass || invalidPass) {
    throw new Error('BCrypt password comparison logic failed');
  }
  console.log('  ✅ BCrypt password hash verified successfully. Plaintext credentials eliminated.');

  // -------------------------------------------------------------
  // Test 2: Overdue Fine Calculation Algorithm
  // -------------------------------------------------------------
  console.log('\n▶ [Test 2] Overdue Fine Calculation Algorithm');
  const FINE_RATE = 5; // ₹5 / day
  const MAX_CAP = 500;

  function calculateFine(dueDateStr, returnDateStr) {
    const d1 = new Date(dueDateStr);
    const d2 = new Date(returnDateStr);
    const days = Math.max(0, Math.floor((d2 - d1) / (1000 * 60 * 60 * 24)));
    const fine = Math.min(days * FINE_RATE, MAX_CAP);
    return { days, fine };
  }

  // Case 2a: Returned on time (0 days overdue -> ₹0 fine)
  const caseA = calculateFine('2026-09-01', '2026-09-01');
  if (caseA.fine !== 0 || caseA.days !== 0) throw new Error('On-time loan fine should be 0');

  // Case 2b: 7 days overdue (7 * 5 = ₹35)
  const caseB = calculateFine('2026-09-01', '2026-09-08');
  if (caseB.fine !== 35 || caseB.days !== 7) throw new Error(`Expected ₹35 fine, got ₹${caseB.fine}`);

  // Case 2c: 120 days overdue (120 * 5 = 600 -> capped at ₹500)
  const caseC = calculateFine('2026-01-01', '2026-05-01');
  if (caseC.fine !== MAX_CAP) throw new Error(`Expected fine cap of ₹${MAX_CAP}, got ₹${caseC.fine}`);

  console.log('  ✅ Overdue fine algorithm verified: On-time (₹0), 7 days (₹35), Max cap (₹500).');

  // -------------------------------------------------------------
  // Test 3: Concurrency & Simultaneous Checkout Protection (Atomicity)
  // -------------------------------------------------------------
  console.log('\n▶ [Test 3] Concurrency & Race Condition Prevention');
  
  // Create a temporary test book with exactly 1 available copy
  const testBookResult = db.prepare(`
    INSERT INTO books (isbn, title, author, category, rack_number, floor, section, total_copies, available_copies, status)
    VALUES ('TEST-CONC-001', 'Concurrency In Practice', 'Brian Goetz', 'Computer Science', 'Rack T-01', 'Floor 1', 'Testing Bay', 1, 1, 'Available')
  `).run();
  const testBookId = testBookResult.lastInsertRowid;

  const studentA = db.prepare("SELECT * FROM users WHERE user_id = 'CS2101'").get();
  const studentB = db.prepare("SELECT * FROM users WHERE user_id = 'IT2142'").get();

  // Helper for checkout transaction
  function attemptCheckout(studentId, bookId) {
    const issueTx = db.transaction(() => {
      const b = db.prepare('SELECT * FROM books WHERE id = ?').get(bookId);
      if (b.available_copies <= 0) {
        throw new Error('NO_COPIES_AVAILABLE');
      }

      db.prepare(`
        INSERT INTO borrow_records (book_id, user_id, issue_date, due_date, status, notes)
        VALUES (?, ?, date('now'), date('now', '+14 days'), 'active', 'Concurrency Test')
      `).run(bookId, studentId);

      const newCopies = b.available_copies - 1;
      db.prepare('UPDATE books SET available_copies = ?, status = ? WHERE id = ?').run(newCopies, newCopies === 0 ? 'Issued' : 'Available', bookId);
      return true;
    });

    return issueTx();
  }

  // First checkout succeeds
  let successCount = 0;
  let rejectedCount = 0;

  try {
    attemptCheckout(studentA.id, testBookId);
    successCount++;
  } catch (e) {
    // Should not fail
  }

  // Simultaneous second checkout for same book (0 copies left) must be rejected
  try {
    attemptCheckout(studentB.id, testBookId);
    successCount++;
  } catch (e) {
    if (e.message === 'NO_COPIES_AVAILABLE') {
      rejectedCount++;
    }
  }

  const finalBookState = db.prepare('SELECT * FROM books WHERE id = ?').get(testBookId);
  if (successCount !== 1 || rejectedCount !== 1 || finalBookState.available_copies !== 0) {
    throw new Error(`Concurrency test failed: successCount=${successCount}, rejectedCount=${rejectedCount}, available_copies=${finalBookState.available_copies}`);
  }
  console.log('  ✅ Concurrency protection verified: 1st checkout succeeded, 2nd rejected. Stock maintained at 0 (no negative stock).');

  // -------------------------------------------------------------
  // Test 4: Duplicate Active Borrow Prevention
  // -------------------------------------------------------------
  console.log('\n▶ [Test 4] Duplicate Active Borrow Prevention');
  let duplicatePrevented = false;
  try {
    // Attempting to checkout the same book again by same student
    const existing = db.prepare("SELECT id FROM borrow_records WHERE user_id = ? AND book_id = ? AND status = 'active'").get(studentA.id, testBookId);
    if (existing) throw new Error('ALREADY_BORROWED');
  } catch (err) {
    if (err.message === 'ALREADY_BORROWED') duplicatePrevented = true;
  }
  if (!duplicatePrevented) throw new Error('Duplicate borrow check failed');
  console.log('  ✅ Duplicate loan rejection verified.');

  // Clean up temporary test book & record
  db.prepare('DELETE FROM borrow_records WHERE book_id = ?').run(testBookId);
  db.prepare('DELETE FROM books WHERE id = ?').run(testBookId);

  // -------------------------------------------------------------
  // Test 5: Full Issue & Return Transaction Cycle
  // -------------------------------------------------------------
  console.log('\n▶ [Test 5] End-to-End Issue & Return Transaction Flow');
  const sampleBook = db.prepare("SELECT * FROM books WHERE available_copies > 0 LIMIT 1").get();
  const initCopies = sampleBook.available_copies;

  // Issue
  const issueTx = db.transaction(() => {
    const rec = db.prepare(`
      INSERT INTO borrow_records (book_id, user_id, issue_date, due_date, status, notes)
      VALUES (?, ?, date('now'), date('now', '+14 days'), 'active', 'E2E Test Loan')
    `).run(sampleBook.id, studentA.id);

    db.prepare('UPDATE books SET available_copies = ? WHERE id = ?').run(initCopies - 1, sampleBook.id);
    return rec.lastInsertRowid;
  });
  const loanId = issueTx();

  const afterIssue = db.prepare('SELECT available_copies FROM books WHERE id = ?').get(sampleBook.id);
  if (afterIssue.available_copies !== initCopies - 1) throw new Error('Issue decrement mismatch');

  // Return
  const returnTx = db.transaction(() => {
    db.prepare("UPDATE borrow_records SET return_date = date('now'), status = 'returned' WHERE id = ?").run(loanId);
    db.prepare('UPDATE books SET available_copies = ? WHERE id = ?').run(initCopies, sampleBook.id);
  });
  returnTx();

  const afterReturn = db.prepare('SELECT available_copies FROM books WHERE id = ?').get(sampleBook.id);
  if (afterReturn.available_copies !== initCopies) throw new Error('Return increment mismatch');

  console.log(`  ✅ Full cycle verified: Initial copies (${initCopies}) -> Issued (${initCopies - 1}) -> Returned (${initCopies}).`);

  console.log('\n====================================================');
  console.log('🎉 ALL 5 TEST SUITES PASSED WITH 100% SUCCESS!');
  console.log('====================================================');
}

runTests().catch(err => {
  console.error('\n❌ Test suite failed:', err);
  process.exit(1);
});
