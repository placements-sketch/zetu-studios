// Unit tests for the validation helpers and the shared slot definitions.

const test = require('node:test');
const assert = require('node:assert');

const v = require('../server/utils/validate');
const { slotsLabel, TOTAL_SLOTS, SHOOT_TYPES } = require('../public/js/constants');

test('validateDate accepts a well-formed date', () => {
  assert.equal(v.validateDate('2027-03-14'), '2027-03-14');
});

test('validateDate rejects bad shapes and impossible dates', () => {
  for (const bad of ['2027-3-14', '14/03/2027', 'not-a-date', '', '2027-02-30', '2027-13-01']) {
    assert.throws(() => v.validateDate(bad), v.ValidationError, `should reject ${bad}`);
  }
});

test('validateDate accepts a real leap day and rejects a fake one', () => {
  assert.equal(v.validateDate('2028-02-29'), '2028-02-29');
  assert.throws(() => v.validateDate('2027-02-29'), v.ValidationError);
});

test('rejectPastDate allows today and the future', () => {
  const today = v.todayKey();
  assert.equal(v.rejectPastDate(today), today);
  assert.equal(v.rejectPastDate('2099-01-01'), '2099-01-01');
  assert.throws(() => v.rejectPastDate('2001-01-01'), v.ValidationError);
});

test('validateSlots sorts and de-duplicates', () => {
  assert.deepEqual(v.validateSlots([2, 0, 1, 1]), [0, 1, 2]);
  assert.deepEqual(v.validateSlots([4]), [4]);
});

test('validateSlots rejects anything that is not a valid index list', () => {
  for (const bad of [[], [-1], [TOTAL_SLOTS], [1.5], ['0'], null, undefined, { evil: true }, 'abc']) {
    assert.throws(() => v.validateSlots(bad), v.ValidationError, `should reject ${JSON.stringify(bad)}`);
  }
});

test('normaliseEmail lowercases and validates', () => {
  assert.equal(v.normaliseEmail('  Person@Example.COM '), 'person@example.com');
  assert.throws(() => v.normaliseEmail('not-an-email'), v.ValidationError);
  assert.throws(() => v.normaliseEmail(''), v.ValidationError);
});

test('requireString trims and enforces a maximum length', () => {
  assert.equal(v.requireString('  hi  ', 'Field'), 'hi');
  assert.throws(() => v.requireString('   ', 'Field'), v.ValidationError);
  assert.throws(() => v.requireString('abcdef', 'Field', { max: 3 }), v.ValidationError);
  assert.throws(() => v.requireString(42, 'Field'), v.ValidationError);
});

test('validateShootType only accepts known types', () => {
  assert.equal(v.validateShootType(SHOOT_TYPES[0]), SHOOT_TYPES[0]);
  assert.throws(() => v.validateShootType('Drone Racing'), v.ValidationError);
});

test('parseSlots never throws on corrupt data', () => {
  assert.deepEqual(v.parseSlots('[0,1]'), [0, 1]);
  assert.deepEqual(v.parseSlots('{"evil":true}'), []);
  assert.deepEqual(v.parseSlots('not json'), []);
  assert.deepEqual(v.parseSlots(null), []);
});

test('validateId accepts positive integers only', () => {
  assert.equal(v.validateId('7'), 7);
  for (const bad of ['abc', '0', '-3', '1.5', '']) {
    assert.throws(() => v.validateId(bad), v.ValidationError);
  }
});

test('slotsLabel names single slots, blocks and ranges', () => {
  assert.equal(slotsLabel([0]), '09:00 - 11:00');
  assert.equal(slotsLabel([0, 1, 2]), 'Half day — Morning (09:00 – 15:00)');
  assert.equal(slotsLabel([0, 1, 2, 3, 4]), 'Full day (09:00 – 19:00)');
  assert.equal(slotsLabel([3, 4]), '15:00 - 19:00');
});

test('slotsLabel handles unsorted, gapped and empty input', () => {
  assert.equal(slotsLabel([2, 1, 0]), 'Half day — Morning (09:00 – 15:00)');
  assert.equal(slotsLabel([0, 4]), '09:00 - 11:00, 17:00 - 19:00');
  assert.equal(slotsLabel([]), 'Booking');
  assert.equal(slotsLabel(null), 'Booking');
  assert.equal(slotsLabel(undefined), 'Booking');
});
