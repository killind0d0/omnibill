// ui/src/features/discovery/MultiSelect.tsx
// Accessible searchable multi-select with keyboard navigation and facet counts

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';

export interface MultiSelectOption {
  id: string | number;
  label: string;
  count: number;
}

interface MultiSelectProps {
  label: string;
  options: MultiSelectOption[];
  selected: Array<string | number>;
  onChange: (selected: Array<string | number>) => void;
  placeholder?: string;
}

export const MultiSelect: React.FC<MultiSelectProps> = ({
  label,
  options,
  selected,
  onChange,
  placeholder = 'Select options...',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [focusedIndex, setFocusedIndex] = useState(0);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const filteredOptions = options.filter((opt) =>
    opt.label.toLowerCase().includes(search.toLowerCase().trim())
  );

  const handleToggleOption = useCallback(
    (id: string | number) => {
      if (selected.includes(id)) {
        onChange(selected.filter((item) => item !== id));
      } else {
        onChange([...selected, id]);
      }
    },
    [selected, onChange]
  );

  // Focus management
  useEffect(() => {
    if (isOpen) {
      searchInputRef.current?.focus();
      setFocusedIndex(0);
    } else {
      setSearch('');
    }
  }, [isOpen]);

  // Click outside listener
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        !triggerRef.current?.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
      triggerRef.current?.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusedIndex((prev) => (filteredOptions.length > 0 ? (prev + 1) % filteredOptions.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusedIndex((prev) =>
        filteredOptions.length > 0 ? (prev - 1 + filteredOptions.length) % filteredOptions.length : 0
      );
    } else if (e.key === ' ') {
      // Toggle current item if not typing in text
      if (filteredOptions[focusedIndex]) {
        e.preventDefault();
        handleToggleOption(filteredOptions[focusedIndex].id);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      setIsOpen(false);
      triggerRef.current?.focus();
    }
  };

  return (
    <div className="relative inline-block w-full text-left" onKeyDown={handleKeyDown}>
      {/* Trigger Button */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="w-full flex items-center justify-between px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-200 hover:border-slate-500 focus:outline-none focus:border-blue-500 transition cursor-pointer"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span className="truncate">
          <span className="text-slate-400 font-medium mr-1.5">{label}:</span>
          {selected.length === 0 ? (
            <span className="text-slate-500">{placeholder}</span>
          ) : (
            <span className="text-white font-semibold">
              {selected.length === 1
                ? options.find((o) => o.id === selected[0])?.label || `${selected[0]}`
                : `${selected.length} selected`}
            </span>
          )}
        </span>
        <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0 ml-1.5" />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          ref={dropdownRef}
          className="absolute z-30 mt-1 w-full min-w-[220px] bg-slate-900 border border-slate-700 rounded-lg shadow-xl py-1 text-xs text-slate-200 overflow-hidden"
          role="listbox"
        >
          {/* Search Bar inside Dropdown */}
          <div className="px-2 py-1.5 border-b border-slate-800 flex items-center">
            <Search className="w-3.5 h-3.5 text-slate-400 mr-1.5 shrink-0" />
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setFocusedIndex(0);
              }}
              placeholder="Search..."
              className="w-full bg-transparent text-xs text-white placeholder-slate-500 focus:outline-none"
            />
            {search && (
              <button onClick={() => setSearch('')} className="text-slate-500 hover:text-slate-300">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Options List */}
          <div className="max-h-56 overflow-y-auto py-1">
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-2 text-slate-500 text-center">No options found</div>
            ) : (
              filteredOptions.map((opt, idx) => {
                const isChecked = selected.includes(opt.id);
                const isFocused = idx === focusedIndex;

                return (
                  <div
                    key={opt.id}
                    onClick={() => handleToggleOption(opt.id)}
                    className={`px-3 py-1.5 flex items-center justify-between cursor-pointer transition-colors ${
                      isFocused ? 'bg-blue-950/70 text-white' : 'hover:bg-slate-800 text-slate-300'
                    }`}
                    role="option"
                    aria-selected={isChecked}
                  >
                    <div className="flex items-center space-x-2 truncate mr-2">
                      <div
                        className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${
                          isChecked
                            ? 'bg-blue-600 border-blue-500 text-white'
                            : 'border-slate-600 bg-slate-950'
                        }`}
                      >
                        {isChecked && <Check className="w-2.5 h-2.5" />}
                      </div>
                      <span className="truncate">{opt.label}</span>
                    </div>
                    <span className="text-[10px] font-mono text-slate-500 shrink-0">
                      {opt.count}
                    </span>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer Reset & Apply */}
          {selected.length > 0 && (
            <div className="px-2 py-1 border-t border-slate-800 flex justify-between items-center text-[11px] bg-slate-950/50">
              <button
                type="button"
                onClick={() => onChange([])}
                className="text-slate-400 hover:text-rose-400 font-medium"
              >
                Clear all
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  triggerRef.current?.focus();
                }}
                className="px-2 py-0.5 bg-blue-600 text-white rounded font-medium hover:bg-blue-500"
              >
                Done
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
