// ui/src/features/reminders/WhatsAppModal.tsx
import React, { useState, useEffect } from 'react';
import { MessageSquare, Send, QrCode, Phone, AlertCircle, Copy, Check } from 'lucide-react';
import { Modal } from '../../components/common/Modal';
import { ReminderItem, SenderProfile } from './types';
import { composeWhatsAppReminder } from './whatsapp';
import { buildUpiString, generateQrDataUrl } from '../../lib/upi';
import { formatPaise } from '../../lib/tax';

interface WhatsAppModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: ReminderItem | null;
  sender: SenderProfile;
}

export const WhatsAppModal: React.FC<WhatsAppModalProps> = ({
  isOpen,
  onClose,
  item,
  sender,
}) => {
  const [customNote, setCustomNote] = useState<string>('');
  const [qrCodeUrl, setQrCodeUrl] = useState<string>('');
  const [isCopied, setIsCopied] = useState(false);

  useEffect(() => {
    if (item) {
      setCustomNote(item.note || '');
    }
  }, [item]);

  // Generate UPI QR code for visual presentation
  useEffect(() => {
    let isMounted = true;
    if (!item || !sender.upiVpa) {
      setQrCodeUrl('');
      return;
    }

    const upiUri = buildUpiString({
      vpa: sender.upiVpa,
      payeeName: sender.businessName,
      amountPaise: item.balanceDuePaise,
      invoiceNumber: item.invoiceNumber,
      note: customNote || 'Payment Due Settlement',
    });

    generateQrDataUrl(upiUri, { width: 160 })
      .then((url) => {
        if (isMounted) setQrCodeUrl(url);
      })
      .catch((err) => console.error('Failed to generate reminder UPI QR:', err));

    return () => {
      isMounted = false;
    };
  }, [item?.balanceDuePaise, item?.invoiceNumber, sender.upiVpa, sender.businessName, customNote]);

  // Clean up copy feedback timer
  useEffect(() => {
    let timer: any = null;
    if (isCopied) {
      timer = setTimeout(() => setIsCopied(false), 2000);
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [isCopied]);

  if (!item) return null;

  const currentItem: ReminderItem = {
    ...item,
    note: customNote,
  };

  const reminder = composeWhatsAppReminder(currentItem, sender);

  const handleSendWhatsApp = () => {
    if (reminder.whatsAppUrl) {
      window.open(reminder.whatsAppUrl, '_blank', 'noopener,noreferrer');
      onClose();
    }
  };

  const handleCopyMessage = () => {
    navigator.clipboard.writeText(reminder.messageText);
    setIsCopied(true);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="WhatsApp Smart Payment Reminder"
      icon={<MessageSquare className="w-5 h-5 text-emerald-400" />}
      width="max-w-xl"
    >
      <div className="p-5 space-y-4 text-slate-200">
        {/* Header Summary */}
        <div className="flex items-center justify-between p-3.5 bg-slate-800/80 border border-slate-700/60 rounded-lg">
          <div>
            <div className="text-xs text-slate-400 font-medium">Customer / Party</div>
            <div className="text-base font-bold text-slate-100">{item.partyName}</div>
            <div className="flex items-center text-xs text-slate-400 mt-0.5">
              <Phone className="w-3.5 h-3.5 mr-1 text-slate-500" />
              <span>{item.partyPhone || 'No Phone Registered'}</span>
              {reminder.cleanPhone && (
                <span className="ml-2 text-emerald-400 font-mono">({reminder.cleanPhone})</span>
              )}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-slate-400 font-medium">Pending Balance</div>
            <div className="text-xl font-mono font-bold text-rose-400">
              {formatPaise(item.balanceDuePaise)}
            </div>
            {item.invoiceNumber && (
              <div className="text-xs text-slate-400">Ref: #{item.invoiceNumber}</div>
            )}
          </div>
        </div>

        {/* Validation Error banner if phone is invalid */}
        {!reminder.isValid && (
          <div className="flex items-center p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-300 text-sm">
            <AlertCircle className="w-4 h-4 mr-2 shrink-0 text-amber-400" />
            <span>{reminder.validationError || 'Invalid phone number for WhatsApp dispatch.'}</span>
          </div>
        )}

        {/* Custom Note input */}
        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1">
            Custom Reminder Note / Invoice Reference
          </label>
          <input
            type="text"
            value={customNote}
            onChange={(e) => setCustomNote(e.target.value)}
            placeholder="e.g. Overdue by 7 days, please clear to avoid interest"
            className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-md text-sm text-slate-100 focus:outline-none focus:border-emerald-500 transition-colors"
          />
        </div>

        {/* Content Layout: Preview & Optional Dynamic QR */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="md:col-span-2">
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Live Message Preview
            </label>
            <div className="relative">
              <textarea
                readOnly
                value={reminder.messageText}
                rows={7}
                className="w-full p-2.5 bg-slate-950 border border-slate-800 rounded-md text-xs font-mono text-emerald-300 resize-none select-all focus:outline-none"
              />
              <button
                type="button"
                onClick={handleCopyMessage}
                title="Copy message text"
                className="absolute top-2 right-2 px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs flex items-center space-x-1 border border-slate-700"
              >
                {isCopied ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-400" />
                    <span className="text-emerald-400">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" />
                    <span>Copy</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* QR Code preview for Counter Display */}
          <div className="flex flex-col items-center justify-center p-2.5 bg-slate-950/60 border border-slate-800 rounded-md text-center">
            <div className="text-[11px] font-medium text-slate-400 mb-1 flex items-center">
              <QrCode className="w-3 h-3 mr-1 text-slate-400" />
              <span>Counter Scan QR</span>
            </div>
            {qrCodeUrl ? (
              <img
                src={qrCodeUrl}
                alt="UPI Payment QR"
                className="w-28 h-28 rounded bg-white p-1 border border-slate-700 shadow"
              />
            ) : (
              <div className="w-28 h-28 flex flex-col items-center justify-center bg-slate-900 border border-dashed border-slate-700 rounded text-slate-500 text-[10px] p-1">
                <span>Configure UPI VPA in Settings for Dynamic QR</span>
              </div>
            )}
            <div className="text-[10px] text-slate-400 font-mono mt-1 truncate max-w-full">
              {sender.upiVpa || 'No VPA'}
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end space-x-3 pt-2 border-t border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium rounded-md transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!reminder.isValid}
            onClick={handleSendWhatsApp}
            className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed text-white text-sm font-bold rounded-md flex items-center space-x-2 transition-colors shadow-lg shadow-emerald-950/50"
          >
            <Send className="w-4 h-4" />
            <span>Open in WhatsApp</span>
          </button>
        </div>
      </div>
    </Modal>
  );
};
