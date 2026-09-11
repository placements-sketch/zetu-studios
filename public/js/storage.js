class Storage {
  constructor() {
    this.bookings = {}; // { "YYYY-MM-DD": [bookings] }
    this.loadedMonths = new Set(); // "YYYY-M" keys that have been fetched
  }

  setBookings(date, bookings) {
    this.bookings[date] = Array.isArray(bookings) ? bookings : [];
  }

  getBookings(date) {
    return this.bookings[date] || [];
  }

  markMonthLoaded(year, monthIndex) {
    this.loadedMonths.add(`${year}-${monthIndex}`);
  }

  isMonthLoaded(year, monthIndex) {
    return this.loadedMonths.has(`${year}-${monthIndex}`);
  }

  getOccupiedSlots(date) {
    const occupied = new Set();
    this.getBookings(date).forEach(b => {
      // Defensive: a legacy row could hold something other than an array.
      if (Array.isArray(b.slots)) b.slots.forEach(s => occupied.add(s));
    });
    return occupied;
  }

  findBookingByExactSlots(date, slots) {
    return this.getBookings(date).find(
      b =>
        Array.isArray(b.slots) &&
        b.slots.length === slots.length &&
        b.slots.every(s => slots.includes(s))
    );
  }

  findBookingCoveringSlot(date, slotIndex) {
    return this.getBookings(date).find(
      b => Array.isArray(b.slots) && b.slots.includes(slotIndex)
    );
  }

  removeBooking(id) {
    Object.keys(this.bookings).forEach(date => {
      this.bookings[date] = this.bookings[date].filter(b => b.id !== id);
    });
  }

  getAllBookings() {
    const all = [];
    Object.keys(this.bookings).forEach(date => {
      this.bookings[date].forEach(b => all.push({ ...b, date }));
    });
    return all.sort((a, b) => a.date.localeCompare(b.date));
  }

  clear() {
    this.bookings = {};
    this.loadedMonths.clear();
  }
}

const storage = new Storage();
