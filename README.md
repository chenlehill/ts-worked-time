# ts-worked-time

Computes total worked hours and overtime from shift entries, subtracting unpaid breaks and rounding to a configurable interval.

```js
import { computeWorkedTime } from './src/index.js';

const result = computeWorkedTime([
  {
    start: '2024-01-15T09:00:00Z',
    end: '2024-01-15T17:30:00Z',
    breaks: [{ start: '2024-01-15T12:00:00Z', end: '2024-01-15T12:30:00Z' }],
  },
]);

console.log(result.totalMinutes);     // 480 (8 hours, rounded to 15)
console.log(result.regularMinutes);   // 480
console.log(result.overtimeMinutes);  // 0
console.log(result.shifts);           // [{ workedMinutes: 480, overtimeMinutes: 0 }]
```

## Why this exists

Payroll and timesheet systems need one number that everyone agrees on: how long someone actually worked. The hard part is not addition; it is deciding *when* to round and *what* counts as overtime. This library makes two explicit trade-offs.

First, rounding is applied per shift, not to the grand total. If you round the total, two short shifts can cancel each other out and erase real overtime. Rounding each shift first is slightly less flattering to the employer and much harder to game.

Second, overtime is computed per shift against a fixed threshold. A ten-hour day is three hours of overtime; two five-hour days are zero. This matches the common daily-overtime rule and keeps the function free of calendar logic.

## The awkward edge

Overlapping breaks are summed independently. If you pass two breaks that cover the same wall-clock interval, both are subtracted and the shift can end up with less worked time than it really had. The library does not merge or detect overlap, because silently repairing caller data hides a bug that will surface later. Validate your breaks before calling, or accept the arithmetic as written.

## API

### `computeWorkedTime(shifts, options?)`

`shifts` is an array of `{ start, end, breaks? }`. `start` and `end` are `Date` objects or ISO-8601 strings. `breaks` is an array of `{ start, end }` and is optional.

`options`:

- `roundToMinutes` (default `15`): interval in minutes. `0` disables rounding.
- `roundMode` (default `'nearest'`): `'nearest'`, `'up'`, or `'down'`. `'nearest'` rounds half an interval away from zero.
- `overtimeAfterHours` (default `8`): per-shift threshold above which minutes are overtime. Fractional values are allowed.

Returns `{ totalMinutes, overtimeMinutes, regularMinutes, shifts }`, where `shifts` mirrors the input order and each entry is `{ workedMinutes, overtimeMinutes }`.

### `DEFAULT_OPTIONS`

A frozen object containing the default `roundToMinutes`, `roundMode`, and `overtimeAfterHours`. Useful for building your own presets without duplicating literals.

## Errors

`computeWorkedTime` throws `TypeError` for malformed inputs (non-array shifts, non-Date/string timestamps, bad option values) and `RangeError` for logically impossible data (a shift ending before it starts, a break outside its shift, or more break time than shift time).
