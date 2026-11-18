/**
 * @fileoverview Main Application Server Entrypoint
 * @description Configures Express runtime, security headers, middleware pipelines,
 *              RESTful API routing, and centralized error boundary handling.
 * @module server/index
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDatabase } = require('./db');
const { notFoundHandler, globalErrorHandler } = require('./middleware/errorHandler');

// Route Handlers
const authRoutes = require('./routes/auth');
const booksRoutes = require('./routes/books');
const borrowsRoutes = require('./routes/borrows');
const statsRoutes = require('./routes/stats');
const studentsRoutes = require('./routes/students');

// Instantiate Express Application
const app = express();
const PORT = process.env.PORT || 3000;

// Initialize SQLite Database schema, seed data, and run automatic password migrations
initDatabase();

/* -------------------------------------------------------------------------- */
/*                           MIDDLEWARE PIPELINE                              */
/* -------------------------------------------------------------------------- */

// Enable Cross-Origin Resource Sharing (CORS) for all client origins
app.use(cors());

// Parse incoming requests with JSON payloads (with built-in error boundary catch)
app.use(express.json({ limit: '1mb' }));

// Parse incoming URL-encoded form payloads
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Serve static frontend assets (HTML, CSS, JS, Images) from the public directory
app.use(express.static(path.join(__dirname, '..', 'public')));

/* -------------------------------------------------------------------------- */
/*                              REST API ROUTES                               */
/* -------------------------------------------------------------------------- */

// Authentication & Session Management Endpoints
app.use('/api/auth', authRoutes);

// Catalog & Book Inventory Management Endpoints
app.use('/api/books', booksRoutes);

// Borrow, Return, and Overdue Circulation Endpoints
app.use('/api/borrows', borrowsRoutes);

// Analytics, Metrics, and KPI Dashboard Endpoints
app.use('/api/stats', statsRoutes);

// Student Roster & Circulation Profile Endpoints
app.use('/api/students', studentsRoutes);

/* -------------------------------------------------------------------------- */
/*                       ERROR BOUNDARIES & FALLBACKS                         */
/* -------------------------------------------------------------------------- */

// 404 Catch-All specifically for unmatched /api/* requests
app.all('/api/*', notFoundHandler);

// Fallback for Single Page Application (SPA) client-side routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Centralized Error Boundary Middleware (must be registered last with 4 arguments)
app.use(globalErrorHandler);

/* -------------------------------------------------------------------------- */
/*                              SERVER LIFECYCLE                              */
/* -------------------------------------------------------------------------- */

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`🚀 Digital Library Management System is running!`);
    console.log(`📍 Web Application: http://localhost:${PORT}`);
    console.log(`📚 Embedded SQLite Database: Active & WAL Mode`);
    console.log(`🛡️ Global Error Boundary Middleware: Initialized`);
    console.log(`====================================================`);
  });
}

module.exports = app;
