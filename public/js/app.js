// =========================================================
// CAMPUSLIB - MAIN APPLICATION CONTROLLER
// =========================================================

const app = {
  currentUser: null,
  activeRole: 'student', // 'student' or 'librarian'
  currentView: 'view-login',
  selectedCategory: 'All',
  searchQuery: '',
  allBooksCache: [],
  allStudentsCache: [],
  searchDebounceTimer: null,

  // Initialization
  async init() {
    this.restoreSession();
    await this.loadDemoUsers();
    this.setupDatePickers();
    
    // Check if user was already logged in
    if (this.currentUser) {
      this.renderNav();
      if (this.currentUser.role === 'librarian') {
        this.navigateTo('view-admin-dashboard');
      } else {
        this.navigateTo('view-student-dashboard');
      }
    } else {
      this.renderNav();
      this.navigateTo('view-login');
    }
  },

  // Session Storage Management
  restoreSession() {
    const saved = localStorage.getItem('campuslib_user');
    if (saved) {
      try {
        this.currentUser = JSON.parse(saved);
        this.activeRole = this.currentUser.role;
      } catch (e) {
        this.currentUser = null;
      }
    }
  },

  saveSession(user) {
    this.currentUser = user;
    this.activeRole = user.role;
    localStorage.setItem('campuslib_user', JSON.stringify(user));
  },

  clearSession() {
    this.currentUser = null;
    localStorage.removeItem('campuslib_user');
    this.renderNav();
    this.navigateTo('view-login');
    this.showToast('You have been logged out.', 'info');
  },

  // Setup Date Pickers
  setupDatePickers() {
    const issueDateInput = document.getElementById('issue-due-date');
    if (issueDateInput) {
      const d = new Date();
      d.setDate(d.getDate() + 14);
      issueDateInput.value = d.toISOString().split('T')[0];
    }
  },

  calculateDueDateFromDuration() {
    const days = parseInt(document.getElementById('issue-duration-days').value) || 14;
    const d = new Date();
    d.setDate(d.getDate() + days);
    document.getElementById('issue-due-date').value = d.toISOString().split('T')[0];
  },

  // Navigation & View Routing
  navigateTo(viewId) {
    document.querySelectorAll('.view-section').forEach(sec => sec.classList.remove('active'));
    const target = document.getElementById(viewId);
    if (target) {
      target.classList.add('active');
      this.currentView = viewId;
      window.scrollTo({ top: 0, behavior: 'smooth' });

      // Update active nav button
      document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-view') === viewId);
      });

      // Trigger view-specific loads
      if (viewId === 'view-catalog') this.loadCatalog();
      if (viewId === 'view-student-dashboard') this.loadStudentDashboard();
      if (viewId === 'view-admin-dashboard') this.loadAdminDashboard();
      if (viewId === 'view-issue-book') this.loadIssueView();
      if (viewId === 'view-return-book') this.loadReturnView();
      if (viewId === 'view-overdue') this.loadOverdueView();
      if (viewId === 'view-history') this.loadHistory();
      if (viewId === 'view-students') this.loadStudentsDirectory();
    }
  },

  navigateToHome() {
    if (!this.currentUser) {
      this.navigateTo('view-login');
    } else if (this.currentUser.role === 'librarian') {
      this.navigateTo('view-admin-dashboard');
    } else {
      this.navigateTo('view-student-dashboard');
    }
  },

  // Dynamic Navigation Bar Rendering
  renderNav() {
    const navLinks = document.getElementById('nav-links');
    const userControls = document.getElementById('user-controls');

    if (!this.currentUser) {
      navLinks.innerHTML = `
        <li><button class="nav-btn ${this.currentView === 'view-login' ? 'active' : ''}" data-view="view-login" onclick="app.navigateTo('view-login')">🔐 Login</button></li>
        <li><button class="nav-btn ${this.currentView === 'view-catalog' ? 'active' : ''}" data-view="view-catalog" onclick="app.navigateTo('view-catalog')">🔍 Public Catalog</button></li>
      `;
      userControls.innerHTML = `
        <span style="font-size: 0.8rem; color: var(--neutral-500);">Guest Mode</span>
      `;
      return;
    }

    if (this.currentUser.role === 'student') {
      navLinks.innerHTML = `
        <li><button class="nav-btn" data-view="view-student-dashboard" onclick="app.navigateTo('view-student-dashboard')">📊 My Dashboard</button></li>
        <li><button class="nav-btn" data-view="view-catalog" onclick="app.navigateTo('view-catalog')">🔍 Search Books</button></li>
      `;
      userControls.innerHTML = `
        <div class="user-profile-badge">
          <div class="user-avatar">${this.currentUser.name.charAt(0)}</div>
          <div>
            <div style="font-weight: 700; font-size: 0.825rem;">${this.currentUser.name}</div>
            <span class="role-tag student">${this.currentUser.user_id}</span>
          </div>
        </div>
        <button class="btn btn-secondary btn-sm" onclick="app.clearSession()">Logout</button>
      `;
    } else if (this.currentUser.role === 'librarian') {
      navLinks.innerHTML = `
        <li><button class="nav-btn" data-view="view-admin-dashboard" onclick="app.navigateTo('view-admin-dashboard')">📊 Dashboard</button></li>
        <li><button class="nav-btn" data-view="view-catalog" onclick="app.navigateTo('view-catalog')">📚 Book Catalog</button></li>
        <li><button class="nav-btn" data-view="view-issue-book" onclick="app.navigateTo('view-issue-book')">📤 Issue</button></li>
        <li><button class="nav-btn" data-view="view-return-book" onclick="app.navigateTo('view-return-book')">📥 Return</button></li>
        <li><button class="nav-btn" data-view="view-overdue" onclick="app.navigateTo('view-overdue')">⚠️ Overdue <span class="nav-badge" id="nav-overdue-badge" style="display:none;">0</span></button></li>
        <li><button class="nav-btn" data-view="view-history" onclick="app.navigateTo('view-history')">📜 History</button></li>
        <li><button class="nav-btn" data-view="view-students" onclick="app.navigateTo('view-students')">👨‍🎓 Students</button></li>
      `;
      userControls.innerHTML = `
        <div class="user-profile-badge">
          <div class="user-avatar" style="background:#d97706;">👩‍💼</div>
          <div>
            <div style="font-weight: 700; font-size: 0.825rem;">${this.currentUser.name}</div>
            <span class="role-tag librarian">Librarian</span>
          </div>
        </div>
        <button class="btn btn-secondary btn-sm" onclick="app.clearSession()">Logout</button>
      `;
    }
  },

  // Auth Tab Switcher
  switchAuthTab(role) {
    this.activeRole = role;
    document.getElementById('tab-btn-student').classList.toggle('active', role === 'student');
    document.getElementById('tab-btn-librarian').classList.toggle('active', role === 'librarian');
    
    const label = document.getElementById('login-label-id');
    const input = document.getElementById('login-identifier');
    if (role === 'student') {
      label.innerText = 'Student Roll No. / Email';
      input.placeholder = 'e.g. CS2101 or arun.cs@college.edu';
    } else {
      label.innerText = 'Librarian ID / Email';
      input.placeholder = 'e.g. LIB001 or librarian@college.edu';
    }
  },

  // Load Demo Users for 1-Click Login
  async loadDemoUsers() {
    try {
      const users = await API.getDemoUsers();
      const container = document.getElementById('demo-users-list');
      if (!container) return;

      container.innerHTML = users.map(u => `
        <button type="button" class="demo-chip-btn" onclick="app.quickLogin('${u.user_id}', '${u.password}', '${u.role}')">
          <span>${u.role === 'librarian' ? '👩‍💼' : '👨‍🎓'} <strong>${u.name}</strong> (${u.role.toUpperCase()} - ${u.user_id})</span>
          <span style="font-size: 0.75rem; color: var(--primary); font-weight: 600;">1-Click Login &rarr;</span>
        </button>
      `).join('');
    } catch (err) {
      console.error('Failed to load demo users:', err);
    }
  },

  async quickLogin(identifier, password, role) {
    document.getElementById('login-identifier').value = identifier;
    document.getElementById('login-password').value = password;
    this.switchAuthTab(role);
    await this.submitLogin(identifier, password, role);
  },

  async handleLogin(event) {
    event.preventDefault();
    const identifier = document.getElementById('login-identifier').value.trim();
    const password = document.getElementById('login-password').value;
    await this.submitLogin(identifier, password, this.activeRole);
  },

  async submitLogin(identifier, password, role) {
    const btn = document.getElementById('login-submit-btn');
    btn.disabled = true;
    btn.innerText = 'Signing In...';

    try {
      const res = await API.login(identifier, password, role);
      this.saveSession(res.user);
      this.renderNav();
      this.showToast(`Welcome back, ${res.user.name}!`, 'success');
      
      if (res.user.role === 'librarian') {
        this.navigateTo('view-admin-dashboard');
      } else {
        this.navigateTo('view-student-dashboard');
      }
    } catch (err) {
      this.showToast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerText = 'Sign In to Library';
    }
  },

  // =========================================================
  // VIEW: STUDENT DASHBOARD
  // =========================================================
  async loadStudentDashboard() {
    if (!this.currentUser) return;

    document.getElementById('student-welcome-name').innerText = `Welcome, ${this.currentUser.name}`;
    document.getElementById('student-welcome-dept').innerText = `${this.currentUser.department || 'Department of Engineering'} • Roll: ${this.currentUser.user_id}`;

    try {
      const data = await API.getMyBooks(this.currentUser.id);
      
      const activeCount = data.active.length;
      const overdueCount = data.active.filter(b => b.status === 'overdue' || b.days_overdue > 0).length;
      const returnedCount = data.history.length;

      document.getElementById('student-stat-active').innerText = activeCount;
      document.getElementById('student-stat-overdue').innerText = overdueCount;
      document.getElementById('student-stat-returned').innerText = returnedCount;

      // Render Active Table
      const activeTbody = document.getElementById('student-active-tbody');
      if (data.active.length === 0) {
        activeTbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 2rem; color: var(--neutral-500);">You have no active borrowed books. Click "Browse & Search Books" to explore!</td></tr>`;
      } else {
        activeTbody.innerHTML = data.active.map(b => {
          const isOverdue = b.status === 'overdue' || b.days_overdue > 0;
          return `
            <tr>
              <td>
                <strong>${b.book_title}</strong>
                <div style="font-size: 0.8rem; color: var(--neutral-500);">${b.author}</div>
              </td>
              <td><code>${b.isbn}</code></td>
              <td>
                <span class="rack-tag" onclick="app.showShelfLocatorModal('${b.book_title.replace(/'/g, "\\'")}', '${b.author.replace(/'/g, "\\'")}', '${b.rack_number}', '${b.floor}', '${b.section}')">
                  📍 ${b.rack_number}
                </span>
              </td>
              <td>${b.issue_date}</td>
              <td><strong>${b.due_date}</strong></td>
              <td>
                ${isOverdue 
                  ? `<span class="status-badge overdue">⚠️ Overdue (${b.days_overdue} days)</span>` 
                  : `<span class="status-badge available">Active Loan</span>`
                }
              </td>
            </tr>
          `;
        }).join('');
      }

      // Render History Table
      const historyTbody = document.getElementById('student-history-tbody');
      if (data.history.length === 0) {
        historyTbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 1.5rem; color: var(--neutral-500);">No past returned records yet.</td></tr>`;
      } else {
        historyTbody.innerHTML = data.history.map(b => `
          <tr>
            <td><strong>${b.book_title}</strong></td>
            <td>${b.author}</td>
            <td><span class="category-badge">${b.category}</span></td>
            <td>${b.issue_date}</td>
            <td>${b.return_date || '-'}</td>
            <td><span class="status-badge available">Returned</span></td>
          </tr>
        `).join('');
      }

    } catch (err) {
      console.error('Failed to load student dashboard:', err);
      this.showToast('Failed to load borrowing records.', 'error');
    }
  },

  // =========================================================
  // VIEW: ADMIN / LIBRARIAN DASHBOARD
  // =========================================================
  async loadAdminDashboard() {
    try {
      const stats = await API.getOverviewStats();
      document.getElementById('admin-stat-titles').innerText = stats.totalTitles;
      document.getElementById('admin-stat-available').innerText = stats.availableCopies;
      document.getElementById('admin-stat-issued').innerText = stats.issuedCopies;
      document.getElementById('admin-stat-overdue').innerText = stats.overdueCount;
      document.getElementById('admin-stat-students').innerText = stats.totalStudents;

      // Update overdue badge in nav
      const badge = document.getElementById('nav-overdue-badge');
      if (badge) {
        if (stats.overdueCount > 0) {
          badge.style.display = 'inline-block';
          badge.innerText = stats.overdueCount;
        } else {
          badge.style.display = 'none';
        }
      }

      // Render Rack Distribution Summary
      const rackSummary = document.getElementById('admin-rack-summary');
      if (rackSummary && stats.rackDistribution) {
        rackSummary.innerHTML = stats.rackDistribution.map(r => `
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.5rem 0.75rem; background: var(--neutral-100); border-radius: var(--radius-sm); font-size: 0.825rem;">
            <span>📍 <strong>${r.rack_number}</strong> (${r.floor || 'Floor 1'})</span>
            <span class="category-badge" style="font-size: 0.7rem;">${r.book_count} Titles</span>
          </div>
        `).join('');
      }

      // Render Recent Active Circulation Table
      const activeLoans = await API.getActiveLoans();
      const recentTbody = document.getElementById('admin-recent-circulation-tbody');
      if (recentTbody) {
        if (activeLoans.length === 0) {
          recentTbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 1.5rem; color: var(--neutral-500);">No active loans right now. All library books are on shelves.</td></tr>`;
        } else {
          recentTbody.innerHTML = activeLoans.slice(0, 5).map(l => {
            const isOverdue = l.status === 'overdue' || l.days_overdue > 0;
            return `
              <tr>
                <td>
                  <strong>${l.student_name}</strong>
                  <div style="font-size: 0.75rem; color: var(--neutral-500);">${l.student_roll} • ${l.department}</div>
                </td>
                <td><strong>${l.book_title}</strong></td>
                <td><span class="rack-tag">📍 ${l.rack_number}</span></td>
                <td>${l.issue_date}</td>
                <td>${l.due_date}</td>
                <td>
                  ${isOverdue 
                    ? `<span class="status-badge overdue">⚠️ Overdue (${l.days_overdue}d)</span>` 
                    : `<span class="status-badge available">Issued</span>`
                  }
                </td>
                <td>
                  <button class="btn btn-success btn-sm" onclick="app.quickReturnBook(${l.borrow_id})">📥 Return</button>
                </td>
              </tr>
            `;
          }).join('');
        }
      }
    } catch (err) {
      console.error('Failed to load admin stats:', err);
    }
  },

  // =========================================================
  // VIEW: BOOK SEARCH & CATALOG
  // =========================================================
  async loadCatalog() {
    // Show add book button if librarian
    const librarianActions = document.getElementById('catalog-librarian-actions');
    if (librarianActions) {
      if (this.currentUser && this.currentUser.role === 'librarian') {
        librarianActions.innerHTML = `<button class="btn btn-primary" onclick="app.openBookModal()">➕ Add New Book</button>`;
      } else {
        librarianActions.innerHTML = '';
      }
    }

    const statusFilter = document.getElementById('catalog-status-filter');
    if (statusFilter && !statusFilter.dataset.userInteracted) {
      statusFilter.value = 'All';
    }

    await this.loadCategories();
    await this.fetchAndRenderBooks();
  },

  async loadCategories() {
    try {
      const categories = await API.getBookCategories();
      const chipsContainer = document.getElementById('catalog-category-chips');
      if (!chipsContainer) return;

      chipsContainer.innerHTML = `
        <button class="filter-chip ${this.selectedCategory === 'All' ? 'active' : ''}" onclick="app.filterCategory('All')">All Categories</button>
        ${categories.map(c => `
          <button class="filter-chip ${this.selectedCategory === c ? 'active' : ''}" onclick="app.filterCategory('${c}')">${c}</button>
        `).join('')}
      `;
    } catch (err) {
      console.error('Failed to load categories:', err);
    }
  },

  filterCategory(category) {
    this.selectedCategory = category;
    document.querySelectorAll('.filter-chip').forEach(chip => {
      chip.classList.toggle('active', chip.innerText.includes(category) || (category === 'All' && chip.innerText === 'All Categories'));
    });
    this.fetchAndRenderBooks();
  },

  handleSearchInput(event) {
    clearTimeout(this.searchDebounceTimer);
    this.searchDebounceTimer = setTimeout(() => {
      this.searchQuery = event.target.value.trim();
      this.fetchAndRenderBooks();
    }, 250);
  },

  handleFilterChange() {
    const statusFilter = document.getElementById('catalog-status-filter');
    if (statusFilter) statusFilter.dataset.userInteracted = 'true';
    this.fetchAndRenderBooks();
  },

  async fetchAndRenderBooks() {
    const status = document.getElementById('catalog-status-filter').value;
    const params = {};
    if (this.searchQuery) params.q = this.searchQuery;
    if (this.selectedCategory && this.selectedCategory !== 'All') params.category = this.selectedCategory;
    if (status && status !== 'All') params.status = status;

    const grid = document.getElementById('books-grid-container');
    grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 2rem; color: var(--neutral-500);">Loading books catalog...</div>`;

    try {
      const books = await API.getBooks(params);
      this.allBooksCache = books;

      const countDisplay = document.getElementById('catalog-results-count');
      countDisplay.innerText = `Showing ${books.length} book${books.length === 1 ? '' : 's'}${this.searchQuery ? ` matching "${this.searchQuery}"` : ''}`;

      if (books.length === 0) {
        grid.innerHTML = `
          <div style="grid-column: 1/-1; text-align: center; padding: 3rem; background: white; border-radius: var(--radius-lg); border: 1px dashed var(--neutral-300);">
            <div style="font-size: 2rem; margin-bottom: 0.5rem;">🔍</div>
            <h3>No books found matching your search</h3>
            <p style="color: var(--neutral-500); margin-top: 0.25rem;">Try adjusting your keyword or filter by another category.</p>
          </div>
        `;
        return;
      }

      grid.innerHTML = books.map(b => {
        const isAvailable = b.available_copies > 0;
        const statusBadge = isAvailable
          ? `<span class="status-badge available">Available (${b.available_copies}/${b.total_copies})</span>`
          : `<span class="status-badge issued">Issued (0/${b.total_copies})</span>`;

        const isLibrarian = this.currentUser && this.currentUser.role === 'librarian';

        return `
          <div class="book-card">
            <div class="book-header">
              <span class="category-badge">${b.category}</span>
              ${statusBadge}
            </div>

            <h3 class="book-title">${b.title}</h3>
            <div class="book-author">✍️ ${b.author}</div>

            <div class="book-meta">
              <div class="meta-item">
                <span class="meta-label">ISBN:</span>
                <span class="meta-value"><code>${b.isbn}</code></span>
              </div>
              <div class="meta-item">
                <span class="meta-label">Shelf Location:</span>
                <span class="rack-tag" onclick="app.showShelfLocatorModal('${b.title.replace(/'/g, "\\'")}', '${b.author.replace(/'/g, "\\'")}', '${b.rack_number}', '${b.floor}', '${b.section}')" title="Click to view interactive physical shelf map">
                  📍 ${b.rack_number}
                </span>
              </div>
              <div class="meta-item">
                <span class="meta-label">Floor & Section:</span>
                <span class="meta-value">${b.floor || 'Floor 1'} • ${b.section || 'General'}</span>
              </div>
            </div>

            <div class="book-actions">
              <button class="btn btn-secondary btn-sm" style="flex: 1;" onclick="app.viewBookDetails(${b.id})">
                ℹ️ Details & Shelf
              </button>

              ${isLibrarian ? `
                ${isAvailable ? `<button class="btn btn-primary btn-sm" onclick="app.prepareIssueForBook(${b.id})">📤 Issue</button>` : ''}
                <button class="btn btn-secondary btn-icon btn-sm" title="Edit Book" onclick="app.openBookModal(${b.id})">✏️</button>
                <button class="btn btn-danger btn-icon btn-sm" title="Delete Book" onclick="app.handleDeleteBook(${b.id}, '${b.title.replace(/'/g, "\\'")}')">🗑️</button>
              ` : ''}
            </div>
          </div>
        `;
      }).join('');

    } catch (err) {
      console.error('Failed to fetch books:', err);
      grid.innerHTML = `<div style="grid-column: 1/-1; color: var(--danger); text-align: center;">Failed to load books catalog.</div>`;
    }
  },

  // =========================================================
  // VIEW: ISSUE BOOK (Librarian)
  // =========================================================
  async loadIssueView() {
    try {
      const [students, books] = await Promise.all([
        API.getStudents(),
        API.getBooks({ status: 'Available' })
      ]);

      this.allStudentsCache = students;

      const studentSelect = document.getElementById('issue-student-select');
      studentSelect.innerHTML = `<option value="">-- Choose Student --</option>` +
        students.map(s => `<option value="${s.id}">${s.name} (${s.user_id}) - ${s.department} [${s.active_loans_count} active]</option>`).join('');

      const bookSelect = document.getElementById('issue-book-select');
      bookSelect.innerHTML = `<option value="">-- Choose Available Book --</option>` +
        books.map(b => `<option value="${b.id}">${b.title} - ${b.rack_number} (${b.available_copies} available)</option>`).join('');

      this.updateIssueStudentPreview();
      this.updateIssueBookPreview();
    } catch (err) {
      console.error('Failed to load issue view options:', err);
      this.showToast('Failed to load students/books list.', 'error');
    }
  },

  prepareIssueForBook(bookId) {
    this.navigateTo('view-issue-book');
    setTimeout(() => {
      const bookSelect = document.getElementById('issue-book-select');
      if (bookSelect) {
        bookSelect.value = bookId;
        this.updateIssueBookPreview();
      }
    }, 150);
  },

  updateIssueStudentPreview() {
    const studentId = document.getElementById('issue-student-select').value;
    const preview = document.getElementById('preview-student-info');
    if (!studentId) {
      preview.innerHTML = '<span style="color:var(--neutral-400);">No student selected</span>';
      return;
    }
    const student = this.allStudentsCache.find(s => s.id == studentId);
    if (student) {
      preview.innerHTML = `
        <div style="color:var(--primary); font-size:1rem;">👤 ${student.name}</div>
        <div style="font-size:0.8rem; color:var(--neutral-600);">${student.user_id} • ${student.department}</div>
        <div style="font-size:0.75rem; color:var(--neutral-500);">Active loans: ${student.active_loans_count} book(s)</div>
      `;
    }
  },

  updateIssueBookPreview() {
    const bookId = document.getElementById('issue-book-select').value;
    const preview = document.getElementById('preview-book-info');
    if (!bookId) {
      preview.innerHTML = '<span style="color:var(--neutral-400);">No book selected</span>';
      return;
    }
    const book = this.allBooksCache.find(b => b.id == bookId);
    if (book) {
      preview.innerHTML = `
        <div style="color:var(--primary); font-size:1rem;">📖 ${book.title}</div>
        <div style="font-size:0.8rem; color:var(--neutral-600);">${book.author} • <code>${book.isbn}</code></div>
        <div style="margin-top:0.25rem;"><span class="rack-tag">📍 ${book.rack_number}</span></div>
      `;
    }
  },

  async handleIssueSubmit(event) {
    event.preventDefault();
    const student_id = document.getElementById('issue-student-select').value;
    const book_id = document.getElementById('issue-book-select').value;
    const custom_due_date = document.getElementById('issue-due-date').value;
    const notes = document.getElementById('issue-notes').value;

    if (!student_id || !book_id || !custom_due_date) {
      this.showToast('Please select a student, book, and due date.', 'error');
      return;
    }

    try {
      const res = await API.issueBook({
        student_id: parseInt(student_id),
        book_id: parseInt(book_id),
        custom_due_date,
        notes
      });

      this.showToast(res.message, 'success');
      document.getElementById('issue-book-form').reset();
      this.setupDatePickers();
      this.navigateTo('view-return-book');
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  // =========================================================
  // VIEW: RETURN BOOK (Librarian)
  // =========================================================
  async loadReturnView() {
    try {
      const activeLoans = await API.getActiveLoans();
      this.renderReturnTable(activeLoans);
    } catch (err) {
      console.error('Failed to load active loans:', err);
      this.showToast('Failed to load returnable loans.', 'error');
    }
  },

  renderReturnTable(loans) {
    const tbody = document.getElementById('return-table-tbody');
    if (!tbody) return;

    if (loans.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 2.5rem; color: var(--neutral-500);">All books have been returned. No outstanding loans!</td></tr>`;
      return;
    }

    tbody.innerHTML = loans.map(l => {
      const isOverdue = l.status === 'overdue' || l.days_overdue > 0;
      return `
        <tr>
          <td>
            <strong>${l.student_name}</strong>
            <div style="font-size:0.75rem; color:var(--neutral-500);">${l.student_roll} • ${l.department}</div>
          </td>
          <td>
            <strong>${l.book_title}</strong>
            <div style="font-size:0.75rem; color:var(--neutral-500);"><code>${l.isbn}</code></div>
          </td>
          <td><span class="rack-tag">📍 ${l.rack_number}</span></td>
          <td>${l.issue_date}</td>
          <td><strong>${l.due_date}</strong></td>
          <td>
            ${isOverdue 
              ? `<span class="status-badge overdue">⚠️ Overdue by ${l.days_overdue} days</span>` 
              : `<span class="status-badge available">Active Loan</span>`
            }
          </td>
          <td>
            <button class="btn btn-success btn-sm" onclick="app.quickReturnBook(${l.borrow_id})">
              📥 Check In & Return
            </button>
          </td>
        </tr>
      `;
    }).join('');
  },

  async filterReturnTable() {
    const query = document.getElementById('return-search-input').value.toLowerCase().trim();
    const activeLoans = await API.getActiveLoans();
    if (!query) {
      this.renderReturnTable(activeLoans);
      return;
    }
    const filtered = activeLoans.filter(l => 
      l.student_name.toLowerCase().includes(query) ||
      l.student_roll.toLowerCase().includes(query) ||
      l.book_title.toLowerCase().includes(query) ||
      l.isbn.toLowerCase().includes(query)
    );
    this.renderReturnTable(filtered);
  },

  async quickReturnBook(borrowId) {
    if (!confirm('Confirm return of this book? Stock will be restored to Available.')) {
      return;
    }

    try {
      const res = await API.returnBook(borrowId, 'Returned by student in good condition');
      this.showToast(res.message, 'success');
      
      if (this.currentView === 'view-return-book') {
        this.loadReturnView();
      } else if (this.currentView === 'view-admin-dashboard') {
        this.loadAdminDashboard();
      } else if (this.currentView === 'view-overdue') {
        this.loadOverdueView();
      }
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  // =========================================================
  // VIEW: OVERDUE BOOKS TRACKER (Librarian)
  // =========================================================
  async loadOverdueView() {
    try {
      const overdueLoans = await API.getOverdueLoans();
      const tbody = document.getElementById('overdue-table-tbody');
      if (!tbody) return;

      if (overdueLoans.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 2.5rem; color: var(--success); font-weight: 600;">🎉 Excellent! There are no overdue books at this time.</td></tr>`;
        return;
      }

      tbody.innerHTML = overdueLoans.map(l => `
        <tr>
          <td>
            <strong>${l.student_name}</strong>
            <div style="font-size:0.75rem; color:var(--neutral-500);">${l.student_roll}</div>
          </td>
          <td>
            <div>${l.department}</div>
            <div style="font-size:0.75rem; color:var(--neutral-500);">📞 ${l.phone || 'N/A'} • ✉️ ${l.email}</div>
          </td>
          <td><strong>${l.book_title}</strong></td>
          <td><span class="rack-tag">📍 ${l.rack_number}</span></td>
          <td style="color:var(--danger); font-weight:700;">${l.due_date}</td>
          <td>
            <span class="status-badge overdue">${l.days_overdue} Days Overdue</span>
          </td>
          <td>
            <button class="btn btn-success btn-sm" onclick="app.quickReturnBook(${l.borrow_id})">📥 Process Return</button>
          </td>
        </tr>
      `).join('');
    } catch (err) {
      console.error('Failed to load overdue books:', err);
      this.showToast('Failed to fetch overdue books list.', 'error');
    }
  },

  // =========================================================
  // VIEW: BORROWING HISTORY LOG
  // =========================================================
  async loadHistory() {
    const status = document.getElementById('history-filter-status').value;
    const params = {};
    if (status && status !== 'All') params.status = status;

    try {
      const history = await API.getBorrowHistory(params);
      const tbody = document.getElementById('history-table-tbody');
      if (!tbody) return;

      if (history.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding: 2rem; color: var(--neutral-500);">No history records found.</td></tr>`;
        return;
      }

      tbody.innerHTML = history.map(h => {
        let statusBadge = `<span class="status-badge available">Returned</span>`;
        if (h.status === 'active') statusBadge = `<span class="status-badge" style="background:#eff6ff; color:#1e40af; border:1px solid #bfdbfe;">Active</span>`;
        if (h.status === 'overdue') statusBadge = `<span class="status-badge overdue">Overdue</span>`;

        return `
          <tr>
            <td><code>#TX-${h.borrow_id}</code></td>
            <td>
              <strong>${h.student_name}</strong>
              <div style="font-size:0.75rem; color:var(--neutral-500);">${h.student_roll} • ${h.department}</div>
            </td>
            <td><strong>${h.book_title}</strong></td>
            <td><span class="rack-tag">📍 ${h.rack_number}</span></td>
            <td>${h.issue_date}</td>
            <td>${h.due_date}</td>
            <td>${h.return_date || '<span style="color:var(--neutral-400);">Not returned yet</span>'}</td>
            <td>${statusBadge}</td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      console.error('Failed to load history:', err);
    }
  },

  // =========================================================
  // VIEW: REGISTERED STUDENTS DIRECTORY
  // =========================================================
  async loadStudentsDirectory() {
    try {
      const students = await API.getStudents();
      const tbody = document.getElementById('students-table-tbody');
      if (!tbody) return;

      tbody.innerHTML = students.map(s => `
        <tr>
          <td><code>${s.user_id}</code></td>
          <td><strong>${s.name}</strong></td>
          <td>${s.department}</td>
          <td>${s.email}</td>
          <td>${s.phone || '-'}</td>
          <td>
            <span class="category-badge" style="font-size: 0.8rem;">
              ${s.active_loans_count} Active Book${s.active_loans_count === 1 ? '' : 's'}
            </span>
          </td>
        </tr>
      `).join('');
    } catch (err) {
      console.error('Failed to load students:', err);
    }
  },

  // =========================================================
  // MODALS & ACTIONS
  // =========================================================

  // Shelf Locator Modal (Field-Visit Special Feature!)
  showShelfLocatorModal(title, author, rackNumber, floor, section) {
    document.getElementById('shelf-book-title').innerText = title;
    document.getElementById('shelf-book-author').innerText = `by ${author}`;
    document.getElementById('shelf-target-rack-badge').innerText = `📍 ${rackNumber}`;
    document.getElementById('shelf-floor-heading').innerText = `${floor || 'Floor 1'} — ${section || 'Main Section'}`;

    // Highlight the corresponding Bay card (e.g. Rack A-12 -> Bay A)
    const bayLetter = rackNumber.replace('Rack ', '').trim().charAt(0).toUpperCase();
    document.querySelectorAll('.bay-card').forEach(card => card.classList.remove('highlight'));
    
    const targetBay = document.getElementById(`bay-${bayLetter}`);
    if (targetBay) {
      targetBay.classList.add('highlight');
    }

    // Highlight Tier callout
    document.getElementById('target-tier-name').innerText = `📍 ${rackNumber} — Middle-Upper Shelf`;
    document.getElementById('target-tier-callout').innerText = `[${title.substring(0, 20)}...] IS LOCATED HERE`;

    this.openModal('modal-shelf-locator');
  },

  // Book Details Modal
  async viewBookDetails(bookId) {
    try {
      const book = await API.getBookById(bookId);
      const isAvailable = book.available_copies > 0;

      const body = document.getElementById('book-details-modal-body');
      body.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; margin-bottom: 1rem;">
          <div>
            <span class="category-badge">${book.category}</span>
            <h2 style="font-size: 1.35rem; margin-top: 0.35rem;">${book.title}</h2>
            <div style="color: var(--neutral-600); font-size: 0.95rem;">by <strong>${book.author}</strong></div>
          </div>
          <div>
            ${isAvailable 
              ? `<span class="status-badge available" style="font-size:0.85rem;">Available (${book.available_copies}/${book.total_copies})</span>` 
              : `<span class="status-badge issued" style="font-size:0.85rem;">Issued (0/${book.total_copies})</span>`
            }
          </div>
        </div>

        <div class="card" style="background: var(--neutral-50); margin-bottom: 1.25rem;">
          <h4 style="font-size: 0.9rem; margin-bottom: 0.6rem; color: var(--neutral-700);">📌 Library Shelf & Catalog Details</h4>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; font-size: 0.85rem;">
            <div><strong>ISBN:</strong> <code>${book.isbn}</code></div>
            <div><strong>Rack ID:</strong> <span class="rack-tag">📍 ${book.rack_number}</span></div>
            <div><strong>Floor:</strong> ${book.floor || 'Floor 1'}</div>
            <div><strong>Section:</strong> ${book.section || 'General Bay'}</div>
          </div>
        </div>

        <button class="btn btn-outline" style="width: 100%; margin-bottom: 1.25rem;" onclick="app.showShelfLocatorModal('${book.title.replace(/'/g, "\\'")}', '${book.author.replace(/'/g, "\\'")}', '${book.rack_number}', '${book.floor}', '${book.section}')">
          🗺️ Open Physical Shelf Locator Map
        </button>

        ${book.activeLoans && book.activeLoans.length > 0 && this.currentUser && this.currentUser.role === 'librarian' ? `
          <div style="border-top: 1px solid var(--neutral-200); padding-top: 1rem;">
            <h4 style="font-size: 0.9rem; margin-bottom: 0.5rem; color: var(--neutral-700);">👥 Current Borrowers:</h4>
            <div style="display: flex; flex-direction: column; gap: 0.4rem; font-size: 0.825rem;">
              ${book.activeLoans.map(l => `
                <div style="padding: 0.5rem; background: var(--neutral-100); border-radius: var(--radius-sm); display: flex; justify-content: space-between;">
                  <span><strong>${l.student_name}</strong> (${l.student_roll})</span>
                  <span>Due: <strong>${l.due_date}</strong></span>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}
      `;

      this.openModal('modal-book-details');
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  // Add / Edit Book Modal
  async openBookModal(bookId = null) {
    const titleEl = document.getElementById('book-form-title');
    const form = document.getElementById('book-edit-form');
    form.reset();

    if (bookId) {
      titleEl.innerText = '✏️ Edit Book Details';
      try {
        const book = await API.getBookById(bookId);
        document.getElementById('book-form-id').value = book.id;
        document.getElementById('book-form-title-input').value = book.title;
        document.getElementById('book-form-author').value = book.author;
        document.getElementById('book-form-isbn').value = book.isbn;
        document.getElementById('book-form-category').value = book.category;
        document.getElementById('book-form-rack').value = book.rack_number;
        document.getElementById('book-form-copies').value = book.total_copies;
        document.getElementById('book-form-floor').value = book.floor || 'Floor 1';
        document.getElementById('book-form-section').value = book.section || 'General Bay';
      } catch (err) {
        this.showToast(err.message, 'error');
        return;
      }
    } else {
      titleEl.innerText = '➕ Add New Book to Collection';
      document.getElementById('book-form-id').value = '';
    }

    this.openModal('modal-book-form');
  },

  async handleSaveBook(event) {
    event.preventDefault();
    const id = document.getElementById('book-form-id').value;
    const bookData = {
      title: document.getElementById('book-form-title-input').value.trim(),
      author: document.getElementById('book-form-author').value.trim(),
      isbn: document.getElementById('book-form-isbn').value.trim(),
      category: document.getElementById('book-form-category').value.trim(),
      rack_number: document.getElementById('book-form-rack').value.trim(),
      total_copies: parseInt(document.getElementById('book-form-copies').value) || 1,
      floor: document.getElementById('book-form-floor').value,
      section: document.getElementById('book-form-section').value.trim()
    };

    try {
      if (id) {
        const res = await API.updateBook(id, bookData);
        this.showToast(res.message, 'success');
      } else {
        const res = await API.addBook(bookData);
        this.showToast(res.message, 'success');
      }

      this.closeModal('modal-book-form');
      if (this.currentView === 'view-catalog') {
        this.fetchAndRenderBooks();
      } else {
        this.loadAdminDashboard();
      }
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  async handleDeleteBook(bookId, bookTitle) {
    if (!confirm(`Are you sure you want to delete "${bookTitle}"?`)) {
      return;
    }

    try {
      const res = await API.deleteBook(bookId);
      this.showToast(res.message, 'success');
      this.fetchAndRenderBooks();
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  },

  // Modal Generic Helpers
  openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.add('active');
  },

  closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('active');
  },

  // Toast Notification System
  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'error') icon = '⚠️';

    toast.innerHTML = `<span>${icon}</span> <div>${message}</div>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'slideInRight 0.3s ease reverse forwards';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }
};

// Initialize Application on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  app.init();
});
