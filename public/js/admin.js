async function renderAdminPanel() {
  try {
    // Render stats
    const statsResult = await api.getStats();
    const stats = statsResult.stats;

    const statsRow = document.getElementById('statsRow');
    statsRow.innerHTML = `
      <div class="stat-card">
        <div class="stat-num">${stats.totalBookings}</div>
        <div class="stat-label">Total bookings</div>
      </div>
      <div class="stat-card">
        <div class="stat-num">${stats.thisMonth}</div>
        <div class="stat-label">This month</div>
      </div>
      <div class="stat-card">
        <div class="stat-num" style="font-size:18px; line-height:1.5;">${escapeHtml(stats.topType)}</div>
        <div class="stat-label">Most booked type</div>
      </div>
    `;

    // Render all bookings
    const adminResult = await api.getAllBookings();
    const bookings = adminResult.bookings;

    const adminList = document.getElementById('adminList');
    adminList.innerHTML = '';

    if (bookings.length === 0) {
      adminList.innerHTML = `<div class="list-empty">No bookings on the calendar yet.</div>`;
      return;
    }

    bookings.forEach(b => {
      adminList.appendChild(buildBookingCard(b, false));
    });
  } catch (err) {
    console.error('Admin panel error:', err);
    document.getElementById('adminList').innerHTML = `<div class="list-empty">Failed to load bookings</div>`;
  }
}
