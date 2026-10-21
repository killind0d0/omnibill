// ui/src/verticals/schoolData.ts
// School ERP Management: Student Records, Class Fee Presets, Monthly Tracking,
// Defaulters Engine, Expense Management, Date/Class/Staff Analytics, and Receipt Customizer

import {
  StudentEntity,
  ClassFeeRule,
  MonthlyClassFeeRule,
  SchoolExpense,
  SchoolReceiptSettings,
  SchoolFeePaymentRecord,
  PaymentMode,
} from './types';
import { SEEDED_STUDENTS } from './ipc';

// ----------------------------------------------------------------------------
// 1. ACADEMIC MONTHS LIST (Standard April to March Session)
// ----------------------------------------------------------------------------
export const ACADEMIC_MONTHS = [
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
  'Jan',
  'Feb',
  'Mar',
] as const;

export type AcademicMonth = typeof ACADEMIC_MONTHS[number];

// Standard Classes in School
export const SCHOOL_CLASSES = [
  'Nursery',
  'LKG',
  'UKG',
  'Class 1',
  'Class 2',
  'Class 3',
  'Class 4',
  'Class 5',
  'Class 6',
  'Class 7',
  'Class 8',
  'Class 9',
  'Class 10',
  'Class 11',
  'Class 12',
];

// ----------------------------------------------------------------------------
// 2. DEFAULT CLASS-WISE FEE PRESETS
// ----------------------------------------------------------------------------
export const INITIAL_CLASS_FEE_RULES: ClassFeeRule[] = [
  {
    class_name: 'Nursery',
    tuition_paise: 200000,
    computer_lab_paise: 0,
    sports_activity_paise: 50000,
    exam_paise: 30000,
    transport_paise: 120000,
    total_monthly_paise: 400000, // ₹4,000/mo
  },
  {
    class_name: 'LKG',
    tuition_paise: 220000,
    computer_lab_paise: 0,
    sports_activity_paise: 50000,
    exam_paise: 30000,
    transport_paise: 120000,
    total_monthly_paise: 420000, // ₹4,200/mo
  },
  {
    class_name: 'UKG',
    tuition_paise: 240000,
    computer_lab_paise: 0,
    sports_activity_paise: 50000,
    exam_paise: 30000,
    transport_paise: 120000,
    total_monthly_paise: 440000, // ₹4,400/mo
  },
  {
    class_name: 'Class 1',
    tuition_paise: 280000,
    computer_lab_paise: 40000,
    sports_activity_paise: 30000,
    exam_paise: 40000,
    transport_paise: 120000,
    total_monthly_paise: 510000, // ₹5,100/mo
  },
  {
    class_name: 'Class 2',
    tuition_paise: 290000,
    computer_lab_paise: 40000,
    sports_activity_paise: 30000,
    exam_paise: 40000,
    transport_paise: 120000,
    total_monthly_paise: 520000, // ₹5,200/mo
  },
  {
    class_name: 'Class 3',
    tuition_paise: 300000,
    computer_lab_paise: 40000,
    sports_activity_paise: 30000,
    exam_paise: 40000,
    transport_paise: 120000,
    total_monthly_paise: 530000, // ₹5,300/mo
  },
  {
    class_name: 'Class 4',
    tuition_paise: 320000,
    computer_lab_paise: 45000,
    sports_activity_paise: 35000,
    exam_paise: 40000,
    transport_paise: 120000,
    total_monthly_paise: 560000, // ₹5,600/mo
  },
  {
    class_name: 'Class 5',
    tuition_paise: 350000,
    computer_lab_paise: 45000,
    sports_activity_paise: 35000,
    exam_paise: 50000,
    transport_paise: 120000,
    total_monthly_paise: 600000, // ₹6,000/mo
  },
  {
    class_name: 'Class 6',
    tuition_paise: 380000,
    computer_lab_paise: 60000,
    sports_activity_paise: 40000,
    exam_paise: 50000,
    transport_paise: 120000,
    total_monthly_paise: 650000, // ₹6,500/mo
  },
  {
    class_name: 'Class 7',
    tuition_paise: 400000,
    computer_lab_paise: 60000,
    sports_activity_paise: 40000,
    exam_paise: 50000,
    transport_paise: 120000,
    total_monthly_paise: 670000, // ₹6,700/mo
  },
  {
    class_name: 'Class 8',
    tuition_paise: 420000,
    computer_lab_paise: 60000,
    sports_activity_paise: 40000,
    exam_paise: 50000,
    transport_paise: 120000,
    total_monthly_paise: 690000, // ₹6,900/mo
  },
  {
    class_name: 'Class 9',
    tuition_paise: 480000,
    computer_lab_paise: 80000,
    sports_activity_paise: 40000,
    exam_paise: 60000,
    transport_paise: 120000,
    total_monthly_paise: 780000, // ₹7,800/mo
  },
  {
    class_name: 'Class 10',
    tuition_paise: 520000,
    computer_lab_paise: 100000,
    sports_activity_paise: 40000,
    exam_paise: 80000,
    transport_paise: 120000,
    total_monthly_paise: 860000, // ₹8,600/mo
  },
  {
    class_name: 'Class 11',
    tuition_paise: 650000,
    computer_lab_paise: 120000,
    sports_activity_paise: 50000,
    exam_paise: 80000,
    transport_paise: 120000,
    total_monthly_paise: 1020000, // ₹10,200/mo
  },
  {
    class_name: 'Class 12',
    tuition_paise: 700000,
    computer_lab_paise: 150000,
    sports_activity_paise: 50000,
    exam_paise: 100000,
    transport_paise: 120000,
    total_monthly_paise: 1120000, // ₹11,200/mo
  },
];

