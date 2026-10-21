import React from 'react';
import { AccessStatus } from './types';

interface AccessBannerProps {
  status: AccessStatus;
}

export const AccessBanner: React.FC<AccessBannerProps> = ({ status }) => {
  if (status.mode !== 'read_only') {
    return null;
  }

  const getReasonDetails = (reason?: string | null) => {
    switch (reason) {
      case 'expired':
        return {
          title: 'Subscription Expired',
          desc: 'Your business subscription validity has ended. Invoicing is paused.',
        };
      case 'checkin_required':
        return {
          title: 'Cloud Check-in Required',
          desc: 'Your terminal has reached the maximum offline operating allowance. Connect to the internet to sync license.',
        };
      case 'clock_tampered':
        return {
          title: 'System Clock Inconsistency',
          desc: 'A significant backwards clock skew was detected. Connect to cloud to synchronize timestamp.',
        };
      case 'suspended':
        return {
          title: 'Terminal Suspended',
          desc: 'This business license is currently suspended by vendor administration.',
        };
      case 'bad_signature':
      case 'wrong_device':
      case 'wrong_tenant':
        return {
          title: 'License Validation Mismatch',
          desc: 'Device signature mismatch with license records.',
        };
      default:
        return {
          title: 'Read-Only Mode Active',
          desc: 'New billing transactions are disabled. Historical reports and ledger data remain fully accessible.',
        };
    }
  };

  const info = getReasonDetails(status.reason);

  return (
    <div className="bg-rose-950 border-b border-rose-800 text-rose-200 px-4 py-2.5 shadow-md sticky top-0 z-50">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2.5">
          <span className="px-2 py-0.5 rounded bg-rose-900 border border-rose-700 font-bold uppercase tracking-wider text-[10px] text-white">
            READ-ONLY
          </span>
          <span className="font-bold text-white">{info.title}:</span>
          <span className="text-rose-300">{info.desc}</span>
        </div>

        {status.support_text && (
          <div className="flex items-center gap-1.5 font-medium text-rose-200 bg-rose-900/60 px-2.5 py-1 rounded border border-rose-800/80">
            <svg className="w-3.5 h-3.5 text-rose-300 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
            <span>{status.support_text}</span>
          </div>
        )}
      </div>
    </div>
  );
};
