class API {
  constructor() {
    this.baseUrl = '/api';
    this.token = localStorage.getItem('token') || null;
    // Set by auth.js so an expired session can bounce the user back to login.
    this.onUnauthorized = null;
  }

  setToken(token) {
    if (!token) return this.clearToken();
    this.token = token;
    localStorage.setItem('token', token);
  }

  clearToken() {
    this.token = null;
    localStorage.removeItem('token');
  }

  getHeaders(hasBody) {
    return {
      ...(hasBody && { 'Content-Type': 'application/json' }),
      ...(this.token && { Authorization: `Bearer ${this.token}` })
    };
  }

  async request(endpoint, options = {}) {
    let response;
    try {
      response = await fetch(`${this.baseUrl}${endpoint}`, {
        ...options,
        headers: { ...this.getHeaders(options.body !== undefined), ...(options.headers || {}) }
      });
    } catch (_) {
      // fetch only rejects on a network-level failure.
      throw new Error('Cannot reach the server. Check your connection and try again.');
    }

    // A proxy or crash can return HTML, so never assume the body parses.
    const raw = await response.text();
    let data = null;
    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch (_) {
        data = null;
      }
    }

    if (!response.ok) {
      // Only a token failure ends the session. A 401 from, say, mistyping your
      // current password on the change-password form must not log you out.
      const isTokenFailure = response.status === 401 && data && data.code === 'invalid_token';
      if (isTokenFailure && this.token && typeof this.onUnauthorized === 'function') {
        this.onUnauthorized();
      }
      const error = new Error((data && data.error) || `Request failed (${response.status})`);
      error.status = response.status;
      error.code = data && data.code;
      throw error;
    }

    return data ?? {};
  }

  // Auth endpoints
  register(name, email, password, confirmPassword) {
    return this.request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password, confirmPassword })
    });
  }

  login(email, password) {
    return this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
  }

  getMe() {
    return this.request('/auth/me');
  }

  changePassword(currentPassword, newPassword, confirmPassword) {
    return this.request('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword, confirmPassword })
    });
  }

  // Booking endpoints
  getBookingsForDate(date) {
    return this.request(`/bookings/date/${encodeURIComponent(date)}`);
  }

  getCalendarMonth(month, year) {
    return this.request(`/bookings/calendar/${month}/${year}`);
  }

  createBooking(date, slots, name, type, description) {
    return this.request('/bookings', {
      method: 'POST',
      body: JSON.stringify({ date, slots, name, type, description })
    });
  }

  getMyBookings() {
    return this.request('/bookings/my-bookings');
  }

  getAllBookings() {
    return this.request('/bookings/admin/all');
  }

  getStats() {
    return this.request('/bookings/admin/stats');
  }

  cancelBooking(id) {
    return this.request(`/bookings/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  updateProfile(name) {
    return this.request('/auth/profile', {
      method: 'PATCH',
      body: JSON.stringify({ name })
    });
  }

  getConfig() {
    return this.request('/config');
  }

  // User management (super admin only)
  getUsers() {
    return this.request('/users');
  }

  setUserRole(id, role) {
    return this.request(`/users/${encodeURIComponent(id)}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role })
    });
  }

  resetUserPassword(id) {
    return this.request(`/users/${encodeURIComponent(id)}/reset-password`, { method: 'POST' });
  }

  deleteUser(id) {
    return this.request(`/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  // Mail diagnostics (super admin only)
  mailStatus() {
    return this.request('/mail/status');
  }

  sendTestDigest() {
    return this.request('/mail/digest', { method: 'POST' });
  }

  health() {
    return this.request('/health');
  }
}

const api = new API();