// ----------------------------------------------------------------------------
// 2B. DEFAULT CLASS-WISE & MONTH-WISE FEE PRESETS (12-MONTH 2D MATRIX)
// ----------------------------------------------------------------------------
export const generateDefaultMonthlyRules = (): MonthlyClassFeeRule[] => {
  const rules: MonthlyClassFeeRule[] = [];

  for (const className of SCHOOL_CLASSES) {
    const base = INITIAL_CLASS_FEE_RULES.find((r) => r.class_name === className) || {
      class_name: className,
      tuition_paise: 400000,
      computer_lab_paise: 50000,
      sports_activity_paise: 40000,
      exam_paise: 40000,
      transport_paise: 120000,
      total_monthly_paise: 650000,
    };

    const isPrePrimary = ['Nursery', 'LKG', 'UKG'].includes(className);
    const isPrimary = ['Class 1', 'Class 2', 'Class 3', 'Class 4', 'Class 5'].includes(className);
    const isMiddle = ['Class 6', 'Class 7', 'Class 8'].includes(className);
    const isSecondary = ['Class 9', 'Class 10'].includes(className);
    const isSenior = ['Class 11', 'Class 12'].includes(className);

    for (const month of ACADEMIC_MONTHS) {
      let annualCharge = 0;
      let examFee = 0;
      let sportsFee = base.sports_activity_paise;

      // April: Annual Admission / Session Development Charge
      if (month === 'Apr') {
        if (isPrePrimary) annualCharge = 250000; // ₹2,500
        else if (isPrimary) annualCharge = 350000; // ₹3,500
        else if (isMiddle) annualCharge = 450000; // ₹4,500
        else if (isSecondary) annualCharge = 550000; // ₹5,500
        else if (isSenior) annualCharge = 650000; // ₹6,500
      }

      // September: Half-Yearly / Mid-Term Assessments
      if (month === 'Sep') {
        if (isPrePrimary) examFee = 30000; // ₹300
        else if (isPrimary) examFee = 50000; // ₹500
        else if (isMiddle) examFee = 60000; // ₹600
        else if (isSecondary) examFee = 80000; // ₹800
        else if (isSenior) examFee = 100000; // ₹1,000
      }

      // December: Winter Sports Day & Annual Fest
      if (month === 'Dec') {
        sportsFee += 40000; // +₹400 for annual sports event
      }

      // February: Pre-Board Assessments for Class 10 & 12
      if (month === 'Feb' && (className === 'Class 10' || className === 'Class 12')) {
        examFee = 120000; // ₹1,200
      }

      // March: Final Annual Board / Promotion Exams
      if (month === 'Mar') {
        if (isPrePrimary) examFee = 40000; // ₹400
        else if (isPrimary) examFee = 60000; // ₹600
        else if (isMiddle) examFee = 80000; // ₹800
        else if (isSecondary) examFee = 120000; // ₹1,200
        else if (isSenior) examFee = 150000; // ₹1,500
      }

      const total =
        base.tuition_paise +
        base.computer_lab_paise +
        sportsFee +
        examFee +
        base.transport_paise +
        annualCharge;

      rules.push({
        class_name: className,
        month,
        tuition_paise: base.tuition_paise,
        computer_lab_paise: base.computer_lab_paise,
        sports_activity_paise: sportsFee,
        exam_paise: examFee,
        transport_paise: base.transport_paise,
        annual_charge_paise: annualCharge,
        total_paise: total,
      });
    }
  }

  return rules;
};

