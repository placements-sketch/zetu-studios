let adminFilter = 'upcoming';

async function renderAdminPanel() {
  const statsRow = document.getElementById('statsRow');
  const adminList = document.getElementById('adminList');

  try {
    const [statsResult, adminResult] = await Promise.all([api.getStats(), api.getAllBookings()]);
    const stats = statsResult.stats;

    statsRow.innerHTML = `
      <div class="stat-card">
        <div class="stat-num">${stats.totalBookings}</div>
        <div class="stat-label">Total bookings</div>
      </div>
      <div class="stat-card">
        <div class="stat-num">${stats.upcoming}</div>
        <div class="stat-label">Upcoming</div>
      </div>
      <div class="stat-card">
        <div class="stat-num">${stats.thisMonth}</div>
        <div class="stat-label">This month</div>
      </div>
      <div class="stat-card">
        <div class="stat-num">${stats.uniqueClients}</div>
        <div class="stat-label">Clients</div>
      </div>
      <div class="stat-card">
        <div class="stat-num" style="font-size:18px; line-height:1.5;">${escapeHtml(
          stats.topType
        )}</div>
        <div class="stat-label">Most booked type</div>
      </div>
    `;

    const bookings = adminResult.bookings || [];
    adminList.innerHTML = '';

    if (bookings.length === 0) {
      adminList.innerHTML = `<div class="list-empty">No bookings on the calendar yet.</div>`;
      return;
    }

    const { upcoming, past } = splitByDate(bookings);
    const counts = { upcoming: upcoming.length, past: past.length, all: bookings.length };

    // Filter bar — the admin list used to dump every booking ever made with no
    // way to narrow it down.
    const filterBar = document.createElement('div');
    filterBar.className = 'filter-bar';
    [
      ['upcoming', 'Upcoming'],
      ['past', 'Past'],
      ['all', 'All']
    ].forEach(([value, label]) => {
      const b = document.createElement('button');
      b.className = 'filter-btn' + (adminFilter === value ? ' active' : '');
      b.textContent = `${label} (${counts[value]})`;
      b.addEventListener('click', () => {
        adminFilter = value;
        renderAdminPanel();
      });
      filterBar.appendChild(b);
    });
    adminList.appendChild(filterBar);

    const shown =
      adminFilter === 'upcoming' ? upcoming : adminFilter === 'past' ? past : [...upcoming, ...past];

    if (shown.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'list-empty';
      empty.textContent = `No ${adminFilter} bookings.`;
      adminList.appendChild(empty);
      return;
    }

    shown.forEach(b => adminList.appendChild(buildBookingCard(b, false)));
  } catch (err) {
    // Surface the cause — a silent failure here just looks like an empty panel.
    console.error('Admin panel failed to render:', err);
    statsRow.innerHTML = '';
    adminList.innerHTML = `<div class="list-empty">${escapeHtml(
      err.message || 'Failed to load bookings'
    )}</div>`;
  }
}
