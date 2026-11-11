/**
 * Core worked-time calculation.
 *
 * The library deliberately keeps the model simple: a shift is a start and an
 * end timestamp plus a list of unpaid breaks. Rounding is applied per shift to
 * the net worked minutes, because rounding the total instead would let two
 * half-interval shifts silently cancel out into a whole interval of overtime.
 *
 * All arithmetic is done in integer minutes to avoid floating-point drift.
 * Times are given as `Date` objects or ISO-8601 strings; we normalise to epoch
 * milliseconds internally and never touch the system clock.
 */

/**
 * Default configuration.
 *
 * `roundToMinutes` of 15 is the common payroll interval in many
 * jurisdictions. `overtimeAfterHours` of 8 matches a standard full day.
 * `roundMode` is `'nearest'` because that is the least surprising for a
 * generic calculator; callers who need statutory rounding can override it.
 */
export const DEFAULT_OPTIONS = Object.freeze({
  roundToMinutes: 15,
  roundMode: 'nearest',
  overtimeAfterHours: 8,
});

const MS_PER_MINUTE = 60 * 1000;
const MINUTES_PER_HOUR = 60;

/**
 * Normalise a timestamp-like value to epoch milliseconds.
 *
 * Accepts `Date` and ISO-8601 strings. Numbers are rejected on purpose: an
 * epoch number is ambiguous (seconds vs milliseconds) and silently guessing
 * would be a bug factory.
 */
function toMillis(value, label) {
  if (value instanceof Date) {
    const ms = value.getTime();
    if (Number.isNaN(ms)) {
      throw new TypeError(`${label} is an invalid Date`);
    }
    return ms;
  }
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    if (Number.isNaN(ms)) {
      throw new TypeError(`${label} is not a valid ISO-8601 string: ${value}`);
    }
    return ms;
  }
  throw new TypeError(`${label} must be a Date or ISO-8601 string`);
}

/**
 * Round a non-negative integer number of minutes to the configured interval.
 *
 * `'nearest'` uses half-up rounding so that exactly half an interval rounds
 * away from zero, which is what most payroll conventions expect. `'up'` and
 * `'down'` are provided because some contracts require them.
 */
function roundMinutes(minutes, interval, mode) {
  if (interval <= 0) {
    return minutes;
  }
  const quotient = minutes / interval;
  let rounded;
  switch (mode) {
    case 'up':
      rounded = Math.ceil(quotient);
      break;
    case 'down':
      rounded = Math.floor(quotient);
      break;
    case 'nearest':
    default:
      rounded = Math.floor(quotient + 0.5);
      break;
  }
  return rounded * interval;
}

/**
 * Validate and normalise the options object.
 *
 * Returning a fresh object means the caller's `DEFAULT_OPTIONS` (which is
 * frozen) is never mutated, and the rest of the function can assume every
 * field is present and well-typed.
 */
function normaliseOptions(options) {
  const merged = { ...DEFAULT_OPTIONS, ...options };
  const { roundToMinutes, roundMode, overtimeAfterHours } = merged;

  if (!Number.isInteger(roundToMinutes) || roundToMinutes < 0) {
    throw new TypeError('roundToMinutes must be a non-negative integer');
  }
  if (!['nearest', 'up', 'down'].includes(roundMode)) {
    throw new TypeError("roundMode must be 'nearest', 'up', or 'down'");
  }
  if (typeof overtimeAfterHours !== 'number' || overtimeAfterHours < 0) {
    throw new TypeError('overtimeAfterHours must be a non-negative number');
  }

  return { roundToMinutes, roundMode, overtimeAfterHours };
}

/**
 * Compute total worked minutes and overtime for a list of shifts.
 *
 * Each shift is `{ start, end, breaks? }`. A break is `{ start, end }` and
 * must lie inside the shift; breaks that touch the boundary are allowed but
 * do not count as worked time. Overlapping breaks are summed independently,
 * which means a caller who supplies overlapping breaks will over-subtract.
 * That is a deliberate choice: detecting overlap is cheap, but silently
 * merging breaks would hide the caller's data error.
 *
 * @param {Array<{start: Date|string, end: Date|string, breaks?: Array<{start: Date|string, end: Date|string}>}>} shifts
 * @param {{roundToMinutes?: number, roundMode?: 'nearest'|'up'|'down', overtimeAfterHours?: number}} [options]
 * @returns {{totalMinutes: number, overtimeMinutes: number, regularMinutes: number, shifts: Array<{workedMinutes: number, overtimeMinutes: number}>}}
 */
export function computeWorkedTime(shifts, options = {}) {
  if (!Array.isArray(shifts)) {
    throw new TypeError('shifts must be an array');
  }
  const { roundToMinutes, roundMode, overtimeAfterHours } = normaliseOptions(options);
  const overtimeThresholdMinutes = Math.round(overtimeAfterHours * MINUTES_PER_HOUR);

  let totalMinutes = 0;
  let overtimeMinutes = 0;
  const perShift = [];

  for (let i = 0; i < shifts.length; i += 1) {
    const shift = shifts[i];
    if (shift === null || typeof shift !== 'object') {
      throw new TypeError(`shift at index ${i} must be an object`);
    }

    const startMs = toMillis(shift.start, `shift[${i}].start`);
    const endMs = toMillis(shift.end, `shift[${i}].end`);
    if (endMs < startMs) {
      throw new RangeError(`shift at index ${i} ends before it starts`);
    }

    const grossMinutes = Math.round((endMs - startMs) / MS_PER_MINUTE);
    let breakMinutes = 0;

    const breaks = shift.breaks ?? [];
    if (!Array.isArray(breaks)) {
      throw new TypeError(`shift[${i}].breaks must be an array`);
    }
    for (let j = 0; j < breaks.length; j += 1) {
      const br = breaks[j];
      if (br === null || typeof br !== 'object') {
        throw new TypeError(`shift[${i}].breaks[${j}] must be an object`);
      }
      const bStart = toMillis(br.start, `shift[${i}].breaks[${j}].start`);
      const bEnd = toMillis(br.end, `shift[${i}].breaks[${j}].end`);
      if (bEnd < bStart) {
        throw new RangeError(`shift[${i}].breaks[${j}] ends before it starts`);
      }
      if (bStart < startMs || bEnd > endMs) {
        throw new RangeError(`shift[${i}].breaks[${j}] falls outside the shift`);
      }
      breakMinutes += Math.round((bEnd - bStart) / MS_PER_MINUTE);
    }

    if (breakMinutes > grossMinutes) {
      throw new RangeError(`shift[${i}] has more break time than shift time`);
    }

    const netMinutes = grossMinutes - breakMinutes;
    const workedMinutes = roundMinutes(netMinutes, roundToMinutes, roundMode);
    const shiftOvertime = Math.max(0, workedMinutes - overtimeThresholdMinutes);

    totalMinutes += workedMinutes;
    overtimeMinutes += shiftOvertime;
    perShift.push({ workedMinutes, overtimeMinutes: shiftOvertime });
  }

  const regularMinutes = totalMinutes - overtimeMinutes;
  return { totalMinutes, overtimeMinutes, regularMinutes, shifts: perShift };
}
