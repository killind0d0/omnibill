// ui/src/features/discovery/useScannerDetect.ts
// Fast barcode scanner hardware detector (gap < 60ms, length >= 3, ending in Enter)

import { useEffect, useRef } from 'react';

interface ScannerDetectOptions {
  onScan: (scannedText: string) => void;
  maxGapMs?: number;
  minChars?: number;
  enabled?: boolean;
}

export function useScannerDetect({
  onScan,
  maxGapMs = 60,
  minChars = 3,
  enabled = true,
}: ScannerDetectOptions) {
  const bufferRef = useRef<Array<{ char: string; time: number }>>([]);

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore key events if target is an editable input or textarea
      const target = e.target as HTMLElement | null;
      const isInput =
        target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

      const now = performance.now();

      if (e.key === 'Enter') {
        const buf = bufferRef.current;
        if (buf.length >= minChars) {
          // Check if all gaps were under maxGapMs
          let isScanner = true;
          for (let i = 1; i < buf.length; i++) {
            if (buf[i].time - buf[i - 1].time > maxGapMs) {
              isScanner = false;
              break;
            }
          }
          if (isScanner) {
            const scanned = buf.map((b) => b.char).join('');
            e.preventDefault();
            e.stopPropagation();
            onScan(scanned);
            bufferRef.current = [];
            return;
          }
        }
        bufferRef.current = [];
        return;
      }

      // Only single character printable keys
      if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
        const buf = bufferRef.current;
        if (buf.length > 0 && now - buf[buf.length - 1].time > maxGapMs) {
          bufferRef.current = [];
        }
        // If not focused on an input, capture for scanner detection
        if (!isInput) {
          bufferRef.current.push({ char: e.key, time: now });
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [enabled, onScan, maxGapMs, minChars]);
}
