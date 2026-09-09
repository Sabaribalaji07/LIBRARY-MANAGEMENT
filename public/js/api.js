// Centralized API Client for Digital Library Management System
// Auto-detects backend URL so it works seamlessly on both http://localhost:3001 and VS Code Live Server (port 5500)
const API_BASE = (window.location.port === '3001') 
  ? '' 
  : (window.location.protocol === 'file:' ? 'http://localhost:3001' : (window.location.origin.includes('localhost') || window.location.origin.includes('127.0.0.1') ? 'http://localhost:3001' : ''));

const API = {
  // Auth
  async login(identifier, password, role) {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password, role })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    return data;
  },

  async getDemoUsers() {
    const res = await fetch(`${API_BASE}/api/auth/demo-users`);
    return await res.json();
  },

  // Books
  async getBooks(params = {}) {
    const query = new URLSearchParams(params).toString();
    const res = await fetch(`${API_BASE}/api/books?${query}`);
    return await res.json();
  },

  async getBookCategories() {
    const res = await fetch(`${API_BASE}/api/books/categories`);
    return await res.json();
  },

  async getBookById(id) {
    const res = await fetch(`${API_BASE}/api/books/${id}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to fetch book');
    return data;
  },

  async addBook(bookData) {
    const res = await fetch(`${API_BASE}/api/books`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bookData)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to add book');
    return data;
  },

  async updateBook(id, bookData) {
    const res = await fetch(`${API_BASE}/api/books/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bookData)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update book');
    return data;
  },

  async deleteBook(id) {
    const res = await fetch(`${API_BASE}/api/books/${id}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to delete book');
    return data;
  },

  // Borrowing / Circulation
  async issueBook(issueData) {
    const res = await fetch(`${API_BASE}/api/borrows/issue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(issueData)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to issue book');
    return data;
  },

  async returnBook(borrowId, returnNotes) {
    const res = await fetch(`${API_BASE}/api/borrows/return`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ borrow_id: borrowId, return_notes: returnNotes })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to return book');
    return data;
  },

  async getActiveLoans() {
    const res = await fetch(`${API_BASE}/api/borrows/active`);
    return await res.json();
  },

  async getOverdueLoans() {
    const res = await fetch(`${API_BASE}/api/borrows/overdue`);
    return await res.json();
  },

  async getBorrowHistory(params = {}) {
    const query = new URLSearchParams(params).toString();
    const res = await fetch(`${API_BASE}/api/borrows/history?${query}`);
    return await res.json();
  },

  async getMyBooks(studentId) {
    const res = await fetch(`${API_BASE}/api/borrows/my-books/${studentId}`);
    return await res.json();
  },

  // Stats & Students
  async getOverviewStats() {
    const res = await fetch(`${API_BASE}/api/stats/overview`);
    return await res.json();
  },

  async getStudents() {
    const res = await fetch(`${API_BASE}/api/students`);
    return await res.json();
  }
};
