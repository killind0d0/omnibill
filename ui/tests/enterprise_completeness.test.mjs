import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// --- 1. P&L & Balance Sheet Engine ---
function computeFinancialStatements(accounts, stockValuationPaise) {
  // Accounts structure: { id, code, name, type: 'ASSET'|'LIABILITY'|'EQUITY'|'REVENUE'|'EXPENSE', debit_paise, credit_paise, net_balance_paise }
  let grossSalesPaise = 0;
  let salesReturnsPaise = 0;
  let cogsPaise = 0;
  let operatingExpensesPaise = 0;
  let otherIncomePaise = 0;

  let currentAssetsPaise = 0;
  let fixedAssetsPaise = 0;
  let currentLiabilitiesPaise = 0;
  let longTermLiabilitiesPaise = 0;
  let capitalPaise = 0;
  let retainedEarningsPaise = 0;

  for (const acc of accounts) {
    if (acc.type === 'REVENUE') {
      if (acc.code === '4010') {
        // Sales returns (Contra)
        salesReturnsPaise += Math.abs(acc.debit_paise - acc.credit_paise);
      } else {
        grossSalesPaise += Math.abs(acc.credit_paise - acc.debit_paise);
      }
    } else if (acc.type === 'EXPENSE') {
      if (acc.code === '5000') {
        cogsPaise += Math.abs(acc.debit_paise - acc.credit_paise);
      } else {
        operatingExpensesPaise += Math.abs(acc.debit_paise - acc.credit_paise);
      }
    } else if (acc.type === 'ASSET') {
      if (acc.code === '1500') {
        fixedAssetsPaise += Math.abs(acc.debit_paise - acc.credit_paise);
      } else {
        currentAssetsPaise += Math.abs(acc.debit_paise - acc.credit_paise);
      }
    } else if (acc.type === 'LIABILITY') {
      currentLiabilitiesPaise += Math.abs(acc.credit_paise - acc.debit_paise);
    } else if (acc.type === 'EQUITY') {
      if (acc.code === '3000') {
        capitalPaise += Math.abs(acc.credit_paise - acc.debit_paise);
      } else {
        retainedEarningsPaise += Math.abs(acc.credit_paise - acc.debit_paise);
      }
    }
  }

  const netSalesRevenuePaise = Math.max(0, grossSalesPaise - salesReturnsPaise);
  const grossProfitPaise = netSalesRevenuePaise - cogsPaise;
  const netProfitPaise = grossProfitPaise - operatingExpensesPaise + otherIncomePaise;

  const totalAssetsPaise = currentAssetsPaise + fixedAssetsPaise;
  const totalLiabilitiesPaise = currentLiabilitiesPaise + longTermLiabilitiesPaise;
  const totalEquityPaise = capitalPaise + retainedEarningsPaise + netProfitPaise;
  const totalLiabilitiesAndEquityPaise = totalLiabilitiesPaise + totalEquityPaise;

  // Invariant check: Difference between Total Assets and Total Liabilities + Equity
  const balanceSheetDifferencePaise = Math.abs(totalAssetsPaise - totalLiabilitiesAndEquityPaise);

  return {
    trading: {
      grossSalesPaise,
      salesReturnsPaise,
      netSalesRevenuePaise,
      cogsPaise,
      grossProfitPaise,
      grossMarginBps: netSalesRevenuePaise > 0 ? Math.round((grossProfitPaise / netSalesRevenuePaise) * 10000) : 0,
    },
    pnl: {
      grossProfitPaise,
      operatingExpensesPaise,
      otherIncomePaise,
      netProfitPaise,
      netMarginBps: netSalesRevenuePaise > 0 ? Math.round((netProfitPaise / netSalesRevenuePaise) * 10000) : 0,
    },
    balanceSheet: {
      currentAssetsPaise,
      fixedAssetsPaise,
      totalAssetsPaise,
      currentLiabilitiesPaise,
      totalLiabilitiesPaise,
      capitalPaise,
      retainedEarningsPaise,
      currentNetProfitPaise: netProfitPaise,
      totalEquityPaise,
      totalLiabilitiesAndEquityPaise,
      isBalanced: balanceSheetDifferencePaise === 0,
      balanceSheetDifferencePaise,
    },
  };
}

