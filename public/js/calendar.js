let currentDate = new Date();
currentDate.setDate(1);
let selectedDateKey = null;
let isLoadingMonth = false;

function dateKey(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// Fetches every booked date in a month, then renders. Month navigation used to
// re-render without fetching, so any month but the first looked empty.
async function loadMonth(year, monthIndex) {
  isLoadingMonth = true;
  renderCalendar();

  try {
    const result = await api.getCalendarMonth(monthIndex + 1, year);
    const dates = result.dates || [];

    const loaded = await Promise.all(
      dates.map(d =>
        api
          .getBookingsForDate(d.date)
          .then(r => ({ date: d.date, bookings: r.bookings }))
          .catch(() => null)
      )
    );

    loaded.forEach(entry => {
      if (entry) storage.setBookings(entry.date, entry.bookings);
    });

    // A month with no bookings still needs to be marked as loaded so the cells
    // render as empty rather than as "not fetched yet".
    storage.markMonthLoaded(year, monthIndex);
  } catch (err) {
    showToast('Could not load this month’s bookings');
  } finally {
    isLoadingMonth = false;
    renderCalendar();
  }
}

function renderCalendar() {
  const y = currentDate.getFullYear();
  const m = currentDate.getMonth();

  document.getElementById('monthLabel').textContent = currentDate.toLocaleString('default', {
    month: 'long',
    year: 'numeric'
  });
  document.getElementById('monthEyebrow').textContent = currentDate
    .toLocaleString('default', { month: 'long' })
    .toLowerCase();

  const firstDay = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const calGrid = document.getElementById('calGrid');
  calGrid.innerHTML = '';
  calGrid.classList.toggle('loading', isLoadingMonth);

  for (let i = 0; i < firstDay; i++) {
    const blank = document.createElement('div');
    blank.className = 'cell empty';
    calGrid.appendChild(blank);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const cell = document.createElement('div');
    cell.className = 'cell';

    const thisDate = new Date(y, m, d);
    thisDate.setHours(0, 0, 0, 0);

    const isPast = thisDate < today;
    const isToday = thisDate.getTime() === today.getTime();
    const key = dateKey(y, m, d);
    const occupied = storage.getOccupiedSlots(key);
    // Slots that have already started today count as unavailable for the
    // purposes of the "n open" badge.
    for (let slot = 0; slot < TOTAL_SLOTS; slot++) {
      if (slotHasPassed(key, slot)) occupied.add(slot);
    }
    const occupiedCount = occupied.size;

    if (isPast) cell.classList.add('past');
    if (occupiedCount > 0 && occupiedCount < TOTAL_SLOTS) cell.classList.add('has-open');
    if (occupiedCount >= TOTAL_SLOTS) cell.classList.add('full');
    if (key === selectedDateKey) cell.classList.add('selected');

    const num = document.createElement('div');
    num.className = 'num';
    num.textContent = d;
    cell.appendChild(num);

    if (isToday) {
      const ring = document.createElement('div');
      ring.className = 'today-ring';
      cell.appendChild(ring);
    }

    const tag = document.createElement('div');
    tag.className = 'tag';
    if (occupiedCount === 0) tag.textContent = '';
    else if (occupiedCount >= TOTAL_SLOTS) tag.textContent = 'Full';
    else tag.textContent = `${TOTAL_SLOTS - occupiedCount} open`;
    cell.appendChild(tag);

    if (!isPast) {
      cell.setAttribute('role', 'button');
      cell.setAttribute('tabindex', '0');
      cell.setAttribute(
        'aria-label',
        `${thisDate.toLocaleDateString('default', { weekday: 'long', day: 'numeric', month: 'long' })}, ` +
          (occupiedCount >= TOTAL_SLOTS ? 'fully booked' : `${TOTAL_SLOTS - occupiedCount} slots open`)
      );
      cell.addEventListener('click', () => openPanel(y, m, d, key));
      cell.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openPanel(y, m, d, key);
        }
      });
    }

    calGrid.appendChild(cell);
  }
}

