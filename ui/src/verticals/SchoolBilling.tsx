// ui/src/verticals/SchoolBilling.tsx
// Comprehensive School & College Management Suite:
// 1. Student Record Master (Admission No Master Key, Class, Section, Guardian, Dues)
// 2. Class-Wise Fee Rules Preset Configurator (Nursery to Class 12)
// 3. 12-Month Billing Grid (Apr to Mar) with Multi-Month Selection & Payment Tracking
// 4. Defaulters Tracking Engine with 1-Click WhatsApp Fee Due Reminders
// 5. School Operational Expense Ledger (Salaries, Utilities, Labs, Maintenance)
// 6. Multi-Dimensional Fee Reports (Date-wise, Class-wise, Staff-wise)
// 7. Robust Dual-Slip Receipt with Live Adjustable Watermark & School Logo Customizer

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
  AlertTriangle,
  Sliders,
  Wallet,
  BarChart3,
  Image,
  MessageCircle,
  Download,
  RefreshCw,
  FileSpreadsheet,
  Layers,
  Settings,
  DollarSign,
  Check,
  Share2,
  Hash,
  MapPin,
  Clock,
  User,
  Building,
  Receipt,
  Sparkles,
} from 'lucide-react';
import {
  StudentEntity,
  ResourceItem,
  VerticalCartLine,
  PaymentMode,
  PaymentDetails,
  PostedTransactionReceipt,
  ClassFeeRule,
  MonthlyClassFeeRule,
  SchoolExpense,
  SchoolReceiptSettings,
  SchoolFeePaymentRecord,
} from './types';
import { VerticalIPCBridge } from './ipc';
import { formatPaise, parseRupeesToPaise } from '../lib/tax';
import { paiseToWords } from '../lib/numbersToWords';
import { PredictiveSearchDropdown } from '../components/pos/PredictiveSearchDropdown';
import {
  ACADEMIC_MONTHS,
  SCHOOL_CLASSES,
  SchoolDataService,
  AcademicMonth,
  exportFeeRecordsToCSV,
  exportDefaultersToCSV,
  generateCollectionWhatsAppLink,
  generateStudentFeeWhatsAppLink,
} from './schoolData';

export type SchoolTab =
  | 'BILLING'
  | 'DEFAULTERS'
  | 'FEE_RULES'
  | 'EXPENSES'
  | 'REPORTS'
  | 'RECEIPT_SETTINGS';

// ----------------------------------------------------------------------------
// SVG PRESET SCHOOL LOGOS (Crisp Vector Emblems)
// ----------------------------------------------------------------------------
const PresetLogos = {
  SHIELD: (size = 60) => (
    <svg width={size} height={size} viewBox="0 0 100 100" className="text-amber-600 fill-current">
      <path d="M50 5 L85 20 V50 C85 75 50 95 50 95 C50 95 15 75 15 50 V20 Z" fill="#D97706" opacity="0.15" />
      <path d="M50 8 L82 22 V48 C82 70 50 90 50 90 C50 90 18 70 18 48 V22 Z" fill="none" stroke="#D97706" strokeWidth="3" />
      <path d="M50 20 L58 35 L75 38 L62 50 L65 67 L50 59 L35 67 L38 50 L25 38 L42 35 Z" fill="#B45309" />
      <circle cx="50" cy="50" r="3" fill="#FFF" />
      <text x="50" y="80" textAnchor="middle" fontSize="9" fontWeight="bold" fill="#78350F">ESTD 1988</text>
    </svg>
  ),
  TORCH: (size = 60) => (
    <svg width={size} height={size} viewBox="0 0 100 100" className="text-blue-700 fill-current">
      <circle cx="50" cy="50" r="42" fill="#1E40AF" opacity="0.1" stroke="#1E40AF" strokeWidth="2.5" />
      <path d="M44 48 L56 48 L52 82 L48 82 Z" fill="#1E3A8A" />
      <path d="M40 48 L60 48 L55 40 L45 40 Z" fill="#2563EB" />
      <path d="M50 18 C46 28 42 32 45 40 C48 36 50 34 50 30 C50 34 53 36 55 40 C58 32 54 28 50 18 Z" fill="#DC2626" />
      <path d="M50 24 C48 30 46 32 48 38 C50 35 51 34 50 32 C51 34 52 35 53 38 C54 32 52 30 50 24 Z" fill="#F59E0B" />
      <text x="50" y="93" textAnchor="middle" fontSize="8" fontWeight="bold" fill="#1E3A8A">VERITAS</text>
    </svg>
  ),
  CREST: (size = 60) => (
    <svg width={size} height={size} viewBox="0 0 100 100" className="text-emerald-700 fill-current">
      <rect x="15" y="15" width="70" height="70" rx="14" fill="#047857" opacity="0.1" stroke="#047857" strokeWidth="2.5" />
      <path d="M30 45 Q50 35 70 45 V65 Q50 55 30 65 Z" fill="#065F46" />
      <line x1="50" y1="38" x2="50" y2="62" stroke="#FFF" strokeWidth="2" />
      <path d="M36 34 L50 24 L64 34" fill="none" stroke="#047857" strokeWidth="3" strokeLinecap="round" />
      <text x="50" y="80" textAnchor="middle" fontSize="8" fontWeight="bold" fill="#065F46">EXCELLENCE</text>
    </svg>
  ),
};

const renderSchoolLogo = (
  preset: 'SHIELD' | 'TORCH' | 'CREST' | 'CUSTOM',
  size = 60,
  customUrl?: string
) => {
  if (preset === 'TORCH') return PresetLogos.TORCH(size);
  if (preset === 'CREST') return PresetLogos.CREST(size);
  if (preset === 'CUSTOM' && customUrl) {
    return (
      <img
        src={customUrl}
        width={size}
        height={size}
        alt="School Logo"
        className="object-contain"
      />
    );
  }
  return PresetLogos.SHIELD(size);
};

