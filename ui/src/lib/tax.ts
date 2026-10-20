import { CartLineItem, ComputedDocumentTotals, PriceMode, TaxComputation } from '../types/pos';

/**
 * Divides `numerator` by `denominator` using round-half-up (half away from zero).
 *
 * For positive numbers: `(numerator + denominator / 2) / denominator`.
 * For negative numbers: `(numerator - denominator / 2) / denominator`.
 * Mirrors Rust `round_div_i128` in `src-tauri/src/posting/tax.rs` using BigInt checked arithmetic.
 */
export function roundDivBigInt(numerator: bigint, denominator: bigint): bigint {
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

export interface LineComputeInput {
  resource_id: string;
  quantity_milli: number;
  unit_price_paise: number;
  discount_paise: number;
  tax_rate_bps: number;
}

export interface ComputedLineResult {
  gross_paise: number;
  discount_paise: number;
  taxable_paise: number;
  tax_rate_bps: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  line_total_paise: number;
}

/**
 * Computes line tax amounts mirroring Rust `compute_line`.
 */
export function computeLine(
  line: LineComputeInput,
  priceMode: PriceMode,
  isIntraState: boolean
): ComputedLineResult {
  if (line.quantity_milli <= 0) {
    throw new Error(`Invalid quantity: ${line.quantity_milli} (must be > 0)`);
  }
  if (line.unit_price_paise < 0) {
    throw new Error(`Invalid unit price: ${line.unit_price_paise} (must be >= 0)`);
  }
  if (line.tax_rate_bps < 0 || line.tax_rate_bps > 10000) {
    throw new Error(`Invalid tax rate: ${line.tax_rate_bps} bps (must be 0..=10000)`);
  }

  const quantityMilli = Math.floor(line.quantity_milli);
  const unitPricePaise = Math.floor(line.unit_price_paise);
  const discountPaise = Math.floor(line.discount_paise);
  const taxRateBps = Math.floor(line.tax_rate_bps);

  // gross = round(quantity_milli * unit_price_paise / 1000)
  const qBig = BigInt(quantityMilli);
  const pBig = BigInt(unitPricePaise);
  const mult = qBig * pBig;
  const grossBig = roundDivBigInt(mult, 1000n);
  const grossPaise = Number(grossBig);

  if (discountPaise < 0 || discountPaise > grossPaise) {
    throw new Error(`Invalid discount: ${discountPaise} exceeds gross ${grossPaise}`);
  }

  const effectiveDiscount = discountPaise;
  const rateBig = BigInt(taxRateBps);

  let taxablePaise: number;
  let cgstPaise: number;
  let sgstPaise: number;
  let igstPaise: number;
  let lineTotalPaise: number;

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

/**
 * Computes all lines and document totals mirroring Rust `compute_sale`.
 * Enforces round-half-up to nearest rupee (100 paise) and round_off in [-49, +50].
 */
export function computeSaleTotals(
  lines: CartLineItem[],
  priceMode: PriceMode,
  sellerStateCode: string,
  placeOfSupplyStateCode: string
): TaxComputation {
  const isIntraState = !sellerStateCode || !placeOfSupplyStateCode || sellerStateCode === placeOfSupplyStateCode;

  let sumSubtotal = 0n;
  let sumDiscount = 0n;
  let sumTaxable = 0n;
  let sumCgst = 0n;
  let sumSgst = 0n;
  let sumIgst = 0n;

  const computedLines: CartLineItem[] = lines.map((line) => {
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

    const lineSubtotal = BigInt(comp.taxable_paise) + BigInt(comp.discount_paise);
    sumSubtotal += lineSubtotal;
    sumDiscount += BigInt(comp.discount_paise);
    sumTaxable += BigInt(comp.taxable_paise);
    sumCgst += BigInt(comp.cgst_paise);
    sumSgst += BigInt(comp.sgst_paise);
    sumIgst += BigInt(comp.igst_paise);

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

  const totalBeforeBig = sumTaxable + sumCgst + sumSgst + sumIgst;

  // Round-off to nearest rupee (100 paise), 50 paise rounds up
  let roundedRupees = 0n;
  let roundedPaise = 0n;
  let roundOffPaise = 0n;

  if (totalBeforeBig !== 0n) {
    roundedRupees = roundDivBigInt(totalBeforeBig, 100n);
    roundedPaise = roundedRupees * 100n;
    roundOffPaise = roundedPaise - totalBeforeBig;
  }

  const totals: ComputedDocumentTotals = {
    subtotal_paise: Number(sumSubtotal),
    discount_paise: Number(sumDiscount),
    taxable_paise: Number(sumTaxable),
    cgst_paise: Number(sumCgst),
    sgst_paise: Number(sumSgst),
    igst_paise: Number(sumIgst),
    round_off_paise: Number(roundOffPaise),
    total_amount_paise: Number(roundedPaise),
  };

  return {
    lines: computedLines,
    totals,
  };
}

/**
 * Computes line subtotal in integer paise using BigInt round-half-up arithmetic.
 */
export function computeLineSubtotalPaise(unitPricePaise: number, quantityMilli: number): number {
  const pBig = BigInt(Math.max(0, Math.floor(unitPricePaise)));
  const qBig = BigInt(Math.max(0, Math.floor(quantityMilli)));
  return Number(roundDivBigInt(pBig * qBig, 1000n));
}

/**
 * Currency formatter: paise to INR string (e.g. 11800 -> ₹118.00)
 * Guarantees integer paise rounding to prevent malformed decimals like ₹44.98.5.
 */
export function formatPaise(paise: number, includeSymbol = true): string {
  const rounded = Math.round(paise);
  const isNegative = rounded < 0;
  const absPaise = Math.abs(rounded);
  const rupees = Math.floor(absPaise / 100);
  const cents = (absPaise % 100).toString().padStart(2, '0');
  const formatted = `${isNegative ? '-' : ''}${rupees.toLocaleString('en-IN')}.${cents}`;
  return includeSymbol ? `₹${formatted}` : formatted;
}

/**
 * Quantity formatter: milli-units to readable quantity (e.g. 1500 -> 1.5, 2000 -> 2)
 */
export function formatMilliQty(milli: number): string {
  const qty = milli / 1000;
  // If whole number, format without decimals, else up to 3 decimals without trailing zeros
  if (milli % 1000 === 0) {
    return qty.toString();
  }
  return qty.toFixed(3).replace(/\.?0+$/, '');
}

/**
 * Parse quantity string (e.g. "1.5", "2", "0.25") to milli integer
 */
export function parseQtyToMilli(input: string | number): number {
  const num = typeof input === 'number' ? input : parseFloat(input);
  if (isNaN(num) || num <= 0) return 1000;
  return Math.round(num * 1000);
}

/**
 * Parse rupees string (e.g. "120.50", "45") to paise integer
 */
export function parseRupeesToPaise(input: string | number): number {
  const num = typeof input === 'number' ? input : parseFloat(input);
  if (isNaN(num) || num < 0) return 0;
  return Math.round(num * 100);
}
