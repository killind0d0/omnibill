import React, { useState, useEffect } from 'react';
import { Printer, Check, QrCode, MessageCircle } from 'lucide-react';
import { Modal } from '../common/Modal';
import { CompletedSale } from '../../types/pos';
import { formatPaise, formatMilliQty } from '../../lib/tax';
import { buildUpiString, generateQrDataUrl } from '../../lib/upi';
import { paiseToWords } from '../../lib/numbersToWords';

interface ThermalReceiptModalProps {
  isOpen: boolean;
  onClose: () => void;
  sale: CompletedSale | null;
  onConfirmComplete?: () => void;
}

export const ThermalReceiptModal: React.FC<ThermalReceiptModalProps> = ({
  isOpen,
  onClose,
  sale,
  onConfirmComplete,
}) => {
  const [paperWidth, setPaperWidth] = useState<'58mm' | '80mm'>('80mm');
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [waNotice, setWaNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!sale) return;

    const upiUrl = buildUpiString({
      vpa: sale.business.upi_vpa || 'omnimart@icici',
      payeeName: sale.business.trade_name || sale.business.legal_name,
      amountPaise: sale.totals.total_amount_paise,
      invoiceNumber: sale.invoice_number,
      note: `Bill ${sale.invoice_number}`,
    });

    generateQrDataUrl(upiUrl, { width: paperWidth === '58mm' ? 140 : 180 }).then(
      (data) => setQrDataUrl(data)
    );
  }, [sale, paperWidth]);

  if (!sale) return null;

  const isIntraState = sale.seller_state_code === sale.place_of_supply_state_code;
  const is58 = paperWidth === '58mm';

  const handlePrint = () => {
    window.print();
    if (onConfirmComplete) {
      onConfirmComplete();
    }
  };

  const handleSendWhatsApp = () => {
    if (!sale) return;

    const lineDetails = sale.lines
      .map(
        (l) =>
          `• *${l.name}*\n   ${formatMilliQty(l.quantity_milli)} x ${formatPaise(l.unit_price_paise)} = *${formatPaise(l.line_total_paise)}*`
      )
      .join('\n');

    const text =
`🧾 *TAX INVOICE / CASH BILL*
*${sale.business.trade_name || sale.business.legal_name}*
${sale.business.address_line1}, ${sale.business.city}
GSTIN: *${sale.business.gstin}* | Ph: ${sale.business.phone}
----------------------------------------
📄 *Invoice:* #${sale.invoice_number}
📅 *Date:* ${sale.invoice_date} ${sale.invoice_time || ''}
${sale.customer_name ? `👤 *Customer:* ${sale.customer_name}\n` : ''}----------------------------------------
*ITEMS:*
${lineDetails}
----------------------------------------
Subtotal: ${formatPaise(sale.totals.subtotal_paise)}
${sale.totals.discount_paise > 0 ? `Discount: -${formatPaise(sale.totals.discount_paise)}\n` : ''}Taxable Value: ${formatPaise(sale.totals.taxable_paise)}
CGST: ${formatPaise(sale.totals.cgst_paise)} | SGST: ${formatPaise(sale.totals.sgst_paise)}
${sale.totals.round_off_paise !== 0 ? `Round Off: ${formatPaise(sale.totals.round_off_paise)}\n` : ''}*TOTAL AMOUNT: ${formatPaise(sale.totals.total_amount_paise)}*
_(${paiseToWords(sale.totals.total_amount_paise)})_
----------------------------------------
💳 Payment Mode: *${sale.payment?.mode || 'CASH'}*
Thank you for shopping with us! 🙏`;

    const rawPhone = (sale.customer_phone || '').replace(/[^0-9]/g, '');
    if (rawPhone && rawPhone.length >= 10) {
      const fullPhone = rawPhone.length === 10 ? `91${rawPhone}` : rawPhone;
      window.open(`https://wa.me/${fullPhone}?text=${encodeURIComponent(text)}`, '_blank');
      setWaNotice(`Opened WhatsApp for +${fullPhone}`);
    } else {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        navigator.clipboard.writeText(text);
        setWaNotice('Receipt text copied to clipboard! (Add customer phone to send direct)');
      }
    }
    setTimeout(() => setWaNotice(null), 4000);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Instant Thermal Receipt Preview"
      width={is58 ? 'max-w-md' : 'max-w-xl'}
      icon={<Printer className="w-5 h-5 text-indigo-400" />}
    >
      <div className="flex flex-col space-y-4">
        {/* Controls Bar: 58mm / 80mm Switcher, WhatsApp & Print Button */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between bg-slate-950 p-2.5 rounded-xl border border-slate-800 gap-2 select-none">
              <div className="flex items-center space-x-1.5">
                <button
                  type="button"
                  onClick={() => setPaperWidth('58mm')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all focus-ring ${
                    paperWidth === '58mm'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'bg-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  58mm
                </button>
                <button
                  type="button"
                  onClick={() => setPaperWidth('80mm')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all focus-ring ${
                    paperWidth === '80mm'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'bg-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  80mm (Standard)
                </button>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={handleSendWhatsApp}
                  className="px-3.5 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg text-xs font-bold flex items-center space-x-1.5 shadow transition-all cursor-pointer focus-ring"
                  title="Send Receipt via WhatsApp"
                >
                  <MessageCircle className="w-3.5 h-3.5 text-emerald-300" />
                  <span>WhatsApp Bill</span>
                </button>

                <button
                  type="button"
                  onClick={handlePrint}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold flex items-center space-x-1.5 shadow-md shadow-blue-600/20 transition-all cursor-pointer focus-ring"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print</span>
                </button>
              </div>
        </div>

        {/* WhatsApp Notice Banner */}
        {waNotice && (
          <div className="px-3 py-1.5 bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 text-xs rounded-lg flex items-center space-x-2">
            <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>{waNotice}</span>
          </div>
        )}

        {/* Thermal Slip Receipt Rendering Container */}
        <div className="flex justify-center bg-slate-950/80 p-4 rounded-xl border border-slate-800 overflow-y-auto max-h-[65vh]">
          <div
            id="thermal-slip-print"
            className={`bg-white text-slate-950 font-mono text-[12px] leading-tight p-4 shadow-xl border border-slate-300 rounded ${
              is58 ? 'w-[230px] text-[11px]' : 'w-[320px]'
            }`}
          >
            {/* Header */}
            <div className="text-center space-y-0.5">
              <div className="font-bold text-sm tracking-wide uppercase">
                {sale.business.trade_name || sale.business.legal_name}
              </div>
              <div className="text-[10px] text-slate-700">{sale.business.address_line1}</div>
              <div className="text-[10px] text-slate-700">
                {sale.business.city} - {sale.business.postal_code}
              </div>
              <div className="text-[10px] text-slate-700">Ph: {sale.business.phone}</div>
              <div className="font-semibold text-[11px] pt-0.5">
                GSTIN: {sale.business.gstin}
              </div>
            </div>

            {/* Divider */}
            <div className="border-t border-dashed border-slate-500 my-2" />

            {/* Meta */}
            <div className="space-y-0.5 text-[11px]">
              <div className="flex justify-between">
                <span>Inv: <span className="font-bold">{sale.invoice_number}</span></span>
                <span>{sale.invoice_date}</span>
              </div>
              <div className="flex justify-between text-slate-700">
                <span>Time: {sale.invoice_time || '12:00:00'}</span>
                <span>POS-01</span>
              </div>
              {sale.customer_name && (
                <div className="flex justify-between">
                  <span>Cust: {sale.customer_name}</span>
                  {sale.customer_phone && <span>Ph: {sale.customer_phone}</span>}
                </div>
              )}
            </div>

            {/* Divider */}
            <div className="border-t border-dashed border-slate-500 my-2" />

            {/* Items Header */}
            <div className="flex justify-between font-bold text-[10px] uppercase pb-1 border-b border-slate-400">
              <span className="w-1/2">Item</span>
              <span className="w-1/4 text-center">Qty*Rate</span>
              <span className="w-1/4 text-right">Amt</span>
            </div>

            {/* Items List */}
            <div className="py-1 space-y-1.5">
              {sale.lines.map((item, idx) => (
                <div key={idx} className="space-y-0.5">
                  <div className="font-semibold break-words whitespace-normal leading-tight">{item.name}</div>
                  <div className="flex justify-between text-[10px] text-slate-700">
                    <span className="w-1/2">
                      HSN:{item.hsn || '-'} ({((item.tax_rate_bps) / 100).toFixed(0)}%)
                    </span>
                    <span className="w-1/4 text-center">
                      {formatMilliQty(item.quantity_milli)} x {formatPaise(item.unit_price_paise, false)}
                    </span>
                    <span className="w-1/4 text-right font-medium text-black">
                      {formatPaise(item.line_total_paise, false)}
                    </span>
                  </div>
                  {item.discount_paise > 0 && (
                    <div className="text-[10px] text-emerald-800 text-right">
                      (Disc: -{formatPaise(item.discount_paise)})
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Divider */}
            <div className="border-t border-dashed border-slate-500 my-2" />

            {/* Totals Breakdown */}
            <div className="space-y-1 text-[11px]">
              <div className="flex justify-between">
                <span>Subtotal:</span>
                <span>{formatPaise(sale.totals.subtotal_paise)}</span>
              </div>
              {sale.totals.discount_paise > 0 && (
                <div className="flex justify-between text-emerald-800">
                  <span>Discount:</span>
                  <span>-{formatPaise(sale.totals.discount_paise)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span>Taxable Value:</span>
                <span>{formatPaise(sale.totals.taxable_paise)}</span>
              </div>
              {isIntraState ? (
                <>
                  <div className="flex justify-between text-slate-700">
                    <span>CGST:</span>
                    <span>{formatPaise(sale.totals.cgst_paise)}</span>
                  </div>
                  <div className="flex justify-between text-slate-700">
                    <span>SGST:</span>
                    <span>{formatPaise(sale.totals.sgst_paise)}</span>
                  </div>
                </>
              ) : (
                <div className="flex justify-between text-slate-700">
                  <span>IGST:</span>
                  <span>{formatPaise(sale.totals.igst_paise)}</span>
                </div>
              )}
              <div className="flex justify-between text-slate-700">
                <span>Round Off:</span>
                <span>
                  {sale.totals.round_off_paise > 0 ? '+' : ''}
                  {formatPaise(sale.totals.round_off_paise)}
                </span>
              </div>

              {/* Net Grand Total */}
              <div className="border-y-2 border-black py-1 my-1 flex justify-between font-bold text-sm">
                <span>NET PAYABLE:</span>
                <span>{formatPaise(sale.totals.total_amount_paise)}</span>
              </div>

              {/* GST Mandate: Amount in Words */}
              <div className="text-[10px] text-slate-800 italic pt-0.5 leading-snug">
                <span className="font-semibold not-italic">Amount in Words:</span> {paiseToWords(sale.totals.total_amount_paise)}
              </div>
            </div>

            {/* Payment Summary */}
            <div className="space-y-0.5 text-[11px] pt-1">
              <div className="flex justify-between">
                <span>Pay Mode:</span>
                <span className="font-semibold">{sale.payment.mode}</span>
              </div>
              <div className="flex justify-between">
                <span>Tendered:</span>
                <span>{formatPaise(sale.payment.amount_tendered_paise)}</span>
              </div>
              {sale.payment.change_due_paise > 0 && (
                <div className="flex justify-between font-bold text-black">
                  <span>Change Due:</span>
                  <span>{formatPaise(sale.payment.change_due_paise)}</span>
                </div>
              )}
            </div>

            {/* Live UPI QR Code Section */}
            {qrDataUrl && (
              <div className="mt-3 pt-2 border-t border-dashed border-slate-500 flex flex-col items-center text-center">
                <div className="flex items-center space-x-1 text-[10px] font-bold uppercase tracking-wider text-slate-800 mb-1">
                  <QrCode className="w-3 h-3" />
                  <span>Scan & Pay via UPI</span>
                </div>
                <div className="p-1 bg-white border border-slate-300 rounded shadow-sm">
                  <img
                    src={qrDataUrl}
                    alt="UPI QR Code"
                    className={is58 ? 'w-28 h-28' : 'w-36 h-36'}
                  />
                </div>
                <div className="text-[9px] text-slate-600 mt-1">
                  VPA: {sale.business.upi_vpa || 'omnimart@icici'}
                </div>
                <div className="text-[9px] text-slate-500">
                  Accepted on GPay, PhonePe, Paytm, BHIM
                </div>
              </div>
            )}

            {/* Footer */}
            <div className="mt-3 pt-2 border-t border-dashed border-slate-500 text-center text-[10px] space-y-0.5 text-slate-700">
              <div>Thank You! Visit Again</div>
              <div className="text-[9px] text-slate-500">Powered by OmniBill Lightning POS</div>
            </div>
          </div>
        </div>

        {/* Bottom Actions */}
        <div className="flex justify-end space-x-2 pt-2 border-t border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-semibold transition-colors"
          >
            Close (Esc)
          </button>
          <button
            type="button"
            onClick={handlePrint}
            className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold flex items-center space-x-1.5 shadow-md shadow-emerald-600/30 transition-all cursor-pointer"
          >
            <Check className="w-4 h-4" />
            <span>Print & Complete</span>
          </button>
        </div>
      </div>
    </Modal>
  );
};
