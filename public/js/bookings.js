function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => {
    const active = b.dataset.tab === name;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', String(active));
  });

  document.getElementById('paneCalendar').classList.toggle('hidden', name !== 'calendar');
  document.getElementById('paneMine').classList.toggle('hidden', name !== 'mine');
  document.getElementById('paneAdmin').classList.toggle('hidden', name !== 'admin');
  document.getElementById('paneUsers').classList.toggle('hidden', name !== 'users');

  if (name === 'mine') renderMyBookings();
  if (name === 'admin') renderAdminPanel();
  if (name === 'users') renderUsers();
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', e => {
    const target = e.currentTarget;
    if (!target.classList.contains('hidden')) switchTab(target.dataset.tab);
  });
});

async function renderMyBookings() {
  const mineList = document.getElementById('mineList');
  mineList.innerHTML = `<div class="list-empty">Loading…</div>`;

  try {
    const result = await api.getMyBookings();
    const bookings = result.bookings || [];

    mineList.innerHTML = '';

    if (bookings.length === 0) {
      mineList.innerHTML = `<div class="list-empty">You haven't booked any shoots yet — head to "Book a shoot" to reserve a slot.</div>`;
      return;
    }

    const { upcoming, past } = splitByDate(bookings);

    if (upcoming.length) {
      mineList.appendChild(listHeading(`Upcoming (${upcoming.length})`));
      upcoming.forEach(b => mineList.appendChild(buildBookingCard(b, true)));
    }
    if (past.length) {
      mineList.appendChild(listHeading(`Past (${past.length})`));
      past.forEach(b => mineList.appendChild(buildBookingCard(b, true)));
    }
  } catch (err) {
    console.error('Could not load your bookings:', err);
    mineList.innerHTML = `<div class="list-empty">${escapeHtml(
      err.message || 'Failed to load bookings'
    )}</div>`;
  }
}

function listHeading(text) {
  const h = document.createElement('div');
  h.className = 'list-heading';
  h.textContent = text;
  return h;
}

function todayKeyLocal() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}`;
}

function splitByDate(bookings) {
  const today = todayKeyLocal();
  const upcoming = bookings
    .filter(b => b.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date));
  const past = bookings.filter(b => b.date < today).sort((a, b) => b.date.localeCompare(a.date));
  return { upcoming, past };
}

function buildBookingCard(booking, isMineView = false) {
  const card = document.createElement('div');
  card.className = 'booking-card';

  const dt = new Date(booking.date + 'T00:00:00');
  const dateStr = Number.isNaN(dt.getTime())
    ? booking.date
    : dt.toLocaleDateString('default', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric'
      });

  const isPast = booking.date < todayKeyLocal();

  const main = document.createElement('div');
  main.className = 'bc-main';

  // The server has no "label" column — derive the time range from the slots.
  // Previously this read booking.label and every card just said "Booking".
  let html = `
    <div class="bc-date">${escapeHtml(dateStr)}${
      isPast ? '<span class="bc-past">past</span>' : ''
    }</div>
    <div class="bc-meta">${escapeHtml(slotsLabel(booking.slots))}</div>
  `;

  if (!isMineView) {
    html += `<div class="bc-owner">${escapeHtml(booking.booked_by_name)} · ${escapeHtml(
      booking.booked_by_email
    )}</div>`;
  }

  html += `
    <div class="bc-type">${escapeHtml(booking.type)}</div>
    <div class="bc-desc">${escapeHtml(booking.description)}</div>
  `;

  main.innerHTML = html;
  card.appendChild(main);

  const canCancel =
    currentUser && (isAdminRole(currentUser.role) || booking.booked_by_email === currentUser.email);

  if (canCancel) {
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'bc-cancel';
    cancelBtn.textContent = 'Cancel';

    cancelBtn.addEventListener('click', async () => {
      if (!confirm('Cancel this booking? This cannot be undone.')) return;

      cancelBtn.disabled = true;
      cancelBtn.textContent = '…';

      try {
        await api.cancelBooking(booking.id);
        storage.removeBooking(booking.id);
        showToast('Booking cancelled');
        // Refresh whichever list we are looking at, plus the calendar.
        if (isMineView) await renderMyBookings();
        else await renderAdminPanel();
        renderCalendar();
      } catch (err) {
        showToast(err.message);
        cancelBtn.disabled = false;
        cancelBtn.textContent = 'Cancel';
      }
    });

    card.appendChild(cancelBtn);
  }

  return card;
}
