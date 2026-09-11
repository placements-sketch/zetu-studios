class Storage {
  constructor() {
    this.bookings = {}; // { "YYYY-MM-DD": [bookings] }
  }

  setBookings(date, bookings) {
    this.bookings[date] = bookings;
  }

  getBookings(date) {
    return this.bookings[date] || [];
  }

  getOccupiedSlots(date) {
    const bookings = this.getBookings(date);
    const occupied = new Set();
    bookings.forEach(b => b.slots.forEach(s => occupied.add(s)));
    return occupied;
  }

  findBookingByExactSlots(date, slots) {
    const bookings = this.getBookings(date);
    return bookings.find(b => 
      b.slots.length === slots.length && 
      b.slots.every(s => slots.includes(s))
    );
  }

  findBookingCoveringSlot(date, slotIndex) {
    const bookings = this.getBookings(date);
    return bookings.find(b => b.slots.includes(slotIndex));
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
  }
}

const storage = new Storage();
