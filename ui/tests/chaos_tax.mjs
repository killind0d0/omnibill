// Mirroring the exact functions from ui/src/lib/tax.ts

export function roundDivBigInt(numerator, denominator) {
  if (denominator === 0n) {
    throw new Error('Division by zero');
  }
  if (numerator === 0n) {
    return 0n;
  }

  let num = numerator;
  let den = denominator;

  if (den < 0n) {
    num = -num;
    den = -den;
  }

  const half = den / 2n;
  const roundedNum = num >= 0n ? num + half : num - half;

  return roundedNum / den;
}

export function computeLine(line, priceMode, isIntraState) {
  const quantityMilli = Math.max(0, Math.floor(line.quantity_milli));
  const unitPricePaise = Math.max(0, Math.floor(line.unit_price_paise));
  const discountPaise = Math.max(0, Math.floor(line.discount_paise));
  const taxRateBps = Math.max(0, Math.min(10000, Math.floor(line.tax_rate_bps)));

  // gross = round(quantity_milli * unit_price_paise / 1000)
  const qBig = BigInt(quantityMilli);
  const pBig = BigInt(unitPricePaise);
  const mult = qBig * pBig;
  const grossBig = roundDivBigInt(mult, 1000n);
  const grossPaise = Number(grossBig);

  // discount cannot exceed gross
  const effectiveDiscount = Math.min(discountPaise, grossPaise);
  const rateBig = BigInt(taxRateBps);

  let taxablePaise;
  let cgstPaise;
  let sgstPaise;
  let igstPaise;
  let lineTotalPaise;

  if (priceMode === 'EXCLUSIVE') {
    taxablePaise = grossPaise - effectiveDiscount;
    const tBig = BigInt(taxablePaise);

    if (isIntraState) {
      const num = tBig * rateBig;
      const cBig = roundDivBigInt(num, 20000n);
      const c = Number(cBig);
      cgstPaise = c;
      sgstPaise = c;
      igstPaise = 0;
    } else {
      const num = tBig * rateBig;
      const iBig = roundDivBigInt(num, 10000n);
      const i = Number(iBig);
      cgstPaise = 0;
      sgstPaise = 0;
      igstPaise = i;
    }

    lineTotalPaise = taxablePaise + cgstPaise + sgstPaise + igstPaise;
  } else {
    // INCLUSIVE
    const lineBase = grossPaise - effectiveDiscount;
    const bBig = BigInt(lineBase);
    const denom = 10000n + rateBig;
    const num = bBig * 10000n;
    const taxableBig = roundDivBigInt(num, denom);
    taxablePaise = Number(taxableBig);

    const tBig = BigInt(taxablePaise);

    if (isIntraState) {
      const taxNum = tBig * rateBig;
      const cBig = roundDivBigInt(taxNum, 20000n);
      const c = Number(cBig);
      cgstPaise = c;
      sgstPaise = c;
      igstPaise = 0;
    } else {
      const taxNum = tBig * rateBig;
      const iBig = roundDivBigInt(taxNum, 10000n);
      const i = Number(iBig);
      cgstPaise = 0;
      sgstPaise = 0;
      igstPaise = i;
    }

    lineTotalPaise = taxablePaise + cgstPaise + sgstPaise + igstPaise;
  }

  return {
    gross_paise: grossPaise,
    discount_paise: effectiveDiscount,
    taxable_paise: taxablePaise,
    tax_rate_bps: taxRateBps,
    cgst_paise: cgstPaise,
    sgst_paise: sgstPaise,
    igst_paise: igstPaise,
    line_total_paise: lineTotalPaise,
  };
}

