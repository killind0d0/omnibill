// ui/src/features/reminders/types.ts

export type BusinessVertical = 'RETAIL' | 'WHOLESALE' | 'SCHOOL' | 'HOSPITAL';

export interface ReminderItem {
  partyId: string;
  partyName: string;
  partyPhone: string;
  balanceDuePaise: number;
  invoiceNumber?: string;
  dueDate?: string;
  note?: string;
  vertical?: BusinessVertical;
}

export interface SenderProfile {
  businessName: string;
  phone?: string;
  upiVpa?: string;
}

export interface WhatsAppMessageResult {
  cleanPhone: string | null;
  messageText: string;
  whatsAppUrl: string | null;
  isValid: boolean;
  validationError?: string;
}
