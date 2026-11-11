import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeWorkedTime, DEFAULT_OPTIONS } from '../src/index.js';

/**
 * A fixed reference day. Using explicit UTC strings keeps the tests free of
 * timezone and wall-clock dependence.
 */
const DAY = '2024-01-15T';

function at(hour, minute = 0) {
  return `${DAY}${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`;
}

test('defaults are exposed and frozen', () => {
  assert.equal(DEFAULT_OPTIONS.roundToMinutes, 15);
  assert.equal(DEFAULT_OPTIONS.roundMode, 'nearest');
  assert.equal(DEFAULT_OPTIONS.overtimeAfterHours, 8);
  assert.ok(Object.isFrozen(DEFAULT_OPTIONS));
});

test('computes a simple shift with no breaks', () => {
  const result = computeWorkedTime([{ start: at(9), end: at(17) }]);
  assert.equal(result.totalMinutes, 480);
  assert.equal(result.regularMinutes, 480);
  assert.equal(result.overtimeMinutes, 0);
  assert.deepEqual(result.shifts, [{ workedMinutes: 480, overtimeMinutes: 0 }]);
});

test('subtracts unpaid breaks', () => {
  const result = computeWorkedTime([
    {
      start: at(9),
      end: at(17),
      breaks: [{ start: at(12), end: at(12, 30) }],
    },
  ]);
  assert.equal(result.totalMinutes, 450);
  assert.equal(result.overtimeMinutes, 0);
});

test('rounds net minutes to the nearest interval', () => {
  // 9:00 to 17:07 is 487 minutes; nearest 15 is 480.
  const result = computeWorkedTime([{ start: at(9), end: at(17, 7) }]);
  assert.equal(result.totalMinutes, 480);
});

test('rounds half-interval away from zero', () => {
  // 7.5 minutes above a multiple of 15 rounds up to 15.
  const result = computeWorkedTime([{ start: at(9), end: at(9, 8) }], {
    roundToMinutes: 15,
  });
  assert.equal(result.totalMinutes, 15);
});

test('supports rounding up and down', () => {
  const up = computeWorkedTime([{ start: at(9), end: at(9, 7) }], {
    roundToMinutes: 15,
    roundMode: 'up',
  });
  const down = computeWorkedTime([{ start: at(9), end: at(9, 7) }], {
    roundToMinutes: 15,
    roundMode: 'down',
  });
  assert.equal(up.totalMinutes, 15);
  assert.equal(down.totalMinutes, 0);
});

test('roundToMinutes of zero disables rounding', () => {
  const result = computeWorkedTime([{ start: at(9), end: at(9, 7) }], {
    roundToMinutes: 0,
  });
  assert.equal(result.totalMinutes, 7);
});

test('overtime is computed per shift, not on the total', () => {
  // Two shifts of 5 hours each: neither exceeds 8 hours, so no overtime,
  // even though the combined total is 10 hours.
  const result = computeWorkedTime([
    { start: at(8), end: at(13) },
    { start: at(14), end: at(19) },
  ]);
  assert.equal(result.totalMinutes, 600);
  assert.equal(result.overtimeMinutes, 0);
  assert.equal(result.regularMinutes, 600);
});

test('overtime is the amount above the threshold', () => {
  const result = computeWorkedTime([{ start: at(8), end: at(19) }]);
  // 11 hours worked, 8-hour threshold, 3 hours overtime.
  assert.equal(result.totalMinutes, 660);
  assert.equal(result.overtimeMinutes, 180);
  assert.equal(result.regularMinutes, 480);
});

test('overtime threshold can be fractional hours', () => {
  const result = computeWorkedTime([{ start: at(9), end: at(12) }], {
    overtimeAfterHours: 2.5,
  });
  assert.equal(result.totalMinutes, 180);
  assert.equal(result.overtimeMinutes, 30);
});

test('accepts Date objects as well as strings', () => {
  const start = new Date(at(9));
  const end = new Date(at(17));
  const result = computeWorkedTime([{ start, end }]);
  assert.equal(result.totalMinutes, 480);
});

test('rejects a shift that ends before it starts', () => {
  assert.throws(
    () => computeWorkedTime([{ start: at(17), end: at(9) }]),
    /ends before it starts/,
  );
});

test('rejects a break outside the shift', () => {
  assert.throws(
    () =>
      computeWorkedTime([
        {
          start: at(9),
          end: at(17),
          breaks: [{ start: at(8), end: at(9) }],
        },
      ]),
    /falls outside the shift/,
  );
});

test('rejects more break time than shift time', () => {
  assert.throws(
    () =>
      computeWorkedTime([
        {
          start: at(9),
          end: at(10),
          breaks: [
            { start: at(9), end: at(9, 30) },
            { start: at(9, 30), end: at(10) },
            { start: at(9), end: at(10) },
          ],
        },
      ]),
    /more break time than shift time/,
  );
});

test('rejects invalid option values', () => {
  assert.throws(
    () => computeWorkedTime([], { roundToMinutes: -1 }),
    /non-negative integer/,
  );
  assert.throws(
    () => computeWorkedTime([], { roundMode: 'sideways' }),
    /roundMode/,
  );
  assert.throws(
    () => computeWorkedTime([], { overtimeAfterHours: -1 }),
    /non-negative number/,
  );
});

test('rejects non-array shifts and malformed entries', () => {
  assert.throws(() => computeWorkedTime(null), /shifts must be an array/);
  assert.throws(() => computeWorkedTime([null]), /must be an object/);
  assert.throws(
    () => computeWorkedTime([{ start: 123, end: at(17) }]),
    /must be a Date or ISO-8601 string/,
  );
  assert.throws(
    () => computeWorkedTime([{ start: at(9), end: 'not-a-date' }]),
    /not a valid ISO-8601 string/,
  );
  assert.throws(
    () => computeWorkedTime([{ start: at(9), end: at(17), breaks: 'no' }]),
    /breaks must be an array/,
  );
  assert.throws(
    () =>
      computeWorkedTime([
        { start: at(9), end: at(17), breaks: [{ start: at(12), end: 'nope' }] },
      ]),
    /not a valid ISO-8601 string/,
  );
});

test('empty shift list yields zeroes', () => {
  const result = computeWorkedTime([]);
  assert.deepEqual(result, {
    totalMinutes: 0,
    overtimeMinutes: 0,
    regularMinutes: 0,
    shifts: [],
  });
});

test('zero-length shift is allowed and rounds to zero', () => {
  const result = computeWorkedTime([{ start: at(9), end: at(9) }]);
  assert.equal(result.totalMinutes, 0);
  assert.equal(result.overtimeMinutes, 0);
});
