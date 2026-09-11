let currentUser = null;

function showScreen(name) {
  document.getElementById('screenLogin').classList.toggle('hidden', name !== 'login');
  document.getElementById('screenRegister').classList.toggle('hidden', name !== 'register');
  document.getElementById('screenApp').classList.toggle('hidden', name !== 'app');
}

function setError(elementId, message) {
  const el = document.getElementById(elementId);
  el.textContent = message;
  el.classList.add('show');
}

function clearError(elementId) {
  const el = document.getElementById(elementId);
  el.classList.remove('show');
}

// Navigation between screens
document.getElementById('goRegister').addEventListener('click', () => {
  clearError('loginError');
  showScreen('register');
});

document.getElementById('goLogin').addEventListener('click', () => {
  clearError('regError');
  showScreen('login');
});

// Register
document.getElementById('regBtn').addEventListener('click', async () => {
  const name = document.getElementById('regName').value.trim();
  const email = document.getElementById('regEmail').value.trim().toLowerCase();
  const password = document.getElementById('regPassword').value;
  const confirm = document.getElementById('regConfirm').value;

  clearError('regError');

  if (!name || !email || !password || !confirm) {
    setError('regError', 'Fill in every field.');
    return;
  }

  if (!/^\S+@\S+\.\S+$/.test(email)) {
    setError('regError', 'Enter a valid email address.');
    return;
  }

  if (password.length < 6) {
    setError('regError', 'Password needs at least 6 characters.');
    return;
  }

  if (password !== confirm) {
    setError('regError', 'Passwords do not match.');
    return;
  }

  const btn = document.getElementById('regBtn');
  btn.disabled = true;
  btn.textContent = 'Creating account…';

  try {
    const result = await api.register(name, email, password, confirm);
    currentUser = result.user;
    api.setToken(result.token);
    await enterApp();
  } catch (err) {
    setError('regError', err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create account';
  }
});

// Login
document.getElementById('loginBtn').addEventListener('click', async () => {
  const email = document.getElementById('loginEmail').value.trim().toLowerCase();
  const password = document.getElementById('loginPassword').value;

  clearError('loginError');

  if (!email || !password) {
    setError('loginError', 'Enter your email and password.');
    return;
  }

  const btn = document.getElementById('loginBtn');
  btn.disabled = true;
  btn.textContent = 'Signing in…';

  try {
    console.log('Attempting login with:', email);
    const result = await api.login(email, password);
    console.log('Login successful:', result);
    currentUser = result.user;
    api.setToken(result.token);
    console.log('Calling enterApp...');
    await enterApp();
    console.log('enterApp completed');
  } catch (err) {
    console.error('Login error:', err);
    setError('loginError', err.message || 'Login failed');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sign in';
  }
});

// Logout
document.getElementById('logoutBtn').addEventListener('click', () => {
  currentUser = null;
  api.setToken(null);
  localStorage.removeItem('token');
  storage.clear();
  
  document.getElementById('loginEmail').value = '';
  document.getElementById('loginPassword').value = '';
  document.getElementById('regName').value = '';
  document.getElementById('regEmail').value = '';
  document.getElementById('regPassword').value = '';
  document.getElementById('regConfirm').value = '';
  
  showScreen('login');
});

async function enterApp() {
  document.getElementById('whoName').textContent = currentUser.name;
  document.getElementById('whoRole').textContent = currentUser.role;
  document.getElementById('adminTabBtn').classList.toggle('hidden', currentUser.role !== 'admin');
  
  showScreen('app');
  switchTab('calendar');
  
  // Load bookings and render calendar
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  
  try {
    const result = await api.getCalendarMonth(month, year);
    result.dates.forEach(d => {
      api.getBookingsForDate(d.date).then(r => {
        storage.setBookings(d.date, r.bookings);
      });
    });
  } catch (err) {
    console.error('Failed to load bookings:', err);
  }
  
  renderCalendar();
}

// Check if user is already logged in
window.addEventListener('load', async () => {
  console.log('Page loaded, checking for token...');
  const token = localStorage.getItem('token');
  console.log('Token:', token ? 'Found' : 'Not found');
  
  if (token) {
    try {
      api.setToken(token);
      console.log('Verifying token...');
      const result = await api.getMe();
      console.log('Token verified, user:', result.user.email);
      currentUser = result.user;
      await enterApp();
    } catch (err) {
      console.error('Token invalid:', err.message);
      localStorage.removeItem('token');
      showScreen('login');
    }
  } else {
    console.log('No token found, showing login');
    showScreen('login');
  }
});
