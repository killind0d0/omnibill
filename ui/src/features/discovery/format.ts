// ui/src/features/discovery/format.ts
// Pure integer formatting functions without floats or float-based formatters.

function formatIndianInteger(n: number): string {
  const s = Math.abs(n).toString();
  if (s.length <= 3) {
    return s;
  }
  const last3 = s.slice(-3);
  let rest = s.slice(0, -3);
  const groups: string[] = [];
  while (rest.length > 2) {
    groups.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  if (rest.length > 0) {
    groups.unshift(rest);
  }
  return groups.join(',') + ',' + last3;
}

/**
 * Formats paise into Indian Rupee format with exact 2-decimal paise precision.
 * e.g. 0 -> "₹0.00", 100 -> "₹1.00", 123456789 -> "₹12,34,567.89", -5 -> "-₹0.05"
 */
export function formatPaise(n: number): string {
  const isNegative = n < 0;
  const absN = Math.abs(n);
  const rupees = Math.trunc(absN / 100);
  const paise = absN % 100;
  const paiseStr = paise < 10 ? '0' + paise.toString() : paise.toString();
  const formattedRupees = formatIndianInteger(rupees);
  const sign = isNegative ? '-₹' : '₹';
  return `${sign}${formattedRupees}.${paiseStr}`;
}

/**
 * Formats basis points into percentage string.
 * e.g. 2500 -> "25.00%", -125 -> "-1.25%"
 */
export function formatBp(bp: number): string {
  const isNegative = bp < 0;
  const absBp = Math.abs(bp);
  const whole = Math.trunc(absBp / 100);
  const frac = absBp % 100;
  const fracStr = frac < 10 ? '0' + frac.toString() : frac.toString();
  const sign = isNegative ? '-' : '';
  return `${sign}${whole}.${fracStr}%`;
}

/**
 * Formats tenths of a day into display string.
 * Sentinel 999999 renders as "—".
 * e.g. 600 -> "60.0 d"
 */
export function formatDaysX10(n: number): string {
  if (n >= 999999) {
    return '—';
  }
  const isNegative = n < 0;
  const absN = Math.abs(n);
  const whole = Math.trunc(absN / 10);
  const frac = absN % 10;
  const sign = isNegative ? '-' : '';
  return `${sign}${whole}.${frac} d`;
}

/**
 * Formats milli-units into integer unit string.
 * e.g. 1000 -> "1", 1500 -> "1.5"
 */
export function formatQtyMilli(milli: number, unit = ''): string {
  const isNegative = milli < 0;
  const absMilli = Math.abs(milli);
  const whole = Math.trunc(absMilli / 1000);
  const frac = absMilli % 1000;
  const sign = isNegative ? '-' : '';
  const formattedWhole = formatIndianInteger(whole);
  let text = '';
  if (frac === 0) {
    text = `${sign}${formattedWhole}`;
  } else {
    let fracStr = frac.toString();
    while (fracStr.length < 3) {
      fracStr = '0' + fracStr;
    }
    while (fracStr.endsWith('0')) {
      fracStr = fracStr.slice(0, -1);
    }
    text = `${sign}${formattedWhole}.${fracStr}`;
  }
  return unit ? `${text} ${unit}` : text;
}

/**
 * Howard Hinnant's integer civil-from-days algorithm in TypeScript.
 */
export function civilFromDays(day: number): { year: number; month: number; day: number } {
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

/**
 * Formats days-since-epoch (1970-01-01 = 0) to "YYYY-MM-DD".
 */
export function formatDay(day: number): string {
  const { year, month, day: d } = civilFromDays(day);
  const mm = month < 10 ? '0' + month.toString() : month.toString();
  const dd = d < 10 ? '0' + d.toString() : d.toString();
  return `${year}-${mm}-${dd}`;
}
