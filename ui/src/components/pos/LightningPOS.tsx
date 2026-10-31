import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Header } from '../common/Header';
import { CartTable } from './CartTable';
import { NumpadQuickEntry } from './NumpadQuickEntry';
import { TotalsPanel } from './TotalsPanel';
import { ItemSearchModal } from './ItemSearchModal';
import { BusinessDateModal } from './BusinessDateModal';
import { PaymentModal } from './PaymentModal';
import { ThermalReceiptModal } from './ThermalReceiptModal';
import { HelpModal } from './HelpModal';
import { PurchaseEntry } from './PurchaseEntry';
import { useBarcodeScanner } from '../../lib/scanner';
import {
  CartLineItem,
  PriceMode,
  ResourceItem,
  BusinessProfile,
  CompletedSale,
  PaymentDetails,
} from '../../types/pos';
import {
  computeSaleTotals,
  parseQtyToMilli,
  parseRupeesToPaise,
  formatPaise,
} from '../../lib/tax';
import {
  apiGetProducts,
  apiGetBusinessProfile,
  apiPostSale,
  posStorage,
  INITIAL_PRODUCTS,
} from '../../lib/api';
import { posSound } from '../../lib/sound';
import { shiftManager } from '../../lib/shiftManager';
import { ShiftSettlementModal } from './ShiftSettlementModal';
import { CatalogImporterModal } from '../importer/CatalogImporterModal';
import { HeldBillsModal, HeldBill } from './HeldBillsModal';
import { PriceCheckModal } from './PriceCheckModal';
import { LiveSupportModal } from '../../features/support/LiveSupportModal';
import { StoreProfileModal } from '../common/StoreProfileModal';
import { SupervisorPinModal } from './SupervisorPinModal';
import { ConfirmClearModal } from './ConfirmClearModal';
import { UnmappedBarcodeModal } from './UnmappedBarcodeModal';
import { ErpStorageService } from '../../lib/erpStorage';
import { Sparkles, Upload, RotateCcw } from 'lucide-react';

const HELD_BILLS_STORAGE_KEY = 'omnibill_held_bills';

