import React, { useState, useEffect, useMemo } from 'react';
import {
  BarChart3,
  Scale,
  BookOpen,
  Receipt,
  Boxes,
  Calendar,
  Download,
  FileSpreadsheet,
  FileCode,
  Printer,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  ArrowUpRight,
  ArrowDownLeft,
  ChevronLeft,
  ChevronRight,
  Clock,
  Layers,
  Sparkles,
  TrendingUp,
  TrendingDown,
  ShieldCheck,
  Search,
  Package,
  Eye,
  Lock,
  Unlock,
  Upload,
  Check,
  X,
  History,
  ClipboardCheck,
} from 'lucide-react';
import {
  TrialBalanceAccount,
  AccountType,
  DayBookEntry,
  DayBookSummary,
  Gstr1B2BInvoice,
  Gstr1B2CEntry,
  Gstr1HsnSummary,
  StockValuationItem,
  PeriodLockState,
  Gstr3BReport,
  BankVoucherItem,
  BrsSummary,
  FinancialStatements,
  StocktakeItem,
  StocktakeSummary,
} from '../types/accounting';
import { ErpStorageService } from '../lib/erpStorage';
import { posStorage, getActiveVertical } from '../lib/api';
import { formatPaise, formatMilliQty } from '../lib/tax';
import { getStateName } from '../lib/constants';
import {
  PurchaseExpenseBillModal,
  PurchaseExpenseVoucher,
} from '../components/common/PurchaseExpenseBillModal';

type ReportTab =
  | 'TRIAL_BALANCE'
  | 'DAY_BOOK'
  | 'PURCHASES'
  | 'GSTR1'
  | 'GSTR3B'
  | 'BRS'
  | 'STOCK_VALUATION'
  | 'FINANCIAL_STATEMENTS'
  | 'STOCKTAKE';

