// Super admin only: view every account, promote/demote admins, remove accounts.

const ROLE_LABELS = {
  superadmin: 'Super admin',
  admin: 'Admin',
  client: 'Client'
};

async function renderUsers() {
  const list = document.getElementById('usersList');
  list.innerHTML = `<div class="list-empty">Loading…</div>`;

  try {
    const result = await api.getUsers();
    const users = result.users || [];

    list.innerHTML = '';

    if (users.length === 0) {
      list.innerHTML = `<div class="list-empty">No accounts yet.</div>`;
      return;
    }

    users.forEach(u => list.appendChild(buildUserCard(u)));
  } catch (err) {
    console.error('Could not load users:', err);
    list.innerHTML = `<div class="list-empty">${escapeHtml(
      err.message || 'Failed to load users'
    )}</div>`;
  }
}

function buildUserCard(user) {
  const card = document.createElement('div');
  card.className = 'user-card';

  const isSuper = user.role === 'superadmin';
  const isSelf = currentUser && user.id === currentUser.id;
  const bookings = Number(user.booking_count) || 0;

  const main = document.createElement('div');
  main.className = 'uc-main';
  main.innerHTML = `
    <div class="uc-name">${escapeHtml(user.name)}${
      isSelf ? '<span class="uc-you">you</span>' : ''
    }</div>
    <div class="uc-email">${escapeHtml(user.email)}</div>
    <div class="uc-meta">
      <span class="uc-role ${escapeHtml(user.role)}">${escapeHtml(
        ROLE_LABELS[user.role] || user.role
      )}</span>
      <span class="uc-bookings">${bookings} booking${bookings === 1 ? '' : 's'}</span>
    </div>
  `;
  card.appendChild(main);

  const actions = document.createElement('div');
  actions.className = 'uc-actions';

  if (isSuper) {
    // The seeded studio account is deliberately immutable from the UI.
    const locked = document.createElement('span');
    locked.className = 'uc-locked';
    locked.textContent = 'Protected';
    locked.title = 'The super admin account cannot be demoted or removed.';
    actions.appendChild(locked);
  } else {
    const target = user.role === 'admin' ? 'client' : 'admin';
    const roleBtn = document.createElement('button');
    roleBtn.className = 'uc-btn';
    roleBtn.textContent = user.role === 'admin' ? 'Demote to client' : 'Make admin';

    roleBtn.addEventListener('click', async () => {
      const verb = target === 'admin' ? 'Make admin' : 'Demote to client';
      if (!confirm(`${verb}: ${user.name} (${user.email})?`)) return;

      roleBtn.disabled = true;
      roleBtn.textContent = '…';

      try {
        const res = await api.setUserRole(user.id, target);
        showToast(res.message || 'Role updated');
        await renderUsers();
      } catch (err) {
        showToast(err.message);
        roleBtn.disabled = false;
        roleBtn.textContent = verb;
      }
    });
    actions.appendChild(roleBtn);

    const resetBtn = document.createElement('button');
    resetBtn.className = 'uc-btn';
    resetBtn.textContent = 'Reset password';

    resetBtn.addEventListener('click', async () => {
      if (!confirm(`Reset the password for ${user.name}? Their current password stops working immediately.`)) return;

      resetBtn.disabled = true;
      resetBtn.textContent = '…';

      try {
        const res = await api.resetUserPassword(user.id);
        showTemporaryPassword(card, user, res.temporaryPassword);
        showToast(res.message || 'Password reset');
      } catch (err) {
        showToast(err.message);
      } finally {
        resetBtn.disabled = false;
        resetBtn.textContent = 'Reset password';
      }
    });
    actions.appendChild(resetBtn);

    if (!isSelf) {
      const delBtn = document.createElement('button');
      delBtn.className = 'uc-btn danger';
      delBtn.textContent = 'Remove';

      delBtn.addEventListener('click', async () => {
        const warning = bookings
          ? `Remove ${user.name}? Their ${bookings} booking${
              bookings === 1 ? '' : 's'
            } will be cancelled too. This cannot be undone.`
          : `Remove ${user.name}? This cannot be undone.`;
        if (!confirm(warning)) return;

        delBtn.disabled = true;
        delBtn.textContent = '…';

        try {
          const res = await api.deleteUser(user.id);
          showToast(res.message || 'Account removed');
          await renderUsers();
          // Their bookings are gone, so anything showing them is now stale.
          storage.clear();
          await loadMonth(currentDate.getFullYear(), currentDate.getMonth());
        } catch (err) {
          showToast(err.message);
          delBtn.disabled = false;
          delBtn.textContent = 'Remove';
        }
      });
      actions.appendChild(delBtn);
    }
  }

  if (Number(user.must_change_password)) {
    const pending = document.createElement('span');
    pending.className = 'uc-pending';
    pending.textContent = 'Must set password';
    main.querySelector('.uc-meta').appendChild(pending);
  }

  card.appendChild(actions);
  return card;
}

// The temporary password is returned once and never stored in plain text, so
// it is shown inline until the panel is re-rendered.
function showTemporaryPassword(card, user, password) {
  card.querySelector('.temp-pass')?.remove();

  const box = document.createElement('div');
  box.className = 'temp-pass';
  box.style.flexBasis = '100%';

  const label = document.createElement('div');
  label.className = 'tp-label';
  label.textContent = `Temporary password for ${user.email}`;

  const value = document.createElement('div');
  value.className = 'tp-value';
  value.textContent = password;

  const note = document.createElement('div');
  note.className = 'tp-note';
  note.textContent =
    'Shown once — copy it now and give it to them. They must set their own password at the next sign-in.';

  box.append(label, value, note);
  card.appendChild(box);
}
