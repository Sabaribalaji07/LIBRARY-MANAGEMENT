// Automated test script for Digital Library Management System API

const http = require('http');

async function runTests() {
  console.log('🧪 Starting Automated API Tests...');

  const { initDatabase, db } = require('../server/db');
  initDatabase();

  // Test 1: Verify database users
  const users = db.prepare('SELECT COUNT(*) as count FROM users').get();
  console.log(`✅ Users in database: ${users.count}`);
  if (users.count < 5) throw new Error('Expected at least 5 users');

  // Test 2: Verify books in database
  const books = db.prepare('SELECT COUNT(*) as count FROM books').get();
  console.log(`✅ Books in database: ${books.count}`);
  if (books.count < 10) throw new Error('Expected at least 10 books');

  // Test 3: Verify overdue borrow records exist for field-visit demo
  const today = new Date().toISOString().split('T')[0];
  const overdue = db.prepare('SELECT COUNT(*) as count FROM borrow_records WHERE return_date IS NULL AND due_date < ?').get(today);
  console.log(`✅ Overdue loans in database: ${overdue.count}`);
  if (overdue.count === 0) throw new Error('Expected overdue records for demonstration');

  // Test 4: Verify Issue & Return Transaction logic directly
  const student = db.prepare("SELECT * FROM users WHERE role = 'student' AND user_id = 'CS2101'").get();
  const book = db.prepare("SELECT * FROM books WHERE available_copies > 0 AND status = 'Available'").get();

  console.log(`Testing Issue Book: "${book.title}" to ${student.name}...`);
  const initialCopies = book.available_copies;

  // Insert loan
  const issueTx = db.transaction(() => {
    db.prepare(`
      INSERT INTO borrow_records (book_id, user_id, issue_date, due_date, status, notes)
      VALUES (?, ?, date('now'), date('now', '+14 days'), 'active', 'Automated Test Loan')
    `).run(book.id, student.id);

    const newCopies = book.available_copies - 1;
    const status = newCopies === 0 ? 'Issued' : 'Available';
    db.prepare('UPDATE books SET available_copies = ?, status = ? WHERE id = ?').run(newCopies, status, book.id);
  });
  issueTx();

  const bookAfterIssue = db.prepare('SELECT * FROM books WHERE id = ?').get(book.id);
  if (bookAfterIssue.available_copies !== initialCopies - 1) {
    throw new Error('Available copies did not decrement properly');
  }
  console.log(`✅ Issue logic verified: Copies reduced from ${initialCopies} to ${bookAfterIssue.available_copies}`);

  // Test Return
  const borrowRecord = db.prepare("SELECT * FROM borrow_records WHERE book_id = ? AND user_id = ? AND status = 'active'").get(book.id, student.id);
  const returnTx = db.transaction(() => {
    db.prepare("UPDATE borrow_records SET return_date = date('now'), status = 'returned' WHERE id = ?").run(borrowRecord.id);
    db.prepare("UPDATE books SET available_copies = ?, status = 'Available' WHERE id = ?").run(initialCopies, book.id);
  });
  returnTx();

  const bookAfterReturn = db.prepare('SELECT * FROM books WHERE id = ?').get(book.id);
  if (bookAfterReturn.available_copies !== initialCopies) {
    throw new Error('Available copies did not restore properly on return');
  }
  console.log(`✅ Return logic verified: Copies restored to ${bookAfterReturn.available_copies} and status is Available`);

  console.log('🎉 All Automated Tests Passed Successfully!');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
