let currentDate = new Date();
currentDate.setDate(1);
let selectedDateKey = null;

function dateKey(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function renderCalendar() {
  const y = currentDate.getFullYear();
  const m = currentDate.getMonth();
  
  document.getElementById('monthLabel').textContent = currentDate.toLocaleString('default', {
    month: 'long',
    year: 'numeric'
  });
  document.getElementById('monthEyebrow').textContent = currentDate.toLocaleString('default', {
    month: 'long'
  });

  const firstDay = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const calGrid = document.getElementById('calGrid');
  calGrid.innerHTML = '';

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
    
    const occupiedCount = storage.getOccupiedSlots(key).size;

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
      cell.addEventListener('click', () => openPanel(y, m, d, key));
    }

    calGrid.appendChild(cell);
  }
}

function openPanel(y, m, d, key) {
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
}

function closePanel() {
  document.getElementById('overlay').classList.remove('show');
  document.getElementById('panel').classList.remove('show');
  selectedDateKey = null;
  renderCalendar();
}

function renderSlots(dateKey) {
  const slotsList = document.getElementById('slotsList');
  slotsList.innerHTML = '';
  
  const slotHeader = document.createElement('div');
  slotHeader.className = 'section-label';
  slotHeader.textContent = 'Two-hour slots';
  slotsList.appendChild(slotHeader);
  
  SLOT_DEFS.forEach(def => {
    slotsList.appendChild(buildSlotRow(dateKey, def, false));
  });

  const blockHeader = document.createElement('div');
  blockHeader.className = 'section-label';
  blockHeader.textContent = 'Half day or full day';
  slotsList.appendChild(blockHeader);
  
  BLOCK_DEFS.forEach(def => {
    slotsList.appendChild(buildSlotRow(dateKey, def, true));
  });
}

function buildSlotRow(dateKey, def, isBlock) {
  const wrap = document.createElement('div');
  wrap.className = 'slot' + (isBlock ? ' block' : '');

  const exact = storage.findBookingByExactSlots(dateKey, def.slots);
  const hasConflict = def.slots.some(s => storage.findBookingCoveringSlot(dateKey, s)) && !exact;

  const row = document.createElement('div');
  row.className = 'slot-row';
  
  const timeHtml = `<span class="slot-time">${def.label}${def.sub ? `<span class="slot-sub">${def.sub}</span>` : ''}</span>`;

  if (exact) {
    row.innerHTML = `${timeHtml}<span class="slot-status taken">Booked</span>`;
    wrap.appendChild(row);
    
    const info = document.createElement('div');
    info.className = 'slot-booking-info';
    info.innerHTML = `<b>${escapeHtml(exact.type)}</b> — ${escapeHtml(exact.name)}<br>${escapeHtml(exact.description)}`;
    wrap.appendChild(info);

    if (currentUser && (currentUser.role === 'admin' || currentUser.email === exact.booked_by_email)) {
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'ghost-btn';
      cancelBtn.textContent = 'Cancel booking';
      cancelBtn.addEventListener('click', async () => {
        if (!confirm('Are you sure?')) return;
        
        cancelBtn.disabled = true;
        cancelBtn.textContent = 'Cancelling...';
        
        try {
          await api.cancelBooking(exact.id);
          const result = await api.getBookingsForDate(dateKey);
          storage.setBookings(dateKey, result.bookings);
          renderSlots(dateKey);
          renderCalendar();
          showToast('Booking cancelled');
        } catch (err) {
          showToast(err.message);
          cancelBtn.disabled = false;
          cancelBtn.textContent = 'Cancel booking';
        }
      });
      wrap.appendChild(cancelBtn);
    }
  } else if (hasConflict) {
    wrap.classList.add('unavailable');
    row.innerHTML = `${timeHtml}<span class="slot-status unavail">Unavailable</span>`;
    wrap.appendChild(row);
    
    const note = document.createElement('div');
    note.className = 'slot-note';
    note.textContent = isBlock ? 'Part of this window is already booked.' : 'Booked as part of a longer block.';
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
      <input type="text" class="input-field f-name" value="${escapeHtml(currentUser?.name || '')}" placeholder="e.g. Wanjiru Kamau">
      <label class="field-label">Type of shoot</label>
      <select class="input-field f-type">${SHOOT_TYPES.map(t => `<option value="${t}">${t}</option>`).join('')}</select>
      <label class="field-label">Shoot details</label>
      <textarea class="input-field f-desc" placeholder="Tell us what the shoot involves..."></textarea>
      <button class="submit" type="button">Confirm booking</button>
      <button class="cancel" type="button">Cancel</button>
    `;
    
    wrap.appendChild(btn);
    wrap.appendChild(form);

    btn.addEventListener('click', () => {
      form.classList.add('show');
      btn.style.display = 'none';
    });

    form.querySelector('.cancel').addEventListener('click', () => {
      form.classList.remove('show');
      btn.style.display = 'block';
    });

    form.querySelector('.submit').addEventListener('click', async () => {
      const name = form.querySelector('.f-name').value.trim();
      const type = form.querySelector('.f-type').value;
      const description = form.querySelector('.f-desc').value.trim();

      if (!name || name.length === 0) {
        showToast('Please enter your name');
        return;
      }
      
      if (!description || description.length === 0) {
        showToast('Please enter shoot details');
        return;
      }

      const submitBtn = form.querySelector('.submit');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Saving...';

      try {
        await api.createBooking(dateKey, def.slots, name, type, description);
        
        const result = await api.getBookingsForDate(dateKey);
        storage.setBookings(dateKey, result.bookings);
        
        renderSlots(dateKey);
        renderCalendar();
        showToast('Booked! See you then!');
      } catch (err) {
        showToast(err.message || 'Booking failed');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Confirm booking';
      }
    });
  }

  return wrap;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2400);
}

document.getElementById('prevMonth').addEventListener('click', () => {
  currentDate.setMonth(currentDate.getMonth() - 1);
  renderCalendar();
});

document.getElementById('nextMonth').addEventListener('click', () => {
  currentDate.setMonth(currentDate.getMonth() + 1);
  renderCalendar();
});

document.getElementById('panelClose').addEventListener('click', closePanel);
document.getElementById('overlay').addEventListener('click', closePanel);