export function computeSaleTotals(
  lines,
  priceMode,
  sellerStateCode,
  placeOfSupplyStateCode
) {
  const isIntraState = !sellerStateCode || !placeOfSupplyStateCode || sellerStateCode === placeOfSupplyStateCode;

  let sumSubtotal = 0;
  let sumDiscount = 0;
  let sumTaxable = 0;
  let sumCgst = 0;
  let sumSgst = 0;
  let sumIgst = 0;

  const computedLines = lines.map((line) => {
    const comp = computeLine(
      {
        resource_id: line.resource_id,
        quantity_milli: line.quantity_milli,
        unit_price_paise: line.unit_price_paise,
        discount_paise: line.discount_paise,
        tax_rate_bps: line.tax_rate_bps,
      },
      priceMode,
      isIntraState
    );

    const lineSubtotal = comp.taxable_paise + comp.discount_paise;
    sumSubtotal += lineSubtotal;
    sumDiscount += comp.discount_paise;
    sumTaxable += comp.taxable_paise;
    sumCgst += comp.cgst_paise;
    sumSgst += comp.sgst_paise;
    sumIgst += comp.igst_paise;

    return {
      ...line,
      gross_paise: comp.gross_paise,
      discount_paise: comp.discount_paise,
      taxable_paise: comp.taxable_paise,
      cgst_paise: comp.cgst_paise,
      sgst_paise: comp.sgst_paise,
      igst_paise: comp.igst_paise,
      line_total_paise: comp.line_total_paise,
    };
  });

  const totalBefore = sumTaxable + sumCgst + sumSgst + sumIgst;

  // Round-off to nearest rupee (100 paise), 50 paise rounds up
  let roundedRupees = 0n;
  let roundedPaise = 0;
  let roundOffPaise = 0;

  if (totalBefore !== 0) {
    roundedRupees = roundDivBigInt(BigInt(totalBefore), 100n);
    roundedPaise = Number(roundedRupees * 100n);
    roundOffPaise = roundedPaise - totalBefore;
  }

  const totals = {
    subtotal_paise: sumSubtotal,
    discount_paise: sumDiscount,
    taxable_paise: sumTaxable,
    cgst_paise: sumCgst,
    sgst_paise: sumSgst,
    igst_paise: sumIgst,
    round_off_paise: roundOffPaise,
    total_amount_paise: roundedPaise,
  };

  return {
    lines: computedLines,
    totals,
  };
}

export function formatPaise(paise, includeSymbol = true) {
  const rounded = Math.round(paise);
  const isNegative = rounded < 0;
  const absPaise = Math.abs(rounded);
  const rupees = Math.floor(absPaise / 100);
  const cents = (absPaise % 100).toString().padStart(2, '0');
  const formatted = `${isNegative ? '-' : ''}${rupees.toLocaleString('en-IN')}.${cents}`;
  return includeSymbol ? `₹${formatted}` : formatted;
}

console.log('=== RUNNING CHAOS EDGE-CASE TESTS ON UI TAX.TS ===\n');

let issuesFound = [];

// 1. Negative quantity handling:
// Rust tax.rs returns Err(PostingError::InvalidQuantity(-1000))
// UI tax.ts:
const compNegQty = computeLine({
  resource_id: 'res_1',
  quantity_milli: -1000,
  unit_price_paise: 10000,
  discount_paise: 0,
  tax_rate_bps: 1800,
}, 'EXCLUSIVE', true);

console.log('1. Negative quantity (-1000):', compNegQty);
if (compNegQty.gross_paise === 0) {
  issuesFound.push({
    scope: 'Frontend & POS Math (ui/src/lib/tax.ts)',
    issue: 'Silent suppression of negative quantity (clamped to 0 instead of throwing/rejecting)',
    severity: 'Medium',
    detail: 'Rust tax.rs rejects quantity_milli <= 0 with InvalidQuantity, while UI returns gross=0, line_total=0. Backend will subsequently reject the invoice.'
  });
}

// 2. Tax rate > 10000 bps (e.g. 15000 bps = 150% tax):
// Rust tax.rs returns Err(PostingError::InvalidTaxRate(15000))
// UI tax.ts:
const compExtremeTax = computeLine({
  resource_id: 'res_1',
  quantity_milli: 1000,
  unit_price_paise: 10000,
  discount_paise: 0,
  tax_rate_bps: 15000,
}, 'EXCLUSIVE', true);

console.log('2. Extreme tax rate (15000 bps):', compExtremeTax);
if (compExtremeTax.tax_rate_bps === 10000) {
  issuesFound.push({
    scope: 'Frontend & POS Math (ui/src/lib/tax.ts)',
    issue: 'Silent clamping of invalid tax rate > 10000 bps to 10000 (100%)',
    severity: 'Medium',
    detail: 'UI silently recalculates tax at 10000 bps (100% tax) instead of raising error. Rust backend rejects with InvalidTaxRate(15000).'
  });
}

