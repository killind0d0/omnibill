import React, { useRef, useEffect } from 'react';
import { Delete, CornerDownLeft, Sparkles, Hash, Barcode } from 'lucide-react';

interface NumpadQuickEntryProps {
  value: string;
  onChange: (val: string) => void;
  onSubmit: (val: string) => void;
  onOpenItemSearch: () => void;
}

export const NumpadQuickEntry: React.FC<NumpadQuickEntryProps> = ({
  value,
  onChange,
  onSubmit,
  onOpenItemSearch,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep input focused unless modal is open
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyPress = (char: string) => {
    onChange(value + char);
    inputRef.current?.focus();
  };

  const handleClear = () => {
    onChange('');
    inputRef.current?.focus();
  };

  const handleBackspace = () => {
    onChange(value.slice(0, -1));
    inputRef.current?.focus();
  };

  const handleSubmit = () => {
    if (value.trim()) {
      onSubmit(value.trim());
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex flex-col space-y-2.5 shadow-md">
      {/* Header & Syntax Hint */}
      <div className="flex items-center justify-between text-xs text-slate-400 select-none">
        <div className="flex items-center space-x-1.5 font-medium text-slate-300">
          <Hash className="w-3.5 h-3.5 text-blue-400" />
          <span>Quick Entry Bar</span>
        </div>
        <div className="flex items-center space-x-1 font-mono text-[11px] text-blue-400/90 bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20">
          <Sparkles className="w-3 h-3" />
          <span>Qty * Price (e.g. 3*120) or Barcode</span>
        </div>
      </div>

      {/* Main Input Field */}
      <div className="flex items-center space-x-2">
        <div className="relative flex-1">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
            <Barcode className="w-4 h-4" />
          </div>
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder="Scan barcode, or type '3*120' or SKU..."
            className="w-full bg-slate-950 border border-slate-700 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 rounded-lg pl-9 pr-4 py-2 font-mono text-sm text-white placeholder-slate-500 transition-all"
            autoComplete="off"
            spellCheck="false"
          />
        </div>
        <button
          type="button"
          onClick={handleSubmit}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 shadow-sm shadow-blue-600/30 transition-all cursor-pointer"
        >
          <span>Enter</span>
          <CornerDownLeft className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Quick Quantity Presets */}
      <div className="flex items-center space-x-1.5 select-none">
        <span className="text-[11px] text-slate-500 uppercase font-semibold">Qty:</span>
        {['1', '2', '3', '5', '10'].map((qty) => (
          <button
            key={qty}
            type="button"
            onClick={() => {
              if (value.includes('*')) {
                const parts = value.split('*');
                onChange(`${qty}*${parts[1] || ''}`);
              } else {
                onChange(`${qty}*`);
              }
              inputRef.current?.focus();
            }}
            className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs font-mono transition-colors"
          >
            {qty}x
          </button>
        ))}
        <div className="flex-1" />
        <button
          type="button"
          onClick={onOpenItemSearch}
          className="text-xs text-blue-400 hover:text-blue-300 underline underline-offset-2 transition-colors"
        >
          Catalog Search (F3)
        </button>
      </div>

      {/* Compact On-Screen Numpad Grid */}
      <div className="grid grid-cols-4 gap-1.5 select-none pt-1">
        {['7', '8', '9'].map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => handleKeyPress(k)}
            className="h-9 bg-slate-800/80 hover:bg-slate-700 active:bg-slate-600 text-white font-mono font-medium rounded-lg text-sm transition-colors"
          >
            {k}
          </button>
        ))}
        <button
          type="button"
          onClick={handleClear}
          className="h-9 bg-red-950/40 hover:bg-red-900/60 active:bg-red-800/80 border border-red-800/30 text-red-300 font-mono font-semibold rounded-lg text-xs transition-colors"
        >
          CLR
        </button>

        {['4', '5', '6'].map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => handleKeyPress(k)}
            className="h-9 bg-slate-800/80 hover:bg-slate-700 active:bg-slate-600 text-white font-mono font-medium rounded-lg text-sm transition-colors"
          >
            {k}
          </button>
        ))}
        <button
          type="button"
          onClick={() => handleKeyPress('*')}
          className="h-9 bg-indigo-950/40 hover:bg-indigo-900/60 active:bg-indigo-800/80 border border-indigo-800/30 text-indigo-300 font-mono font-bold rounded-lg text-base transition-colors"
          title="Multiply Qty * Rate"
        >
          *
        </button>

        {['1', '2', '3'].map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => handleKeyPress(k)}
            className="h-9 bg-slate-800/80 hover:bg-slate-700 active:bg-slate-600 text-white font-mono font-medium rounded-lg text-sm transition-colors"
          >
            {k}
          </button>
        ))}
        <button
          type="button"
          onClick={handleBackspace}
          className="h-9 bg-slate-800/80 hover:bg-slate-700 active:bg-slate-600 text-slate-300 rounded-lg flex items-center justify-center transition-colors"
          title="Backspace"
        >
          <Delete className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={() => handleKeyPress('0')}
          className="h-9 bg-slate-800/80 hover:bg-slate-700 active:bg-slate-600 text-white font-mono font-medium rounded-lg text-sm transition-colors"
        >
          0
        </button>
        <button
          type="button"
          onClick={() => handleKeyPress('00')}
          className="h-9 bg-slate-800/80 hover:bg-slate-700 active:bg-slate-600 text-white font-mono font-medium rounded-lg text-xs transition-colors"
        >
          00
        </button>
        <button
          type="button"
          onClick={() => handleKeyPress('.')}
          className="h-9 bg-slate-800/80 hover:bg-slate-700 active:bg-slate-600 text-white font-mono font-bold rounded-lg text-sm transition-colors"
        >
          .
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          className="h-9 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white font-mono font-semibold rounded-lg text-xs flex items-center justify-center transition-colors"
        >
          OK
        </button>
      </div>
    </div>
  );
};
