const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDatabase } = require('./db');

const authRoutes = require('./routes/auth');
const booksRoutes = require('./routes/books');
const borrowsRoutes = require('./routes/borrows');
const statsRoutes = require('./routes/stats');
const studentsRoutes = require('./routes/students');

const app = express();
const PORT = process.env.PORT || 3001;

// Initialize Database & seed if needed
initDatabase();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files
app.use(express.static(path.join(__dirname, '..', 'public')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/books', booksRoutes);
app.use('/api/borrows', borrowsRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/students', studentsRoutes);

// Fallback for SPA navigation
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Start Server
app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 Digital Library Management System is running!`);
  console.log(`📍 Web Application: http://localhost:${PORT}`);
  console.log(`📚 Embedded SQLite Database ready.`);
  console.log(`====================================================`);
});
