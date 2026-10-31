import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

async function computeIRN(supplierGstin, finYear, docType, docNumber) {
  const normGstin = supplierGstin.trim().toUpperCase();
  const parts = finYear.split('-');
  const normFy = parts.length === 2 && parts[1].length === 4 
    ? `${parts[0]}-${parts[1].slice(2)}` 
    : finYear.trim();
  const normDocType = docType.trim().toUpperCase();
  const normDocNo = docNumber.trim().toUpperCase();

  const plainString = `${normGstin}${normFy}${normDocType}${normDocNo}`;
  const hash = crypto.createHash('sha256').update(plainString).digest('hex');
  return hash;
}

async function generateEInvoice(params) {
  const irn = await computeIRN(
    params.supplierGstin,
    params.financialYear,
    params.docType,
    params.docNumber
  );

  const ackNo = `1${Date.now().toString().slice(-9)}`;
  const ackDate = new Date().toISOString();

  const qrData = {
    SellerGstin: params.supplierGstin,
    BuyerGstin: params.buyerGstin,
    DocNo: params.docNumber,
    DocTyp: params.docType,
    DocDt: params.docDate.split('-').reverse().join('/'),
    TotInvVal: params.totalInvoiceValuePaise / 100,
    ItemCnt: params.itemCount,
    MainHsnCode: params.mainHsnCode,
    Irn: irn,
    AckNo: ackNo,
    AckDt: ackDate,
  };

  const signedQrCodePayload = JSON.stringify(qrData);
  const check = canCancelEInvoice(ackDate);

  return {
    irn,
    signedQrCodePayload,
    ackNo,
    ackDate,
    status: 'GENERATED',
    canCancel: check.canCancel,
    hoursRemainingForCancellation: check.hoursRemaining,
  };
}

function canCancelEInvoice(generationTimestamp) {
  const genTime = new Date(generationTimestamp).getTime();
  const now = Date.now();
  const diffHours = (now - genTime) / (1000 * 60 * 60);

  if (diffHours <= 24) {
    const hoursRemaining = Math.max(0, Math.round((24 - diffHours) * 10) / 10);
    return {
      canCancel: true,
      hoursRemaining,
    };
  } else {
    return {
      canCancel: false,
      hoursRemaining: 0,
      reason: 'Statutory 24-hour cancellation window has elapsed on NIC Portal. You must issue a Credit Note (GSTR-1 Table 9B) to nullify this invoice.',
    };
  }
}

test('E-Invoicing: Computes 64-character statutory SHA-256 IRN', async () => {
  const gstin = '27AABCO1234F1Z5';
  const fy = '2026-2027';
  const docType = 'INV';
  const docNo = 'INV/2026/001';

  const irn = await computeIRN(gstin, fy, docType, docNo);

  assert.equal(typeof irn, 'string');
  assert.equal(irn.length, 64, 'IRN must be exactly 64 hexadecimal characters');
  assert.match(irn, /^[0-9a-f]{64}$/, 'IRN must be lowercase hex');

  // Verify determinism: same input produces identical IRN
  const irn2 = await computeIRN(gstin, fy, docType, docNo);
  assert.equal(irn, irn2, 'IRN generation must be strictly deterministic');
});

test('E-Invoicing: Generates complete GSTN Signed QR code payload', async () => {
  const invoiceData = {
    supplierGstin: '27AABCO1234F1Z5',
    financialYear: '2026-2027',
    docType: 'INV',
    docNumber: 'INV/2026/0042',
    docDate: '2026-10-30',
    buyerGstin: '27AAACG1234F1Z8',
    totalInvoiceValuePaise: 1180000,
    itemCount: 3,
    mainHsnCode: '0401',
  };

  const einv = await generateEInvoice(invoiceData);

  assert.ok(einv.irn);
  assert.equal(einv.irn.length, 64);
  assert.ok(einv.ackNo);
  assert.equal(einv.status, 'GENERATED');
  assert.equal(einv.canCancel, true);

  const payload = JSON.parse(einv.signedQrCodePayload);
  assert.equal(payload.SellerGstin, '27AABCO1234F1Z5');
  assert.equal(payload.BuyerGstin, '27AAACG1234F1Z8');
  assert.equal(payload.DocNo, 'INV/2026/0042');
  assert.equal(payload.TotInvVal, 11800);
  assert.equal(payload.ItemCnt, 3);
  assert.equal(payload.Irn, einv.irn);
});

test('E-Invoicing: 24-hour statutory NIC cancellation rule enforcement', () => {
  // Case 1: Fresh invoice (1 hour old) -> Can cancel
  const recentTime = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
  const res1 = canCancelEInvoice(recentTime);
  assert.equal(res1.canCancel, true);
  assert.ok(res1.hoursRemaining > 20);

  // Case 2: Expired invoice (25 hours old) -> Blocked, Credit note required
  const oldTime = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  const res2 = canCancelEInvoice(oldTime);
  assert.equal(res2.canCancel, false);
  assert.equal(res2.hoursRemaining, 0);
  assert.match(res2.reason, /Credit Note/);
});