export const INITIAL_MONTHLY_FEE_RULES: MonthlyClassFeeRule[] = generateDefaultMonthlyRules();

// ----------------------------------------------------------------------------
// 3. DEFAULT RECEIPT & WATERMARK / LOGO CUSTOMIZER SETTINGS
// ----------------------------------------------------------------------------
export const INITIAL_RECEIPT_SETTINGS: SchoolReceiptSettings = {
  school_name: 'ST. XAVIER HIGHER SECONDARY ACADEMY',
  affiliation_details: 'Affiliated to CBSE, New Delhi • Affiliation No: 1130492 • School Code: 40182',
  school_address: 'St. Xavier Campus, Knowledge Park Road, Baner, Pune - 411045',
  phone: '+91 (020) 2589-4000 / +91 98201 11223',
  email: 'accounts@stxavieracademy.edu.in',
  receipt_title: 'OFFICIAL TERM & MONTHLY FEE RECEIPT VOUCHER',
  receipt_terms: 'Fees once tendered are non-refundable and non-transferable under any circumstances.',
  staff_signatory_title: 'Authorized Accounts Officer / Cashier',
  watermark_enabled: true,
  watermark_text: 'PAID',
  watermark_opacity: 0.12,
  watermark_angle_deg: -25,
  logo_enabled: true,
  logo_preset: 'SHIELD',
  custom_logo_url: '',
  logo_size_px: 62,
  logo_alignment: 'CENTER',
};

// ----------------------------------------------------------------------------
// 4. SEEDED SCHOOL EXPENSES
// ----------------------------------------------------------------------------
export const INITIAL_SCHOOL_EXPENSES: SchoolExpense[] = [
  {
    id: 'exp_sch_001',
    date: new Date().toISOString().split('T')[0],
    category: 'SALARIES',
    payee_name: 'Monthly Faculty & Teaching Staff Payroll (Oct 2026)',
    amount_paise: 145000000, // ₹14,50,000
    payment_mode: 'BANK_TRANSFER',
    voucher_no: 'SAL-2026-10',
    remarks: 'Approved by Principal & Management Board',
    created_by_staff: 'Mrs. Sunita Rao (Chief Accountant)',
  },
  {
    id: 'exp_sch_002',
    date: new Date().toISOString().split('T')[0],
    category: 'UTILITIES',
    payee_name: 'Maharashtra State Electricity Distribution (MSEDCL)',
    amount_paise: 4850000, // ₹48,500
    payment_mode: 'UPI',
    voucher_no: 'ELEC-2026-10',
    remarks: 'Main School Campus & Science Labs HT meter',
    created_by_staff: 'Mr. Amit Shah (Counter 2)',
  },
  {
    id: 'exp_sch_003',
    date: new Date().toISOString().split('T')[0],
    category: 'LAB_SUPPLIES',
    payee_name: 'Apex Scientific & Chemistry Glassware Supplies',
    amount_paise: 3200000, // ₹32,000
    payment_mode: 'CHEQUE',
    voucher_no: 'LAB-CHQ-9812',
    remarks: 'Reagents, microscopes & test tubes for Senior Lab',
    created_by_staff: 'Mrs. Sunita Rao (Chief Accountant)',
  },
  {
    id: 'exp_sch_004',
    date: new Date().toISOString().split('T')[0],
    category: 'MAINTENANCE',
    payee_name: 'City Fire & Safety System Annual Servicing',
    amount_paise: 1850000, // ₹18,500
    payment_mode: 'BANK_TRANSFER',
    voucher_no: 'FIRE-2026-04',
    remarks: 'Fire extinguisher refilling and water sprinkler audit',
    created_by_staff: 'Mr. Amit Shah (Counter 2)',
  },
];