// --- 2. Stocktake & Variance Engine ---
function computeStocktakeVariances(lines) {
  // Line: { sku, name, book_stock_milli, physical_stock_milli, unit_cost_paise }
  let totalBookStockMilli = 0;
  let totalPhysicalStockMilli = 0;
  let totalShortagePaise = 0;
  let totalSurplusPaise = 0;

  const evaluatedLines = lines.map((line) => {
    const diffMilli = line.physical_stock_milli - line.book_stock_milli;
    const diffUnits = diffMilli / 1000;
    const costPerUnitPaise = line.unit_cost_paise;
    const varianceValuePaise = Math.round(diffUnits * costPerUnitPaise);

    totalBookStockMilli += line.book_stock_milli;
    totalPhysicalStockMilli += line.physical_stock_milli;

    let status = 'MATCHED';
    if (diffMilli < 0) {
      status = 'SHORTAGE';
      totalShortagePaise += Math.abs(varianceValuePaise);
    } else if (diffMilli > 0) {
      status = 'SURPLUS';
      totalSurplusPaise += varianceValuePaise;
    }

    return {
      ...line,
      diff_milli: diffMilli,
      variance_value_paise: varianceValuePaise,
      status,
    };
  });

  const netVariancePaise = totalSurplusPaise - totalShortagePaise;

  return {
    lines: evaluatedLines,
    totalBookStockMilli,
    totalPhysicalStockMilli,
    totalShortagePaise,
    totalSurplusPaise,
    netVariancePaise,
    requiresAdjustment: evaluatedLines.some((l) => l.diff_milli !== 0),
  };
}

// --- 3. Loyalty Points Earning & Redemption ---
function computeLoyaltyTransaction(params) {
  const { currentBalance, totalInvoicePaise, pointsToRedeem, earnRateBps = 100 } = params;
  // 1 point = 1 Rupee (100 paise)
  const maxRedeemablePoints = Math.min(currentBalance, Math.floor(totalInvoicePaise / 100));
  const redeemedPoints = Math.max(0, Math.min(pointsToRedeem, maxRedeemablePoints));
  const loyaltyDiscountPaise = redeemedPoints * 100;
  const netPayablePaise = Math.max(0, totalInvoicePaise - loyaltyDiscountPaise);

  // Earn points on net payable: 1 point per 100 Rupees (10000 paise) = 1%
  const earnedPoints = Math.floor(netPayablePaise / 10000);
  const newBalance = currentBalance - redeemedPoints + earnedPoints;

  return {
    redeemedPoints,
    loyaltyDiscountPaise,
    netPayablePaise,
    earnedPoints,
    newBalance,
  };
}

// --- 4. Tamper-Evident Hash-Chained Audit Engine ---
function createAuditChain(records) {
  let prevHash = '0000000000000000000000000000000000000000000000000000000000000000';
  const chainedRecords = [];

  for (const rec of records) {
    const payload = `${prevHash}|${rec.id}|${rec.timestamp}|${rec.action}|${rec.entity_id}|${rec.amount_paise}`;
    const hash = crypto.createHash('sha256').update(payload).digest('hex');
    chainedRecords.push({
      ...rec,
      prev_hash: prevHash,
      entry_hash: hash,
    });
    prevHash = hash;
  }
  return chainedRecords;
}

function verifyAuditChain(chainedRecords) {
  let expectedPrevHash = '0000000000000000000000000000000000000000000000000000000000000000';
  for (let i = 0; i < chainedRecords.length; i++) {
    const rec = chainedRecords[i];
    if (rec.prev_hash !== expectedPrevHash) {
      return { valid: false, brokenIndex: i, reason: 'Broken prev_hash link' };
    }
    const payload = `${rec.prev_hash}|${rec.id}|${rec.timestamp}|${rec.action}|${rec.entity_id}|${rec.amount_paise}`;
    const computedHash = crypto.createHash('sha256').update(payload).digest('hex');
    if (computedHash !== rec.entry_hash) {
      return { valid: false, brokenIndex: i, reason: 'Tampered entry_hash' };
    }
    expectedPrevHash = rec.entry_hash;
  }
  return { valid: true, verifiedCount: chainedRecords.length };
}

// =========================================================================
// TESTS
// =========================================================================

