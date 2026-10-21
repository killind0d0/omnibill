// Pure integer and civil date formatters.
// Rules: Zero floating-point operations. Pure integer and BigInt math only.

export function formatRupees(paise: number | bigint): string {
  const p = typeof paise === 'bigint' ? paise : BigInt(Math.round(paise));
  const isNegative = p < 0n;
  const absP = isNegative ? -p : p;
  const rupees = absP / 100n;
  const remPaise = absP % 100n;

  const paiseStr = remPaise < 10n ? `0${remPaise}` : `${remPaise}`;
  const rupeesStr = rupees.toString();
  let formattedRupees = '';
  if (rupeesStr.length <= 3) {
    formattedRupees = rupeesStr;
  } else {
    const last3 = rupeesStr.slice(-3);
    const rest = rupeesStr.slice(0, -3);
    const withCommas = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
    formattedRupees = `${withCommas},${last3}`;
  }

  return `${isNegative ? '-' : ''}₹${formattedRupees}.${paiseStr}`;
}

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export function formatCivilDate(day: number): string {
  if (day <= 0) return '—';
  // day * 86400 * 1000 gives UTC timestamp for that civil day
  const d = new Date(day * 86400 * 1000);
  const date = String(d.getUTCDate()).padStart(2, '0');
  const month = MONTH_NAMES[d.getUTCMonth()];
  const year = d.getUTCFullYear();
  return `${date}-${month}-${year}`;
}

export function formatTimestamp(ms: number): string {
  if (!ms || ms <= 0) return 'Never';
  const d = new Date(ms);
  const date = String(d.getUTCDate()).padStart(2, '0');
  const month = MONTH_NAMES[d.getUTCMonth()];
  const year = d.getUTCFullYear();
  const hours = String(d.getUTCHours()).padStart(2, '0');
  const mins = String(d.getUTCMinutes()).padStart(2, '0');
  return `${date}-${month}-${year} ${hours}:${mins} UTC`;
}

export interface StatusChipParams {
  status: string;
  valid_until_day: number;
  current_day?: number;
  active_devices?: number;
  last_checkin_ms?: number;
  now_ms?: number;
}

export interface StatusChipResult {
  label: string;
  className: string;
}

export function getStatusChip(params: StatusChipParams): StatusChipResult {
  if (params.status === 'suspended') {
    return {
      label: 'Suspended',
      className: 'bg-rose-950 text-rose-300 border border-rose-800',
    };
  }

  if (params.active_devices !== undefined && params.active_devices === 0) {
    return {
      label: 'Not activated',
      className: 'bg-slate-900 text-slate-400 border border-slate-700',
    };
  }

  const now_ms = params.now_ms ?? Date.now();
  const current_day =
    params.current_day ?? Math.floor((now_ms + 19800000) / 86400000);

  if (
    params.last_checkin_ms !== undefined &&
    params.last_checkin_ms > 0 &&
    now_ms - params.last_checkin_ms >= 3 * 86400000
  ) {
    return {
      label: 'No check-in',
      className: 'bg-amber-950 text-amber-300 border border-amber-800',
    };
  }

  const diff = params.valid_until_day - current_day;

  if (diff < 0) {
    return {
      label: 'Expired',
      className: 'bg-red-950 text-red-300 border border-red-800',
    };
  }

  if (diff === 0) {
    return {
      label: 'Expires today',
      className: 'bg-red-950 text-red-400 border border-red-800',
    };
  }

  if (diff === 1) {
    return {
      label: 'Expires tomorrow',
      className: 'bg-amber-950 text-amber-300 border border-amber-800',
    };
  }

  if (diff >= 2 && diff <= 7) {
    return {
      label: 'Expiring',
      className: 'bg-amber-950 text-amber-400 border border-amber-800',
    };
  }

  return {
    label: 'Active',
    className: 'bg-emerald-950 text-emerald-300 border border-emerald-800',
  };
}

export function civilFromDays(z: number): [number, number, number] {
  const zShift = z + 719468;
  const era = Math.floor((zShift >= 0 ? zShift : zShift - 146096) / 146097);
  const doe = zShift - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365
  );
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return [m <= 2 ? y + 1 : y, m, d];
}

export function daysFromCivil(y: number, m: number, d: number): number {
  const adjY = m <= 2 ? y - 1 : y;
  const era = Math.floor((adjY >= 0 ? adjY : adjY - 399) / 400);
  const yoe = adjY - era * 400;
  const mp = (m + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number): number {
  switch (m) {
    case 1:
    case 3:
    case 5:
    case 7:
    case 8:
    case 10:
    case 12:
      return 31;
    case 2:
      return isLeapYear(y) ? 29 : 28;
    default:
      return 30;
  }
}

export function addMonthsCivil(startDay: number, months: number): number {
  const [y, m, d] = civilFromDays(startDay);
  const totalM = (m - 1) + months;
  const newY = y + Math.floor(totalM / 12);
  const newM = ((totalM % 12) + 12) % 12 + 1;
  const maxD = daysInMonth(newY, newM);
  const newD = Math.min(d, maxD);
  return daysFromCivil(newY, newM, newD);
}

export function currentIstDay(nowMs: number = Date.now()): number {
  return Math.floor((nowMs + 19800000) / 86400000);
}

export function calculateMarkPaidNewExpiry(
  oldValidUntilDay: number,
  months: number,
  nowMs: number = Date.now()
): number {
  const todayDay = currentIstDay(nowMs);
  const baseDay = Math.max(oldValidUntilDay, todayDay - 1);
  return addMonthsCivil(baseDay, months);
}

