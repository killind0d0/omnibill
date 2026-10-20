import React, { useState, useEffect, useMemo } from 'react';
import {
  Users,
  Building2,
  Phone,
  Mail,
  MapPin,
  CreditCard,
  Plus,
  Search,
  Filter,
  ArrowUpRight,
  ArrowDownLeft,
  Calendar,
  FileText,
  Printer,
  Download,
  AlertCircle,
  CheckCircle2,
  Sparkles,
  ChevronRight,
  ShieldCheck,
  Coins,
  Receipt,
  UserCheck,
} from 'lucide-react';
import { Entity, EntityType, LedgerStatementRow, PaymentMode } from '../types/accounting';
import { ErpStorageService } from '../lib/erpStorage';
import { formatPaise } from '../lib/tax';
import { getStateName, isValidGstin, INDIAN_STATES } from '../lib/constants';
import { Modal } from '../components/common/Modal';

export const EntityLedger: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'CUSTOMER' | 'SUPPLIER'>('CUSTOMER');
  const [entities, setEntities] = useState<Entity[]>([]);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [ledgerRows, setLedgerRows] = useState<LedgerStatementRow[]>([]);

  // Date filters
  const [fromDate, setFromDate] = useState<string>('2026-10-01');
  const [toDate, setToDate] = useState<string>('2026-10-31');

  // Modals
  const [isRecordPaymentOpen, setIsRecordPaymentOpen] = useState(false);
  const [isAddEntityOpen, setIsAddEntityOpen] = useState(false);

  // Form states - Record Payment
  const [paymentForm, setPaymentForm] = useState({
    amount_inr: '',
    payment_mode: 'UPI' as PaymentMode,
    date: new Date().toISOString().split('T')[0],
    reference_number: '',
    narration: '',
  });

  // Form states - Add Entity
  const [entityForm, setEntityForm] = useState({
    entity_code: '',
    entity_type: 'CUSTOMER' as EntityType,
    full_name: '',
    phone: '',
    email: '',
    gstin: '',
    state_code: '27',
    address: '',
    opening_balance_inr: '0',
  });

  // Load entities from storage
  const loadEntities = () => {
    const list = ErpStorageService.getEntities();
    setEntities(list);

    // Auto-select first matching entity if none selected
    const matching = list.filter((e) => e.entity_type === activeTab);
    if (matching.length > 0 && (!selectedEntityId || !matching.some((m) => m.id === selectedEntityId))) {
      setSelectedEntityId(matching[0].id);
    }
  };

  useEffect(() => {
    loadEntities();
  }, [activeTab]);

  // Load ledger entries when selected entity changes
  useEffect(() => {
    if (selectedEntityId) {
      const rows = ErpStorageService.getLedger(selectedEntityId);
      setLedgerRows(rows);
    } else {
      setLedgerRows([]);
    }
  }, [selectedEntityId]);

  // Filter entities list
  const filteredEntities = useMemo(() => {
    return entities.filter((e) => {
      const matchesTab = e.entity_type === activeTab;
      if (!matchesTab) return false;
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        e.full_name.toLowerCase().includes(q) ||
        e.entity_code.toLowerCase().includes(q) ||
        e.phone.includes(q) ||
        (e.gstin && e.gstin.toLowerCase().includes(q))
      );
    });
  }, [entities, activeTab, searchQuery]);

  // Selected Entity Object
  const selectedEntity = useMemo(() => {
    return entities.find((e) => e.id === selectedEntityId) || null;
  }, [entities, selectedEntityId]);

  // Filtered Ledger Rows by Date Range
  const filteredLedgerRows = useMemo(() => {
    return ledgerRows.filter((r) => {
      if (fromDate && r.date < fromDate) return false;
      if (toDate && r.date > toDate) return false;
      return true;
    });
  }, [ledgerRows, fromDate, toDate]);

  // Calculate totals for the ledger statement
  const statementSummary = useMemo(() => {
    let totalDebit = 0;
    let totalCredit = 0;
    filteredLedgerRows.forEach((r) => {
      totalDebit += r.debit_paise;
      totalCredit += r.credit_paise;
    });

    const currentBal = selectedEntity ? selectedEntity.current_balance_paise : 0;
    return {
      totalDebit,
      totalCredit,
      closingBalance: currentBal,
    };
  }, [filteredLedgerRows, selectedEntity]);

  // Open Payment Modal
  const openPaymentModal = () => {
    if (!selectedEntity) return;
    const absBal = Math.abs(selectedEntity.current_balance_paise);
    setPaymentForm({
      amount_inr: (absBal / 100).toFixed(2),
      payment_mode: 'UPI',
      date: new Date().toISOString().split('T')[0],
      reference_number: '',
      narration:
        selectedEntity.entity_type === 'CUSTOMER'
          ? `Settlement receipt from ${selectedEntity.full_name}`
          : `Payout settlement to ${selectedEntity.full_name}`,
    });
    setIsRecordPaymentOpen(true);
  };

  // Submit Payment
  const handlePaymentSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEntity) return;

    const amountPaise = Math.round(parseFloat(paymentForm.amount_inr || '0') * 100);
    if (amountPaise <= 0) {
      alert('Please enter a valid payment amount greater than zero.');
      return;
    }

    ErpStorageService.recordPayment({
      entity_id: selectedEntity.id,
      amount_paise: amountPaise,
      payment_mode: paymentForm.payment_mode,
      date: paymentForm.date,
      reference_number: paymentForm.reference_number,
      narration: paymentForm.narration,
    });

    // Reload entities and ledger
    loadEntities();
    const rows = ErpStorageService.getLedger(selectedEntity.id);
    setLedgerRows(rows);
    setIsRecordPaymentOpen(false);
  };

  // Submit Add Entity
  const handleAddEntitySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!entityForm.full_name.trim() || !entityForm.phone.trim()) {
      alert('Please provide at least a full name and phone number.');
      return;
    }

    const opBalPaise = Math.round(parseFloat(entityForm.opening_balance_inr || '0') * 100);
    const code = entityForm.entity_code.trim() || `${entityForm.entity_type.slice(0, 4)}-${Math.floor(100 + Math.random() * 900)}`;

    const created = ErpStorageService.addEntity({
      entity_code: code.toUpperCase(),
      entity_type: entityForm.entity_type,
      full_name: entityForm.full_name.trim(),
      phone: entityForm.phone.trim(),
      email: entityForm.email.trim(),
      gstin: entityForm.gstin.trim().toUpperCase(),
      state_code: entityForm.state_code,
      address: entityForm.address.trim(),
      opening_balance_paise: opBalPaise,
      is_active: true,
    });

    loadEntities();
    setSelectedEntityId(created.id);
    setIsAddEntityOpen(false);
    setEntityForm({
      entity_code: '',
      entity_type: activeTab,
      full_name: '',
      phone: '',
      email: '',
      gstin: '',
      state_code: '27',
      address: '',
      opening_balance_inr: '0',
    });
  };

  // Keyboard shortcut listener: F4 or Alt+P for Record Payment
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.altKey && (e.key === 'p' || e.key === 'P')) || e.key === 'F4') {
        e.preventDefault();
        if (selectedEntity) openPaymentModal();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedEntity]);

  return (
    <div className="flex-1 flex flex-col bg-slate-950 text-slate-100 overflow-hidden">
      {/* Top Header & Entity Tab Switcher */}
      <div className="border-b border-slate-800 bg-slate-900/60 px-6 py-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-indigo-600/20 text-indigo-400 border border-indigo-500/30">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
                Entity Directory & Ledger Statements
              </h2>
              <p className="text-xs text-slate-400">
                Customer & supplier account books, GSTIN profiles, running statements, and payment settlements.
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            {/* Customer vs Supplier Switcher */}
            <div className="flex items-center bg-slate-900 p-1 rounded-xl border border-slate-800">
              <button
                onClick={() => setActiveTab('CUSTOMER')}
                className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  activeTab === 'CUSTOMER'
                    ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/30'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Users className="w-3.5 h-3.5" />
                <span>Customers</span>
              </button>

              <button
                onClick={() => setActiveTab('SUPPLIER')}
                className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  activeTab === 'SUPPLIER'
                    ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-600/30'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Building2 className="w-3.5 h-3.5" />
                <span>Suppliers</span>
              </button>
            </div>

            {/* Add New Entity Button */}
            <button
              onClick={() => {
                setEntityForm((prev) => ({ ...prev, entity_type: activeTab }));
                setIsAddEntityOpen(true);
              }}
              className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5 text-blue-400" />
              <span>New {activeTab === 'CUSTOMER' ? 'Customer' : 'Supplier'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Area: Split View (Entity List + Ledger Statement) */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Column: Entity Directory (Width 360px) */}
        <div className="w-80 md:w-96 border-r border-slate-800 bg-slate-900/30 flex flex-col select-none">
          {/* Search Bar */}
          <div className="p-3 border-b border-slate-800 bg-slate-900/60">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                placeholder={`Search ${activeTab.toLowerCase()} by name, code, phone, GST...`}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700/80 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 font-mono"
              />
            </div>
          </div>

          {/* List of Entities */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-800/60">
            {filteredEntities.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-xs">
                No {activeTab.toLowerCase()}s found.
              </div>
            ) : (
              filteredEntities.map((entity) => {
                const isSelected = entity.id === selectedEntityId;
                const isDebit = entity.current_balance_paise > 0;
                const isSettled = entity.current_balance_paise === 0;

                return (
                  <div
                    key={entity.id}
                    onClick={() => setSelectedEntityId(entity.id)}
                    className={`p-3.5 hover:bg-slate-800/40 cursor-pointer transition-colors ${
                      isSelected ? 'bg-slate-800/70 border-l-4 border-blue-500' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center space-x-2">
                          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                            {entity.entity_code}
                          </span>
                          <h4 className="text-xs font-bold text-slate-100 truncate">
                            {entity.full_name}
                          </h4>
                        </div>

                        <div className="flex items-center space-x-2 text-[11px] text-slate-400 mt-1 font-mono">
                          <Phone className="w-3 h-3 text-slate-500" />
                          <span>{entity.phone || 'No Phone'}</span>
                          <span>•</span>
                          <span className="text-slate-500">State: {entity.state_code}</span>
                        </div>

                        {entity.gstin && (
                          <div className="mt-1 flex items-center space-x-1 text-[10px] text-emerald-400/90 font-mono">
                            <ShieldCheck className="w-3 h-3 text-emerald-400" />
                            <span>GSTIN: {entity.gstin}</span>
                          </div>
                        )}
                      </div>

                      {/* Outstanding Balance Pill */}
                      <div className="text-right pl-2">
                        <div
                          className={`font-mono font-bold text-xs ${
                            isSettled
                              ? 'text-slate-400'
                              : isDebit
                              ? 'text-amber-400'
                              : 'text-emerald-400'
                          }`}
                        >
                          {formatPaise(Math.abs(entity.current_balance_paise))}
                        </div>
                        <span className="text-[10px] uppercase font-semibold text-slate-500">
                          {isSettled ? 'Settled' : isDebit ? 'Dr (Due)' : 'Cr (Payable)'}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Entity Profile & Running Statement */}
        <div className="flex-1 flex flex-col bg-slate-950 overflow-hidden">
          {selectedEntity ? (
            <>
              {/* Selected Entity Card */}
              <div className="border-b border-slate-800 bg-slate-900/50 p-5 select-none">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center space-x-2.5">
                      <h3 className="text-lg font-bold text-white tracking-wide">
                        {selectedEntity.full_name}
                      </h3>
                      <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-blue-500/20 text-blue-300 border border-blue-500/30">
                        {selectedEntity.entity_code}
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                        {selectedEntity.entity_type}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-y-1 gap-x-4 text-xs text-slate-300 mt-2 font-mono">
                      <div className="flex items-center space-x-1.5">
                        <Phone className="w-3.5 h-3.5 text-slate-500" />
                        <span>{selectedEntity.phone}</span>
                      </div>
                      <div className="flex items-center space-x-1.5">
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                        <span>GSTIN: {selectedEntity.gstin || 'Unregistered'}</span>
                      </div>
                      <div className="flex items-center space-x-1.5">
                        <MapPin className="w-3.5 h-3.5 text-slate-500" />
                        <span>
                          {selectedEntity.state_code} - {getStateName(selectedEntity.state_code)}
                        </span>
                      </div>
                    </div>

                    {selectedEntity.address && (
                      <p className="text-[11px] text-slate-400 mt-1 max-w-xl truncate">
                        {selectedEntity.address}
                      </p>
                    )}
                  </div>

                  {/* Balance & Action Buttons */}
                  <div className="flex items-center space-x-3">
                    <div className="bg-slate-900 border border-slate-800 p-3 rounded-xl text-right">
                      <span className="text-[10px] text-slate-400 uppercase font-semibold">
                        Current Outstanding Balance
                      </span>
                      <div
                        className={`text-lg font-mono font-bold ${
                          selectedEntity.current_balance_paise > 0
                            ? 'text-amber-400'
                            : selectedEntity.current_balance_paise < 0
                            ? 'text-emerald-400'
                            : 'text-slate-300'
                        }`}
                      >
                        {formatPaise(Math.abs(selectedEntity.current_balance_paise))}
                        <span className="text-xs ml-1 font-semibold">
                          {selectedEntity.current_balance_paise > 0
                            ? 'Dr'
                            : selectedEntity.current_balance_paise < 0
                            ? 'Cr'
                            : ''}
                        </span>
                      </div>
                    </div>

                    {/* Quick Record Payment Button */}
                    <button
                      onClick={openPaymentModal}
                      className="flex items-center space-x-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-lg shadow-emerald-600/30 transition-all cursor-pointer"
                      title="Record Payment / Receipt Voucher (F4 / Alt+P)"
                    >
                      <CreditCard className="w-4 h-4" />
                      <span>Record Payment</span>
                      <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] bg-emerald-700/80 rounded">
                        F4
                      </kbd>
                    </button>
                  </div>
                </div>
              </div>

              {/* Statement Filters Bar */}
              <div className="border-b border-slate-800 bg-slate-900/30 px-6 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs select-none">
                <div className="flex items-center space-x-3">
                  <div className="flex items-center space-x-1.5 text-slate-400">
                    <Calendar className="w-3.5 h-3.5 text-blue-400" />
                    <span>Statement Range:</span>
                  </div>
                  <input
                    type="date"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                    className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-100 font-mono text-xs focus:outline-none focus:border-blue-500"
                  />
                  <span className="text-slate-500">to</span>
                  <input
                    type="date"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                    className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-100 font-mono text-xs focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => window.print()}
                    className="flex items-center space-x-1.5 px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium text-xs transition-colors"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span>Print Statement</span>
                  </button>
                </div>
              </div>

              {/* Interactive Running Statement Table */}
              <div className="flex-1 overflow-y-auto px-6 py-4">
                <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-900/50 shadow-xl">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 bg-slate-900/90 text-[11px] font-semibold text-slate-400 uppercase tracking-wider select-none font-mono">
                        <th className="py-3 px-4">Date</th>
                        <th className="py-3 px-4">Voucher / Invoice #</th>
                        <th className="py-3 px-4">Type</th>
                        <th className="py-3 px-4">Narration / Description</th>
                        <th className="py-3 px-4 text-right">Debit (₹)</th>
                        <th className="py-3 px-4 text-right">Credit (₹)</th>
                        <th className="py-3 px-4 text-right">Running Balance (₹)</th>
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-slate-800/80 font-mono">
                      {filteredLedgerRows.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-12 text-center text-slate-500">
                            <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
                            <p className="font-medium text-slate-400">
                              No statement vouchers found for this date range.
                            </p>
                          </td>
                        </tr>
                      ) : (
                        filteredLedgerRows.map((row) => {
                          const isBalDebit = row.running_balance_paise > 0;
                          const isBalSettled = row.running_balance_paise === 0;

                          return (
                            <tr key={row.id} className="hover:bg-slate-800/40 transition-colors">
                              {/* Date */}
                              <td className="py-3 px-4 text-slate-300 whitespace-nowrap">
                                {row.date}
                              </td>

                              {/* Voucher Number */}
                              <td className="py-3 px-4 font-semibold text-blue-400">
                                {row.voucher_number}
                              </td>

                              {/* Voucher Type */}
                              <td className="py-3 px-4">
                                <span
                                  className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                                    row.voucher_type === 'SALE'
                                      ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                                      : row.voucher_type === 'PURCHASE'
                                      ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                                      : row.voucher_type === 'RECEIPT'
                                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                      : row.voucher_type === 'PAYMENT'
                                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                      : row.voucher_type.includes('RETURN')
                                      ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                      : 'bg-slate-800 text-slate-400'
                                  }`}
                                >
                                  {row.voucher_type.replace('_', ' ')}
                                </span>
                              </td>

                              {/* Narration */}
                              <td className="py-3 px-4 text-slate-300 font-sans max-w-xs truncate">
                                <div>{row.narration}</div>
                                {row.reference_no && (
                                  <div className="text-[10px] text-slate-500 font-mono">
                                    Ref: {row.reference_no} ({row.payment_mode})
                                  </div>
                                )}
                              </td>

                              {/* Debit */}
                              <td className="py-3 px-4 text-right text-slate-200">
                                {row.debit_paise > 0 ? formatPaise(row.debit_paise) : '-'}
                              </td>

                              {/* Credit */}
                              <td className="py-3 px-4 text-right text-slate-200">
                                {row.credit_paise > 0 ? formatPaise(row.credit_paise) : '-'}
                              </td>

                              {/* Running Balance */}
                              <td className="py-3 px-4 text-right font-bold">
                                <span
                                  className={
                                    isBalSettled
                                      ? 'text-slate-400'
                                      : isBalDebit
                                      ? 'text-amber-400'
                                      : 'text-emerald-400'
                                  }
                                >
                                  {formatPaise(Math.abs(row.running_balance_paise))}
                                  <span className="text-[10px] ml-1 font-semibold">
                                    {isBalSettled ? '' : isBalDebit ? 'Dr' : 'Cr'}
                                  </span>
                                </span>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>

                    {/* Table Footer Totals */}
                    <tfoot>
                      <tr className="border-t-2 border-slate-700 bg-slate-900 font-mono font-bold text-slate-200 text-xs">
                        <td colSpan={4} className="py-3 px-4 text-right uppercase text-[11px] text-slate-400">
                          Total Statement Activity:
                        </td>
                        <td className="py-3 px-4 text-right text-blue-300">
                          {formatPaise(statementSummary.totalDebit)}
                        </td>
                        <td className="py-3 px-4 text-right text-emerald-300">
                          {formatPaise(statementSummary.totalCredit)}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <span
                            className={
                              statementSummary.closingBalance > 0
                                ? 'text-amber-400'
                                : statementSummary.closingBalance < 0
                                ? 'text-emerald-400'
                                : 'text-slate-300'
                            }
                          >
                            {formatPaise(Math.abs(statementSummary.closingBalance))}
                            <span className="text-[10px] ml-1">
                              {statementSummary.closingBalance > 0
                                ? 'Dr'
                                : statementSummary.closingBalance < 0
                                ? 'Cr'
                                : ''}
                            </span>
                          </span>
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-12 text-slate-500">
              <Users className="w-12 h-12 mb-3 opacity-40 text-slate-400" />
              <p className="text-base font-semibold text-slate-300">Select an entity from the left directory</p>
              <p className="text-xs text-slate-500 mt-1">
                View detailed ledger running statements, GSTIN details, and record settlements.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* MODAL: RECORD PAYMENT */}
      <Modal
        isOpen={isRecordPaymentOpen}
        onClose={() => setIsRecordPaymentOpen(false)}
        title={
          selectedEntity?.entity_type === 'CUSTOMER'
            ? `Record Payment Receipt from ${selectedEntity.full_name}`
            : `Record Supplier Payment to ${selectedEntity?.full_name}`
        }
        icon={<CreditCard className="w-5 h-5 text-emerald-400" />}
        width="max-w-md"
      >
        <form onSubmit={handlePaymentSubmit} className="space-y-4 text-xs select-none">
          <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 flex items-center justify-between">
            <span className="text-slate-400 font-medium">Current Balance:</span>
            <span className="font-mono font-bold text-sm text-amber-400">
              {selectedEntity ? formatPaise(Math.abs(selectedEntity.current_balance_paise)) : '₹0.00'}{' '}
              {selectedEntity && selectedEntity.current_balance_paise > 0 ? 'Dr' : 'Cr'}
            </span>
          </div>

          {/* Amount (INR) */}
          <div>
            <label className="block text-slate-400 font-medium mb-1">
              Payment Amount (₹) <span className="text-rose-400">*</span>
            </label>
            <input
              type="number"
              step="0.01"
              required
              placeholder="0.00"
              value={paymentForm.amount_inr}
              onChange={(e) => setPaymentForm({ ...paymentForm, amount_inr: e.target.value })}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono text-base font-bold focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Payment Mode */}
            <div>
              <label className="block text-slate-400 font-medium mb-1">
                Payment Mode <span className="text-rose-400">*</span>
              </label>
              <select
                value={paymentForm.payment_mode}
                onChange={(e) =>
                  setPaymentForm({ ...paymentForm, payment_mode: e.target.value as PaymentMode })
                }
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-blue-500"
              >
                <option value="UPI">UPI / QR Code</option>
                <option value="CASH">Cash in Hand</option>
                <option value="CARD">Debit / Credit Card</option>
                <option value="BANK_TRANSFER">Bank RTGS / NEFT</option>
                <option value="CHEQUE">Bank Cheque</option>
              </select>
            </div>

            {/* Date */}
            <div>
              <label className="block text-slate-400 font-medium mb-1">
                Payment Date <span className="text-rose-400">*</span>
              </label>
              <input
                type="date"
                required
                value={paymentForm.date}
                onChange={(e) => setPaymentForm({ ...paymentForm, date: e.target.value })}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {/* Reference / UTR Number */}
          <div>
            <label className="block text-slate-400 font-medium mb-1">
              UTR / Reference / Cheque # (Optional)
            </label>
            <input
              type="text"
              placeholder="e.g. UTR-998827361 or CHQ-00129"
              value={paymentForm.reference_number}
              onChange={(e) => setPaymentForm({ ...paymentForm, reference_number: e.target.value })}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Narration */}
          <div>
            <label className="block text-slate-400 font-medium mb-1">Voucher Narration / Note</label>
            <textarea
              rows={2}
              placeholder="Notes on invoice settlements..."
              value={paymentForm.narration}
              onChange={(e) => setPaymentForm({ ...paymentForm, narration: e.target.value })}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Modal Actions */}
          <div className="flex items-center justify-end space-x-3 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={() => setIsRecordPaymentOpen(false)}
              className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold shadow-lg shadow-emerald-600/30 transition-all cursor-pointer"
            >
              Commit Payment Voucher
            </button>
          </div>
        </form>
      </Modal>

      {/* MODAL: ADD ENTITY */}
      <Modal
        isOpen={isAddEntityOpen}
        onClose={() => setIsAddEntityOpen(false)}
        title={`Create New ${activeTab === 'CUSTOMER' ? 'Customer' : 'Supplier'} Master`}
        icon={<UserCheck className="w-5 h-5 text-blue-400" />}
        width="max-w-lg"
      >
        <form onSubmit={handleAddEntitySubmit} className="space-y-4 text-xs select-none">
          <div className="grid grid-cols-2 gap-3">
            {/* Entity Code */}
            <div>
              <label className="block text-slate-400 font-medium mb-1">
                Entity Code (Optional)
              </label>
              <input
                type="text"
                placeholder={activeTab === 'CUSTOMER' ? 'CUST-00X' : 'SUPP-00X'}
                value={entityForm.entity_code}
                onChange={(e) => setEntityForm({ ...entityForm, entity_code: e.target.value.toUpperCase() })}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-blue-500"
              />
            </div>

            {/* State Code */}
            <div>
              <label className="block text-slate-400 font-medium mb-1">
                State & POS Code <span className="text-rose-400">*</span>
              </label>
              <select
                value={entityForm.state_code}
                onChange={(e) => setEntityForm({ ...entityForm, state_code: e.target.value })}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-blue-500"
              >
                {Object.entries(INDIAN_STATES).map(([code, name]) => (
                  <option key={code} value={code}>
                    {code} - {name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Full Name */}
          <div>
            <label className="block text-slate-400 font-medium mb-1">
              Company / Entity Trade Name <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Mahavir Trading Agency LLP"
              value={entityForm.full_name}
              onChange={(e) => setEntityForm({ ...entityForm, full_name: e.target.value })}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Phone */}
            <div>
              <label className="block text-slate-400 font-medium mb-1">
                Phone Number <span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="10-digit mobile"
                value={entityForm.phone}
                onChange={(e) => setEntityForm({ ...entityForm, phone: e.target.value })}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-blue-500"
              />
            </div>

            {/* Email */}
            <div>
              <label className="block text-slate-400 font-medium mb-1">Email Address</label>
              <input
                type="email"
                placeholder="accounts@entity.com"
                value={entityForm.email}
                onChange={(e) => setEntityForm({ ...entityForm, email: e.target.value })}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {/* GSTIN */}
          <div>
            <label className="block text-slate-400 font-medium mb-1">
              15-Digit GSTIN (Leave empty if Unregistered Consumer)
            </label>
            <input
              type="text"
              placeholder="e.g. 27AABCM1234F1Z8"
              value={entityForm.gstin}
              onChange={(e) => {
                const val = e.target.value.toUpperCase();
                setEntityForm({
                  ...entityForm,
                  gstin: val,
                  // Auto-derive state code if first 2 chars are numbers
                  state_code: /^[0-9]{2}/.test(val) ? val.slice(0, 2) : entityForm.state_code,
                });
              }}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-blue-500"
            />
            {entityForm.gstin && (
              <p
                className={`text-[10px] mt-1 font-mono ${
                  isValidGstin(entityForm.gstin) ? 'text-emerald-400' : 'text-amber-400'
                }`}
              >
                {isValidGstin(entityForm.gstin)
                  ? `✓ Valid GSTIN format (${getStateName(entityForm.state_code)})`
                  : 'Notice: Format does not match standard 15-character GSTIN regex'}
              </p>
            )}
          </div>

          {/* Address */}
          <div>
            <label className="block text-slate-400 font-medium mb-1">Billing Address</label>
            <textarea
              rows={2}
              placeholder="Full premises address..."
              value={entityForm.address}
              onChange={(e) => setEntityForm({ ...entityForm, address: e.target.value })}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Opening Balance (INR) */}
          <div>
            <label className="block text-slate-400 font-medium mb-1">
              Opening Balance (₹) (+ for Debit, - for Credit)
            </label>
            <input
              type="number"
              step="0.01"
              value={entityForm.opening_balance_inr}
              onChange={(e) => setEntityForm({ ...entityForm, opening_balance_inr: e.target.value })}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Modal Actions */}
          <div className="flex items-center justify-end space-x-3 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={() => setIsAddEntityOpen(false)}
              className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold shadow-lg shadow-blue-600/30 transition-all cursor-pointer"
            >
              Create {activeTab === 'CUSTOMER' ? 'Customer' : 'Supplier'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
