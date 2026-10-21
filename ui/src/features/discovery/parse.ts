// ui/src/features/discovery/parse.ts
// Pure string-to-integer parsers for currency (paise) and percentages (basis points).
// Zero floating-point operations.

/**
 * Parses user rupee input string into integer paise.
 * Rules:
 *  - "12" -> 1200
 *  - "12.5" -> 1250
 *  - "12.50" -> 1250
 *  - ".5" -> 50
 *  - "12.505" -> throws Error (max 2 decimal places)
 *  - "abc" -> throws Error
 *  - "-3" -> throws Error (negative not allowed for prices)
 *  - "" -> returns undefined
 */
export function parseRupeesToPaise(input: string): number | undefined {
  const trimmed = input.trim();
  if (trimmed === '') return undefined;

  if (trimmed.startsWith('-')) {
    throw new Error('Negative values not allowed');
  }

  const parts = trimmed.split('.');
  if (parts.length > 2) {
    throw new Error('Invalid number format');
  }

  const wholeStr = parts[0];
  const fracStr = parts.length === 2 ? parts[1] : '';

  // Validate characters
  if (wholeStr !== '' && !/^\d+$/.test(wholeStr)) {
    throw new Error('Invalid whole digits');
  }
  if (fracStr !== '' && !/^\d+$/.test(fracStr)) {
    throw new Error('Invalid decimal digits');
  }

  if (wholeStr === '' && fracStr === '') {
    throw new Error('Empty numeric value');
  }

  const whole = wholeStr === '' ? 0 : parseIntegerString(wholeStr);

  if (fracStr.length > 2) {
    throw new Error('Sub-paisa precision not permitted');
  }

  let paise = 0;
  if (fracStr.length === 1) {
    paise = parseIntegerString(fracStr) * 10;
  } else if (fracStr.length === 2) {
    paise = parseIntegerString(fracStr);
  }

  return whole * 100 + paise;
}

/**
 * Parses percentage string into basis points (10000 = 100%).
 * e.g. "25" -> 2500, "12.5" -> 1250, "12.55" -> 1255, "12.555" -> Error
 */
export function parsePercentToBp(input: string): number | undefined {
  const trimmed = input.trim().replace(/%$/, '').trim();
  if (trimmed === '') return undefined;

  const isNeg = trimmed.startsWith('-');
  const clean = isNeg ? trimmed.slice(1) : trimmed;

  const parts = clean.split('.');
  if (parts.length > 2) {
    throw new Error('Invalid percentage format');
  }

  const wholeStr = parts[0];
  const fracStr = parts.length === 2 ? parts[1] : '';

  if (wholeStr !== '' && !/^\d+$/.test(wholeStr)) {
    throw new Error('Invalid percentage digits');
  }
  if (fracStr !== '' && !/^\d+$/.test(fracStr)) {
    throw new Error('Invalid decimal digits');
  }

  if (wholeStr === '' && fracStr === '') {
    throw new Error('Empty percentage');
  }

  const whole = wholeStr === '' ? 0 : parseIntegerString(wholeStr);

  if (fracStr.length > 2) {
    throw new Error('Precision exceeds basis point resolution');
  }

  let bpFrac = 0;
  if (fracStr.length === 1) {
    bpFrac = parseIntegerString(fracStr) * 10;
  } else if (fracStr.length === 2) {
    bpFrac = parseIntegerString(fracStr);
  }

  const result = whole * 100 + bpFrac;
  return isNeg ? -result : result;
}

/**
 * Pure integer string parser without parseInt or parseFloat
 */
function parseIntegerString(s: string): number {
  let val = 0;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 48 || code > 57) {
      throw new Error('Invalid integer character');
    }
    val = val * 10 + (code - 48);
  }
  return val;
}
