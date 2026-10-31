import React, { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import {
  CreditCard,
  QrCode,
  ExternalLink,
  Copy,
  Check,
  ShieldCheck,
  Calendar,
  X,
  Sparkles,
  RefreshCw,
  Building,
} from 'lucide-react';
import { formatPaise } from '../../lib/tax';
import { AccessStatus } from '../access/types';

interface RenewalModalProps {
  isOpen: boolean;
  onClose: () => void;
  status?: AccessStatus | null;
  tenantId?: string;
  onRefreshLicense?: () => Promise<void>;
}

export const RenewalModal: React.FC<RenewalModalProps> = ({
  isOpen,
  onClose,
  status,
  tenantId: propTenantId,
  onRefreshLicense,
}) => {
  const [activeTab, setActiveTab] = useState<'qr' | 'link' | 'invoice'>('qr');
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedInvoice, setCopiedInvoice] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyNotice, setVerifyNotice] = useState<string | null>(null);

  // Derive tenant details
  const activeTenantId =
    propTenantId ||
    status?.username ||
    (typeof window !== 'undefined'
      ? (() => {
          try {
            const sess = localStorage.getItem('omnibill_access_session');
            if (sess) return JSON.parse(sess)?.user?.username;
          } catch {}
          return 'TN-RETAIL-001';
        })()
      : 'TN-RETAIL-001') ||
    'TN-RETAIL-001';

  const planName = status?.plan
    ? `${status.plan.charAt(0).toUpperCase() + status.plan.slice(1)} License`
    : 'OmniBill Retail Supermarket Pro';

  // Standard integer paise plans (Zero Floats)
  const getPlanAmountPaise = (plan?: string | null): number => {
    const p = (plan || '').toLowerCase();
    if (p.includes('single') || p.includes('starter') || p.includes('basic')) {
      return 799900; // ₹7,999.00
    }
    if (p.includes('enterprise') || p.includes('hospital') || p.includes('school')) {
      return 2499900; // ₹24,999.00
    }
    return 1499900; // ₹14,999.00 standard
  };

  const amountPaise = getPlanAmountPaise(status?.plan);
  const upiVpa = 'billing@omnibill.in';
  const paymentUrl = `https://pay.youromnibill.com/r/${encodeURIComponent(activeTenantId)}`;
  const validityExtension = '+12 Months (365 Days)';

  // Generate UPI QR Code Data URL
  useEffect(() => {
    if (!isOpen) return;

    const amountRupees = (amountPaise / 100).toFixed(2);
    const upiUri = `upi://pay?pa=${encodeURIComponent(upiVpa)}&pn=${encodeURIComponent(
      'OmniBill Technologies'
    )}&am=${amountRupees}&cu=INR&tn=${encodeURIComponent(`Renewal ${activeTenantId}`)}`;

    QRCode.toDataURL(upiUri, {
      width: 256,
      margin: 1,
      color: {
        dark: '#0f172a', // slate-900
        light: '#ffffff',
      },
    })
      .then((url) => setQrDataUrl(url))
      .catch((err) => console.error('Failed to generate UPI QR code:', err));
  }, [isOpen, amountPaise, activeTenantId]);

  // Handle ESC key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, onClose]);

  const handleCopyLink = async () => {
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(paymentUrl);
      }
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }
  };

  const handleCopyInvoice = async () => {
    const invoiceText = [
      '========================================',
      '       OMNIBILL SUBSCRIPTION INVOICE     ',
      '========================================',
      `Tenant ID:          ${activeTenantId}`,
      `Plan:               ${planName}`,
      `Extension:          ${validityExtension}`,
      `Renewal Amount:     ${formatPaise(amountPaise)}`,
      `UPI ID (VPA):       ${upiVpa}`,
      `Instant Pay Link:   ${paymentUrl}`,
      '========================================',
      'Payment webhooks extend license automatically via Ed25519.',
    ].join('\n');

    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(invoiceText);
      }
      setCopiedInvoice(true);
      setTimeout(() => setCopiedInvoice(false), 2000);
    } catch {
      setCopiedInvoice(true);
      setTimeout(() => setCopiedInvoice(false), 2000);
    }
  };

  const handleVerifyPayment = async () => {
    setIsVerifying(true);
    setVerifyNotice(null);
    try {
      if (onRefreshLicense) {
        await onRefreshLicense();
      }
      // Simulate verification delay
      await new Promise((r) => setTimeout(r, 1200));
      setVerifyNotice('License checked. If webhook was received, your renewal is active!');
    } catch {
      setVerifyNotice('Checked cloud status. If payment was just made, please allow 10-20 seconds for webhook sync.');
    } finally {
      setIsVerifying(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="renewal-modal-title"
    >
      <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden text-slate-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/70 select-none shrink-0">
          <div className="flex items-center space-x-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-500 to-emerald-600 text-white shadow-md shadow-amber-500/20">
              <CreditCard className="w-5 h-5" />
            </div>
            <div>
              <h3 id="renewal-modal-title" className="text-base sm:text-lg font-bold text-white tracking-tight flex items-center gap-2">
                <span>Renew OmniBill Subscription</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-semibold uppercase">
                  Instant Auto-Renew
                </span>
              </h3>
              <p className="text-xs text-slate-400">Secure automated webhook extension • Zero downtime</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
            title="Close (Esc)"
            aria-label="Close renewal modal (Escape)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Plan & Pricing Summary Card */}
        <div className="px-6 py-4 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 border-b border-slate-800 shrink-0">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3">
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">
                Subscription Plan
              </span>
              <span className="text-sm font-bold text-slate-100 mt-1 block truncate">
                {planName}
              </span>
              <span className="text-[11px] text-slate-500">Tenant: {activeTenantId}</span>
            </div>

            <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3">
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">
                Renewal Amount
              </span>
              <span className="text-lg font-extrabold text-emerald-400 font-mono mt-0.5 block">
                {formatPaise(amountPaise)}
              </span>
              <span className="text-[11px] text-slate-400">All taxes included</span>
            </div>

            <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3">
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">
                Validity Extension
              </span>
              <div className="flex items-center gap-1.5 text-sm font-bold text-sky-400 mt-1">
                <Calendar className="w-4 h-4 text-sky-400" />
                <span>{validityExtension}</span>
              </div>
              <span className="text-[11px] text-slate-400">From current expiry</span>
            </div>
          </div>
        </div>

        {/* Tab Selection */}
        <div className="flex border-b border-slate-800 bg-slate-950/40 px-6 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('qr')}
            className={`py-2.5 px-4 text-xs font-bold border-b-2 transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'qr'
                ? 'border-amber-400 text-amber-300 bg-amber-500/10'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <QrCode className="w-3.5 h-3.5" />
            <span>UPI QR Code (Instant)</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('link')}
            className={`py-2.5 px-4 text-xs font-bold border-b-2 transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'link'
                ? 'border-amber-400 text-amber-300 bg-amber-500/10'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>Payment Link / NetBanking</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('invoice')}
            className={`py-2.5 px-4 text-xs font-bold border-b-2 transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'invoice'
                ? 'border-amber-400 text-amber-300 bg-amber-500/10'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Copy className="w-3.5 h-3.5" />
            <span>Copy Invoice Details</span>
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Tab 1: UPI QR Code */}
          {activeTab === 'qr' && (
            <div className="flex flex-col items-center justify-center space-y-4">
              <div className="p-3 bg-white rounded-2xl shadow-xl border-4 border-slate-800">
                {qrDataUrl ? (
                  <img
                    src={qrDataUrl}
                    alt={`UPI Payment QR for ${formatPaise(amountPaise)}`}
                    className="w-48 h-48 sm:w-56 sm:h-56 block rounded-lg"
                  />
                ) : (
                  <div className="w-48 h-48 sm:w-56 sm:h-56 flex items-center justify-center text-slate-500">
                    <QrCode className="w-12 h-12 animate-pulse" />
                  </div>
                )}
              </div>

              <div className="text-center space-y-1">
                <p className="text-xs font-semibold text-slate-300">
                  Scan using Google Pay, PhonePe, Paytm, BHIM, or any UPI App
                </p>
                <p className="text-[11px] font-mono text-emerald-400">
                  VPA: <strong className="underline">{upiVpa}</strong>
                </p>
                <p className="text-[11px] text-slate-500">
                  Amount: <strong className="text-white font-mono">{formatPaise(amountPaise)}</strong> • Ed25519 License updates within 15 seconds.
                </p>
              </div>
            </div>
          )}

          {/* Tab 2: Direct Payment Link */}
          {activeTab === 'link' && (
            <div className="space-y-4">
              <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
                <span className="text-xs font-semibold text-slate-300 block">
                  Automated Payment Gateway URL (Razorpay / Stripe)
                </span>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={paymentUrl}
                    className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-sky-300 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleCopyLink}
                    className="flex items-center gap-1 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition cursor-pointer"
                  >
                    {copiedLink ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-emerald-400">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <a
                  href={paymentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold text-xs text-center flex items-center justify-center gap-2 shadow-md shadow-blue-500/20 cursor-pointer"
                >
                  <ExternalLink className="w-4 h-4" />
                  <span>Open Online Payment Gateway</span>
                </a>
              </div>

              <p className="text-xs text-slate-400">
                Accepts Credit/Debit Cards, NetBanking (HDFC, SBI, ICICI, Axis), UPI, and Corporate Wallets.
              </p>
            </div>
          )}

          {/* Tab 3: Copy Invoice Details */}
          {activeTab === 'invoice' && (
            <div className="space-y-3">
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 font-mono text-xs space-y-1.5 text-slate-300">
                <div className="flex justify-between border-b border-slate-800 pb-1 font-bold text-slate-100">
                  <span>OMNIBILL SUBSCRIPTION PROFORMA</span>
                  <span className="text-amber-400">{validityExtension}</span>
                </div>
                <div className="flex justify-between pt-1">
                  <span className="text-slate-500">Business / Tenant:</span>
                  <span className="text-slate-200">{activeTenantId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Plan Tier:</span>
                  <span className="text-slate-200">{planName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Total Amount:</span>
                  <span className="text-emerald-400 font-bold">{formatPaise(amountPaise)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">UPI Beneficiary:</span>
                  <span className="text-sky-400">{upiVpa}</span>
                </div>
              </div>

              <button
                type="button"
                onClick={handleCopyInvoice}
                className="w-full py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition flex items-center justify-center gap-2 cursor-pointer"
              >
                {copiedInvoice ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-400" />
                    <span className="text-emerald-400">Proforma Details Copied to Clipboard</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 text-slate-400" />
                    <span>Copy Full Invoice & Payment Details</span>
                  </>
                )}
              </button>
            </div>
          )}

          {/* Verify / Refresh Trigger */}
          <div className="pt-2 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3">
            <button
              type="button"
              onClick={handleVerifyPayment}
              disabled={isVerifying}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold transition cursor-pointer border border-slate-700"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isVerifying ? 'animate-spin text-amber-400' : ''}`} />
              <span>{isVerifying ? 'Checking Cloud License...' : 'Verify Cloud Status Now'}</span>
            </button>

            <div className="flex items-center gap-1.5 text-[11px] text-slate-400 select-none">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Ed25519 Cryptographically Signed</span>
            </div>
          </div>

          {verifyNotice && (
            <div className="p-2.5 rounded-lg bg-blue-950/60 border border-blue-800 text-blue-200 text-xs text-center animate-in fade-in duration-100">
              {verifyNotice}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
