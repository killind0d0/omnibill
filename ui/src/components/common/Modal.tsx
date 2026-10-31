import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  width?: string;
  icon?: React.ReactNode;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  width = 'max-w-2xl',
  icon,
}) => {
  const modalRef = useRef<HTMLDivElement>(null);

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

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={modalRef}
        className={`relative w-full ${width} bg-slate-900 border border-slate-700/80 rounded-xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-dialog-title"
      >
        {/* Modal Header */}
        <div className="shrink-0 flex items-center justify-between px-5 py-3.5 border-b border-slate-800 bg-slate-900/90 select-none">
          <div className="flex items-center space-x-2.5">
            {icon && <div className="text-blue-400">{icon}</div>}
            <h3 id="modal-dialog-title" className="text-base sm:text-lg font-bold text-slate-100 tracking-wide">{title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors focus-ring"
            title="Close (Esc)"
            aria-label="Close dialog (Escape)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5 text-slate-200">
          {children}
        </div>
      </div>
    </div>
  );
};
