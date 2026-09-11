let currentUser = null;

function showScreen(name) {
  document.getElementById('screenLogin').classList.toggle('hidden', name !== 'login');
  document.getElementById('screenRegister').classList.toggle('hidden', name !== 'register');
  document.getElementById('screenNewPassword').classList.toggle('hidden', name !== 'newPassword');
  document.getElementById('screenApp').classList.toggle('hidden', name !== 'app');
}

function setError(elementId, message) {
  const el = document.getElementById(elementId);
  el.textContent = message;
  el.classList.add('show');
}

function clearError(elementId) {
  const el = document.getElementById(elementId);
  el.textContent = '';
  el.classList.remove('show');
}

function clearAuthInputs() {
  ['loginEmail', 'loginPassword', 'regName', 'regEmail', 'regPassword', 'regConfirm'].forEach(
    id => {
      document.getElementById(id).value = '';
    }
  );
}

// Navigation between screens
document.getElementById('goRegister').addEventListener('click', () => {
  clearError('loginError');
  showScreen('register');
  document.getElementById('regName').focus();
});

document.getElementById('goLogin').addEventListener('click', () => {
  clearError('regError');
  showScreen('login');
  document.getElementById('loginEmail').focus();
});

// Register
async function submitRegister() {
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
  // Same rule the server enforces, so the form never accepts something the
  // API will then reject. Defined in account.js.
  const problem = passwordProblem(password);
  if (problem) {
    setError('regError', problem);
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
    api.setToken(result.token);
    currentUser = result.user;
    clearAuthInputs();
    await enterApp();
  } catch (err) {
    setError('regError', err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create account';
  }
}

// Login
async function submitLogin() {
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
    const result = await api.login(email, password);
    api.setToken(result.token);
    currentUser = result.user;
    clearAuthInputs();

    // A seeded or reset account must replace its temporary password first.
    if (currentUser.mustChangePassword) {
      showNewPasswordScreen(currentUser);
      return;
    }
    await enterApp();
  } catch (err) {
    setError('loginError', err.message || 'Login failed');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sign in';
  }
}

// Real <form> elements, so Enter submits and password managers can offer to
// save the credentials. novalidate keeps our own messages in charge.
document.getElementById('loginForm').addEventListener('submit', e => {
  e.preventDefault();
  submitLogin();
});

document.getElementById('registerForm').addEventListener('submit', e => {
  e.preventDefault();
  submitRegister();
});

function logout(message) {
  currentUser = null;
  api.clearToken();
  storage.clear();
  clearAuthInputs();
  closePanel();
  closeAccount();
  showScreen('login');
  if (message) setError('loginError', message);
}

document.getElementById('logoutBtn').addEventListener('click', () => logout());

// An expired or revoked token anywhere in the app returns the user to login
// instead of leaving them on a screen where nothing works.
api.onUnauthorized = () => {
  if (!currentUser) return;
  logout('Your session expired. Please sign in again.');
};

async function enterApp() {
  document.getElementById('whoName').textContent = currentUser.name;
  document.getElementById('whoRole').textContent = currentUser.role;
  document.getElementById('adminTabBtn').classList.toggle('hidden', !isAdminRole(currentUser.role));
  document.getElementById('usersTabBtn').classList.toggle('hidden', !isSuperAdminRole(currentUser.role));

  showScreen('app');
  switchTab('calendar');

  currentDate = new Date();
  currentDate.setDate(1);
  await loadMonth(currentDate.getFullYear(), currentDate.getMonth());
}

// Restore an existing session on page load.
window.addEventListener('load', async () => {
  const token = localStorage.getItem('token');

  if (!token) {
    showScreen('login');
    return;
  }

  api.setToken(token);
  try {
    const result = await api.getMe();
    currentUser = result.user;

    if (currentUser.mustChangePassword) {
      showNewPasswordScreen(currentUser);
      return;
    }
    await enterApp();
  } catch (err) {
    api.clearToken();
    showScreen('login');
  }
});