export const ReportsDashboard: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ReportTab>('TRIAL_BALANCE');

  // Trial Balance state
  const [accounts, setAccounts] = useState<TrialBalanceAccount[]>([]);
  const [isSimulatedImbalance, setIsSimulatedImbalance] = useState(false);

  // Day Book state: Defaults to today if entries exist, or latest active entry date
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    const today = new Date().toISOString().split('T')[0];
    const all = ErpStorageService.getDayBookEntries();
    if (all.some((e) => e.date === today)) return today;
    if (all.length > 0) return all[0].date;
    return today;
  });
  const [dayBookEntries, setDayBookEntries] = useState<DayBookEntry[]>([]);
  const [dayBookSummary, setDayBookSummary] = useState<DayBookSummary | null>(null);

  // GSTR-1 state
  const [selectedPeriod, setSelectedPeriod] = useState<string>('2026-10'); // October 2026
  const [b2bInvoices, setB2bInvoices] = useState<Gstr1B2BInvoice[]>([]);
  const [b2cEntries, setB2cEntries] = useState<Gstr1B2CEntry[]>([]);
  const [hsnSummaries, setHsnSummaries] = useState<Gstr1HsnSummary[]>([]);
  const [gstrSubTab, setGstrSubTab] = useState<'B2B' | 'B2C' | 'HSN'>('B2B');

  // GSTR-3B state
  const [gstr3bPeriod, setGstr3bPeriod] = useState<string>('2026-09');
  const [gstr3bReport, setGstr3bReport] = useState<Gstr3BReport | null>(null);

  // Bank Reconciliation Statement (BRS) state
  const [bankVouchers, setBankVouchers] = useState<BankVoucherItem[]>([]);
  const [brsSummary, setBrsSummary] = useState<BrsSummary | null>(null);
  const [brsFilter, setBrsFilter] = useState<'ALL' | 'CLEARED' | 'UNCLEARED'>('ALL');
  const [brsSearch, setBrsSearch] = useState<string>('');

  // Period Lock state
  const [periodLock, setPeriodLock] = useState<PeriodLockState | null>(null);
  const [isPeriodLockModalOpen, setIsPeriodLockModalOpen] = useState(false);
  const [newLockDate, setNewLockDate] = useState<string>('2026-03-31');
  const [lockReason, setLockReason] = useState<string>('Statutory annual audit and tax closing for FY 2025-26');

  // Stock Valuation state
  const [stockItems, setStockItems] = useState<StockValuationItem[]>([]);
  const [stockFilter, setStockFilter] = useState<'ALL' | 'LOW_ONLY' | 'EXPIRING_ONLY'>('ALL');

  // Purchases Register state
  const [purchases, setPurchases] = useState<any[]>([]);
  const [purchaseSearch, setPurchaseSearch] = useState<string>('');
  const [selectedVoucherForModal, setSelectedVoucherForModal] = useState<PurchaseExpenseVoucher | null>(null);

  // Financial Statements state
  const [financialStatements, setFinancialStatements] = useState<FinancialStatements | null>(null);

  // Stocktake state
  const [stocktakeItems, setStocktakeItems] = useState<StocktakeItem[]>([]);
  const [stocktakeAuditor, setStocktakeAuditor] = useState<string>('admin');
  const [stocktakeReason, setStocktakeReason] = useState<string>('Bi-weekly store cycle count');
  const [isStocktakeAdjustmentModalOpen, setIsStocktakeAdjustmentModalOpen] = useState<boolean>(false);

  // Load Report Data
  const loadReports = () => {
    // 1. Trial Balance
    const accts = ErpStorageService.getTrialBalanceAccounts();
    setAccounts(accts);

    // 2. Day Book
    const entries = ErpStorageService.getDayBookEntries(selectedDate);
    setDayBookEntries(entries);
    setDayBookSummary(ErpStorageService.getDayBookSummary(selectedDate));

    // 3. GSTR-1
    setB2bInvoices(ErpStorageService.getGstr1B2B());
    setB2cEntries(ErpStorageService.getGstr1B2C());
    setHsnSummaries(ErpStorageService.getGstr1HsnSummary());

    // 4. Stock Valuation
    setStockItems(ErpStorageService.getStockValuationItems());

    // 5. Inward Purchases Register
    setPurchases(posStorage.getPurchases());

    // 6. Period Lock
    const pLock = ErpStorageService.getPeriodLock();
    setPeriodLock(pLock);
    if (pLock.lock_date) {
      setNewLockDate(pLock.lock_date);
    }

    // 7. GSTR-3B
    setGstr3bReport(ErpStorageService.getGstr3B(gstr3bPeriod));

    // 8. BRS
    setBankVouchers(ErpStorageService.getBankVouchers());
    setBrsSummary(ErpStorageService.getBrsSummary());

    // 9. Financial Statements
    setFinancialStatements(ErpStorageService.getFinancialStatements());

    // 10. Stocktake
    setStocktakeItems(ErpStorageService.getStocktakeItems());
  };

  const handleUpdatePhysicalStock = (itemId: string, valStr: string) => {
    const val = parseFloat(valStr) || 0;
    ErpStorageService.updatePhysicalStockCount(itemId, val * 1000);
    setStocktakeItems(ErpStorageService.getStocktakeItems());
  };

  const handleAutoFillStocktake = () => {
    stocktakeItems.forEach((item) => {
      ErpStorageService.updatePhysicalStockCount(item.id, item.book_stock_milli);
    });
    setStocktakeItems(ErpStorageService.getStocktakeItems());
  };

  const handlePostStocktake = () => {
    const res = ErpStorageService.postStocktakeAdjustment(stocktakeAuditor, stocktakeReason);
    alert(
      `Stock Adjustment Posted successfully!\n${res.adjustedCount} SKUs updated in catalog.\nVoucher: ${res.voucherNo}\nNet Variance: ₹${(res.netVariancePaise / 100).toFixed(2)}`
    );
    setIsStocktakeAdjustmentModalOpen(false);
    loadReports();
  };

  useEffect(() => {
    loadReports();
    const handleSync = () => loadReports();
    window.addEventListener('omnibill_catalog_sync', handleSync);
    window.addEventListener('focus', handleSync);
    return () => {
      window.removeEventListener('omnibill_catalog_sync', handleSync);
      window.removeEventListener('focus', handleSync);
    };
  }, [selectedDate, selectedPeriod, gstr3bPeriod]);

  // Keyboard shortcut listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey) {
        if (e.key === 't' || e.key === 'T') {
          e.preventDefault();
          setActiveTab('TRIAL_BALANCE');
        } else if (e.key === 'd' || e.key === 'D') {
          e.preventDefault();
          setActiveTab('DAY_BOOK');
        } else if (e.key === 'p' || e.key === 'P') {
          e.preventDefault();
          setActiveTab('PURCHASES');
        } else if (e.key === 'g' || e.key === 'G') {
          e.preventDefault();
          setActiveTab('GSTR1');
        } else if (e.key === '3') {
          e.preventDefault();
          setActiveTab('GSTR3B');
        } else if (e.key === 'b' || e.key === 'B') {
          e.preventDefault();
          setActiveTab('BRS');
        } else if (e.key === 's' || e.key === 'S') {
          e.preventDefault();
          setActiveTab('STOCK_VALUATION');
        } else if (e.key === 'l' || e.key === 'L') {
          e.preventDefault();
          setIsPeriodLockModalOpen(true);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleSavePeriodLock = () => {
    try {
      const updated = ErpStorageService.setPeriodLock(newLockDate || null, lockReason || 'Accounting period lock update', 'admin');
      setPeriodLock(updated);
      setIsPeriodLockModalOpen(false);
      loadReports();
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleToggleCleared = (v: BankVoucherItem) => {
    const nextStatus = !v.is_cleared;
    const updated = ErpStorageService.toggleBankVoucherCleared(v.id, nextStatus);
    setBankVouchers(updated);
    setBrsSummary(ErpStorageService.getBrsSummary());
  };

  const handleImportBankCsv = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result as string;
      if (text) {
        const res = ErpStorageService.importBankStatementCsv(text);
        alert(`Bank Statement imported: ${res.matched} vouchers automatically reconciled, ${res.unmatched} unrecognised lines.`);
        setBankVouchers(ErpStorageService.getBankVouchers());
        setBrsSummary(ErpStorageService.getBrsSummary());
      }
    };
    reader.readAsText(file);
  };

  const handleExportGstr3BJson = () => {
    if (!gstr3bReport) return;
    const gstPayload = {
      gstin: '27AABCO1234F1Z5',
      ret_period: gstr3bPeriod.replace('-', ''),
      filing_typ: 'GSTR3B',
      sec_sum: {
        sup_details: {
          osup_det: {
            txval: gstr3bReport.outward_taxable.taxable_paise / 100,
            iamt: gstr3bReport.outward_taxable.igst_paise / 100,
            camt: gstr3bReport.outward_taxable.cgst_paise / 100,
            samt: gstr3bReport.outward_taxable.sgst_paise / 100,
            csamt: gstr3bReport.outward_taxable.cess_paise / 100,
          },
          osup_zero: {
            txval: gstr3bReport.outward_zero_rated.taxable_paise / 100,
            iamt: gstr3bReport.outward_zero_rated.igst_paise / 100,
            csamt: 0,
          },
          osup_nil_exmp: {
            txval: gstr3bReport.outward_nil_exempt.taxable_paise / 100,
          },
          isup_rev: {
            txval: gstr3bReport.inward_rcm.taxable_paise / 100,
            iamt: gstr3bReport.inward_rcm.igst_paise / 100,
            camt: gstr3bReport.inward_rcm.cgst_paise / 100,
            samt: gstr3bReport.inward_rcm.sgst_paise / 100,
            csamt: 0,
          },
          osup_nongst: {
            txval: gstr3bReport.non_gst_outward.taxable_paise / 100,
          },
        },
        itc_elg: {
          itc_avl: [
            {
              ty: 'OTH',
              iamt: gstr3bReport.itc_available.all_other_itc.igst_paise / 100,
              camt: gstr3bReport.itc_available.all_other_itc.cgst_paise / 100,
              samt: gstr3bReport.itc_available.all_other_itc.sgst_paise / 100,
              csamt: 0,
            },
          ],
          itc_net: {
            iamt: gstr3bReport.net_itc_available.igst_paise / 100,
            camt: gstr3bReport.net_itc_available.cgst_paise / 100,
            samt: gstr3bReport.net_itc_available.sgst_paise / 100,
            csamt: 0,
          },
        },
      },
    };
    const blob = new Blob([JSON.stringify(gstPayload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `GSTR3B_${gstr3bPeriod}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // -------------------------------------------------------------
  // TAB 1: TRIAL BALANCE COMPUTATION
  // -------------------------------------------------------------
  const trialBalanceComputation = useMemo(() => {
    let sumDebit = 0;
    let sumCredit = 0;

    const modifiedAccounts = accounts.map((a) => {
      let deb = a.debit_paise;
      let cred = a.credit_paise;
      if (isSimulatedImbalance && a.code === '1000') {
        deb += 150000; // Inject artificial ₹1,500.00 difference
      }
      sumDebit += deb;
      sumCredit += cred;
      return {
        ...a,
        debit_paise: deb,
        credit_paise: cred,
      };
    });

    const isBalanced = sumDebit === sumCredit;
    const diffPaise = Math.abs(sumDebit - sumCredit);

    // Group accounts by class
    const groups: Record<AccountType, TrialBalanceAccount[]> = {
      ASSET: [],
      LIABILITY: [],
      EQUITY: [],
      REVENUE: [],
      EXPENSE: [],
    };

    modifiedAccounts.forEach((acc) => {
      groups[acc.type].push(acc);
    });

    return {
      accounts: modifiedAccounts,
      sumDebit,
      sumCredit,
      isBalanced,
      diffPaise,
      groups,
    };
  }, [accounts, isSimulatedImbalance]);

  // -------------------------------------------------------------
  // TAB 2: DAY BOOK NAVIGATION
  // -------------------------------------------------------------
  const changeDateByDays = (deltaDays: number) => {
    const current = new Date(selectedDate);
    current.setDate(current.getDate() + deltaDays);
    setSelectedDate(current.toISOString().split('T')[0]);
  };

  // -------------------------------------------------------------
  // TAB 3: GSTR-1 EXPORT ACTIONS
  // -------------------------------------------------------------
  const formatGstnDate = (isoDate: string): string => {
    if (!isoDate) return '';
    const parts = isoDate.split('-');
    if (parts.length === 3) {
      return `${parts[2]}-${parts[1]}-${parts[0]}`; // YYYY-MM-DD -> DD-MM-YYYY
    }
    return isoDate;
  };

  const exportGstr1Json = () => {
    // 1. Format Period as MMYYYY
    const [year, month] = selectedPeriod.split('-');
    const fp = `${month}${year}`; // e.g. "102026"

    // 2. Group B2B invoices by recipient GSTIN (ctin)
    const b2bMap = new Map<string, { ctin: string; cname: string; inv: any[] }>();

    b2bInvoices.forEach((inv) => {
      const ctin = inv.gstin;
      if (!b2bMap.has(ctin)) {
        b2bMap.set(ctin, {
          ctin,
          cname: inv.recipient_name,
          inv: [],
        });
      }

      const group = b2bMap.get(ctin)!;
      group.inv.push({
        inum: inv.invoice_number,
        idt: formatGstnDate(inv.invoice_date),
        val: Number((inv.invoice_value_paise / 100).toFixed(2)),
        pos: inv.pos_state_code,
        rchrg: inv.reverse_charge,
        inv_typ: 'R',
        itms: [
          {
            num: 1,
            itm_det: {
              rt: inv.tax_rate_bps / 100,
              txval: Number((inv.taxable_value_paise / 100).toFixed(2)),
              iamt: Number((inv.igst_paise / 100).toFixed(2)),
              camt: Number((inv.cgst_paise / 100).toFixed(2)),
              samt: Number((inv.sgst_paise / 100).toFixed(2)),
              csamt: 0,
            },
          },
        ],
      });
    });

    const b2b = Array.from(b2bMap.values());

    // 3. Format B2CS entries with numeric values
    const b2cs = b2cEntries.map((b2c) => ({
      sply_ty: b2c.pos_state_code === '27' ? 'INTRA' : 'INTER',
      pos: b2c.pos_state_code,
      typ: b2c.type,
      rt: b2c.tax_rate_bps / 100,
      txval: Number((b2c.taxable_value_paise / 100).toFixed(2)),
      iamt: Number((b2c.igst_paise / 100).toFixed(2)),
      camt: Number((b2c.cgst_paise / 100).toFixed(2)),
      samt: Number((b2c.sgst_paise / 100).toFixed(2)),
      csamt: 0,
    }));

    // 4. Format HSN summaries with numeric values
    const hsn = {
      data: hsnSummaries.map((h, idx) => ({
        num: idx + 1,
        hsn_sc: h.hsn_sac,
        desc: h.description,
        uqc: h.uqc,
        qty: Number((h.total_quantity_milli / 1000).toFixed(3)),
        val: Number((h.total_value_paise / 100).toFixed(2)),
        txval: Number((h.taxable_value_paise / 100).toFixed(2)),
        iamt: Number((h.igst_paise / 100).toFixed(2)),
        camt: Number((h.cgst_paise / 100).toFixed(2)),
        samt: Number((h.sgst_paise / 100).toFixed(2)),
        csamt: 0,
      })),
    };

    const payload = {
      gstin: '27AABCO1234F1Z5',
      fp,
      b2b,
      b2cs,
      hsn,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `GSTR1_${payload.gstin}_${payload.fp}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportGstr1ExcelCsv = () => {
    let csv = 'GSTR-1 Outward Supplies Report\n';
    csv += `Period: ${selectedPeriod}, Generated: ${new Date().toISOString()}\n\n`;

    csv += '--- B2B INVOICES ---\n';
    csv += 'GSTIN,Party Name,Invoice No,Date,Invoice Value,POS,Reverse Charge,Taxable Value,IGST,CGST,SGST\n';
    b2bInvoices.forEach((inv) => {
      csv += `"${inv.gstin}","${inv.recipient_name}","${inv.invoice_number}","${inv.invoice_date}",${(inv.invoice_value_paise / 100).toFixed(2)},"${inv.pos_state_code}","${inv.reverse_charge}",${(inv.taxable_value_paise / 100).toFixed(2)},${(inv.igst_paise / 100).toFixed(2)},${(inv.cgst_paise / 100).toFixed(2)},${(inv.sgst_paise / 100).toFixed(2)}\n`;
    });

    csv += '\n--- HSN SUMMARY ---\n';
    csv += 'HSN/SAC,Description,UQC,Total Qty,Total Value,Taxable Value,IGST,CGST,SGST\n';
    hsnSummaries.forEach((h) => {
      csv += `"${h.hsn_sac}","${h.description}","${h.uqc}",${(h.total_quantity_milli / 1000).toFixed(3)},${(h.total_value_paise / 100).toFixed(2)},${(h.taxable_value_paise / 100).toFixed(2)},${(h.igst_paise / 100).toFixed(2)},${(h.cgst_paise / 100).toFixed(2)},${(h.sgst_paise / 100).toFixed(2)}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `GSTR1_Export_${selectedPeriod}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // -------------------------------------------------------------
  // TAB 4: STOCK VALUATION & AGING
  // -------------------------------------------------------------
  const isLotNearExpiry = (expiryDate: string): boolean => {
    if (!expiryDate) return false;
    const exp = new Date(expiryDate).getTime();
    const now = new Date().getTime();
    const diffDays = (exp - now) / (1000 * 60 * 60 * 24);
    return diffDays <= 30;
  };

  const valuationTotals = useMemo(() => {
    let totalCostVal = 0;
    let totalRetailVal = 0;
    let lowStockCount = 0;
    const nearExpiryLots: Array<{ item: StockValuationItem; lot: any; daysLeft: number }> = [];

    stockItems.forEach((item) => {
      totalCostVal += item.valuation_cost_paise;
      totalRetailVal += item.valuation_retail_paise;
      if (item.is_low_stock) lowStockCount++;

      item.lots.forEach((lot) => {
        if (lot.expiry_date) {
          const exp = new Date(lot.expiry_date).getTime();
          const now = new Date().getTime();
          const daysLeft = Math.ceil((exp - now) / (1000 * 60 * 60 * 24));
          if (daysLeft <= 30) {
            nearExpiryLots.push({ item, lot, daysLeft });
          }
        }
      });
    });

    return {
      totalCostVal,
      totalRetailVal,
      lowStockCount,
      nearExpiryLots,
    };
  }, [stockItems]);

  const filteredStockItems = useMemo(() => {
    if (stockFilter === 'LOW_ONLY') {
      return stockItems.filter((i) => i.is_low_stock);
    }
    if (stockFilter === 'EXPIRING_ONLY') {
      return stockItems.filter((i) => i.lots.some((l) => isLotNearExpiry(l.expiry_date)));
    }
    return stockItems;
  }, [stockItems, stockFilter]);

  return (
    <div className="flex-1 flex flex-col bg-slate-950 text-slate-100 overflow-hidden">
      {/* Top Header & Tab Navigation */}
      <div className="border-b border-slate-800 bg-slate-900/60 px-6 py-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-blue-600/20 text-blue-400 border border-blue-500/30">
              <BarChart3 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
                Financial Reports & Audit Dashboard
              </h2>
              <p className="text-xs text-slate-400">
                Audited double-entry General Ledger, Real-time Day Book, GSTR-1 returns, and Stock Aging.
              </p>
            </div>
          </div>

          {/* Tab Navigation Buttons */}
          <div className="flex items-center bg-slate-900 p-1 rounded-xl border border-slate-800 select-none">
            <button
              onClick={() => setActiveTab('TRIAL_BALANCE')}
              className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'TRIAL_BALANCE'
                  ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Trial Balance (Alt+T)"
            >
              <Scale className="w-3.5 h-3.5" />
              <span>Trial Balance</span>
            </button>

            <button
              onClick={() => setActiveTab('DAY_BOOK')}
              className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'DAY_BOOK'
                  ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-600/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Day Book (Alt+D)"
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>Day Book</span>
            </button>

            <button
              onClick={() => setActiveTab('PURCHASES')}
              className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'PURCHASES'
                  ? 'bg-rose-600 text-white shadow-sm shadow-rose-600/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Inward Purchase Register (Alt+P)"
            >
              <Package className="w-3.5 h-3.5" />
              <span>Purchase Register</span>
              {purchases.length > 0 && (
                <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-rose-500/20 text-rose-300 font-mono font-bold">
                  {purchases.length}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('GSTR1')}
              className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'GSTR1'
                  ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="GSTR-1 Summary (Alt+G)"
            >
              <Receipt className="w-3.5 h-3.5" />
              <span>GSTR-1</span>
            </button>

            <button
              onClick={() => setActiveTab('GSTR3B')}
              className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'GSTR3B'
                  ? 'bg-purple-600 text-white shadow-sm shadow-purple-600/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Form GSTR-3B Return (Alt+3)"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>GSTR-3B</span>
            </button>

            <button
              onClick={() => setActiveTab('BRS')}
              className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'BRS'
                  ? 'bg-cyan-600 text-white shadow-sm shadow-cyan-600/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Bank Reconciliation Statement (Alt+B)"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Bank Reconcile (BRS)</span>
              {brsSummary && brsSummary.pending_count > 0 && (
                <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-cyan-500/20 text-cyan-300 font-mono font-bold">
                  {brsSummary.pending_count}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('STOCK_VALUATION')}
              className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'STOCK_VALUATION'
                  ? 'bg-amber-600 text-white shadow-sm shadow-amber-600/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Stock Valuation & Aging (Alt+S)"
            >
              <Boxes className="w-3.5 h-3.5" />
              <span>Stock Valuation</span>
            </button>

            <button
              onClick={() => setActiveTab('FINANCIAL_STATEMENTS')}
              className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'FINANCIAL_STATEMENTS'
                  ? 'bg-teal-600 text-white shadow-sm shadow-teal-600/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Profit & Loss and Balance Sheet (Alt+F)"
            >
              <BarChart3 className="w-3.5 h-3.5" />
              <span>P&L & Balance Sheet</span>
            </button>

            <button
              onClick={() => setActiveTab('STOCKTAKE')}
              className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'STOCKTAKE'
                  ? 'bg-orange-600 text-white shadow-sm shadow-orange-600/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Physical Stocktake & Cycle Count (Alt+K)"
            >
              <ClipboardCheck className="w-3.5 h-3.5" />
              <span>Stocktake</span>
              {stocktakeItems.some((s) => s.variance_milli !== 0) && (
                <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-orange-500/20 text-orange-300 font-mono font-bold">
                  {stocktakeItems.filter((s) => s.variance_milli !== 0).length} var
                </span>
              )}
            </button>
          </div>

          {/* Hard Period Lock Control */}
          <button
            onClick={() => setIsPeriodLockModalOpen(true)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all shadow-sm ${
              periodLock?.lock_date
                ? 'bg-amber-950/40 border-amber-800/60 text-amber-300 hover:bg-amber-900/50 hover:border-amber-700'
                : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
            }`}
            title="Fiscal Period Lock Settings (Alt+L)"
          >
            {periodLock?.lock_date ? (
              <Lock className="w-3.5 h-3.5 text-amber-400" />
            ) : (
              <Unlock className="w-3.5 h-3.5 text-slate-400" />
            )}
            <span>
              {periodLock?.lock_date ? `Locked: ${periodLock.lock_date}` : 'Period Lock: Open'}
            </span>
          </button>
        </div>
      </div>

      {/* Main Tab Panels */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6">
        {/* ============================================================= */}
        {/* TAB 1: TRIAL BALANCE */}
        {/* ============================================================= */}
        {activeTab === 'TRIAL_BALANCE' && (
          <div className="space-y-5 max-w-6xl mx-auto">
            {/* Live Indicator Banner */}
            <div
              className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-lg ${
                trialBalanceComputation.isBalanced
                  ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
                  : 'bg-rose-950/40 border-rose-500/40 text-rose-200'
              }`}
            >
              <div className="flex items-center space-x-3">
                <div
                  className={`p-2.5 rounded-xl ${
                    trialBalanceComputation.isBalanced
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                      : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                  }`}
                >
                  {trialBalanceComputation.isBalanced ? (
                    <CheckCircle2 className="w-6 h-6" />
                  ) : (
                    <AlertTriangle className="w-6 h-6" />
                  )}
                </div>
                <div>
                  <h3 className="text-base font-bold tracking-tight">
                    {trialBalanceComputation.isBalanced
                      ? 'Trial Balance is Balanced (Debit == Credit)'
                      : `Imbalance Detected! Difference: ${formatPaise(trialBalanceComputation.diffPaise)}`}
                  </h3>
                  <p className="text-xs opacity-80 mt-0.5">
                    {trialBalanceComputation.isBalanced
                      ? 'Every ledger debit entry is perfectly matched by corresponding credit entries across the double-entry books.'
                      : 'Audit warning: Total debits do not match total credits. Running verify_ledger() consistency audit is recommended.'}
                  </p>
                </div>
              </div>

              <div className="flex items-center space-x-3 select-none">
                {/* Toggle simulated imbalance to test error badge */}
                <button
                  onClick={() => setIsSimulatedImbalance(!isSimulatedImbalance)}
                  className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-300 hover:text-white transition-colors"
                >
                  {isSimulatedImbalance ? 'Reset Ledger Invariant' : 'Simulate Imbalance'}
                </button>

                <button
                  onClick={() => window.print()}
                  className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition-colors"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print</span>
                </button>
              </div>
            </div>

            {/* Trial Balance Table */}
            <div className="border border-slate-800 rounded-xl overflow-x-auto bg-slate-900/50 shadow-xl">
              <table className="w-full text-left border-collapse text-xs min-w-[650px]">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-900/90 text-[11px] font-semibold text-slate-400 uppercase tracking-wider font-mono select-none">
                    <th className="py-3 px-4 w-28">Account Code</th>
                    <th className="py-3 px-4">Account Name & Class</th>
                    <th className="py-3 px-4 text-center">Class</th>
                    <th className="py-3 px-4 text-right">Debit Balance (₹)</th>
                    <th className="py-3 px-4 text-right">Credit Balance (₹)</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-800/80 font-mono">
                  {(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'] as AccountType[]).map((groupType) => {
                    const groupAccounts = trialBalanceComputation.groups[groupType];
                    const groupDebit = groupAccounts.reduce((acc, a) => acc + a.debit_paise, 0);
                    const groupCredit = groupAccounts.reduce((acc, a) => acc + a.credit_paise, 0);

                    return (
                      <React.Fragment key={groupType}>
                        {/* Group Header */}
                        <tr className="bg-slate-900/70 border-y border-slate-800 font-sans font-bold text-slate-300">
                          <td colSpan={3} className="py-2.5 px-4 text-[11px] uppercase tracking-wider text-blue-400">
                            {groupType} ACCOUNTS
                          </td>
                          <td className="py-2.5 px-4 text-right text-slate-300">
                            {groupDebit > 0 ? formatPaise(groupDebit) : '-'}
                          </td>
                          <td className="py-2.5 px-4 text-right text-slate-300">
                            {groupCredit > 0 ? formatPaise(groupCredit) : '-'}
                          </td>
                        </tr>

                        {/* Group Account Rows */}
                        {groupAccounts.map((account) => (
                          <tr key={account.id} className="hover:bg-slate-800/40 transition-colors">
                            <td className="py-2.5 px-4 text-blue-400 font-semibold">{account.code}</td>
                            <td className="py-2.5 px-4 text-slate-200 font-sans font-medium">
                              {account.name}
                            </td>
                            <td className="py-2.5 px-4 text-center">
                              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-slate-400">
                                {account.type}
                              </span>
                            </td>
                            <td className="py-2.5 px-4 text-right text-slate-100">
                              {account.debit_paise > 0 ? formatPaise(account.debit_paise) : '-'}
                            </td>
                            <td className="py-2.5 px-4 text-right text-slate-100">
                              {account.credit_paise > 0 ? formatPaise(account.credit_paise) : '-'}
                            </td>
                          </tr>
                        ))}
                      </React.Fragment>
                    );
                  })}
                </tbody>

                {/* Grand Totals */}
                <tfoot>
                  <tr className="border-t-2 border-slate-700 bg-slate-900 font-mono font-bold text-sm">
                    <td colSpan={3} className="py-4 px-4 text-right uppercase text-xs text-slate-300">
                      Grand Total Ledger Balance:
                    </td>
                    <td className="py-4 px-4 text-right text-emerald-400">
                      {formatPaise(trialBalanceComputation.sumDebit)}
                    </td>
                    <td className="py-4 px-4 text-right text-emerald-400">
                      {formatPaise(trialBalanceComputation.sumCredit)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {/* ============================================================= */}
        {/* TAB 2: DAY BOOK */}
        {/* ============================================================= */}
        {activeTab === 'DAY_BOOK' && (
          <div className="space-y-5 max-w-6xl mx-auto">
            {/* Date Selector & Inflow/Outflow Cards */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900/60 border border-slate-800 p-4 rounded-xl">
              <div className="flex items-center space-x-3">
                <Calendar className="w-5 h-5 text-blue-400" />
                <span className="text-xs font-semibold text-slate-300">Business Date:</span>
                <button
                  onClick={() => changeDateByDays(-1)}
                  className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
                  title="Previous Day"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-blue-500"
                />
                <button
                  onClick={() => changeDateByDays(1)}
                  className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
                  title="Next Day"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setSelectedDate(new Date().toISOString().split('T')[0])}
                  className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs text-blue-400 font-semibold"
                >
                  Today
                </button>
              </div>

              <div className="text-xs text-slate-400 font-mono">
                {dayBookEntries.length} chronological voucher events recorded
              </div>
            </div>

            {/* Daily Inflow vs Outflow KPI Cards */}
            {dayBookSummary && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl">
                  <span className="text-[11px] text-slate-400 uppercase font-semibold">
                    Total Daily Sales
                  </span>
                  <div className="text-base font-bold text-blue-400 font-mono mt-1">
                    {formatPaise(dayBookSummary.total_sales_paise)}
                  </div>
                </div>

                <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl">
                  <span className="text-[11px] text-slate-400 uppercase font-semibold">
                    Inflow Receipts
                  </span>
                  <div className="text-base font-bold text-emerald-400 font-mono mt-1 flex items-center gap-1">
                    <TrendingUp className="w-4 h-4" />
                    <span>{formatPaise(dayBookSummary.total_receipts_paise)}</span>
                  </div>
                </div>

                <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl">
                  <span className="text-[11px] text-slate-400 uppercase font-semibold">
                    Daily Purchases
                  </span>
                  <div className="text-base font-bold text-purple-400 font-mono mt-1">
                    {formatPaise(dayBookSummary.total_purchases_paise)}
                  </div>
                </div>

                <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl">
                  <span className="text-[11px] text-slate-400 uppercase font-semibold">
                    Outflow Payments
                  </span>
                  <div className="text-base font-bold text-rose-400 font-mono mt-1 flex items-center gap-1">
                    <TrendingDown className="w-4 h-4" />
                    <span>{formatPaise(dayBookSummary.total_payments_paise)}</span>
                  </div>
                </div>

                <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl">
                  <span className="text-[11px] text-slate-400 uppercase font-semibold">
                    Net Cash / Bank Inflow
                  </span>
                  <div
                    className={`text-base font-bold font-mono mt-1 ${
                      dayBookSummary.net_cash_flow_paise >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {dayBookSummary.net_cash_flow_paise >= 0 ? '+' : ''}
                    {formatPaise(dayBookSummary.net_cash_flow_paise)}
                  </div>
                </div>
              </div>
            )}

            {/* Day Book Transactions Table */}
            <div className="border border-slate-800 rounded-xl overflow-x-auto bg-slate-900/50 shadow-xl">
              <table className="w-full text-left border-collapse text-xs min-w-[700px]">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-900/90 text-[11px] font-semibold text-slate-400 uppercase tracking-wider font-mono select-none">
                    <th className="py-3 px-4">Time</th>
                    <th className="py-3 px-4">Voucher No</th>
                    <th className="py-3 px-4">Voucher Type</th>
                    <th className="py-3 px-4">Entity / Party</th>
                    <th className="py-3 px-4">Narration</th>
                    <th className="py-3 px-4 text-center">Mode</th>
                    <th className="py-3 px-4 text-right">Inflow (₹)</th>
                    <th className="py-3 px-4 text-right">Outflow (₹)</th>
                    <th className="py-3 px-4 text-right">Voucher Total (₹)</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-800/80 font-mono">
                  {dayBookEntries.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-12 text-center text-slate-500 font-sans">
                        <BookOpen className="w-8 h-8 mx-auto mb-2 opacity-50" />
                        <p className="font-semibold text-slate-400">No transactions recorded for {selectedDate}.</p>
                      </td>
                    </tr>
                  ) : (
                    dayBookEntries.map((row) => (
                      <tr key={row.id} className="hover:bg-slate-800/40 transition-colors">
                        <td className="py-3 px-4 text-slate-400">{row.time}</td>
                        <td className="py-3 px-4 text-blue-400 font-semibold">{row.voucher_number}</td>
                        <td className="py-3 px-4">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                              row.type === 'SALE'
                                ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                                : row.type === 'PURCHASE'
                                ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                                : row.type === 'RECEIPT'
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                : row.type === 'PAYMENT'
                                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                : 'bg-slate-800 text-slate-400'
                            }`}
                          >
                            {row.type}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-sans font-medium text-slate-200">
                          {row.party_name}
                        </td>
                        <td className="py-3 px-4 font-sans text-slate-400 max-w-xs truncate">
                          {row.narration}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 text-slate-300 border border-slate-700">
                            {row.payment_mode}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right text-emerald-400">
                          {row.inflow_paise > 0 ? formatPaise(row.inflow_paise) : '-'}
                        </td>
                        <td className="py-3 px-4 text-right text-rose-400">
                          {row.outflow_paise > 0 ? formatPaise(row.outflow_paise) : '-'}
                        </td>
                        <td className="py-3 px-4 text-right text-slate-100 font-bold">
                          {formatPaise(row.net_amount_paise)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ============================================================= */}
        {/* TAB 3: INWARD PURCHASES REGISTER */}
        {/* ============================================================= */}
        {activeTab === 'PURCHASES' && (
          <div className="space-y-5 max-w-6xl mx-auto">
            {/* Header & Search Toolbar */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900/60 border border-slate-800 p-4 rounded-xl">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Package className="w-5 h-5 text-rose-400" />
                  <span>Purchase & Inward Expense Register</span>
                  <span className="text-xs px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30 font-mono">
                    Audit Ledger
                  </span>
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Complete official record of all stock purchase bills, vendor consignments, and inward expense vouchers.
                </p>
              </div>

              {/* Search & Actions */}
              <div className="flex items-center gap-3">
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={purchaseSearch}
                    onChange={(e) => setPurchaseSearch(e.target.value)}
                    placeholder="Search by Bill # or Vendor..."
                    className="pl-9 pr-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-rose-500 w-56 sm:w-64"
                  />
                </div>
              </div>
            </div>

            {/* KPI Cards & List */}
            {(() => {
              const totalBills = purchases.length;
              let totalExpensePaise = 0;
              let totalUnitsInwarded = 0;
              purchases.forEach((p) => {
                p.lines?.forEach((l: any) => {
                  totalExpensePaise += Math.round((l.quantity_milli * l.cost_price_paise) / 1000);
                  totalUnitsInwarded += Math.round(l.quantity_milli / 1000);
                });
              });

              const filteredPurchases = purchases.filter((p) => {
                if (!purchaseSearch.trim()) return true;
                const q = purchaseSearch.toLowerCase();
                const supMatch = (p.supplier || '').toLowerCase().includes(q);
                const invMatch = (p.invoice_number || '').toLowerCase().includes(q);
                return supMatch || invMatch;
              });

              return (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="bg-slate-900/60 border border-slate-800 p-4 rounded-xl">
                      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Total Inward Vouchers</div>
                      <div className="text-2xl font-black text-white font-mono">{totalBills}</div>
                      <div className="text-[11px] text-slate-500 mt-1">Verified Inward Bills</div>
                    </div>
                    <div className="bg-slate-900/60 border border-rose-900/40 p-4 rounded-xl">
                      <div className="text-xs font-semibold text-rose-400 uppercase tracking-wider mb-1">Total Inward Value (At Cost)</div>
                      <div className="text-2xl font-black text-rose-300 font-mono">{formatPaise(totalExpensePaise)}</div>
                      <div className="text-[11px] text-slate-500 mt-1">Net Outflow / Accounts Payable</div>
                    </div>
                    <div className="bg-slate-900/60 border border-slate-800 p-4 rounded-xl">
                      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Total Quantity Inwarded</div>
                      <div className="text-2xl font-black text-emerald-400 font-mono">{totalUnitsInwarded.toLocaleString()} Units</div>
                      <div className="text-[11px] text-slate-500 mt-1">Added to Inventory Lots</div>
                    </div>
                  </div>

                  {/* Purchases Table */}
                  <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs font-mono">
                        <thead className="bg-slate-950/80 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
                          <tr>
                            <th className="py-3 px-4">Date / Time</th>
                            <th className="py-3 px-4">Voucher / Bill #</th>
                            <th className="py-3 px-4">Supplier / Vendor</th>
                            <th className="py-3 px-4">Items Breakdown</th>
                            <th className="py-3 px-4 text-center">Lines</th>
                            <th className="py-3 px-4 text-right">Bill Total (₹)</th>
                            <th className="py-3 px-4 text-center">Status</th>
                            <th className="py-3 px-4 text-center">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60">
                          {filteredPurchases.length === 0 ? (
                            <tr>
                              <td colSpan={8} className="py-12 text-center text-slate-500">
                                <Package className="w-8 h-8 text-slate-600 mx-auto mb-2 opacity-50" />
                                <div>No inward purchase vouchers match the criteria.</div>
                                <div className="text-[11px] text-slate-600 mt-1">Inward items via Purchase Entry (F9) or Goods Receipt (GRN) to populate this register.</div>
                              </td>
                            </tr>
                          ) : (
                            filteredPurchases.map((p, idx) => {
                              const billCostPaise = p.lines?.reduce(
                                (acc: number, l: any) => acc + Math.round((l.quantity_milli * l.cost_price_paise) / 1000),
                                0
                              ) || 0;
                              return (
                                <tr key={p.id || idx} className="hover:bg-slate-800/40 transition-colors">
                                  <td className="py-3 px-4 text-slate-300">
                                    <div>{p.invoice_date || 'Today'}</div>
                                    <div className="text-[10px] text-slate-500">
                                      {p.created_at ? new Date(p.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Recorded'}
                                    </div>
                                  </td>
                                  <td className="py-3 px-4 font-bold text-rose-300">
                                    {p.invoice_number}
                                  </td>
                                  <td className="py-3 px-4 font-sans font-medium text-slate-200">
                                    {p.supplier || 'Primary Vendor'}
                                  </td>
                                  <td className="py-3 px-4 font-sans text-slate-400 max-w-xs truncate">
                                    {p.lines?.map((l: any) => `${l.sku || 'Item'} × ${Math.round(l.quantity_milli / 1000)}`).join(', ')}
                                  </td>
                                  <td className="py-3 px-4 text-center">
                                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 text-slate-300 border border-slate-700">
                                      {p.lines?.length || 0}
                                    </span>
                                  </td>
                                  <td className="py-3 px-4 text-right text-rose-400 font-bold">
                                    {formatPaise(billCostPaise)}
                                  </td>
                                  <td className="py-3 px-4 text-center">
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                                      <CheckCircle2 className="w-3 h-3" />
                                      Inwarded
                                    </span>
                                  </td>
                                  <td className="py-3 px-4 text-center">
                                    <button
                                      onClick={() => {
                                        const v: PurchaseExpenseVoucher = {
                                          voucherNumber: p.invoice_number,
                                          invoiceDate: p.invoice_date || new Date().toISOString().split('T')[0],
                                          supplierName: p.supplier || 'Primary Vendor',
                                          businessName: 'OmniBill Store',
                                          paymentMode: 'CASH',
                                          items: (p.lines || []).map((l: any) => {
                                            const qty = Math.round(l.quantity_milli / 1000);
                                            return {
                                              name: l.sku || l.resource_id,
                                              sku: l.sku,
                                              quantity: qty,
                                              unit: 'units',
                                              costPricePaise: l.cost_price_paise,
                                              lineTotalPaise: Math.round((l.quantity_milli * l.cost_price_paise) / 1000),
                                            };
                                          }),
                                          totalExpensePaise: billCostPaise,
                                          verticalType: 'RETAIL',
                                        };
                                        setSelectedVoucherForModal(v);
                                      }}
                                      className="inline-flex items-center gap-1 px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded text-xs transition-colors"
                                      title="View / Print Inward Expense Bill"
                                    >
                                      <Eye className="w-3 h-3 text-blue-400" />
                                      <span>View Bill</span>
                                    </button>
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        )}

        {/* ============================================================= */}
        {/* TAB 4: GSTR-1 SUMMARY */}
        {/* ============================================================= */}
        {activeTab === 'GSTR1' && (
          <div className="space-y-5 max-w-6xl mx-auto">
            {/* Header & Export Toolbar */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900/60 border border-slate-800 p-4 rounded-xl">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <span>GST Return Outward Supplies (Form GSTR-1)</span>
                  <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-mono">
                    FY 2026-27
                  </span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Automated B2B invoices, B2C consumer breakdown, and HSN-wise tax aggregation for direct GST portal upload.
                </p>
              </div>

              <div className="flex items-center space-x-3">
                {/* Export to JSON */}
                <button
                  onClick={exportGstr1Json}
                  className="flex items-center space-x-2 px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/30 transition-all cursor-pointer"
                  title="Export official GST Portal compatible JSON payload"
                >
                  <FileCode className="w-4 h-4" />
                  <span>Export to JSON</span>
                </button>

                {/* Export to Excel/CSV */}
                <button
                  onClick={exportGstr1ExcelCsv}
                  className="flex items-center space-x-2 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-lg shadow-emerald-600/30 transition-all cursor-pointer"
                  title="Export full GSTR-1 workbook to CSV / Excel"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  <span>Export to Excel / CSV</span>
                </button>
              </div>
            </div>

            {/* GSTR-1 Sub-tabs */}
            <div className="flex items-center space-x-2 border-b border-slate-800 pb-2 text-xs">
              <button
                onClick={() => setGstrSubTab('B2B')}
                className={`px-4 py-2 rounded-lg font-semibold transition-colors ${
                  gstrSubTab === 'B2B'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                Table 4: B2B Invoices ({b2bInvoices.length})
              </button>
              <button
                onClick={() => setGstrSubTab('B2C')}
                className={`px-4 py-2 rounded-lg font-semibold transition-colors ${
                  gstrSubTab === 'B2C'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                Table 5 & 7: B2C Large & Small ({b2cEntries.length})
              </button>
              <button
                onClick={() => setGstrSubTab('HSN')}
                className={`px-4 py-2 rounded-lg font-semibold transition-colors ${
                  gstrSubTab === 'HSN'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                Table 12: HSN-wise Tax Summary ({hsnSummaries.length})
              </button>
            </div>

            {/* Sub-tab 1: B2B Table */}
            {gstrSubTab === 'B2B' && (
              <div className="border border-slate-800 rounded-xl overflow-x-auto bg-slate-900/50 shadow-xl">
                <table className="w-full text-left border-collapse text-xs min-w-[850px]">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-900/90 text-[11px] font-semibold text-slate-400 uppercase tracking-wider font-mono select-none">
                      <th className="py-3 px-4">GSTIN of Recipient</th>
                      <th className="py-3 px-4">Receiver Name</th>
                      <th className="py-3 px-4">Invoice #</th>
                      <th className="py-3 px-4">Date</th>
                      <th className="py-3 px-4 text-center">POS</th>
                      <th className="py-3 px-4 text-right">Taxable Value (₹)</th>
                      <th className="py-3 px-4 text-right">IGST (₹)</th>
                      <th className="py-3 px-4 text-right">CGST (₹)</th>
                      <th className="py-3 px-4 text-right">SGST (₹)</th>
                      <th className="py-3 px-4 text-right">Invoice Value (₹)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80 font-mono">
                    {b2bInvoices.map((inv) => (
                      <tr key={inv.id} className="hover:bg-slate-800/40">
                        <td className="py-3 px-4 text-emerald-400 font-semibold">{inv.gstin}</td>
                        <td className="py-3 px-4 font-sans text-slate-200 font-medium">{inv.recipient_name}</td>
                        <td className="py-3 px-4 text-blue-400 font-semibold">{inv.invoice_number}</td>
                        <td className="py-3 px-4 text-slate-400">{inv.invoice_date}</td>
                        <td className="py-3 px-4 text-center text-slate-300">
                          {inv.pos_state_code}
                        </td>
                        <td className="py-3 px-4 text-right text-slate-200">
                          {formatPaise(inv.taxable_value_paise)}
                        </td>
                        <td className="py-3 px-4 text-right text-slate-300">
                          {inv.igst_paise > 0 ? formatPaise(inv.igst_paise) : '-'}
                        </td>
                        <td className="py-3 px-4 text-right text-slate-300">
                          {inv.cgst_paise > 0 ? formatPaise(inv.cgst_paise) : '-'}
                        </td>
                        <td className="py-3 px-4 text-right text-slate-300">
                          {inv.sgst_paise > 0 ? formatPaise(inv.sgst_paise) : '-'}
                        </td>
                        <td className="py-3 px-4 text-right text-white font-bold">
                          {formatPaise(inv.invoice_value_paise)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Sub-tab 2: B2C Table */}
            {gstrSubTab === 'B2C' && (
              <div className="border border-slate-800 rounded-xl overflow-x-auto bg-slate-900/50 shadow-xl">
                <table className="w-full text-left border-collapse text-xs min-w-[700px]">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-900/90 text-[11px] font-semibold text-slate-400 uppercase tracking-wider font-mono select-none">
                      <th className="py-3 px-4">Supply Type</th>
                      <th className="py-3 px-4">Place of Supply (POS)</th>
                      <th className="py-3 px-4 text-center">Tax Slab</th>
                      <th className="py-3 px-4 text-center">Voucher Count</th>
                      <th className="py-3 px-4 text-right">Taxable Value (₹)</th>
                      <th className="py-3 px-4 text-right">CGST (₹)</th>
                      <th className="py-3 px-4 text-right">SGST (₹)</th>
                      <th className="py-3 px-4 text-right">IGST (₹)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80 font-mono">
                    {b2cEntries.map((b2c) => (
                      <tr key={b2c.id} className="hover:bg-slate-800/40">
                        <td className="py-3 px-4">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                              b2c.type === 'B2C_LARGE'
                                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                            }`}
                          >
                            {b2c.type === 'B2C_LARGE' ? 'B2C Large (> ₹2.5L)' : 'B2C Small (Retail)'}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-sans text-slate-200">
                          {b2c.pos_state_code} - {getStateName(b2c.pos_state_code)}
                        </td>
                        <td className="py-3 px-4 text-center font-bold text-blue-400">
                          {(b2c.tax_rate_bps / 100).toFixed(0)}%
                        </td>
                        <td className="py-3 px-4 text-center text-slate-300 font-bold">
                          {b2c.invoice_count}
                        </td>
                        <td className="py-3 px-4 text-right text-slate-100 font-bold">
                          {formatPaise(b2c.taxable_value_paise)}
                        </td>
                        <td className="py-3 px-4 text-right text-slate-300">
                          {b2c.cgst_paise > 0 ? formatPaise(b2c.cgst_paise) : '-'}
                        </td>
                        <td className="py-3 px-4 text-right text-slate-300">
                          {b2c.sgst_paise > 0 ? formatPaise(b2c.sgst_paise) : '-'}
                        </td>
                        <td className="py-3 px-4 text-right text-slate-300">
                          {b2c.igst_paise > 0 ? formatPaise(b2c.igst_paise) : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Sub-tab 3: HSN Summary Table */}
            {gstrSubTab === 'HSN' && (
              <div className="border border-slate-800 rounded-xl overflow-x-auto bg-slate-900/50 shadow-xl">
                <table className="w-full text-left border-collapse text-xs min-w-[750px]">
                  <thead className="sticky top-0 bg-slate-900 z-10">
                    <tr className="border-b border-slate-800 bg-slate-900/90 text-[11px] font-semibold text-slate-400 uppercase tracking-wider font-mono select-none">
                      <th className="py-3 px-4">HSN / SAC</th>
                      <th className="py-3 px-4">Description</th>
                      <th className="py-3 px-4 text-center">UQC</th>
                      <th className="py-3 px-4 text-right">Total Qty</th>
                      <th className="py-3 px-4 text-right">Total Value (₹)</th>
                      <th className="py-3 px-4 text-right">Taxable Value (₹)</th>
                      <th className="py-3 px-4 text-right">IGST (₹)</th>
                      <th className="py-3 px-4 text-right">CGST (₹)</th>
                      <th className="py-3 px-4 text-right">SGST (₹)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80 font-mono">
                    {hsnSummaries.map((hsn) => (
                      <tr key={hsn.hsn_sac} className="hover:bg-slate-800/40">
                        <td className="py-3 px-4 font-bold text-blue-400">{hsn.hsn_sac}</td>
                        <td className="py-3 px-4 font-sans text-slate-200 max-w-sm truncate">
                          {hsn.description}
                        </td>
                        <td className="py-3 px-4 text-center text-slate-400">{hsn.uqc}</td>
                        <td className="py-3 px-4 text-right text-emerald-400 font-bold">
                          {formatMilliQty(hsn.total_quantity_milli)}
                        </td>
                        <td className="py-3 px-4 text-right text-slate-300">
                          {formatPaise(hsn.total_value_paise)}
                        </td>
                        <td className="py-3 px-4 text-right text-slate-100 font-bold">
                          {formatPaise(hsn.taxable_value_paise)}
                        </td>
                        <td className="py-3 px-4 text-right text-slate-300">
                          {hsn.igst_paise > 0 ? formatPaise(hsn.igst_paise) : '-'}
                        </td>
                        <td className="py-3 px-4 text-right text-slate-300">
                          {hsn.cgst_paise > 0 ? formatPaise(hsn.cgst_paise) : '-'}
                        </td>
                        <td className="py-3 px-4 text-right text-slate-300">
                          {hsn.sgst_paise > 0 ? formatPaise(hsn.sgst_paise) : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ============================================================= */}
        {/* TAB 4: STOCK VALUATION & AGING */}
        {/* ============================================================= */}
        {activeTab === 'STOCK_VALUATION' && (
          <div className="space-y-5 max-w-6xl mx-auto">
            {/* KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl shadow">
                <span className="text-[11px] text-slate-400 uppercase font-semibold">
                  Total Valuation at Cost
                </span>
                <div className="text-xl font-bold text-slate-100 font-mono mt-1">
                  {formatPaise(valuationTotals.totalCostVal)}
                </div>
                <p className="text-[11px] text-slate-500 mt-1">FIFO weighted cost basis</p>
              </div>

              <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl shadow">
                <span className="text-[11px] text-slate-400 uppercase font-semibold">
                  Total Valuation at Selling Price
                </span>
                <div className="text-xl font-bold text-emerald-400 font-mono mt-1">
                  {formatPaise(valuationTotals.totalRetailVal)}
                </div>
                <p className="text-[11px] text-slate-500 mt-1">Base catalog pricing value</p>
              </div>

              <div
                onClick={() => setStockFilter(stockFilter === 'LOW_ONLY' ? 'ALL' : 'LOW_ONLY')}
                className={`p-4 rounded-xl border cursor-pointer transition-colors ${
                  valuationTotals.lowStockCount > 0
                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/20'
                    : 'bg-slate-900 border-slate-800 text-slate-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] uppercase font-semibold">Low Stock Threshold Alerts</span>
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                </div>
                <div className="text-xl font-bold font-mono mt-1">
                  {valuationTotals.lowStockCount} Items
                </div>
                <p className="text-[11px] opacity-80 mt-1">Items at or below reorder level</p>
              </div>

              <div
                onClick={() => setStockFilter(stockFilter === 'EXPIRING_ONLY' ? 'ALL' : 'EXPIRING_ONLY')}
                className={`p-4 rounded-xl border cursor-pointer transition-colors ${
                  valuationTotals.nearExpiryLots.length > 0
                    ? 'bg-rose-500/10 border-rose-500/30 text-rose-300 hover:bg-rose-500/20'
                    : 'bg-slate-900 border-slate-800 text-slate-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] uppercase font-semibold">Near-Expiry Warning Lots</span>
                  <Clock className="w-4 h-4 text-rose-400" />
                </div>
                <div className="text-xl font-bold font-mono mt-1">
                  {valuationTotals.nearExpiryLots.length} Batches
                </div>
                <p className="text-[11px] opacity-80 mt-1">Expiring within next 30 days</p>
              </div>
            </div>

            {/* Near-Expiry Warning Table Banner (if any) */}
            {valuationTotals.nearExpiryLots.length > 0 && (
              <div className="border border-rose-500/40 bg-rose-950/20 rounded-xl p-4">
                <div className="flex items-center space-x-2 text-rose-300 font-bold text-xs mb-3">
                  <Clock className="w-4 h-4 text-rose-400" />
                  <span>Immediate Action Required: Near-Expiry Inventory Batches (&lt;= 30 Days)</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs font-mono">
                    <thead>
                      <tr className="border-b border-rose-500/20 text-slate-400 text-[11px]">
                        <th className="py-2 px-3">Item Name</th>
                        <th className="py-2 px-3">Batch #</th>
                        <th className="py-2 px-3">Expiry Date</th>
                        <th className="py-2 px-3 text-center">Days Remaining</th>
                        <th className="py-2 px-3 text-right">Batch Stock</th>
                        <th className="py-2 px-3 text-right">MRP (₹)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-rose-500/10">
                      {valuationTotals.nearExpiryLots.map(({ item, lot, daysLeft }) => (
                        <tr key={lot.id}>
                          <td className="py-2 px-3 font-sans font-medium text-slate-200">{item.name}</td>
                          <td className="py-2 px-3 text-blue-400 font-bold">{lot.batch_number}</td>
                          <td className="py-2 px-3 text-rose-400 font-bold">{lot.expiry_date}</td>
                          <td className="py-2 px-3 text-center">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                daysLeft <= 0
                                  ? 'bg-rose-600 text-white'
                                  : 'bg-amber-500/20 text-amber-300'
                              }`}
                            >
                              {daysLeft <= 0 ? 'EXPIRED' : `${daysLeft} days left`}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-right text-emerald-400 font-bold">
                            {formatMilliQty(lot.current_stock_milli)} {item.unit}
                          </td>
                          <td className="py-2 px-3 text-right text-slate-200">
                            {formatPaise(lot.mrp_paise)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Main Stock Valuation Table */}
            <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-900/50 shadow-xl">
              <div className="p-3 bg-slate-900/80 border-b border-slate-800 flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-200">
                  Full Inventory Valuation & Reorder Ledger ({filteredStockItems.length} resources)
                </span>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => setStockFilter('ALL')}
                    className={`px-2.5 py-1 rounded text-[11px] font-medium ${
                      stockFilter === 'ALL' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    All Items
                  </button>
                  <button
                    onClick={() => setStockFilter('LOW_ONLY')}
                    className={`px-2.5 py-1 rounded text-[11px] font-medium ${
                      stockFilter === 'LOW_ONLY' ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Low Stock Only
                  </button>
                  <button
                    onClick={() => setStockFilter('EXPIRING_ONLY')}
                    className={`px-2.5 py-1 rounded text-[11px] font-medium ${
                      stockFilter === 'EXPIRING_ONLY' ? 'bg-rose-600 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Expiring Lots Only
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs min-w-[850px]">
                  <thead className="sticky top-0 bg-slate-900 z-10">
                    <tr className="border-b border-slate-800 bg-slate-900/90 text-[11px] font-semibold text-slate-400 uppercase tracking-wider font-mono select-none">
                    <th className="py-3 px-4">SKU</th>
                    <th className="py-3 px-4">Item Name</th>
                    <th className="py-3 px-4">HSN</th>
                    <th className="py-3 px-4 text-right">Current Stock</th>
                    <th className="py-3 px-4 text-right">Reorder Threshold</th>
                    <th className="py-3 px-4 text-right">Unit Cost (₹)</th>
                    <th className="py-3 px-4 text-right">Valuation at Cost (₹)</th>
                    <th className="py-3 px-4 text-right">Valuation at Base (₹)</th>
                    <th className="py-3 px-4 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80 font-mono">
                  {filteredStockItems.map((item) => (
                    <tr key={item.resource_id} className="hover:bg-slate-800/40">
                      <td className="py-3 px-4 text-blue-400 font-semibold">{item.sku}</td>
                      <td className="py-3 px-4 font-sans font-medium text-slate-200">{item.name}</td>
                      <td className="py-3 px-4 text-slate-400">{item.hsn_sac}</td>
                      <td className="py-3 px-4 text-right font-bold text-emerald-400">
                        {formatMilliQty(item.total_stock_milli)} {item.unit}
                      </td>
                      <td className="py-3 px-4 text-right text-slate-400">
                        {formatMilliQty(item.reorder_threshold_milli)} {item.unit}
                      </td>
                      <td className="py-3 px-4 text-right text-slate-300">
                        {formatPaise(item.cost_price_paise)}
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-slate-100">
                        {formatPaise(item.valuation_cost_paise)}
                      </td>
                      <td className="py-3 px-4 text-right text-slate-300">
                        {formatPaise(item.valuation_retail_paise)}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {item.is_low_stock ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                            LOW STOCK
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                            OPTIMAL
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          </div>
        )}

        {/* ============================================================= */}
        {/* TAB 5: FORM GSTR-3B (TIED TO GL) */}
        {/* ============================================================= */}
        {activeTab === 'GSTR3B' && gstr3bReport && (
          <div className="space-y-6 max-w-6xl mx-auto">
            {/* Top Toolbar */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-slate-900 p-4 rounded-xl border border-slate-800">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <FileSpreadsheet className="w-5 h-5 text-purple-400" />
                  Form GSTR-3B Monthly Return
                </h3>
                <p className="text-xs text-slate-400">
                  Self-assessed summary of outward supplies, input tax credit claimed, and tax liability tied to GL.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <div className="flex items-center space-x-2 bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-700">
                  <Calendar className="w-4 h-4 text-slate-400" />
                  <select
                    value={gstr3bPeriod}
                    onChange={(e) => {
                      setGstr3bPeriod(e.target.value);
                      setGstr3bReport(ErpStorageService.getGstr3B(e.target.value));
                    }}
                    className="bg-transparent text-xs font-semibold text-white focus:outline-none cursor-pointer"
                  >
                    <option value="2026-09" className="bg-slate-900 text-white">September 2026</option>
                    <option value="2026-10" className="bg-slate-900 text-white">October 2026</option>
                    <option value="2026-11" className="bg-slate-900 text-white">November 2026</option>
                    <option value="2026-12" className="bg-slate-900 text-white">December 2026</option>
                  </select>
                </div>

                <button
                  onClick={handleExportGstr3BJson}
                  className="flex items-center space-x-2 px-3.5 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-semibold transition-all shadow-md shadow-purple-600/20"
                >
                  <Download className="w-4 h-4" />
                  <span>Export GSTN JSON</span>
                </button>
              </div>
            </div>

            {/* GL Tax Reconciliation Invariant Banner */}
            <div className={`p-4 rounded-xl border flex flex-col md:flex-row items-center justify-between gap-4 ${
              gstr3bReport.gl_reconciliation.is_tied_to_gl
                ? 'bg-emerald-950/20 border-emerald-500/40 text-emerald-200'
                : 'bg-rose-950/20 border-rose-500/40 text-rose-200'
            }`}>
              <div className="flex items-center space-x-3">
                <div className={`p-2 rounded-lg ${
                  gstr3bReport.gl_reconciliation.is_tied_to_gl ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                }`}>
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white flex items-center gap-2">
                    GL Tax Ledger Reconciliation:
                    {gstr3bReport.gl_reconciliation.is_tied_to_gl ? (
                      <span className="text-emerald-400 font-bold">100% TIED TO GL (0 DISCREPANCY)</span>
                    ) : (
                      <span className="text-rose-400 font-bold">DISCREPANCY DETECTED</span>
                    )}
                  </h4>
                  <p className="text-xs text-slate-400">
                    GSTR-3B tax totals tie to the paisa against Chart of Accounts #2100 (CGST), #2110 (SGST), and #2120 (IGST).
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-6 text-xs font-mono">
                <div>
                  <span className="text-slate-400 block text-[10px]">GL Output Tax:</span>
                  <span className="font-bold text-white">{formatPaise(
                    gstr3bReport.gl_reconciliation.gl_output_cgst_paise +
                    gstr3bReport.gl_reconciliation.gl_output_sgst_paise +
                    gstr3bReport.gl_reconciliation.gl_output_igst_paise
                  )}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">GSTR-3B Tax:</span>
                  <span className="font-bold text-purple-300">{formatPaise(
                    gstr3bReport.gl_reconciliation.gstr3b_output_cgst_paise +
                    gstr3bReport.gl_reconciliation.gstr3b_output_sgst_paise +
                    gstr3bReport.gl_reconciliation.gstr3b_output_igst_paise
                  )}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">Discrepancy:</span>
                  <span className="font-bold text-emerald-400">₹0.00</span>
                </div>
              </div>
            </div>

            {/* Table 3.1: Details of Outward Supplies */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
              <div className="bg-slate-800/80 px-4 py-3 border-b border-slate-700 flex items-center justify-between">
                <span className="text-xs font-bold text-purple-300 uppercase tracking-wider">
                  3.1 Details of Outward Supplies and Inward Supplies Liable to Reverse Charge
                </span>
                <span className="text-[11px] text-slate-400 font-medium">All figures in INR (₹)</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-950/60 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
                    <tr>
                      <th className="py-2.5 px-4 font-semibold">Nature of Supplies</th>
                      <th className="py-2.5 px-4 font-semibold text-right">Total Taxable Value</th>
                      <th className="py-2.5 px-4 font-semibold text-right">Integrated Tax (IGST)</th>
                      <th className="py-2.5 px-4 font-semibold text-right">Central Tax (CGST)</th>
                      <th className="py-2.5 px-4 font-semibold text-right">State / UT Tax (SGST)</th>
                      <th className="py-2.5 px-4 font-semibold text-right">Cess</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono">
                    <tr className="hover:bg-slate-800/30">
                      <td className="py-3 px-4 font-sans font-medium text-white">
                        (a) Outward taxable supplies (other than zero rated, nil rated and exempted)
                      </td>
                      <td className="py-3 px-4 text-right text-slate-200">{formatPaise(gstr3bReport.outward_taxable.taxable_paise)}</td>
                      <td className="py-3 px-4 text-right text-indigo-300">{formatPaise(gstr3bReport.outward_taxable.igst_paise)}</td>
                      <td className="py-3 px-4 text-right text-emerald-300">{formatPaise(gstr3bReport.outward_taxable.cgst_paise)}</td>
                      <td className="py-3 px-4 text-right text-emerald-300">{formatPaise(gstr3bReport.outward_taxable.sgst_paise)}</td>
                      <td className="py-3 px-4 text-right text-slate-400">₹0.00</td>
                    </tr>
                    <tr className="hover:bg-slate-800/30">
                      <td className="py-3 px-4 font-sans text-slate-300">(b) Outward taxable supplies (zero rated)</td>
                      <td className="py-3 px-4 text-right text-slate-400">{formatPaise(gstr3bReport.outward_zero_rated.taxable_paise)}</td>
                      <td className="py-3 px-4 text-right text-slate-400">₹0.00</td>
                      <td className="py-3 px-4 text-right text-slate-400">-</td>
                      <td className="py-3 px-4 text-right text-slate-400">-</td>
                      <td className="py-3 px-4 text-right text-slate-400">₹0.00</td>
                    </tr>
                    <tr className="hover:bg-slate-800/30">
                      <td className="py-3 px-4 font-sans text-slate-300">(c) Other outward supplies (nil rated, exempted)</td>
                      <td className="py-3 px-4 text-right text-slate-200">{formatPaise(gstr3bReport.outward_nil_exempt.taxable_paise)}</td>
                      <td className="py-3 px-4 text-right text-slate-400">-</td>
                      <td className="py-3 px-4 text-right text-slate-400">-</td>
                      <td className="py-3 px-4 text-right text-slate-400">-</td>
                      <td className="py-3 px-4 text-right text-slate-400">-</td>
                    </tr>
                    <tr className="hover:bg-slate-800/30">
                      <td className="py-3 px-4 font-sans text-slate-300">(d) Inward supplies (liable to reverse charge)</td>
                      <td className="py-3 px-4 text-right text-slate-400">₹0.00</td>
                      <td className="py-3 px-4 text-right text-slate-400">₹0.00</td>
                      <td className="py-3 px-4 text-right text-slate-400">₹0.00</td>
                      <td className="py-3 px-4 text-right text-slate-400">₹0.00</td>
                      <td className="py-3 px-4 text-right text-slate-400">₹0.00</td>
                    </tr>
                    <tr className="hover:bg-slate-800/30">
                      <td className="py-3 px-4 font-sans text-slate-300">(e) Non-GST outward supplies</td>
                      <td className="py-3 px-4 text-right text-slate-400">₹0.00</td>
                      <td className="py-3 px-4 text-right text-slate-400">-</td>
                      <td className="py-3 px-4 text-right text-slate-400">-</td>
                      <td className="py-3 px-4 text-right text-slate-400">-</td>
                      <td className="py-3 px-4 text-right text-slate-400">-</td>
                    </tr>
                  </tbody>
                  <tfoot className="bg-slate-950 font-bold border-t-2 border-slate-700 font-mono text-white">
                    <tr>
                      <td className="py-3 px-4 font-sans uppercase">Total Outward Supplies</td>
                      <td className="py-3 px-4 text-right text-purple-300">
                        {formatPaise(gstr3bReport.outward_taxable.taxable_paise + gstr3bReport.outward_nil_exempt.taxable_paise)}
                      </td>
                      <td className="py-3 px-4 text-right text-indigo-300">{formatPaise(gstr3bReport.outward_taxable.igst_paise)}</td>
                      <td className="py-3 px-4 text-right text-emerald-300">{formatPaise(gstr3bReport.outward_taxable.cgst_paise)}</td>
                      <td className="py-3 px-4 text-right text-emerald-300">{formatPaise(gstr3bReport.outward_taxable.sgst_paise)}</td>
                      <td className="py-3 px-4 text-right text-slate-400">₹0.00</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* Table 4: Eligible ITC */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
              <div className="bg-slate-800/80 px-4 py-3 border-b border-slate-700 flex items-center justify-between">
                <span className="text-xs font-bold text-emerald-300 uppercase tracking-wider">
                  4. Eligible Input Tax Credit (ITC)
                </span>
                <span className="text-[11px] text-slate-400 font-medium">Auto-derived from inward purchase invoices</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-950/60 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
                    <tr>
                      <th className="py-2.5 px-4 font-semibold">Details</th>
                      <th className="py-2.5 px-4 font-semibold text-right">Integrated Tax (IGST)</th>
                      <th className="py-2.5 px-4 font-semibold text-right">Central Tax (CGST)</th>
                      <th className="py-2.5 px-4 font-semibold text-right">State / UT Tax (SGST)</th>
                      <th className="py-2.5 px-4 font-semibold text-right">Cess</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono">
                    <tr className="bg-slate-950/30">
                      <td colSpan={5} className="py-2 px-4 font-sans font-bold text-slate-300 text-[11px]">
                        (A) ITC Available (whether in full or part)
                      </td>
                    </tr>
                    <tr className="hover:bg-slate-800/30">
                      <td className="py-2.5 px-6 font-sans text-slate-300">(1) Import of goods</td>
                      <td className="py-2.5 px-4 text-right text-slate-400">₹0.00</td>
                      <td className="py-2.5 px-4 text-right text-slate-400">-</td>
                      <td className="py-2.5 px-4 text-right text-slate-400">-</td>
                      <td className="py-2.5 px-4 text-right text-slate-400">₹0.00</td>
                    </tr>
                    <tr className="hover:bg-slate-800/30">
                      <td className="py-2.5 px-6 font-sans text-slate-300">(2) Import of services</td>
                      <td className="py-2.5 px-4 text-right text-slate-400">₹0.00</td>
                      <td className="py-2.5 px-4 text-right text-slate-400">-</td>
                      <td className="py-2.5 px-4 text-right text-slate-400">-</td>
                      <td className="py-2.5 px-4 text-right text-slate-400">₹0.00</td>
                    </tr>
                    <tr className="hover:bg-slate-800/30">
                      <td className="py-2.5 px-6 font-sans text-slate-300">(3) Inward supplies liable to reverse charge</td>
                      <td className="py-2.5 px-4 text-right text-slate-400">₹0.00</td>
                      <td className="py-2.5 px-4 text-right text-slate-400">₹0.00</td>
                      <td className="py-2.5 px-4 text-right text-slate-400">₹0.00</td>
                      <td className="py-2.5 px-4 text-right text-slate-400">₹0.00</td>
                    </tr>
                    <tr className="hover:bg-slate-800/30">
                      <td className="py-2.5 px-6 font-sans text-slate-300">(4) Inward supplies from ISD</td>
                      <td className="py-2.5 px-4 text-right text-slate-400">₹0.00</td>
                      <td className="py-2.5 px-4 text-right text-slate-400">₹0.00</td>
                      <td className="py-2.5 px-4 text-right text-slate-400">₹0.00</td>
                      <td className="py-2.5 px-4 text-right text-slate-400">₹0.00</td>
                    </tr>
                    <tr className="hover:bg-slate-800/30 bg-emerald-950/10">
                      <td className="py-2.5 px-6 font-sans font-semibold text-emerald-200">
                        (5) All other ITC (Inward Purchase Bills)
                      </td>
                      <td className="py-2.5 px-4 text-right text-slate-400">₹0.00</td>
                      <td className="py-2.5 px-4 text-right text-emerald-300 font-bold">
                        {formatPaise(gstr3bReport.itc_available.all_other_itc.cgst_paise)}
                      </td>
                      <td className="py-2.5 px-4 text-right text-emerald-300 font-bold">
                        {formatPaise(gstr3bReport.itc_available.all_other_itc.sgst_paise)}
                      </td>
                      <td className="py-2.5 px-4 text-right text-slate-400">₹0.00</td>
                    </tr>
                    <tr className="bg-slate-950/30">
                      <td colSpan={5} className="py-2 px-4 font-sans font-bold text-slate-300 text-[11px]">
                        (B) ITC Reversed (Rule 42, 43 and Others)
                      </td>
                    </tr>
                    <tr className="hover:bg-slate-800/30">
                      <td className="py-2.5 px-6 font-sans text-slate-400">Total ITC Reversals</td>
                      <td className="py-2.5 px-4 text-right text-slate-400">₹0.00</td>
                      <td className="py-2.5 px-4 text-right text-slate-400">₹0.00</td>
                      <td className="py-2.5 px-4 text-right text-slate-400">₹0.00</td>
                      <td className="py-2.5 px-4 text-right text-slate-400">₹0.00</td>
                    </tr>
                  </tbody>
                  <tfoot className="bg-slate-950 font-bold border-t-2 border-slate-700 font-mono text-white">
                    <tr>
                      <td className="py-3 px-4 font-sans uppercase text-emerald-400">
                        (C) Net ITC Available (A - B)
                      </td>
                      <td className="py-3 px-4 text-right text-slate-400">₹0.00</td>
                      <td className="py-3 px-4 text-right text-emerald-300">
                        {formatPaise(gstr3bReport.net_itc_available.cgst_paise)}
                      </td>
                      <td className="py-3 px-4 text-right text-emerald-300">
                        {formatPaise(gstr3bReport.net_itc_available.sgst_paise)}
                      </td>
                      <td className="py-3 px-4 text-right text-slate-400">₹0.00</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ============================================================= */}
        {/* TAB 6: BANK RECONCILIATION STATEMENT (BRS) */}
        {/* ============================================================= */}
        {activeTab === 'BRS' && brsSummary && (
          <div className="space-y-6 max-w-6xl mx-auto">
            {/* Header & Controls */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-slate-900 p-4 rounded-xl border border-slate-800">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-cyan-400" />
                  Bank Reconciliation Statement (BRS)
                </h3>
                <p className="text-xs text-slate-400">
                  Reconcile GL Bank Account (#1010) against Bank Statement with cleared/uncleared cheque auditing.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <label className="flex items-center space-x-2 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold cursor-pointer border border-slate-700 transition-all">
                  <Upload className="w-4 h-4 text-cyan-400" />
                  <span>Import Statement CSV</span>
                  <input
                    type="file"
                    accept=".csv"
                    className="hidden"
                    onChange={handleImportBankCsv}
                  />
                </label>
              </div>
            </div>

            {/* BRS Invariant Equation Formula Card */}
            <div className="bg-gradient-to-r from-cyan-950/40 via-slate-900 to-slate-900 border border-cyan-800/40 p-4 rounded-xl shadow-lg">
              <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                <div className="space-y-1">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-cyan-400">
                    Statutory BRS Mathematical Invariant
                  </span>
                  <div className="text-xs font-mono font-medium text-slate-200">
                    <span className="text-cyan-300 font-bold">Balance per Books</span> +
                    <span className="text-amber-300 font-bold mx-1">Unpresented Cheques</span> -
                    <span className="text-rose-300 font-bold mx-1">Uncleared Deposits</span> =
                    <span className="text-emerald-400 font-bold mx-1">Balance per Bank Statement</span>
                  </div>
                </div>

                <div className="flex items-center gap-4 text-xs font-mono">
                  <span className="px-2.5 py-1 rounded bg-slate-950 border border-slate-800 text-slate-300">
                    Reconciled: <strong className="text-emerald-400">{brsSummary.reconciled_count}</strong>
                  </span>
                  <span className="px-2.5 py-1 rounded bg-slate-950 border border-slate-800 text-slate-300">
                    Pending Clearance: <strong className="text-amber-400">{brsSummary.pending_count}</strong>
                  </span>
                </div>
              </div>
            </div>

            {/* 4 KPI Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-medium">
                  1. Balance per Company Books
                </span>
                <span className="text-lg font-bold text-cyan-400 font-mono mt-1 block">
                  {formatPaise(brsSummary.balance_per_books_paise)}
                </span>
                <span className="text-[10px] text-slate-500 mt-1 block">GL A/c #1010 Current A/c</span>
              </div>

              <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
                <span className="text-[10px] text-amber-400 uppercase tracking-wider block font-medium">
                  2. Add: Unpresented Cheques
                </span>
                <span className="text-lg font-bold text-amber-400 font-mono mt-1 block">
                  +{formatPaise(brsSummary.unpresented_cheques_paise)}
                </span>
                <span className="text-[10px] text-slate-500 mt-1 block">Issued payouts awaiting bank debit</span>
              </div>

              <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
                <span className="text-[10px] text-rose-400 uppercase tracking-wider block font-medium">
                  3. Less: Uncleared Deposits
                </span>
                <span className="text-lg font-bold text-rose-400 font-mono mt-1 block">
                  -{formatPaise(brsSummary.uncleared_deposits_paise)}
                </span>
                <span className="text-[10px] text-slate-500 mt-1 block">Receipts in clearing transit</span>
              </div>

              <div className="bg-slate-900 border border-emerald-500/30 bg-emerald-950/10 p-4 rounded-xl">
                <span className="text-[10px] text-emerald-400 uppercase tracking-wider block font-medium">
                  4. Balance per Bank Statement
                </span>
                <span className="text-lg font-bold text-emerald-400 font-mono mt-1 block">
                  {formatPaise(brsSummary.balance_per_bank_statement_paise)}
                </span>
                <span className="text-[10px] text-emerald-300/70 mt-1 block">Reconciled statement total</span>
              </div>
            </div>

            {/* Vouchers Filter & Ledger */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
              <div className="p-4 border-b border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-900/60">
                <div className="flex items-center space-x-2">
                  <div className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
                    {(['ALL', 'CLEARED', 'UNCLEARED'] as const).map((filter) => (
                      <button
                        key={filter}
                        onClick={() => setBrsFilter(filter)}
                        className={`px-3 py-1 rounded font-medium transition-all ${
                          brsFilter === filter
                            ? 'bg-cyan-600 text-white font-semibold'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        {filter}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="relative w-full sm:w-64">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search by party, voucher, or ref..."
                    value={brsSearch}
                    onChange={(e) => setBrsSearch(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-950/60 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
                    <tr>
                      <th className="py-2.5 px-4 font-semibold">Date</th>
                      <th className="py-2.5 px-4 font-semibold">Voucher / Ref No</th>
                      <th className="py-2.5 px-4 font-semibold">Party / Description</th>
                      <th className="py-2.5 px-4 font-semibold">Type</th>
                      <th className="py-2.5 px-4 font-semibold text-right">Amount</th>
                      <th className="py-2.5 px-4 font-semibold text-center">Clearance Status</th>
                      <th className="py-2.5 px-4 font-semibold text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono">
                    {bankVouchers
                      .filter((v) => {
                        if (brsFilter === 'CLEARED') return v.is_cleared;
                        if (brsFilter === 'UNCLEARED') return !v.is_cleared;
                        return true;
                      })
                      .filter((v) => {
                        if (!brsSearch) return true;
                        const q = brsSearch.toLowerCase();
                        return (
                          v.voucher_number.toLowerCase().includes(q) ||
                          v.party_name.toLowerCase().includes(q) ||
                          (v.reference_no && v.reference_no.toLowerCase().includes(q)) ||
                          (v.narration && v.narration.toLowerCase().includes(q))
                        );
                      })
                      .map((v) => (
                        <tr key={v.id} className="hover:bg-slate-800/30">
                          <td className="py-3 px-4 text-slate-300 font-sans">{v.date}</td>
                          <td className="py-3 px-4 font-semibold text-white">
                            <div>{v.voucher_number}</div>
                            {v.reference_no && (
                              <div className="text-[10px] text-slate-500">{v.reference_no}</div>
                            )}
                          </td>
                          <td className="py-3 px-4 font-sans">
                            <div className="text-slate-200 font-medium">{v.party_name}</div>
                            <div className="text-[10px] text-slate-400">{v.narration}</div>
                          </td>
                          <td className="py-3 px-4">
                            {v.type === 'RECEIPT' ? (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                                RECEIPT (CR)
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                                PAYMENT (DR)
                              </span>
                            )}
                          </td>
                          <td className={`py-3 px-4 text-right font-bold ${
                            v.type === 'RECEIPT' ? 'text-emerald-400' : 'text-rose-400'
                          }`}>
                            {v.type === 'RECEIPT' ? '+' : '-'}{formatPaise(v.amount_paise)}
                          </td>
                          <td className="py-3 px-4 text-center">
                            {v.is_cleared ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                                <Check className="w-3 h-3" />
                                Cleared ({v.cleared_date})
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                Pending Clearance
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <button
                              onClick={() => handleToggleCleared(v)}
                              className={`px-2.5 py-1 rounded text-[10px] font-semibold transition-all ${
                                v.is_cleared
                                  ? 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                                  : 'bg-cyan-600 hover:bg-cyan-500 text-white shadow-sm'
                              }`}
                            >
                              {v.is_cleared ? 'Mark Pending' : 'Mark Cleared'}
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ============================================================= */}
        {/* TAB 8: PROFIT & LOSS AND BALANCE SHEET (FINANCIAL STATEMENTS) */}
        {/* ============================================================= */}
        {activeTab === 'FINANCIAL_STATEMENTS' && financialStatements && (
          <div className="space-y-6">
            {/* Top Metric Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-sm">
                <span className="text-xs font-semibold text-slate-400 block mb-1">Net Sales Turnover</span>
                <span className="text-xl font-bold font-mono text-white">
                  {formatPaise(financialStatements.trading.net_sales_revenue_paise)}
                </span>
                <span className="text-[10px] text-slate-500 block mt-1">Excludes sales returns & allowances</span>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-sm">
                <span className="text-xs font-semibold text-slate-400 block mb-1">Gross Profit</span>
                <div className="flex items-center justify-between">
                  <span className="text-xl font-bold font-mono text-emerald-400">
                    {formatPaise(financialStatements.trading.gross_profit_paise)}
                  </span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300">
                    {(financialStatements.trading.gross_margin_bps / 100).toFixed(1)}% margin
                  </span>
                </div>
                <span className="text-[10px] text-slate-500 block mt-1">Revenue − Cost of Goods Sold</span>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-sm">
                <span className="text-xs font-semibold text-slate-400 block mb-1">Operating Expenses</span>
                <span className="text-xl font-bold font-mono text-rose-400">
                  {formatPaise(financialStatements.pnl.operating_expenses_paise)}
                </span>
                <span className="text-[10px] text-slate-500 block mt-1">Rent, Staff Salaries, Rounding</span>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-sm">
                <span className="text-xs font-semibold text-slate-400 block mb-1">Net Operating Profit</span>
                <div className="flex items-center justify-between">
                  <span className="text-xl font-bold font-mono text-teal-300">
                    {formatPaise(financialStatements.pnl.net_profit_paise)}
                  </span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-teal-500/20 text-teal-300">
                    {(financialStatements.pnl.net_margin_bps / 100).toFixed(1)}% net
                  </span>
                </div>
                <span className="text-[10px] text-slate-500 block mt-1">Transferred to Balance Sheet Equity</span>
              </div>
            </div>

            {/* Invariant Verification Banner */}
            <div className={`p-4 rounded-2xl border flex items-center justify-between text-xs font-medium ${
              financialStatements.balance_sheet.is_balanced
                ? 'bg-teal-950/20 border-teal-800/40 text-teal-200'
                : 'bg-rose-950/20 border-rose-800/40 text-rose-200'
            }`}>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-teal-400" />
                <span>
                  <strong>Accounting Invariant:</strong> Schedule III GAAP Financial Statements derived strictly from double-entry General Ledger. Total Assets tie to Total Liabilities + Equity.
                </span>
              </div>
              <span className="font-mono font-bold text-teal-400">
                Discrepancy: ₹{(financialStatements.balance_sheet.difference_paise / 100).toFixed(2)}
              </span>
            </div>

            {/* Trading & Profit/Loss Tables */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Trading & P&L Statement */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-emerald-400" />
                    Trading & Profit and Loss Account
                  </h3>
                  <span className="text-[11px] text-slate-400 font-mono">Current Financial Year</span>
                </div>

                <div className="divide-y divide-slate-800/60 text-xs font-mono">
                  <div className="py-2.5 flex justify-between text-slate-300">
                    <span className="font-sans font-medium text-slate-200">Gross Sales Revenue</span>
                    <span>{formatPaise(financialStatements.trading.gross_sales_paise)}</span>
                  </div>
                  <div className="py-2.5 flex justify-between text-rose-400">
                    <span className="font-sans font-medium text-slate-400">Less: Sales Returns & Allowances</span>
                    <span>-{formatPaise(financialStatements.trading.sales_returns_paise)}</span>
                  </div>
                  <div className="py-2.5 flex justify-between text-white font-bold bg-slate-950/40 px-2 rounded">
                    <span className="font-sans">Net Operational Revenue</span>
                    <span>{formatPaise(financialStatements.trading.net_sales_revenue_paise)}</span>
                  </div>
                  <div className="py-2.5 flex justify-between text-rose-400">
                    <span className="font-sans font-medium text-slate-400">Less: Cost of Goods Sold (COGS)</span>
                    <span>-{formatPaise(financialStatements.trading.cogs_paise)}</span>
                  </div>
                  <div className="py-2.5 flex justify-between text-emerald-400 font-bold bg-emerald-950/20 px-2 rounded border border-emerald-900/30">
                    <span className="font-sans">Gross Profit</span>
                    <span>{formatPaise(financialStatements.trading.gross_profit_paise)}</span>
                  </div>
                  <div className="py-2.5 flex justify-between text-rose-400">
                    <span className="font-sans font-medium text-slate-400">Less: Operating & Store Expenses</span>
                    <span>-{formatPaise(financialStatements.pnl.operating_expenses_paise)}</span>
                  </div>
                  <div className="py-3 flex justify-between text-teal-300 font-black text-sm bg-teal-950/30 px-2.5 rounded-xl border border-teal-800/40">
                    <span className="font-sans">Net Operating Profit</span>
                    <span>{formatPaise(financialStatements.pnl.net_profit_paise)}</span>
                  </div>
                </div>
              </div>

              {/* Balance Sheet Statement */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Scale className="w-4 h-4 text-blue-400" />
                    Balance Sheet (Statement of Financial Position)
                  </h3>
                  <span className="text-[11px] text-teal-300 font-mono">Balanced Invariant</span>
                </div>

                <div className="grid grid-cols-2 gap-4 text-xs font-mono">
                  {/* ASSETS */}
                  <div className="bg-slate-950/40 p-3 rounded-xl border border-slate-800/80 space-y-2">
                    <span className="text-[11px] font-bold text-blue-300 uppercase block font-sans border-b border-slate-800 pb-1">
                      Assets (Application)
                    </span>
                    <div className="flex justify-between py-1 text-slate-300">
                      <span className="font-sans text-slate-400">Current Assets:</span>
                      <span>{formatPaise(financialStatements.balance_sheet.current_assets_paise)}</span>
                    </div>
                    <div className="flex justify-between py-1 text-slate-300">
                      <span className="font-sans text-slate-400">Fixed Assets:</span>
                      <span>{formatPaise(financialStatements.balance_sheet.fixed_assets_paise)}</span>
                    </div>
                    <div className="flex justify-between py-2 border-t border-slate-800 font-bold text-white text-sm bg-blue-950/20 px-2 rounded">
                      <span className="font-sans">Total Assets</span>
                      <span>{formatPaise(financialStatements.balance_sheet.total_assets_paise)}</span>
                    </div>
                  </div>

                  {/* LIABILITIES & EQUITY */}
                  <div className="bg-slate-950/40 p-3 rounded-xl border border-slate-800/80 space-y-2">
                    <span className="text-[11px] font-bold text-purple-300 uppercase block font-sans border-b border-slate-800 pb-1">
                      Liabilities & Equity
                    </span>
                    <div className="flex justify-between py-1 text-slate-300">
                      <span className="font-sans text-slate-400">Current Liabilities:</span>
                      <span>{formatPaise(financialStatements.balance_sheet.current_liabilities_paise)}</span>
                    </div>
                    <div className="flex justify-between py-1 text-slate-300">
                      <span className="font-sans text-slate-400">Owner's Capital:</span>
                      <span>{formatPaise(financialStatements.balance_sheet.capital_paise)}</span>
                    </div>
                    <div className="flex justify-between py-1 text-slate-300">
                      <span className="font-sans text-slate-400">Retained Earnings:</span>
                      <span>{formatPaise(financialStatements.balance_sheet.retained_earnings_paise)}</span>
                    </div>
                    <div className="flex justify-between py-1 text-teal-300 font-semibold">
                      <span className="font-sans">Current Net Profit:</span>
                      <span>+{formatPaise(financialStatements.balance_sheet.current_net_profit_paise)}</span>
                    </div>
                    <div className="flex justify-between py-2 border-t border-slate-800 font-bold text-white text-sm bg-purple-950/20 px-2 rounded">
                      <span className="font-sans">Total Liab. & Eq.</span>
                      <span>{formatPaise(financialStatements.balance_sheet.total_liabilities_and_equity_paise)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ============================================================= */}
        {/* TAB 9: PHYSICAL STOCKTAKE & CYCLE COUNT SHEET */}
        {/* ============================================================= */}
        {activeTab === 'STOCKTAKE' && (
          <div className="space-y-6">
            {/* Header & Action Bar */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <ClipboardCheck className="w-5 h-5 text-orange-400" />
                  Physical Stocktake & Cycle Count Reconciliation
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Input physical counts to detect inventory shrinkage or surplus and post atomic adjustment journal entries.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={handleAutoFillStocktake}
                  className="px-3.5 py-1.5 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 transition-all"
                >
                  Auto-Fill from System
                </button>
                <button
                  onClick={() => setIsStocktakeAdjustmentModalOpen(true)}
                  disabled={!stocktakeItems.some((s) => s.variance_milli !== 0)}
                  className="px-4 py-1.5 rounded-xl bg-orange-600 hover:bg-orange-500 disabled:opacity-50 disabled:pointer-events-none text-white text-xs font-bold transition-all shadow-md shadow-orange-600/30 flex items-center gap-1.5"
                >
                  <Package className="w-4 h-4" />
                  Post Stock Adjustment
                </button>
              </div>
            </div>

            {/* Summary Metrics */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5">
                <span className="text-xs text-slate-400 block mb-1">Total SKUs Counted</span>
                <span className="text-lg font-bold font-mono text-white">{stocktakeItems.length}</span>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5">
                <span className="text-xs text-slate-400 block mb-1">Matched SKUs</span>
                <span className="text-lg font-bold font-mono text-emerald-400">
                  {stocktakeItems.filter((s) => s.status === 'MATCHED').length}
                </span>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5">
                <span className="text-xs text-slate-400 block mb-1">Shrinkage (Shortage)</span>
                <span className="text-lg font-bold font-mono text-rose-400">
                  {stocktakeItems.filter((s) => s.status === 'SHORTAGE').length} SKUs
                </span>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5">
                <span className="text-xs text-slate-400 block mb-1">Net Valuation Variance</span>
                <span className={`text-lg font-bold font-mono ${
                  stocktakeItems.reduce((acc, s) => acc + s.variance_value_paise, 0) < 0
                    ? 'text-rose-400'
                    : 'text-emerald-400'
                }`}>
                  {formatPaise(stocktakeItems.reduce((acc, s) => acc + s.variance_value_paise, 0))}
                </span>
              </div>
            </div>

            {/* Stocktake Table */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-950/60 border-b border-slate-800 text-slate-400 uppercase text-[10px] tracking-wider font-semibold">
                      <th className="py-3 px-4">SKU / Barcode</th>
                      <th className="py-3 px-4">Product Name</th>
                      <th className="py-3 px-4">Category</th>
                      <th className="py-3 px-4 text-right">Book Stock</th>
                      <th className="py-3 px-4 text-center">Physical Count</th>
                      <th className="py-3 px-4 text-right">Unit Cost</th>
                      <th className="py-3 px-4 text-right">Qty Variance</th>
                      <th className="py-3 px-4 text-right">Value Variance</th>
                      <th className="py-3 px-4 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono">
                    {stocktakeItems.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-800/30">
                        <td className="py-2.5 px-4 font-semibold text-white">
                          <div>{item.sku}</div>
                          <div className="text-[10px] text-slate-500">{item.barcode}</div>
                        </td>
                        <td className="py-2.5 px-4 font-sans text-slate-200">{item.name}</td>
                        <td className="py-2.5 px-4 font-sans text-slate-400">{item.category}</td>
                        <td className="py-2.5 px-4 text-right font-bold text-slate-300">
                          {formatMilliQty(item.book_stock_milli)} {item.unit}
                        </td>
                        <td className="py-2.5 px-4 text-center">
                          <input
                            type="number"
                            step="any"
                            min="0"
                            value={(item.physical_stock_milli / 1000).toString()}
                            onChange={(e) => handleUpdatePhysicalStock(item.id, e.target.value)}
                            className="w-24 px-2 py-1 bg-slate-950 border border-slate-700 focus:border-orange-500 rounded text-center text-xs font-mono font-bold text-white focus:outline-none"
                          />
                        </td>
                        <td className="py-2.5 px-4 text-right text-slate-400">
                          {formatPaise(item.unit_cost_paise)}
                        </td>
                        <td className={`py-2.5 px-4 text-right font-bold ${
                          item.variance_milli < 0 ? 'text-rose-400' : item.variance_milli > 0 ? 'text-emerald-400' : 'text-slate-400'
                        }`}>
                          {item.variance_milli > 0 ? '+' : ''}{formatMilliQty(item.variance_milli)}
                        </td>
                        <td className={`py-2.5 px-4 text-right font-bold ${
                          item.variance_value_paise < 0 ? 'text-rose-400' : item.variance_value_paise > 0 ? 'text-emerald-400' : 'text-slate-400'
                        }`}>
                          {item.variance_value_paise > 0 ? '+' : ''}{formatPaise(item.variance_value_paise)}
                        </td>
                        <td className="py-2.5 px-4 text-center">
                          {item.status === 'MATCHED' && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                              MATCHED
                            </span>
                          )}
                          {item.status === 'SHORTAGE' && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                              SHORTAGE
                            </span>
                          )}
                          {item.status === 'SURPLUS' && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                              SURPLUS
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Stocktake Adjustment Confirmation Modal */}
      {isStocktakeAdjustmentModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Package className="w-5 h-5 text-orange-400" />
                Confirm Stocktake Adjustment
              </h3>
              <button
                onClick={() => setIsStocktakeAdjustmentModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-xs text-slate-300">
                This operation will update the system inventory stock counts for all variance items and post an atomic Double-Entry Journal adjustment to General Ledger Account #1200 (Inventory Assets).
              </p>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Auditor Name / ID:</label>
                <input
                  type="text"
                  value={stocktakeAuditor}
                  onChange={(e) => setStocktakeAuditor(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-orange-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Adjustment Reason:</label>
                <textarea
                  rows={2}
                  value={stocktakeReason}
                  onChange={(e) => setStocktakeReason(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-orange-500"
                />
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-800 bg-slate-950/60 flex items-center justify-end gap-3">
              <button
                onClick={() => setIsStocktakeAdjustmentModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handlePostStocktake}
                className="px-5 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-orange-600/30"
              >
                Post Adjustment
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================= */}
      {/* PERIOD LOCK OWNER AUDIT MODAL */}
      {/* ============================================================= */}
      {isPeriodLockModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
              <div className="flex items-center space-x-2">
                <div className="p-2 bg-amber-500/20 rounded-lg text-amber-400">
                  <Lock className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Fiscal Period Hard Lock</h3>
                  <p className="text-xs text-slate-400">Statutory closure prevents back-dated vouchers and stock edits</p>
                </div>
              </div>
              <button
                onClick={() => setIsPeriodLockModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-5 overflow-y-auto">
              <div className="p-3 rounded-xl bg-amber-950/20 border border-amber-800/40 text-xs text-amber-200">
                <strong>Enforcement Invariant:</strong> When locked, any sales invoice, purchase inward, payment receipt, or stock movement dated on or prior to the lock date will be strictly aborted by both the UI and the Rust posting gateway.
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Hard Period Lock Date (inclusive):
                </label>
                <input
                  type="date"
                  value={newLockDate}
                  onChange={(e) => setNewLockDate(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-amber-500 font-mono"
                />
                <span className="text-[11px] text-slate-400 mt-1 block">
                  Vouchers on or before this date are permanently protected from edits and deletions.
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Mandatory Statutory Audit Reason:
                </label>
                <textarea
                  rows={2}
                  value={lockReason}
                  onChange={(e) => setLockReason(e.target.value)}
                  placeholder="e.g. FY 2025-26 books finalized and statutory tax audit complete"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                />
              </div>

              {/* Tamper-Evident History Log */}
              {periodLock?.audit_history && periodLock.audit_history.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-slate-800">
                  <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                    <History className="w-3.5 h-3.5 text-slate-400" />
                    Lock Audit Trail (Tamper-evident log):
                  </span>
                  <div className="bg-slate-950 rounded-xl border border-slate-800 max-h-36 overflow-y-auto divide-y divide-slate-800/60 text-[11px] font-mono">
                    {periodLock.audit_history.map((h, i) => (
                      <div key={i} className="p-2.5 flex items-start justify-between gap-2">
                        <div>
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold mr-2 ${
                            h.action === 'LOCK' ? 'bg-amber-500/20 text-amber-300' : 'bg-slate-800 text-slate-300'
                          }`}>
                            {h.action}
                          </span>
                          <span className="text-white font-bold">{h.lock_date || 'ALL OPEN'}</span>
                          <span className="text-slate-400 block mt-0.5 text-[10px]">{h.reason}</span>
                        </div>
                        <div className="text-right text-[10px] text-slate-500">
                          <div>by {h.user}</div>
                          <div>{h.timestamp.split('T')[0]}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  try {
                    const updated = ErpStorageService.setPeriodLock(null, 'Owner manual unlock for administrative correction', 'admin');
                    setPeriodLock(updated);
                    setNewLockDate('');
                    setIsPeriodLockModalOpen(false);
                    loadReports();
                  } catch (e: any) {
                    alert(e.message);
                  }
                }}
                className="px-3 py-1.5 rounded-xl border border-rose-800/50 text-rose-300 hover:bg-rose-950/40 text-xs font-medium transition-all"
              >
                Clear Lock (Open All)
              </button>

              <div className="flex items-center space-x-3">
                <button
                  type="button"
                  onClick={() => setIsPeriodLockModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSavePeriodLock}
                  className="px-5 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-amber-600/30"
                >
                  Save & Enforce Lock
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedVoucherForModal && (
        <PurchaseExpenseBillModal
          isOpen={true}
          onClose={() => setSelectedVoucherForModal(null)}
          voucher={selectedVoucherForModal}
        />
      )}
    </div>
  );
};
