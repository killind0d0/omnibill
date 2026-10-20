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
import { Sparkles, Upload } from 'lucide-react';

export const LightningPOS: React.FC = () => {
  // Application Modes
  const [activeMode, setActiveMode] = useState<'SALES' | 'PURCHASES'>('SALES');

  // Business State
  const [business, setBusiness] = useState<BusinessProfile>(posStorage.getBusinessProfile());
  const [businessDate, setBusinessDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [products, setProducts] = useState<ResourceItem[]>([]);

  // Cart & Pricing State
  const [cartItems, setCartItems] = useState<CartLineItem[]>([]);
  const [selectedRowIndex, setSelectedRowIndex] = useState<number>(0);
  const [priceMode, setPriceMode] = useState<PriceMode>('EXCLUSIVE');
  const [placeOfSupplyStateCode, setPlaceOfSupplyStateCode] = useState<string>(
    business.state_code || '27'
  );

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
    (product: ResourceItem, qtyMilli = 1000, customUnitPricePaise?: number) => {
      setCartItems((prev) => {
        const existingIdx = prev.findIndex((i) => i.resource_id === product.id);
        const unitPrice = customUnitPricePaise ?? product.base_price_paise;

        if (existingIdx >= 0) {
          const updated = [...prev];
          const curr = updated[existingIdx];
          updated[existingIdx] = {
            ...curr,
            quantity_milli: curr.quantity_milli + qtyMilli,
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

      showToast(`Added: ${product.name} (${formatPaise(customUnitPricePaise ?? product.base_price_paise)})`);
    },
    [showToast]
  );

  // Barcode Scanner Keyboard-Wedge Listener with 300ms debounce
  useBarcodeScanner({
    enabled:
      activeMode === 'SALES' &&
      !isPaymentOpen &&
      !isReceiptOpen &&
      !isHelpOpen &&
      !isDateModalOpen &&
      !isSearchOpen,
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
        posSound.playWarning();
        showToast(`Barcode not found: ${barcode}`);
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

    // Check if it's a barcode or SKU
    const found = products.find(
      (p) =>
        p.barcode.toLowerCase() === trimmed.toLowerCase() ||
        p.sku.toLowerCase() === trimmed.toLowerCase()
    );

    if (found) {
      addProductToCart(found, 1000);
      setNumpadValue('');
      return;
    }

    // Check if numeric price only
    const numPrice = parseFloat(trimmed);
    if (!isNaN(numPrice) && numPrice > 0) {
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
    setCartItems((prev) => {
      const updated = [...prev];
      if (updated[index]) {
        updated[index] = { ...updated[index], unit_price_paise: newPaise };
      }
      return updated;
    });
  };

  const handleUpdateDiscount = (index: number, newPaise: number) => {
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

  const handleClearCart = useCallback(() => {
    if (cartItems.length === 0) return;
    if (window.confirm('Are you sure you want to cancel and clear the current cart?')) {
      setCartItems([]);
      setNumpadValue('');
      showToast('Cart cleared');
    }
  }, [cartItems.length, showToast]);

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

      return {
        transaction_id: 'tx_' + Date.now(),
        invoice_number: invNumber,
        invoice_date: businessDate,
        invoice_time: timeStr,
        seller_state_code: business.state_code,
        place_of_supply_state_code: placeOfSupplyStateCode,
        customer_name: customerName.trim() || undefined,
        customer_phone: customerPhone.trim() || undefined,
        price_mode: priceMode,
        lines: taxComputation.lines,
        totals: taxComputation.totals,
        payment: defaultPayment,
        business,
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

      // F2: Change Business Date
      if (e.key === 'F2') {
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
        if (!isHelpOpen && !isDateModalOpen && !isPaymentOpen && !isReceiptOpen && !isSearchOpen) {
          if (cartItems.length > 0) {
            e.preventDefault();
            handleClearCart();
          }
        }
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    cartItems.length,
    isHelpOpen,
    isDateModalOpen,
    isPaymentOpen,
    isReceiptOpen,
    isSearchOpen,
    handleSaveAndPrintSlip,
    handleClearCart,
  ]);

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-100 overflow-hidden font-sans">
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
        <div className="flex-1 flex overflow-hidden p-3 gap-3">
          {/* Left Column: Cart Table & Numpad Quick Entry */}
          <div className="flex-1 flex flex-col space-y-3 overflow-hidden">
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

            {/* High-Performance Cart Table */}
            <CartTable
              items={taxComputation.lines}
              selectedRowIndex={selectedRowIndex}
              onSelectRow={setSelectedRowIndex}
              onUpdateQuantityMilli={handleUpdateQty}
              onUpdateUnitPricePaise={handleUpdateUnitPrice}
              onUpdateDiscountPaise={handleUpdateDiscount}
              onRemoveItem={handleRemoveItem}
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
        onCompletePayment={handleCompletePayment}
      />

      <ThermalReceiptModal
        isOpen={isReceiptOpen}
        onClose={() => setIsReceiptOpen(false)}
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
    </div>
  );
};
export default LightningPOS;
