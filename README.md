# 📚 CampusLib - Digital Library Management System
> **Real-World College Library Field-Visit Problem Solver**  
> Built with Node.js, Express, SQLite, and Vanilla HTML5/CSS3/JavaScript.

---

## 🎯 Field-Visit Context & Problem Statement

During real-world college and school library field visits, several recurring pain points were observed:

1. **Difficulty Finding Books**: Students spend up to 15–20 minutes walking along aisles trying to locate where a book is shelved.
2. **Manual Availability Checks**: Librarians and students have to physically verify shelf rows to check if a copy is available or already borrowed.
3. **Manual Issue / Return Logbooks**: Physical registers cause long queues at the counter and are prone to handwriting errors or lost records.
4. **Difficulty Tracking Overdue Books**: Tracking overdue books requires librarians to manually scan pages of borrow registers, leading to delayed returns and uncollected fines.
5. **Time Wasted**: Both students and library staff lose valuable academic hours on avoidable administrative tasks.

---

## 💡 How CampusLib Solves These Problems

| Field-Visit Challenge | CampusLib Digital Solution |
|---|---|
| **Book Location Uncertainty** | **Interactive Shelf / Rack Locator** with exact Rack IDs (e.g. `Rack A-12`, `Floor 1, CS Bay`) and physical tier diagrams. |
| **Manual Stock Inquiries** | **Real-Time Availability Badges** (`Available (2/3)` vs `Issued (0/2)`) with live stock counters. |
| **Logbook Delays** | **1-Click Issue & Return Engine** that auto-calculates return due dates (+14 days) and auto-updates stock. |
| **Overdue Tracking Delays** | **Automated Overdue Engine** with days-overdue counters, red alert badges, and student contact phone/email. |
| **Multi-Criteria Book Search** | **Instant Live Search** supporting Title, Author, ISBN, Category, and Shelf Rack numbers with category chips. |

---

## ✨ Key Features

### 👨‍🎓 Student Portal
- **Student Login & Dashboard**: Personal library card with active borrowings, countdowns to due dates, and past borrowing history.
- **Live Catalog & Search**: Multi-filter search by Title, Author, ISBN, Category, and Availability.
- **Physical Shelf Locator**: Instant interactive guide showing the exact floor, bay, and tier location for any book.

### 👩‍💼 Librarian / Admin Portal
- **Management Dashboard**: Real-time KPI metrics for Total Titles, Physical Copies, Available Stock, Issued Copies, Overdue Loans, and Registered Students.
- **Book Management (CRUD)**: Add, edit, or delete books with rack location, category, ISBN, and copy counts.
- **Streamlined Issue Workflow**: Select student, verify copy availability, set loan duration (7, 14, or 30 days), and issue instantly.
- **1-Click Book Return**: Instant check-in that automatically restores available shelf copies.
- **Overdue Books Tracker**: Dedicated tab displaying all overdue loans, elapsed days, and student department/phone.
- **Audit Circulation History**: Full audit trail of all library transactions.
- **Students Directory**: Overview of all registered students and their active borrowed count.

---

## 🛠️ Technology Stack (Beginner-Friendly & Robust)

- **Backend**: Node.js & Express.js REST API
- **Database**: Embedded SQLite (using `better-sqlite3`) — *Zero DB server configuration required!*
- **Frontend**: Semantic HTML5, Vanilla CSS3 (Custom Properties, Glassmorphism accents, Responsive Grid), and Vanilla ES6 JavaScript (Fetch API).
- **Security & Validation**: Role-based access (Student vs Librarian), input validation, foreign key constraints, and duplicate prevention.

---

## 🚀 Quick Start Guide

### 1. Prerequisites
- Node.js (v18 or newer)
- npm (Node Package Manager)

### 2. Installation & Running
```bash
# Navigate to project folder
cd "AI EMMERSION"

# Install dependencies (Express, better-sqlite3, cors)
npm install

# Run automated tests
npm test

# Start the application
npm start
```

### 3. Open in Browser
Visit **[http://localhost:3000](http://localhost:3000)** in any modern web browser.

---

## ⚡ 1-Click Demo Accounts (For Viva & Presentation)

The application includes built-in realistic sample data with 1-click login buttons:

| Persona | Role | User ID / Roll No | Password | Notes |
|---|---|---|---|---|
| **Mrs. K. Vasanthi** | Librarian | `LIB001` | `admin` | Full library administrative access |
| **Arun Kumar** | Student (CS) | `CS2101` | `123` | Has 1 active borrowed book & 1 past returned book |
| **Priya Sharma** | Student (IT) | `IT2142` | `123` | Has 1 active borrowed book |
| **Rahul Verma** | Student (ECE) | `EC2118` | `123` | **Has 1 Overdue Book** (Due 7 days ago — for demo) |
| **Sneha Patel** | Student (ME) | `ME2130` | `123` | **Has 1 Overdue Book** (Due 4 days ago — for demo) |

---

## 🗄️ Database Architecture

```sql
-- Users (Students and Librarians)
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('student', 'librarian')),
  department TEXT,
  phone TEXT
);

-- Books Collection
CREATE TABLE books (
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

-- Circulation / Borrow Records
CREATE TABLE borrow_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  issue_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  return_date TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'returned', 'overdue')),
  notes TEXT
);
```

---

## 🎓 Viva & Project Presentation Highlights

When presenting this project to professors or evaluators:
1. **Explain the Field-Visit Connection**: Mention how physical manual registers and unmapped racks caused bottlenecks, and how CampusLib digitizes the workflow.
2. **Demonstrate the Shelf Locator**: Click on `Rack A-12` on any book card to show the physical Floor and Bay elevation guide.
3. **Demonstrate Real-Time Transactions**:
   - Issue a book to a student &rarr; Watch the book's available copies decrement and status flip to `Issued`.
   - Process the return &rarr; Watch the copies increment and status restore to `Available`.
4. **Demonstrate Overdue Alerts**: Switch to the *Overdue Books* tab to show the automated overdue calculation engine highlighting students who missed their return date.
