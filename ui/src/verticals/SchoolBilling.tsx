// ui/src/verticals/SchoolBilling.tsx
// School & College Mode: Student Registration, Fee Head Selector, Term-Wise Fee Receipt Voucher

import React, { useState, useEffect, useMemo } from 'react';
import {
  GraduationCap,
  UserCheck,
  Plus,
  Trash2,
  Printer,
  CheckCircle2,
  Calendar,
  BookOpen,
  Award,
  Bus,
  Search,
  FileCheck,
  CreditCard,
  X,
  Phone,
  ArrowRight,
  ShieldAlert,
} from 'lucide-react';
import {
  StudentEntity,
  ResourceItem,
  VerticalCartLine,
  PaymentMode,
  PaymentDetails,
  PostedTransactionReceipt,
  SchoolFeeMeta,
} from './types';
import { VerticalIPCBridge } from './ipc';
import { computeSaleTotals, formatPaise, parseRupeesToPaise } from '../lib/tax';
import { PredictiveSearchDropdown } from '../components/pos/PredictiveSearchDropdown';

export const SchoolBilling: React.FC = () => {
  // State
  const [students, setStudents] = useState<StudentEntity[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState<string>('');
  const [catalog, setCatalog] = useState<ResourceItem[]>([]);
  const [cart, setCart] = useState<VerticalCartLine[]>([]);

  // Term & Concession
  const [academicTerm, setAcademicTerm] = useState<string>('Term 1 (Apr-Jun)');
  const [academicYear, setAcademicYear] = useState<string>('2026-2027');
  const [concessionType, setConcessionType] = useState<string>('NONE');
  const [concessionPaise, setConcessionPaise] = useState<number>(0);

  // Modals & Receipts
  const [showNewStudentModal, setShowNewStudentModal] = useState(false);
  const [showVoucherModal, setShowVoucherModal] = useState(false);
  const [lastReceipt, setLastReceipt] = useState<PostedTransactionReceipt | null>(null);

  // Payment State
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('UPI');
  const [paymentReference, setPaymentReference] = useState<string>('');

  // New Student Form
  const [newRollNo, setNewRollNo] = useState('');
  const [newFullName, setNewFullName] = useState('');
  const [newClass, setNewClass] = useState('Class 10');
  const [newSection, setNewSection] = useState('A');
  const [newGuardianName, setNewGuardianName] = useState('');
  const [newGuardianPhone, setNewGuardianPhone] = useState('');

  // Search queries for autocomplete
  const [studentSearchQuery, setStudentSearchQuery] = useState('');
  const [feeSearchQuery, setFeeSearchQuery] = useState('');

  // Load Students and Fee Heads
  useEffect(() => {
    VerticalIPCBridge.getEntities('STUDENT').then((list) => {
      setStudents(list as StudentEntity[]);
      if (list.length > 0 && !selectedStudentId) {
        setSelectedStudentId(list[0].id);
      }
    });

    VerticalIPCBridge.getResources('SCHOOL').then((res) => {
      setCatalog(res);
      // Auto-load common fee heads (Tuition, Transport, Exam) for demo
      if (cart.length === 0 && res.length >= 3) {
        addFeeHead(res[0]); // Tuition
        addFeeHead(res[1]); // Transport
        addFeeHead(res[2]); // Exam
      }
    });
  }, []);

  const selectedStudent = useMemo(() => {
    return students.find((s) => s.id === selectedStudentId) || students[0] || null;
  }, [students, selectedStudentId]);

  const filteredStudents = useMemo(() => {
    const q = studentSearchQuery.trim().toLowerCase();
    if (!q) return students;
    return students.filter(
      (s) =>
        s.full_name.toLowerCase().includes(q) ||
        s.roll_no.toLowerCase().includes(q) ||
        s.class_name.toLowerCase().includes(q) ||
        (s.guardian_phone && s.guardian_phone.includes(q))
    );
  }, [students, studentSearchQuery]);

  // Add Fee Head to Voucher
  const addFeeHead = (resource: ResourceItem) => {
    // Avoid duplicate heads
    if (cart.some((l) => l.resource_id === resource.id)) {
      return;
    }

    const newLine: VerticalCartLine = {
      id: `fee_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      resource_id: resource.id,
      sku: resource.sku,
      name: resource.name,
      hsn_sac: resource.hsn_sac,
      unit: resource.unit,
      tax_rate_bps: resource.tax_rate_bps,
      quantity_milli: 1000,
      unit_price_paise: resource.base_price_paise,
      discount_paise: 0,
      gross_paise: resource.base_price_paise,
      taxable_paise: resource.base_price_paise,
      cgst_paise: 0,
      sgst_paise: 0,
      igst_paise: 0,
      line_total_paise: resource.base_price_paise,
      fee_head_category: (resource.category as any) || 'Tuition',
      term_name: academicTerm,
    };

    setCart((prev) => [...prev, newLine]);
  };

  const removeFeeHead = (lineId: string) => {
    setCart((prev) => prev.filter((l) => l.id !== lineId));
  };

  const updateFeeAmount = (lineId: string, amountPaise: number) => {
    setCart((prev) =>
      prev.map((l) => {
        if (l.id !== lineId) return l;
        return {
          ...l,
          unit_price_paise: amountPaise,
          gross_paise: amountPaise,
          taxable_paise: amountPaise,
          line_total_paise: amountPaise,
        };
      })
    );
  };

  // Compute Concession
  const subtotalFeesPaise = useMemo(() => {
    return cart.reduce((acc, l) => acc + l.unit_price_paise, 0);
  }, [cart]);

  // Handle Concession Selection
  const applyConcession = (type: string) => {
    setConcessionType(type);
    if (type === 'MERIT_10') {
      setConcessionPaise(Math.round(subtotalFeesPaise * 0.1));
    } else if (type === 'SIBLING_15') {
      setConcessionPaise(Math.round(subtotalFeesPaise * 0.15));
    } else if (type === 'STAFF_25') {
      setConcessionPaise(Math.round(subtotalFeesPaise * 0.25));
    } else {
      setConcessionPaise(0);
    }
  };

  // Compute Total Voucher Amount
  const netVoucherTotalPaise = Math.max(0, subtotalFeesPaise - concessionPaise);

  // Quick Register Student
  const handleRegisterStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFullName.trim() || !newRollNo.trim()) return;

    const newStudent: StudentEntity = {
      id: `ent_std_${Date.now()}`,
      entity_code: `STD-${newRollNo.trim()}`,
      entity_type: 'STUDENT',
      full_name: newFullName.trim(),
      roll_no: newRollNo.trim(),
      class_name: newClass,
      section: newSection,
      academic_year: academicYear,
      guardian_name: newGuardianName.trim() || 'Parent/Guardian',
      guardian_phone: newGuardianPhone.trim(),
      admission_no: `ADM-${Math.floor(1000 + Math.random() * 9000)}`,
      state_code: '27',
      is_active: true,
      dues_balance_paise: 0,
    };

    await VerticalIPCBridge.createEntity(newStudent);
    setStudents((prev) => [newStudent, ...prev]);
    setSelectedStudentId(newStudent.id);
    setShowNewStudentModal(false);

    // Reset Form
    setNewFullName('');
    setNewRollNo('');
    setNewGuardianName('');
    setNewGuardianPhone('');
  };

  // Generate Fee Voucher & Post Transaction
  const handlePostFeeVoucher = async () => {
    if (cart.length === 0 || !selectedStudent) return;

    const payment: PaymentDetails = {
      mode: paymentMode,
      amount_tendered_paise: netVoucherTotalPaise,
      change_due_paise: 0,
      reference_number: paymentReference || `CHQ-${Date.now().toString().slice(-6)}`,
    };

    const totals = {
      subtotal_paise: subtotalFeesPaise,
      discount_paise: concessionPaise,
      taxable_paise: netVoucherTotalPaise,
      cgst_paise: 0, // Educational services 0% GST
      sgst_paise: 0,
      igst_paise: 0,
      round_off_paise: 0,
      total_amount_paise: netVoucherTotalPaise,
    };

    const receipt = await VerticalIPCBridge.postTransaction({
      verticalMode: 'SCHOOL',
      entityType: 'STUDENT',
      entityId: selectedStudent.id,
      entityName: selectedStudent.full_name,
      entityDetails: {
        ...selectedStudent,
        term_name: academicTerm,
        concession_type: concessionType,
        concession_amount_paise: concessionPaise,
      },
      lines: cart,
      totals,
      payment,
      notes: `School Fee Collection • Term: ${academicTerm} • Roll No: ${selectedStudent.roll_no}`,
    });

    setLastReceipt(receipt);
    setShowVoucherModal(true);
  };

  return (
    <div className="flex flex-col h-full w-full bg-slate-950 text-slate-100 p-4 space-y-4 overflow-y-auto">
      {/* TOP ROW: Student Registration / Selection + Academic Term Picker */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Student Profile Card */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center space-x-2">
              <GraduationCap className="w-5 h-5 text-amber-400" />
              <h2 className="text-sm font-bold text-slate-100">Enrolled Student Master Details</h2>
            </div>
            <button
              onClick={() => setShowNewStudentModal(true)}
              type="button"
              className="px-2.5 py-1 bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/30 rounded-lg text-xs font-semibold flex items-center space-x-1 transition"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Enroll New Student</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] text-slate-400">Search & Select Student:</label>
                <input
                  type="text"
                  placeholder="Filter name / roll..."
                  value={studentSearchQuery}
                  onChange={(e) => setStudentSearchQuery(e.target.value)}
                  className="px-2 py-0.5 bg-slate-950 border border-slate-750 rounded text-[10px] text-slate-300 placeholder-slate-600 focus:outline-none focus:border-amber-500 font-mono"
                />
              </div>
              <select
                value={selectedStudentId}
                onChange={(e) => setSelectedStudentId(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-amber-500 font-medium"
              >
                {filteredStudents.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.full_name} (Roll: {s.roll_no} • {s.class_name}-{s.section})
                  </option>
                ))}
              </select>
            </div>

            {selectedStudent && (
              <div className="bg-slate-950/80 p-2.5 rounded-xl border border-slate-800/80 text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-slate-400">Class & Section:</span>
                  <span className="font-bold text-amber-300">
                    {selectedStudent.class_name} - Sec {selectedStudent.section}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Guardian Name:</span>
                  <span className="text-slate-200">{selectedStudent.guardian_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Phone / Emergency:</span>
                  <span className="font-mono text-slate-300">{selectedStudent.guardian_phone}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Academic Term & Concession Selector */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md flex flex-col justify-between space-y-2">
          <div className="flex items-center space-x-2 border-b border-slate-800 pb-2">
            <Calendar className="w-4 h-4 text-amber-400" />
            <h4 className="text-xs font-bold text-slate-100">Academic Term & Concessions</h4>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <label className="text-[10px] text-slate-400 block mb-0.5">Academic Session:</label>
              <select
                value={academicYear}
                onChange={(e) => setAcademicYear(e.target.value)}
                className="w-full px-2 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-slate-200"
              >
                <option value="2026-2027">2026-2027</option>
                <option value="2025-2026">2025-2026</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-slate-400 block mb-0.5">Billing Term:</label>
              <select
                value={academicTerm}
                onChange={(e) => setAcademicTerm(e.target.value)}
                className="w-full px-2 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-amber-300 font-semibold"
              >
                <option value="Term 1 (Apr-Jun)">Term 1 (Apr-Jun)</option>
                <option value="Term 2 (Jul-Sep)">Term 2 (Jul-Sep)</option>
                <option value="Term 3 (Oct-Dec)">Term 3 (Oct-Dec)</option>
                <option value="Term 4 (Jan-Mar)">Term 4 (Jan-Mar)</option>
                <option value="Full Session Annual">Annual (Full Year)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-[10px] text-slate-400 block mb-0.5">Scholarship / Sibling Concession:</label>
            <select
              value={concessionType}
              onChange={(e) => applyConcession(e.target.value)}
              className="w-full px-2 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-200"
            >
              <option value="NONE">No Concession (Standard Fee)</option>
              <option value="MERIT_10">Merit Scholarship (10% Waiver)</option>
              <option value="SIBLING_15">Sibling Concession (15% Waiver)</option>
              <option value="STAFF_25">Staff Ward Concession (25% Waiver)</option>
            </select>
          </div>
        </div>
      </div>

      {/* MIDDLE SECTION: Fee Head Selector Grid */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-lg space-y-3">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
          <div className="flex items-center space-x-2">
            <BookOpen className="w-5 h-5 text-amber-400" />
            <h3 className="text-sm font-bold text-slate-100">Fee Head Allocation & Breakdown</h3>
            <span className="px-2 py-0.5 bg-amber-500/20 text-amber-300 rounded-full text-xs font-mono">
              {cart.length} Fee Heads
            </span>
          </div>

          {/* Quick Add Fee Head with Autocomplete */}
          <div className="flex items-center space-x-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-60">
              <input
                type="text"
                placeholder="Type fee head (e.g. Tuition)..."
                value={feeSearchQuery}
                onChange={(e) => setFeeSearchQuery(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded-xl text-xs text-amber-200 placeholder-slate-500 font-mono focus:outline-none focus:border-amber-500"
              />
              <PredictiveSearchDropdown
                query={feeSearchQuery}
                products={catalog}
                isOpen={feeSearchQuery.trim().length >= 1}
                onSelect={(item) => {
                  addFeeHead(item);
                  setFeeSearchQuery('');
                }}
                onClose={() => setFeeSearchQuery('')}
                anchorPosition="bottom"
              />
            </div>

            <select
              onChange={(e) => {
                const res = catalog.find((r) => r.id === e.target.value);
                if (res) addFeeHead(res);
                e.target.value = '';
              }}
              defaultValue=""
              className="px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded-xl text-xs text-slate-300 focus:outline-none focus:border-amber-500 shrink-0"
            >
              <option value="" disabled>
                + List
              </option>
              {catalog.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ({formatPaise(item.base_price_paise)})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Fee Heads Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-slate-950/80 text-slate-400 border-b border-slate-800">
                <th className="py-2.5 px-3">#</th>
                <th className="py-2.5 px-3">Fee Head Name</th>
                <th className="py-2.5 px-3">Category</th>
                <th className="py-2.5 px-3">SAC Code</th>
                <th className="py-2.5 px-3">Term Coverage</th>
                <th className="py-2.5 px-3 text-right">Fee Amount (₹)</th>
                <th className="py-2.5 px-2 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {cart.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-slate-500">
                    No fee heads selected. Choose fee components from the dropdown above.
                  </td>
                </tr>
              ) : (
                cart.map((line, idx) => (
                  <tr key={line.id} className="hover:bg-slate-850/50 transition-colors">
                    <td className="py-2.5 px-3 font-mono text-slate-500">{idx + 1}</td>
                    <td className="py-2.5 px-3">
                      <div className="font-semibold text-slate-200">{line.name}</div>
                      <div className="text-[10px] text-slate-400 font-mono">{line.sku}</div>
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="px-2 py-0.5 bg-slate-800 rounded font-medium text-[11px] text-amber-300">
                        {line.fee_head_category}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 font-mono text-slate-400">{line.hsn_sac}</td>
                    <td className="py-2.5 px-3 text-slate-300">{academicTerm}</td>

                    {/* Fee Amount Editable */}
                    <td className="py-2.5 px-3 text-right">
                      <input
                        type="number"
                        value={(line.unit_price_paise / 100).toFixed(2)}
                        onChange={(e) =>
                          updateFeeAmount(line.id, Math.round(parseFloat(e.target.value || '0') * 100))
                        }
                        className="w-28 px-2 py-1 bg-slate-950 border border-slate-700 rounded-lg text-right font-mono font-bold text-amber-300 focus:outline-none focus:border-amber-500"
                      />
                    </td>

                    {/* Remove Action */}
                    <td className="py-2.5 px-2 text-center">
                      <button
                        onClick={() => removeFeeHead(line.id)}
                        type="button"
                        className="p-1 text-slate-500 hover:text-rose-400 transition"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* BOTTOM SUMMARY & RECEIPT POST */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md flex flex-col md:flex-row justify-between items-center gap-4">
        {/* Left Side: Concession & Due Details */}
        <div className="flex flex-col sm:flex-row gap-4 w-full md:w-auto text-xs">
          <div className="bg-slate-950 px-3 py-2 rounded-xl border border-slate-800">
            <span className="text-slate-400 block text-[10px]">Gross Fee Dues:</span>
            <span className="font-mono font-bold text-slate-200 text-sm">
              {formatPaise(subtotalFeesPaise)}
            </span>
          </div>
          {concessionPaise > 0 && (
            <div className="bg-amber-950/60 px-3 py-2 rounded-xl border border-amber-500/40">
              <span className="text-amber-400 block text-[10px]">Scholarship Discount:</span>
              <span className="font-mono font-bold text-amber-300 text-sm">
                -{formatPaise(concessionPaise)}
              </span>
            </div>
          )}
          <div className="bg-slate-950 px-3 py-2 rounded-xl border border-slate-800">
            <span className="text-slate-400 block text-[10px]">Net Payable Today:</span>
            <span className="font-mono font-extrabold text-amber-400 text-base">
              {formatPaise(netVoucherTotalPaise)}
            </span>
          </div>
        </div>

        {/* Right Side: Payment Instrument & Generate Voucher Button */}
        <div className="flex items-center space-x-3 w-full md:w-auto">
          <div className="w-36">
            <select
              value={paymentMode}
              onChange={(e) => setPaymentMode(e.target.value as PaymentMode)}
              className="w-full px-2.5 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs font-semibold text-slate-200"
            >
              <option value="UPI">UPI / QR Code</option>
              <option value="CHEQUE">Bank Cheque / DD</option>
              <option value="BANK_TRANSFER">Direct Net Banking</option>
              <option value="CASH">Counter Cash</option>
            </select>
          </div>

          <button
            onClick={handlePostFeeVoucher}
            disabled={cart.length === 0 || !selectedStudent}
            type="button"
            className="flex-1 sm:flex-none px-5 py-2.5 bg-amber-600 hover:bg-amber-500 disabled:bg-slate-800 disabled:text-slate-500 text-white rounded-xl font-bold text-xs shadow-lg shadow-amber-950/60 flex items-center space-x-2 transition"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>Generate Term Fee Voucher</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* MODAL 1: REGISTER NEW STUDENT */}
      {showNewStudentModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 w-full max-w-md rounded-2xl p-5 shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-slate-100 flex items-center space-x-2">
                <GraduationCap className="w-4 h-4 text-amber-400" />
                <span>Student Admission Registration</span>
              </h3>
              <button
                onClick={() => setShowNewStudentModal(false)}
                className="text-slate-400 hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleRegisterStudent} className="space-y-3 text-xs">
              <div>
                <label className="text-slate-400 block mb-1">Student Full Name *</label>
                <input
                  required
                  type="text"
                  placeholder="e.g. Aarav Sharma"
                  value={newFullName}
                  onChange={(e) => setNewFullName(e.target.value)}
                  className="w-full px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-slate-200"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-slate-400 block mb-1">Roll No *</label>
                  <input
                    required
                    type="text"
                    placeholder="10-A-09"
                    value={newRollNo}
                    onChange={(e) => setNewRollNo(e.target.value)}
                    className="w-full px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-slate-200 font-mono"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Class</label>
                  <select
                    value={newClass}
                    onChange={(e) => setNewClass(e.target.value)}
                    className="w-full px-2 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-slate-200"
                  >
                    {[...Array(12)].map((_, i) => (
                      <option key={i} value={`Class ${i + 1}`}>
                        Class {i + 1}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Section</label>
                  <select
                    value={newSection}
                    onChange={(e) => setNewSection(e.target.value)}
                    className="w-full px-2 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-slate-200"
                  >
                    <option value="A">Sec A</option>
                    <option value="B">Sec B</option>
                    <option value="C">Sec C</option>
                    <option value="D">Sec D</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Guardian / Parent Name</label>
                <input
                  type="text"
                  placeholder="e.g. Rajesh Sharma"
                  value={newGuardianName}
                  onChange={(e) => setNewGuardianName(e.target.value)}
                  className="w-full px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-slate-200"
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Guardian Phone (SMS Alerts)</label>
                <input
                  type="text"
                  placeholder="+91..."
                  value={newGuardianPhone}
                  onChange={(e) => setNewGuardianPhone(e.target.value)}
                  className="w-full px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-slate-200 font-mono"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowNewStudentModal(false)}
                  className="px-3 py-1.5 bg-slate-800 text-slate-300 rounded-lg font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg font-bold shadow"
                >
                  Enroll Student
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: TERM-WISE FEE RECEIPT VOUCHER (Dual Copy: Student & School Copy) */}
      {showVoucherModal && lastReceipt && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white text-slate-900 w-full max-w-4xl rounded-2xl shadow-2xl p-6 overflow-y-auto max-h-[95vh] font-sans text-xs">
            {/* Header controls (Non-printable) */}
            <div className="flex justify-between items-center pb-3 mb-3 border-b border-gray-300 non-printable">
              <span className="font-bold text-gray-700">Institutional Term Fee Receipt Voucher</span>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => window.print()}
                  className="px-4 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-bold flex items-center space-x-1.5 shadow"
                >
                  <Printer className="w-4 h-4" />
                  <span>Print Dual Voucher</span>
                </button>
                <button
                  onClick={() => setShowVoucherModal(false)}
                  className="px-3 py-1.5 bg-gray-200 text-gray-700 rounded-lg font-bold"
                >
                  Close
                </button>
              </div>
            </div>

            {/* DUAL COPY VOUCHER: Student Copy & Accounts Copy Side-by-Side */}
            <div id="fee-receipt-print" className="grid grid-cols-1 md:grid-cols-2 gap-4 border border-gray-400 p-4">
              {/* SLIP 1: STUDENT COPY */}
              <div className="border border-dashed border-gray-400 p-3 space-y-2.5">
                <div className="text-center border-b border-gray-300 pb-2">
                  <div className="text-[10px] font-bold uppercase text-amber-800">STUDENT COPY</div>
                  <h3 className="text-sm font-extrabold uppercase">ST. XAVIER HIGHER ACADEMY</h3>
                  <p className="text-[10px] text-gray-600">CBSE Affiliation No: 1130492 • Mumbai</p>
                  <p className="text-[10px] font-mono font-bold mt-1">
                    Receipt No: {lastReceipt.invoice_number} | Date: {lastReceipt.invoice_date}
                  </p>
                </div>

                <div className="bg-gray-50 p-2 rounded text-[11px] space-y-0.5">
                  <div><strong>Student:</strong> {lastReceipt.entity_name}</div>
                  <div className="flex justify-between">
                    <span><strong>Roll No:</strong> {lastReceipt.entity_details?.roll_no}</span>
                    <span><strong>Class:</strong> {lastReceipt.entity_details?.class_name}-{lastReceipt.entity_details?.section}</span>
                  </div>
                  <div className="flex justify-between">
                    <span><strong>Term:</strong> {lastReceipt.entity_details?.term_name}</span>
                    <span><strong>Year:</strong> 2026-27</span>
                  </div>
                </div>

                <table className="w-full text-left text-[10px]">
                  <thead>
                    <tr className="border-b border-gray-300 font-bold">
                      <th className="py-1">Fee Particulars</th>
                      <th className="py-1 text-right">Amount (₹)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-dotted divide-gray-200">
                    {lastReceipt.lines.map((l, i) => (
                      <tr key={i}>
                        <td className="py-0.5">{l.name}</td>
                        <td className="py-0.5 text-right font-mono">{formatPaise(l.unit_price_paise, false)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="border-t border-gray-300 pt-1 space-y-0.5 text-[11px]">
                  <div className="flex justify-between">
                    <span>Subtotal:</span>
                    <span>{formatPaise(lastReceipt.totals.subtotal_paise)}</span>
                  </div>
                  {lastReceipt.totals.discount_paise > 0 && (
                    <div className="flex justify-between text-amber-700">
                      <span>Concession Waiver:</span>
                      <span>-{formatPaise(lastReceipt.totals.discount_paise)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold text-xs border-t border-gray-300 pt-1">
                    <span>NET PAID:</span>
                    <span>{formatPaise(lastReceipt.totals.total_amount_paise)}</span>
                  </div>
                  <div className="text-[9px] text-gray-500 pt-1">
                    Payment Mode: {lastReceipt.payment.mode} (Ref: {lastReceipt.payment.reference_number || 'Cash'})
                  </div>
                </div>

                <div className="pt-4 flex justify-between items-end text-[9px] text-gray-500">
                  <span>Authorized Accounts Signatory</span>
                  <div className="border-b border-gray-400 w-24"></div>
                </div>
              </div>

              {/* SLIP 2: SCHOOL / ACCOUNTS COPY */}
              <div className="border border-dashed border-gray-400 p-3 space-y-2.5">
                <div className="text-center border-b border-gray-300 pb-2">
                  <div className="text-[10px] font-bold uppercase text-gray-600">ACCOUNTS / OFFICE COPY</div>
                  <h3 className="text-sm font-extrabold uppercase">ST. XAVIER HIGHER ACADEMY</h3>
                  <p className="text-[10px] text-gray-600">CBSE Affiliation No: 1130492 • Mumbai</p>
                  <p className="text-[10px] font-mono font-bold mt-1">
                    Receipt No: {lastReceipt.invoice_number} | Date: {lastReceipt.invoice_date}
                  </p>
                </div>

                <div className="bg-gray-50 p-2 rounded text-[11px] space-y-0.5">
                  <div><strong>Student:</strong> {lastReceipt.entity_name}</div>
                  <div className="flex justify-between">
                    <span><strong>Roll No:</strong> {lastReceipt.entity_details?.roll_no}</span>
                    <span><strong>Class:</strong> {lastReceipt.entity_details?.class_name}-{lastReceipt.entity_details?.section}</span>
                  </div>
                  <div className="flex justify-between">
                    <span><strong>Term:</strong> {lastReceipt.entity_details?.term_name}</span>
                    <span><strong>Guardian Phone:</strong> {lastReceipt.entity_details?.guardian_phone}</span>
                  </div>
                </div>

                <table className="w-full text-left text-[10px]">
                  <thead>
                    <tr className="border-b border-gray-300 font-bold">
                      <th className="py-1">Fee Particulars</th>
                      <th className="py-1 text-right">Amount (₹)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-dotted divide-gray-200">
                    {lastReceipt.lines.map((l, i) => (
                      <tr key={i}>
                        <td className="py-0.5">{l.name}</td>
                        <td className="py-0.5 text-right font-mono">{formatPaise(l.unit_price_paise, false)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="border-t border-gray-300 pt-1 space-y-0.5 text-[11px]">
                  <div className="flex justify-between">
                    <span>Subtotal:</span>
                    <span>{formatPaise(lastReceipt.totals.subtotal_paise)}</span>
                  </div>
                  {lastReceipt.totals.discount_paise > 0 && (
                    <div className="flex justify-between text-amber-700">
                      <span>Concession Waiver:</span>
                      <span>-{formatPaise(lastReceipt.totals.discount_paise)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold text-xs border-t border-gray-300 pt-1">
                    <span>NET RECEIVED:</span>
                    <span>{formatPaise(lastReceipt.totals.total_amount_paise)}</span>
                  </div>
                  <div className="text-[9px] text-gray-500 pt-1">
                    Deposited via: {lastReceipt.payment.mode}
                  </div>
                </div>

                <div className="pt-4 flex justify-between items-end text-[9px] text-gray-500">
                  <span>Cashier / Bursar Stamp</span>
                  <div className="border-b border-gray-400 w-24"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
