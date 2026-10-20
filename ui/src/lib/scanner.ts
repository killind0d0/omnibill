import { useEffect, useRef } from 'react';

export interface BarcodeScannerOptions {
  onScan: (barcode: string) => void;
  minChars?: number;
  maxIntervalMs?: number; // max time between keystrokes to be considered barcode scan (default 50ms)
  enabled?: boolean;
}

/**
 * Global Keyboard Wedge Barcode Scanner Listener.
 *
 * Hardware barcode scanners emulate USB/Bluetooth HID keyboards, sending characters
 * in rapid succession (< 30-50ms) followed by an 'Enter' key.
 *
 * This hook captures that keystroke stream even when focus is not inside an input,
 * or even when inside an input, cleanly dispatching `onScan(barcode)`.
 */
export function useBarcodeScanner({
  onScan,
  minChars = 3,
  maxIntervalMs = 60,
  enabled = true,
}: BarcodeScannerOptions) {
  const bufferRef = useRef<string[]>([]);
  const lastKeyTimeRef = useRef<number>(0);
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
          // Rapid keystrokes followed by Enter: it's a barcode scan!
          const barcode = bufferRef.current.join('').trim();
          bufferRef.current = [];

          if (barcode.length >= minChars) {
            // Prevent default form submit or newline
            e.preventDefault();
            e.stopPropagation();
            onScanRef.current(barcode);
          }
        } else {
          bufferRef.current = [];
        }
        return;
      }

      // Only accumulate printable single characters
      if (e.key.length === 1) {
        bufferRef.current.push(e.key);
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [enabled, minChars, maxIntervalMs]);
}
