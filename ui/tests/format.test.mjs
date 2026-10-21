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

console.log('ALL FRONTEND FORMAT TESTS PASSED');
