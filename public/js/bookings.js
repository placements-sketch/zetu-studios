function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === name);
  });

  document.getElementById('paneCalendar').classList.toggle('hidden', name !== 'calendar');
  document.getElementById('paneMine').classList.toggle('hidden', name !== 'mine');
  document.getElementById('paneAdmin').classList.toggle('hidden', name !== 'admin');

  if (name === 'mine') renderMyBookings();
  if (name === 'admin') renderAdminPanel();
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    const btn = e.target.closest('.tab-btn');
    if (btn && !btn.classList.contains('hidden')) {
      switchTab(btn.dataset.tab);
    }
  });
});

async function renderMyBookings() {
  const mineList = document.getElementById('mineList');
  mineList.innerHTML = '';

  try {
    const result = await api.getMyBookings();
    const bookings = result.bookings;

    if (bookings.length === 0) {
      mineList.innerHTML = `<div class="list-empty">You haven't booked any shoots yet — head to "Book a shoot" to reserve a slot.</div>`;
      return;
    }

    bookings.forEach(b => {
      mineList.appendChild(buildBookingCard(b, true));
    });
  } catch (err) {
    mineList.innerHTML = `<div class="list-empty">Failed to load bookings</div>`;
  }
}

function buildBookingCard(booking, isMinView = false) {
  const card = document.createElement('div');
  card.className = 'booking-card';

  const dt = new Date(booking.date + 'T00:00:00');
  const dateStr = dt.toLocaleDateString('default', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });

  const main = document.createElement('div');
  main.className = 'bc-main';
  
  let html = `
    <div class="bc-date">${dateStr}</div>
    <div class="bc-meta">${escapeHtml(booking.label || 'Booking')}</div>
  `;

  if (!isMinView) {
    html += `<div class="bc-owner">${escapeHtml(booking.booked_by_name)} · ${escapeHtml(booking.booked_by_email)}</div>`;
  }

  html += `
    <div class="bc-type">${escapeHtml(booking.type)}</div>
    <div class="bc-desc">${escapeHtml(booking.description)}</div>
  `;

  main.innerHTML = html;
  card.appendChild(main);

  const canCancel = currentUser.role === 'admin' || booking.booked_by_email === currentUser.email;
  if (canCancel) {
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'bc-cancel';
    cancelBtn.textContent = 'Cancel';
    
    cancelBtn.addEventListener('click', async () => {
      if (!confirm('Are you sure you want to cancel this booking?')) return;
      
      cancelBtn.disabled = true;
      cancelBtn.textContent = '…';

      try {
        await api.cancelBooking(booking.id);
        showToast('Booking cancelled');
        renderMyBookings();
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