// ----------------------------------------------------------------------------
// 5. SEEDED PAYMENT AUDIT RECORDS
// ----------------------------------------------------------------------------
export const INITIAL_PAYMENT_RECORDS: SchoolFeePaymentRecord[] = [
  {
    id: 'rec_pay_001',
    receipt_no: 'SCH-26-1001',
    date: new Date().toISOString().split('T')[0],
    time: '10:15:30',
    student_id: 'ent_std_001',
    admission_no: 'ADM-2020-044',
    student_name: 'Aarav Rajesh Sharma',
    class_name: 'Class 10',
    section: 'A',
    academic_year: '2026-2027',
    months_paid: ['Apr', 'May', 'Jun', 'Jul'],
    fee_heads: [
      { name: 'Tuition Fee (Class 10)', amount_paise: 520000 },
      { name: 'Computer & Science Lab', amount_paise: 100000 },
      { name: 'Sports & Annual Function', amount_paise: 40000 },
      { name: 'School Bus Transport', amount_paise: 120000 },
    ],
    subtotal_paise: 3440000,
    concession_type: 'NONE',
    concession_paise: 0,
    net_amount_paise: 3440000,
    payment_mode: 'UPI',
    transaction_ref: 'UPI-9821-4432',
    staff_name: 'Mrs. Sunita Rao (Counter 1)',
    remarks: 'Term 1 Paid in full',
  },
  {
    id: 'rec_pay_002',
    receipt_no: 'SCH-26-1002',
    date: new Date().toISOString().split('T')[0],
    time: '11:40:15',
    student_id: 'ent_std_003',
    admission_no: 'ADM-2018-002',
    student_name: 'Rohan Sunil Verma',
    class_name: 'Class 12',
    section: 'A',
    academic_year: '2026-2027',
    months_paid: ['Aug', 'Sep', 'Oct'],
    fee_heads: [
      { name: 'Tuition Fee (Class 12)', amount_paise: 700000 },
      { name: 'Physics/Chem/Bio Labs', amount_paise: 150000 },
      { name: 'Transport Facility', amount_paise: 120000 },
    ],
    subtotal_paise: 2910000,
    concession_type: 'MERIT_10',
    concession_paise: 291000,
    net_amount_paise: 2619000,
    payment_mode: 'BANK_TRANSFER',
    transaction_ref: 'NEFT-ICICI-88219',
    staff_name: 'Mr. Amit Shah (Counter 2)',
    remarks: 'Merit Scholarship Applied',
  },
  {
    id: 'rec_pay_003',
    receipt_no: 'SCH-26-1003',
    date: new Date().toISOString().split('T')[0],
    time: '14:22:00',
    student_id: 'ent_std_004',
    admission_no: 'ADM-2024-055',
    student_name: 'Priya Manish Kapoor',
    class_name: 'Class 5',
    section: 'A',
    academic_year: '2026-2027',
    months_paid: ['Sep', 'Oct'],
    fee_heads: [
      { name: 'Tuition Fee (Class 5)', amount_paise: 350000 },
      { name: 'Computer Lab', amount_paise: 45000 },
      { name: 'Sports & Transport', amount_paise: 155000 },
    ],
    subtotal_paise: 1100000,
    concession_type: 'SIBLING_15',
    concession_paise: 165000,
    net_amount_paise: 935000,
    payment_mode: 'CASH',
    transaction_ref: 'CASH-REC-003',
    staff_name: 'Mrs. Sunita Rao (Counter 1)',
    remarks: 'Sibling Concession 15%',
  },
];

// ----------------------------------------------------------------------------
// 6. PERSISTENCE SERVICE KEYS & HELPERS
// ----------------------------------------------------------------------------
const STORAGE_KEYS = {
  FEE_RULES: 'omnibill_school_fee_rules_v1',
  MONTHLY_FEE_RULES: 'omnibill_school_monthly_fee_rules_v2',
  RECEIPT_SETTINGS: 'omnibill_school_receipt_settings_v1',
  EXPENSES: 'omnibill_school_expenses_v1',
  PAYMENTS: 'omnibill_school_fee_payments_v1',
  STUDENTS: 'omnibill_school_students_v1',
};

export class SchoolDataService {
  private static load<T>(key: string, fallback: T): T {
    if (typeof window === 'undefined') return fallback;
    try {
      const stored = localStorage.getItem(key);
      if (stored) return JSON.parse(stored);
    } catch (e) {
      console.warn(`Failed reading ${key} from storage:`, e);
    }
    return fallback;
  }

