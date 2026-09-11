const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, '..', 'library.sqlite');
const db = new Database(dbPath);

// Enable foreign key constraints
db.pragma('foreign_keys = ON');

// Initialize tables
function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('student', 'librarian')),
      department TEXT,
      phone TEXT
    );

    CREATE TABLE IF NOT EXISTS books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      isbn TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      author TEXT NOT NULL,
      category TEXT NOT NULL,
      rack_number TEXT NOT NULL,
      floor TEXT DEFAULT 'Floor 1',
      section TEXT DEFAULT 'Main Wing',
      total_copies INTEGER NOT NULL DEFAULT 1,
      available_copies INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'Available' CHECK(status IN ('Available', 'Issued'))
    );

    CREATE TABLE IF NOT EXISTS borrow_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      issue_date TEXT NOT NULL,
      due_date TEXT NOT NULL,
      return_date TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'returned', 'overdue')),
      notes TEXT
    );
  `);

  seedData();
  migratePasswordsToHash();
}

// Auto-migrate any unhashed plaintext passwords to bcrypt hash (cost factor 10)
function migratePasswordsToHash() {
  const users = db.prepare('SELECT id, password FROM users').all();
  const updateStmt = db.prepare('UPDATE users SET password = ? WHERE id = ?');
  
  users.forEach(u => {
    // Check if password is not already a bcrypt hash ($2a$ or $2b$)
    if (!u.password.startsWith('$2a$') && !u.password.startsWith('$2b$')) {
      const hashed = bcrypt.hashSync(u.password, 10);
      updateStmt.run(hashed, u.id);
    }
  });
}

// Seed initial realistic data for college library demonstration
function seedData() {
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;

  if (userCount === 0) {
    console.log('Seeding initial library data...');

    // Seed Users (1 Librarian + 4 Students)
    const insertUser = db.prepare(`
      INSERT INTO users (user_id, name, email, password, role, department, phone)
      VALUES (@user_id, @name, @email, @password, @role, @department, @phone)
    `);

    const users = [
      {
        user_id: 'LIB001',
        name: 'Mrs. K. Vasanthi',
        email: 'librarian@college.edu',
        password: bcrypt.hashSync('admin', 10),
        role: 'librarian',
        department: 'Central Library',
        phone: '+91 98450 11223'
      },
      {
        user_id: 'CS2101',
        name: 'Arun Kumar',
        email: 'arun.cs@college.edu',
        password: bcrypt.hashSync('123', 10),
        role: 'student',
        department: 'Computer Science & Engg',
        phone: '+91 97123 45670'
      },
      {
        user_id: 'IT2142',
        name: 'Priya Sharma',
        email: 'priya.it@college.edu',
        password: bcrypt.hashSync('123', 10),
        role: 'student',
        department: 'Information Technology',
        phone: '+91 98234 56781'
      },
      {
        user_id: 'EC2118',
        name: 'Rahul Verma',
        email: 'rahul.ec@college.edu',
        password: bcrypt.hashSync('123', 10),
        role: 'student',
        department: 'Electronics & Comm Engg',
        phone: '+91 99345 67892'
      },
      {
        user_id: 'ME2130',
        name: 'Sneha Patel',
        email: 'sneha.me@college.edu',
        password: bcrypt.hashSync('123', 10),
        role: 'student',
        department: 'Mechanical Engineering',
        phone: '+91 96456 78903'
      }
    ];

    for (const u of users) {
      insertUser.run(u);
    }

    // Seed Books across multiple categories with realistic shelf/rack locations
    const insertBook = db.prepare(`
      INSERT INTO books (isbn, title, author, category, rack_number, floor, section, total_copies, available_copies, status)
      VALUES (@isbn, @title, @author, @category, @rack_number, @floor, @section, @total_copies, @available_copies, @status)
    `);

    const books = [
      {
        isbn: '978-0071809252',
        title: 'Java: The Complete Reference',
        author: 'Herbert Schildt',
        category: 'Computer Science',
        rack_number: 'Rack A-12',
        floor: 'Floor 1',
        section: 'CS Bay 1',
        total_copies: 3,
        available_copies: 2,
        status: 'Available'
      },
      {
        isbn: '978-0131103627',
        title: 'The C Programming Language',
        author: 'Brian W. Kernighan, Dennis M. Ritchie',
        category: 'Computer Science',
        rack_number: 'Rack A-05',
        floor: 'Floor 1',
        section: 'CS Bay 1',
        total_copies: 2,
        available_copies: 1,
        status: 'Available'
      },
      {
        isbn: '978-0262033848',
        title: 'Introduction to Algorithms (CLRS)',
        author: 'Thomas H. Cormen, Charles E. Leiserson',
        category: 'Computer Science',
        rack_number: 'Rack A-18',
        floor: 'Floor 1',
        section: 'Algorithms Bay',
        total_copies: 2,
        available_copies: 0,
        status: 'Issued'
      },
      {
        isbn: '978-0132350884',
        title: 'Clean Code: Agile Software Craftsmanship',
        author: 'Robert C. Martin',
        category: 'Software Engineering',
        rack_number: 'Rack B-04',
        floor: 'Floor 1',
        section: 'Software Bay',
        total_copies: 2,
        available_copies: 2,
        status: 'Available'
      },
      {
        isbn: '978-0134685991',
        title: 'Effective Java (3rd Edition)',
        author: 'Joshua Bloch',
        category: 'Computer Science',
        rack_number: 'Rack A-14',
        floor: 'Floor 1',
        section: 'CS Bay 1',
        total_copies: 1,
        available_copies: 1,
        status: 'Available'
      },
      {
        isbn: '978-0133594140',
        title: 'Computer Networks (5th Edition)',
        author: 'Andrew S. Tanenbaum, David J. Wetherall',
        category: 'Networking',
        rack_number: 'Rack B-11',
        floor: 'Floor 1',
        section: 'Networking Bay',
        total_copies: 2,
        available_copies: 1,
        status: 'Available'
      },
      {
        isbn: '978-0078022159',
        title: 'Database System Concepts',
        author: 'Abraham Silberschatz, Henry F. Korth',
        category: 'Database Systems',
        rack_number: 'Rack B-19',
        floor: 'Floor 1',
        section: 'Databases Bay',
        total_copies: 2,
        available_copies: 2,
        status: 'Available'
      },
      {
        isbn: '978-0131873254',
        title: 'Operating System Concepts',
        author: 'Peter B. Galvin, Greg Gagne',
        category: 'Computer Science',
        rack_number: 'Rack A-22',
        floor: 'Floor 1',
        section: 'Systems Bay',
        total_copies: 2,
        available_copies: 1,
        status: 'Available'
      },
      {
        isbn: '978-0198083832',
        title: 'Electronic Devices and Circuit Theory',
        author: 'Robert L. Boylestad, Louis Nashelsky',
        category: 'Electronics',
        rack_number: 'Rack C-08',
        floor: 'Floor 2',
        section: 'Electronics Wing',
        total_copies: 2,
        available_copies: 1,
        status: 'Available'
      },
      {
        isbn: '978-0070151437',
        title: 'Digital Design',
        author: 'M. Morris Mano, Michael D. Ciletti',
        category: 'Electronics',
        rack_number: 'Rack C-14',
        floor: 'Floor 2',
        section: 'Electronics Wing',
        total_copies: 1,
        available_copies: 0,
        status: 'Issued'
      },
      {
        isbn: '978-8121903745',
        title: 'A Textbook of Engineering Mechanics',
        author: 'R. S. Khurmi',
        category: 'Mechanical',
        rack_number: 'Rack D-03',
        floor: 'Floor 2',
        section: 'Mechanical Wing',
        total_copies: 3,
        available_copies: 3,
        status: 'Available'
      },
      {
        isbn: '978-0070668614',
        title: 'Higher Engineering Mathematics',
        author: 'B. S. Grewal',
        category: 'Mathematics',
        rack_number: 'Rack E-02',
        floor: 'Floor 2',
        section: 'Mathematics Bay',
        total_copies: 4,
        available_copies: 3,
        status: 'Available'
      },
      {
        isbn: '978-0143424598',
        title: 'Wings of Fire: An Autobiography',
        author: 'A. P. J. Abdul Kalam, Arun Tiwari',
        category: 'Biography',
        rack_number: 'Rack L-01',
        floor: 'Floor 3',
        section: 'General Reading Wing',
        total_copies: 2,
        available_copies: 2,
        status: 'Available'
      },
      {
        isbn: '978-8129115300',
        title: 'The Alchemist',
        author: 'Paulo Coelho',
        category: 'Literature',
        rack_number: 'Rack L-15',
        floor: 'Floor 3',
        section: 'Fiction & Literature',
        total_copies: 2,
        available_copies: 2,
        status: 'Available'
      }
    ];

    for (const b of books) {
      insertBook.run(b);
    }

    // Seed realistic Borrow Records:
    // 1. One active loan on-time (Arun Kumar has "The C Programming Language")
    // 2. One active loan on-time (Priya Sharma has "Computer Networks")
    // 3. One OVERDUE loan (Rahul Verma has "Introduction to Algorithms" - due 7 days ago to demonstrate overdue tracking!)
    // 4. One OVERDUE loan (Sneha Patel has "Digital Design" - due 4 days ago)
    // 5. One completed past return record (Arun Kumar returned "Java" in the past)

    const today = new Date();
    const formatDate = (d) => d.toISOString().split('T')[0];

    const dateOffset = (days) => {
      const d = new Date();
      d.setDate(d.getDate() + days);
      return formatDate(d);
    };

    const insertBorrow = db.prepare(`
      INSERT INTO borrow_records (book_id, user_id, issue_date, due_date, return_date, status, notes)
      VALUES (@book_id, @user_id, @issue_date, @due_date, @return_date, @status, @notes)
    `);

    // Fetch IDs
    const getBook = (title) => db.prepare('SELECT id FROM books WHERE title LIKE ?').get(`%${title}%`);
    const getUser = (uid) => db.prepare('SELECT id FROM users WHERE user_id = ?').get(uid);

    const bJava = getBook('Java: The Complete Reference');
    const bC = getBook('The C Programming Language');
    const bCLRS = getBook('Introduction to Algorithms');
    const bNet = getBook('Computer Networks');
    const bDD = getBook('Digital Design');

    const uArun = getUser('CS2101');
    const uPriya = getUser('IT2142');
    const uRahul = getUser('EC2118');
    const uSneha = getUser('ME2130');

    // 1. Arun active loan
    if (bC && uArun) {
      insertBorrow.run({
        book_id: bC.id,
        user_id: uArun.id,
        issue_date: dateOffset(-5),
        due_date: dateOffset(9),
        return_date: null,
        status: 'active',
        notes: 'Issued for semester exam preparation'
      });
    }

    // 2. Priya active loan
    if (bNet && uPriya) {
      insertBorrow.run({
        book_id: bNet.id,
        user_id: uPriya.id,
        issue_date: dateOffset(-3),
        due_date: dateOffset(11),
        return_date: null,
        status: 'active',
        notes: 'Lab reference'
      });
    }

    // 3. Rahul OVERDUE loan (Due 7 days ago)
    if (bCLRS && uRahul) {
      insertBorrow.run({
        book_id: bCLRS.id,
        user_id: uRahul.id,
        issue_date: dateOffset(-21),
        due_date: dateOffset(-7),
        return_date: null,
        status: 'overdue',
        notes: 'Field-visit test: Overdue by 7 days'
      });
    }

    // 4. Sneha OVERDUE loan (Due 4 days ago)
    if (bDD && uSneha) {
      insertBorrow.run({
        book_id: bDD.id,
        user_id: uSneha.id,
        issue_date: dateOffset(-18),
        due_date: dateOffset(-4),
        return_date: null,
        status: 'overdue',
        notes: 'Field-visit test: Overdue by 4 days'
      });
    }

    // 5. Past returned record
    if (bJava && uArun) {
      insertBorrow.run({
        book_id: bJava.id,
        user_id: uArun.id,
        issue_date: dateOffset(-40),
        due_date: dateOffset(-26),
        return_date: dateOffset(-28),
        status: 'returned',
        notes: 'Returned on time in good condition'
      });
    }

    console.log('Database seeded successfully with users, books, and realistic borrow records.');
  }
}

// Helper query wrappers
module.exports = {
  db,
  initDatabase
};