// 3. Discount > Gross:
// Rust tax.rs returns Err(PostingError::InvalidDiscount)
// UI tax.ts:
const compHighDisc = computeLine({
  resource_id: 'res_1',
  quantity_milli: 1000,
  unit_price_paise: 10000,
  discount_paise: 15000, // > gross of 10000
  tax_rate_bps: 1800,
}, 'EXCLUSIVE', true);

console.log('3. Discount > Gross (discount 15000, gross 10000):', compHighDisc);
if (compHighDisc.discount_paise === 10000) {
  issuesFound.push({
    scope: 'Frontend & POS Math (ui/src/lib/tax.ts)',
    issue: 'Silent clamping of discount exceeding gross amount',
    severity: 'Medium',
    detail: 'UI clamps discount to gross (10000 paise) without reporting error. Rust backend returns InvalidDiscount { discount_paise: 15000, gross_paise: 10000 }.'
  });
}

// 4. Large Numbers / Floating point precision loss (> Number.MAX_SAFE_INTEGER = 9,007,199,254,740,991)
const largePaise = 9_007_199_254_740_992; // 2^53
const compLarge = computeLine({
  resource_id: 'res_1',
  quantity_milli: 1000,
  unit_price_paise: largePaise,
  discount_paise: 0,
  tax_rate_bps: 1800,
}, 'EXCLUSIVE', true);

console.log('4. Large number near 2^53:', compLarge);
const compSaleLarge = computeSaleTotals([{
  resource_id: 'res_1',
  name: 'Large',
  quantity_milli: 1000,
  unit_price_paise: largePaise,
  discount_paise: 0,
  tax_rate_bps: 1800,
  gross_paise: 0,
  taxable_paise: 0,
  cgst_paise: 0,
  sgst_paise: 0,
  igst_paise: 0,
  line_total_paise: 0
}], 'EXCLUSIVE', '27', '27');

console.log('4b. computeSaleTotals for large numbers:', compSaleLarge.totals);
if (typeof compSaleLarge.totals.total_amount_paise === 'number') {
  const precisionLost = (compSaleLarge.totals.total_amount_paise + 1) === compSaleLarge.totals.total_amount_paise;
  console.log('Precision lost check:', precisionLost);
  if (precisionLost) {
    issuesFound.push({
      scope: 'Frontend & POS Math (ui/src/lib/tax.ts)',
      issue: 'IEEE 754 Floating-point precision loss on large totals',
      severity: 'Low',
      detail: 'computeSaleTotals aggregates totals using standard JS Number instead of BigInt, causing precision loss above 2^53.'
    });
  }
}

// 5. formatPaise formatting with negative fractions or non-integer paise
console.log('5. formatPaise(-50):', formatPaise(-50));
console.log('5b. formatPaise(0):', formatPaise(0));
console.log('5c. formatPaise(100.5):', formatPaise(100.5)); // non-integer paise
if (formatPaise(100.5).includes('.0.5')) {
  issuesFound.push({
    scope: 'Frontend & POS Math (ui/src/lib/tax.ts)',
    issue: 'formatPaise produces malformed currency string on non-integer inputs',
    severity: 'Low',
    detail: `formatPaise(100.5) produces "${formatPaise(100.5)}" due to naive string padding of floating point modulo.`
  });
}

// 6. Empty lines in computeSaleTotals
const emptySale = computeSaleTotals([], 'EXCLUSIVE', '27', '27');
console.log('6. computeSaleTotals with empty lines:', emptySale);
if (emptySale.lines.length === 0 && emptySale.totals.total_amount_paise === 0) {
  issuesFound.push({
    scope: 'Frontend & POS Math (ui/src/lib/tax.ts)',
    issue: 'Discrepancy: computeSaleTotals allows empty lines, while Rust compute_sale returns PostingError::EmptyLines',
    severity: 'Medium',
    detail: 'UI computeSaleTotals returns a valid 0-total document when passed empty lines array, whereas backend rejects it with EmptyLines.'
  });
}

console.log('\n=== ISSUES FOUND IN UI TAX.TS ===');
console.log(JSON.stringify(issuesFound, null, 2));