async function openPanel(y, m, d, key) {
  selectedDateKey = key;
  renderCalendar();

  const dt = new Date(y, m, d);
  document.getElementById('panelDate').textContent = dt.toLocaleDateString('default', {
    weekday: 'long',
    day: 'numeric'
  });
  document.getElementById('panelDateSub').textContent = dt.toLocaleDateString('default', {
    month: 'long',
    year: 'numeric'
  });

  renderSlots(key);

  document.getElementById('overlay').classList.add('show');
  document.getElementById('panel').classList.add('show');
  document.getElementById('panelClose').focus();

  // Re-check against the server so two people opening the same day at once do
  // not both see a slot as free.
  await refreshDate(key);
}

async function refreshDate(key) {
  try {
    const result = await api.getBookingsForDate(key);
    storage.setBookings(key, result.bookings);
    if (selectedDateKey === key) renderSlots(key);
    renderCalendar();
  } catch (_) {
    /* keep whatever is cached */
  }
}

function closePanel() {
  const panel = document.getElementById('panel');
  if (!panel.classList.contains('show')) return;

  document.getElementById('overlay').classList.remove('show');
  panel.classList.remove('show');
  selectedDateKey = null;
  renderCalendar();
}

function renderSlots(dateKeyStr) {
  const slotsList = document.getElementById('slotsList');
  slotsList.innerHTML = '';

  const slotHeader = document.createElement('div');
  slotHeader.className = 'section-label';
  slotHeader.textContent = 'Two-hour slots';
  slotsList.appendChild(slotHeader);

  SLOT_DEFS.forEach(def => slotsList.appendChild(buildSlotRow(dateKeyStr, def, false)));

  const blockHeader = document.createElement('div');
  blockHeader.className = 'section-label';
  blockHeader.textContent = 'Half day or full day';
  slotsList.appendChild(blockHeader);

  BLOCK_DEFS.forEach(def => slotsList.appendChild(buildSlotRow(dateKeyStr, def, true)));
}

