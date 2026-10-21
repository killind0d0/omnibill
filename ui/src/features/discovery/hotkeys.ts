// ui/src/features/discovery/hotkeys.ts
// Hotkey registry for Discovery Hub (active within Discovery page only, unmounted on exit)

import { useEffect } from 'react';
import { Preset, SortSpec } from './types';

export interface HotkeyActions {
  onFocusSearch: () => void;
  onApplyFastMovers: () => void;
  onCycleExpiring: () => void;
  onCycleDeadStock: () => void;
  onApplyBelowReorder: () => void;
  onNavigateSellGraph: () => void;
  onToggleBrandFilter: () => void;
  onToggleSupplierFilter: () => void;
  onToggleDateFilter: () => void;
  onClearFilterStep: () => void;
  onTriggerExport: () => void;
}

/**
 * Discovery Page Hotkey Table:
 * - "/" or Ctrl+K      : Focus search input
 * - Alt+1              : Fast movers (Preset Fast + sort Velocity Desc)
 * - Alt+2              : Expiring (cycles 30 -> 60 -> 90)
 * - Alt+3              : Dead stock (cycles 30 -> 60 -> 90)
 * - Alt+4              : Below reorder
 * - Alt+5              : Navigate to Sell Graph route
 * - Alt+B              : Open / focus brand filter
 * - Alt+S              : Open / focus supplier filter
 * - Alt+D              : Open / focus date filter
 * - Esc                : Clear latest filter (second Esc clears all)
 * - Ctrl+E             : Export shortcut (placeholder until D5B)
 */
export function useDiscoveryHotkeys(actions: HotkeyActions, enabled = true) {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput =
        target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

      // 1. Esc: Allowed even inside input to blur/clear
      if (e.key === 'Escape') {
        e.preventDefault();
        if (isInput) {
          (target as HTMLElement).blur();
        } else {
          actions.onClearFilterStep();
        }
        return;
      }

      // 2. Ctrl+K or "/" when not typing in text field
      if ((e.ctrlKey && (e.key === 'k' || e.key === 'K')) || (e.key === '/' && !isInput)) {
        e.preventDefault();
        actions.onFocusSearch();
        return;
      }

      // 3. Ctrl+E: Export shortcut
      if (e.ctrlKey && (e.key === 'e' || e.key === 'E')) {
        e.preventDefault();
        actions.onTriggerExport();
        return;
      }

      // Ignore all other shortcuts if typing in an input
      if (isInput) return;

      // 4. Alt+1: Fast movers
      if (e.altKey && e.key === '1') {
        e.preventDefault();
        actions.onApplyFastMovers();
        return;
      }

      // 5. Alt+2: Expiring (cycle 30 -> 60 -> 90)
      if (e.altKey && e.key === '2') {
        e.preventDefault();
        actions.onCycleExpiring();
        return;
      }

      // 6. Alt+3: Dead stock (cycle 30 -> 60 -> 90)
      if (e.altKey && e.key === '3') {
        e.preventDefault();
        actions.onCycleDeadStock();
        return;
      }

      // 7. Alt+4: Below reorder
      if (e.altKey && e.key === '4') {
        e.preventDefault();
        actions.onApplyBelowReorder();
        return;
      }

      // 8. Alt+5: Navigate to Sell Graph route
      if (e.altKey && e.key === '5') {
        e.preventDefault();
        actions.onNavigateSellGraph();
        return;
      }

      // 9. Alt+B: Brand popover / filter
      if (e.altKey && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        actions.onToggleBrandFilter();
        return;
      }

      // 10. Alt+S: Supplier popover / filter
      if (e.altKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        actions.onToggleSupplierFilter();
        return;
      }

      // 11. Alt+D: Date popover / filter
      if (e.altKey && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        actions.onToggleDateFilter();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [actions, enabled]);
}
