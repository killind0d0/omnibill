import QRCode from 'qrcode';

export interface UpiParams {
  vpa: string;
  payeeName: string;
  amountPaise: number;
  invoiceNumber?: string;
  note?: string;
}

/**
 * Builds standard NPCI UPI payment intent URI.
 * e.g. upi://pay?pa=store@upi&pn=Store%20Name&am=150.00&cu=INR&tn=Invoice%20INV-001
 */
export function buildUpiString(params: UpiParams): string {
  const vpa = (params.vpa || 'merchant@upi').trim();
  const payeeName = encodeURIComponent((params.payeeName || 'Merchant').trim());
  const amountRupees = (Math.max(0, params.amountPaise) / 100).toFixed(2);
  const noteText = params.note || (params.invoiceNumber ? `Invoice ${params.invoiceNumber}` : 'Payment');
  const transactionNote = encodeURIComponent(noteText);

  return `upi://pay?pa=${encodeURIComponent(vpa)}&pn=${payeeName}&am=${amountRupees}&cu=INR&tn=${transactionNote}`;
}

/**
 * Generates QR code as SVG data string or data URL for rendering inside the thermal receipt.
 */
export async function generateQrDataUrl(text: string, options?: QRCode.QRCodeToDataURLOptions): Promise<string> {
  if (!text) return '';
  try {
    return await QRCode.toDataURL(text, {
      width: options?.width || 200,
      margin: options?.margin ?? 1,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#000000',
        light: '#ffffff',
      },
      ...options,
    });
  } catch (err) {
    console.error('Failed to generate QR code:', err);
    return '';
  }
}
