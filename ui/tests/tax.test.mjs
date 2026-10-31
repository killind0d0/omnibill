import assert from 'node:assert';

// Import compiled or JS implementation
function roundDivBigInt(numerator, denominator) {
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

function computeLine(line, priceMode, isIntraState) {
  const quantityMilli = Math.max(0, Math.floor(line.quantity_milli));
  const unitPricePaise = Math.max(0, Math.floor(line.unit_price_paise));
  const discountPaise = Math.max(0, Math.floor(line.discount_paise));
  const taxRateBps = Math.max(0, Math.min(10000, Math.floor(line.tax_rate_bps)));

  const qBig = BigInt(quantityMilli);
  const pBig = BigInt(unitPricePaise);
  const mult = qBig * pBig;
  const grossBig = roundDivBigInt(mult, 1000n);
  const grossPaise = Number(grossBig);

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
    if (lineBase === 0 || taxRateBps === 0) {
      taxablePaise = lineBase;
      cgstPaise = 0;
      sgstPaise = 0;
      igstPaise = 0;
      lineTotalPaise = lineBase;
    } else {
      const bBig = BigInt(lineBase);
      const denom = 10000n + rateBig;
      const num = bBig * 10000n;
      const taxableBig = roundDivBigInt(num, denom);
      taxablePaise = Number(taxableBig);

      const totalTaxPaise = lineBase - taxablePaise;

      if (isIntraState) {
        const halfTax = Math.floor(totalTaxPaise / 2);
        const remainder = totalTaxPaise % 2;
        if (remainder !== 0) {
          taxablePaise += remainder;
        }
        cgstPaise = halfTax;
        sgstPaise = halfTax;
        igstPaise = 0;
      } else {
        cgstPaise = 0;
        sgstPaise = 0;
        igstPaise = totalTaxPaise;
      }

      lineTotalPaise = taxablePaise + cgstPaise + sgstPaise + igstPaise;
    }
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

function computeSaleTotals(lines, priceMode, sellerStateCode, placeOfSupplyStateCode) {
  const isIntraState = !sellerStateCode || !placeOfSupplyStateCode || sellerStateCode === placeOfSupplyStateCode;

  let sumSubtotal = 0;
  let sumDiscount = 0;
  let sumTaxable = 0;
  let sumCgst = 0;
  let sumSgst = 0;
  let sumIgst = 0;

  const computedLines = lines.map((line) => {
    const comp = computeLine(
      line,
      priceMode,
      isIntraState
    );

    const isReturn = !!line.is_return;
    const sign = isReturn ? -1 : 1;

    const lineSubtotal = comp.taxable_paise + comp.discount_paise;
    sumSubtotal += lineSubtotal * sign;
    sumDiscount += comp.discount_paise * sign;
    sumTaxable += comp.taxable_paise * sign;
    sumCgst += comp.cgst_paise * sign;
    sumSgst += comp.sgst_paise * sign;
    sumIgst += comp.igst_paise * sign;

    return {
      ...line,
      is_return: isReturn,
      gross_paise: comp.gross_paise * sign,
      discount_paise: comp.discount_paise * sign,
      taxable_paise: comp.taxable_paise * sign,
      cgst_paise: comp.cgst_paise * sign,
      sgst_paise: comp.sgst_paise * sign,
      igst_paise: comp.igst_paise * sign,
      line_total_paise: comp.line_total_paise * sign,
    };
  });

  const totalBefore = sumTaxable + sumCgst + sumSgst + sumIgst;

  let roundedRupees = 0n;
  let roundedPaise = 0;
  let roundOffPaise = 0;

  if (totalBefore !== 0) {
    roundedRupees = roundDivBigInt(BigInt(totalBefore), 100n);
    roundedPaise = Number(roundedRupees * 100n);
    roundOffPaise = roundedPaise - totalBefore;
  }

  return {
    lines: computedLines,
    totals: {
      subtotal_paise: sumSubtotal,
      discount_paise: sumDiscount,
      taxable_paise: sumTaxable,
      cgst_paise: sumCgst,
      sgst_paise: sumSgst,
      igst_paise: sumIgst,
      round_off_paise: roundOffPaise,
      total_amount_paise: roundedPaise,
    },
  };
}

console.log('--- Running Rust Tax.rs Mirror Tests in JavaScript ---');

// Test 1: Intra-state standard calculation rule
{
  const res = computeSaleTotals(
    [{ resource_id: 'res_1', quantity_milli: 1000, unit_price_paise: 10000, discount_paise: 0, tax_rate_bps: 1800 }],
    'EXCLUSIVE',
    '27',
    '27'
  );
  assert.strictEqual(res.totals.taxable_paise, 10000);
  assert.strictEqual(res.totals.cgst_paise, 900);
  assert.strictEqual(res.totals.sgst_paise, 900);
  assert.strictEqual(res.totals.igst_paise, 0);
  assert.strictEqual(res.totals.round_off_paise, 0);
  assert.strictEqual(res.totals.total_amount_paise, 11800);
  console.log('✓ Test 1: Intra-state exclusive passed');
}

// Test 2: Inter-state tax rule
{
  const res = computeSaleTotals(
    [{ resource_id: 'res_1', quantity_milli: 1000, unit_price_paise: 10000, discount_paise: 0, tax_rate_bps: 1800 }],
    'EXCLUSIVE',
    '27',
    '29'
  );
  assert.strictEqual(res.totals.taxable_paise, 10000);
  assert.strictEqual(res.totals.cgst_paise, 0);
  assert.strictEqual(res.totals.sgst_paise, 0);
  assert.strictEqual(res.totals.igst_paise, 1800);
  assert.strictEqual(res.totals.round_off_paise, 0);
  assert.strictEqual(res.totals.total_amount_paise, 11800);
  console.log('✓ Test 2: Inter-state exclusive passed');
}

// Test 3: Fractional gross price and round-off rule
{
  const res = computeSaleTotals(
    [{ resource_id: 'res_1', quantity_milli: 3000, unit_price_paise: 3333, discount_paise: 0, tax_rate_bps: 1800 }],
    'EXCLUSIVE',
    '27',
    '27'
  );
  assert.strictEqual(res.lines[0].gross_paise, 9999);
  assert.strictEqual(res.totals.taxable_paise, 9999);
  assert.strictEqual(res.totals.cgst_paise, 900);
  assert.strictEqual(res.totals.sgst_paise, 900);
  assert.strictEqual(res.totals.round_off_paise, 1);
  assert.strictEqual(res.totals.total_amount_paise, 11800);
  console.log('✓ Test 3: Fractional gross with round-off passed');
}

// Test 4: Fractional quantity round-half-up
{
  const res = computeSaleTotals(
    [{ resource_id: 'res_1', quantity_milli: 1500, unit_price_paise: 2999, discount_paise: 0, tax_rate_bps: 0 }],
    'EXCLUSIVE',
    '27',
    '27'
  );
  assert.strictEqual(res.lines[0].gross_paise, 4499);
  console.log('✓ Test 4: Fractional quantity round-half-up passed');
}

// Test 5: Tax inclusive mode
{
  const res = computeSaleTotals(
    [{ resource_id: 'res_1', quantity_milli: 1000, unit_price_paise: 11800, discount_paise: 0, tax_rate_bps: 1800 }],
    'INCLUSIVE',
    '27',
    '27'
  );
  assert.strictEqual(res.totals.taxable_paise, 10000);
  assert.strictEqual(res.totals.cgst_paise, 900);
  assert.strictEqual(res.totals.sgst_paise, 900);
  assert.strictEqual(res.lines[0].line_total_paise, 11800);
  assert.strictEqual(res.totals.total_amount_paise, 11800);
  console.log('✓ Test 5: Tax inclusive mode passed');
}

// Test 6: 0% tax rate
{
  const res = computeSaleTotals(
    [{ resource_id: 'res_1', quantity_milli: 1000, unit_price_paise: 5000, discount_paise: 0, tax_rate_bps: 0 }],
    'EXCLUSIVE',
    '27',
    '27'
  );
  assert.strictEqual(res.totals.taxable_paise, 5000);
  assert.strictEqual(res.totals.cgst_paise, 0);
  assert.strictEqual(res.totals.sgst_paise, 0);
  assert.strictEqual(res.totals.igst_paise, 0);
  assert.strictEqual(res.totals.total_amount_paise, 5000);
  console.log('✓ Test 6: 0% tax rate passed');
}

// Test 7: Round-off bounds (-49 to +50 paise)
{
  // 11849 paise -> round off -49 paise -> total 11800
  const r1 = computeSaleTotals(
    [{ resource_id: 'res_1', quantity_milli: 1000, unit_price_paise: 11849, discount_paise: 0, tax_rate_bps: 0 }],
    'EXCLUSIVE',
    '27',
    '27'
  );
  assert.strictEqual(r1.totals.round_off_paise, -49);
  assert.strictEqual(r1.totals.total_amount_paise, 11800);

  // 11850 paise -> round off +50 paise -> total 11900
  const r2 = computeSaleTotals(
    [{ resource_id: 'res_1', quantity_milli: 1000, unit_price_paise: 11850, discount_paise: 0, tax_rate_bps: 0 }],
    'EXCLUSIVE',
    '27',
    '27'
  );
  assert.strictEqual(r2.totals.round_off_paise, 50);
  assert.strictEqual(r2.totals.total_amount_paise, 11900);
  console.log('✓ Test 7: Round-off bounds (-49 to +50 paise) verified');
}

// Test 8: Retail POS F2 Return & Exchange Mode
{
  // Customer buys Item A (₹500 + 18% GST = ₹590) and returns Item B (₹200 + 18% GST = ₹236)
  // Net Taxable: ₹300, CGST: ₹27, SGST: ₹27, Net Total Payable: ₹354
  const exchange = computeSaleTotals(
    [
      { resource_id: 'res_buy', quantity_milli: 1000, unit_price_paise: 50000, discount_paise: 0, tax_rate_bps: 1800, is_return: false },
      { resource_id: 'res_ret', quantity_milli: 1000, unit_price_paise: 20000, discount_paise: 0, tax_rate_bps: 1800, is_return: true },
    ],
    'EXCLUSIVE',
    '27',
    '27'
  );
  assert.strictEqual(exchange.lines[0].line_total_paise, 59000);
  assert.strictEqual(exchange.lines[1].line_total_paise, -23600);
  assert.strictEqual(exchange.totals.taxable_paise, 30000);
  assert.strictEqual(exchange.totals.cgst_paise, 2700);
  assert.strictEqual(exchange.totals.sgst_paise, 2700);
  assert.strictEqual(exchange.totals.total_amount_paise, 35400);

  // Pure Return (Refund due to customer): Customer returns ₹500 item, total = -₹590
  const refund = computeSaleTotals(
    [
      { resource_id: 'res_ret', quantity_milli: 1000, unit_price_paise: 50000, discount_paise: 0, tax_rate_bps: 1800, is_return: true },
    ],
    'EXCLUSIVE',
    '27',
    '27'
  );
  assert.strictEqual(refund.lines[0].line_total_paise, -59000);
  assert.strictEqual(refund.totals.taxable_paise, -50000);
  assert.strictEqual(refund.totals.cgst_paise, -4500);
  assert.strictEqual(refund.totals.sgst_paise, -4500);
  assert.strictEqual(refund.totals.total_amount_paise, -59000);
  console.log('✓ Test 8: Retail POS F2 Return & Exchange (net payable & refund) verified');
}

console.log('ALL TAX TESTS PASSED SUCCESSFULLY!');
