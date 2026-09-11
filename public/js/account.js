// Account panel, forced first-sign-in password change, and the shared
// show/hide + strength-meter behaviour for every password field.

const STRENGTH_WORDS = ['Too weak', 'Weak', 'Fair', 'Good', 'Strong'];

// Mirrors validatePassword() on the server, so the UI never promises something
// the API will reject.
function passwordProblem(value) {
  if (typeof value !== 'string' || value.length < 8) {
    return 'Password must be at least 8 characters.';
  }
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(re => re.test(value)).length;
  if (classes < 2) {
    return 'Mix at least two of: lowercase, uppercase, numbers, symbols.';
  }
  return null;
}

function scorePassword(value) {
  if (!value) return 0;
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(re => re.test(value)).length;
  let score = 0;
  if (value.length >= 8) score += 1;
  if (value.length >= 12) score += 1;
  if (classes >= 2) score += 1;
  if (classes >= 3 && value.length >= 10) score += 1;
  return Math.min(score, 4);
}

function wireStrengthMeter(inputId, meterId, hintId) {
  const input = document.getElementById(inputId);
  const meter = document.getElementById(meterId);
  const hint = document.getElementById(hintId);
  if (!input || !meter || !hint) return;

  input.addEventListener('input', () => {
    const value = input.value;
    const score = scorePassword(value);

    meter.querySelectorAll('i').forEach((bar, i) => {
      bar.className = i < score ? `on s${score}` : '';
    });

    if (!value) {
      hint.textContent = '';
      hint.className = 'pw-hint';
      return;
    }

    const problem = passwordProblem(value);
    hint.textContent = problem || STRENGTH_WORDS[score];
    hint.className = 'pw-hint' + (problem ? ' warn' : score >= 3 ? ' good' : '');
  });
}

// One delegated handler covers every show/hide button on the page.
document.addEventListener('click', e => {
  const btn = e.target.closest('.pw-toggle');
  if (!btn) return;

  const input = document.getElementById(btn.dataset.target);
  if (!input) return;

  const reveal = input.type === 'password';
  input.type = reveal ? 'text' : 'password';
  btn.textContent = reveal ? 'hide' : 'show';
  btn.setAttribute('aria-label', reveal ? 'Hide password' : 'Show password');
  input.focus();
});

wireStrengthMeter('npNew', 'npMeter', 'npHint');
wireStrengthMeter('acNew', 'acMeter', 'acHint');
wireStrengthMeter('regPassword', 'regMeter', 'regHint');

// ── Forced password change ──────────────────────────────────────────────────

// Confirms with the server before trapping anyone here. If the account does
// not actually owe a password change — the flag was cleared in another tab, an
// admin reset it, or the page is running stale code — go straight to the app
// instead of showing a screen the user cannot get past.
async function showNewPasswordScreen(user) {
  try {
    const fresh = await api.getMe();
    if (!fresh.user.mustChangePassword) {
      currentUser = fresh.user;
      await enterApp();
      return;
    }
    user = fresh.user;
  } catch (_) {
    // Offline or the token is bad; fall through and let them try.
  }

  document.getElementById('newPasswordSub').textContent =
    `Signed in as ${user.email}. Set a password of your own before continuing.`;
  ['npCurrent', 'npNew', 'npConfirm'].forEach(id => {
    document.getElementById(id).value = '';
  });
  clearError('npError');
  showScreen('newPassword');
  document.getElementById('npCurrent').focus();
}

document.getElementById('newPasswordForm').addEventListener('submit', async e => {
  e.preventDefault();

  const current = document.getElementById('npCurrent').value;
  const next = document.getElementById('npNew').value;
  const confirmValue = document.getElementById('npConfirm').value;

  clearError('npError');

  if (!current) return setError('npError', 'Enter the temporary password you were given.');

  const problem = passwordProblem(next);
  if (problem) return setError('npError', problem);
  if (next !== confirmValue) return setError('npError', 'The new passwords do not match.');
  if (next === current) return setError('npError', 'Choose a password different from the temporary one.');

  const btn = document.getElementById('npBtn');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    const result = await api.changePassword(current, next, confirmValue);
    if (result.token) api.setToken(result.token);
    currentUser = result.user;
    showToast('Password saved');
    await enterApp();
  } catch (err) {
    setError('npError', err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save password';
  }
});

document.getElementById('npLogout').addEventListener('click', () => logout());
document.getElementById('npLogout').addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    logout();
  }
});

// ── Account panel ───────────────────────────────────────────────────────────

function openAccount() {
  document.getElementById('accountWho').textContent = `${currentUser.email} · ${currentUser.role}`;
  // Gives the password manager something to key the saved entry on.
  document.getElementById('acUsername').value = currentUser.email;
  document.getElementById('acName').value = currentUser.name || '';
  ['acCurrent', 'acNew', 'acConfirm'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('acHint').textContent = '';
  document.getElementById('acMeter').querySelectorAll('i').forEach(b => (b.className = ''));
  clearError('acError');

  document.getElementById('accountOverlay').classList.add('show');
  document.getElementById('accountPanel').classList.add('show');
  document.getElementById('accountClose').focus();
}

function closeAccount() {
  document.getElementById('accountOverlay').classList.remove('show');
  document.getElementById('accountPanel').classList.remove('show');
}

document.getElementById('accountBtn').addEventListener('click', openAccount);
document.getElementById('accountClose').addEventListener('click', closeAccount);
document.getElementById('accountOverlay').addEventListener('click', closeAccount);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeAccount();
});

document.getElementById('profileForm').addEventListener('submit', async e => {
  e.preventDefault();

  const name = document.getElementById('acName').value.trim();
  clearError('acError');
  if (!name) return setError('acError', 'Enter a name.');
  if (name === currentUser.name) return showToast('That is already your name');

  const btn = document.getElementById('acNameBtn');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    const result = await api.updateProfile(name);
    if (result.token) api.setToken(result.token);
    currentUser = result.user;
    document.getElementById('whoName').textContent = currentUser.name;
    showToast('Name updated');
  } catch (err) {
    setError('acError', err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save name';
  }
});

document.getElementById('passwordForm').addEventListener('submit', async e => {
  e.preventDefault();

  const current = document.getElementById('acCurrent').value;
  const next = document.getElementById('acNew').value;
  const confirmValue = document.getElementById('acConfirm').value;

  clearError('acError');

  if (!current) return setError('acError', 'Enter your current password.');

  const problem = passwordProblem(next);
  if (problem) return setError('acError', problem);
  if (next !== confirmValue) return setError('acError', 'The new passwords do not match.');
  if (next === current) return setError('acError', 'The new password must be different.');

  const btn = document.getElementById('acPwBtn');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    const result = await api.changePassword(current, next, confirmValue);
    if (result.token) api.setToken(result.token);
    if (result.user) currentUser = result.user;

    ['acCurrent', 'acNew', 'acConfirm'].forEach(id => {
      document.getElementById(id).value = '';
    });
    document.getElementById('acHint').textContent = '';
    document.getElementById('acMeter').querySelectorAll('i').forEach(b => (b.className = ''));

    showToast('Password updated');
    closeAccount();
  } catch (err) {
    setError('acError', err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Update password';
  }
});
