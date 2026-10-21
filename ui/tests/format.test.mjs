// ui/tests/format.test.mjs
import assert from 'node:assert/strict';

function formatIndianInteger(n) {
  const s = Math.abs(n).toString();
  if (s.length <= 3) return s;
  const last3 = s.slice(-3);
  let rest = s.slice(0, -3);
  const groups = [];
  while (rest.length > 2) {
    groups.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  if (rest.length > 0) groups.unshift(rest);
  return groups.join(',') + ',' + last3;
}

function formatPaise(n) {
  const isNegative = n < 0;
  const absN = Math.abs(n);
  const rupees = Math.trunc(absN / 100);
  const paise = absN % 100;
  const paiseStr = paise < 10 ? '0' + paise.toString() : paise.toString();
  const formattedRupees = formatIndianInteger(rupees);
  const sign = isNegative ? '-₹' : '₹';
  return `${sign}${formattedRupees}.${paiseStr}`;
}

function formatBp(bp) {
  const isNegative = bp < 0;
  const absBp = Math.abs(bp);
  const whole = Math.trunc(absBp / 100);
  const frac = absBp % 100;
  const fracStr = frac < 10 ? '0' + frac.toString() : frac.toString();
  const sign = isNegative ? '-' : '';
  return `${sign}${whole}.${fracStr}%`;
}

function formatDaysX10(n) {
  if (n >= 999999) return '—';
  const isNegative = n < 0;
  const absN = Math.abs(n);
  const whole = Math.trunc(absN / 10);
  const frac = absN % 10;
  const sign = isNegative ? '-' : '';
  return `${sign}${whole}.${frac} d`;
}

function civilFromDays(day) {
  const z = day + 719468;
  const era = Math.floor((z >= 0 ? z : z - 146096) / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365
  );
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  const year = m <= 2 ? y + 1 : y;
  return { year, month: m, day: d };
}

function formatDay(day) {
  const { year, month, day: d } = civilFromDays(day);
  const mm = month < 10 ? '0' + month.toString() : month.toString();
  const dd = d < 10 ? '0' + d.toString() : d.toString();
  return `${year}-${mm}-${dd}`;
}

// 1. Acceptance format cases
assert.equal(formatPaise(0), '₹0.00');
assert.equal(formatPaise(100), '₹1.00');
assert.equal(formatPaise(123456789), '₹12,34,567.89');
assert.equal(formatPaise(-5), '-₹0.05');

assert.equal(formatBp(2500), '25.00%');
assert.equal(formatBp(-125), '-1.25%');

assert.equal(formatDaysX10(600), '60.0 d');
assert.equal(formatDaysX10(999999), '—');

// 2. Civil from days date algorithm cases (same 3 dates as Rust tests)
assert.equal(formatDay(0), '1970-01-01');
assert.equal(formatDay(11016), '2000-02-29');
assert.equal(formatDay(20748), '2026-10-22'); // or 20747 = 2026-10-21
assert.equal(formatDay(20747), '2026-10-21');

function parseIntegerString(s) {
  let val = 0;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 48 || code > 57) throw new Error('Invalid integer character');
    val = val * 10 + (code - 48);
  }
  return val;
}

function parseRupeesToPaise(input) {
  const trimmed = input.trim();
  if (trimmed === '') return undefined;
  if (trimmed.startsWith('-')) throw new Error('Negative values not allowed');

  const parts = trimmed.split('.');
  if (parts.length > 2) throw new Error('Invalid number format');

  const wholeStr = parts[0];
  const fracStr = parts.length === 2 ? parts[1] : '';

  if (wholeStr !== '' && !/^\d+$/.test(wholeStr)) throw new Error('Invalid whole digits');
  if (fracStr !== '' && !/^\d+$/.test(fracStr)) throw new Error('Invalid decimal digits');
  if (wholeStr === '' && fracStr === '') throw new Error('Empty numeric value');

  const whole = wholeStr === '' ? 0 : parseIntegerString(wholeStr);
  if (fracStr.length > 2) throw new Error('Sub-paisa precision not permitted');

  let paise = 0;
  if (fracStr.length === 1) paise = parseIntegerString(fracStr) * 10;
  else if (fracStr.length === 2) paise = parseIntegerString(fracStr);

  return whole * 100 + paise;
}

// 3. String-to-integer parser tests
assert.equal(parseRupeesToPaise('12'), 1200);
assert.equal(parseRupeesToPaise('12.5'), 1250);
assert.equal(parseRupeesToPaise('12.50'), 1250);
assert.equal(parseRupeesToPaise('.5'), 50);
assert.equal(parseRupeesToPaise(''), undefined);
assert.throws(() => parseRupeesToPaise('12.505'), /Sub-paisa precision/);
assert.throws(() => parseRupeesToPaise('abc'), /Invalid/);
assert.throws(() => parseRupeesToPaise('-3'), /Negative/);

function niceTicks(min, max, targetCount = 5) {
  if (min >= max) return [min];
  const span = max - min;
  const count = Math.max(2, targetCount);
  const roughStep = Math.max(1, Math.floor(span / count));
  let magnitude = 1;
  let temp = roughStep;
  while (temp >= 10) {
    temp = Math.floor(temp / 10);
    magnitude *= 10;
  }
  const fraction = roughStep / magnitude;
  let niceStep = magnitude;
  if (fraction < 1.5) niceStep = 1 * magnitude;
  else if (fraction < 3.5) niceStep = 2 * magnitude;
  else if (fraction < 7.5) niceStep = 5 * magnitude;
  else niceStep = 10 * magnitude;
  if (niceStep < 1) niceStep = 1;

  const start = Math.floor(min / niceStep) * niceStep;
  const ticks = [];
  let current = start;
  while (current < max) {
    ticks.push(current);
    current += niceStep;
  }
  ticks.push(current);
  return ticks;
}

// 4. Chart niceTicks unit tests
const ticks = niceTicks(0, 987, 5);
assert.equal(ticks[0], 0);
assert.ok(ticks[ticks.length - 1] >= 987);
for (let i = 1; i < ticks.length; i++) {
  assert.ok(ticks[i] > ticks[i - 1], 'Ticks must be strictly ascending integers');
}

console.log('ALL FRONTEND FORMAT TESTS PASSED');