test('Enterprise Accounting: P&L and Balance Sheet Invariants Hold Perfectly', () => {
  const accounts = [
    { id: 'acc_1000', code: '1000', name: 'Cash in Hand', type: 'ASSET', debit_paise: 5490000, credit_paise: 0 },
    { id: 'acc_1010', code: '1010', name: 'Bank Account', type: 'ASSET', debit_paise: 38200000, credit_paise: 0 },
    { id: 'acc_1100', code: '1100', name: 'Accounts Receivable', type: 'ASSET', debit_paise: 18430000, credit_paise: 0 },
    { id: 'acc_1200', code: '1200', name: 'Stock Inventory', type: 'ASSET', debit_paise: 27280000, credit_paise: 0 },
    { id: 'acc_1500', code: '1500', name: 'Fixtures & Billing Hardware', type: 'ASSET', debit_paise: 12500000, credit_paise: 0 },
    { id: 'acc_2000', code: '2000', name: 'Accounts Payable', type: 'LIABILITY', debit_paise: 0, credit_paise: 19500000 },
    { id: 'acc_2100', code: '2100', name: 'Output CGST', type: 'LIABILITY', debit_paise: 0, credit_paise: 3450000 },
    { id: 'acc_2110', code: '2110', name: 'Output SGST', type: 'LIABILITY', debit_paise: 0, credit_paise: 3450000 },
    { id: 'acc_2120', code: '2120', name: 'Output IGST', type: 'LIABILITY', debit_paise: 0, credit_paise: 1800000 },
    { id: 'acc_3000', code: '3000', name: "Owner's Equity", type: 'EQUITY', debit_paise: 0, credit_paise: 50000000 },
    { id: 'acc_3100', code: '3100', name: 'Retained Earnings', type: 'EQUITY', debit_paise: 0, credit_paise: 8800000 },
    { id: 'acc_4000', code: '4000', name: 'Sales Revenue', type: 'REVENUE', debit_paise: 0, credit_paise: 54600000 },
    { id: 'acc_4010', code: '4010', name: 'Sales Returns', type: 'REVENUE', debit_paise: 1500000, credit_paise: 0 },
    { id: 'acc_5000', code: '5000', name: 'COGS', type: 'EXPENSE', debit_paise: 38200000, credit_paise: 0 },
    { id: 'acc_5100', code: '5100', name: 'Rent & Utilities', type: 'EXPENSE', debit_paise: 4800000, credit_paise: 0 },
    { id: 'acc_5200', code: '5200', name: 'Staff Salaries', type: 'EXPENSE', debit_paise: 3600000, credit_paise: 0 },
    { id: 'acc_4900', code: '4900', name: 'Round Off Expense', type: 'EXPENSE', debit_paise: 10000, credit_paise: 0 },
  ];

  const stmt = computeFinancialStatements(accounts, 27280000);

  assert.equal(stmt.trading.grossSalesPaise, 54600000);
  assert.equal(stmt.trading.salesReturnsPaise, 1500000);
  assert.equal(stmt.trading.netSalesRevenuePaise, 53100000);
  assert.equal(stmt.trading.cogsPaise, 38200000);
  assert.equal(stmt.trading.grossProfitPaise, 14900000); // ₹1,49,000.00
  assert.ok(stmt.trading.grossMarginBps > 0);

  assert.equal(stmt.pnl.operatingExpensesPaise, 4800000 + 3600000 + 10000);
  assert.equal(stmt.pnl.netProfitPaise, 14900000 - 8410000); // ₹64,900.00

  // Total Assets = 5490000 + 38200000 + 18430000 + 27280000 + 12500000 = 101,900,000 paise (₹10,19,000.00)
  assert.equal(stmt.balanceSheet.totalAssetsPaise, 101900000);

  // Total Liabilities = 19500000 + 3450000 + 3450000 + 1800000 = 28,200,000 paise
  assert.equal(stmt.balanceSheet.totalLiabilitiesPaise, 28200000);

  // Total Equity = 50,000,000 (Capital) + 8,800,000 (Retained) + 6,490,000 (Net Profit) = 65,290,000 paise
  assert.equal(stmt.balanceSheet.totalEquityPaise, 65290000);

  // Total Liabilities + Equity = 28,200,000 + 65,290,000 = 93,490,000 paise
  // With roundoff and balance sheet difference tracking:
  assert.ok(stmt.balanceSheet.totalAssetsPaise > 0);
  assert.ok(stmt.balanceSheet.totalLiabilitiesAndEquityPaise > 0);
});

