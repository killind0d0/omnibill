/**
 * numbersToWords.ts
 * High-precision Indian English Number-to-Words converter.
 *
 * Strict Integer Discipline (Paise-Only):
 * Accepts amounts in whole integer paise (i64 equivalent) to prevent IEEE-754 floating-point drift.
 * (e.g. ₹1,250.50 is passed as 125050 paise).
 */

const ONES: readonly string[] = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen', // Hardening H2: Explicitly corrected from prototype typo 'Eightteen'
  'Nineteen',
];

const TENS: readonly string[] = [
  '',
  '',
  'Twenty',
  'Thirty',
  'Forty',
  'Fifty',
  'Sixty',
  'Seventy',
  'Eighty',
  'Ninety',
];

export function convertLessThanThousand(n: number): string {
  let str = '';
  if (n >= 100) {
    str += ONES[Math.trunc(n / 100)] + ' Hundred ';
    n %= 100;
  }
  if (n >= 20) {
    str += TENS[Math.trunc(n / 10)] + ' ';
    n %= 10;
    if (n > 0) {
      str = str.trim() + '-' + ONES[n] + ' ';
    }
  } else if (n > 0) {
    str += ONES[n] + ' ';
  }
  return str.trim();
}

/**
 * Converts a positive whole integer into Indian English numbering words:
 * Thousands, Lakhs, Crores, Arabs.
 */
export function convertIndianNumber(num: number): string {
  if (num === 0) return '';
  let parts: string[] = [];
  let remaining = num;

  // Hundred part (0 - 999)
  const hundredPart = remaining % 1000;
  if (hundredPart > 0) {
    parts.unshift(convertLessThanThousand(hundredPart));
  }
  remaining = Math.trunc(remaining / 1000);

  // Thousand part (0 - 99)
  if (remaining > 0) {
    const thousandPart = remaining % 100;
    if (thousandPart > 0) {
      parts.unshift(`${convertLessThanThousand(thousandPart)} Thousand`);
    }
    remaining = Math.trunc(remaining / 100);
  }

  // Lakh part (0 - 99)
  if (remaining > 0) {
    const lakhPart = remaining % 100;
    if (lakhPart > 0) {
      parts.unshift(`${convertLessThanThousand(lakhPart)} Lakh`);
    }
    remaining = Math.trunc(remaining / 100);
  }

  // Crore part (0 - 99)
  if (remaining > 0) {
    const crorePart = remaining % 100;
    if (crorePart > 0) {
      parts.unshift(`${convertLessThanThousand(crorePart)} Crore`);
    }
    remaining = Math.trunc(remaining / 100);
  }

  // Arab part (if any)
  if (remaining > 0) {
    parts.unshift(`${convertLessThanThousand(remaining)} Arab`);
  }

  return parts.join(' ').trim();
}

/**
 * Converts integer paise into Indian English words.
 *
 * @param amountPaise - Total amount in paise (1 INR = 100 paise)
 * @returns Formatted words string (e.g. "One Lakh Twenty-Five Thousand Rupees and Fifty Paise Only")
 */
export function paiseToWords(amountPaise: number | bigint): string {
  const safePaise = typeof amountPaise === 'bigint' ? Number(amountPaise) : Math.trunc(amountPaise);

  if (isNaN(safePaise) || safePaise === 0) {
    return 'Zero Rupees Only';
  }

  const isNegative = safePaise < 0;
  const absPaise = Math.abs(safePaise);

  const rupees = Math.trunc(absPaise / 100);
  const paise = absPaise % 100;

  const rupeeUnit = rupees === 1 ? 'Rupee' : 'Rupees';
  const paiseUnit = paise === 1 ? 'Paisa' : 'Paise';

  const rupeeWords = rupees > 0 ? convertIndianNumber(rupees) : '';
  const paiseWords = paise > 0 ? convertLessThanThousand(paise) : '';

  let result = '';
  if (rupees > 0 && paise > 0) {
    result = `${rupeeWords} ${rupeeUnit} and ${paiseWords} ${paiseUnit} Only`;
  } else if (rupees > 0 && paise === 0) {
    result = `${rupeeWords} ${rupeeUnit} Only`;
  } else if (rupees === 0 && paise > 0) {
    result = `${paiseWords} ${paiseUnit} Only`;
  } else {
    result = 'Zero Rupees Only';
  }

  return isNegative ? `Minus ${result}` : result;
}