  private static save<T>(key: string, data: T): void {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(key, JSON.stringify(data));
      } catch (e) {
        console.error(`Failed saving ${key} to storage:`, e);
      }
    }
  }

  // --- Students Master ---
  static getStudents(): StudentEntity[] {
    const loaded = this.load<StudentEntity[]>(STORAGE_KEYS.STUDENTS, SEEDED_STUDENTS);
    // If user's stored list has fewer students than the full 21 seeded list, ensure all seeded students exist
    if (loaded.length < SEEDED_STUDENTS.length) {
      const existingIds = new Set(loaded.map((s) => s.id));
      const missing = SEEDED_STUDENTS.filter((s) => !existingIds.has(s.id));
      const merged = [...loaded, ...missing];
      this.saveStudents(merged);
      return merged;
    }
    return loaded;
  }

  static saveStudents(students: StudentEntity[]): void {
    this.save(STORAGE_KEYS.STUDENTS, students);
  }

  static addStudent(student: StudentEntity): void {
    const list = this.getStudents();
    list.unshift(student);
    this.saveStudents(list);
  }

  static updateStudentPaidMonths(
    studentId: string,
    newlyPaidMonths: string[],
    monthlyFeePaise: number
  ): StudentEntity | null {
    const students = this.getStudents();
    const student = students.find((s) => s.id === studentId);
    if (!student) return null;

    const existingPaid = student.paid_months || [];
    const mergedPaid = Array.from(new Set([...existingPaid, ...newlyPaidMonths]));
    student.paid_months = mergedPaid;

    // Recalculate remaining dues
    const unpaidMonthsCount = ACADEMIC_MONTHS.filter((m) => !mergedPaid.includes(m)).length;
    student.dues_balance_paise = unpaidMonthsCount * monthlyFeePaise;

    this.saveStudents(students);
    return student;
  }

  // --- Class-Wise General Summary Fee Rules ---
  static getFeeRules(): ClassFeeRule[] {
    return this.load<ClassFeeRule[]>(STORAGE_KEYS.FEE_RULES, INITIAL_CLASS_FEE_RULES);
  }

  static saveFeeRules(rules: ClassFeeRule[]): void {
    this.save(STORAGE_KEYS.FEE_RULES, rules);
  }

  static getRuleForClass(className: string): ClassFeeRule {
    const rules = this.getFeeRules();
    const matched = rules.find((r) => r.class_name.toLowerCase() === className.toLowerCase());
    if (matched) return matched;
    // Default fallback
    return {
      class_name: className,
      tuition_paise: 400000,
      computer_lab_paise: 50000,
      sports_activity_paise: 50000,
      exam_paise: 50000,
      transport_paise: 120000,
      total_monthly_paise: 670000,
    };
  }

  // --- Class-Wise AND Month-Wise Fee Rules (Full 2D Matrix) ---
  static getMonthlyFeeRules(): MonthlyClassFeeRule[] {
    return this.load<MonthlyClassFeeRule[]>(
      STORAGE_KEYS.MONTHLY_FEE_RULES,
      INITIAL_MONTHLY_FEE_RULES
    );
  }

  static saveMonthlyFeeRules(rules: MonthlyClassFeeRule[]): void {
    this.save(STORAGE_KEYS.MONTHLY_FEE_RULES, rules);
  }

  static getRulesForClassAllMonths(className: string): MonthlyClassFeeRule[] {
    const all = this.getMonthlyFeeRules();
    const forClass = all.filter(
      (r) => r.class_name.toLowerCase() === className.toLowerCase()
    );
    if (forClass.length === 12) return forClass;
    // Fallback to initial defaults for this class
    return INITIAL_MONTHLY_FEE_RULES.filter(
      (r) => r.class_name.toLowerCase() === className.toLowerCase()
    );
  }

  static getMonthlyRule(className: string, month: AcademicMonth): MonthlyClassFeeRule {
    const all = this.getMonthlyFeeRules();
    const matched = all.find(
      (r) =>
        r.class_name.toLowerCase() === className.toLowerCase() &&
        r.month === month
    );
    if (matched) return matched;
    return {
      class_name: className,
      month,
      tuition_paise: 400000,
      computer_lab_paise: 50000,
      sports_activity_paise: 40000,
      exam_paise: 40000,
      transport_paise: 120000,
      annual_charge_paise: month === 'Apr' ? 300000 : 0,
      total_paise: month === 'Apr' ? 950000 : 650000,
    };
  }

  static updateMonthlyRule(
    className: string,
    month: AcademicMonth,
    updates: Partial<MonthlyClassFeeRule>
  ): void {
    const rules = this.getMonthlyFeeRules();
    const idx = rules.findIndex(
      (r) =>
        r.class_name.toLowerCase() === className.toLowerCase() &&
        r.month === month
    );
    if (idx >= 0) {
      const existing = rules[idx];
      const tuition = updates.tuition_paise !== undefined ? updates.tuition_paise : existing.tuition_paise;
      const lab = updates.computer_lab_paise !== undefined ? updates.computer_lab_paise : existing.computer_lab_paise;
      const sports = updates.sports_activity_paise !== undefined ? updates.sports_activity_paise : existing.sports_activity_paise;
      const exam = updates.exam_paise !== undefined ? updates.exam_paise : existing.exam_paise;
      const transport = updates.transport_paise !== undefined ? updates.transport_paise : existing.transport_paise;
      const annual = updates.annual_charge_paise !== undefined ? updates.annual_charge_paise : existing.annual_charge_paise;
      const total = tuition + lab + sports + exam + transport + annual;

      rules[idx] = {
        ...existing,
        ...updates,
        tuition_paise: tuition,
        computer_lab_paise: lab,
        sports_activity_paise: sports,
        exam_paise: exam,
        transport_paise: transport,
        annual_charge_paise: annual,
        total_paise: total,
      };
      this.saveMonthlyFeeRules(rules);
    }
  }

  static copyMonthToAllMonths(className: string, sourceMonth: AcademicMonth): void {
    const rules = this.getMonthlyFeeRules();
    const source = rules.find(
      (r) =>
        r.class_name.toLowerCase() === className.toLowerCase() &&
        r.month === sourceMonth
    );
    if (!source) return;

    const updated = rules.map((r) => {
      if (r.class_name.toLowerCase() === className.toLowerCase()) {
        const total =
          source.tuition_paise +
          source.computer_lab_paise +
          source.sports_activity_paise +
          (r.month === 'Sep' || r.month === 'Mar' ? r.exam_paise : source.exam_paise) +
          source.transport_paise +
          (r.month === 'Apr' ? r.annual_charge_paise : 0);

        return {
          ...r,
          tuition_paise: source.tuition_paise,
          computer_lab_paise: source.computer_lab_paise,
          sports_activity_paise: source.sports_activity_paise,
          transport_paise: source.transport_paise,
          total_paise: total,
        };
      }
      return r;
    });
    this.saveMonthlyFeeRules(updated);
  }

  static resetClassFeeRules(className: string): void {
    const allRules = this.getMonthlyFeeRules();
    const defaults = INITIAL_MONTHLY_FEE_RULES.filter(
      (r) => r.class_name.toLowerCase() === className.toLowerCase()
    );
    const remaining = allRules.filter(
      (r) => r.class_name.toLowerCase() !== className.toLowerCase()
    );
    this.saveMonthlyFeeRules([...remaining, ...defaults]);
  }

  // --- Receipt Settings ---
  static getReceiptSettings(): SchoolReceiptSettings {
    return this.load<SchoolReceiptSettings>(
      STORAGE_KEYS.RECEIPT_SETTINGS,
      INITIAL_RECEIPT_SETTINGS
    );
  }

  static saveReceiptSettings(settings: SchoolReceiptSettings): void {
    this.save(STORAGE_KEYS.RECEIPT_SETTINGS, settings);
  }

  // --- Expenses ---
  static getExpenses(): SchoolExpense[] {
    return this.load<SchoolExpense[]>(STORAGE_KEYS.EXPENSES, INITIAL_SCHOOL_EXPENSES);
  }

  static saveExpenses(expenses: SchoolExpense[]): void {
    this.save(STORAGE_KEYS.EXPENSES, expenses);
  }

  static addExpense(expense: Omit<SchoolExpense, 'id'>): SchoolExpense {
    const expenses = this.getExpenses();
    const newRecord: SchoolExpense = {
      ...expense,
      id: `exp_sch_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    };
    expenses.unshift(newRecord);
    this.saveExpenses(expenses);
    return newRecord;
  }

  // --- Fee Payment Records ---
  static getFeePayments(): SchoolFeePaymentRecord[] {
    return this.load<SchoolFeePaymentRecord[]>(STORAGE_KEYS.PAYMENTS, INITIAL_PAYMENT_RECORDS);
  }

  static saveFeePayments(payments: SchoolFeePaymentRecord[]): void {
    this.save(STORAGE_KEYS.PAYMENTS, payments);
  }

  static recordPayment(payment: Omit<SchoolFeePaymentRecord, 'id'>): SchoolFeePaymentRecord {
    const payments = this.getFeePayments();
    const newRecord: SchoolFeePaymentRecord = {
      ...payment,
      id: `fee_rec_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    };
    payments.unshift(newRecord);
    this.saveFeePayments(payments);
    return newRecord;
  }

  // --- Analytics & Reports Generators ---

  /**
   * Group fee collections date-wise
   */
  static getDateWiseCollection(): Array<{
    date: string;
    total_paise: number;
    receipt_count: number;
    cash_paise: number;
    upi_paise: number;
    bank_paise: number;
  }> {
    const payments = this.getFeePayments();
    const map = new Map<
      string,
      { total: number; count: number; cash: number; upi: number; bank: number }
    >();

    payments.forEach((p) => {
      const existing = map.get(p.date) || { total: 0, count: 0, cash: 0, upi: 0, bank: 0 };
      existing.total += p.net_amount_paise;
      existing.count += 1;
      if (p.payment_mode === 'CASH') existing.cash += p.net_amount_paise;
      else if (p.payment_mode === 'UPI') existing.upi += p.net_amount_paise;
      else existing.bank += p.net_amount_paise;
      map.set(p.date, existing);
    });

    return Array.from(map.entries())
      .map(([date, data]) => ({
        date,
        total_paise: data.total,
        receipt_count: data.count,
        cash_paise: data.cash,
        upi_paise: data.upi,
        bank_paise: data.bank,
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  /**
   * Group fee collections class-wise
   */
  static getClassWiseCollection(): Array<{
    class_name: string;
    total_paise: number;
    students_count: number;
    paid_receipts_count: number;
  }> {
    const payments = this.getFeePayments();
    const students = this.getStudents();

    const classStats = new Map<string, { total: number; count: number; studentCount: number }>();

    // Count students per class
    students.forEach((s) => {
      const existing = classStats.get(s.class_name) || { total: 0, count: 0, studentCount: 0 };
      existing.studentCount += 1;
      classStats.set(s.class_name, existing);
    });

    // Sum collections
    payments.forEach((p) => {
      const existing = classStats.get(p.class_name) || { total: 0, count: 0, studentCount: 0 };
      existing.total += p.net_amount_paise;
      existing.count += 1;
      classStats.set(p.class_name, existing);
    });

    return Array.from(classStats.entries()).map(([className, data]) => ({
      class_name: className,
      total_paise: data.total,
      students_count: data.studentCount,
      paid_receipts_count: data.count,
    }));
  }

  /**
   * Group fee collections staff/cashier-wise
   */
  static getStaffWiseCollection(): Array<{
    staff_name: string;
    total_paise: number;
    receipt_count: number;
    last_collected_at: string;
  }> {
    const payments = this.getFeePayments();
    const map = new Map<string, { total: number; count: number; lastDate: string }>();

    payments.forEach((p) => {
      const staff = p.staff_name || 'Accounts Desk';
      const existing = map.get(staff) || { total: 0, count: 0, lastDate: p.date };
      existing.total += p.net_amount_paise;
      existing.count += 1;
      if (p.date > existing.lastDate) existing.lastDate = p.date;
      map.set(staff, existing);
    });

    return Array.from(map.entries()).map(([staff, data]) => ({
      staff_name: staff,
      total_paise: data.total,
      receipt_count: data.count,
      last_collected_at: data.lastDate,
    }));
  }

  /**
   * Find all defaulting students (who have unpaid months up to current month)
   */
  static getDefaulters(currentMonthIndex = 6): Array<{
    student: StudentEntity;
    unpaidMonths: string[];
    overduePaise: number;
  }> {
    const students = this.getStudents();
    const defaulters: Array<{
      student: StudentEntity;
      unpaidMonths: string[];
      overduePaise: number;
    }> = [];

    // Check months from April up to currentMonthIndex
    const evaluatedMonths = ACADEMIC_MONTHS.slice(0, currentMonthIndex + 1);

    students.forEach((student) => {
      const paid = student.paid_months || [];
      const unpaid = evaluatedMonths.filter((m) => !paid.includes(m));

      if (unpaid.length > 0) {
        let totalDue = 0;
        unpaid.forEach((m) => {
          const rule = this.getMonthlyRule(student.class_name, m as AcademicMonth);
          totalDue += rule.total_paise;
        });

        defaulters.push({
          student,
          unpaidMonths: unpaid,
          overduePaise: totalDue,
        });
      }
    });

    return defaulters.sort((a, b) => b.overduePaise - a.overduePaise);
  }
}

// ----------------------------------------------------------------------------
// 7. EXPORT & SHARE UTILITIES (CSV, WHATSAPP, PRINT HELPERS)
// ----------------------------------------------------------------------------

/**
 * Trigger CSV download of Fee Collections Day Book
 */
export function exportFeeRecordsToCSV(records: SchoolFeePaymentRecord[]): void {
  const headers = [
    'Receipt No',
    'Date',
    'Time',
    'Admission No',
    'Student Name',
    'Class',
    'Section',
    'Academic Year',
    'Months Paid',
    'Gross Fee (INR)',
    'Concession Type',
    'Concession (INR)',
    'Net Amount Paid (INR)',
    'Payment Mode',
    'Txn Reference',
    'Staff Cashier',
    'Remarks',
  ];

  const rows = records.map((r) => [
    `"${r.receipt_no}"`,
    `"${r.date}"`,
    `"${r.time}"`,
    `"${r.admission_no}"`,
    `"${r.student_name.replace(/"/g, '""')}"`,
    `"${r.class_name}"`,
    `"${r.section}"`,
    `"${r.academic_year}"`,
    `"${(r.months_paid || []).join('; ')}"`,
    (r.subtotal_paise / 100).toFixed(2),
    `"${r.concession_type}"`,
    (r.concession_paise / 100).toFixed(2),
    (r.net_amount_paise / 100).toFixed(2),
    `"${r.payment_mode}"`,
    `"${r.transaction_ref || ''}"`,
    `"${r.staff_name || ''}"`,
    `"${(r.remarks || '').replace(/"/g, '""')}"`,
  ]);

  const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `School_Fee_Collection_Report_${new Date().toISOString().split('T')[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Trigger CSV download of Fee Defaulters Register
 */
export function exportDefaultersToCSV(
  defaulters: Array<{ student: StudentEntity; unpaidMonths: string[]; overduePaise: number }>
): void {
  const headers = [
    'Admission No',
    'Student Name',
    'Class',
    'Section',
    'Roll No',
    'Guardian Name',
    'Guardian Phone',
    'Unpaid Months Count',
    'Unpaid Months List',
    'Overdue Amount (INR)',
    'Address',
  ];

  const rows = defaulters.map((d) => [
    `"${d.student.admission_no}"`,
    `"${d.student.full_name.replace(/"/g, '""')}"`,
    `"${d.student.class_name}"`,
    `"${d.student.section}"`,
    `"${d.student.roll_no}"`,
    `"${d.student.guardian_name.replace(/"/g, '""')}"`,
    `"${d.student.guardian_phone || ''}"`,
    d.unpaidMonths.length,
    `"${d.unpaidMonths.join('; ')}"`,
    (d.overduePaise / 100).toFixed(2),
    `"${(d.student.address || '').replace(/"/g, '""')}"`,
  ]);

  const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `School_Fee_Defaulters_Report_${new Date().toISOString().split('T')[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Generate formatted WhatsApp summary text for collections
 */
export function generateCollectionWhatsAppLink(summary: {
  totalPaise: number;
  count: number;
  cashPaise: number;
  upiPaise: number;
  bankPaise: number;
  dateStr?: string;
}): string {
  const dateStr = summary.dateStr || new Date().toISOString().split('T')[0];
  const text = `*ST. XAVIER HIGHER SECONDARY ACADEMY*