function buildSlotRow(dateKeyStr, def, isBlock) {
  const wrap = document.createElement('div');
  wrap.className = 'slot' + (isBlock ? ' block' : '');

  const exact = storage.findBookingByExactSlots(dateKeyStr, def.slots);
  const hasConflict = !exact && def.slots.some(s => storage.findBookingCoveringSlot(dateKeyStr, s));
  // The server refuses these too; showing them as bookable would be a lie.
  const hasPassed = !exact && def.slots.some(s => slotHasPassed(dateKeyStr, s));

  const row = document.createElement('div');
  row.className = 'slot-row';

  const timeHtml = `<span class="slot-time">${def.label}${
    def.sub ? `<span class="slot-sub">${def.sub}</span>` : ''
  }</span>`;

  if (exact) {
    row.innerHTML = `${timeHtml}<span class="slot-status taken">Booked</span>`;
    wrap.appendChild(row);

    const info = document.createElement('div');
    info.className = 'slot-booking-info';
    info.innerHTML =
      `<b>${escapeHtml(exact.type)}</b> — ${escapeHtml(exact.name)}<br>${escapeHtml(exact.description)}` +
      (currentUser && isAdminRole(currentUser.role)
        ? `<br><span class="slot-owner">${escapeHtml(exact.booked_by_name)} · ${escapeHtml(exact.booked_by_email)}</span>`
        : '');
    wrap.appendChild(info);

    if (currentUser && (isAdminRole(currentUser.role) || currentUser.email === exact.booked_by_email)) {
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'ghost-btn';
      cancelBtn.textContent = 'Cancel booking';
      cancelBtn.addEventListener('click', async () => {
        if (!confirm('Cancel this booking? This cannot be undone.')) return;

        cancelBtn.disabled = true;
        cancelBtn.textContent = 'Cancelling…';

        try {
          await api.cancelBooking(exact.id);
          await refreshDate(dateKeyStr);
          showToast('Booking cancelled');
        } catch (err) {
          showToast(err.message);
          cancelBtn.disabled = false;
          cancelBtn.textContent = 'Cancel booking';
        }
      });
      wrap.appendChild(cancelBtn);
    }
  } else if (hasPassed) {
    wrap.classList.add('expired');
    row.innerHTML = `${timeHtml}<span class="slot-status expired">Passed</span>`;
    wrap.appendChild(row);

    const note = document.createElement('div');
    note.className = 'slot-note';
    note.textContent = 'This time has already started today.';
    wrap.appendChild(note);
  } else if (hasConflict) {
    wrap.classList.add('unavailable');
    row.innerHTML = `${timeHtml}<span class="slot-status unavail">Unavailable</span>`;
    wrap.appendChild(row);

    const note = document.createElement('div');
    note.className = 'slot-note';
    note.textContent = isBlock
      ? 'Part of this window is already booked.'
      : 'Booked as part of a longer block.';
    wrap.appendChild(note);
  } else {
    row.innerHTML = `${timeHtml}<span class="slot-status avail">Available</span>`;
    wrap.appendChild(row);

    const btn = document.createElement('button');
    btn.className = 'book-btn';
    btn.textContent = isBlock ? `Book ${def.label.toLowerCase()}` : 'Book this slot';

    const form = document.createElement('div');
    form.className = 'form';
    form.innerHTML = `
      <label class="field-label">Your name</label>
      <input type="text" class="input-field f-name" maxlength="${LIMITS.name}" value="${escapeHtml(
        currentUser?.name || ''
      )}" placeholder="e.g. Wanjiru Kamau">
      <label class="field-label">Type of shoot</label>
      <select class="input-field f-type">${SHOOT_TYPES.map(
        t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`
      ).join('')}</select>
      <label class="field-label">Shoot details</label>
      <textarea class="input-field f-desc" maxlength="${LIMITS.description}" placeholder="Tell us what the shoot involves..."></textarea>
      <button class="submit" type="button">Confirm booking</button>
      <button class="cancel" type="button">Cancel</button>
    `;

    wrap.appendChild(btn);
    wrap.appendChild(form);

    btn.addEventListener('click', () => {
      form.classList.add('show');
      btn.style.display = 'none';
      form.querySelector('.f-name').focus();
    });

    form.querySelector('.cancel').addEventListener('click', () => {
      form.classList.remove('show');
      btn.style.display = 'block';
    });

    form.querySelector('.submit').addEventListener('click', async () => {
      const name = form.querySelector('.f-name').value.trim();
      const type = form.querySelector('.f-type').value;
      const description = form.querySelector('.f-desc').value.trim();

      if (!name) return showToast('Please enter your name');
      if (!description) return showToast('Please enter shoot details');

      const submitBtn = form.querySelector('.submit');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Saving…';

      try {
        await api.createBooking(dateKeyStr, def.slots, name, type, description);
        await refreshDate(dateKeyStr);
        showToast('Booked! See you then!');
      } catch (err) {
        showToast(err.message || 'Booking failed');
        // Someone else may have taken the slot — show current state either way.
        await refreshDate(dateKeyStr);
      }
    });
  }

  return wrap;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

let toastTimer = null;
function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
}

document.getElementById('prevMonth').addEventListener('click', () => {
  currentDate.setMonth(currentDate.getMonth() - 1);
  loadMonth(currentDate.getFullYear(), currentDate.getMonth());
});

document.getElementById('nextMonth').addEventListener('click', () => {
  currentDate.setMonth(currentDate.getMonth() + 1);
  loadMonth(currentDate.getFullYear(), currentDate.getMonth());
});

document.getElementById('panelClose').addEventListener('click', closePanel);
document.getElementById('overlay').addEventListener('click', closePanel);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closePanel();
});
