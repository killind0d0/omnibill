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
} from '../types/accounting';
import { ErpStorageService } from '../lib/erpStorage';
import { formatPaise, formatMilliQty } from '../lib/tax';
import { getStateName } from '../lib/constants';

type ReportTab = 'TRIAL_BALANCE' | 'DAY_BOOK' | 'GSTR1' | 'STOCK_VALUATION';

export const ReportsDashboard: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ReportTab>('TRIAL_BALANCE');

  // Trial Balance state
  const [accounts, setAccounts] = useState<TrialBalanceAccount[]>([]);
  const [isSimulatedImbalance, setIsSimulatedImbalance] = useState(false);

  // Day Book state
  const [selectedDate, setSelectedDate] = useState<string>('2026-10-20');
  const [dayBookEntries, setDayBookEntries] = useState<DayBookEntry[]>([]);
  const [dayBookSummary, setDayBookSummary] = useState<DayBookSummary | null>(null);

  // GSTR-1 state
  const [selectedPeriod, setSelectedPeriod] = useState<string>('2026-10'); // October 2026
  const [b2bInvoices, setB2bInvoices] = useState<Gstr1B2BInvoice[]>([]);
  const [b2cEntries, setB2cEntries] = useState<Gstr1B2CEntry[]>([]);
  const [hsnSummaries, setHsnSummaries] = useState<Gstr1HsnSummary[]>([]);
  const [gstrSubTab, setGstrSubTab] = useState<'B2B' | 'B2C' | 'HSN'>('B2B');

  // Stock Valuation state
  const [stockItems, setStockItems] = useState<StockValuationItem[]>([]);
  const [stockFilter, setStockFilter] = useState<'ALL' | 'LOW_ONLY' | 'EXPIRING_ONLY'>('ALL');

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
  };

  useEffect(() => {
    loadReports();
  }, [selectedDate, selectedPeriod]);

  // Keyboard shortcut listener: 1-4 for quick tab switching
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey) {
        if (e.key === 't' || e.key === 'T') {
          e.preventDefault();
          setActiveTab('TRIAL_BALANCE');
        } else if (e.key === 'd' || e.key === 'D') {
          e.preventDefault();
          setActiveTab('DAY_BOOK');
        } else if (e.key === 'g' || e.key === 'G') {
          e.preventDefault();
          setActiveTab('GSTR1');
        } else if (e.key === 's' || e.key === 'S') {
          e.preventDefault();
          setActiveTab('STOCK_VALUATION');
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

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
  const exportGstr1Json = () => {
    const payload = {
      gstin: '27AABCO1234F1Z5',
      fp: selectedPeriod.replace('-', ''), // e.g. 102026
      b2b: b2bInvoices.map((inv) => ({
        ctin: inv.gstin,
        cname: inv.recipient_name,
        inum: inv.invoice_number,
        idt: inv.invoice_date,
        val: (inv.invoice_value_paise / 100).toFixed(2),
        pos: inv.pos_state_code,
        rchrg: inv.reverse_charge,
        itms: [
          {
            num: 1,
            itm_det: {
              rt: inv.tax_rate_bps / 100,
              txval: (inv.taxable_value_paise / 100).toFixed(2),
              iamt: (inv.igst_paise / 100).toFixed(2),
              camt: (inv.cgst_paise / 100).toFixed(2),
              samt: (inv.sgst_paise / 100).toFixed(2),
              csamt: '0.00',
            },
          },
        ],
      })),
      b2cs: b2cEntries.map((b2c) => ({
        sply_ty: b2c.pos_state_code === '27' ? 'INTRA' : 'INTER',
        pos: b2c.pos_state_code,
        typ: b2c.type,
        rt: b2c.tax_rate_bps / 100,
        txval: (b2c.taxable_value_paise / 100).toFixed(2),
        iamt: (b2c.igst_paise / 100).toFixed(2),
        camt: (b2c.cgst_paise / 100).toFixed(2),
        samt: (b2c.sgst_paise / 100).toFixed(2),
        csamt: '0.00',
      })),
      hsn: {
        data: hsnSummaries.map((hsn) => ({
          hsn_sc: hsn.hsn_sac,
          desc: hsn.description,
          uqc: hsn.uqc,
          qty: (hsn.total_quantity_milli / 1000).toFixed(3),
          val: (hsn.total_value_paise / 100).toFixed(2),
          txval: (hsn.taxable_value_paise / 100).toFixed(2),
          iamt: (hsn.igst_paise / 100).toFixed(2),
          camt: (hsn.cgst_paise / 100).toFixed(2),
          samt: (hsn.sgst_paise / 100).toFixed(2),
          csamt: '0.00',
        })),
      },
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
              onClick={() => setActiveTab('GSTR1')}
              className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'GSTR1'
                  ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="GSTR-1 Summary (Alt+G)"
            >
              <Receipt className="w-3.5 h-3.5" />
              <span>GSTR-1 Summary</span>
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
          </div>
        </div>
      </div>

      {/* Main Tab Panels */}
      <div className="flex-1 overflow-y-auto p-6">
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
            <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-900/50 shadow-xl">
              <table className="w-full text-left border-collapse text-xs">
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
            <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-900/50 shadow-xl">
              <table className="w-full text-left border-collapse text-xs">
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
        {/* TAB 3: GSTR-1 SUMMARY */}
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
              <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-900/50 shadow-xl">
                <table className="w-full text-left border-collapse text-xs">
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
              <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-900/50 shadow-xl">
                <table className="w-full text-left border-collapse text-xs">
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
              <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-900/50 shadow-xl">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
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

              <table className="w-full text-left border-collapse text-xs">
                <thead>
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
        )}
      </div>
    </div>
  );
};
