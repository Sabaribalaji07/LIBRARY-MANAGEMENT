/**
 * @fileoverview Book Inventory and Catalog Management API Routes
 * @description Provides full CRUD capabilities for library volumes, multi-attribute
 *              live catalog filtering, shelf rack lookups, and active circulation audit.
 * @module server/routes/books
 */

const express = require('express');
const router = express.Router();
const { db } = require('../db');

/**
 * GET /api/books
 * @summary Search, filter, and paginate catalog books
 * @description Supports multi-parameter substring searching across title, author,
 *              ISBN, category, and rack number with availability filtering.
 * 
 * @route GET /api/books
 * @param {string} [req.query.q] - Search keyword matching title, author, isbn, rack
 * @param {string} [req.query.category] - Filter by specific category or 'All'
 * @param {string} [req.query.status] - Filter by 'Available', 'Issued', or 'All'
 * @param {string} [req.query.rack] - Filter by physical rack identifier
 * 
 * @returns {200} Array of book objects
 * @returns {500} Error envelope
 */
router.get('/', (req, res, next) => {
  try {
    const { q, category, status, rack } = req.query;

    let query = `
      SELECT id, isbn, title, author, category, rack_number, floor, section,
             total_copies, available_copies, status
      FROM books
      WHERE 1=1
    `;
    const params = [];

    // Parametric search keyword boundary (prevents SQL injection)
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
    next(err);
  }
});

/**
 * GET /api/books/categories
 * @summary Retrieves list of distinct categories
 * @route GET /api/books/categories
 * @returns {200} Array of category name strings
 */
router.get('/categories', (req, res, next) => {
  try {
    const categories = db.prepare(`
      SELECT DISTINCT category FROM books ORDER BY category ASC
    `).all().map(r => r.category);

    res.json(categories);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/books/racks
 * @summary Retrieves list of distinct physical rack locations
 * @route GET /api/books/racks
 * @returns {200} Array of rack location objects with floor and section
 */
router.get('/racks', (req, res, next) => {
  try {
    const racks = db.prepare(`
      SELECT DISTINCT rack_number, floor, section FROM books ORDER BY rack_number ASC
    `).all();

    res.json(racks);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/books/:id
 * @summary Retrieves full details for a single book including active loans
 * @route GET /api/books/:id
 * @param {number} req.params.id - Book primary key
 * @returns {200} Book metadata object with embedded activeLoans array
 * @returns {404} If book does not exist
 */
router.get('/:id', (req, res, next) => {
  try {
    const book = db.prepare(`
      SELECT * FROM books WHERE id = ?
    `).get(req.params.id);

    // Error Boundary: 404 Not Found
    if (!book) {
      return res.status(404).json({
        success: false,
        error: 'Book not found.'
      });
    }

    // Retrieve active or overdue circulation records for this specific book
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
    next(err);
  }
});

/**
 * POST /api/books
 * @summary Adds a new book title to the catalog
 * @route POST /api/books
 * @param {string} req.body.isbn - Standard ISBN identifier
 * @param {string} req.body.title - Book title
 * @param {string} req.body.author - Author name
 * @param {string} req.body.category - Category
 * @param {string} req.body.rack_number - Physical rack ID (e.g. 'Rack A-12')
 * @param {number} [req.body.total_copies=1] - Total stock volume count
 * 
 * @returns {201} Newly created book entity
 * @returns {400} Validation errors (missing field, negative count, duplicate ISBN)
 */
router.post('/', (req, res, next) => {
  try {
    const { isbn, title, author, category, rack_number, floor, section, total_copies } = req.body;

    // Error Boundary: Mandatory field validation
    if (!isbn || !title || !author || !category || !rack_number) {
      return res.status(400).json({
        success: false,
        error: 'ISBN, Title, Author, Category, and Rack Number are required.'
      });
    }

    const copies = parseInt(total_copies, 10) || 1;
    // Error Boundary: Copy volume constraint boundary
    if (copies < 1) {
      return res.status(400).json({
        success: false,
        error: 'Total copies must be at least 1.'
      });
    }

    // Error Boundary: Duplicate ISBN conflict
    const existing = db.prepare('SELECT id FROM books WHERE isbn = ?').get(isbn.trim());
    if (existing) {
      return res.status(400).json({
        success: false,
        error: `Book with ISBN ${isbn} already exists.`
      });
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
      success: true,
      message: 'Book added successfully!',
      book: newBook
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/books/:id
 * @summary Updates metadata or physical shelf location of a book
 * @route PUT /api/books/:id
 * @param {number} req.params.id - Book ID
 * @returns {200} Updated book entity
 * @returns {400} If copy reduction violates active borrow count or ISBN conflicts
 * @returns {404} If book does not exist
 */
router.put('/:id', (req, res, next) => {
  try {
    const { id } = req.params;
    const { isbn, title, author, category, rack_number, floor, section, total_copies } = req.body;

    const currentBook = db.prepare('SELECT * FROM books WHERE id = ?').get(id);
    if (!currentBook) {
      return res.status(404).json({
        success: false,
        error: 'Book not found.'
      });
    }

    // Error Boundary: Duplicate ISBN collision during update
    if (isbn && isbn.trim() !== currentBook.isbn) {
      const duplicate = db.prepare('SELECT id FROM books WHERE isbn = ? AND id != ?').get(isbn.trim(), id);
      if (duplicate) {
        return res.status(400).json({
          success: false,
          error: `ISBN ${isbn} is already in use by another book.`
        });
      }
    }

    const newTotal = parseInt(total_copies, 10) || currentBook.total_copies;
    const issuedCount = currentBook.total_copies - currentBook.available_copies;

    // Error Boundary: Stock constraint boundary (cannot reduce below currently loaned copies)
    if (newTotal < issuedCount) {
      return res.status(400).json({
        success: false,
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
      success: true,
      message: 'Book updated successfully!',
      book: updated
    });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/books/:id
 * @summary Removes a book title from library inventory
 * @route DELETE /api/books/:id
 * @param {number} req.params.id - Book ID
 * @returns {200} Deletion confirmation
 * @returns {400} Rejection if active loans remain outstanding
 * @returns {404} If book does not exist
 */
router.delete('/:id', (req, res, next) => {
  try {
    const { id } = req.params;

    const book = db.prepare('SELECT * FROM books WHERE id = ?').get(id);
    if (!book) {
      return res.status(404).json({
        success: false,
        error: 'Book not found.'
      });
    }

    // Error Boundary: Cannot delete inventory with unreturned circulation loans
    const activeLoan = db.prepare(`
      SELECT COUNT(*) as count FROM borrow_records
      WHERE book_id = ? AND status IN ('active', 'overdue')
    `).get(id);

    if (activeLoan.count > 0) {
      return res.status(400).json({
        success: false,
        error: `Cannot delete "${book.title}". It has ${activeLoan.count} active borrowed copy/copies. Return them first.`
      });
    }

    db.prepare('DELETE FROM books WHERE id = ?').run(id);
    res.json({
      success: true,
      message: `Book "${book.title}" deleted successfully.`
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
