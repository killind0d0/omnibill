// ui/tests/whatsapp_reminders.test.mjs
import assert from 'node:assert/strict';

function normalizeIndianPhone(rawPhone) {
  if (!rawPhone || typeof rawPhone !== 'string') return null;
  const digits = rawPhone.replace(/\D/g, '');

  let core10 = '';
  if (digits.length === 10) {
    core10 = digits;
  } else if (digits.length === 11 && digits.startsWith('0')) {
    core10 = digits.slice(1);
  } else if (digits.length === 12 && digits.startsWith('91')) {
    core10 = digits.slice(2);
  } else {
    return null;
  }

  // Indian mobile numbering plan validation: 10 digits starting with 6, 7, 8, or 9
  if (!/^[6-9]\d{9}$/.test(core10)) {
    return null;
  }

  return `91${core10}`;
}

function formatPaise(n) {
  const isNegative = n < 0;
  const absN = Math.abs(n);
  const rupees = Math.trunc(absN / 100);
  const paise = absN % 100;
  const paiseStr = paise < 10 ? '0' + paise.toString() : paise.toString();
  const sign = isNegative ? '-₹' : '₹';
  return `${sign}${rupees}.${paiseStr}`;
}

function composeWhatsAppReminder(item, sender) {
  const cleanPhone = normalizeIndianPhone(item.partyPhone);
  const senderName = (sender.businessName || 'Billing Desk').trim();
  const partyName = (item.partyName || 'Customer').trim();
  const balanceINR = formatPaise(item.balanceDuePaise);
  const vertical = item.vertical || 'RETAIL';

  let text = '';
  switch (vertical) {
    case 'SCHOOL':
      text =
        `🏫 *FEE PAYMENT REMINDER*\n` +
        `*School:* ${senderName}\n` +
        `*Student / Guardian:* ${partyName}\n` +
        (item.invoiceNumber ? `*Bill Ref:* #${item.invoiceNumber}\n` : '') +
        `*Outstanding Fee:* ${balanceINR}\n\n` +
        `Dear Parent/Guardian,\n` +
        `This is a gentle reminder regarding the pending fee of *${balanceINR}*.\n` +
        (item.note ? `_Note: ${item.note}_\n` : '') +
        (sender.upiVpa ? `\n💳 *Direct UPI VPA:* \`${sender.upiVpa}\`\n` : '') +
        `\nKindly clear the balance at the counter or share payment confirmation.\n` +
        `Thank you!\n*${senderName}*`;
      break;

    case 'WHOLESALE':
      text =
        `🏢 *COMMERCIAL INVOICE REMINDER*\n` +
        `*From:* ${senderName}\n` +
        `*Firm / Buyer:* ${partyName}\n` +
        (item.invoiceNumber ? `*Invoice Ref:* #${item.invoiceNumber}\n` : '') +
        `*Balance Due:* ${balanceINR}\n\n` +
        `Dear ${partyName},\n` +
        `This is a friendly statement reminder that your account has an outstanding ledger balance of *${balanceINR}*.\n` +
        (item.dueDate ? `*Agreed Due Date:* ${item.dueDate}\n` : '') +
        (item.note ? `_Reference Note: ${item.note}_\n` : '') +
        (sender.upiVpa ? `\n💳 *Bank / UPI VPA:* \`${sender.upiVpa}\`\n` : '') +
        `\nKindly arrange clearance at your earliest convenience to maintain credit terms.\n` +
        `Thank you for your business!\n*${senderName}*`;
      break;

    case 'RETAIL':
    default:
      text =
        `🛍️ *PAYMENT FOLLOW-UP REMINDER*\n` +
        `*Store:* ${senderName}\n` +
        `*Customer Name:* ${partyName}\n` +
        (item.invoiceNumber ? `*Bill Ref:* #${item.invoiceNumber}\n` : '') +
        `*Pending Khata Balance:* ${balanceINR}\n\n` +
        `Dear ${partyName},\n` +
        `Greetings from ${senderName}! This is a friendly reminder regarding your pending balance of *${balanceINR}*.\n` +
        (item.note ? `_Remarks: ${item.note}_\n` : '') +
        (sender.upiVpa ? `\n💳 *Instant UPI VPA:* \`${sender.upiVpa}\`\n` : '') +
        `\nKindly settle the dues at the counter or share UPI transaction details.\n` +
        `Thank you!\n*${senderName}*`;
      break;
  }

  if (!cleanPhone) {
    return {
      cleanPhone: null,
      messageText: text,
      whatsAppUrl: null,
      isValid: false,
      validationError: 'Invalid Indian phone number. Expected 10 digits.',
    };
  }

  const whatsAppUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`;
  return {
    cleanPhone,
    messageText: text,
    whatsAppUrl,
    isValid: true,
  };
}

// ==========================================
// TEST SUITE: WhatsApp Reminders & Phone Normalization
// ==========================================
console.log('--- Running WhatsApp Reminder & Phone Normalization Tests ---');

// Hardening H4: Edge cases table verification
assert.strictEqual(normalizeIndianPhone('9876543210'), '919876543210');
assert.strictEqual(normalizeIndianPhone('09876543210'), '919876543210');
assert.strictEqual(normalizeIndianPhone('+91 98765 43210'), '919876543210');
assert.strictEqual(normalizeIndianPhone('91-9876543210'), '919876543210');
assert.strictEqual(normalizeIndianPhone('+919876543210'), '919876543210');
assert.strictEqual(normalizeIndianPhone('98765 43210'), '919876543210');
console.log('✓ All 6 Indian valid phone permutations normalized to 919876543210');

// Rejections:
assert.strictEqual(normalizeIndianPhone('12345'), null);
assert.strictEqual(normalizeIndianPhone('abcdefghij'), null);
assert.strictEqual(normalizeIndianPhone('1111111111'), null); // invalid mobile starting digit (not 6-9)
assert.strictEqual(normalizeIndianPhone('5555555555'), null); // invalid mobile starting digit
assert.strictEqual(normalizeIndianPhone(''), null);
assert.strictEqual(normalizeIndianPhone(null), null);
assert.strictEqual(normalizeIndianPhone('9876543210000000'), null);
console.log('✓ Invalid phone numbers safely rejected with null');

// Reminder generation:
const sender = {
  businessName: 'Apex Supermarket',
  upiVpa: 'apex@upi',
};

const retailItem = {
  partyId: 'cust_01',
  partyName: 'Rahul Sharma',
  partyPhone: '+91 98765 43210',
  balanceDuePaise: 45050, // ₹450.50
  invoiceNumber: 'INV-2026-0042',
  vertical: 'RETAIL',
};

const result = composeWhatsAppReminder(retailItem, sender);
assert.strictEqual(result.isValid, true);
assert.strictEqual(result.cleanPhone, '919876543210');
assert.ok(result.whatsAppUrl.startsWith('https://wa.me/919876543210?text='));
assert.ok(result.messageText.includes('*Pending Khata Balance:* ₹450.50'));
assert.ok(result.messageText.includes('apex@upi'));
console.log('✓ Retail reminder composition and wa.me URL verified');

// School mode vertical verification:
const schoolItem = {
  partyId: 'stu_101',
  partyName: 'Aarav Patel',
  partyPhone: '9822011223',
  balanceDuePaise: 350000, // ₹3,500.00
  invoiceNumber: 'FEE-2026-091',
  vertical: 'SCHOOL',
};
const schoolResult = composeWhatsAppReminder(schoolItem, { businessName: 'Delhi Public School', upiVpa: 'dps@sbi' });
assert.strictEqual(schoolResult.isValid, true);
assert.ok(schoolResult.messageText.includes('FEE PAYMENT REMINDER'));
assert.ok(schoolResult.messageText.includes('Delhi Public School'));
console.log('✓ School fee reminder composition verified');

console.log('ALL WHATSAPP REMINDER TESTS PASSED (100% GREEN)');
