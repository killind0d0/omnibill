// ui/src/lib/shiftManager.ts
// Cash Drawer Shift Accounting & Z-Report Settlement Engine

import { ErpStorageService } from './erpStorage';

export interface ShiftDenominations {
  d500: number;
  d200: number;
  d100: number;
  d50: number;
  d20: number;
  d10: number;
  coins_paise: number;
}

export interface ShiftRecord {
  id: string;
  shift_number: number;
  operator_name: string;
  counter_id: string;
  store_name: string;
  start_time: string;
  end_time: string | null;
  status: 'OPEN' | 'CLOSED';
  
  // Float & Cash movements
  opening_float_paise: number;
  cash_sales_paise: number;
  upi_sales_paise: number;
  card_sales_paise: number;
  other_sales_paise: number;
  cash_refunds_paise: number;
  upi_refunds_paise: number;
  card_refunds_paise: number;
  cash_in_paise: number;
  petty_cash_expenses_paise: number;
  total_bills_count: number;
  no_sale_count: number;
  
  // Settlement fields (calculated at closing)
  expected_cash_paise: number;
  actual_cash_paise: number;
  variance_paise: number; // positive = over, negative = short
  denominations?: ShiftDenominations;
  closing_notes?: string;
}

const STORAGE_KEY_CURRENT_SHIFT = 'omnibill_current_shift_v1';
const STORAGE_KEY_SHIFT_HISTORY = 'omnibill_shift_history_v1';

export class ShiftManager {
  private currentShift: ShiftRecord | null = null;
  private history: ShiftRecord[] = [];

  constructor() {
    if (typeof window !== 'undefined') {
      try {
        const storedCurrent = localStorage.getItem(STORAGE_KEY_CURRENT_SHIFT);
        if (storedCurrent) {
          this.currentShift = JSON.parse(storedCurrent);
        }

        const storedHistory = localStorage.getItem(STORAGE_KEY_SHIFT_HISTORY);
        if (storedHistory) {
          this.history = JSON.parse(storedHistory);
        }
      } catch (e) {
        console.warn('Failed to load shift records from storage:', e);
      }
    }
  }

  private saveState(): void {
    if (typeof window === 'undefined') return;
    try {
      if (this.currentShift) {
        const serialized = JSON.stringify(this.currentShift);
        localStorage.setItem(STORAGE_KEY_CURRENT_SHIFT, serialized);
        ErpStorageService.syncKeyToBackend(STORAGE_KEY_CURRENT_SHIFT, serialized);
      } else {
        localStorage.removeItem(STORAGE_KEY_CURRENT_SHIFT);
        ErpStorageService.syncKeyToBackend(STORAGE_KEY_CURRENT_SHIFT, '');
      }
      const histStr = JSON.stringify(this.history);
      localStorage.setItem(STORAGE_KEY_SHIFT_HISTORY, histStr);
      ErpStorageService.syncKeyToBackend(STORAGE_KEY_SHIFT_HISTORY, histStr);
    } catch (e) {
      console.warn('Failed to save shift state:', e);
    }
  }

  public getCurrentShift(): ShiftRecord | null {
    return this.currentShift ? { ...this.currentShift } : null;
  }

  public getShiftHistory(): ShiftRecord[] {
    return [...this.history];
  }

  // Open a new shift
  public openShift(
    operatorName: string,
    counterId: string,
    storeName: string,
    openingFloatPaise: number
  ): ShiftRecord {
    const shiftNumber = this.history.length + 1;
    const newShift: ShiftRecord = {
      id: `shift_${Date.now()}_${shiftNumber}`,
      shift_number: shiftNumber,
      operator_name: operatorName,
      counter_id: counterId,
      store_name: storeName,
      start_time: new Date().toISOString(),
      end_time: null,
      status: 'OPEN',
      opening_float_paise: Math.max(0, openingFloatPaise),
      cash_sales_paise: 0,
      upi_sales_paise: 0,
      card_sales_paise: 0,
      other_sales_paise: 0,
      cash_refunds_paise: 0,
      upi_refunds_paise: 0,
      card_refunds_paise: 0,
      cash_in_paise: 0,
      petty_cash_expenses_paise: 0,
      total_bills_count: 0,
      no_sale_count: 0,
      expected_cash_paise: Math.max(0, openingFloatPaise),
      actual_cash_paise: 0,
      variance_paise: 0,
    };

    this.currentShift = newShift;
    this.saveState();
    return { ...newShift };
  }