const getInitialHeldBills = (): HeldBill[] => {
  try {
    const raw = localStorage.getItem(HELD_BILLS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

const getActiveUserRole = (): string => {
  try {
    const raw = localStorage.getItem('omnibill_active_session');
    if (raw) {
      const parsed = JSON.parse(raw);
      return parsed.operatorRole || 'OWNER';
    }
  } catch {}
  return 'OWNER';
};

export const LightningPOS: React.FC = () => {
  // Application Modes
  const [activeMode, setActiveMode] = useState<'SALES' | 'PURCHASES'>('SALES');

  // Business State
  const [business, setBusiness] = useState<BusinessProfile>(posStorage.getBusinessProfile());
  const [businessDate, setBusinessDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [products, setProducts] = useState<ResourceItem[]>([]);

  // Cart & Pricing State (CF-19: Restored from localStorage across reloads/power crash)
  const [cartItems, setCartItems] = useState<CartLineItem[]>(() => {
    try {
      const saved = localStorage.getItem('omnibill_active_cart');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return [];
  });
  const [selectedRowIndex, setSelectedRowIndex] = useState<number>(0);
  const [priceMode, setPriceMode] = useState<PriceMode>('EXCLUSIVE');
  const [placeOfSupplyStateCode, setPlaceOfSupplyStateCode] = useState<string>(
    business.state_code || '27'
  );
  // F2 Instant Return / Exchange Mode State
  const [isReturnMode, setIsReturnMode] = useState<boolean>(false);

  // Customer State
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerName, setCustomerName] = useState('');

  // Numpad Quick Entry Value
  const [numpadValue, setNumpadValue] = useState('');

  // Active Completed Sale for Thermal Slip Preview
  const [lastCompletedSale, setLastCompletedSale] = useState<CompletedSale | null>(null);

  // Modal Open States
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isDateModalOpen, setIsDateModalOpen] = useState(false);
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [isReceiptOpen, setIsReceiptOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isShiftModalOpen, setIsShiftModalOpen] = useState(false);
  const [isImporterOpen, setIsImporterOpen] = useState(false);
  const [isHeldBillsOpen, setIsHeldBillsOpen] = useState(false);
  const [isPriceCheckOpen, setIsPriceCheckOpen] = useState(false);
  const [isLiveSupportOpen, setIsLiveSupportOpen] = useState(false);

  // CF-01, CF-02, CF-06, CF-15 Modals & Dialogs
  const [isStoreProfileOpen, setIsStoreProfileOpen] = useState(false);
  const [isSupervisorPinOpen, setIsSupervisorPinOpen] = useState(false);
  const [supervisorAction, setSupervisorAction] = useState<'CLEAR_CART' | 'OVERRIDE_PRICE' | 'HIGH_DISCOUNT' | null>(null);
  const [pendingPriceOverride, setPendingPriceOverride] = useState<{ index: number; newPaise: number } | null>(null);
  const [isConfirmClearOpen, setIsConfirmClearOpen] = useState(false);
  const [isUnmappedBarcodeOpen, setIsUnmappedBarcodeOpen] = useState(false);
  const [unmappedBarcodeValue, setUnmappedBarcodeValue] = useState('');

  // Held / Suspended Bills State
  const [heldBills, setHeldBills] = useState<HeldBill[]>(getInitialHeldBills);

  useEffect(() => {
    try {
      localStorage.setItem(HELD_BILLS_STORAGE_KEY, JSON.stringify(heldBills));
    } catch {}
  }, [heldBills]);

  // CF-19: Synchronize active cart to persistent storage
  useEffect(() => {
    try {
      if (cartItems.length > 0) {
        localStorage.setItem('omnibill_active_cart', JSON.stringify(cartItems));
      } else {
        localStorage.removeItem('omnibill_active_cart');
      }
    } catch {}
  }, [cartItems]);

  // Notification Toast
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((cur) => (cur === msg ? null : cur));
    }, 3000);
  }, []);

  // Quick 1-click loading of sample products for fresh stores
  const handleLoadSampleProducts = async () => {
    posStorage.setProducts(INITIAL_PRODUCTS);
    await refreshProducts();
    posSound.playSuccess();
    showToast('Loaded 15 sample grocery & supermarket items with barcodes!');
  };

  // Load initial products and business profile
  const refreshProducts = useCallback(async () => {
    const list = await apiGetProducts();
    setProducts(list);
  }, []);

  useEffect(() => {
    refreshProducts();
    apiGetBusinessProfile().then((prof) => {
      setBusiness(prof);
      setPlaceOfSupplyStateCode(prof.state_code || '27');
    });

    const handleSync = () => {
      refreshProducts();
    };
    const handleProfileSync = (e: any) => {
      const prof = e?.detail || posStorage.getBusinessProfile();
      setBusiness(prof);
      setPlaceOfSupplyStateCode(prof.state_code || '27');
    };
    window.addEventListener('omnibill_catalog_sync', handleSync);
    window.addEventListener('omnibill_profile_sync', handleProfileSync);
    return () => {
      window.removeEventListener('omnibill_catalog_sync', handleSync);
      window.removeEventListener('omnibill_profile_sync', handleProfileSync);
    };
  }, [refreshProducts]);

  const isIntraState = placeOfSupplyStateCode === business.state_code;

  // Real-time tax & totals calculation mirroring Rust tax.rs
  const taxComputation = useMemo(() => {
    return computeSaleTotals(
      cartItems,
      priceMode,
      business.state_code,
      placeOfSupplyStateCode
    );
  }, [cartItems, priceMode, business.state_code, placeOfSupplyStateCode]);

  // Add product to cart helper
  const addProductToCart = useCallback(
    (product: ResourceItem, qtyMilli = 1000, customUnitPricePaise?: number, forceReturn?: boolean) => {
      const isReturn = forceReturn !== undefined ? forceReturn : isReturnMode;

      // CF-12: Overselling / low stock warning banner
      if (!isReturn && product.stock_milli !== undefined && product.stock_milli >= 0) {
        if (qtyMilli > product.stock_milli) {
          showToast(
            `⚠️ Low Stock Alert: Selling ${(qtyMilli / 1000).toFixed(0)} units with only ${(
              product.stock_milli / 1000
            ).toFixed(0)} in stock!`
          );
        }
      }

      setCartItems((prev) => {
        const existingIdx = prev.findIndex((i) => i.resource_id === product.id && !!i.is_return === isReturn);
        const unitPrice = customUnitPricePaise ?? product.base_price_paise;

        if (existingIdx >= 0) {
          const updated = [...prev];
          const curr = updated[existingIdx];
          const newQty = curr.quantity_milli + qtyMilli;

          // CF-12: Warn if cumulative qty exceeds on-hand stock
          if (!isReturn && product.stock_milli !== undefined && product.stock_milli >= 0 && newQty > product.stock_milli) {
            showToast(
              `⚠️ Stock Warning: Total ${(newQty / 1000).toFixed(0)} units exceeds available stock (${(
                product.stock_milli / 1000
              ).toFixed(0)})`
            );
          }

          updated[existingIdx] = {
            ...curr,
            quantity_milli: newQty,
            unit_price_paise: unitPrice,
          };
          setSelectedRowIndex(existingIdx);
          return updated;
        }

        const newLine: CartLineItem = {
          id: 'row_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
          resource_id: product.id,
          sku: product.sku,
          barcode: product.barcode,
          name: product.name,
          hsn: product.hsn,
          unit: product.unit,
          quantity_milli: qtyMilli,
          unit_price_paise: unitPrice,
          discount_paise: 0,
          tax_rate_bps: product.tax_rate_bps,
          is_return: isReturn,
          expiry_date: product.expiry_date,
          batch_number: product.batch_number,
          gross_paise: 0,
          taxable_paise: 0,
          cgst_paise: 0,
          sgst_paise: 0,
          igst_paise: 0,
          line_total_paise: 0,
        };

        const next = [...prev, newLine];
        setSelectedRowIndex(next.length - 1);
        return next;
      });

      showToast(`${isReturn ? '[RETURN] ' : 'Added: '}${product.name} (${formatPaise(customUnitPricePaise ?? product.base_price_paise)})`);
    },
    [isReturnMode, showToast]
  );

  const handleToggleReturn = useCallback((index: number) => {
    setCartItems((prev) => {
      const updated = [...prev];
      if (updated[index]) {
        const nextState = !updated[index].is_return;
        updated[index] = { ...updated[index], is_return: nextState };
        showToast(`Line #${index + 1} marked as ${nextState ? 'RETURN' : 'SALE'}`);
      }
      return updated;
    });
  }, [showToast]);

  // Barcode Scanner Keyboard-Wedge Listener with 300ms debounce
  useBarcodeScanner({
    enabled:
      activeMode === 'SALES' &&
      !isPaymentOpen &&
      !isReceiptOpen &&
      !isHelpOpen &&
      !isDateModalOpen &&
      !isSearchOpen &&
      !isHeldBillsOpen &&
      !isPriceCheckOpen &&
      !isUnmappedBarcodeOpen &&
      !isSupervisorPinOpen &&
      !isConfirmClearOpen &&
      !isStoreProfileOpen,
    debounceMs: 300,
    onScan: (barcode) => {
      setNumpadValue('');
      const found = products.find(
        (p) => p.barcode === barcode || p.sku.toLowerCase() === barcode.toLowerCase()
      );
      if (found) {
        posSound.playScan();
        addProductToCart(found, 1000);
      } else {
        // CF-01: Prompt to add or map unknown barcode instead of failing silently or using astronomical price
        posSound.playWarning();
        setUnmappedBarcodeValue(barcode);
        setIsUnmappedBarcodeOpen(true);
      }
    },
  });

  // Handle Numpad Quick Entry Submission (Quantity * Price or Barcode/SKU)
  const handleNumpadSubmit = (val: string) => {
    const trimmed = val.trim();
    if (!trimmed) return;

    // Check if input is "Qty*Price" syntax e.g. "3*120" or "2*45.50"
    if (trimmed.includes('*')) {
      const parts = trimmed.split('*');
      const qtyMilli = parseQtyToMilli(parts[0]);
      const pricePaise = parseRupeesToPaise(parts[1]);

      // If a row is currently selected in cart, update its qty and rate!
      if (cartItems.length > 0 && selectedRowIndex < cartItems.length) {
        const item = cartItems[selectedRowIndex];
        setCartItems((prev) => {
          const updated = [...prev];
          updated[selectedRowIndex] = {
            ...item,
            quantity_milli: qtyMilli,
            unit_price_paise: pricePaise > 0 ? pricePaise : item.unit_price_paise,
          };
          return updated;
        });
        showToast(`Updated line #${selectedRowIndex + 1}: ${parts[0]} x ₹${parts[1]}`);
      } else {
        // CF-01: Enforce ₹50,000 upper sanity ceiling on ad-hoc line items
        if (pricePaise > 5000000) {
          posSound.playWarning();
          showToast('⚠️ Maximum price for ad-hoc items is ₹50,000.00.');
          return;
        }
        // Create an ad-hoc quick sale item
        const genericProd: ResourceItem = {
          id: 'custom_' + Date.now(),
          sku: 'MISC',
          barcode: 'MISC-ITEM',
          name: 'General Merchandise',
          hsn: '9999',
          unit: 'pcs',
          tax_rate_bps: 1800,
          base_price_paise: pricePaise,
          cost_price_paise: Math.round(pricePaise * 0.8),
          stock_milli: 100000,
        };
        addProductToCart(genericProd, qtyMilli, pricePaise);
      }
      setNumpadValue('');
      return;
    }

    // CF-25: Direct HSN search support
    const byHsn = products.find((p) => p.hsn === trimmed);
    if (byHsn) {
      posSound.playScan();
      addProductToCart(byHsn, 1000);
      setNumpadValue('');
      return;
    }

    // Check if it's an existing registered barcode or SKU
    const found = products.find(
      (p) =>
        p.barcode.toLowerCase() === trimmed.toLowerCase() ||
        p.sku.toLowerCase() === trimmed.toLowerCase()
    );

    if (found) {
      posSound.playScan();
      addProductToCart(found, 1000);
      setNumpadValue('');
      return;
    }

    // CF-01: Check if input is a barcode format (6+ digits or alphanumeric barcode)
    // NEVER evaluate unmapped barcodes as price!
    const looksLikeBarcode = /^\d{6,}$/.test(trimmed) || /^[A-Za-z0-9_-]{7,}$/.test(trimmed);
    if (looksLikeBarcode) {
      posSound.playWarning();
      setUnmappedBarcodeValue(trimmed);
      setIsUnmappedBarcodeOpen(true);
      setNumpadValue('');
      return;
    }

    // Check if numeric price only (strictly capped at ₹50,000 for ad-hoc misc)
    const numPrice = parseFloat(trimmed);
    if (!isNaN(numPrice) && numPrice > 0) {
      if (numPrice > 50000) {
        posSound.playWarning();
        showToast('⚠️ Maximum price for ad-hoc manual item is ₹50,000.00.');
        setNumpadValue('');
        return;
      }
      const genericProd: ResourceItem = {
        id: 'custom_' + Date.now(),
        sku: 'MISC',
        barcode: 'MISC-ITEM',
        name: 'General Merchandise',
        hsn: '9999',
        unit: 'pcs',
        tax_rate_bps: 1800,
        base_price_paise: Math.round(numPrice * 100),
        cost_price_paise: Math.round(numPrice * 80),
        stock_milli: 100000,
      };
      addProductToCart(genericProd, 1000, Math.round(numPrice * 100));
      setNumpadValue('');
      return;
    }

    showToast(`Unrecognized input or barcode: ${trimmed}`);
  };

  // Cart Row Updates
  const handleUpdateQty = (index: number, newMilli: number) => {
    setCartItems((prev) => {
      const updated = [...prev];
      if (updated[index]) {
        updated[index] = { ...updated[index], quantity_milli: newMilli };
      }
      return updated;
    });
  };

  const handleUpdateUnitPrice = (index: number, newPaise: number) => {
    const role = getActiveUserRole();
    const item = cartItems[index];

    // CF-06: Require supervisor PIN if cashier attempts to drop price below base price
    if (role === 'CASHIER' && item && newPaise < item.unit_price_paise) {
      setSupervisorAction('OVERRIDE_PRICE');
      setPendingPriceOverride({ index, newPaise });
      setIsSupervisorPinOpen(true);
      return;
    }

    setCartItems((prev) => {
      const updated = [...prev];
      if (updated[index]) {
        updated[index] = { ...updated[index], unit_price_paise: newPaise };
      }
      return updated;
    });
  };

  const handleUpdateDiscount = (index: number, newPaise: number) => {
    const role = getActiveUserRole();
    const item = cartItems[index];

    // CF-06: Require supervisor PIN if cashier attempts discount > 10%
    if (role === 'CASHIER' && item) {
      const lineTotal = (item.quantity_milli / 1000) * item.unit_price_paise;
      if (lineTotal > 0 && newPaise / lineTotal > 0.1) {
        showToast('⚠️ Discretionary discounts over 10% require supervisor PIN.');
        setSupervisorAction('HIGH_DISCOUNT');
        setIsSupervisorPinOpen(true);
        return;
      }
    }

    setCartItems((prev) => {
      const updated = [...prev];
      if (updated[index]) {
        updated[index] = { ...updated[index], discount_paise: newPaise };
      }
      return updated;
    });
  };

  const handleRemoveItem = (index: number) => {
    setCartItems((prev) => prev.filter((_, i) => i !== index));
    if (selectedRowIndex >= index && selectedRowIndex > 0) {
      setSelectedRowIndex(selectedRowIndex - 1);
    }
  };

  // CF-06 & CF-15: Clear cart with supervisor PIN check and modal confirmation
  const handleClearCart = useCallback(() => {
    if (cartItems.length === 0) return;
    const role = getActiveUserRole();
    if (role === 'CASHIER') {
      setSupervisorAction('CLEAR_CART');
      setIsSupervisorPinOpen(true);
    } else {
      setIsConfirmClearOpen(true);
    }
  }, [cartItems.length]);

  const handleExecuteClearCart = () => {
    setCartItems([]);
    setNumpadValue('');
    try {
      localStorage.removeItem('omnibill_active_cart');
    } catch {}
    setIsConfirmClearOpen(false);
    showToast('Cart cleared');
  };

  const handleSupervisorAuthorized = () => {
    if (supervisorAction === 'CLEAR_CART') {
      setCartItems([]);
      setNumpadValue('');
      try {
        localStorage.removeItem('omnibill_active_cart');
      } catch {}
      showToast('Supervisor authorized: Cart cleared');
    } else if (supervisorAction === 'OVERRIDE_PRICE' && pendingPriceOverride) {
      const { index, newPaise } = pendingPriceOverride;
      setCartItems((prev) => {
        const updated = [...prev];
        if (updated[index]) {
          updated[index] = { ...updated[index], unit_price_paise: newPaise };
        }
        return updated;
      });
      showToast(`Supervisor authorized: Unit price updated to ${formatPaise(newPaise)}`);
      setPendingPriceOverride(null);
    }
    setSupervisorAction(null);
  };

  // Construct Completed Sale Data
  const buildCompletedSale = useCallback(
    (payment?: PaymentDetails): CompletedSale => {
      const defaultPayment: PaymentDetails = payment || {
        mode: 'CASH',
        amount_tendered_paise: taxComputation.totals.total_amount_paise,
        change_due_paise: 0,
      };

      const now = new Date();
      const timeStr = now.toTimeString().split(' ')[0];
      const invNumber = posStorage.getNextInvoiceNumber();

      // CF-16: Auto-resolve customer name from phone if customerName is empty
      let resolvedCustomerName = customerName.trim();
      const cleanPhone = customerPhone.trim();
      if (!resolvedCustomerName && cleanPhone.length >= 10) {
        try {
          const entities = ErpStorageService.getEntities('CUSTOMER');
          const matched = entities.find((c) => c.phone === cleanPhone);
          if (matched) {
            resolvedCustomerName = (matched as any).trade_name || matched.full_name || (matched as any).legal_name || '';
          }
        } catch {}
      }

      const currentBiz = posStorage.getBusinessProfile();

      return {
        transaction_id: 'tx_' + Date.now(),
        invoice_number: invNumber,
        invoice_date: businessDate,
        invoice_time: timeStr,
        seller_state_code: currentBiz.state_code || business.state_code,
        place_of_supply_state_code: placeOfSupplyStateCode,
        customer_name: resolvedCustomerName || undefined,
        customer_phone: cleanPhone || undefined,
        price_mode: priceMode,
        lines: taxComputation.lines,
        totals: taxComputation.totals,
        payment: defaultPayment,
        business: currentBiz,
      };
    },
    [
      businessDate,
      business,
      placeOfSupplyStateCode,
      customerName,
      customerPhone,
      priceMode,
      taxComputation,
    ]
  );

  // Complete Payment and Open Receipt
  const handleCompletePayment = async (payment: PaymentDetails) => {
    if (cartItems.length === 0) return;
    const sale = buildCompletedSale(payment);
    const res = await apiPostSale(sale);
    if (!res.success) {
      posSound.playWarning();
      showToast(`Payment error: ${res.error || 'Failed to post transaction'}`);
      return;
    }
    posSound.playSuccess();
    shiftManager.recordTransaction(payment.mode, sale.totals.total_amount_paise);
    setLastCompletedSale(sale);
    setIsPaymentOpen(false);
    setIsReceiptOpen(true);
    refreshProducts();
  };

  // Instant Save & Print Slip (Alt+S)
  const handleSaveAndPrintSlip = useCallback(async () => {
    if (cartItems.length === 0) return;
    const sale = buildCompletedSale();
    const res = await apiPostSale(sale);
    if (!res.success) {
      posSound.playWarning();
      showToast(`Sale error: ${res.error || 'Failed to post transaction'}`);
      return;
    }
    posSound.playSuccess();
    shiftManager.recordTransaction('CASH', sale.totals.total_amount_paise);
    setLastCompletedSale(sale);
    setIsReceiptOpen(true);
    refreshProducts();
  }, [cartItems.length, buildCompletedSale, refreshProducts, showToast]);

  // Hold / Suspend Bill (F6)
  const handleHoldBill = useCallback(() => {
    if (cartItems.length === 0) {
      showToast('Cart is empty. Add items before holding.');
      return;
    }

    const newHeld: HeldBill = {
      id: 'held_' + Date.now(),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      customerName: customerName.trim(),
      customerPhone: customerPhone.trim(),
      priceMode,
      items: [...cartItems],
      subtotalPaise: taxComputation.totals.total_amount_paise,
    };

    setHeldBills((prev) => [newHeld, ...prev]);
    setCartItems([]);
    setCustomerName('');
    setCustomerPhone('');
    setNumpadValue('');
    posSound.playItemAdd();
    showToast(`Bill held for ${newHeld.customerName || 'Walk-in'} (${newHeld.items.length} items) - Press F7 to recall`);
  }, [cartItems, customerName, customerPhone, priceMode, taxComputation.totals.total_amount_paise, showToast]);

  // Recall Suspended Bill (F7)
  const handleRecallBill = useCallback(
    (bill: HeldBill) => {
      if (cartItems.length > 0) {
        // Automatically hold active cart so nothing is lost
        const activeParked: HeldBill = {
          id: 'held_' + Date.now(),
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          customerName: customerName.trim(),
          customerPhone: customerPhone.trim(),
          priceMode,
          items: [...cartItems],
          subtotalPaise: taxComputation.totals.total_amount_paise,
        };
        setHeldBills((prev) => [activeParked, ...prev.filter((b) => b.id !== bill.id)]);
        showToast(`Current cart parked; recalled bill (${bill.items.length} items)`);
      } else {
        setHeldBills((prev) => prev.filter((b) => b.id !== bill.id));
        showToast(`Recalled bill (${bill.items.length} items)`);
      }

      setCartItems(bill.items);
      setPriceMode(bill.priceMode);
      setCustomerName(bill.customerName);
      setCustomerPhone(bill.customerPhone);
      setIsHeldBillsOpen(false);
      posSound.playSuccess();
    },
    [cartItems, customerName, customerPhone, priceMode, taxComputation.totals.total_amount_paise, showToast]
  );

  // Discard Held Bill
  const handleDiscardHeldBill = useCallback(
    (billId: string) => {
      setHeldBills((prev) => prev.filter((b) => b.id !== billId));
      showToast('Held bill discarded');
    },
    [showToast]
  );

  const handleFinishSale = () => {
    setCartItems([]);
    setCustomerPhone('');
    setCustomerName('');
    setNumpadValue('');
    setIsReceiptOpen(false);
    showToast('Sale committed successfully!');
  };

  // Global Keyboard Shortcuts (F1, F2, F3, F4, F8, F9, Alt+S, Esc)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // F1: Help modal
      if (e.key === 'F1') {
        e.preventDefault();
        setIsHelpOpen((prev) => !prev);
        return;
      }

      // F2: Toggle Instant Return / Exchange Mode
      if (e.key === 'F2') {
        e.preventDefault();
        setIsReturnMode((prev) => {
          const next = !prev;
          showToast(next ? '🔄 Return / Exchange Mode (F2) ACTIVE' : '🛒 Normal Billing Mode ACTIVE');
          return next;
        });
        return;
      }

      // Alt+D: Change Business Date
      if (e.altKey && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        setIsDateModalOpen(true);
        return;
      }

      // F3: Catalog Item Search
      if (e.key === 'F3') {
        e.preventDefault();
        setIsSearchOpen(true);
        return;
      }

      // F4: Payment Receipt Quick Modal
      if (e.key === 'F4') {
        e.preventDefault();
        if (cartItems.length > 0) {
          setIsPaymentOpen(true);
        }
        return;
      }

      // F5: Fast Barcode & Price Check Modal
      if (e.key === 'F5') {
        e.preventDefault();
        setIsPriceCheckOpen(true);
        return;
      }

      // F6: Hold / Suspend Active Bill
      if (e.key === 'F6') {
        e.preventDefault();
        handleHoldBill();
        return;
      }

      // F7: Recall Suspended / Parked Bills
      if (e.key === 'F7') {
        e.preventDefault();
        setIsHeldBillsOpen(true);
        return;
      }

      // F8: Sales Invoicing Mode
      if (e.key === 'F8') {
        e.preventDefault();
        setActiveMode('SALES');
        return;
      }

      // F9: Purchases Entry Mode
      if (e.key === 'F9') {
        e.preventDefault();
        setActiveMode('PURCHASES');
        return;
      }

      // Alt+Z: Cash Drawer Shift Settlement
      if (e.altKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        setIsShiftModalOpen(true);
        return;
      }

      // Alt+S: Save & Print Thermal Slip
      if (e.altKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        if (cartItems.length > 0) {
          handleSaveAndPrintSlip();
        }
        return;
      }

      // Escape: Cancel / Clear cart
      if (e.key === 'Escape') {
        if (
          !isHelpOpen &&
          !isDateModalOpen &&
          !isPaymentOpen &&
          !isReceiptOpen &&
          !isSearchOpen &&
          !isHeldBillsOpen &&
          !isPriceCheckOpen &&
          !isShiftModalOpen &&
          !isImporterOpen
        ) {
          if (cartItems.length > 0) {
            e.preventDefault();
            handleClearCart();
          }
        }
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [
    cartItems.length,
    isHelpOpen,
    isDateModalOpen,
    isPaymentOpen,
    isReceiptOpen,
    isSearchOpen,
    isHeldBillsOpen,
    isPriceCheckOpen,
    isShiftModalOpen,
    isImporterOpen,
    handleSaveAndPrintSlip,
    handleClearCart,
    handleHoldBill,
  ]);

  return (
    <div className="flex-1 flex flex-col h-full w-full bg-slate-950 text-slate-100 overflow-hidden font-sans">
      {/* Top Header with Brand, Business Date & Shortcuts */}
      <Header
        business={business}
        businessDate={businessDate}
        activeMode={activeMode}
        onModeChange={setActiveMode}
        onOpenHelp={() => setIsHelpOpen(true)}
        onOpenDateModal={() => setIsDateModalOpen(true)}
        onOpenPayment={() => setIsPaymentOpen(true)}
        onOpenSlip={handleSaveAndPrintSlip}
        cartCount={cartItems.length}
        onPriceCheck={() => setIsPriceCheckOpen(true)}
        onHoldBill={handleHoldBill}
        onRecallBills={() => setIsHeldBillsOpen(true)}
        heldBillsCount={heldBills.length}
        onOpenLiveSupport={() => setIsLiveSupportOpen(true)}
        onOpenStoreProfile={() => setIsStoreProfileOpen(true)}
      />

      {/* Main Workspace Body */}
      {activeMode === 'PURCHASES' ? (
        <PurchaseEntry
          products={products}
          businessDate={businessDate}
          onBackToSales={() => setActiveMode('SALES')}
          onRefreshProducts={refreshProducts}
        />
      ) : (
        <div className="flex-1 flex min-h-0 overflow-hidden p-2.5 sm:p-3 gap-2.5 sm:gap-3">
          {/* Left Column: Cart Table & Numpad Quick Entry */}
          <div className="flex-1 flex flex-col space-y-2.5 sm:space-y-3 min-h-0 overflow-hidden">
            {/* Empty Catalog Helper Banner */}
            {products.length === 0 && (
              <div className="bg-blue-950/40 border border-blue-500/40 rounded-xl p-3 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs shadow-md shrink-0">
                <div className="flex items-center space-x-2.5">
                  <Sparkles className="w-5 h-5 text-blue-400 shrink-0 animate-pulse" />
                  <div>
                    <span className="font-bold text-white block">Product Catalog is Empty</span>
                    <span className="text-slate-400 text-[11px]">
                      Load sample supermarket goods or import your existing Excel/CSV catalog.
                    </span>
                  </div>
                </div>
                <div className="flex items-center space-x-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleLoadSampleProducts}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-semibold shadow-sm transition-all cursor-pointer"
                  >
                    Load 15 Sample Items
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsImporterOpen(true)}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg font-semibold transition-all cursor-pointer"
                  >
                    Import Excel
                  </button>
                </div>
              </div>
            )}

            {/* Return / Exchange Mode Indicator Banner */}
            {isReturnMode && (
              <div className="bg-rose-950/80 border border-rose-500/60 rounded-xl p-2.5 flex items-center justify-between text-xs text-rose-200 shadow-md shrink-0">
                <div className="flex items-center space-x-2">
                  <RotateCcw className="w-4 h-4 text-rose-400 animate-spin" />
                  <span className="font-bold">RETURN / EXCHANGE MODE (F2) ACTIVE:</span>
                  <span>Items scanned or entered in quick-bar will be credited as returns.</span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsReturnMode(false)}
                  className="px-2 py-0.5 bg-rose-900 border border-rose-700 text-rose-100 rounded text-[11px] font-semibold hover:bg-rose-800 transition"
                >
                  Exit Return Mode (F2)
                </button>
              </div>
            )}

            {/* High-Performance Cart Table */}
            <CartTable
              items={taxComputation.lines}
              selectedRowIndex={selectedRowIndex}
              onSelectRow={setSelectedRowIndex}
              onUpdateQuantityMilli={handleUpdateQty}
              onUpdateUnitPricePaise={handleUpdateUnitPrice}
              onUpdateDiscountPaise={handleUpdateDiscount}
              onRemoveItem={handleRemoveItem}
              onToggleReturn={handleToggleReturn}
              isIntraState={isIntraState}
            />

            {/* Numpad Quick Entry Bar with Real-Time Predictive Autocomplete */}
            <NumpadQuickEntry
              value={numpadValue}
              onChange={setNumpadValue}
              onSubmit={handleNumpadSubmit}
              onOpenItemSearch={() => setIsSearchOpen(true)}
              products={products}
              onSelectProduct={(prod, qty) => addProductToCart(prod, qty)}
            />
          </div>

          {/* Right Column: Totals & Tax Calculation Panel */}
          <TotalsPanel
            totals={taxComputation.totals}
            priceMode={priceMode}
            onTogglePriceMode={() =>
              setPriceMode((m) => (m === 'EXCLUSIVE' ? 'INCLUSIVE' : 'EXCLUSIVE'))
            }
            isIntraState={isIntraState}
            onToggleIntraState={() => {
              setPlaceOfSupplyStateCode(isIntraState ? '29' : business.state_code);
            }}
            sellerStateCode={business.state_code}
            placeOfSupplyStateCode={placeOfSupplyStateCode}
            onChangePlaceOfSupply={setPlaceOfSupplyStateCode}
            customerPhone={customerPhone}
            onChangeCustomerPhone={setCustomerPhone}
            customerName={customerName}
            onChangeCustomerName={setCustomerName}
            itemCount={cartItems.length}
            onOpenPayment={() => setIsPaymentOpen(true)}
            onSaveAndPrintSlip={handleSaveAndPrintSlip}
            onClearCart={handleClearCart}
            onOpenShift={() => setIsShiftModalOpen(true)}
            onHoldBill={handleHoldBill}
            onRecallBills={() => setIsHeldBillsOpen(true)}
            heldBillsCount={heldBills.length}
          />
        </div>
      )}

      {/* Floating Notification Toast */}
      {toastMessage && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-slate-900 border border-blue-500/50 text-blue-200 px-4 py-2 rounded-xl text-xs font-semibold shadow-2xl flex items-center space-x-2 animate-in fade-in slide-in-from-bottom-2">
          <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Modals */}
      <HelpModal isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} />
      
      <BusinessDateModal
        isOpen={isDateModalOpen}
        onClose={() => setIsDateModalOpen(false)}
        currentDate={businessDate}
        onSaveDate={setBusinessDate}
      />

      <ItemSearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        products={products}
        onSelectItem={(item) => addProductToCart(item, 1000)}
      />

      <PaymentModal
        isOpen={isPaymentOpen}
        onClose={() => setIsPaymentOpen(false)}
        totalAmountPaise={taxComputation.totals.total_amount_paise}
        invoiceNumber="INV-NEXT"
        upiVpa={business.upi_vpa || 'omnimart@icici'}
        businessName={business.trade_name || business.legal_name}
        customerPhone={customerPhone}
        onCompletePayment={handleCompletePayment}
      />

      <ThermalReceiptModal
        isOpen={isReceiptOpen}
        onClose={handleFinishSale}
        sale={lastCompletedSale}
        onConfirmComplete={handleFinishSale}
      />

      <ShiftSettlementModal
        isOpen={isShiftModalOpen}
        onClose={() => setIsShiftModalOpen(false)}
        operatorName={business.legal_name || 'Cashier 1'}
        counterId="POS-01"
        storeName={business.trade_name || business.legal_name}
      />

      <CatalogImporterModal
        isOpen={isImporterOpen}
        onClose={() => setIsImporterOpen(false)}
        onImportSuccess={() => refreshProducts()}
      />

      <PriceCheckModal
        isOpen={isPriceCheckOpen}
        onClose={() => setIsPriceCheckOpen(false)}
        products={products}
        onAddToCart={(prod) => addProductToCart(prod, 1000)}
      />

      <HeldBillsModal
        isOpen={isHeldBillsOpen}
        onClose={() => setIsHeldBillsOpen(false)}
        heldBills={heldBills}
        onRecallBill={handleRecallBill}
        onDiscardBill={handleDiscardHeldBill}
      />

      <LiveSupportModal
        isOpen={isLiveSupportOpen}
        onClose={() => setIsLiveSupportOpen(false)}
      />

      {/* CF-02: Store Profile Configuration Modal */}
      <StoreProfileModal
        isOpen={isStoreProfileOpen}
        onClose={() => {
          setIsStoreProfileOpen(false);
          setBusiness(posStorage.getBusinessProfile());
          refreshProducts();
        }}
      />

      {/* CF-06: Supervisor PIN Challenge Modal */}
      <SupervisorPinModal
        isOpen={isSupervisorPinOpen}
        onClose={() => {
          setIsSupervisorPinOpen(false);
          setSupervisorAction(null);
        }}
        actionTitle={
          supervisorAction === 'CLEAR_CART'
            ? 'Supervisor Authorization: Void Cart'
            : supervisorAction === 'OVERRIDE_PRICE'
            ? 'Supervisor Authorization: Price Override'
            : 'Supervisor Authorization: Discretionary Discount'
        }
        actionDescription={
          supervisorAction === 'CLEAR_CART'
            ? 'Cancel and Void Entire Cart'
            : supervisorAction === 'OVERRIDE_PRICE'
            ? 'Authorize Selling Below Cost / Base Rate'
            : 'Authorize Discretionary Discount'
        }
        onAuthorized={handleSupervisorAuthorized}
      />

      {/* CF-15: Confirm Clear Cart Dialog */}
      <ConfirmClearModal
        isOpen={isConfirmClearOpen}
        onClose={() => setIsConfirmClearOpen(false)}
        onConfirmClear={handleExecuteClearCart}
        itemCount={cartItems.length}
      />

      {/* CF-01: Unmapped Barcode Protection Modal */}
      <UnmappedBarcodeModal
        isOpen={isUnmappedBarcodeOpen}
        onClose={() => setIsUnmappedBarcodeOpen(false)}
        barcode={unmappedBarcodeValue}
        onProductCreatedOrMapped={async (newProd: ResourceItem) => {
          await refreshProducts();
          addProductToCart(newProd, 1000);
          showToast(`Created & Added: ${newProd.name}`);
        }}
      />
    </div>
  );
};
export default LightningPOS;
