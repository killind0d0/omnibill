import { useEffect, useRef } from 'react';

export interface BarcodeScannerOptions {
  onScan: (barcode: string) => void;
  minChars?: number;
  maxIntervalMs?: number; // max time between keystrokes to be considered barcode scan (default 60ms)
  debounceMs?: number;    // debounce against duplicate reads (default 300ms)
  enabled?: boolean;
}

export function useBarcodeScanner({
  onScan,
  minChars = 3,
  maxIntervalMs = 60,
  debounceMs = 300,
  enabled = true,
}: BarcodeScannerOptions) {
  const bufferRef = useRef<string[]>([]);
  const lastKeyTimeRef = useRef<number>(0);
  const lastScanTimeRef = useRef<number>(0);
  const lastScannedBarcodeRef = useRef<string>('');
  const onScanRef = useRef(onScan);

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore functional modifier keys
      if (['Control', 'Alt', 'Meta', 'Shift', 'CapsLock', 'Tab'].includes(e.key)) {
        return;
      }

      const now = Date.now();
      const timeSinceLastKey = now - lastKeyTimeRef.current;
      lastKeyTimeRef.current = now;

      // If time between keystrokes was too long, reset buffer
      if (timeSinceLastKey > maxIntervalMs) {
        bufferRef.current = [];
      }

      if (e.key === 'Enter') {
        if (bufferRef.current.length >= minChars) {
          const barcode = bufferRef.current.join('').trim();
          bufferRef.current = [];

          if (barcode.length >= minChars) {
            // Intercept and prevent default Enter actions
            e.preventDefault();
            e.stopPropagation();

            // 300ms debounce guard against duplicate scans
            const isDuplicate =
              now - lastScanTimeRef.current < debounceMs &&
              lastScannedBarcodeRef.current === barcode;

            if (!isDuplicate) {
              lastScanTimeRef.current = now;
              lastScannedBarcodeRef.current = barcode;

              // Clear active input value if focused during wedge scan
              if (
                document.activeElement &&
                (document.activeElement instanceof HTMLInputElement ||
                  document.activeElement instanceof HTMLTextAreaElement)
              ) {
                document.activeElement.value = '';
                document.activeElement.dispatchEvent(new Event('input', { bubbles: true }));
              }

              onScanRef.current(barcode);
            }
          }
        } else {
          bufferRef.current = [];
        }
        return;
      }

      // Accumulate printable characters
      if (e.key.length === 1) {
        bufferRef.current.push(e.key);
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [enabled, minChars, maxIntervalMs, debounceMs]);
}
