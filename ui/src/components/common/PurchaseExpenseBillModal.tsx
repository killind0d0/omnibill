// ui/src/components/common/PurchaseExpenseBillModal.tsx
// Comprehensive Printable & Shareable Goods Inward Note & Purchase Expense Bill Modal

import React, { useRef } from 'react';
import {
  FileText,
  Printer,
  Download,
  Share2,
  CheckCircle2,
  Building2,
  Calendar,
  Truck,
  Hash,
  X,
  IndianRupee,
} from 'lucide-react';
import { Modal } from './Modal';
import { formatPaise } from '../../lib/tax';

export interface PurchaseExpenseItem {
  id?: string;
  name: string;
  sku?: string;
  hsn?: string;
  quantity: number;
  unit: string;
  costPricePaise: number;
  lineTotalPaise: number;
}

export interface PurchaseExpenseVoucher {
  voucherNumber: string;
  invoiceDate: string;
  supplierName: string;
  supplierGstin?: string;
  supplierPhone?: string;
  businessName: string;
  businessGstin?: string;
  businessAddress?: string;
  paymentMode: 'CASH' | 'BANK_TRANSFER' | 'CREDIT' | 'UPI';
  remarks?: string;
  items: PurchaseExpenseItem[];
  totalExpensePaise: number;
  verticalType: 'RETAIL' | 'HOSPITAL' | 'WHOLESALE';
}

interface PurchaseExpenseBillModalProps {
  isOpen: boolean;
  onClose: () => void;
  voucher: PurchaseExpenseVoucher | null;
}