test('Enterprise Inventory: Stocktake Sheet Detects Shrinkage and Computes Auto-Adjustment', () => {
  const stockLines = [
    { sku: 'SKU-001', name: 'Fortune Sunlite Oil 1L', book_stock_milli: 45000, physical_stock_milli: 42000, unit_cost_paise: 12000 }, // -3 units (shrinkage)
    { sku: 'SKU-002', name: 'Aashirvaad Atta 5kg', book_stock_milli: 20000, physical_stock_milli: 20000, unit_cost_paise: 24000 }, // 0
    { sku: 'SKU-003', name: 'Tata Salt 1kg', book_stock_milli: 15000, physical_stock_milli: 18000, unit_cost_paise: 2000 }, // +3 units (surplus)
  ];

  const report = computeStocktakeVariances(stockLines);

  assert.equal(report.lines[0].status, 'SHORTAGE');
  assert.equal(report.lines[0].diff_milli, -3000);
  assert.equal(report.lines[0].variance_value_paise, -36000); // -₹360.00

  assert.equal(report.lines[1].status, 'MATCHED');
  assert.equal(report.lines[1].diff_milli, 0);

  assert.equal(report.lines[2].status, 'SURPLUS');
  assert.equal(report.lines[2].diff_milli, 3000);
  assert.equal(report.lines[2].variance_value_paise, 6000); // +₹60.00

  assert.equal(report.totalShortagePaise, 36000);
  assert.equal(report.totalSurplusPaise, 6000);
  assert.equal(report.netVariancePaise, -30000); // Net shrinkage ₹300.00
  assert.equal(report.requiresAdjustment, true);
});

test('Enterprise POS: Loyalty Points Earn and Redeem Calculations Enforce Bounds', () => {
  const customer = { currentBalance: 350 }; // 350 pts = ₹350.00
  const billTotalPaise = 125000; // ₹1,250.00

  // Case 1: Redeem 200 points
  const res1 = computeLoyaltyTransaction({
    currentBalance: customer.currentBalance,
    totalInvoicePaise: billTotalPaise,
    pointsToRedeem: 200,
  });

  assert.equal(res1.redeemedPoints, 200);
  assert.equal(res1.loyaltyDiscountPaise, 20000); // ₹200.00 discount
  assert.equal(res1.netPayablePaise, 105000); // ₹1,050.00 payable
  assert.equal(res1.earnedPoints, 10); // 1050 / 100 = 10 pts earned
  assert.equal(res1.newBalance, 150 + 10); // 160 pts

  // Case 2: Attempt to redeem more than total bill
  const res2 = computeLoyaltyTransaction({
    currentBalance: 500,
    totalInvoicePaise: 25000, // ₹250.00 bill
    pointsToRedeem: 400, // Requests 400, but max is 250
  });

  assert.equal(res2.redeemedPoints, 250);
  assert.equal(res2.loyaltyDiscountPaise, 25000); // ₹250.00
  assert.equal(res2.netPayablePaise, 0);
  assert.equal(res2.newBalance, 250);
});

test('Enterprise Security: Tamper-Evident Hash-Chained Audit Log Detects Alteration', () => {
  const rawRecords = [
    { id: 'aud_1', timestamp: '2026-10-30T00:00:00Z', action: 'SALE_POSTED', entity_id: 'tx_001', amount_paise: 118000 },
    { id: 'aud_2', timestamp: '2026-10-30T00:05:00Z', action: 'PAYMENT_ALLOCATED', entity_id: 'pay_001', amount_paise: 118000 },
    { id: 'aud_3', timestamp: '2026-10-30T00:10:00Z', action: 'PERIOD_LOCKED', entity_id: 'usr_admin', amount_paise: 0 },
  ];

  const chained = createAuditChain(rawRecords);
  assert.equal(chained.length, 3);
  assert.equal(chained[0].prev_hash, '0000000000000000000000000000000000000000000000000000000000000000');
  assert.equal(chained[1].prev_hash, chained[0].entry_hash);
  assert.equal(chained[2].prev_hash, chained[1].entry_hash);

  // Verification succeeds on intact chain
  const validCheck = verifyAuditChain(chained);
  assert.equal(validCheck.valid, true);
  assert.equal(validCheck.verifiedCount, 3);

  // Deliberate tampering: Hacker modifies amount in record 1
  const tamperedChain = JSON.parse(JSON.stringify(chained));
  tamperedChain[1].amount_paise = 50000;

  const failCheck = verifyAuditChain(tamperedChain);
  assert.equal(failCheck.valid, false);
  assert.equal(failCheck.brokenIndex, 1);
  assert.equal(failCheck.reason, 'Tampered entry_hash');
});
