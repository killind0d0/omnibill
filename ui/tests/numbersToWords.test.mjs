// ui/tests/numbersToWords.test.mjs
import assert from 'node:assert/strict';

const ONES = [
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

const TENS = [
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

function convertLessThanThousand(n) {
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

function convertIndianNumber(num) {
  if (num === 0) return '';
  let parts = [];
  let remaining = num;

  const hundredPart = remaining % 1000;
  if (hundredPart > 0) {
    parts.unshift(convertLessThanThousand(hundredPart));
  }
  remaining = Math.trunc(remaining / 1000);

  if (remaining > 0) {
    const thousandPart = remaining % 100;
    if (thousandPart > 0) {
      parts.unshift(`${convertLessThanThousand(thousandPart)} Thousand`);
    }
    remaining = Math.trunc(remaining / 100);
  }

  if (remaining > 0) {
    const lakhPart = remaining % 100;
    if (lakhPart > 0) {
      parts.unshift(`${convertLessThanThousand(lakhPart)} Lakh`);
    }
    remaining = Math.trunc(remaining / 100);
  }

  if (remaining > 0) {
    const crorePart = remaining % 100;
    if (crorePart > 0) {
      parts.unshift(`${convertLessThanThousand(crorePart)} Crore`);
    }
    remaining = Math.trunc(remaining / 100);
  }

  if (remaining > 0) {
    parts.unshift(`${convertLessThanThousand(remaining)} Arab`);
  }

  return parts.join(' ').trim();
}

export function paiseToWords(amountPaise) {
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

// ==========================================
// TEST SUITE: Indian Number-to-Words Engine
// ==========================================
console.log('--- Running Number-to-Words Integer Paise Tests ---');

// 1. Zero check
assert.strictEqual(paiseToWords(0), 'Zero Rupees Only');
assert.strictEqual(paiseToWords(0n), 'Zero Rupees Only');
console.log('✓ Zero check passed');

// 2. Single digit rupees and singular/plural
assert.strictEqual(paiseToWords(100), 'One Rupee Only');
assert.strictEqual(paiseToWords(500), 'Five Rupees Only');
console.log('✓ Single digit rupees and singular/plural check passed');

// 3. Float trap from Note H1 (whole paise)
assert.strictEqual(paiseToWords(30), 'Thirty Paise Only');
assert.strictEqual(paiseToWords(1), 'One Paisa Only');
console.log('✓ Paise-only float-trap check passed');

// 4. Lakhs formatting
// ₹1,25,000.00 = 12,500,000 paise
assert.strictEqual(
  paiseToWords(12500000),
  'One Lakh Twenty-Five Thousand Rupees Only'
);
console.log('✓ Lakhs check passed');

// 5. Crores formatting
// ₹2,50,00,000.00 = 2,500,000,000 paise (2 Crore 50 Lakh)
assert.strictEqual(
  paiseToWords(2500000000),
  'Two Crore Fifty Lakh Rupees Only'
);
console.log('✓ Crores check passed');

// 6. Mixed Rupees and Paise with hyphenated tens
// ₹150.75 = 15075 paise
assert.strictEqual(
  paiseToWords(15075),
  'One Hundred Fifty Rupees and Seventy-Five Paise Only'
);
console.log('✓ Mixed Rupees and Paise check passed');

// 7. Hardening H2: Typo 'Eighteen' verification (not 'Eightteen')
assert.strictEqual(paiseToWords(1800), 'Eighteen Rupees Only');
assert.strictEqual(paiseToWords(8018), 'Eighty Rupees and Eighteen Paise Only');
console.log('✓ Hardening H2: Eighteen typo check passed');

// 8. Negative amounts
assert.strictEqual(paiseToWords(-5000), 'Minus Fifty Rupees Only');
console.log('✓ Negative amount check passed');

console.log('ALL NUMBER-TO-WORDS TESTS PASSED (100% GREEN)');