export const PurchaseExpenseBillModal: React.FC<PurchaseExpenseBillModalProps> = ({
  isOpen,
  onClose,
  voucher,
}) => {
  const printAreaRef = useRef<HTMLDivElement>(null);

  if (!voucher) return null;

  const handlePrint = () => {
    window.print();
  };

  const handleShareWhatsApp = () => {
    const linesText = voucher.items
      .map(
        (i, idx) =>
          `${idx + 1}. *${i.name}* - ${i.quantity} ${i.unit} @ ${formatPaise(i.costPricePaise)} = ${formatPaise(i.lineTotalPaise)}`
      )
      .join('%0A');

    const message =
      `*PURCHASE EXPENSE VOUCHER / GOODS INWARD NOTE*%0A` +
      `----------------------------------------%0A` +
      `*Voucher #:* ${voucher.voucherNumber}%0A` +
      `*Date:* ${voucher.invoiceDate}%0A` +
      `*Supplier:* ${voucher.supplierName}%0A` +
      `*Payment:* ${voucher.paymentMode}%0A` +
      `----------------------------------------%0A` +
      `*ITEMS PURCHASED:*%0A` +
      linesText +
      `%0A----------------------------------------%0A` +
      `*TOTAL PURCHASE EXPENSE: ${formatPaise(voucher.totalExpensePaise)}*%0A` +
      `----------------------------------------%0A` +
      `*Recorded by:* ${voucher.businessName}%0A` +
      `*Status:* Stock Inventory Incremented & Ledger Booked`;

    window.open(`https://wa.me/?text=${message}`, '_blank');
  };

  const handleExportCSV = () => {
    const headers = ['Voucher Number', 'Date', 'Supplier', 'Item Name', 'SKU', 'Quantity', 'Unit', 'Purchase Rate (INR)', 'Line Total (INR)'];
    const rows = voucher.items.map((i) => [
      `"${voucher.voucherNumber}"`,
      `"${voucher.invoiceDate}"`,
      `"${voucher.supplierName}"`,
      `"${i.name}"`,
      `"${i.sku || ''}"`,
      i.quantity,
      `"${i.unit}"`,
      (i.costPricePaise / 100).toFixed(2),
      (i.lineTotalPaise / 100).toFixed(2),
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Purchase_Bill_${voucher.voucherNumber}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getVerticalBadge = () => {
    switch (voucher.verticalType) {
      case 'HOSPITAL':
        return { label: 'Hospital Medical Inward Note', color: 'bg-emerald-950/80 border-emerald-600 text-emerald-300' };
      case 'WHOLESALE':
        return { label: 'Wholesale Goods Received Note (GRN)', color: 'bg-indigo-950/80 border-indigo-600 text-indigo-300' };
      default:
        return { label: 'Retail Stock Inward & Expense Voucher', color: 'bg-blue-950/80 border-blue-600 text-blue-300' };
    }
  };

  const badge = getVerticalBadge();

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Purchase Expense Bill & Inward Voucher"
      width="max-w-3xl"
      icon={<FileText className="w-5 h-5 text-emerald-400" />}
    >
      <div className="space-y-4">
        {/* Action Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-slate-900 border border-slate-800 rounded-xl">
          <div className="flex items-center space-x-2">
            <span className={`px-2.5 py-1 rounded-md text-[11px] font-bold border uppercase tracking-wider ${badge.color}`}>
              {badge.label}
            </span>
            <span className="text-xs text-slate-400">
              Stock automatically added to active inventory
            </span>
          </div>
          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={handlePrint}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition cursor-pointer shadow-md"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print Bill</span>
            </button>
            <button
              type="button"
              onClick={handleShareWhatsApp}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition cursor-pointer shadow-md"
            >
              <Share2 className="w-3.5 h-3.5" />
              <span>WhatsApp</span>
            </button>
            <button
              type="button"
              onClick={handleExportCSV}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>CSV</span>
            </button>
          </div>
        </div>

        {/* Printable Voucher Paper */}
        <div
          ref={printAreaRef}
          className="bg-white text-slate-900 p-6 rounded-xl border border-slate-300 shadow-xl print:shadow-none print:border-none print:m-0 space-y-5 font-sans"
        >
          {/* Header */}
          <div className="flex justify-between items-start border-b border-slate-200 pb-4">
            <div>
              <div className="text-[10px] uppercase font-bold tracking-widest text-slate-500">
                Purchase Expense Voucher / Goods Inward Note
              </div>
              <h2 className="text-xl font-black text-slate-900 tracking-tight mt-0.5">
                {voucher.businessName}
              </h2>
              {voucher.businessAddress && (
                <p className="text-xs text-slate-600 max-w-sm mt-0.5">{voucher.businessAddress}</p>
              )}
              {voucher.businessGstin && (
                <div className="text-xs font-mono font-bold text-slate-700 mt-1">
                  GSTIN: {voucher.businessGstin}
                </div>
              )}
            </div>

            <div className="text-right">
              <div className="bg-slate-100 border border-slate-200 px-3 py-1.5 rounded-lg inline-block text-right">
                <span className="text-[10px] text-slate-500 uppercase font-semibold block">Voucher #</span>
                <span className="text-base font-black font-mono text-slate-900">{voucher.voucherNumber}</span>
              </div>
              <div className="text-xs text-slate-600 mt-2 flex items-center justify-end space-x-1">
                <Calendar className="w-3 h-3 text-slate-400" />
                <span className="font-mono">Date: <b>{voucher.invoiceDate}</b></span>
              </div>
              <div className="text-xs text-slate-600">
                Payment: <b className="font-mono">{voucher.paymentMode}</b>
              </div>
            </div>
          </div>

          {/* Supplier Info */}
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 grid grid-cols-2 gap-4 text-xs">
            <div>
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                Purchased From (Supplier)
              </span>
              <div className="text-sm font-bold text-slate-900 mt-0.5">{voucher.supplierName}</div>
              {voucher.supplierPhone && (
                <div className="text-slate-600 font-mono mt-0.5">Phone: {voucher.supplierPhone}</div>
              )}
            </div>
            <div>
              {voucher.supplierGstin && (
                <div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                    Supplier GSTIN
                  </span>
                  <div className="text-xs font-mono font-bold text-slate-800 mt-0.5">
                    {voucher.supplierGstin}
                  </div>
                </div>
              )}
              {voucher.remarks && (
                <div className="mt-1">
                  <span className="text-[10px] text-slate-500 uppercase">Remarks:</span>
                  <span className="text-slate-700 ml-1 italic">{voucher.remarks}</span>
                </div>
              )}
            </div>
          </div>

          {/* Purchased Items Table */}
          <div className="overflow-hidden border border-slate-200 rounded-lg">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 border-b border-slate-200 text-slate-700 font-bold uppercase text-[10px]">
                <tr>
                  <th className="py-2 px-3 w-8">#</th>
                  <th className="py-2 px-3">Item / Product Name</th>
                  <th className="py-2 px-3 text-center">SKU / Code</th>
                  <th className="py-2 px-3 text-center">Quantity</th>
                  <th className="py-2 px-3 text-right">Purchase Rate</th>
                  <th className="py-2 px-3 text-right">Total Expense</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-800">
                {voucher.items.map((item, idx) => (
                  <tr key={idx} className={idx % 2 === 1 ? 'bg-slate-50/50' : ''}>
                    <td className="py-2.5 px-3 font-mono text-slate-500">{idx + 1}</td>
                    <td className="py-2.5 px-3 font-semibold text-slate-900">{item.name}</td>
                    <td className="py-2.5 px-3 text-center font-mono text-slate-600 text-[11px]">
                      {item.sku || '-'}
                    </td>
                    <td className="py-2.5 px-3 text-center font-mono font-bold">
                      {item.quantity.toLocaleString('en-IN')} {item.unit}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-700">
                      {formatPaise(item.costPricePaise)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-black text-slate-900">
                      {formatPaise(item.lineTotalPaise)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-100 border-t-2 border-slate-300 font-bold">
                <tr>
                  <td colSpan={3} className="py-2.5 px-3 text-slate-700">
                    Total Items Inwarded: {voucher.items.length}
                  </td>
                  <td className="py-2.5 px-3 text-center font-mono text-slate-900">
                    {voucher.items.reduce((s, i) => s + i.quantity, 0).toLocaleString('en-IN')} units
                  </td>
                  <td className="py-2.5 px-3 text-right text-slate-700 uppercase text-[11px]">
                    Total Inward Expense:
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-base font-black text-emerald-700">
                    {formatPaise(voucher.totalExpensePaise)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Financial Summary & Inward Acknowledgement */}
          <div className="pt-2 border-t border-slate-200 flex justify-between items-end text-xs text-slate-600">
            <div>
              <div className="flex items-center space-x-1.5 text-emerald-700 font-semibold mb-1">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>Inventory Updated: Goods inspected & credited to ledger</span>
              </div>
              <p className="text-[11px] text-slate-500 max-w-sm">
                This document serves as proof of purchase expense and inward stock addition. Retain for tax & financial audit records.
              </p>
            </div>

            <div className="flex space-x-8 text-center pt-6">
              <div className="border-t border-slate-400 pt-1 px-4 text-[10px] font-semibold text-slate-700">
                Goods Received By
              </div>
              <div className="border-t border-slate-400 pt-1 px-4 text-[10px] font-semibold text-slate-700">
                Store Incharge / Signatory
              </div>
            </div>
          </div>
        </div>

        {/* Modal Bottom Footer */}
        <div className="flex justify-between items-center pt-2 border-t border-slate-800">
          <div className="text-xs text-slate-400">
            Total Purchase Expense: <b className="text-emerald-400 font-mono">{formatPaise(voucher.totalExpensePaise)}</b>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition cursor-pointer"
          >
            Done & Return (Esc)
          </button>
        </div>
      </div>
    </Modal>
  );
};
