const express = require('express');
const router = express.Router();
const { db } = require('../db');

// GET /api/books - Search & filter books
router.get('/', (req, res) => {
  try {
    const { q, category, status, rack } = req.query;

    let query = `
      SELECT id, isbn, title, author, category, rack_number, floor, section,
             total_copies, available_copies, status
      FROM books
      WHERE 1=1
    `;
    const params = [];

    if (q && q.trim()) {
      query += ` AND (
        title LIKE ? OR
        author LIKE ? OR
        isbn LIKE ? OR
        category LIKE ? OR
        rack_number LIKE ?
      )`;
      const term = `%${q.trim()}%`;
      params.push(term, term, term, term, term);
    }

    if (category && category !== 'All') {
      query += ` AND category = ?`;
      params.push(category);
    }

    if (status && status !== 'All') {
      query += ` AND status = ?`;
      params.push(status);
    }

    if (rack && rack !== 'All') {
      query += ` AND rack_number LIKE ?`;
      params.push(`%${rack}%`);
    }

    query += ` ORDER BY title ASC`;

    const books = db.prepare(query).all(...params);
    res.json(books);
  } catch (err) {
    console.error('Fetch books error:', err);
    res.status(500).json({ error: 'Failed to retrieve books.' });
  }
});

// GET /api/books/categories - List categories
router.get('/categories', (req, res) => {
  try {
    const categories = db.prepare(`
      SELECT DISTINCT category FROM books ORDER BY category ASC
    `).all().map(r => r.category);

    res.json(categories);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch categories.' });
  }
});

// GET /api/books/racks - List all rack locations
router.get('/racks', (req, res) => {
  try {
    const racks = db.prepare(`
      SELECT DISTINCT rack_number, floor, section FROM books ORDER BY rack_number ASC
    `).all();

    res.json(racks);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch racks.' });
  }
});

// GET /api/books/:id - Get single book details + active borrow status
router.get('/:id', (req, res) => {
  try {
    const book = db.prepare(`
      SELECT * FROM books WHERE id = ?
    `).get(req.params.id);

    if (!book) {
      return res.status(404).json({ error: 'Book not found.' });
    }

    // Also get active borrowers for this book if any
    const activeLoans = db.prepare(`
      SELECT br.id as loan_id, br.issue_date, br.due_date, br.status,
             u.user_id as student_roll, u.name as student_name, u.department, u.phone
      FROM borrow_records br
      JOIN users u ON br.user_id = u.id
      WHERE br.book_id = ? AND br.status IN ('active', 'overdue')
      ORDER BY br.issue_date DESC
    `).all(req.params.id);

    res.json({
      ...book,
      activeLoans
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch book details.' });
  }
});

// POST /api/books - Add a new book (Librarian)
router.post('/', (req, res) => {
  try {
    const { isbn, title, author, category, rack_number, floor, section, total_copies } = req.body;

    if (!isbn || !title || !author || !category || !rack_number) {
      return res.status(400).json({ error: 'ISBN, Title, Author, Category, and Rack Number are required.' });
    }

    const copies = parseInt(total_copies) || 1;
    if (copies < 1) {
      return res.status(400).json({ error: 'Total copies must be at least 1.' });
    }

    // Check for duplicate ISBN
    const existing = db.prepare('SELECT id FROM books WHERE isbn = ?').get(isbn.trim());
    if (existing) {
      return res.status(400).json({ error: `Book with ISBN ${isbn} already exists.` });
    }

    const insert = db.prepare(`
      INSERT INTO books (isbn, title, author, category, rack_number, floor, section, total_copies, available_copies, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Available')
    `);

    const result = insert.run(
      isbn.trim(),
      title.trim(),
      author.trim(),
      category.trim(),
      rack_number.trim(),
      floor || 'Floor 1',
      section || 'General Bay',
      copies,
      copies
    );

    const newBook = db.prepare('SELECT * FROM books WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({
      message: 'Book added successfully!',
      book: newBook
    });
  } catch (err) {
    console.error('Add book error:', err);
    res.status(500).json({ error: 'Failed to add book.' });
  }
});

// PUT /api/books/:id - Edit book details
router.put('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { isbn, title, author, category, rack_number, floor, section, total_copies } = req.body;

    const currentBook = db.prepare('SELECT * FROM books WHERE id = ?').get(id);
    if (!currentBook) {
      return res.status(404).json({ error: 'Book not found.' });
    }

    // Check if ISBN is being changed and if it collides with another book
    if (isbn && isbn.trim() !== currentBook.isbn) {
      const duplicate = db.prepare('SELECT id FROM books WHERE isbn = ? AND id != ?').get(isbn.trim(), id);
      if (duplicate) {
        return res.status(400).json({ error: `ISBN ${isbn} is already in use by another book.` });
      }
    }

    const newTotal = parseInt(total_copies) || currentBook.total_copies;
    const issuedCount = currentBook.total_copies - currentBook.available_copies;

    if (newTotal < issuedCount) {
      return res.status(400).json({
        error: `Cannot reduce total copies below ${issuedCount} (currently issued copies).`
      });
    }

    const newAvailable = newTotal - issuedCount;
    const newStatus = newAvailable > 0 ? 'Available' : 'Issued';

    const update = db.prepare(`
      UPDATE books
      SET isbn = ?, title = ?, author = ?, category = ?, rack_number = ?,
          floor = ?, section = ?, total_copies = ?, available_copies = ?, status = ?
      WHERE id = ?
    `);

    update.run(
      (isbn || currentBook.isbn).trim(),
      (title || currentBook.title).trim(),
      (author || currentBook.author).trim(),
      (category || currentBook.category).trim(),
      (rack_number || currentBook.rack_number).trim(),
      floor || currentBook.floor,
      section || currentBook.section,
      newTotal,
      newAvailable,
      newStatus,
      id
    );

    const updated = db.prepare('SELECT * FROM books WHERE id = ?').get(id);
    res.json({
      message: 'Book updated successfully!',
      book: updated
    });
  } catch (err) {
    console.error('Update book error:', err);
    res.status(500).json({ error: 'Failed to update book.' });
  }
});

// DELETE /api/books/:id - Delete a book
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;

    const book = db.prepare('SELECT * FROM books WHERE id = ?').get(id);
    if (!book) {
      return res.status(404).json({ error: 'Book not found.' });
    }

    // Check if there are active loans
    const activeLoan = db.prepare(`
      SELECT COUNT(*) as count FROM borrow_records
      WHERE book_id = ? AND status IN ('active', 'overdue')
    `).get(id);

    if (activeLoan.count > 0) {
      return res.status(400).json({
        error: `Cannot delete "${book.title}". It has ${activeLoan.count} active borrowed copy/copies. Return them first.`
      });
    }

    db.prepare('DELETE FROM books WHERE id = ?').run(id);
    res.json({ message: `Book "${book.title}" deleted successfully.` });
  } catch (err) {
    console.error('Delete book error:', err);
    res.status(500).json({ error: 'Failed to delete book.' });
  }
});

module.exports = router;