  // Record a transaction into active shift
  public recordTransaction(
    paymentMode: string,
    amountPaise: number,
    isRefund: boolean = false
  ): void {
    if (!this.currentShift || this.currentShift.status !== 'OPEN') return;

    if (isRefund) {
      switch (paymentMode) {
        case 'CASH':
          this.currentShift.cash_refunds_paise += amountPaise;
          break;
        case 'UPI':
          this.currentShift.upi_refunds_paise = (this.currentShift.upi_refunds_paise || 0) + amountPaise;
          break;
        case 'CARD':
          this.currentShift.card_refunds_paise = (this.currentShift.card_refunds_paise || 0) + amountPaise;
          break;
      }
    } else {
      this.currentShift.total_bills_count += 1;
      switch (paymentMode) {
        case 'CASH':
          this.currentShift.cash_sales_paise += amountPaise;
          break;
        case 'UPI':
          this.currentShift.upi_sales_paise += amountPaise;
          break;
        case 'CARD':
          this.currentShift.card_sales_paise += amountPaise;
          break;
        default:
          this.currentShift.other_sales_paise += amountPaise;
          break;
      }
    }

    this.recalculateExpectedCash();
  }

  // Record petty cash expense or cash drop
  public recordPettyCash(amountPaise: number): void {
    if (!this.currentShift || this.currentShift.status !== 'OPEN') return;
    this.currentShift.petty_cash_expenses_paise += amountPaise;
    this.recalculateExpectedCash();
  }

  // Record cash-in / float top up
  public recordCashIn(amountPaise: number): void {
    if (!this.currentShift || this.currentShift.status !== 'OPEN') return;
    this.currentShift.cash_in_paise = (this.currentShift.cash_in_paise || 0) + amountPaise;
    this.recalculateExpectedCash();
  }

  // Record no-sale drawer opening
  public recordNoSale(): void {
    if (!this.currentShift || this.currentShift.status !== 'OPEN') return;
    this.currentShift.no_sale_count = (this.currentShift.no_sale_count || 0) + 1;
    this.saveState();
  }

  private recalculateExpectedCash(): void {
    if (!this.currentShift) return;
    this.currentShift.expected_cash_paise =
      this.currentShift.opening_float_paise +
      (this.currentShift.cash_in_paise || 0) +
      this.currentShift.cash_sales_paise -
      this.currentShift.cash_refunds_paise -
      this.currentShift.petty_cash_expenses_paise;
    this.saveState();
  }

  // Compute total from denomination counts
  public static calculateDenominationTotalPaise(denoms: ShiftDenominations): number {
    return (
      denoms.d500 * 500 * 100 +
      denoms.d200 * 200 * 100 +
      denoms.d100 * 100 * 100 +
      denoms.d50 * 50 * 100 +
      denoms.d20 * 20 * 100 +
      denoms.d10 * 10 * 100 +
      denoms.coins_paise
    );
  }

  // Close shift and compute variance
  public closeShift(
    actualCashPaise: number,
    denominations?: ShiftDenominations,
    closingNotes?: string
  ): ShiftRecord {
    if (!this.currentShift) {
      throw new Error('No active shift to close.');
    }

    const expected = this.currentShift.expected_cash_paise;
    const variance = actualCashPaise - expected;

    this.currentShift.end_time = new Date().toISOString();
    this.currentShift.status = 'CLOSED';
    this.currentShift.actual_cash_paise = actualCashPaise;
    this.currentShift.variance_paise = variance;
    this.currentShift.denominations = denominations;
    this.currentShift.closing_notes = closingNotes;

    const closed = { ...this.currentShift };
    this.history.unshift(closed);
    this.currentShift = null;
    this.saveState();

    return closed;
  }
}

export const shiftManager = new ShiftManager();