*Fee Collection Day-Book Summary*
📅 Date: ${dateStr}
━━━━━━━━━━━━━━━━━━━
🧾 Receipts Issued: *${summary.count}*
💵 Cash Tendered: *₹${(summary.cashPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}*
📱 UPI Collections: *₹${(summary.upiPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}*
🏦 Bank / Cheque: *₹${(summary.bankPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}*
━━━━━━━━━━━━━━━━━━━
💰 *TOTAL NET COLLECTION: ₹${(summary.totalPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}*
━━━━━━━━━━━━━━━━━━━
_Generated via OmniBill Enterprise School ERP_`;

  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/**
 * Generate 1-Click WhatsApp Fee Due Reminder Link to Parent
 */
export function generateStudentFeeWhatsAppLink(
  student: StudentEntity,
  unpaidMonths: string[],
  overduePaise: number
): string {
  const rawPhone = (student.guardian_phone || '').replace(/[^0-9]/g, '');
  const cleanPhone = rawPhone.length === 10 ? `91${rawPhone}` : rawPhone;
  const text = `*FEE DUE REMINDER NOTICE*
*ST. XAVIER HIGHER SECONDARY ACADEMY*

Dear Parent / Guardian (${student.guardian_name}),
Greetings from St. Xavier Academy Accounts Desk.

This is a reminder regarding the outstanding school fees for your ward:
• *Student:* ${student.full_name}
• *Adm No:* ${student.admission_no}
• *Class:* ${student.class_name}-${student.section} (Roll: ${student.roll_no})
• *Unpaid Months:* ${unpaidMonths.join(', ')} (${unpaidMonths.length} Months)
• *Total Outstanding Due:* *₹${(overduePaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}*

Kindly settle the due amount at the School Accounts Counter or via online UPI / Net Banking at your earliest convenience to avoid late fee penalties.

_Warm Regards,_
_Accounts Department_
_St. Xavier Higher Secondary Academy_`;

  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`;
}
