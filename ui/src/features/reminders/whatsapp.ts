// ui/src/features/reminders/whatsapp.ts
import { ReminderItem, SenderProfile, WhatsAppMessageResult } from './types';
import { formatPaise } from '../../lib/tax';

/**
 * Normalizes an Indian phone number string to 12 digits (91XXXXXXXXXX).
 * Handles edge cases per Hardening Note H4:
 * - 10 digits: prepends '91'
 * - 11 digits starting with '0': strips '0', prepends '91'
 * - 12 digits starting with '91': retains as valid
 * - Any other combination or length: returns null
 */
export function normalizeIndianPhone(rawPhone: string): string | null {
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

/**
 * Composes a vertical-adaptive payment reminder text and returns a wa.me dispatch URL.
 */
export function composeWhatsAppReminder(
  item: ReminderItem,
  sender: SenderProfile
): WhatsAppMessageResult {
  const cleanPhone = normalizeIndianPhone(item.partyPhone);
  const senderName = sender.businessName.trim() || 'Billing Desk';
  const partyName = item.partyName.trim() || 'Customer';
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

    case 'HOSPITAL':
      text =
        `🏥 *HEALTHCARE CLINICAL STATEMENT REMINDER*\n` +
        `*Clinic/Hospital:* ${senderName}\n` +
        `*Patient Name:* ${partyName}\n` +
        (item.invoiceNumber ? `*Case/Bill Ref:* #${item.invoiceNumber}\n` : '') +
        `*Outstanding Amount:* ${balanceINR}\n\n` +
        `Dear ${partyName},\n` +
        `This is a courtesy follow-up from accounts regarding your clinical balance of *${balanceINR}*.\n` +
        (item.note ? `_Remarks: ${item.note}_\n` : '') +
        (sender.upiVpa ? `\n💳 *UPI VPA:* \`${sender.upiVpa}\`\n` : '') +
        `\nKindly contact the accounts desk or complete settlement.\n` +
        `Wishing you good health,\n*${senderName}*`;
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