export const SchoolBilling: React.FC = () => {
  // Navigation Tabs
  const [activeTab, setActiveTab] = useState<SchoolTab>('BILLING');

  // Core Data State (Loaded via SchoolDataService)
  const [students, setStudents] = useState<StudentEntity[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState<string>('');
  const [feeRules, setFeeRules] = useState<ClassFeeRule[]>([]);
  const [monthlyFeeRules, setMonthlyFeeRules] = useState<MonthlyClassFeeRule[]>([]);
  const [selectedRuleClass, setSelectedRuleClass] = useState<string>('Class 10');
  const [receiptSettings, setReceiptSettings] = useState<SchoolReceiptSettings>(
    SchoolDataService.getReceiptSettings()
  );
  const [expenses, setExpenses] = useState<SchoolExpense[]>([]);
  const [paymentRecords, setPaymentRecords] = useState<SchoolFeePaymentRecord[]>([]);

  // Two-Way Smart Auto-Fill & Search State
  const [masterSearchQuery, setMasterSearchQuery] = useState('');
  const [nameSearchQuery, setNameSearchQuery] = useState('');
  const [classFilter, setClassFilter] = useState<string>('ALL');
  const [sectionFilter, setSectionFilter] = useState<string>('ALL');
  const [rollFilter, setRollFilter] = useState<string>('');

  // Academic Term & Monthly Billing Grid
  const [academicYear, setAcademicYear] = useState<string>('2026-2027');
  const [selectedMonths, setSelectedMonths] = useState<AcademicMonth[]>(['Oct']);
  const [billingMode, setBillingMode] = useState<'MONTHLY' | 'TERM'>('MONTHLY');
  const [academicTerm, setAcademicTerm] = useState<string>('Term 3 (Oct-Dec)');

  // Dynamic & Fully Editable Fee Line Items in Cart
  const [cart, setCart] = useState<VerticalCartLine[]>([]);
  const [concessionType, setConcessionType] = useState<string>('NONE');
  const [concessionPaise, setConcessionPaise] = useState<number>(0);
  const [customDiscountPaise, setCustomDiscountPaise] = useState<number>(0);
  const [lateFeePaise, setLateFeePaise] = useState<number>(0);

  // Custom Line Item Insertion ("+ Add Custom Fee Head")
  const [showAddCustomHead, setShowAddCustomHead] = useState(false);
  const [customHeadName, setCustomHeadName] = useState('');
  const [customHeadAmountInr, setCustomHeadAmountInr] = useState('');

  // Report Date/Class/Staff Filter State
  const [reportDateRange, setReportDateRange] = useState<'ALL' | 'TODAY' | 'WEEK' | 'MONTH'>('ALL');
  const [reportClassFilter, setReportClassFilter] = useState<string>('ALL');
  const [reportStaffFilter, setReportStaffFilter] = useState<string>('ALL');

  // Payment Instrument & Staff
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('UPI');
  const [paymentReference, setPaymentReference] = useState<string>('');
  const [activeStaffName, setActiveStaffName] = useState<string>('Mrs. Sunita Rao (Counter 1)');

  // Modals & Receipts
  const [showNewStudentModal, setShowNewStudentModal] = useState(false);
  const [showVoucherModal, setShowVoucherModal] = useState(false);
  const [showNewExpenseModal, setShowNewExpenseModal] = useState(false);
  const [lastReceipt, setLastReceipt] = useState<SchoolFeePaymentRecord | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // New Student Form State
  const [newAdmissionNo, setNewAdmissionNo] = useState(`ADM-2026-${Math.floor(100 + Math.random() * 900)}`);
  const [newRollNo, setNewRollNo] = useState('');
  const [newFullName, setNewFullName] = useState('');
  const [newClass, setNewClass] = useState('Class 10');
  const [newSection, setNewSection] = useState('A');
  const [newGuardianName, setNewGuardianName] = useState('');
  const [newGuardianPhone, setNewGuardianPhone] = useState('');
  const [newAddress, setNewAddress] = useState('');

  // New Expense Form State
  const [expCategory, setExpCategory] = useState<SchoolExpense['category']>('UTILITIES');
  const [expPayee, setExpPayee] = useState('');
  const [expAmountInr, setExpAmountInr] = useState('');
  const [expMode, setExpMode] = useState<PaymentMode>('UPI');
  const [expVoucherNo, setExpVoucherNo] = useState(`EXP-${Date.now().toString().slice(-4)}`);
  const [expRemarks, setExpRemarks] = useState('');

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Synchronize two-way inputs when a student is selected
  const syncStudentInputs = (student: StudentEntity) => {
    setSelectedStudentId(student.id);
    setMasterSearchQuery(student.admission_no);
    setNameSearchQuery(student.full_name);
    setClassFilter(student.class_name);
    setSectionFilter(student.section);
    setRollFilter(student.roll_no);
  };

  // Initial Load
  const refreshAllData = () => {
    const stds = SchoolDataService.getStudents();
    setStudents(stds);
    if (stds.length > 0 && !selectedStudentId) {
      syncStudentInputs(stds[0]);
    }
    setFeeRules(SchoolDataService.getFeeRules());
    setMonthlyFeeRules(SchoolDataService.getMonthlyFeeRules());
    setReceiptSettings(SchoolDataService.getReceiptSettings());
    setExpenses(SchoolDataService.getExpenses());
    setPaymentRecords(SchoolDataService.getFeePayments());
  };

  useEffect(() => {
    refreshAllData();
  }, []);

  // Currently Selected Student
  const selectedStudent = useMemo(() => {
    return students.find((s) => s.id === selectedStudentId) || students[0] || null;
  }, [students, selectedStudentId]);

  // Two-Way Smart Match: Handlers
  const handleMasterKeyChange = (val: string) => {
    setMasterSearchQuery(val);
    const query = val.trim().toLowerCase();
    if (!query) return;
    const match = students.find((s) => s.admission_no.toLowerCase() === query);
    if (match) {
      syncStudentInputs(match);
      showToast(`Auto-matched Admission No: ${match.admission_no} (${match.full_name})`);
    }
  };

  const handleNameOrPhoneSearch = (val: string) => {
    setNameSearchQuery(val);
    const query = val.trim().toLowerCase();
    if (!query) return;
    const match = students.find(
      (s) =>
        s.full_name.toLowerCase().includes(query) ||
        (s.guardian_phone && s.guardian_phone.includes(query)) ||
        s.roll_no.toLowerCase() === query
    );
    if (match && match.id !== selectedStudentId) {
      syncStudentInputs(match);
    }
  };

  const handleClassSectionRollSelect = (cls: string, sec: string, roll: string) => {
    setClassFilter(cls);
    setSectionFilter(sec);
    setRollFilter(roll);

    const match = students.find(
      (s) =>
        (cls === 'ALL' || s.class_name.toLowerCase() === cls.toLowerCase()) &&
        (sec === 'ALL' || s.section.toLowerCase() === sec.toLowerCase()) &&
        (roll.trim() === '' || s.roll_no.toLowerCase() === roll.trim().toLowerCase() || s.roll_no.endsWith(roll.trim()))
    );

    if (match) {
      syncStudentInputs(match);
      showToast(`Auto-caught Admission No: ${match.admission_no}`);
    }
  };

  // Current Student's Class Fee Rule Summary
  const currentClassRule = useMemo<ClassFeeRule>(() => {
    if (!selectedStudent) return SchoolDataService.getRuleForClass('Class 10');
    return SchoolDataService.getRuleForClass(selectedStudent.class_name);
  }, [selectedStudent, feeRules]);

  // Sync Fee Lines when Student or Selected Months change (using Class-wise & Month-wise rules!)
  useEffect(() => {
    if (!selectedStudent) return;

    const monthsCount = selectedMonths.length > 0 ? selectedMonths.length : 1;
    const monthsLabel = selectedMonths.join(', ');

    // Fetch month-wise rules for each selected month
    const monthRules = selectedMonths.map((m) =>
      SchoolDataService.getMonthlyRule(selectedStudent.class_name, m)
    );

    const totalTuition = monthRules.reduce((acc, r) => acc + r.tuition_paise, 0);
    const totalLab = monthRules.reduce((acc, r) => acc + r.computer_lab_paise, 0);
    const totalSports = monthRules.reduce((acc, r) => acc + r.sports_activity_paise, 0);
    const totalExam = monthRules.reduce((acc, r) => acc + r.exam_paise, 0);
    const totalTransport = monthRules.reduce((acc, r) => acc + r.transport_paise, 0);
    const totalAnnual = monthRules.reduce((acc, r) => acc + r.annual_charge_paise, 0);

    const lines: VerticalCartLine[] = [
      {
        id: `fee_tui_${selectedStudent.id}`,
        resource_id: 'res_tui',
        sku: 'FEE-TUI',
        name: `Tuition Fee (${selectedStudent.class_name} • ${monthsCount} mo: ${monthsLabel})`,
        hsn_sac: '9992',
        unit: 'mo',
        tax_rate_bps: 0,
        quantity_milli: monthsCount * 1000,
        unit_price_paise: Math.round(totalTuition / monthsCount),
        discount_paise: 0,
        gross_paise: totalTuition,
        taxable_paise: totalTuition,
        cgst_paise: 0,
        sgst_paise: 0,
        igst_paise: 0,
        line_total_paise: totalTuition,
        fee_head_category: 'Tuition',
        term_name: monthsLabel,
      },
    ];

    if (totalAnnual > 0) {
      lines.push({
        id: `fee_ann_${selectedStudent.id}`,
        resource_id: 'res_ann',
        sku: 'FEE-ANN',
        name: `Annual Session / Admission Development Charge (${monthsLabel})`,
        hsn_sac: '9992',
        unit: 'session',
        tax_rate_bps: 0,
        quantity_milli: 1000,
        unit_price_paise: totalAnnual,
        discount_paise: 0,
        gross_paise: totalAnnual,
        taxable_paise: totalAnnual,
        cgst_paise: 0,
        sgst_paise: 0,
        igst_paise: 0,
        line_total_paise: totalAnnual,
        fee_head_category: 'Admission',
      });
    }

    if (totalLab > 0) {
      lines.push({
        id: `fee_lab_${selectedStudent.id}`,
        resource_id: 'res_lab',
        sku: 'FEE-LAB',
        name: `Computer & Science Lab Assessment (${monthsCount} mo: ${monthsLabel})`,
        hsn_sac: '9992',
        unit: 'mo',
        tax_rate_bps: 0,
        quantity_milli: monthsCount * 1000,
        unit_price_paise: Math.round(totalLab / monthsCount),
        discount_paise: 0,
        gross_paise: totalLab,
        taxable_paise: totalLab,
        cgst_paise: 0,
        sgst_paise: 0,
        igst_paise: 0,
        line_total_paise: totalLab,
        fee_head_category: 'Lab',
      });
    }

    if (totalSports > 0) {
      lines.push({
        id: `fee_spt_${selectedStudent.id}`,
        resource_id: 'res_spt',
        sku: 'FEE-SPT',
        name: `Sports, Cultural & Winter Activities (${monthsCount} mo: ${monthsLabel})`,
        hsn_sac: '9992',
        unit: 'mo',
        tax_rate_bps: 0,
        quantity_milli: monthsCount * 1000,
        unit_price_paise: Math.round(totalSports / monthsCount),
        discount_paise: 0,
        gross_paise: totalSports,
        taxable_paise: totalSports,
        cgst_paise: 0,
        sgst_paise: 0,
        igst_paise: 0,
        line_total_paise: totalSports,
        fee_head_category: 'Sports',
      });
    }

    if (totalExam > 0) {
      lines.push({
        id: `fee_exm_${selectedStudent.id}`,
        resource_id: 'res_exm',
        sku: 'FEE-EXM',
        name: `Periodic Assessment & Board Exam Evaluation (${monthsLabel})`,
        hsn_sac: '9992',
        unit: 'term',
        tax_rate_bps: 0,
        quantity_milli: 1000,
        unit_price_paise: totalExam,
        discount_paise: 0,
        gross_paise: totalExam,
        taxable_paise: totalExam,
        cgst_paise: 0,
        sgst_paise: 0,
        igst_paise: 0,
        line_total_paise: totalExam,
        fee_head_category: 'Examination',
      });
    }

    if (totalTransport > 0) {
      lines.push({
        id: `fee_bus_${selectedStudent.id}`,
        resource_id: 'res_bus',
        sku: 'FEE-BUS',
        name: `School Bus / Transport Route Facility (${monthsCount} mo: ${monthsLabel})`,
        hsn_sac: '9992',
        unit: 'mo',
        tax_rate_bps: 0,
        quantity_milli: monthsCount * 1000,
        unit_price_paise: Math.round(totalTransport / monthsCount),
        discount_paise: 0,
        gross_paise: totalTransport,
        taxable_paise: totalTransport,
        cgst_paise: 0,
        sgst_paise: 0,
        igst_paise: 0,
        line_total_paise: totalTransport,
        fee_head_category: 'Transport',
      });
    }

    setCart(lines);
  }, [selectedStudent, selectedMonths, monthlyFeeRules]);

  // Inline Line Item Editing Handlers (Fully Editable Bill)
  const handleUpdateLineName = (lineId: string, newName: string) => {
    setCart((prev) =>
      prev.map((l) => (l.id === lineId ? { ...l, name: newName } : l))
    );
  };

  const handleUpdateLineAmount = (lineId: string, amountInr: number) => {
    const amountPaise = Math.max(0, Math.round(amountInr * 100));
    setCart((prev) =>
      prev.map((l) =>
        l.id === lineId
          ? {
              ...l,
              unit_price_paise: amountPaise,
              gross_paise: amountPaise,
              taxable_paise: amountPaise,
              line_total_paise: amountPaise,
            }
          : l
      )
    );
  };

  const handleDeleteLine = (lineId: string) => {
    setCart((prev) => prev.filter((l) => l.id !== lineId));
    showToast('Fee line item removed from bill.');
  };

  const handleAddCustomHead = () => {
    if (!customHeadName.trim()) {
      showToast('Please enter a description for the fee head.');
      return;
    }
    const amountPaise = Math.max(0, Math.round(Number(customHeadAmountInr || 0) * 100));
    const newLine: VerticalCartLine = {
      id: `fee_cust_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
      resource_id: 'res_cust',
      sku: 'FEE-CUSTOM',
      name: customHeadName.trim(),
      hsn_sac: '9992',
      unit: 'item',
      tax_rate_bps: 0,
      quantity_milli: 1000,
      unit_price_paise: amountPaise,
      discount_paise: 0,
      gross_paise: amountPaise,
      taxable_paise: amountPaise,
      cgst_paise: 0,
      sgst_paise: 0,
      igst_paise: 0,
      line_total_paise: amountPaise,
    };
    setCart((prev) => [...prev, newLine]);
    setCustomHeadName('');
    setCustomHeadAmountInr('');
    setShowAddCustomHead(false);
    showToast(`Added custom fee head: "${newLine.name}"`);
  };

  // Month-Wise Fee Rules Matrix Handlers (Tab 3: FEE_RULES)
  const rulesForSelectedClass = useMemo<MonthlyClassFeeRule[]>(() => {
    return monthlyFeeRules.filter(
      (r) => r.class_name.toLowerCase() === selectedRuleClass.toLowerCase()
    );
  }, [monthlyFeeRules, selectedRuleClass]);

  const handleUpdateClassMonthRule = (
    month: AcademicMonth,
    field: keyof MonthlyClassFeeRule,
    valuePaise: number
  ) => {
    setMonthlyFeeRules((prev) =>
      prev.map((r) => {
        if (
          r.class_name.toLowerCase() === selectedRuleClass.toLowerCase() &&
          r.month === month
        ) {
          const updated = { ...r, [field]: valuePaise };
          updated.total_paise =
            updated.tuition_paise +
            updated.computer_lab_paise +
            updated.sports_activity_paise +
            updated.exam_paise +
            updated.transport_paise +
            updated.annual_charge_paise;
          return updated;
        }
        return r;
      })
    );
  };

  const handleCopyMonthToAll = (sourceMonth: AcademicMonth) => {
    const source = rulesForSelectedClass.find((r) => r.month === sourceMonth);
    if (!source) return;

    setMonthlyFeeRules((prev) =>
      prev.map((r) => {
        if (r.class_name.toLowerCase() === selectedRuleClass.toLowerCase()) {
          const isApr = r.month === 'Apr';
          const isExamMonth = r.month === 'Sep' || r.month === 'Feb' || r.month === 'Mar';
          const annualCharge = isApr ? r.annual_charge_paise || source.annual_charge_paise : 0;
          const examFee = isExamMonth ? r.exam_paise || source.exam_paise : 0;

          const total =
            source.tuition_paise +
            source.computer_lab_paise +
            source.sports_activity_paise +
            examFee +
            source.transport_paise +
            annualCharge;

          return {
            ...r,
            tuition_paise: source.tuition_paise,
            computer_lab_paise: source.computer_lab_paise,
            sports_activity_paise: source.sports_activity_paise,
            transport_paise: source.transport_paise,
            exam_paise: examFee,
            annual_charge_paise: annualCharge,
            total_paise: total,
          };
        }
        return r;
      })
    );
    showToast(`Copied ${sourceMonth} rates to all 12 months of ${selectedRuleClass}!`);
  };

  const handleResetClassRules = () => {
    SchoolDataService.resetClassFeeRules(selectedRuleClass);
    setMonthlyFeeRules(SchoolDataService.getMonthlyFeeRules());
    showToast(`Reset ${selectedRuleClass} fee rules to standard curriculum defaults!`);
  };

  const handleSaveMonthlyFeeRules = () => {
    SchoolDataService.saveMonthlyFeeRules(monthlyFeeRules);
    showToast(`All Class-Wise & Month-Wise Fee Rules saved successfully!`);
  };

  // Analytics Metrics
  const defaultersList = useMemo(() => SchoolDataService.getDefaulters(6), [students, monthlyFeeRules]);

  // Filtered payment records for Reports Tab
  const filteredPaymentRecords = useMemo(() => {
    let list = paymentRecords;
    if (reportClassFilter !== 'ALL') {
      list = list.filter((r) => r.class_name.toLowerCase() === reportClassFilter.toLowerCase());
    }
    if (reportStaffFilter !== 'ALL') {
      list = list.filter((r) => (r.staff_name || '').toLowerCase() === reportStaffFilter.toLowerCase());
    }
    if (reportDateRange === 'TODAY') {
      const today = new Date().toISOString().split('T')[0];
      list = list.filter((r) => r.date === today);
    } else if (reportDateRange === 'WEEK') {
      const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
      list = list.filter((r) => r.date >= sevenDaysAgo);
    } else if (reportDateRange === 'MONTH') {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
      list = list.filter((r) => r.date >= thirtyDaysAgo);
    }
    return list;
  }, [paymentRecords, reportClassFilter, reportStaffFilter, reportDateRange]);

  // Report Actions (Print, WhatsApp, CSV, Clipboard)
  const handlePrintReport = () => {
    window.print();
  };

  const handleShareWhatsAppReport = () => {
    const summary = {
      totalPaise: filteredPaymentRecords.reduce((acc, r) => acc + r.net_amount_paise, 0),
      count: filteredPaymentRecords.length,
      cashPaise: filteredPaymentRecords.filter((r) => r.payment_mode === 'CASH').reduce((acc, r) => acc + r.net_amount_paise, 0),
      upiPaise: filteredPaymentRecords.filter((r) => r.payment_mode === 'UPI').reduce((acc, r) => acc + r.net_amount_paise, 0),
      bankPaise: filteredPaymentRecords.filter((r) => r.payment_mode !== 'CASH' && r.payment_mode !== 'UPI').reduce((acc, r) => acc + r.net_amount_paise, 0),
      dateStr: new Date().toISOString().split('T')[0],
    };
    const link = generateCollectionWhatsAppLink(summary);
    window.open(link, '_blank');
  };

  const handleExportCSVReport = () => {
    exportFeeRecordsToCSV(filteredPaymentRecords);
    showToast('Fee collection CSV report downloaded successfully!');
  };

  const handleCopySummaryReport = () => {
    const totalPaise = filteredPaymentRecords.reduce((acc, r) => acc + r.net_amount_paise, 0);
    const text = `ST. XAVIER ACADEMY - FEE COLLECTION SUMMARY (${new Date().toLocaleDateString()})
Total Receipts: ${filteredPaymentRecords.length}
Total Net Collected: ${formatPaise(totalPaise)}
Cash: ${formatPaise(filteredPaymentRecords.filter((r) => r.payment_mode === 'CASH').reduce((acc, r) => acc + r.net_amount_paise, 0))}
UPI: ${formatPaise(filteredPaymentRecords.filter((r) => r.payment_mode === 'UPI').reduce((acc, r) => acc + r.net_amount_paise, 0))}
Bank: ${formatPaise(filteredPaymentRecords.filter((r) => r.payment_mode !== 'CASH' && r.payment_mode !== 'UPI').reduce((acc, r) => acc + r.net_amount_paise, 0))}`;
    navigator.clipboard.writeText(text);
    showToast('Summary copied to clipboard!');
  };

  const handlePrintDefaulters = () => {
    window.print();
  };

  const handleExportDefaultersCSV = () => {
    exportDefaultersToCSV(defaultersList);
    showToast('Defaulters register CSV downloaded successfully!');
  };

  // Filtered Students by Master Key, Name, or Roll No
  const filteredStudents = useMemo(() => {
    let list = students;
    if (classFilter !== 'ALL') {
      list = list.filter((s) => s.class_name === classFilter);
    }
    const q = masterSearchQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (s) =>
        s.admission_no.toLowerCase().includes(q) ||
        s.full_name.toLowerCase().includes(q) ||
        s.roll_no.toLowerCase().includes(q) ||
        (s.guardian_phone && s.guardian_phone.includes(q))
    );
  }, [students, classFilter, masterSearchQuery]);

  // Month Selection Toggle
  const toggleMonth = (month: AcademicMonth) => {
    setSelectedMonths((prev) => {
      if (prev.includes(month)) {
        if (prev.length === 1) return prev; // Keep at least one
        return prev.filter((m) => m !== month);
      } else {
        return [...prev, month];
      }
    });
  };

  // Select Quick Month Presets
  const handleSelectNextUnpaidMonth = () => {
    if (!selectedStudent) return;
    const paid = selectedStudent.paid_months || [];
    const nextUnpaid = ACADEMIC_MONTHS.find((m) => !paid.includes(m));
    if (nextUnpaid) {
      setSelectedMonths([nextUnpaid]);
      showToast(`Selected next due month: ${nextUnpaid}`);
    } else {
      showToast('All 12 academic months are already paid for this student!');
    }
  };

  const handleSelectQuarter = () => {
    if (!selectedStudent) return;
    const paid = selectedStudent.paid_months || [];
    const unpaid = ACADEMIC_MONTHS.filter((m) => !paid.includes(m));
    if (unpaid.length > 0) {
      setSelectedMonths(unpaid.slice(0, 3));
      showToast(`Selected next 3 due months: ${unpaid.slice(0, 3).join(', ')}`);
    }
  };

  const handleSelectAllRemaining = () => {
    if (!selectedStudent) return;
    const paid = selectedStudent.paid_months || [];
    const unpaid = ACADEMIC_MONTHS.filter((m) => !paid.includes(m));
    if (unpaid.length > 0) {
      setSelectedMonths(unpaid);
      showToast(`Selected all ${unpaid.length} remaining due months!`);
    } else {
      showToast('No remaining dues!');
    }
  };

  // Subtotal Calculation
  const subtotalFeesPaise = useMemo(() => {
    return cart.reduce((acc, l) => acc + l.line_total_paise, 0);
  }, [cart]);

  // Recalculate Concession
  useEffect(() => {
    if (concessionType === 'MERIT_10') {
      setConcessionPaise(Math.round(subtotalFeesPaise * 0.1));
    } else if (concessionType === 'SIBLING_15') {
      setConcessionPaise(Math.round(subtotalFeesPaise * 0.15));
    } else if (concessionType === 'STAFF_25') {
      setConcessionPaise(Math.round(subtotalFeesPaise * 0.25));
    } else if (concessionType === 'CUSTOM') {
      setConcessionPaise(customDiscountPaise);
    } else {
      setConcessionPaise(0);
    }
  }, [concessionType, subtotalFeesPaise, customDiscountPaise]);

  const netVoucherTotalPaise = Math.max(0, subtotalFeesPaise - concessionPaise + lateFeePaise);

  // Register New Student
  const handleRegisterStudent = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFullName.trim() || !newRollNo.trim()) return;

    const student: StudentEntity = {
      id: `ent_std_${Date.now()}`,
      entity_code: `STD-${newAdmissionNo.trim()}`,
      entity_type: 'STUDENT',
      full_name: newFullName.trim(),
      roll_no: newRollNo.trim(),
      class_name: newClass,
      section: newSection,
      academic_year: academicYear,
      guardian_name: newGuardianName.trim() || 'Parent/Guardian',
      guardian_phone: newGuardianPhone.trim(),
      admission_no: newAdmissionNo.trim(),
      state_code: '27',
      is_active: true,
      dues_balance_paise: 12 * (currentClassRule.total_monthly_paise || 500000),
      paid_months: [],
      monthly_fee_paise: currentClassRule.total_monthly_paise,
      address: newAddress.trim() || 'Pune, Maharashtra',
    };

    SchoolDataService.addStudent(student);
    refreshAllData();
    setSelectedStudentId(student.id);
    setShowNewStudentModal(false);
    showToast(`Enrolled student ${student.full_name} (${student.admission_no})!`);

    // Reset Form
    setNewFullName('');
    setNewRollNo('');
    setNewGuardianName('');
    setNewGuardianPhone('');
    setNewAddress('');
    setNewAdmissionNo(`ADM-2026-${Math.floor(100 + Math.random() * 900)}`);
  };

  // Post Fee Voucher & Record Payment
  const handlePostFeeVoucher = () => {
    if (cart.length === 0 || !selectedStudent) return;

    const seq = paymentRecords.length + 1001;
    const receiptNo = `SCH-26-${seq}`;
    const now = new Date();

    const record = SchoolDataService.recordPayment({
      receipt_no: receiptNo,
      date: now.toISOString().split('T')[0],
      time: now.toTimeString().split(' ')[0],
      student_id: selectedStudent.id,
      admission_no: selectedStudent.admission_no,
      student_name: selectedStudent.full_name,
      class_name: selectedStudent.class_name,
      section: selectedStudent.section,
      academic_year: academicYear,
      months_paid: selectedMonths,
      fee_heads: cart.map((c) => ({ name: c.name, amount_paise: c.line_total_paise })),
      subtotal_paise: subtotalFeesPaise,
      concession_type: concessionType,
      concession_paise: concessionPaise,
      net_amount_paise: netVoucherTotalPaise,
      payment_mode: paymentMode,
      transaction_ref: paymentReference || `${paymentMode}-TXN-${Date.now().toString().slice(-6)}`,
      staff_name: activeStaffName,
      remarks: `Paid for months: ${selectedMonths.join(', ')}`,
    });

    // Update Student Record Paid Months
    SchoolDataService.updateStudentPaidMonths(
      selectedStudent.id,
      selectedMonths,
      currentClassRule.total_monthly_paise
    );

    refreshAllData();
    setLastReceipt(record);
    setShowVoucherModal(true);
    showToast(`Fee receipt #${receiptNo} generated for ${selectedStudent.full_name}!`);
  };

  // Add Operational Expense
  const handleAddExpense = (e: React.FormEvent) => {
    e.preventDefault();
    if (!expPayee.trim() || !expAmountInr) return;

    const amountPaise = parseRupeesToPaise(expAmountInr);
    SchoolDataService.addExpense({
      date: new Date().toISOString().split('T')[0],
      category: expCategory,
      payee_name: expPayee.trim(),
      amount_paise: amountPaise,
      payment_mode: expMode,
      voucher_no: expVoucherNo.trim(),
      remarks: expRemarks.trim(),
      created_by_staff: activeStaffName,
    });

    refreshAllData();
    setShowNewExpenseModal(false);
    setExpPayee('');
    setExpAmountInr('');
    setExpRemarks('');
    setExpVoucherNo(`EXP-${Date.now().toString().slice(-4)}`);
    showToast('School expense voucher recorded successfully!');
  };

  // 1-Click WhatsApp Reminder for Defaulter Parents
  const handleSendDefaulterWhatsApp = (
    guardianPhone: string,
    studentName: string,
    admissionNo: string,
    className: string,
    unpaidMonths: string[],
    overduePaise: number
  ) => {
    const rawPhone = guardianPhone.replace(/[^0-9]/g, '');
    const cleanPhone = rawPhone.length === 10 ? `91${rawPhone}` : rawPhone;

    const message =
`🔔 *FEE REMINDER - ${receiptSettings.school_name}*
----------------------------------------
Dear Parent/Guardian,
This is an official fee reminder regarding your ward:
👤 *Student:* ${studentName}
🆔 *Admission No:* ${admissionNo}
🏫 *Class:* ${className}
📅 *Overdue Months:* ${unpaidMonths.join(', ')} (${unpaidMonths.length} Months)
💰 *Total Pending Amount:* ₹${(overduePaise / 100).toFixed(2)}
----------------------------------------
Please deposit the pending dues at the school accounts desk or pay via online bank transfer / UPI.
Thank you for your cooperation!
Accounts Office, ${receiptSettings.school_name}`;

    if (cleanPhone.length >= 10) {
      window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`, '_blank');
      showToast(`Opened WhatsApp notice for +${cleanPhone}`);
    } else {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        navigator.clipboard.writeText(message);
        showToast('Reminder text copied to clipboard!');
      }
    }
  };

  // Send WhatsApp Receipt
  const handleSendReceiptWhatsApp = () => {
    if (!lastReceipt || !selectedStudent) return;
    const rawPhone = (selectedStudent.guardian_phone || '').replace(/[^0-9]/g, '');
    const cleanPhone = rawPhone.length === 10 ? `91${rawPhone}` : rawPhone;

    const text =
`🧾 *OFFICIAL FEE RECEIPT - ${receiptSettings.school_name}*
${receiptSettings.affiliation_details}
Receipt No: *#${lastReceipt.receipt_no}* | Date: ${lastReceipt.date} ${lastReceipt.time}
----------------------------------------
👤 *Student Name:* ${lastReceipt.student_name}
🆔 *Admission No:* ${lastReceipt.admission_no} (Class: ${lastReceipt.class_name}-${lastReceipt.section})
📅 *Months Paid:* ${lastReceipt.months_paid.join(', ')}
----------------------------------------
Subtotal: ₹${(lastReceipt.subtotal_paise / 100).toFixed(2)}
${lastReceipt.concession_paise > 0 ? `Concession: -₹${(lastReceipt.concession_paise / 100).toFixed(2)}\n` : ''}*TOTAL PAID: ₹${(lastReceipt.net_amount_paise / 100).toFixed(2)}*
💳 Mode: *${lastReceipt.payment_mode}* (Ref: ${lastReceipt.transaction_ref})
Officer: ${lastReceipt.staff_name}
----------------------------------------
${receiptSettings.receipt_terms}`;

    if (cleanPhone.length >= 10) {
      window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`, '_blank');
    } else {
      navigator.clipboard.writeText(text);
      showToast('Receipt copied to clipboard!');
    }
  };

  // Analytics Metrics
  const dateWiseCollections = useMemo(() => SchoolDataService.getDateWiseCollection(), [paymentRecords]);
  const classWiseCollections = useMemo(() => SchoolDataService.getClassWiseCollection(), [paymentRecords, students]);
  const staffWiseCollections = useMemo(() => SchoolDataService.getStaffWiseCollection(), [paymentRecords]);

  const totalFeeCollectedPaise = paymentRecords.reduce((acc, p) => acc + p.net_amount_paise, 0);
  const totalExpensesPaise = expenses.reduce((acc, e) => acc + e.amount_paise, 0);
  const totalOverduePaise = defaultersList.reduce((acc, d) => acc + d.overduePaise, 0);

  return (
    <div className="flex flex-col h-full w-full bg-slate-950 text-slate-100 overflow-hidden select-none">
      {/* TOP BAR: School Brand & Feature Tab Switcher */}
      <div className="bg-slate-900 border-b border-slate-800 p-3 shadow-md flex flex-col md:flex-row items-start md:items-center justify-between gap-3 shrink-0">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-600 to-yellow-500 flex items-center justify-center text-white shadow-md shadow-amber-500/20 shrink-0">
            <GraduationCap className="w-5 h-5 fill-current" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-sm md:text-base font-extrabold tracking-tight text-white">
                {receiptSettings.school_name}
              </h1>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                School ERP Suite
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Session: <span className="font-mono text-slate-200">{academicYear}</span> • Staff:{' '}
              <span className="text-amber-400">{activeStaffName}</span>
            </p>
          </div>
        </div>

        {/* 6 Core Functional Tabs */}
        <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 gap-1 overflow-x-auto max-w-full">
          <button
            onClick={() => setActiveTab('BILLING')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center space-x-1.5 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'BILLING'
                ? 'bg-amber-600 text-white shadow-sm shadow-amber-600/40'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Receipt className="w-3.5 h-3.5" />
            <span>Fee Billing</span>
          </button>

          <button
            onClick={() => setActiveTab('DEFAULTERS')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center space-x-1.5 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'DEFAULTERS'
                ? 'bg-rose-600 text-white shadow-sm shadow-rose-600/40'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
            <span>Defaulters ({defaultersList.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('FEE_RULES')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center space-x-1.5 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'FEE_RULES'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Class Fee Presets</span>
          </button>

          <button
            onClick={() => setActiveTab('EXPENSES')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center space-x-1.5 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'EXPENSES'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Wallet className="w-3.5 h-3.5" />
            <span>Expenses</span>
          </button>

          <button
            onClick={() => setActiveTab('REPORTS')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center space-x-1.5 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'REPORTS'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            <span>Analytics & Audit</span>
          </button>

          <button
            onClick={() => setActiveTab('RECEIPT_SETTINGS')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center space-x-1.5 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'RECEIPT_SETTINGS'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Settings className="w-3.5 h-3.5" />
            <span>Receipt Customizer</span>
          </button>
        </div>
      </div>

      {/* ---------------------------------------------------------------------
          TAB 1: FEE COLLECTION & 12-MONTH BILLING GRID
          --------------------------------------------------------------------- */}
      {activeTab === 'BILLING' && (
        <div className="flex-1 overflow-y-auto min-h-0 p-3 md:p-4 space-y-4">
          {/* Top Section: Master Key Student Search & Student Profile Card */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Student Search & Master Key Selector */}
            <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
                <div className="flex items-center space-x-2">
                  <UserCheck className="w-4 h-4 text-amber-400" />
                  <h2 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                    Student Record Master Selector
                  </h2>
                </div>
                <button
                  onClick={() => setShowNewStudentModal(true)}
                  className="px-2.5 py-1 bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/30 rounded-lg text-xs font-semibold flex items-center space-x-1 transition cursor-pointer self-start sm:self-auto"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Enroll New Student</span>
                </button>
              </div>

              {/* Two-Way Smart Auto-Fill & Search Hub */}
              <div className="space-y-2.5">
                {/* 3 Interconnected Search & Auto-Catch Controls */}
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 text-xs">
                  {/* 1. Master Key (Admission No) */}
                  <div className="sm:col-span-4 relative">
                    <label className="text-[10px] text-amber-400 font-bold block mb-0.5 uppercase tracking-wider flex items-center space-x-1">
                      <Hash className="w-3 h-3 text-amber-400" />
                      <span>Master Key (Adm No):</span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. ADM-2020-044"
                      value={masterSearchQuery}
                      onChange={(e) => handleMasterKeyChange(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-slate-950 border border-amber-500/60 rounded-xl text-xs text-amber-300 font-mono font-bold placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-amber-500"
                    />
                  </div>

                  {/* 2. Student Name / Phone Search */}
                  <div className="sm:col-span-4 relative">
                    <label className="text-[10px] text-slate-400 font-bold block mb-0.5 uppercase tracking-wider flex items-center space-x-1">
                      <Search className="w-3 h-3 text-slate-400" />
                      <span>Student Name / Phone:</span>
                    </label>
                    <input
                      type="text"
                      placeholder="Type name (e.g. Rohan, Aarav)..."
                      value={nameSearchQuery}
                      onChange={(e) => handleNameOrPhoneSearch(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-600 focus:outline-none focus:border-amber-500"
                    />
                  </div>

                  {/* 3. Class + Section + Roll Auto-Catch */}
                  <div className="sm:col-span-4">
                    <label className="text-[10px] text-cyan-400 font-bold block mb-0.5 uppercase tracking-wider flex items-center space-x-1">
                      <Sparkles className="w-3 h-3 text-cyan-400" />
                      <span>Class / Sec / Roll Auto-Catch:</span>
                    </label>
                    <div className="grid grid-cols-3 gap-1">
                      <select
                        value={classFilter}
                        onChange={(e) => handleClassSectionRollSelect(e.target.value, sectionFilter, rollFilter)}
                        className="px-1.5 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-[11px] text-slate-200"
                      >
                        <option value="ALL">All Cls</option>
                        {SCHOOL_CLASSES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>

                      <select
                        value={sectionFilter}
                        onChange={(e) => handleClassSectionRollSelect(classFilter, e.target.value, rollFilter)}
                        className="px-1.5 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-[11px] text-slate-200"
                      >
                        <option value="ALL">Sec: All</option>
                        <option value="A">Sec A</option>
                        <option value="B">Sec B</option>
                        <option value="C">Sec C</option>
                      </select>

                      <input
                        type="text"
                        placeholder="Roll..."
                        value={rollFilter}
                        onChange={(e) => handleClassSectionRollSelect(classFilter, sectionFilter, e.target.value)}
                        className="px-1.5 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-[11px] text-slate-200 font-mono text-center"
                      />
                    </div>
                  </div>
                </div>

                {/* All-in-One Master Student Roster Dropdown */}
                <div>
                  <div className="flex items-center justify-between mb-0.5 text-[10px]">
                    <span className="text-slate-400 font-semibold uppercase">
                      Select From Master Student Directory ({filteredStudents.length} Students):
                    </span>
                    <span className="text-amber-400 font-mono">
                      Active Adm No: {selectedStudent?.admission_no}
                    </span>
                  </div>
                  <select
                    value={selectedStudentId}
                    onChange={(e) => {
                      const match = students.find((s) => s.id === e.target.value);
                      if (match) syncStudentInputs(match);
                    }}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-amber-200 font-mono font-medium focus:outline-none focus:border-amber-500 cursor-pointer"
                  >
                    {filteredStudents.map((s) => (
                      <option key={s.id} value={s.id}>
                        [{s.admission_no}] {s.full_name} — {s.class_name}-{s.section} (Roll: {s.roll_no}) — Dues:{' '}
                        {formatPaise(s.dues_balance_paise)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Comprehensive Student Details Card */}
              {selectedStudent && (
                <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800 text-xs space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-1.5">
                    <div className="flex items-center space-x-2">
                      <span className="font-extrabold text-sm text-amber-300">
                        {selectedStudent.full_name}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono text-[10px] font-bold border border-amber-500/30">
                        Master Key: {selectedStudent.admission_no}
                      </span>
                    </div>
                    <div className="flex items-center space-x-2 font-mono text-[11px]">
                      <span className="text-slate-400">Class:</span>
                      <span className="text-white font-bold">{selectedStudent.class_name}-{selectedStudent.section}</span>
                      <span className="text-slate-500">|</span>
                      <span className="text-slate-400">Roll:</span>
                      <span className="text-slate-200">{selectedStudent.roll_no}</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] text-slate-300 pt-0.5">
                    <div>
                      <span className="text-slate-500 block text-[10px]">Guardian / Contact:</span>
                      <span>{selectedStudent.guardian_name} ({selectedStudent.guardian_phone})</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[10px]">Fee Status:</span>
                      <span className="font-semibold text-emerald-400">
                        {(selectedStudent.paid_months || []).length} Mos Paid
                      </span>{' '}
                      •{' '}
                      <span className="font-semibold text-rose-400">
                        {12 - (selectedStudent.paid_months || []).length} Mos Due
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[10px]">Address:</span>
                      <span className="truncate block" title={selectedStudent.address}>
                        {selectedStudent.address || 'Pune, MH'}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Academic Session & Staff Quick Info Card */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md flex flex-col justify-between space-y-3">
              <div className="space-y-2">
                <div className="flex items-center space-x-2 border-b border-slate-800 pb-2">
                  <Calendar className="w-4 h-4 text-amber-400" />
                  <h3 className="text-xs font-bold uppercase text-slate-200">Academic Session</h3>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-0.5">Session Year:</label>
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
                    <label className="text-[10px] text-slate-400 block mb-0.5">Staff Cashier:</label>
                    <select
                      value={activeStaffName}
                      onChange={(e) => setActiveStaffName(e.target.value)}
                      className="w-full px-2 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-amber-300 font-medium text-[11px]"
                    >
                      <option value="Mrs. Sunita Rao (Counter 1)">Sunita Rao (C-1)</option>
                      <option value="Mr. Amit Shah (Counter 2)">Amit Shah (C-2)</option>
                      <option value="Admin Office Head">Admin Office Head</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-[10px] text-slate-400 block mb-0.5">Concession / Waiver:</label>
                  <select
                    value={concessionType}
                    onChange={(e) => setConcessionType(e.target.value)}
                    className="w-full px-2 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-200 font-medium"
                  >
                    <option value="NONE">No Concession (100% Full Fee)</option>
                    <option value="MERIT_10">Merit Scholarship (10% Waiver)</option>
                    <option value="SIBLING_15">Sibling Discount (15% Waiver)</option>
                    <option value="STAFF_25">Staff Ward Concession (25% Waiver)</option>
                    <option value="CUSTOM">Custom Flat Amount Discount</option>
                  </select>
                  {concessionType === 'CUSTOM' && (
                    <input
                      type="number"
                      placeholder="Enter flat discount in ₹"
                      value={customDiscountPaise / 100 || ''}
                      onChange={(e) => setCustomDiscountPaise(Math.max(0, Number(e.target.value) * 100))}
                      className="w-full mt-1 px-2 py-1 bg-slate-950 border border-slate-700 rounded text-xs text-amber-300 font-mono"
                    />
                  )}
                </div>
              </div>

              {/* Preset Rate for Selected Student's Class */}
              <div className="bg-slate-950/90 p-2.5 rounded-xl border border-slate-800 text-[11px] space-y-1">
                <div className="flex justify-between text-slate-400">
                  <span>Class Preset Rate:</span>
                  <span className="font-mono font-bold text-amber-400">
                    {formatPaise(currentClassRule.total_monthly_paise)} / mo
                  </span>
                </div>
                <div className="text-[10px] text-slate-500">
                  Includes Tuition, Lab, Sports, Assessment & Bus
                </div>
              </div>
            </div>
          </div>

          {/* 12-MONTH BILLING CALENDAR GRID (Paid vs Due vs Selected) */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
              <div className="flex items-center space-x-2">
                <Calendar className="w-4 h-4 text-amber-400" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                  Academic Year Month-Wise Fee Status (Apr 2026 - Mar 2027)
                </h3>
              </div>

              {/* Quick Select Buttons */}
              <div className="flex items-center space-x-1.5 overflow-x-auto text-[11px]">
                <button
                  type="button"
                  onClick={handleSelectNextUnpaidMonth}
                  className="px-2.5 py-1 bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/30 rounded-lg font-semibold whitespace-nowrap cursor-pointer"
                >
                  Next Due Month
                </button>
                <button
                  type="button"
                  onClick={handleSelectQuarter}
                  className="px-2.5 py-1 bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 rounded-lg font-semibold whitespace-nowrap cursor-pointer"
                >
                  Quarter (3 Mos)
                </button>
                <button
                  type="button"
                  onClick={handleSelectAllRemaining}
                  className="px-2.5 py-1 bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/30 rounded-lg font-semibold whitespace-nowrap cursor-pointer"
                >
                  All Remaining
                </button>
              </div>
            </div>

            {/* 12-Month Interactive Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-12 gap-2">
              {ACADEMIC_MONTHS.map((month) => {
                const paidList = selectedStudent?.paid_months || [];
                const isPaid = paidList.includes(month);
                const isSelected = selectedMonths.includes(month);

                return (
                  <div
                    key={month}
                    onClick={() => {
                      if (!isPaid) toggleMonth(month);
                    }}
                    className={`p-2.5 rounded-xl border flex flex-col justify-between transition-all select-none ${
                      isPaid
                        ? 'bg-emerald-950/20 border-emerald-500/40 text-emerald-300 cursor-not-allowed opacity-80'
                        : isSelected
                        ? 'bg-amber-500/20 border-amber-500 ring-2 ring-amber-500/40 text-white cursor-pointer shadow-md'
                        : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700 cursor-pointer'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-xs uppercase">{month}</span>
                      {isPaid ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {}} // Handled by parent div
                          className="rounded text-amber-500 focus:ring-0 cursor-pointer"
                        />
                      )}
                    </div>

                    <div className="text-[10px] font-mono">
                      {isPaid ? (
                        <span className="text-emerald-400 font-bold">PAID</span>
                      ) : isSelected ? (
                        <span className="text-amber-300 font-bold">SELECTED</span>
                      ) : (
                        <span className="text-rose-400">DUE</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Fee Heads Breakdown Table & Payment Settlement Panel */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Left: Fee Heads Breakdown (100% Fully Editable) */}
            <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-2">
                <div className="flex items-center space-x-2">
                  <BookOpen className="w-4 h-4 text-amber-400" />
                  <h3 className="text-xs font-bold uppercase text-slate-200">
                    Fee Heads Breakdown for Selected Months ({selectedMonths.join(', ')})
                  </h3>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 font-mono text-[10px] font-bold border border-emerald-500/30">
                    ✏️ Editable Final Bill
                  </span>
                  <span className="text-xs font-mono font-bold text-amber-400">
                    {selectedMonths.length} Months Selected
                  </span>
                </div>
              </div>

              {/* Editable Lines Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 text-[10px] uppercase font-bold">
                      <th className="pb-2">Particulars / Head Description (Click to Edit)</th>
                      <th className="pb-2 text-center w-16">Basis</th>
                      <th className="pb-2 text-right w-32">Amount (₹) (Editable)</th>
                      <th className="pb-2 text-center w-12">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono text-slate-200">
                    {cart.map((line) => (
                      <tr key={line.id} className="hover:bg-slate-800/30">
                        {/* Editable Name */}
                        <td className="py-1.5 pr-2">
                          <input
                            type="text"
                            value={line.name}
                            onChange={(e) => handleUpdateLineName(line.id, e.target.value)}
                            className="w-full px-2 py-1 bg-slate-950 border border-slate-700/80 rounded font-sans font-medium text-white text-xs focus:outline-none focus:border-amber-500"
                            title="Edit fee description"
                          />
                        </td>

                        {/* Basis */}
                        <td className="py-1.5 text-center text-slate-400 text-[11px]">
                          {line.unit}
                        </td>

                        {/* Editable Amount */}
                        <td className="py-1.5 text-right">
                          <div className="flex items-center justify-end space-x-1">
                            <span className="text-slate-500 text-xs font-mono">₹</span>
                            <input
                              type="number"
                              step="1"
                              value={line.line_total_paise / 100}
                              onChange={(e) => handleUpdateLineAmount(line.id, Number(e.target.value))}
                              className="w-24 px-2 py-1 bg-slate-950 border border-slate-700/80 rounded font-bold font-mono text-amber-300 text-xs text-right focus:outline-none focus:border-amber-500"
                              title="Edit fee amount in ₹"
                            />
                          </div>
                        </td>

                        {/* Delete Line */}
                        <td className="py-1.5 text-center">
                          <button
                            type="button"
                            onClick={() => handleDeleteLine(line.id)}
                            className="p-1 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded transition cursor-pointer"
                            title="Remove this fee head"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Add Custom Fee Head Button & Form */}
              <div className="pt-2 border-t border-slate-800/80">
                {showAddCustomHead ? (
                  <div className="bg-slate-950 p-2.5 rounded-xl border border-amber-500/40 space-y-2">
                    <div className="text-[11px] font-bold text-amber-300">Add Custom Fee Head to Bill:</div>
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 text-xs">
                      <div className="sm:col-span-7">
                        <input
                          type="text"
                          placeholder="e.g. Uniform Set, Late Fine, Library Lost Book, ID Card..."
                          value={customHeadName}
                          onChange={(e) => setCustomHeadName(e.target.value)}
                          className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-white"
                        />
                      </div>
                      <div className="sm:col-span-3">
                        <input
                          type="number"
                          placeholder="Amount in ₹"
                          value={customHeadAmountInr}
                          onChange={(e) => setCustomHeadAmountInr(e.target.value)}
                          className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-amber-300 font-mono text-right"
                        />
                      </div>
                      <div className="sm:col-span-2 flex items-center space-x-1">
                        <button
                          type="button"
                          onClick={handleAddCustomHead}
                          className="w-full py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg font-bold text-xs cursor-pointer"
                        >
                          Add
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowAddCustomHead(false)}
                          className="p-1.5 text-slate-400 hover:text-white rounded-lg cursor-pointer"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setShowAddCustomHead(true)}
                      className="px-3 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition cursor-pointer self-start"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>+ Add Custom Fee Head (Late Fine, Uniform, ID Card, etc.)</span>
                    </button>
                    <span className="text-[11px] text-slate-500 italic">
                      All descriptions and amounts are editable before printing
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Right: Payment Tender & Generate Receipt */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md flex flex-col justify-between space-y-3">
              <div className="space-y-2.5">
                <div className="flex items-center space-x-2 border-b border-slate-800 pb-2">
                  <CreditCard className="w-4 h-4 text-amber-400" />
                  <h3 className="text-xs font-bold uppercase text-slate-200">Voucher Settlement</h3>
                </div>

                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between text-slate-400">
                    <span>Gross Fee Total:</span>
                    <span className="font-mono text-slate-200">{formatPaise(subtotalFeesPaise)}</span>
                  </div>

                  {concessionPaise > 0 && (
                    <div className="flex justify-between text-amber-400">
                      <span>Concession ({concessionType}):</span>
                      <span className="font-mono">-{formatPaise(concessionPaise)}</span>
                    </div>
                  )}

                  <div className="flex justify-between items-center text-slate-400 pt-1 border-t border-slate-800">
                    <span>Late Fee Penalty (Optional):</span>
                    <input
                      type="number"
                      placeholder="₹0"
                      value={lateFeePaise / 100 || ''}
                      onChange={(e) => setLateFeePaise(Math.max(0, Number(e.target.value) * 100))}
                      className="w-20 px-2 py-0.5 bg-slate-950 border border-slate-700 rounded text-right font-mono text-xs text-white"
                    />
                  </div>
                </div>

                {/* Net Total Box */}
                <div className="bg-slate-950 border-2 border-amber-500/40 rounded-xl p-3 shadow-inner">
                  <div className="text-[10px] font-bold text-amber-400 uppercase tracking-wider mb-0.5">
                    Net Payable Fee Amount
                  </div>
                  <div className="text-2xl font-black font-mono tracking-tight text-white">
                    {formatPaise(netVoucherTotalPaise)}
                  </div>
                </div>

                {/* Payment Tender Controls */}
                <div className="space-y-2 pt-1 text-xs">
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-0.5">Payment Instrument:</label>
                    <div className="grid grid-cols-2 gap-1.5">
                      {(['UPI', 'CASH', 'CHEQUE', 'BANK_TRANSFER'] as PaymentMode[]).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setPaymentMode(mode)}
                          className={`py-1.5 px-2 rounded-lg text-[11px] font-bold border transition-all cursor-pointer ${
                            paymentMode === mode
                              ? 'bg-amber-600 text-white border-amber-500 shadow-sm'
                              : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
                          }`}
                        >
                          {mode.replace('_', ' ')}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] text-slate-400 block mb-0.5">Transaction / Cheque Ref:</label>
                    <input
                      type="text"
                      placeholder="e.g. UPI-98214 / CHQ-10492"
                      value={paymentReference}
                      onChange={(e) => setPaymentReference(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs font-mono text-slate-200 placeholder-slate-600"
                    />
                  </div>
                </div>
              </div>

              {/* Action Button */}
              <button
                type="button"
                onClick={handlePostFeeVoucher}
                disabled={netVoucherTotalPaise <= 0 || !selectedStudent}
                className="w-full py-3 bg-gradient-to-r from-amber-600 to-yellow-600 hover:from-amber-500 hover:to-yellow-500 text-white rounded-xl font-bold text-xs flex items-center justify-center space-x-2 shadow-lg shadow-amber-600/30 transition-all cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>Generate Voucher & Print Slip</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------------
          TAB 2: DEFAULTERS TRACKING DASHBOARD & WHATSAPP REMINDERS
          --------------------------------------------------------------------- */}
      {activeTab === 'DEFAULTERS' && (
        <div className="flex-1 overflow-y-auto min-h-0 p-3 md:p-4 space-y-4">
          {/* Top Metric Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow">
              <div className="text-[11px] text-slate-400">Total Defaulter Students</div>
              <div className="text-2xl font-black text-rose-400 font-mono mt-1">
                {defaultersList.length} Students
              </div>
              <div className="text-[10px] text-slate-500 mt-1">Unpaid up to Oct 2026</div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow">
              <div className="text-[11px] text-slate-400">Total Overdue Dues Outstanding</div>
              <div className="text-2xl font-black text-amber-400 font-mono mt-1">
                {formatPaise(totalOverduePaise)}
              </div>
              <div className="text-[10px] text-slate-500 mt-1">Cumulative pending tuition & lab fees</div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow">
              <div className="text-[11px] text-slate-400">Session Collection Rate</div>
              <div className="text-2xl font-black text-emerald-400 font-mono mt-1">
                {students.length > 0
                  ? `${Math.round(((students.length - defaultersList.length) / students.length) * 100)}%`
                  : '100%'}
              </div>
              <div className="text-[10px] text-slate-500 mt-1">Enrolled: {students.length} students</div>
            </div>
          </div>

          {/* Defaulters Table */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
              <div className="flex items-center space-x-2">
                <ShieldAlert className="w-4 h-4 text-rose-400" />
                <h3 className="text-xs font-bold uppercase text-slate-200">
                  Overdue Fee Defaulters Roster & Direct WhatsApp Notice
                </h3>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={handlePrintDefaulters}
                  className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold flex items-center space-x-1 shadow transition cursor-pointer"
                  title="Print Defaulters Report"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print Defaulters</span>
                </button>
                <button
                  type="button"
                  onClick={handleExportDefaultersCSV}
                  className="px-3 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-bold flex items-center space-x-1 shadow transition cursor-pointer"
                  title="Export Defaulters CSV"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export CSV</span>
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 text-[10px] uppercase font-bold">
                    <th className="pb-2">Admission No</th>
                    <th className="pb-2">Student Name</th>
                    <th className="pb-2">Class</th>
                    <th className="pb-2">Guardian & Phone</th>
                    <th className="pb-2">Overdue Months</th>
                    <th className="pb-2 text-right">Total Due (₹)</th>
                    <th className="pb-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono text-slate-200">
                  {defaultersList.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-500 font-sans italic">
                        No fee defaulters found! All students are currently up to date.
                      </td>
                    </tr>
                  ) : (
                    defaultersList.map((d) => (
                      <tr key={d.student.id} className="hover:bg-slate-800/30">
                        <td className="py-2.5 text-amber-300 font-bold">{d.student.admission_no}</td>
                        <td className="py-2.5 font-sans font-semibold text-white">{d.student.full_name}</td>
                        <td className="py-2.5 text-slate-300">
                          {d.student.class_name}-{d.student.section}
                        </td>
                        <td className="py-2.5 font-sans text-slate-300">
                          <div>{d.student.guardian_name}</div>
                          <div className="text-[10px] text-slate-500 font-mono">{d.student.guardian_phone}</div>
                        </td>
                        <td className="py-2.5">
                          <div className="flex flex-wrap gap-1">
                            {d.unpaidMonths.map((m) => (
                              <span
                                key={m}
                                className="px-1.5 py-0.2 rounded text-[10px] bg-rose-500/20 text-rose-300 border border-rose-500/30"
                              >
                                {m}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="py-2.5 text-right font-bold text-rose-400">
                          {formatPaise(d.overduePaise)}
                        </td>
                        <td className="py-2.5 text-right">
                          <button
                            type="button"
                            onClick={() =>
                              handleSendDefaulterWhatsApp(
                                d.student.guardian_phone,
                                d.student.full_name,
                                d.student.admission_no,
                                d.student.class_name,
                                d.unpaidMonths,
                                d.overduePaise
                              )
                            }
                            className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-[11px] font-bold inline-flex items-center space-x-1 shadow transition cursor-pointer"
                            title="Send WhatsApp Fee Reminder"
                          >
                            <MessageCircle className="w-3.5 h-3.5" />
                            <span>Remind</span>
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------------
          TAB 3: CLASS-WISE & MONTH-WISE FEE RULES PRESET CONFIGURATOR
          --------------------------------------------------------------------- */}
      {activeTab === 'FEE_RULES' && (
        <div className="flex-1 overflow-y-auto min-h-0 p-3 md:p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md space-y-4">
          {/* Header & Controls */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-800 pb-3">
            <div>
              <h3 className="text-sm font-bold text-slate-100 flex items-center space-x-2">
                <Sliders className="w-4 h-4 text-amber-400" />
                <span>Class-Wise & Month-Wise Fee Preset Engine (12-Month Matrix)</span>
              </h3>
              <p className="text-[11px] text-slate-400">
                Every class has distinct fees across each of the 12 academic months (Apr to Mar). E.g. Annual charges in April, Exam assessments in September/March, and Winter fest in December.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Select Active Class */}
              <div className="flex items-center space-x-2 bg-slate-950 px-2.5 py-1 rounded-xl border border-amber-500/40">
                <span className="text-[11px] text-slate-400 font-bold uppercase">Class:</span>
                <select
                  value={selectedRuleClass}
                  onChange={(e) => setSelectedRuleClass(e.target.value)}
                  className="bg-transparent text-xs font-bold text-amber-300 focus:outline-none cursor-pointer"
                >
                  {SCHOOL_CLASSES.map((c) => (
                    <option key={c} value={c} className="bg-slate-900 text-white">
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                onClick={() => handleCopyMonthToAll('Apr')}
                className="px-3 py-1.5 bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 rounded-xl text-xs font-semibold transition cursor-pointer"
                title="Copy April base rates to all 12 months for this class"
              >
                Copy Apr Base to All
              </button>

              <button
                type="button"
                onClick={handleResetClassRules}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold border border-slate-700 transition cursor-pointer"
              >
                Reset to Defaults
              </button>

              <button
                type="button"
                onClick={handleSaveMonthlyFeeRules}
                className="px-4 py-1.5 bg-gradient-to-r from-amber-600 to-yellow-600 hover:from-amber-500 hover:to-yellow-500 text-white rounded-xl text-xs font-bold shadow-md shadow-amber-600/30 transition cursor-pointer"
              >
                Save All Fee Rules
              </button>
            </div>
          </div>

          {/* 12-Month Table for Selected Class */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 text-[10px] uppercase font-bold">
                  <th className="pb-2 w-28">Month</th>
                  <th className="pb-2 text-right">Tuition Fee (₹)</th>
                  <th className="pb-2 text-right">Computer/Lab (₹)</th>
                  <th className="pb-2 text-right">Sports/Activity (₹)</th>
                  <th className="pb-2 text-right">Exam Prep (₹)</th>
                  <th className="pb-2 text-right">Bus Transport (₹)</th>
                  <th className="pb-2 text-right">Annual/Term Charge (₹)</th>
                  <th className="pb-2 text-right text-amber-400 font-black">Month Total (₹)</th>
                  <th className="pb-2 text-center w-24">Copy Month</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-200">
                {rulesForSelectedClass.map((rule) => {
                  const isApr = rule.month === 'Apr';
                  const isSep = rule.month === 'Sep';
                  const isDec = rule.month === 'Dec';
                  const isFeb = rule.month === 'Feb';
                  const isMar = rule.month === 'Mar';

                  return (
                    <tr key={rule.month} className="hover:bg-slate-800/30">
                      {/* Month Column with Badge */}
                      <td className="py-2.5 font-sans">
                        <div className="flex items-center space-x-1.5">
                          <span className="font-bold text-amber-300 text-xs uppercase">{rule.month}</span>
                          {isApr && (
                            <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                              Annual
                            </span>
                          )}
                          {(isSep || isFeb || isMar) && (
                            <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30">
                              Exam
                            </span>
                          )}
                          {isDec && (
                            <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30">
                              Fest
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Tuition */}
                      <td className="py-2 text-right">
                        <input
                          type="number"
                          value={rule.tuition_paise / 100}
                          onChange={(e) =>
                            handleUpdateClassMonthRule(
                              rule.month as AcademicMonth,
                              'tuition_paise',
                              Number(e.target.value) * 100
                            )
                          }
                          className="w-20 px-2 py-1 bg-slate-950 border border-slate-700 rounded text-right text-white font-mono text-xs focus:border-amber-500"
                        />
                      </td>

                      {/* Computer & Lab */}
                      <td className="py-2 text-right">
                        <input
                          type="number"
                          value={rule.computer_lab_paise / 100}
                          onChange={(e) =>
                            handleUpdateClassMonthRule(
                              rule.month as AcademicMonth,
                              'computer_lab_paise',
                              Number(e.target.value) * 100
                            )
                          }
                          className="w-20 px-2 py-1 bg-slate-950 border border-slate-700 rounded text-right text-white font-mono text-xs focus:border-amber-500"
                        />
                      </td>

                      {/* Sports & Activity */}
                      <td className="py-2 text-right">
                        <input
                          type="number"
                          value={rule.sports_activity_paise / 100}
                          onChange={(e) =>
                            handleUpdateClassMonthRule(
                              rule.month as AcademicMonth,
                              'sports_activity_paise',
                              Number(e.target.value) * 100
                            )
                          }
                          className="w-20 px-2 py-1 bg-slate-950 border border-slate-700 rounded text-right text-white font-mono text-xs focus:border-amber-500"
                        />
                      </td>

                      {/* Exam Prep */}
                      <td className="py-2 text-right">
                        <input
                          type="number"
                          value={rule.exam_paise / 100}
                          onChange={(e) =>
                            handleUpdateClassMonthRule(
                              rule.month as AcademicMonth,
                              'exam_paise',
                              Number(e.target.value) * 100
                            )
                          }
                          className="w-20 px-2 py-1 bg-slate-950 border border-slate-700 rounded text-right text-white font-mono text-xs focus:border-amber-500"
                        />
                      </td>

                      {/* Bus Transport */}
                      <td className="py-2 text-right">
                        <input
                          type="number"
                          value={rule.transport_paise / 100}
                          onChange={(e) =>
                            handleUpdateClassMonthRule(
                              rule.month as AcademicMonth,
                              'transport_paise',
                              Number(e.target.value) * 100
                            )
                          }
                          className="w-20 px-2 py-1 bg-slate-950 border border-slate-700 rounded text-right text-white font-mono text-xs focus:border-amber-500"
                        />
                      </td>

                      {/* Annual / Term Charge */}
                      <td className="py-2 text-right">
                        <input
                          type="number"
                          value={rule.annual_charge_paise / 100}
                          onChange={(e) =>
                            handleUpdateClassMonthRule(
                              rule.month as AcademicMonth,
                              'annual_charge_paise',
                              Number(e.target.value) * 100
                            )
                          }
                          className="w-20 px-2 py-1 bg-slate-950 border border-slate-700 rounded text-right text-amber-300 font-mono text-xs focus:border-amber-500"
                        />
                      </td>

                      {/* Month Total */}
                      <td className="py-2 text-right font-black text-amber-400">
                        {formatPaise(rule.total_paise)}
                      </td>

                      {/* Copy Action */}
                      <td className="py-2 text-center">
                        <button
                          type="button"
                          onClick={() => handleCopyMonthToAll(rule.month as AcademicMonth)}
                          className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded text-[10px] font-sans transition cursor-pointer"
                          title={`Copy ${rule.month} values to all months`}
                        >
                          Copy All
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Bottom Summary Bar for Active Class */}
          <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div className="flex items-center space-x-2">
              <span className="text-slate-400">Active Curriculum:</span>
              <span className="font-bold text-white">{selectedRuleClass} (Full 12 Academic Months)</span>
            </div>

            <div className="flex items-center space-x-4">
              <div>
                <span className="text-slate-400 block text-[10px]">Monthly Average:</span>
                <span className="font-mono font-bold text-slate-200">
                  {formatPaise(
                    Math.round(
                      rulesForSelectedClass.reduce((acc, r) => acc + r.total_paise, 0) /
                        (rulesForSelectedClass.length || 1)
                    )
                  )}
                  /mo
                </span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px]">Total Annual Fees:</span>
                <span className="font-mono font-black text-amber-400 text-sm">
                  {formatPaise(rulesForSelectedClass.reduce((acc, r) => acc + r.total_paise, 0))}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
      )}

      {/* ---------------------------------------------------------------------
          TAB 4: SCHOOL OPERATIONAL EXPENSES
          --------------------------------------------------------------------- */}
      {activeTab === 'EXPENSES' && (
        <div className="flex-1 overflow-y-auto min-h-0 p-3 md:p-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow">
              <div className="text-[11px] text-slate-400">Total School Expenses (MTD)</div>
              <div className="text-2xl font-black text-rose-400 font-mono mt-1">
                {formatPaise(totalExpensesPaise)}
              </div>
              <div className="text-[10px] text-slate-500 mt-1">{expenses.length} vouchers recorded</div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow">
              <div className="text-[11px] text-slate-400">Total Fee Collections (MTD)</div>
              <div className="text-2xl font-black text-emerald-400 font-mono mt-1">
                {formatPaise(totalFeeCollectedPaise)}
              </div>
              <div className="text-[10px] text-slate-500 mt-1">{paymentRecords.length} fee receipts</div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow">
              <div className="text-[11px] text-slate-400">Net Operating Surplus</div>
              <div className="text-2xl font-black text-amber-400 font-mono mt-1">
                {formatPaise(Math.max(0, totalFeeCollectedPaise - totalExpensesPaise))}
              </div>
              <div className="text-[10px] text-slate-500 mt-1">Fee Receipts − Operational Expenses</div>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
              <div className="flex items-center space-x-2">
                <Wallet className="w-4 h-4 text-rose-400" />
                <h3 className="text-xs font-bold uppercase text-slate-200">
                  School Expenditure Ledger & Voucher Records
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowNewExpenseModal(true)}
                className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold flex items-center space-x-1.5 shadow transition cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Record Expense</span>
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 text-[10px] uppercase font-bold">
                    <th className="pb-2">Voucher No</th>
                    <th className="pb-2">Date</th>
                    <th className="pb-2">Category</th>
                    <th className="pb-2">Payee / Purpose</th>
                    <th className="pb-2">Mode</th>
                    <th className="pb-2">Recorded By</th>
                    <th className="pb-2 text-right">Amount (₹)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono text-slate-200">
                  {expenses.map((exp) => (
                    <tr key={exp.id} className="hover:bg-slate-800/30">
                      <td className="py-2.5 text-amber-300 font-bold">{exp.voucher_no}</td>
                      <td className="py-2.5 text-slate-400">{exp.date}</td>
                      <td className="py-2.5">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700">
                          {exp.category}
                        </span>
                      </td>
                      <td className="py-2.5 font-sans font-medium text-white">
                        <div>{exp.payee_name}</div>
                        {exp.remarks && <div className="text-[10px] text-slate-500">{exp.remarks}</div>}
                      </td>
                      <td className="py-2.5 text-slate-300">{exp.payment_mode}</td>
                      <td className="py-2.5 font-sans text-[11px] text-slate-400">{exp.created_by_staff}</td>
                      <td className="py-2.5 text-right font-bold text-rose-400">
                        {formatPaise(exp.amount_paise)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------------
          TAB 5: MULTI-DIMENSIONAL FEE REPORTS & AUDIT
          --------------------------------------------------------------------- */}
      {activeTab === 'REPORTS' && (
        <div className="flex-1 overflow-y-auto min-h-0 p-3 md:p-4 space-y-4">
          {/* Action Bar & Filter Bar */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md space-y-3">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                  <BarChart3 className="w-4 h-4 text-amber-400" />
                  <span>Fee Collection Audit, Day-Book & Financial Reports</span>
                </h3>
                <p className="text-[11px] text-slate-400">
                  Comprehensive audit ledger with direct print, WhatsApp dispatch, and CSV export.
                </p>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handlePrintReport}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold flex items-center space-x-1.5 shadow transition cursor-pointer"
                  title="Print Report"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print Report</span>
                </button>

                <button
                  type="button"
                  onClick={handleShareWhatsAppReport}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center space-x-1.5 shadow transition cursor-pointer"
                  title="Share Collection Summary on WhatsApp"
                >
                  <MessageCircle className="w-3.5 h-3.5" />
                  <span>Share WhatsApp</span>
                </button>

                <button
                  type="button"
                  onClick={handleExportCSVReport}
                  className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-bold flex items-center space-x-1.5 shadow transition cursor-pointer"
                  title="Download CSV"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export CSV</span>
                </button>

                <button
                  type="button"
                  onClick={handleCopySummaryReport}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold border border-slate-700 transition cursor-pointer"
                  title="Copy Summary to Clipboard"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  <span>Copy Summary</span>
                </button>
              </div>
            </div>

            {/* Filter Controls Bar */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
              <div>
                <label className="text-[10px] text-slate-400 block mb-0.5">Date Range Filter:</label>
                <select
                  value={reportDateRange}
                  onChange={(e) => setReportDateRange(e.target.value as any)}
                  className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-slate-200"
                >
                  <option value="ALL">All Recorded Dates</option>
                  <option value="TODAY">Today Only</option>
                  <option value="WEEK">Last 7 Days</option>
                  <option value="MONTH">Last 30 Days</option>
                </select>
              </div>

              <div>
                <label className="text-[10px] text-slate-400 block mb-0.5">Class Filter:</label>
                <select
                  value={reportClassFilter}
                  onChange={(e) => setReportClassFilter(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-slate-200"
                >
                  <option value="ALL">All Classes</option>
                  {SCHOOL_CLASSES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[10px] text-slate-400 block mb-0.5">Cashier / Staff Filter:</label>
                <select
                  value={reportStaffFilter}
                  onChange={(e) => setReportStaffFilter(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-slate-200"
                >
                  <option value="ALL">All Staff</option>
                  <option value="Mrs. Sunita Rao (Counter 1)">Mrs. Sunita Rao (Counter 1)</option>
                  <option value="Mr. Amit Shah (Counter 2)">Mr. Amit Shah (Counter 2)</option>
                  <option value="Admin Office Head">Admin Office Head</option>
                </select>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* 1. Date-Wise Report */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md space-y-3">
              <div className="flex items-center space-x-2 border-b border-slate-800 pb-2">
                <Calendar className="w-4 h-4 text-amber-400" />
                <h3 className="text-xs font-bold uppercase text-slate-200">Date-Wise Fee Collection</h3>
              </div>

              <div className="space-y-2 max-h-72 overflow-y-auto">
                {dateWiseCollections.map((d) => (
                  <div key={d.date} className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs flex justify-between items-center">
                    <div>
                      <div className="font-mono font-bold text-white">{d.date}</div>
                      <div className="text-[10px] text-slate-400">
                        {d.receipt_count} receipts • Cash: {formatPaise(d.cash_paise)} • UPI: {formatPaise(d.upi_paise)}
                      </div>
                    </div>
                    <div className="font-mono font-bold text-emerald-400 text-sm">
                      {formatPaise(d.total_paise)}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 2. Class-Wise Report */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md space-y-3">
              <div className="flex items-center space-x-2 border-b border-slate-800 pb-2">
                <BookOpen className="w-4 h-4 text-amber-400" />
                <h3 className="text-xs font-bold uppercase text-slate-200">Class-Wise Collection Breakdown</h3>
              </div>

              <div className="space-y-2 max-h-72 overflow-y-auto">
                {classWiseCollections.map((c) => (
                  <div key={c.class_name} className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs flex justify-between items-center">
                    <div>
                      <div className="font-bold text-white">{c.class_name}</div>
                      <div className="text-[10px] text-slate-400">
                        {c.students_count} enrolled • {c.paid_receipts_count} receipts issued
                      </div>
                    </div>
                    <div className="font-mono font-bold text-amber-400 text-sm">
                      {formatPaise(c.total_paise)}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 3. Staff-Wise Report */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md space-y-3">
              <div className="flex items-center space-x-2 border-b border-slate-800 pb-2">
                <UserCheck className="w-4 h-4 text-amber-400" />
                <h3 className="text-xs font-bold uppercase text-slate-200">Staff / Cashier Reconciliation</h3>
              </div>

              <div className="space-y-2 max-h-72 overflow-y-auto">
                {staffWiseCollections.map((s) => (
                  <div key={s.staff_name} className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs flex justify-between items-center">
                    <div>
                      <div className="font-bold text-white">{s.staff_name}</div>
                      <div className="text-[10px] text-slate-400">
                        {s.receipt_count} vouchers • Last: {s.last_collected_at}
                      </div>
                    </div>
                    <div className="font-mono font-bold text-blue-400 text-sm">
                      {formatPaise(s.total_paise)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Full Audit Register Table */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <h3 className="text-xs font-bold uppercase text-slate-200">
                Complete Fee Collection Register Day Book ({filteredPaymentRecords.length} records)
              </h3>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 text-[10px] uppercase font-bold">
                    <th className="pb-2">Receipt No</th>
                    <th className="pb-2">Date & Time</th>
                    <th className="pb-2">Adm No</th>
                    <th className="pb-2">Student</th>
                    <th className="pb-2">Class</th>
                    <th className="pb-2">Months Paid</th>
                    <th className="pb-2">Mode</th>
                    <th className="pb-2">Cashier</th>
                    <th className="pb-2 text-right">Net Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-slate-200">
                  {filteredPaymentRecords.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-800/30">
                      <td className="py-2 text-amber-300 font-bold">{r.receipt_no}</td>
                      <td className="py-2 text-slate-400 text-[11px]">{r.date} {r.time}</td>
                      <td className="py-2 text-slate-300">{r.admission_no}</td>
                      <td className="py-2 font-sans font-semibold text-white">{r.student_name}</td>
                      <td className="py-2">{r.class_name}-{r.section}</td>
                      <td className="py-2 text-amber-300">{r.months_paid.join(', ')}</td>
                      <td className="py-2 text-slate-300">{r.payment_mode}</td>
                      <td className="py-2 font-sans text-[11px] text-slate-400">{r.staff_name}</td>
                      <td className="py-2 text-right font-bold text-emerald-400">
                        {formatPaise(r.net_amount_paise)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------------
          TAB 6: RECEIPT CUSTOMIZER WITH LIVE WATERMARK & LOGO ADJUSTMENT
          --------------------------------------------------------------------- */}
      {activeTab === 'RECEIPT_SETTINGS' && (
        <div className="flex-1 overflow-y-auto min-h-0 p-3 md:p-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Left: Customizer Controls */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
              <div className="flex items-center space-x-2">
                <Settings className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-bold text-white">Receipt Voucher & Watermark Controls</h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  SchoolDataService.saveReceiptSettings(receiptSettings);
                  showToast('Receipt customizer settings saved!');
                }}
                className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-bold shadow transition cursor-pointer"
              >
                Save Settings
              </button>
            </div>

            {/* School Details */}
            <div className="space-y-2 text-xs">
              <div>
                <label className="text-[10px] text-slate-400 block mb-0.5">School Name:</label>
                <input
                  type="text"
                  value={receiptSettings.school_name}
                  onChange={(e) => setReceiptSettings({ ...receiptSettings, school_name: e.target.value })}
                  className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-slate-100 font-semibold"
                />
              </div>

              <div>
                <label className="text-[10px] text-slate-400 block mb-0.5">Affiliation & Reg Details:</label>
                <input
                  type="text"
                  value={receiptSettings.affiliation_details}
                  onChange={(e) => setReceiptSettings({ ...receiptSettings, affiliation_details: e.target.value })}
                  className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-slate-200"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-slate-400 block mb-0.5">Campus Address:</label>
                  <input
                    type="text"
                    value={receiptSettings.school_address}
                    onChange={(e) => setReceiptSettings({ ...receiptSettings, school_address: e.target.value })}
                    className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-slate-200"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 block mb-0.5">Phone / Contact:</label>
                  <input
                    type="text"
                    value={receiptSettings.phone}
                    onChange={(e) => setReceiptSettings({ ...receiptSettings, phone: e.target.value })}
                    className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-slate-200 font-mono"
                  />
                </div>
              </div>
            </div>

            {/* Watermark Controls */}
            <div className="pt-2 border-t border-slate-800 space-y-2.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-amber-400 flex items-center space-x-1.5">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Adjustable Background Watermark</span>
                </span>
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={receiptSettings.watermark_enabled}
                    onChange={(e) => setReceiptSettings({ ...receiptSettings, watermark_enabled: e.target.checked })}
                    className="rounded text-amber-500 focus:ring-0 cursor-pointer"
                  />
                  <span className="text-[11px] text-slate-300">Enable Watermark</span>
                </label>
              </div>

              {receiptSettings.watermark_enabled && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-0.5">Watermark Text:</label>
                    <input
                      type="text"
                      value={receiptSettings.watermark_text}
                      onChange={(e) => setReceiptSettings({ ...receiptSettings, watermark_text: e.target.value })}
                      className="w-full px-2.5 py-1 bg-slate-950 border border-slate-700 rounded-lg text-xs font-bold text-amber-300 font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-0.5">
                      Opacity ({Math.round(receiptSettings.watermark_opacity * 100)}%):
                    </label>
                    <input
                      type="range"
                      min="0.05"
                      max="0.4"
                      step="0.01"
                      value={receiptSettings.watermark_opacity}
                      onChange={(e) => setReceiptSettings({ ...receiptSettings, watermark_opacity: Number(e.target.value) })}
                      className="w-full accent-amber-500 cursor-pointer"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-0.5">
                      Angle ({receiptSettings.watermark_angle_deg}°):
                    </label>
                    <input
                      type="range"
                      min="-45"
                      max="45"
                      step="5"
                      value={receiptSettings.watermark_angle_deg}
                      onChange={(e) => setReceiptSettings({ ...receiptSettings, watermark_angle_deg: Number(e.target.value) })}
                      className="w-full accent-amber-500 cursor-pointer"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* School Logo Controls */}
            <div className="pt-2 border-t border-slate-800 space-y-2.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-amber-400 flex items-center space-x-1.5">
                  <Image className="w-3.5 h-3.5" />
                  <span>Adjustable School Logo & Emblem</span>
                </span>
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={receiptSettings.logo_enabled}
                    onChange={(e) => setReceiptSettings({ ...receiptSettings, logo_enabled: e.target.checked })}
                    className="rounded text-amber-500 focus:ring-0 cursor-pointer"
                  />
                  <span className="text-[11px] text-slate-300">Enable Logo</span>
                </label>
              </div>

              {receiptSettings.logo_enabled && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-0.5">Emblem Preset:</label>
                    <select
                      value={receiptSettings.logo_preset}
                      onChange={(e) => setReceiptSettings({ ...receiptSettings, logo_preset: e.target.value as any })}
                      className="w-full px-2 py-1 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white"
                    >
                      <option value="SHIELD">Academic Shield</option>
                      <option value="TORCH">Torch of Knowledge</option>
                      <option value="CREST">Collegiate Crest</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-0.5">
                      Logo Size ({receiptSettings.logo_size_px}px):
                    </label>
                    <input
                      type="range"
                      min="35"
                      max="90"
                      step="5"
                      value={receiptSettings.logo_size_px}
                      onChange={(e) => setReceiptSettings({ ...receiptSettings, logo_size_px: Number(e.target.value) })}
                      className="w-full accent-amber-500 cursor-pointer"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-0.5">Alignment:</label>
                    <select
                      value={receiptSettings.logo_alignment}
                      onChange={(e) => setReceiptSettings({ ...receiptSettings, logo_alignment: e.target.value as any })}
                      className="w-full px-2 py-1 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white"
                    >
                      <option value="CENTER">Center</option>
                      <option value="LEFT">Left</option>
                    </select>
                  </div>
                </div>
              )}
            </div>

            {/* Terms & Conditions / Signatory */}
            <div className="pt-2 border-t border-slate-800 space-y-2 text-xs">
              <div>
                <label className="text-[10px] text-slate-400 block mb-0.5">Receipt Disclaimer Terms:</label>
                <input
                  type="text"
                  value={receiptSettings.receipt_terms}
                  onChange={(e) => setReceiptSettings({ ...receiptSettings, receipt_terms: e.target.value })}
                  className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-slate-200"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 block mb-0.5">Cashier Signatory Label:</label>
                <input
                  type="text"
                  value={receiptSettings.staff_signatory_title}
                  onChange={(e) => setReceiptSettings({ ...receiptSettings, staff_signatory_title: e.target.value })}
                  className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-slate-200"
                />
              </div>
            </div>
          </div>

          {/* Right: Live Preview of Receipt Voucher */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md flex flex-col justify-between space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">
                Live WYSIWYG Slip Preview
              </span>
              <span className="text-[11px] text-slate-500">Updates in real time</span>
            </div>

            {/* Live Rendered Card simulating the printed slip */}
            <div className="bg-white text-slate-900 p-4 rounded-xl shadow-inner relative overflow-hidden font-sans text-xs border border-slate-300">
              {/* Live Watermark Overlay */}
              {receiptSettings.watermark_enabled && (
                <div
                  className="pointer-events-none absolute inset-0 flex items-center justify-center font-black select-none uppercase tracking-widest"
                  style={{
                    opacity: receiptSettings.watermark_opacity,
                    transform: `rotate(${receiptSettings.watermark_angle_deg}deg)`,
                    fontSize: '48px',
                    color: '#B45309',
                  }}
                >
                  {receiptSettings.watermark_text}
                </div>
              )}

              {/* Header with Live Logo */}
              <div
                className={`flex flex-col ${
                  receiptSettings.logo_alignment === 'CENTER' ? 'items-center text-center' : 'items-start text-left'
                } border-b border-gray-300 pb-2`}
              >
                {receiptSettings.logo_enabled && (
                  <div className="mb-1">
                    {renderSchoolLogo(
                      receiptSettings.logo_preset,
                      receiptSettings.logo_size_px,
                      receiptSettings.custom_logo_url
                    )}
                  </div>
                )}
                <div className="font-extrabold text-sm uppercase tracking-wide text-gray-900">
                  {receiptSettings.school_name}
                </div>
                <div className="text-[10px] text-gray-600">{receiptSettings.affiliation_details}</div>
                <div className="text-[10px] text-gray-500">{receiptSettings.school_address}</div>
                <div className="text-[10px] font-mono font-bold mt-1 text-amber-800">
                  RECEIPT #SCH-26-DEMO | DATE: {new Date().toISOString().split('T')[0]}
                </div>
              </div>

              {/* Sample Student Details */}
              <div className="my-2 p-2 bg-gray-50 rounded text-[11px] space-y-0.5 border border-gray-200">
                <div className="flex justify-between">
                  <span><strong>Student:</strong> Aarav Sharma</span>
                  <span className="font-mono text-amber-800"><strong>Adm No:</strong> ADM-2020-044</span>
                </div>
                <div className="flex justify-between">
                  <span><strong>Class:</strong> Class 10-A (Roll: 10-A-04)</span>
                  <span><strong>Months:</strong> Oct, Nov 2026</span>
                </div>
              </div>

              {/* Table Preview */}
              <table className="w-full text-left text-[10px] mb-2">
                <thead>
                  <tr className="border-b border-gray-300 font-bold text-gray-600">
                    <th className="py-0.5">Particulars</th>
                    <th className="py-0.5 text-right">Amount (₹)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-dotted divide-gray-200 font-mono">
                  <tr>
                    <td className="py-0.5 font-sans">Tuition Fee (2 Months)</td>
                    <td className="py-0.5 text-right">10,400.00</td>
                  </tr>
                  <tr>
                    <td className="py-0.5 font-sans">Computer & Science Labs</td>
                    <td className="py-0.5 text-right">2,000.00</td>
                  </tr>
                  <tr>
                    <td className="py-0.5 font-sans">Transport Facility</td>
                    <td className="py-0.5 text-right">2,400.00</td>
                  </tr>
                </tbody>
              </table>

              <div className="border-t border-gray-300 pt-1 space-y-0.5 text-[11px]">
                <div className="flex justify-between font-bold text-xs">
                  <span>NET TOTAL PAID:</span>
                  <span className="font-mono text-emerald-800">₹14,800.00</span>
                </div>
                <div className="text-[9px] text-gray-500">Mode: UPI (Ref: UPI-982144)</div>
              </div>

              <div className="mt-4 pt-2 border-t border-gray-200 flex justify-between items-end text-[9px] text-gray-500">
                <span>{receiptSettings.staff_signatory_title}</span>
                <span>Parent / Guardian Signature</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      )}

      {/* ---------------------------------------------------------------------
          MODAL 1: ENROLL NEW STUDENT RECORD
          --------------------------------------------------------------------- */}
      {showNewStudentModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-4">
          <div
            className="bg-slate-900 border border-slate-800 w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl p-5 shadow-2xl space-y-4 text-xs"
            role="dialog"
            aria-modal="true"
            aria-labelledby="enroll-student-title"
          >
            <div className="flex justify-between items-center border-b border-slate-800 pb-2">
              <h3 id="enroll-student-title" className="text-sm font-bold text-white flex items-center space-x-2">
                <GraduationCap className="w-4 h-4 text-amber-400" />
                <span>Enroll New Student Master Record</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowNewStudentModal(false)}
                className="text-slate-500 hover:text-white focus-ring p-1 rounded"
                aria-label="Close enroll student dialog"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleRegisterStudent} className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-400 block mb-1">
                    Master Key (Admission No) <span className="text-amber-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={newAdmissionNo}
                    onChange={(e) => setNewAdmissionNo(e.target.value)}
                    className="w-full px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-amber-300 font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Roll Number</label>
                  <input
                    type="text"
                    placeholder="e.g. 10-A-04"
                    required
                    value={newRollNo}
                    onChange={(e) => setNewRollNo(e.target.value)}
                    className="w-full px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-slate-200 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Full Student Name</label>
                <input
                  type="text"
                  placeholder="e.g. Aarav Rajesh Sharma"
                  required
                  value={newFullName}
                  onChange={(e) => setNewFullName(e.target.value)}
                  className="w-full px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-slate-100 font-semibold"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-400 block mb-1">Class</label>
                  <select
                    value={newClass}
                    onChange={(e) => setNewClass(e.target.value)}
                    className="w-full px-2 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-slate-200"
                  >
                    {SCHOOL_CLASSES.map((c) => (
                      <option key={c} value={c}>
                        {c}
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
                    <option value="A">Section A</option>
                    <option value="B">Section B</option>
                    <option value="C">Section C</option>
                    <option value="D">Section D</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
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
                  <label className="text-slate-400 block mb-1">Guardian Mobile (WhatsApp)</label>
                  <input
                    type="text"
                    placeholder="+91..."
                    value={newGuardianPhone}
                    onChange={(e) => setNewGuardianPhone(e.target.value)}
                    className="w-full px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-slate-200 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Address / Landmark</label>
                <input
                  type="text"
                  placeholder="e.g. Flat 402, Green Valley, Baner, Pune"
                  value={newAddress}
                  onChange={(e) => setNewAddress(e.target.value)}
                  className="w-full px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-slate-200"
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
                  Enroll Student Record
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------------
          MODAL 2: RECORD NEW OPERATIONAL EXPENSE
          --------------------------------------------------------------------- */}
      {showNewExpenseModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-4">
          <div
            className="bg-slate-900 border border-slate-800 w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl p-5 shadow-2xl space-y-4 text-xs"
            role="dialog"
            aria-modal="true"
            aria-labelledby="record-expense-title"
          >
            <div className="flex justify-between items-center border-b border-slate-800 pb-2">
              <h3 id="record-expense-title" className="text-sm font-bold text-white flex items-center space-x-2">
                <Wallet className="w-4 h-4 text-rose-400" />
                <span>Record School Operational Expense</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowNewExpenseModal(false)}
                className="text-slate-500 hover:text-white focus-ring p-1 rounded"
                aria-label="Close record expense dialog"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddExpense} className="space-y-3">
              <div>
                <label className="text-slate-400 block mb-1">Expense Category:</label>
                <select
                  value={expCategory}
                  onChange={(e) => setExpCategory(e.target.value as any)}
                  className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-slate-100 font-semibold"
                >
                  <option value="SALARIES">Faculty & Staff Payroll</option>
                  <option value="UTILITIES">Electricity, Water & Internet</option>
                  <option value="MAINTENANCE">Campus Repairs & Fire Safety</option>
                  <option value="LAB_SUPPLIES">Science & Computer Lab Supplies</option>
                  <option value="BOOKS_STATIONERY">Library Books & Office Stationery</option>
                  <option value="EVENTS">Sports Day & Annual Function</option>
                  <option value="MISC">Miscellaneous Operations</option>
                </select>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Payee / Vendor Name:</label>
                <input
                  type="text"
                  placeholder="e.g. MSEDCL or Apex Scientific Supplies"
                  required
                  value={expPayee}
                  onChange={(e) => setExpPayee(e.target.value)}
                  className="w-full px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-slate-200"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-400 block mb-1">Amount in ₹:</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="e.g. 48500"
                    required
                    value={expAmountInr}
                    onChange={(e) => setExpAmountInr(e.target.value)}
                    className="w-full px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-rose-400 font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Payment Mode:</label>
                  <select
                    value={expMode}
                    onChange={(e) => setExpMode(e.target.value as PaymentMode)}
                    className="w-full px-2 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-slate-200"
                  >
                    <option value="UPI">UPI</option>
                    <option value="BANK_TRANSFER">Bank Transfer / NEFT</option>
                    <option value="CHEQUE">Cheque</option>
                    <option value="CASH">Cash</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Voucher / Bill Ref:</label>
                <input
                  type="text"
                  value={expVoucherNo}
                  onChange={(e) => setExpVoucherNo(e.target.value)}
                  className="w-full px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-slate-200 font-mono"
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Remarks / Note:</label>
                <input
                  type="text"
                  placeholder="Optional details..."
                  value={expRemarks}
                  onChange={(e) => setExpRemarks(e.target.value)}
                  className="w-full px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-slate-200"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowNewExpenseModal(false)}
                  className="px-3 py-1.5 bg-slate-800 text-slate-300 rounded-lg font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-lg font-bold shadow"
                >
                  Post Expense Voucher
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------------
          MODAL 3: FINAL DUAL-SLIP RECEIPT VOUCHER (Student Copy & Office Copy)
          WITH LIVE WATERMARK & SCHOOL LOGO
          --------------------------------------------------------------------- */}
      {showVoucherModal && lastReceipt && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-sm z-50 flex items-center justify-center p-3 md:p-6 animate-in fade-in duration-150">
          <div
            className="bg-white text-slate-900 w-full max-w-5xl rounded-2xl shadow-2xl p-5 md:p-6 overflow-y-auto max-h-[90vh] font-sans text-xs"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dual-slip-voucher-title"
          >
            {/* Header Action Controls (Non-printable) */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center pb-3 mb-3 border-b border-gray-300 gap-2 non-printable">
              <div>
                <span id="dual-slip-voucher-title" className="font-extrabold text-sm text-gray-800 block">
                  Official Institutional Fee Receipt Voucher
                </span>
                <span className="text-[11px] text-gray-500">
                  Dual copy format (Student Copy + Accounts Office Copy) with active watermark
                </span>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={handleSendReceiptWhatsApp}
                  className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg font-bold flex items-center space-x-1.5 shadow cursor-pointer text-xs"
                  title="Send Fee Receipt to Parent via WhatsApp"
                >
                  <MessageCircle className="w-3.5 h-3.5" />
                  <span>WhatsApp Bill</span>
                </button>

                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-4 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-bold flex items-center space-x-1.5 shadow cursor-pointer text-xs"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print Dual Voucher</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowVoucherModal(false)}
                  className="px-3 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg font-bold cursor-pointer text-xs"
                >
                  Close
                </button>
              </div>
            </div>

            {/* DUAL COPY VOUCHER: Student Copy & Office Copy Side-by-Side */}
            <div id="fee-receipt-print" className="grid grid-cols-1 md:grid-cols-2 gap-4 border border-gray-400 p-4 bg-white">
              {/* COPY 1: STUDENT COPY */}
              <div className="border border-dashed border-gray-400 p-4 space-y-3 relative overflow-hidden">
                {/* Watermark overlay */}
                {receiptSettings.watermark_enabled && (
                  <div
                    className="pointer-events-none absolute inset-0 flex items-center justify-center font-black select-none uppercase tracking-widest"
                    style={{
                      opacity: receiptSettings.watermark_opacity,
                      transform: `rotate(${receiptSettings.watermark_angle_deg}deg)`,
                      fontSize: '44px',
                      color: '#B45309',
                    }}
                  >
                    {receiptSettings.watermark_text}
                  </div>
                )}

                {/* Header */}
                <div
                  className={`border-b border-gray-300 pb-2 flex flex-col ${
                    receiptSettings.logo_alignment === 'CENTER' ? 'items-center text-center' : 'items-start text-left'
                  }`}
                >
                  <div className="text-[9px] font-bold uppercase tracking-widest text-amber-800 bg-amber-100 px-2 py-0.5 rounded mb-1">
                    STUDENT COPY
                  </div>
                  {receiptSettings.logo_enabled && (
                    <div className="mb-1">
                      {renderSchoolLogo(
                        receiptSettings.logo_preset,
                        receiptSettings.logo_size_px,
                        receiptSettings.custom_logo_url
                      )}
                    </div>
                  )}
                  <h3 className="text-sm font-extrabold uppercase text-gray-900">
                    {receiptSettings.school_name}
                  </h3>
                  <p className="text-[10px] text-gray-600">{receiptSettings.affiliation_details}</p>
                  <p className="text-[10px] text-gray-500">{receiptSettings.school_address}</p>
                  <p className="text-[10px] font-mono font-bold mt-1 text-amber-900">
                    Receipt No: {lastReceipt.receipt_no} | Date: {lastReceipt.date} {lastReceipt.time}
                  </p>
                </div>

                {/* Student Details Card */}
                <div className="bg-gray-50 p-2.5 rounded text-[11px] space-y-0.5 border border-gray-200">
                  <div className="flex justify-between">
                    <span><strong>Student Name:</strong> {lastReceipt.student_name}</span>
                    <span className="font-mono text-amber-900 font-bold"><strong>Adm No:</strong> {lastReceipt.admission_no}</span>
                  </div>
                  <div className="flex justify-between">
                    <span><strong>Class & Section:</strong> {lastReceipt.class_name}-{lastReceipt.section}</span>
                    <span><strong>Months Paid:</strong> {lastReceipt.months_paid.join(', ')}</span>
                  </div>
                  <div className="flex justify-between text-gray-600">
                    <span><strong>Session:</strong> {lastReceipt.academic_year}</span>
                    <span><strong>Payment Mode:</strong> {lastReceipt.payment_mode}</span>
                  </div>
                </div>

                {/* Particulars Table */}
                <table className="w-full text-left text-[10px]">
                  <thead>
                    <tr className="border-b border-gray-300 font-bold text-gray-700">
                      <th className="py-1">Fee Head Particulars</th>
                      <th className="py-1 text-right">Amount (₹)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-dotted divide-gray-200 font-mono">
                    {lastReceipt.fee_heads.map((h, i) => (
                      <tr key={i}>
                        <td className="py-0.5 font-sans">{h.name}</td>
                        <td className="py-0.5 text-right font-medium">{formatPaise(h.amount_paise, false)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Totals */}
                <div className="border-t border-gray-300 pt-1 space-y-0.5 text-[11px]">
                  <div className="flex justify-between">
                    <span>Subtotal Fees:</span>
                    <span className="font-mono">{formatPaise(lastReceipt.subtotal_paise)}</span>
                  </div>
                  {lastReceipt.concession_paise > 0 && (
                    <div className="flex justify-between text-amber-800">
                      <span>Concession ({lastReceipt.concession_type}):</span>
                      <span className="font-mono">-{formatPaise(lastReceipt.concession_paise)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold text-xs border-t border-gray-300 pt-1">
                    <span>NET AMOUNT PAID:</span>
                    <span className="font-mono text-emerald-800">{formatPaise(lastReceipt.net_amount_paise)}</span>
                  </div>
                  <div className="text-[9px] text-gray-700 italic pt-0.5 leading-tight">
                    <span className="font-semibold not-italic">Amount in Words:</span> {paiseToWords(lastReceipt.net_amount_paise)}
                  </div>
                  <div className="text-[9px] text-gray-500 pt-1">
                    Instrument Ref: {lastReceipt.transaction_ref} • Officer: {lastReceipt.staff_name}
                  </div>
                  <div className="text-[8px] text-gray-400 italic pt-0.5">
                    {receiptSettings.receipt_terms}
                  </div>
                </div>

                <div className="pt-6 flex justify-between items-end text-[9px] text-gray-600">
                  <span>{receiptSettings.staff_signatory_title}</span>
                  <span>Parent / Depositor</span>
                </div>
              </div>

              {/* COPY 2: ACCOUNTS / OFFICE COPY */}
              <div className="border border-dashed border-gray-400 p-4 space-y-3 relative overflow-hidden">
                {/* Watermark overlay */}
                {receiptSettings.watermark_enabled && (
                  <div
                    className="pointer-events-none absolute inset-0 flex items-center justify-center font-black select-none uppercase tracking-widest"
                    style={{
                      opacity: receiptSettings.watermark_opacity,
                      transform: `rotate(${receiptSettings.watermark_angle_deg}deg)`,
                      fontSize: '44px',
                      color: '#B45309',
                    }}
                  >
                    {receiptSettings.watermark_text}
                  </div>
                )}

                {/* Header */}
                <div
                  className={`border-b border-gray-300 pb-2 flex flex-col ${
                    receiptSettings.logo_alignment === 'CENTER' ? 'items-center text-center' : 'items-start text-left'
                  }`}
                >
                  <div className="text-[9px] font-bold uppercase tracking-widest text-blue-800 bg-blue-100 px-2 py-0.5 rounded mb-1">
                    ACCOUNTS / OFFICE COPY
                  </div>
                  {receiptSettings.logo_enabled && (
                    <div className="mb-1">
                      {renderSchoolLogo(
                        receiptSettings.logo_preset,
                        receiptSettings.logo_size_px,
                        receiptSettings.custom_logo_url
                      )}
                    </div>
                  )}
                  <h3 className="text-sm font-extrabold uppercase text-gray-900">
                    {receiptSettings.school_name}
                  </h3>
                  <p className="text-[10px] text-gray-600">{receiptSettings.affiliation_details}</p>
                  <p className="text-[10px] text-gray-500">{receiptSettings.school_address}</p>
                  <p className="text-[10px] font-mono font-bold mt-1 text-blue-900">
                    Receipt No: {lastReceipt.receipt_no} | Date: {lastReceipt.date} {lastReceipt.time}
                  </p>
                </div>

                {/* Student Details Card */}
                <div className="bg-gray-50 p-2.5 rounded text-[11px] space-y-0.5 border border-gray-200">
                  <div className="flex justify-between">
                    <span><strong>Student Name:</strong> {lastReceipt.student_name}</span>
                    <span className="font-mono text-blue-900 font-bold"><strong>Adm No:</strong> {lastReceipt.admission_no}</span>
                  </div>
                  <div className="flex justify-between">
                    <span><strong>Class & Section:</strong> {lastReceipt.class_name}-{lastReceipt.section}</span>
                    <span><strong>Months Paid:</strong> {lastReceipt.months_paid.join(', ')}</span>
                  </div>
                  <div className="flex justify-between text-gray-600">
                    <span><strong>Session:</strong> {lastReceipt.academic_year}</span>
                    <span><strong>Payment Mode:</strong> {lastReceipt.payment_mode}</span>
                  </div>
                </div>

                {/* Particulars Table */}
                <table className="w-full text-left text-[10px]">
                  <thead>
                    <tr className="border-b border-gray-300 font-bold text-gray-700">
                      <th className="py-1">Fee Head Particulars</th>
                      <th className="py-1 text-right">Amount (₹)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-dotted divide-gray-200 font-mono">
                    {lastReceipt.fee_heads.map((h, i) => (
                      <tr key={i}>
                        <td className="py-0.5 font-sans">{h.name}</td>
                        <td className="py-0.5 text-right font-medium">{formatPaise(h.amount_paise, false)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Totals */}
                <div className="border-t border-gray-300 pt-1 space-y-0.5 text-[11px]">
                  <div className="flex justify-between">
                    <span>Subtotal Fees:</span>
                    <span className="font-mono">{formatPaise(lastReceipt.subtotal_paise)}</span>
                  </div>
                  {lastReceipt.concession_paise > 0 && (
                    <div className="flex justify-between text-amber-800">
                      <span>Concession ({lastReceipt.concession_type}):</span>
                      <span className="font-mono">-{formatPaise(lastReceipt.concession_paise)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold text-xs border-t border-gray-300 pt-1">
                    <span>NET AMOUNT PAID:</span>
                    <span className="font-mono text-blue-800">{formatPaise(lastReceipt.net_amount_paise)}</span>
                  </div>
                  <div className="text-[9px] text-gray-700 italic pt-0.5 leading-tight">
                    <span className="font-semibold not-italic">Amount in Words:</span> {paiseToWords(lastReceipt.net_amount_paise)}
                  </div>
                  <div className="text-[9px] text-gray-500 pt-1">
                    Instrument Ref: {lastReceipt.transaction_ref} • Officer: {lastReceipt.staff_name}
                  </div>
                  <div className="text-[8px] text-gray-400 italic pt-0.5">
                    Audit Verified • Transferred to School Revenue Ledger
                  </div>
                </div>

                <div className="pt-6 flex justify-between items-end text-[9px] text-gray-600">
                  <span>Accounts Internal Audit Stamp</span>
                  <span>Chief Bursar Signature</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Floating Notification Toast */}
      {toastMessage && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-slate-900 border border-amber-500/50 text-amber-200 px-4 py-2 rounded-xl text-xs font-semibold shadow-2xl flex items-center space-x-2 animate-in fade-in slide-in-from-bottom-2">
          <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
};

export default SchoolBilling;
