class API {
  constructor() {
    this.baseUrl = '/api';
    this.token = localStorage.getItem('token');
  }

  setToken(token) {
    this.token = token;
    localStorage.setItem('token', token);
  }

  getHeaders() {
    return {
      'Content-Type': 'application/json',
      ...(this.token && { 'Authorization': `Bearer ${this.token}` })
    };
  }

  async request(endpoint, options = {}) {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers: this.getHeaders()
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Request failed');
    }

    return response.json();
  }

  // Auth endpoints
  async register(name, email, password, confirmPassword) {
    return this.request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password, confirmPassword })
    });
  }

  async login(email, password) {
    return this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
  }

  async getMe() {
    return this.request('/auth/me');
  }

  // Booking endpoints
  async getBookingsForDate(date) {
    return this.request(`/bookings/date/${date}`);
  }

  async getCalendarMonth(month, year) {
    return this.request(`/bookings/calendar/${month}/${year}`);
  }

  async createBooking(date, slots, name, type, description) {
    return this.request('/bookings', {
      method: 'POST',
      body: JSON.stringify({ date, slots, name, type, description })
    });
  }

  async getMyBookings() {
    return this.request('/bookings/my-bookings');
  }

  async getAllBookings() {
    return this.request('/bookings/admin/all');
  }

  async getStats() {
    return this.request('/bookings/admin/stats');
  }

  async cancelBooking(id) {
    return this.request(`/bookings/${id}`, {
      method: 'DELETE'
    });
  }
}

const api = new API();
