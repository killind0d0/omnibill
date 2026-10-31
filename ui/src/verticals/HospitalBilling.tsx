// ui/src/verticals/HospitalBilling.tsx
// Comprehensive Hospital & Clinical Billing Suite: OPD Consultation, IPD Stays, Diagnostics, Pharmacy, 2-Way Auto-Catch, Fully Editable Final Bill, Watermark & Receipt Customizer, Expenses & Defaulters

import React, { useState, useEffect, useMemo } from 'react';
import {
  HeartPulse,
  UserPlus,
  Stethoscope,
  Pill,
  Bed,
  Plus,
  Trash2,
  Printer,
  CheckCircle2,
  Calendar,
  Clock,
  Search,
  FileText,
  CreditCard,
  X,
  Phone,
  ArrowRight,
  Shield,
  Activity,
  AlertCircle,
  AlertTriangle,
  Sliders,
  Wallet,
  BarChart3,
  Settings,
  Share2,
  Download,
  Copy,
  Receipt,
  Eye,
  Percent,
  Sparkles,
  HelpCircle,
  FlaskConical,
  Microscope,
  Syringe,
  Building,
  Truck,
  TrendingUp,
  PlusCircle,
  PackageCheck,
} from 'lucide-react';
import {
  PatientEntity,
  ResourceItem,
  ResourceLot,
  VerticalCartLine,
  PaymentMode,
  PaymentDetails,
  PostedTransactionReceipt,
  DoctorConsultationRule,
  BedCategoryRule,
  DiagnosticTestItem,
  HospitalExpense,
  HospitalReceiptSettings,
  HospitalBillPaymentRecord,
  HospitalMedicalStockItem,
} from './types';
import {
  PurchaseExpenseBillModal,
  PurchaseExpenseVoucher,
} from '../components/common/PurchaseExpenseBillModal';
import { VerticalIPCBridge } from './ipc';
import {
  HospitalDataService,
  exportHospitalPaymentsToCSV,
  exportPatientsToCSV,
  generateHospitalDayBookWhatsAppLink,
  generatePatientBillWhatsAppLink,
} from './hospitalData';
import { computeSaleTotals, formatPaise, parseRupeesToPaise } from '../lib/tax';
import { paiseToWords } from '../lib/numbersToWords';
import { posSound } from '../lib/sound';

export type HospitalTab = 'BILLING' | 'PATIENTS' | 'DOCTOR_BED_RULES' | 'PHARMACY_STOCK' | 'EXPENSES' | 'REPORTS' | 'RECEIPT_SETTINGS';

export const HospitalBilling: React.FC = () => {
  // Navigation
  const [activeTab, setActiveTab] = useState<HospitalTab>('BILLING');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Core Data
  const [patients, setPatients] = useState<PatientEntity[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState<string>('');
  const [catalog, setCatalog] = useState<ResourceItem[]>([]);
  const [doctorRules, setDoctorRules] = useState<DoctorConsultationRule[]>([]);
  const [bedRules, setBedRules] = useState<BedCategoryRule[]>([]);
  const [diagnosticTests, setDiagnosticTests] = useState<DiagnosticTestItem[]>([]);
  const [expenses, setExpenses] = useState<HospitalExpense[]>([]);
  const [paymentRecords, setPaymentRecords] = useState<HospitalBillPaymentRecord[]>([]);
  const [receiptSettings, setReceiptSettings] = useState<HospitalReceiptSettings>(
    HospitalDataService.getReceiptSettings()
  );

  // Pharmacy & Medical Consumables Stock State
  const [medStock, setMedStock] = useState<HospitalMedicalStockItem[]>(() => HospitalDataService.getMedicalStock());
  const [stockVouchers, setStockVouchers] = useState<PurchaseExpenseVoucher[]>(() => HospitalDataService.getPurchaseVouchers());
  const [activePurchaseVoucher, setActivePurchaseVoucher] = useState<PurchaseExpenseVoucher | null>(null);
  const [isPurchaseVoucherModalOpen, setIsPurchaseVoucherModalOpen] = useState(false);
  const [isNewMedItemModalOpen, setIsNewMedItemModalOpen] = useState(false);
  const [medStockSubTab, setMedStockSubTab] = useState<'STOCK_ROSTER' | 'INWARD_ENTRY' | 'VOUCHERS_HISTORY'>('STOCK_ROSTER');

  // Inward Purchase Form State
  const [inwardSupplier, setInwardSupplier] = useState('Cipla Healthcare Medical Supplies');
  const [inwardGstin, setInwardGstin] = useState('27AAACC1206D1ZM');
  const [inwardPhone, setInwardPhone] = useState('9819922334');
  const [inwardVoucherNo, setInwardVoucherNo] = useState(`GRN-MED-${Date.now().toString().slice(-5)}`);
  const [inwardDate, setInwardDate] = useState(new Date().toISOString().split('T')[0]);
  const [inwardPaymentMode, setInwardPaymentMode] = useState<'CASH' | 'BANK_TRANSFER' | 'CREDIT' | 'UPI'>('BANK_TRANSFER');
  const [inwardRemarks, setInwardRemarks] = useState('');
  const [inwardLines, setInwardLines] = useState<Array<{ itemId: string; name: string; quantity: number; costPricePaise: number }>>([]);
  const [selectedInwardItemId, setSelectedInwardItemId] = useState(medStock[0]?.id || 'med_001');
  const [inwardQty, setInwardQty] = useState('50');
  const [inwardCostRupees, setInwardCostRupees] = useState('');

  // New Clinical Item Form State
  const [newMedName, setNewMedName] = useState('');
  const [newMedCode, setNewMedCode] = useState('');
  const [newMedCategory, setNewMedCategory] = useState<'INJECTIONS' | 'IV_FLUIDS' | 'ANTIBIOTICS' | 'CONSUMABLES' | 'SURGICAL' | 'MEDICINES'>('INJECTIONS');
  const [newMedUnit, setNewMedUnit] = useState('vial');
  const [newMedCostRupees, setNewMedCostRupees] = useState('');
  const [newMedBillingRupees, setNewMedBillingRupees] = useState('');
  const [newMedBatch, setNewMedBatch] = useState(`BATCH-${Date.now().toString().slice(-4)}`);
  const [newMedExpiry, setNewMedExpiry] = useState('2028-12-31');

  // Billing Line Items (100% Fully Editable)
  const [cart, setCart] = useState<VerticalCartLine[]>([]);
  const [concessionMode, setConcessionMode] = useState<'NONE' | 'PERCENT' | 'FLAT'>('NONE');
  const [concessionValue, setConcessionValue] = useState<number>(0);
  const [concessionReason, setConcessionReason] = useState<string>('Senior Citizen Concession');
  const [includePreviousDues, setIncludePreviousDues] = useState<boolean>(false);

  // Two-Way Search States
  const [masterSearchQuery, setMasterSearchQuery] = useState('');
  const [nameSearchQuery, setNameSearchQuery] = useState('');
  const [deptFilter, setDeptFilter] = useState('ALL');
  const [doctorFilter, setDoctorFilter] = useState('ALL');
  const [opdIpdFilter, setOpdIpdFilter] = useState<'ALL' | 'OPD' | 'IPD'>('ALL');

  // Room / Bed Stays state
  const [selectedBedRuleId, setSelectedBedRuleId] = useState<string>('bed_sp');
  const [bedDaysCount, setBedDaysCount] = useState<number>(3);

  // Modals & Receipts
  const [showNewPatientModal, setShowNewPatientModal] = useState(false);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [lastReceipt, setLastReceipt] = useState<PostedTransactionReceipt | null>(null);

  // Payment State
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('UPI');
  const [paymentReference, setPaymentReference] = useState<string>('');
  const [staffName, setStaffName] = useState<string>('Sister Mary D’Souza');

  // New Patient Form State
  const [newUhid, setNewUhid] = useState(`UHID-2026-${Math.floor(1000 + Math.random() * 9000)}`);
  const [newOpdNo, setNewOpdNo] = useState(`OPD-${Math.floor(2000 + Math.random() * 8000)}`);
  const [newFullName, setNewFullName] = useState('');
  const [newAge, setNewAge] = useState<number>(45);
  const [newGender, setNewGender] = useState<'MALE' | 'FEMALE' | 'OTHER'>('MALE');
  const [newDoctorName, setNewDoctorName] = useState('Dr. Anita Joshi, MD (Medicine)');
  const [newDepartment, setNewDepartment] = useState('General Medicine');
  const [newPhone, setNewPhone] = useState('');
  const [newRoomBedNo, setNewRoomBedNo] = useState('OPD Rm 3');
  const [newBloodGroup, setNewBloodGroup] = useState('O+');
  const [newDiagnosis, setNewDiagnosis] = useState('');
  const [newEmergencyContact, setNewEmergencyContact] = useState('');

  // New Expense Form State
  const [expCategory, setExpCategory] = useState<HospitalExpense['category']>('SURGICAL_DISPOSABLES');
  const [expPayee, setExpPayee] = useState('');
  const [expAmountInr, setExpAmountInr] = useState('');
  const [expMode, setExpMode] = useState<PaymentMode>('UPI');
  const [expVoucherNo, setExpVoucherNo] = useState(`EXP-HOSP-${Date.now().toString().slice(-4)}`);
  const [expRemarks, setExpRemarks] = useState('');

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Synchronize two-way inputs when a patient is selected
  const syncPatientInputs = (patient: PatientEntity) => {
    setSelectedPatientId(patient.id);
    setMasterSearchQuery(patient.uhid);
    setNameSearchQuery(patient.full_name);
    setDeptFilter(patient.department);
    setDoctorFilter(patient.doctor_name);
  };

  // Initial Load & Refresh
  const refreshAllData = () => {
    const pts = HospitalDataService.getPatients();
    setPatients(pts);
    if (pts.length > 0 && !selectedPatientId) {
      syncPatientInputs(pts[0]);
    }
    setDoctorRules(HospitalDataService.getDoctorRules());
    setBedRules(HospitalDataService.getBedRules());
    setDiagnosticTests(HospitalDataService.getDiagnosticTests());
    setExpenses(HospitalDataService.getExpenses());
    setPaymentRecords(HospitalDataService.getPayments());
    setReceiptSettings(HospitalDataService.getReceiptSettings());
  };

  useEffect(() => {
    refreshAllData();

    VerticalIPCBridge.getResources('HOSPITAL').then((res) => {
      setCatalog(res);
      // Auto-load OPD Consultation and 1 Pharmacy item if cart empty
      if (cart.length === 0 && res.length >= 2) {
        addItemToClinicalBill(res[0]);
        if (res[2]) addItemToClinicalBill(res[2], '1-0-1 After Food (5 Days)');
      }
    });

    const handleSync = () => {
      setMedStock(HospitalDataService.getMedicalStock());
      VerticalIPCBridge.getResources('HOSPITAL').then(setCatalog);
    };
    window.addEventListener('omnibill_catalog_sync', handleSync);
    return () => window.removeEventListener('omnibill_catalog_sync', handleSync);
  }, []);

  // Currently Selected Patient
  const selectedPatient = useMemo(() => {
    return patients.find((p) => p.id === selectedPatientId) || patients[0] || null;
  }, [patients, selectedPatientId]);

  // Two-Way Smart Match: Handlers
  const handleMasterKeyChange = (val: string) => {
    setMasterSearchQuery(val);
    const query = val.trim().toLowerCase();
    if (!query) return;

    const match = patients.find(
      (p) => p.uhid.toLowerCase() === query || p.uhid.toLowerCase().endsWith(query)
    );
    if (match && match.id !== selectedPatientId) {
      syncPatientInputs(match);
      showToast(`Auto-filled: ${match.full_name} (${match.uhid})`);
    }
  };

  const handleNameSearchChange = (val: string) => {
    setNameSearchQuery(val);
    const query = val.trim().toLowerCase();
    if (!query) return;

    const match = patients.find(
      (p) =>
        p.full_name.toLowerCase().includes(query) ||
        (p.phone && p.phone.includes(query)) ||
        p.opd_no.toLowerCase() === query
    );
    if (match && match.id !== selectedPatientId) {
      syncPatientInputs(match);
    }
  };

  // Filtered Patients for List Views
  const filteredPatients = useMemo(() => {
    return patients.filter((p) => {
      const matchDept = deptFilter === 'ALL' || p.department === deptFilter;
      const matchDoc = doctorFilter === 'ALL' || p.doctor_name === doctorFilter;
      const matchOpdIpd =
        opdIpdFilter === 'ALL' ||
        (opdIpdFilter === 'IPD' ? p.ipd_admitted : !p.ipd_admitted);
      const matchSearch =
        !nameSearchQuery.trim() ||
        p.full_name.toLowerCase().includes(nameSearchQuery.toLowerCase()) ||
        p.uhid.toLowerCase().includes(nameSearchQuery.toLowerCase()) ||
        (p.phone && p.phone.includes(nameSearchQuery));

      return matchDept && matchDoc && matchOpdIpd && matchSearch;
    });
  }, [patients, deptFilter, doctorFilter, opdIpdFilter, nameSearchQuery]);

  // Add Item to Clinical Bill (Consultation, Diagnostics, Pharmacy, Custom)
  const addItemToClinicalBill = (resource: ResourceItem, dosage?: string) => {
    posSound.playItemAdd();
    const defaultLot = resource.lots && resource.lots.length > 0 ? resource.lots[0] : undefined;

    const newLine: VerticalCartLine = {
      id: `hosp_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      resource_id: resource.id,
      sku: resource.sku,
      name: resource.name,
      hsn_sac: resource.hsn_sac,
      unit: resource.unit,
      tax_rate_bps: resource.tax_rate_bps,
      quantity_milli: 1000,
      unit_price_paise: resource.base_price_paise,
      mrp_paise: defaultLot?.mrp_paise || resource.mrp_paise,
      discount_paise: 0,
      lot_id: defaultLot?.id,
      batch_number: defaultLot?.batch_number,
      expiry_date: defaultLot?.expiry_date,
      gross_paise: resource.base_price_paise,
      taxable_paise: resource.base_price_paise,
      cgst_paise: 0,
      sgst_paise: 0,
      igst_paise: 0,
      line_total_paise: resource.base_price_paise,
      dosage_instructions: dosage || (resource.category === 'Pharmacy' ? '1 Tab Twice Daily' : undefined),
    };

    setCart((prev) => [...prev, newLine]);
  };

  // Add Diagnostic Test to Bill
  const addDiagnosticTestToBill = (test: DiagnosticTestItem) => {
    posSound.playItemAdd();
    const newLine: VerticalCartLine = {
      id: `diag_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      resource_id: test.id,
      sku: test.test_code,
      name: `${test.test_name} (${test.department})`,
      hsn_sac: '999313', // Medical Diagnostic Services
      unit: 'TEST',
      tax_rate_bps: 0, // Diagnostic exempt from GST
      quantity_milli: 1000,
      unit_price_paise: test.fee_paise,
      discount_paise: 0,
      gross_paise: test.fee_paise,
      taxable_paise: test.fee_paise,
      cgst_paise: 0,
      sgst_paise: 0,
      igst_paise: 0,
      line_total_paise: test.fee_paise,
    };
    setCart((prev) => [...prev, newLine]);
    showToast(`Added Diagnostic: ${test.test_name}`);
  };

  // Add Doctor Consultation by Rule
  const addDoctorConsultToBill = (doc: DoctorConsultationRule, type: 'OPD' | 'EMERGENCY' | 'FOLLOWUP' = 'OPD') => {
    posSound.playItemAdd();
    const fee =
      type === 'EMERGENCY'
        ? doc.emergency_fee_paise
        : type === 'FOLLOWUP'
        ? doc.follow_up_fee_paise
        : doc.opd_fee_paise;

    const label =
      type === 'EMERGENCY'
        ? `Emergency / Triage Consultation — ${doc.doctor_name}`
        : type === 'FOLLOWUP'
        ? `Follow-Up Consultation — ${doc.doctor_name}`
        : `OPD Specialist Consultation — ${doc.doctor_name} (${doc.department})`;

    const newLine: VerticalCartLine = {
      id: `doc_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      resource_id: doc.id,
      sku: `CONSULT-${type}`,
      name: label,
      hsn_sac: '999312',
      unit: 'VISIT',
      tax_rate_bps: 0,
      quantity_milli: 1000,
      unit_price_paise: fee,
      discount_paise: 0,
      gross_paise: fee,
      taxable_paise: fee,
      cgst_paise: 0,
      sgst_paise: 0,
      igst_paise: 0,
      line_total_paise: fee,
    };
    setCart((prev) => [...prev, newLine]);
    showToast(`Added: ${doc.doctor_name} (${type})`);
  };

  // Add Bed / Room Stay to Bill
  const addBedStayCharges = () => {
    posSound.playItemAdd();
    const rule = bedRules.find((b) => b.id === selectedBedRuleId) || bedRules[1] || bedRules[0];
    const totalDaily = rule.total_daily_paise;
    const totalBedPaise = totalDaily * bedDaysCount;

    const newLine: VerticalCartLine = {
      id: `bed_${Date.now()}`,
      resource_id: rule.id,
      sku: `BED-${rule.room_type}`,
      name: `${rule.category_name} (${bedDaysCount} Days Stay + Nursing @ ₹${(totalDaily / 100).toLocaleString('en-IN')}/day)`,
      hsn_sac: '999311',
      unit: 'DAYS',
      tax_rate_bps: 0, // Hospital bed exempt
      quantity_milli: bedDaysCount * 1000,
      unit_price_paise: totalDaily,
      discount_paise: 0,
      gross_paise: totalBedPaise,
      taxable_paise: totalBedPaise,
      cgst_paise: 0,
      sgst_paise: 0,
      igst_paise: 0,
      line_total_paise: totalBedPaise,
      days_count: bedDaysCount,
    };

    setCart((prev) => [...prev, newLine]);
    showToast(`Added: ${rule.category_name} for ${bedDaysCount} days`);
  };

  // Add Custom Clinical Service Line (100% Flexible)
  const addCustomClinicalService = () => {
    posSound.playItemAdd();
    const newLine: VerticalCartLine = {
      id: `custom_${Date.now()}`,
      resource_id: 'res_custom_hosp',
      sku: 'SRV-CUSTOM',
      name: 'Emergency Nursing & Dressing Charges',
      hsn_sac: '999319',
      unit: 'NOS',
      tax_rate_bps: 0,
      quantity_milli: 1000,
      unit_price_paise: 50000, // ₹500
      discount_paise: 0,
      gross_paise: 50000,
      taxable_paise: 50000,
      cgst_paise: 0,
      sgst_paise: 0,
      igst_paise: 0,
      line_total_paise: 50000,
    };
    setCart((prev) => [...prev, newLine]);
  };

  // Inline Line Item Edits
  const handleLineNameChange = (id: string, newName: string) => {
    setCart((prev) =>
      prev.map((l) => (l.id === id ? { ...l, name: newName } : l))
    );
  };

  const handleLinePriceChange = (id: string, rupees: number) => {
    const paise = Math.max(0, Math.round(rupees * 100));
    setCart((prev) =>
      prev.map((l) => {
        if (l.id !== id) return l;
        const qtyUnits = l.quantity_milli / 1000;
        const gross = Math.round(paise * qtyUnits);
        return {
          ...l,
          unit_price_paise: paise,
          gross_paise: gross,
          taxable_paise: gross,
          line_total_paise: gross,
        };
      })
    );
  };

  const handleLineDosageChange = (id: string, dosage: string) => {
    setCart((prev) =>
      prev.map((l) => (l.id === id ? { ...l, dosage_instructions: dosage } : l))
    );
  };

  const handleRemoveLine = (id: string) => {
    posSound.playWarning();
    setCart((prev) => prev.filter((l) => l.id !== id));
  };

  // Bill Financial Totals Calculation
  const subtotalPaise = useMemo(() => {
    return cart.reduce((acc, l) => acc + l.line_total_paise, 0);
  }, [cart]);

  const calculatedConcessionPaise = useMemo(() => {
    if (concessionMode === 'PERCENT') {
      return Math.round((subtotalPaise * Math.min(100, Math.max(0, concessionValue))) / 100);
    }
    if (concessionMode === 'FLAT') {
      return Math.min(subtotalPaise, Math.max(0, Math.round(concessionValue * 100)));
    }
    return 0;
  }, [subtotalPaise, concessionMode, concessionValue]);

  const previousDuesPaise = useMemo(() => {
    if (!includePreviousDues || !selectedPatient) return 0;
    return selectedPatient.dues_balance_paise || 0;
  }, [includePreviousDues, selectedPatient]);

  const finalNetPayablePaise = Math.max(0, subtotalPaise - calculatedConcessionPaise + previousDuesPaise);

  // Post Hospital Bill & Transaction
  const handlePostHospitalBill = async () => {
    if (cart.length === 0 || !selectedPatient) return;
    posSound.playSuccess();

    const payment: PaymentDetails = {
      mode: paymentMode,
      amount_tendered_paise: finalNetPayablePaise,
      change_due_paise: 0,
      reference_number: paymentReference || `HOSP-TXN-${Date.now().toString().slice(-6)}`,
    };

    const receipt = await VerticalIPCBridge.postTransaction({
      verticalMode: 'HOSPITAL',
      entityType: 'PATIENT',
      entityId: selectedPatient.id,
      entityName: selectedPatient.full_name,
      entityDetails: {
        ...selectedPatient,
        blood_group: selectedPatient.blood_group,
        diagnosis: selectedPatient.diagnosis,
        emergency_contact: selectedPatient.emergency_contact,
        concession_reason: concessionMode !== 'NONE' ? concessionReason : undefined,
      },
      lines: cart,
      totals: {
        subtotal_paise: subtotalPaise,
        discount_paise: calculatedConcessionPaise,
        taxable_paise: subtotalPaise - calculatedConcessionPaise,
        cgst_paise: 0,
        sgst_paise: 0,
        igst_paise: 0,
        round_off_paise: 0,
        total_amount_paise: finalNetPayablePaise,
      },
      payment,
      notes: `Medical Invoicing • UHID: ${selectedPatient.uhid} • Attending: ${selectedPatient.doctor_name}`,
    });

    // Record into Audit Payments Log
    const newRecord: HospitalBillPaymentRecord = {
      id: `hosp_pmt_${Date.now()}`,
      receipt_no: receipt.invoice_number,
      date: new Date().toISOString().split('T')[0],
      patient_id: selectedPatient.id,
      patient_name: selectedPatient.full_name,
      uhid: selectedPatient.uhid,
      opd_no: selectedPatient.opd_no,
      doctor_name: selectedPatient.doctor_name,
      department: selectedPatient.department,
      bill_type: cart.some((c) => c.sku.includes('BED')) ? 'IPD_DISCHARGE' : 'OPD_CONSULT',
      subtotal_paise: subtotalPaise,
      discount_paise: calculatedConcessionPaise,
      tax_paise: 0,
      net_paid_paise: finalNetPayablePaise,
      payment_mode: paymentMode,
      transaction_ref: paymentReference || receipt.invoice_number,
      staff_name: staffName,
      remarks: concessionMode !== 'NONE' ? concessionReason : 'Regular Clinical Settlement',
    };

    HospitalDataService.recordPayment(newRecord);
    setPaymentRecords((prev) => [newRecord, ...prev]);

    setLastReceipt(receipt);
    setShowInvoiceModal(true);
    showToast(`Bill #${receipt.invoice_number} successfully posted to ledger!`);
  };

  // Register New Patient
  const handleRegisterPatient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFullName.trim()) return;

    const newPatient: PatientEntity = {
      id: `ent_pat_${Date.now()}`,
      entity_code: newUhid,
      entity_type: 'PATIENT',
      full_name: newFullName.trim(),
      uhid: newUhid,
      opd_no: newOpdNo,
      age: newAge,
      gender: newGender,
      doctor_name: newDoctorName,
      department: newDepartment,
      room_bed_no: newRoomBedNo,
      phone: newPhone.trim(),
      blood_group: newBloodGroup,
      diagnosis: newDiagnosis.trim(),
      emergency_contact: newEmergencyContact.trim(),
      state_code: '27',
      is_active: true,
      dues_balance_paise: 0,
      last_visit_date: new Date().toISOString().split('T')[0],
      ipd_admitted: newRoomBedNo.toLowerCase().includes('bed') || newRoomBedNo.toLowerCase().includes('icu'),
    };

    await VerticalIPCBridge.createEntity(newPatient);
    HospitalDataService.addPatient(newPatient);
    setPatients((prev) => [newPatient, ...prev]);
    syncPatientInputs(newPatient);
    setShowNewPatientModal(false);

    // Refresh default values for next patient
    setNewFullName('');
    setNewUhid(`UHID-2026-${Math.floor(1000 + Math.random() * 9000)}`);
    setNewOpdNo(`OPD-${Math.floor(2000 + Math.random() * 8000)}`);
    showToast(`Patient ${newPatient.full_name} registered!`);
  };

  // Add Operational Expense
  const handleAddExpense = (e: React.FormEvent) => {
    e.preventDefault();
    const paise = Math.round(parseFloat(expAmountInr || '0') * 100);
    if (paise <= 0 || !expPayee.trim()) {
      showToast('Enter valid payee and positive amount!');
      return;
    }

    const newExp: HospitalExpense = {
      id: `exp_hosp_${Date.now()}`,
      date: new Date().toISOString().split('T')[0],
      category: expCategory,
      payee: expPayee.trim(),
      amount_paise: paise,
      payment_mode: expMode,
      voucher_no: expVoucherNo.trim(),
      remarks: expRemarks.trim(),
    };

    HospitalDataService.addExpense(newExp);
    setExpenses((prev) => [newExp, ...prev]);
    setExpPayee('');
    setExpAmountInr('');
    setExpRemarks('');
    setExpVoucherNo(`EXP-HOSP-${Date.now().toString().slice(-4)}`);
    showToast(`Expense voucher ${newExp.voucher_no} recorded!`);
  };

  return (
    <div className="flex flex-col h-full w-full bg-slate-950 text-slate-100 overflow-hidden font-sans">
      {/* TOAST ALERT BANNER */}
      {toastMessage && (
        <div className="bg-gradient-to-r from-rose-600 to-indigo-600 px-4 py-2 text-white text-xs font-semibold flex items-center justify-between shadow-lg animate-in slide-in-from-top z-50">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-300" />
            <span>{toastMessage}</span>
          </div>
          <button onClick={() => setToastMessage(null)} className="text-white hover:text-slate-200">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* TOP HEADER: HOSPITAL ERP NAVIGATION */}
      <div className="bg-slate-900 border-b border-slate-800 px-4 py-2.5 flex items-center justify-between z-20 shrink-0">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-rose-500 to-pink-600 flex items-center justify-center shadow-md shadow-rose-500/20">
            <HeartPulse className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-extrabold text-sm tracking-tight text-white">
                {receiptSettings.hospital_name}
              </span>
              <span className="px-2 py-0.5 bg-rose-500/15 text-rose-300 border border-rose-500/30 rounded-full text-[10px] font-bold">
                NABH Accredited
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Billing Desk • Staff:{' '}
              <span className="text-rose-300 font-semibold">{staffName}</span> • Reg:{' '}
              <span className="font-mono text-slate-300">{receiptSettings.registration_number}</span>
            </p>
          </div>
        </div>

        {/* 6 CORE FUNCTIONAL TABS */}
        <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 gap-1 overflow-x-auto max-w-full">
          <button
            onClick={() => setActiveTab('BILLING')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center space-x-1.5 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'BILLING'
                ? 'bg-rose-600 text-white shadow-sm shadow-rose-600/40'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Receipt className="w-3.5 h-3.5" />
            <span>Clinical Billing</span>
          </button>

          <button
            onClick={() => setActiveTab('PATIENTS')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center space-x-1.5 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'PATIENTS'
                ? 'bg-rose-600 text-white shadow-sm shadow-rose-600/40'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Patients & Dues ({patients.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('DOCTOR_BED_RULES')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center space-x-1.5 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'DOCTOR_BED_RULES'
                ? 'bg-rose-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Doctor & Bed Presets</span>
          </button>

          <button
            onClick={() => setActiveTab('PHARMACY_STOCK')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center space-x-1.5 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'PHARMACY_STOCK'
                ? 'bg-rose-600 text-white shadow-sm shadow-rose-600/40'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Pill className="w-3.5 h-3.5" />
            <span>Pharmacy & Medical Stock</span>
          </button>

          <button
            onClick={() => setActiveTab('EXPENSES')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center space-x-1.5 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'EXPENSES'
                ? 'bg-rose-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Wallet className="w-3.5 h-3.5" />
            <span>Hospital Expenses</span>
          </button>

          <button
            onClick={() => setActiveTab('REPORTS')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center space-x-1.5 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'REPORTS'
                ? 'bg-rose-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            <span>Revenue & Audit</span>
          </button>

          <button
            onClick={() => setActiveTab('RECEIPT_SETTINGS')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center space-x-1.5 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'RECEIPT_SETTINGS'
                ? 'bg-rose-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Settings className="w-3.5 h-3.5" />
            <span>Receipt Customizer</span>
          </button>
        </div>
      </div>

      {/* ---------------------------------------------------------------------
          TAB 1: CLINICAL BILLING (OPD / IPD / DIAGNOSTICS / PHARMACY)
      --------------------------------------------------------------------- */}
      {activeTab === 'BILLING' && (
        <div className="flex-1 overflow-y-auto min-h-0 p-4 space-y-4">
          {/* TWO-WAY SMART PATIENT IDENTIFICATION CARD */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md space-y-3">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <HeartPulse className="w-5 h-5 text-rose-400" />
                <h2 className="text-sm font-bold text-white tracking-wide">
                  Patient Vitals & Smart Two-Way Auto-Catch
                </h2>
              </div>
              <button
                onClick={() => setShowNewPatientModal(true)}
                className="flex items-center space-x-1.5 px-3 py-1 bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 rounded-lg text-xs font-semibold transition cursor-pointer"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>+ Register New Patient</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              {/* MASTER KEY SEARCH: UHID */}
              <div>
                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Master Key (UHID)
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={masterSearchQuery}
                    onChange={(e) => handleMasterKeyChange(e.target.value)}
                    placeholder="e.g. UHID-2026-1001"
                    className="w-full bg-slate-950 border border-rose-500/40 rounded-xl px-3 py-2 text-xs font-mono font-bold text-rose-300 focus:outline-none focus:border-rose-400"
                  />
                  <Search className="w-3.5 h-3.5 text-slate-500 absolute right-3 top-2.5" />
                </div>
              </div>

              {/* SECONDARY SEARCH: PATIENT NAME / PHONE */}
              <div>
                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Name / Phone Search
                </label>
                <input
                  type="text"
                  value={nameSearchQuery}
                  onChange={(e) => handleNameSearchChange(e.target.value)}
                  placeholder="e.g. Rameshwar / 98199..."
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-rose-500"
                />
              </div>

              {/* MASTER ROSTER DROPDOWN */}
              <div className="md:col-span-2">
                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Select Patient from Clinical Directory ({patients.length} Profiles)
                </label>
                <select
                  value={selectedPatientId}
                  onChange={(e) => {
                    const match = patients.find((p) => p.id === e.target.value);
                    if (match) syncPatientInputs(match);
                  }}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-rose-500 cursor-pointer"
                >
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.uhid} • {p.full_name} ({p.age}y / {p.gender}) — {p.department} ({p.doctor_name})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* SELECTED PATIENT VITALS STRIP */}
            {selectedPatient && (
              <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-3 flex flex-wrap items-center justify-between gap-4 text-xs">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 rounded-full bg-rose-500/20 border border-rose-500/30 flex items-center justify-center font-bold text-rose-300">
                    {selectedPatient.gender === 'FEMALE' ? '👩' : '👨'}
                  </div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="font-bold text-white text-sm">{selectedPatient.full_name}</span>
                      <span className="px-1.5 py-0.2 bg-slate-800 text-slate-300 rounded font-mono text-[10px]">
                        {selectedPatient.uhid}
                      </span>
                      {selectedPatient.blood_group && (
                        <span className="px-1.5 py-0.2 bg-rose-500/20 text-rose-400 border border-rose-500/30 rounded text-[10px] font-bold">
                          🩸 {selectedPatient.blood_group}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400">
                      {selectedPatient.age} yrs • {selectedPatient.gender} • {selectedPatient.phone}
                    </p>
                  </div>
                </div>

                <div className="border-l border-slate-800 pl-4 hidden md:block">
                  <span className="text-[10px] text-slate-400 block">Attending Doctor & Ward:</span>
                  <span className="font-semibold text-rose-300">{selectedPatient.doctor_name}</span>
                  <p className="text-[11px] text-slate-400">
                    {selectedPatient.department} • <span className="text-white">{selectedPatient.room_bed_no || 'OPD'}</span>
                  </p>
                </div>

                <div className="border-l border-slate-800 pl-4 hidden lg:block">
                  <span className="text-[10px] text-slate-400 block">Diagnosis / Clinical Note:</span>
                  <span className="text-slate-300 italic max-w-xs truncate block">
                    {selectedPatient.diagnosis || 'Clinical evaluation in progress'}
                  </span>
                </div>

                <div className="text-right">
                  <span className="text-[10px] text-slate-400 block">Outstanding Balance</span>
                  <span
                    className={`font-mono font-bold text-sm ${
                      (selectedPatient.dues_balance_paise || 0) > 0 ? 'text-rose-400' : 'text-emerald-400'
                    }`}
                  >
                    {formatPaise(selectedPatient.dues_balance_paise || 0)}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* MAIN 2-COLUMN WORKSPACE: LEFT SERVICES PICKER, RIGHT 100% EDITABLE BILL */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* LEFT COLUMN: QUICK ADD CLINICAL SERVICES (OPD, DIAGNOSTICS, PHARMACY, BED) */}
            <div className="lg:col-span-5 space-y-4">
              {/* Doctor Consultation Quick Picker */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <div className="flex items-center space-x-2">
                    <Stethoscope className="w-4 h-4 text-cyan-400" />
                    <h3 className="text-xs font-bold text-white uppercase tracking-wide">
                      Doctor Consultation Fees
                    </h3>
                  </div>
                </div>

                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {doctorRules.map((doc) => (
                    <div
                      key={doc.id}
                      className="bg-slate-950 p-2.5 rounded-xl border border-slate-800/80 flex items-center justify-between hover:border-slate-700 transition"
                    >
                      <div className="pr-2">
                        <div className="font-bold text-white text-xs">{doc.doctor_name}</div>
                        <div className="text-[10px] text-slate-400">
                          {doc.specialization} • Room {doc.room_no}
                        </div>
                      </div>
                      <div className="flex items-center space-x-1.5 shrink-0">
                        <button
                          onClick={() => addDoctorConsultToBill(doc, 'OPD')}
                          className="px-2 py-1 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-[10px] font-bold transition cursor-pointer"
                        >
                          OPD ₹{doc.opd_fee_paise / 100}
                        </button>
                        <button
                          onClick={() => addDoctorConsultToBill(doc, 'EMERGENCY')}
                          className="px-2 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-[10px] font-bold transition cursor-pointer"
                        >
                          Emerg ₹{doc.emergency_fee_paise / 100}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Diagnostic Lab Tests Picker */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <div className="flex items-center space-x-2">
                    <FlaskConical className="w-4 h-4 text-emerald-400" />
                    <h3 className="text-xs font-bold text-white uppercase tracking-wide">
                      Diagnostic Lab & Imaging Tests
                    </h3>
                  </div>
                </div>

                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {diagnosticTests.map((t) => (
                    <div
                      key={t.id}
                      className="bg-slate-950 p-2.5 rounded-xl border border-slate-800/80 flex items-center justify-between hover:border-slate-700 transition"
                    >
                      <div className="pr-2">
                        <div className="font-semibold text-white text-xs">{t.test_name}</div>
                        <div className="text-[10px] text-slate-400">
                          {t.test_code} • {t.sample_type} • Tat: {t.turnaround_hours}h
                        </div>
                      </div>
                      <button
                        onClick={() => addDiagnosticTestToBill(t)}
                        className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition cursor-pointer shrink-0"
                      >
                        + ₹{t.fee_paise / 100}
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* In-Patient Bed / Room Stay Charges */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <div className="flex items-center space-x-2">
                    <Bed className="w-4 h-4 text-purple-400" />
                    <h3 className="text-xs font-bold text-white uppercase tracking-wide">
                      IPD Room Stay & Nursing Charges
                    </h3>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="col-span-2">
                      <label className="block text-[10px] text-slate-400 font-bold mb-1">
                        Ward / Bed Category
                      </label>
                      <select
                        value={selectedBedRuleId}
                        onChange={(e) => setSelectedBedRuleId(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-white"
                      >
                        {bedRules.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.category_name} (₹{b.total_daily_paise / 100}/day)
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] text-slate-400 font-bold mb-1">Days Stayed</label>
                      <input
                        type="number"
                        min="1"
                        max="90"
                        value={bedDaysCount}
                        onChange={(e) => setBedDaysCount(Math.max(1, parseInt(e.target.value || '1', 10)))}
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-white font-mono"
                      />
                    </div>
                  </div>

                  <button
                    onClick={addBedStayCharges}
                    className="w-full py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-bold flex items-center justify-center space-x-2 transition cursor-pointer shadow-md shadow-purple-600/30"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Add IPD Room & Nursing Stay to Bill</span>
                  </button>
                </div>
              </div>

              {/* Pharmacy Catalog Quick Search */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <div className="flex items-center space-x-2">
                    <Pill className="w-4 h-4 text-amber-400" />
                    <h3 className="text-xs font-bold text-white uppercase tracking-wide">
                      In-House Pharmacy Medicines
                    </h3>
                  </div>
                </div>

                <div className="space-y-2">
                  {catalog
                    .filter((c) => c.category === 'Pharmacy' || c.hsn_sac === '3004')
                    .slice(0, 4)
                    .map((med) => (
                      <div
                        key={med.id}
                        className="bg-slate-950 p-2.5 rounded-xl border border-slate-800/80 flex items-center justify-between hover:border-slate-700 transition"
                      >
                        <div>
                          <div className="font-semibold text-white text-xs">{med.name}</div>
                          <div className="text-[10px] text-slate-400">
                            Batch: {med.lots?.[0]?.batch_number || 'GEN-26'} • Exp: {med.lots?.[0]?.expiry_date || '2027'}
                          </div>
                        </div>
                        <button
                          onClick={() => addItemToClinicalBill(med)}
                          className="px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-bold transition cursor-pointer"
                        >
                          + ₹{med.base_price_paise / 100}
                        </button>
                      </div>
                    ))}
                </div>
              </div>
            </div>

            {/* RIGHT COLUMN: 100% FULLY EDITABLE FINAL BILL & CHECKOUT */}
            <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md flex flex-col justify-between space-y-4">
              <div className="space-y-4">
                {/* BILL HEADER STRIP */}
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div>
                    <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                      <FileText className="w-4 h-4 text-rose-400" />
                      <span>Itemized Medical Bill (100% Fully Editable)</span>
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      Edit descriptions inline, edit rates in ₹ directly, or append custom charges.
                    </p>
                  </div>

                  <button
                    onClick={addCustomClinicalService}
                    className="px-3 py-1.5 bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 rounded-xl text-xs font-bold flex items-center space-x-1.5 transition cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>+ Add Custom Service</span>
                  </button>
                </div>

                {/* EDITABLE BILL TABLE */}
                <div className="overflow-x-auto border border-slate-800 rounded-xl">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-950 text-slate-400 font-bold border-b border-slate-800">
                      <tr>
                        <th className="p-2.5">Service / Head Description</th>
                        <th className="p-2.5 w-32">Dosage / Notes</th>
                        <th className="p-2.5 text-right w-24">Rate (₹)</th>
                        <th className="p-2.5 text-right w-24">Total (₹)</th>
                        <th className="p-2.5 text-center w-10">Del</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 bg-slate-950/40">
                      {cart.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="p-8 text-center text-slate-500">
                            No clinical items on bill. Select consultation, diagnostics, or room charges above.
                          </td>
                        </tr>
                      ) : (
                        cart.map((line) => (
                          <tr key={line.id} className="hover:bg-slate-900/60 transition">
                            <td className="p-2">
                              <input
                                type="text"
                                value={line.name}
                                onChange={(e) => handleLineNameChange(line.id, e.target.value)}
                                className="w-full bg-slate-900 border border-slate-700/80 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-rose-500"
                              />
                            </td>
                            <td className="p-2">
                              <input
                                type="text"
                                value={line.dosage_instructions || ''}
                                onChange={(e) => handleLineDosageChange(line.id, e.target.value)}
                                placeholder="e.g. 1-0-1 TDS"
                                className="w-full bg-slate-900 border border-slate-700/80 rounded-lg px-2 py-1 text-[11px] text-slate-300 focus:outline-none focus:border-rose-500"
                              />
                            </td>
                            <td className="p-2 text-right">
                              <input
                                type="number"
                                min="0"
                                value={line.unit_price_paise / 100}
                                onChange={(e) => handleLinePriceChange(line.id, parseFloat(e.target.value || '0'))}
                                className="w-full bg-slate-900 border border-slate-700/80 rounded-lg px-2 py-1 text-xs text-white text-right font-mono focus:outline-none focus:border-rose-500"
                              />
                            </td>
                            <td className="p-2 text-right font-mono font-bold text-white">
                              ₹{(line.line_total_paise / 100).toLocaleString('en-IN')}
                            </td>
                            <td className="p-2 text-center">
                              <button
                                onClick={() => handleRemoveLine(line.id)}
                                className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-950/40 transition cursor-pointer"
                                title="Remove item"
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

                {/* CONCESSION & PREVIOUS DUES CONTROLS */}
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-3">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                    <div className="flex items-center space-x-2">
                      <Percent className="w-4 h-4 text-rose-400" />
                      <span className="text-xs font-bold text-white">Concession / Medical Relief</span>
                    </div>

                    <div className="flex items-center space-x-1 bg-slate-900 p-0.5 rounded-lg border border-slate-700">
                      <button
                        onClick={() => setConcessionMode('NONE')}
                        className={`px-2 py-1 rounded text-[11px] font-bold ${
                          concessionMode === 'NONE' ? 'bg-slate-800 text-white' : 'text-slate-400'
                        }`}
                      >
                        None
                      </button>
                      <button
                        onClick={() => setConcessionMode('PERCENT')}
                        className={`px-2 py-1 rounded text-[11px] font-bold ${
                          concessionMode === 'PERCENT' ? 'bg-rose-600 text-white' : 'text-slate-400'
                        }`}
                      >
                        % Concession
                      </button>
                      <button
                        onClick={() => setConcessionMode('FLAT')}
                        className={`px-2 py-1 rounded text-[11px] font-bold ${
                          concessionMode === 'FLAT' ? 'bg-rose-600 text-white' : 'text-slate-400'
                        }`}
                      >
                        ₹ Flat Discount
                      </button>
                    </div>
                  </div>

                  {concessionMode !== 'NONE' && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] text-slate-400 font-bold mb-1">
                          {concessionMode === 'PERCENT' ? 'Concession Percentage (%)' : 'Discount Amount (₹)'}
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={concessionValue}
                          onChange={(e) => setConcessionValue(parseFloat(e.target.value || '0'))}
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-400 font-bold mb-1">Concession Reason</label>
                        <input
                          type="text"
                          value={concessionReason}
                          onChange={(e) => setConcessionReason(e.target.value)}
                          placeholder="e.g. Senior Citizen / Staff Relative / EWS"
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                        />
                      </div>
                    </div>
                  )}

                  {/* Previous Dues Option */}
                  {selectedPatient && (selectedPatient.dues_balance_paise || 0) > 0 && (
                    <div className="flex items-center justify-between pt-2 border-t border-slate-800/80">
                      <label className="flex items-center space-x-2 text-xs text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={includePreviousDues}
                          onChange={(e) => setIncludePreviousDues(e.target.checked)}
                          className="rounded border-slate-700 text-rose-600 focus:ring-0"
                        />
                        <span>Include Outstanding Arrears in this Bill</span>
                      </label>
                      <span className="font-mono text-rose-400 font-bold text-xs">
                        +{formatPaise(selectedPatient.dues_balance_paise || 0)}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* FINANCIAL SUMMARY & SETTLEMENT ACTION */}
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
                <div className="space-y-1.5 text-xs border-b border-slate-800 pb-3">
                  <div className="flex justify-between text-slate-400">
                    <span>Clinical Services Subtotal:</span>
                    <span className="font-mono text-white">{formatPaise(subtotalPaise)}</span>
                  </div>

                  {calculatedConcessionPaise > 0 && (
                    <div className="flex justify-between text-rose-400 font-semibold">
                      <span>Concession ({concessionReason}):</span>
                      <span className="font-mono">-{formatPaise(calculatedConcessionPaise)}</span>
                    </div>
                  )}

                  {previousDuesPaise > 0 && (
                    <div className="flex justify-between text-amber-400 font-semibold">
                      <span>Carried Forward Dues:</span>
                      <span className="font-mono">+{formatPaise(previousDuesPaise)}</span>
                    </div>
                  )}

                  <div className="flex justify-between items-center text-base font-extrabold text-white pt-2 border-t border-slate-800">
                    <span>Net Amount Payable:</span>
                    <span className="text-xl font-mono text-rose-400">
                      {formatPaise(finalNetPayablePaise)}
                    </span>
                  </div>
                </div>

                {/* TENDER CONTROLS */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] text-slate-400 font-bold mb-1">Payment Tender Mode</label>
                    <select
                      value={paymentMode}
                      onChange={(e) => setPaymentMode(e.target.value as PaymentMode)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                    >
                      <option value="UPI">UPI / QR Code</option>
                      <option value="CASH">Cash Counter</option>
                      <option value="CARD">Credit / Debit Card</option>
                      <option value="BANK_TRANSFER">NEFT / RTGS</option>
                      <option value="CHEQUE">Cheque / Demand Draft</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] text-slate-400 font-bold mb-1">
                      Txn Ref / Approval Code
                    </label>
                    <input
                      type="text"
                      value={paymentReference}
                      onChange={(e) => setPaymentReference(e.target.value)}
                      placeholder="e.g. UPI-991284 / Card Auth"
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono"
                    />
                  </div>
                </div>

                {/* POST BILL BUTTON */}
                <button
                  disabled={cart.length === 0}
                  onClick={handlePostHospitalBill}
                  className="w-full py-3 bg-gradient-to-r from-rose-600 to-pink-600 hover:from-rose-500 hover:to-pink-500 disabled:opacity-40 text-white rounded-xl text-sm font-bold flex items-center justify-center space-x-2 transition cursor-pointer shadow-lg shadow-rose-600/30"
                >
                  <Receipt className="w-4 h-4" />
                  <span>Generate Medical Bill & Post to Ledger ({formatPaise(finalNetPayablePaise)})</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------------
          TAB 2: PATIENTS DIRECTORY & DUES MANAGEMENT
      --------------------------------------------------------------------- */}
      {activeTab === 'PATIENTS' && (
        <div className="flex-1 overflow-y-auto min-h-0 p-4 space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md space-y-4">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                  <UserPlus className="w-4 h-4 text-rose-400" />
                  <span>Patients Directory & Outstanding Medical Dues</span>
                </h3>
                <p className="text-[11px] text-slate-400">
                  Total {patients.length} registered patients across OPD and IPD wards.
                </p>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={() => exportPatientsToCSV(patients)}
                  className="flex items-center space-x-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold border border-slate-700 transition cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Export CSV</span>
                </button>

                <button
                  onClick={() => setShowNewPatientModal(true)}
                  className="flex items-center space-x-1.5 px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold transition cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Register Patient</span>
                </button>
              </div>
            </div>

            {/* FILTERS */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <input
                type="text"
                placeholder="Search by name, UHID, or phone..."
                value={nameSearchQuery}
                onChange={(e) => setNameSearchQuery(e.target.value)}
                className="bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
              />

              <select
                value={deptFilter}
                onChange={(e) => setDeptFilter(e.target.value)}
                className="bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
              >
                <option value="ALL">All Departments</option>
                <option value="General Medicine">General Medicine</option>
                <option value="Cardiology">Cardiology</option>
                <option value="Pediatrics">Pediatrics</option>
                <option value="Orthopedics">Orthopedics</option>
                <option value="Gynecology & Obstetrics">Gynecology & Obstetrics</option>
                <option value="General Surgery">General Surgery</option>
                <option value="ENT & Pulmonology">ENT & Pulmonology</option>
                <option value="Nephrology & Urology">Nephrology & Urology</option>
                <option value="Emergency & Trauma">Emergency & Trauma</option>
              </select>

              <select
                value={opdIpdFilter}
                onChange={(e) => setOpdIpdFilter(e.target.value as any)}
                className="bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
              >
                <option value="ALL">All Care Modes (OPD + IPD)</option>
                <option value="OPD">OPD Consultation Only</option>
                <option value="IPD">IPD In-Patient Admitted</option>
              </select>

              <div className="text-right text-xs text-slate-400 self-center">
                Showing <span className="font-bold text-white">{filteredPatients.length}</span> of {patients.length} patients
              </div>
            </div>

            {/* PATIENTS TABLE */}
            <div className="overflow-x-auto border border-slate-800 rounded-xl">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950 text-slate-400 font-bold border-b border-slate-800">
                  <tr>
                    <th className="p-3">UHID / OPD No</th>
                    <th className="p-3">Patient Name</th>
                    <th className="p-3">Age / Gender / Blood</th>
                    <th className="p-3">Department & Doctor</th>
                    <th className="p-3">Ward / Bed</th>
                    <th className="p-3 text-right">Outstanding Dues</th>
                    <th className="p-3 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 bg-slate-950/40">
                  {filteredPatients.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-900/60 transition">
                      <td className="p-3 font-mono font-bold text-rose-300">
                        {p.uhid}
                        <span className="block text-[10px] text-slate-500 font-normal">{p.opd_no}</span>
                      </td>
                      <td className="p-3">
                        <span className="font-bold text-white block">{p.full_name}</span>
                        <span className="text-[11px] text-slate-400">{p.phone}</span>
                      </td>
                      <td className="p-3">
                        {p.age}y • {p.gender}
                        {p.blood_group && (
                          <span className="ml-1.5 px-1.5 py-0.2 bg-rose-500/20 text-rose-400 rounded text-[10px] font-bold">
                            {p.blood_group}
                          </span>
                        )}
                      </td>
                      <td className="p-3">
                        <span className="text-white font-medium block">{p.department}</span>
                        <span className="text-[11px] text-slate-400">{p.doctor_name}</span>
                      </td>
                      <td className="p-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            p.ipd_admitted
                              ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {p.room_bed_no || 'OPD'}
                        </span>
                      </td>
                      <td className="p-3 text-right font-mono font-bold">
                        <span className={(p.dues_balance_paise || 0) > 0 ? 'text-rose-400' : 'text-emerald-400'}>
                          {formatPaise(p.dues_balance_paise || 0)}
                        </span>
                      </td>
                      <td className="p-3 text-center">
                        <button
                          onClick={() => {
                            syncPatientInputs(p);
                            setActiveTab('BILLING');
                          }}
                          className="px-2.5 py-1 bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 rounded-lg text-xs font-semibold transition cursor-pointer"
                        >
                          Bill Patient
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

      {/* ---------------------------------------------------------------------
          TAB 3: DOCTOR & BED RATE MASTER CUSTOMIZER
      --------------------------------------------------------------------- */}
      {activeTab === 'DOCTOR_BED_RULES' && (
        <div className="flex-1 overflow-y-auto min-h-0 p-4 space-y-4">
          {/* DOCTOR CONSULTATION MATRIX */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                  <Stethoscope className="w-4 h-4 text-cyan-400" />
                  <span>Attending Doctor Consultation Fee Matrix</span>
                </h3>
                <p className="text-[11px] text-slate-400">
                  Configure regular OPD, emergency triage, and follow-up consultation fees per doctor.
                </p>
              </div>
            </div>

            <div className="overflow-x-auto border border-slate-800 rounded-xl">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950 text-slate-400 font-bold border-b border-slate-800">
                  <tr>
                    <th className="p-3">Doctor Name & Specialization</th>
                    <th className="p-3">Department</th>
                    <th className="p-3">Room / Suite</th>
                    <th className="p-3 text-right w-28">Regular OPD (₹)</th>
                    <th className="p-3 text-right w-28">Emergency (₹)</th>
                    <th className="p-3 text-right w-28">Follow-Up (₹)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 bg-slate-950/40">
                  {doctorRules.map((doc, idx) => (
                    <tr key={doc.id} className="hover:bg-slate-900/60 transition">
                      <td className="p-3">
                        <span className="font-bold text-white block">{doc.doctor_name}</span>
                        <span className="text-[10px] text-slate-400">{doc.degree}</span>
                      </td>
                      <td className="p-3 text-slate-300">{doc.department}</td>
                      <td className="p-3 text-slate-400 font-mono">{doc.room_no}</td>
                      <td className="p-2 text-right">
                        <input
                          type="number"
                          value={doc.opd_fee_paise / 100}
                          onChange={(e) => {
                            const val = Math.max(0, parseFloat(e.target.value || '0') * 100);
                            const updated = [...doctorRules];
                            updated[idx].opd_fee_paise = val;
                            setDoctorRules(updated);
                            HospitalDataService.saveDoctorRules(updated);
                          }}
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white text-right font-mono"
                        />
                      </td>
                      <td className="p-2 text-right">
                        <input
                          type="number"
                          value={doc.emergency_fee_paise / 100}
                          onChange={(e) => {
                            const val = Math.max(0, parseFloat(e.target.value || '0') * 100);
                            const updated = [...doctorRules];
                            updated[idx].emergency_fee_paise = val;
                            setDoctorRules(updated);
                            HospitalDataService.saveDoctorRules(updated);
                          }}
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white text-right font-mono"
                        />
                      </td>
                      <td className="p-2 text-right">
                        <input
                          type="number"
                          value={doc.follow_up_fee_paise / 100}
                          onChange={(e) => {
                            const val = Math.max(0, parseFloat(e.target.value || '0') * 100);
                            const updated = [...doctorRules];
                            updated[idx].follow_up_fee_paise = val;
                            setDoctorRules(updated);
                            HospitalDataService.saveDoctorRules(updated);
                          }}
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white text-right font-mono"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* BED / ROOM CATEGORY MATRIX */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                  <Bed className="w-4 h-4 text-purple-400" />
                  <span>In-Patient Bed & Room Category Daily Charges</span>
                </h3>
                <p className="text-[11px] text-slate-400">
                  Daily room tariffs, monitoring charges, and 24x7 nursing service rates.
                </p>
              </div>
            </div>

            <div className="overflow-x-auto border border-slate-800 rounded-xl">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950 text-slate-400 font-bold border-b border-slate-800">
                  <tr>
                    <th className="p-3">Bed Category</th>
                    <th className="p-3">Room Type</th>
                    <th className="p-3">Description & Monitoring Level</th>
                    <th className="p-3 text-right w-32">Bed Rate / Day (₹)</th>
                    <th className="p-3 text-right w-32">Nursing / Day (₹)</th>
                    <th className="p-3 text-right w-32">Total Tariff / Day</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 bg-slate-950/40">
                  {bedRules.map((b, idx) => (
                    <tr key={b.id} className="hover:bg-slate-900/60 transition">
                      <td className="p-3 font-bold text-white">{b.category_name}</td>
                      <td className="p-3 font-mono text-purple-300 text-[11px]">{b.room_type}</td>
                      <td className="p-3 text-slate-400 text-[11px]">{b.description}</td>
                      <td className="p-2 text-right">
                        <input
                          type="number"
                          value={b.daily_bed_rate_paise / 100}
                          onChange={(e) => {
                            const val = Math.max(0, parseFloat(e.target.value || '0') * 100);
                            const updated = [...bedRules];
                            updated[idx].daily_bed_rate_paise = val;
                            updated[idx].total_daily_paise = val + updated[idx].daily_nursing_paise;
                            setBedRules(updated);
                            HospitalDataService.saveBedRules(updated);
                          }}
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white text-right font-mono"
                        />
                      </td>
                      <td className="p-2 text-right">
                        <input
                          type="number"
                          value={b.daily_nursing_paise / 100}
                          onChange={(e) => {
                            const val = Math.max(0, parseFloat(e.target.value || '0') * 100);
                            const updated = [...bedRules];
                            updated[idx].daily_nursing_paise = val;
                            updated[idx].total_daily_paise = updated[idx].daily_bed_rate_paise + val;
                            setBedRules(updated);
                            HospitalDataService.saveBedRules(updated);
                          }}
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white text-right font-mono"
                        />
                      </td>
                      <td className="p-3 text-right font-mono font-bold text-purple-400">
                        ₹{(b.total_daily_paise / 100).toLocaleString('en-IN')}
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
          TAB 3.5: HOSPITAL PHARMACY & MEDICAL SUPPLIES STOCK INWARD
      --------------------------------------------------------------------- */}
      {activeTab === 'PHARMACY_STOCK' && (
        <div className="flex-1 overflow-y-auto min-h-0 p-4 space-y-4">
          {/* Key Financial Metric Tiles (Purchases vs Patient Billing) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl shadow-sm">
              <div className="flex items-center justify-between text-slate-400 text-xs">
                <span>Patient Billing Revenue (Sold)</span>
                <Receipt className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="text-xl font-black text-emerald-400 font-mono mt-1">
                {formatPaise(paymentRecords.reduce((s, p) => s + p.net_paid_paise, 0))}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                {paymentRecords.length} clinical patient receipts
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl shadow-sm">
              <div className="flex items-center justify-between text-slate-400 text-xs">
                <span>Medical Supplies Purchased (Cost)</span>
                <Truck className="w-4 h-4 text-rose-400" />
              </div>
              <div className="text-xl font-black text-rose-400 font-mono mt-1">
                {formatPaise(stockVouchers.reduce((s, v) => s + v.totalExpensePaise, 0))}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                {stockVouchers.length} inward expense vouchers recorded
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl shadow-sm">
              <div className="flex items-center justify-between text-slate-400 text-xs">
                <span>Net Clinical Operating Spread</span>
                <TrendingUp className="w-4 h-4 text-blue-400" />
              </div>
              {(() => {
                const totalSold = paymentRecords.reduce((s, p) => s + p.net_paid_paise, 0);
                const totalPur = stockVouchers.reduce((s, v) => s + v.totalExpensePaise, 0);
                const diff = totalSold - totalPur;
                return (
                  <div className={`text-xl font-black font-mono mt-1 ${diff >= 0 ? 'text-blue-400' : 'text-amber-400'}`}>
                    {formatPaise(Math.abs(diff))} {diff < 0 && '(Deficit)'}
                  </div>
                );
              })()}
              <div className="text-[10px] text-slate-500 mt-0.5">
                Patient Billings minus Inward Costs
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl shadow-sm">
              <div className="flex items-center justify-between text-slate-400 text-xs">
                <span>Stock Master Roster</span>
                <Pill className="w-4 h-4 text-purple-400" />
              </div>
              <div className="text-xl font-black text-purple-400 font-mono mt-1">
                {medStock.reduce((s, m) => s + m.current_stock, 0).toLocaleString('en-IN')} Units
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                Across {medStock.length} medical lines & batches
              </div>
            </div>
          </div>

          {/* Subtabs Bar */}
          <div className="flex items-center justify-between bg-slate-900 border border-slate-800 p-3 rounded-xl shadow-sm">
            <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
              <button
                onClick={() => setMedStockSubTab('STOCK_ROSTER')}
                className={`px-3 py-1.5 rounded-lg font-bold transition cursor-pointer ${
                  medStockSubTab === 'STOCK_ROSTER'
                    ? 'bg-rose-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Medical Inventory & Stock ({medStock.length})
              </button>
              <button
                onClick={() => setMedStockSubTab('INWARD_ENTRY')}
                className={`px-3 py-1.5 rounded-lg font-bold transition cursor-pointer ${
                  medStockSubTab === 'INWARD_ENTRY'
                    ? 'bg-rose-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                + Inward New Stock & Purchase Bill
              </button>
              <button
                onClick={() => setMedStockSubTab('VOUCHERS_HISTORY')}
                className={`px-3 py-1.5 rounded-lg font-bold transition cursor-pointer ${
                  medStockSubTab === 'VOUCHERS_HISTORY'
                    ? 'bg-rose-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Inward Expense Bills ({stockVouchers.length})
              </button>
            </div>

            <button
              onClick={() => setIsNewMedItemModalOpen(true)}
              className="px-3 py-1.5 bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-300 border border-indigo-500/40 rounded-lg text-xs font-bold flex items-center space-x-1.5 transition cursor-pointer"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              <span>+ Add New Clinical Item</span>
            </button>
          </div>

          {/* SUBTAB 1: STOCK ROSTER */}
          {medStockSubTab === 'STOCK_ROSTER' && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
              <div className="p-3 border-b border-slate-800 flex justify-between items-center text-xs font-bold text-slate-300">
                <span>Hospital Pharmacy & Clinical Supplies Master</span>
                <span className="text-[11px] text-slate-500 font-normal">
                  Tracks purchase rate vs patient billing rate and live stock
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-950 border-b border-slate-800 text-slate-400 font-semibold uppercase text-[10px]">
                    <tr>
                      <th className="py-2.5 px-3">Item Code</th>
                      <th className="py-2.5 px-3">Medical Item / Drug Name</th>
                      <th className="py-2.5 px-3 text-center">Category</th>
                      <th className="py-2.5 px-3 text-center">Batch #</th>
                      <th className="py-2.5 px-3 text-center">Expiry</th>
                      <th className="py-2.5 px-3 text-center">Current Stock</th>
                      <th className="py-2.5 px-3 text-right">Purchase Rate (Cost)</th>
                      <th className="py-2.5 px-3 text-right">Billing Rate (MRP)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-sans">
                    {medStock.map((item) => {
                      const isLowStock = item.current_stock <= item.reorder_level;
                      return (
                        <tr key={item.id} className="hover:bg-slate-800/40">
                          <td className="py-2.5 px-3 font-mono text-slate-400 text-[11px]">{item.item_code}</td>
                          <td className="py-2.5 px-3 font-bold text-white">{item.name}</td>
                          <td className="py-2.5 px-3 text-center">
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-800 text-slate-300">
                              {item.category}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-center font-mono text-slate-400 text-[11px]">
                            {item.batch_no}
                          </td>
                          <td className="py-2.5 px-3 text-center font-mono text-slate-400 text-[11px]">
                            {item.expiry_date}
                          </td>
                          <td className="py-2.5 px-3 text-center font-mono font-bold">
                            <span className={`px-2 py-0.5 rounded ${isLowStock ? 'bg-amber-950/60 text-amber-300 border border-amber-800/60' : 'text-emerald-400'}`}>
                              {item.current_stock.toLocaleString('en-IN')} {item.unit}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono text-slate-300">
                            {formatPaise(item.cost_price_paise)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-rose-400">
                            {formatPaise(item.billing_rate_paise)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* SUBTAB 2: INWARD ENTRY FORM */}
          {medStockSubTab === 'INWARD_ENTRY' && (
            <div className="space-y-4">
              {/* Supplier & Inward Voucher Header */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 bg-slate-900 border border-slate-800 p-4 rounded-xl shadow-sm">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Medical Supplier</label>
                  <input
                    type="text"
                    value={inwardSupplier}
                    onChange={(e) => setInwardSupplier(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white"
                    placeholder="e.g. Cipla Med Depot"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Supplier GSTIN</label>
                  <input
                    type="text"
                    value={inwardGstin}
                    onChange={(e) => setInwardGstin(e.target.value.toUpperCase())}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-mono"
                    placeholder="27AAACC1206D1ZM"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Inward Voucher #</label>
                  <input
                    type="text"
                    value={inwardVoucherNo}
                    onChange={(e) => setInwardVoucherNo(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Payment Mode</label>
                  <select
                    value={inwardPaymentMode}
                    onChange={(e) => setInwardPaymentMode(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white"
                  >
                    <option value="BANK_TRANSFER">Bank Transfer (NEFT/RTGS)</option>
                    <option value="UPI">UPI Payment</option>
                    <option value="CASH">Cash Outflow</option>
                    <option value="CREDIT">Supplier Credit (Pay Later)</option>
                  </select>
                </div>
              </div>

              {/* Add Inward Line Form */}
              <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl space-y-3 shadow-sm">
                <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                  Add Medicine / Consumable to Inward Batch
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                  <div className="md:col-span-2">
                    <label className="block text-xs text-slate-400 mb-1">Select Clinical Item</label>
                    <select
                      value={selectedInwardItemId}
                      onChange={(e) => {
                        setSelectedInwardItemId(e.target.value);
                        const item = medStock.find((s) => s.id === e.target.value);
                        if (item) {
                          setInwardCostRupees((item.cost_price_paise / 100).toFixed(2));
                        }
                      }}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white"
                    >
                      {medStock.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} (Stock: {m.current_stock} {m.unit})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Purchased Quantity</label>
                    <input
                      type="number"
                      value={inwardQty}
                      onChange={(e) => setInwardQty(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-mono font-bold"
                      placeholder="e.g. 50"
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Purchase Rate (₹ Cost)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={inwardCostRupees}
                      onChange={(e) => setInwardCostRupees(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-mono"
                      placeholder="e.g. 45.00"
                    />
                  </div>

                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={() => {
                        const item = medStock.find((s) => s.id === selectedInwardItemId);
                        if (!item) return;
                        const qtyNum = parseInt(inwardQty || '0', 10);
                        if (qtyNum <= 0) {
                          alert('Please enter a valid quantity greater than zero');
                          return;
                        }
                        const costPaise = inwardCostRupees
                          ? Math.round(parseFloat(inwardCostRupees) * 100)
                          : item.cost_price_paise;

                        setInwardLines((prev) => [
                          ...prev,
                          {
                            itemId: item.id,
                            name: item.name,
                            quantity: qtyNum,
                            costPricePaise: costPaise,
                          },
                        ]);
                        setInwardQty('50');
                        setInwardCostRupees('');
                        posSound.playItemAdd();
                      }}
                      className="w-full py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-bold flex items-center justify-center space-x-1.5 transition cursor-pointer shadow-md shadow-rose-600/20"
                    >
                      <Plus className="w-4 h-4" />
                      <span>Add to Inward Bill</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Table of Inward Items */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
                <div className="p-3 border-b border-slate-800 font-bold text-xs text-slate-300 flex justify-between items-center">
                  <span>Inward Items to be Credited ({inwardLines.length})</span>
                  <span className="text-[11px] text-slate-500 font-normal">
                    Increments hospital pharmacy stock and generates an official Purchase Expense Bill
                  </span>
                </div>

                <div className="overflow-x-auto">
                  {inwardLines.length === 0 ? (
                    <div className="p-8 text-center text-slate-500 text-xs space-y-1">
                      <PackageCheck className="w-8 h-8 text-slate-600 mx-auto" />
                      <div>No clinical items added to this inward yet</div>
                    </div>
                  ) : (
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-950 border-b border-slate-800 text-slate-400 font-semibold uppercase text-[10px]">
                        <tr>
                          <th className="py-2.5 px-3">#</th>
                          <th className="py-2.5 px-3">Item Name</th>
                          <th className="py-2.5 px-3 text-center">Purchased Qty</th>
                          <th className="py-2.5 px-3 text-right">Purchase Rate (₹)</th>
                          <th className="py-2.5 px-3 text-right">Total Expense</th>
                          <th className="py-2.5 px-3 text-center">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60 font-sans">
                        {inwardLines.map((l, idx) => {
                          const lineTotal = l.quantity * l.costPricePaise;
                          return (
                            <tr key={idx} className="hover:bg-slate-800/40">
                              <td className="py-2 px-3 font-mono text-slate-500">{idx + 1}</td>
                              <td className="py-2 px-3 font-semibold text-white">{l.name}</td>
                              <td className="py-2 px-3 text-center font-mono font-bold text-emerald-400">
                                {l.quantity.toLocaleString('en-IN')} units
                              </td>
                              <td className="py-2 px-3 text-right font-mono text-slate-300">
                                {formatPaise(l.costPricePaise)}
                              </td>
                              <td className="py-2 px-3 text-right font-mono font-bold text-emerald-400">
                                {formatPaise(lineTotal)}
                              </td>
                              <td className="py-2 px-3 text-center">
                                <button
                                  type="button"
                                  onClick={() => setInwardLines((prev) => prev.filter((_, i) => i !== idx))}
                                  className="p-1 text-slate-500 hover:text-red-400 transition cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* Subtotal & Commit */}
                <div className="p-4 bg-slate-950 border-t border-slate-800 flex items-center justify-between">
                  <div>
                    <span className="text-xs text-slate-400 mr-2">Total Inward Purchase Expense:</span>
                    <span className="text-xl font-black font-mono text-emerald-400">
                      {formatPaise(inwardLines.reduce((s, l) => s + l.quantity * l.costPricePaise, 0))}
                    </span>
                  </div>

                  <button
                    type="button"
                    disabled={inwardLines.length === 0}
                    onClick={() => {
                      const voucher = HospitalDataService.inwardMedicalStock({
                        supplierName: inwardSupplier,
                        supplierGstin: inwardGstin,
                        supplierPhone: inwardPhone,
                        invoiceDate: inwardDate,
                        voucherNumber: inwardVoucherNo,
                        paymentMode: inwardPaymentMode,
                        remarks: inwardRemarks,
                        lines: inwardLines,
                      });

                      setMedStock(HospitalDataService.getMedicalStock());
                      setStockVouchers(HospitalDataService.getPurchaseVouchers());
                      setExpenses(HospitalDataService.getExpenses());
                      setActivePurchaseVoucher(voucher);
                      setIsPurchaseVoucherModalOpen(true);
                      setInwardLines([]);
                      setInwardVoucherNo(`GRN-MED-${Date.now().toString().slice(-5)}`);
                      posSound.playSuccess();
                      showToast(`Hospital Inward ${voucher.voucherNumber} posted! Stock updated and Expense Bill generated.`);
                    }}
                    className={`px-6 py-2.5 rounded-xl text-xs font-bold flex items-center space-x-2 transition cursor-pointer ${
                      inwardLines.length > 0
                        ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/30'
                        : 'bg-slate-800 text-slate-600 cursor-not-allowed'
                    }`}
                  >
                    <PackageCheck className="w-4 h-4" />
                    <span>Post Inward & Generate Expense Bill</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* SUBTAB 3: VOUCHERS HISTORY */}
          {medStockSubTab === 'VOUCHERS_HISTORY' && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm p-4 space-y-3">
              <div className="flex justify-between items-center pb-2 border-b border-slate-800">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                    <Receipt className="w-4 h-4 text-rose-400" />
                    <span>Hospital Medical Stock Inward & Expense Vouchers</span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Official goods received notes with supplier rates, quantities, and proof of purchase expense
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-xs text-slate-400">Total Inward Outflow:</span>
                  <span className="text-base font-bold text-emerald-400 font-mono ml-2">
                    {formatPaise(stockVouchers.reduce((s, v) => s + v.totalExpensePaise, 0))}
                  </span>
                </div>
              </div>

              {stockVouchers.length === 0 ? (
                <div className="p-8 text-center text-slate-500 text-xs">
                  No medical inward expense vouchers recorded yet.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-950 border-b border-slate-800 text-slate-400 font-semibold uppercase text-[10px] sticky top-0 z-10">
                      <tr>
                        <th className="py-2.5 px-3">Voucher #</th>
                        <th className="py-2.5 px-3">Date</th>
                        <th className="py-2.5 px-3">Medical Supplier</th>
                        <th className="py-2.5 px-3 text-center">Items</th>
                        <th className="py-2.5 px-3">Payment Mode</th>
                        <th className="py-2.5 px-3 text-right">Total Expense</th>
                        <th className="py-2.5 px-3 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-sans">
                      {stockVouchers.map((v, idx) => (
                        <tr key={idx} className="hover:bg-slate-800/40">
                          <td className="py-2.5 px-3 font-mono font-bold text-rose-400">{v.voucherNumber}</td>
                          <td className="py-2.5 px-3 font-mono text-slate-300">{v.invoiceDate}</td>
                          <td className="py-2.5 px-3 font-semibold text-white">{v.supplierName}</td>
                          <td className="py-2.5 px-3 text-center font-mono">{v.items.length} items</td>
                          <td className="py-2.5 px-3">
                            <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[10px]">
                              {v.paymentMode}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-400">
                            {formatPaise(v.totalExpensePaise)}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <button
                              type="button"
                              onClick={() => {
                                setActivePurchaseVoucher(v);
                                setIsPurchaseVoucherModalOpen(true);
                              }}
                              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-[11px] font-semibold flex items-center space-x-1 mx-auto transition cursor-pointer"
                            >
                              <Eye className="w-3 h-3 text-blue-400" />
                              <span>View Bill</span>
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ---------------------------------------------------------------------
          TAB 4: HOSPITAL EXPENSES & VOUCHER TRACKER
      --------------------------------------------------------------------- */}
      {activeTab === 'EXPENSES' && (
        <div className="flex-1 overflow-y-auto min-h-0 p-4 space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* RECORD EXPENSE FORM */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md space-y-3">
              <div className="flex items-center space-x-2 border-b border-slate-800 pb-2">
                <Wallet className="w-4 h-4 text-rose-400" />
                <h3 className="text-xs font-bold text-white uppercase tracking-wide">
                  Record Hospital Operational Expense
                </h3>
              </div>

              <form onSubmit={handleAddExpense} className="space-y-3">
                <div>
                  <label className="block text-[10px] text-slate-400 font-bold mb-1">Expense Category</label>
                  <select
                    value={expCategory}
                    onChange={(e) => setExpCategory(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                  >
                    <option value="OXYGEN_CYLINDERS">Liquid Medical Oxygen Refills</option>
                    <option value="BIOMEDICAL_WASTE">Biomedical Waste Disposal Payout</option>
                    <option value="SURGICAL_DISPOSABLES">Surgical Syringes & Disposables</option>
                    <option value="PHARMACY_RESTOCK">In-House Pharmacy Bulk Restock</option>
                    <option value="DOCTOR_PAYOUTS">Visiting Specialist Doctor Payouts</option>
                    <option value="UTILITIES">Electricity & Generator Utilities</option>
                    <option value="HOUSEKEEPING">Linen Laundry & Sterilization</option>
                    <option value="MAINTENANCE">Equipment AMC & Maintenance</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] text-slate-400 font-bold mb-1">Payee / Vendor Name</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Praxair Linde Medical Gas"
                    value={expPayee}
                    onChange={(e) => setExpPayee(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] text-slate-400 font-bold mb-1">Amount (₹)</label>
                    <input
                      type="number"
                      required
                      min="1"
                      placeholder="e.g. 15000"
                      value={expAmountInr}
                      onChange={(e) => setExpAmountInr(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] text-slate-400 font-bold mb-1">Payment Mode</label>
                    <select
                      value={expMode}
                      onChange={(e) => setExpMode(e.target.value as PaymentMode)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                    >
                      <option value="BANK_TRANSFER">Bank Transfer / NEFT</option>
                      <option value="UPI">UPI</option>
                      <option value="CHEQUE">Cheque</option>
                      <option value="CASH">Cash Voucher</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] text-slate-400 font-bold mb-1">Voucher Number</label>
                  <input
                    type="text"
                    required
                    value={expVoucherNo}
                    onChange={(e) => setExpVoucherNo(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[10px] text-slate-400 font-bold mb-1">Remarks / Purchase Note</label>
                  <textarea
                    rows={2}
                    value={expRemarks}
                    onChange={(e) => setExpRemarks(e.target.value)}
                    placeholder="e.g. 10 Jumbo D-Type Oxygen Cylinders delivered to ICU"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full py-2.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold transition cursor-pointer shadow-md shadow-rose-600/30"
                >
                  Record Expense Voucher
                </button>
              </form>
            </div>

            {/* EXPENSES LOG TABLE */}
            <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <h3 className="text-xs font-bold text-white uppercase tracking-wide">
                  Hospital Operational Expenses Log
                </h3>
                <span className="text-xs font-mono font-bold text-rose-400">
                  Total: ₹
                  {formatPaise(expenses.reduce((acc, e) => acc + e.amount_paise, 0))}
                </span>
              </div>

              <div className="overflow-x-auto border border-slate-800 rounded-xl max-h-[500px]">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-950 text-slate-400 font-bold border-b border-slate-800">
                    <tr>
                      <th className="p-2.5">Date / Voucher</th>
                      <th className="p-2.5">Category</th>
                      <th className="p-2.5">Payee & Purpose</th>
                      <th className="p-2.5">Mode</th>
                      <th className="p-2.5 text-right">Amount (₹)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 bg-slate-950/40">
                    {expenses.map((e) => (
                      <tr key={e.id} className="hover:bg-slate-900/60 transition">
                        <td className="p-2.5 font-mono text-slate-300">
                          {e.date}
                          <span className="block text-[10px] text-rose-400">{e.voucher_no}</span>
                        </td>
                        <td className="p-2.5 text-slate-300 font-medium">{e.category}</td>
                        <td className="p-2.5">
                          <span className="font-bold text-white block">{e.payee}</span>
                          <span className="text-[10px] text-slate-400">{e.remarks}</span>
                        </td>
                        <td className="p-2.5 font-mono text-slate-400">{e.payment_mode}</td>
                        <td className="p-2.5 text-right font-mono font-bold text-white">
                          ₹{(e.amount_paise / 100).toLocaleString('en-IN')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------------
          TAB 5: REVENUE ANALYTICS & AUDIT REPORTS
      --------------------------------------------------------------------- */}
      {activeTab === 'REPORTS' && (
        <div className="flex-1 overflow-y-auto min-h-0 p-4 space-y-4">
          {/* STATS OVERVIEW CARDS */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                Total Medical Collections
              </span>
              <div className="text-2xl font-black font-mono text-rose-400 mt-1">
                {formatPaise(paymentRecords.reduce((acc, p) => acc + p.net_paid_paise, 0))}
              </div>
              <span className="text-[10px] text-slate-500 mt-1 block">
                Across {paymentRecords.length} posted invoices
              </span>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                Outstanding Patient Arrears
              </span>
              <div className="text-2xl font-black font-mono text-amber-400 mt-1">
                {formatPaise(patients.reduce((acc, p) => acc + (p.dues_balance_paise || 0), 0))}
              </div>
              <span className="text-[10px] text-slate-500 mt-1 block">Pending recovery from {patients.filter(p => (p.dues_balance_paise || 0) > 0).length} patients</span>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                Operational Expenses
              </span>
              <div className="text-2xl font-black font-mono text-purple-400 mt-1">
                {formatPaise(expenses.reduce((acc, e) => acc + e.amount_paise, 0))}
              </div>
              <span className="text-[10px] text-slate-500 mt-1 block">Medical oxygen, bio-waste, surgicals</span>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                Registered Patients
              </span>
              <div className="text-2xl font-black font-mono text-cyan-400 mt-1">
                {patients.length} Profiles
              </div>
              <span className="text-[10px] text-slate-500 mt-1 block">
                {patients.filter((p) => p.ipd_admitted).length} IPD in-patients currently admitted
              </span>
            </div>
          </div>

          {/* ACTIONS & PAYMENT RECORDS TABLE */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                  <BarChart3 className="w-4 h-4 text-rose-400" />
                  <span>Clinical Billing Day-Book & Settlement Log</span>
                </h3>
                <p className="text-[11px] text-slate-400">
                  Itemized audit trail of OPD consultations, IPD room settlements, diagnostics, and pharmacy bills.
                </p>
              </div>

              <div className="flex items-center space-x-2">
                {/* Print Day-Book */}
                <button
                  onClick={() => window.print()}
                  className="flex items-center space-x-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold border border-slate-700 transition cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Print Day-Book</span>
                </button>

                {/* WhatsApp Dispatch */}
                <a
                  href={generateHospitalDayBookWhatsAppLink(
                    new Date().toISOString().split('T')[0],
                    paymentRecords.reduce((acc, p) => acc + p.net_paid_paise, 0),
                    paymentRecords.length,
                    staffName
                  )}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center space-x-1.5 px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  <Share2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span>WhatsApp Summary</span>
                </a>

                {/* Export CSV */}
                <button
                  onClick={() => exportHospitalPaymentsToCSV(paymentRecords)}
                  className="flex items-center space-x-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold border border-slate-700 transition cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Export CSV</span>
                </button>
              </div>
            </div>

            <div className="overflow-x-auto border border-slate-800 rounded-xl">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950 text-slate-400 font-bold border-b border-slate-800">
                  <tr>
                    <th className="p-3">Receipt / Date</th>
                    <th className="p-3">UHID / Patient</th>
                    <th className="p-3">Doctor & Department</th>
                    <th className="p-3">Care Mode</th>
                    <th className="p-3">Tender</th>
                    <th className="p-3 text-right">Subtotal</th>
                    <th className="p-3 text-right">Discount</th>
                    <th className="p-3 text-right">Net Paid</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 bg-slate-950/40">
                  {paymentRecords.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-900/60 transition">
                      <td className="p-3 font-mono font-bold text-rose-300">
                        {r.receipt_no}
                        <span className="block text-[10px] text-slate-500 font-normal">{r.date}</span>
                      </td>
                      <td className="p-3">
                        <span className="font-bold text-white block">{r.patient_name}</span>
                        <span className="text-[10px] text-slate-400 font-mono">{r.uhid}</span>
                      </td>
                      <td className="p-3">
                        <span className="text-white block">{r.doctor_name}</span>
                        <span className="text-[10px] text-slate-400">{r.department}</span>
                      </td>
                      <td className="p-3 font-mono text-[11px] text-purple-300">{r.bill_type}</td>
                      <td className="p-3 font-mono text-slate-400">{r.payment_mode}</td>
                      <td className="p-3 text-right font-mono text-slate-400">
                        ₹{(r.subtotal_paise / 100).toLocaleString('en-IN')}
                      </td>
                      <td className="p-3 text-right font-mono text-rose-400">
                        ₹{(r.discount_paise / 100).toLocaleString('en-IN')}
                      </td>
                      <td className="p-3 text-right font-mono font-bold text-emerald-400">
                        ₹{(r.net_paid_paise / 100).toLocaleString('en-IN')}
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
          TAB 6: RECEIPT CUSTOMIZER & LIVE WATERMARK PREVIEW
      --------------------------------------------------------------------- */}
      {activeTab === 'RECEIPT_SETTINGS' && (
        <div className="flex-1 overflow-y-auto min-h-0 p-4 space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* SETTINGS FORM */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md space-y-4">
              <div className="flex items-center space-x-2 border-b border-slate-800 pb-3">
                <Settings className="w-4 h-4 text-rose-400" />
                <h3 className="text-sm font-bold text-white">Hospital Medical Receipt Customizer</h3>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-400 mb-1">Hospital / Clinic Name</label>
                  <input
                    type="text"
                    value={receiptSettings.hospital_name}
                    onChange={(e) => {
                      const updated = { ...receiptSettings, hospital_name: e.target.value };
                      setReceiptSettings(updated);
                      HospitalDataService.saveReceiptSettings(updated);
                    }}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-400 mb-1">State Reg / License No</label>
                    <input
                      type="text"
                      value={receiptSettings.registration_number}
                      onChange={(e) => {
                        const updated = { ...receiptSettings, registration_number: e.target.value };
                        setReceiptSettings(updated);
                        HospitalDataService.saveReceiptSettings(updated);
                      }}
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-400 mb-1">NABH Accreditation No</label>
                    <input
                      type="text"
                      value={receiptSettings.nabh_accreditation_no}
                      onChange={(e) => {
                        const updated = { ...receiptSettings, nabh_accreditation_no: e.target.value };
                        setReceiptSettings(updated);
                        HospitalDataService.saveReceiptSettings(updated);
                      }}
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-400 mb-1">Hospital Address</label>
                  <input
                    type="text"
                    value={receiptSettings.address}
                    onChange={(e) => {
                      const updated = { ...receiptSettings, address: e.target.value };
                      setReceiptSettings(updated);
                      HospitalDataService.saveReceiptSettings(updated);
                    }}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-400 mb-1">Phone / Reception</label>
                    <input
                      type="text"
                      value={receiptSettings.phone}
                      onChange={(e) => {
                        const updated = { ...receiptSettings, phone: e.target.value };
                        setReceiptSettings(updated);
                        HospitalDataService.saveReceiptSettings(updated);
                      }}
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-400 mb-1">24x7 Emergency Helpline</label>
                    <input
                      type="text"
                      value={receiptSettings.emergency_helpline}
                      onChange={(e) => {
                        const updated = { ...receiptSettings, emergency_helpline: e.target.value };
                        setReceiptSettings(updated);
                        HospitalDataService.saveReceiptSettings(updated);
                      }}
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono"
                    />
                  </div>
                </div>

                {/* WATERMARK ADJUSTER */}
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white">Live Watermark Behind Invoices</span>
                    <input
                      type="checkbox"
                      checked={receiptSettings.show_watermark}
                      onChange={(e) => {
                        const updated = { ...receiptSettings, show_watermark: e.target.checked };
                        setReceiptSettings(updated);
                        HospitalDataService.saveReceiptSettings(updated);
                      }}
                      className="rounded border-slate-700 text-rose-600 focus:ring-0"
                    />
                  </div>

                  {receiptSettings.show_watermark && (
                    <div className="space-y-2 pt-2 border-t border-slate-800">
                      <div>
                        <label className="block text-[10px] text-slate-400 font-bold mb-1">Watermark Text</label>
                        <input
                          type="text"
                          value={receiptSettings.watermark_text}
                          onChange={(e) => {
                            const updated = { ...receiptSettings, watermark_text: e.target.value };
                            setReceiptSettings(updated);
                            HospitalDataService.saveReceiptSettings(updated);
                          }}
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white font-bold"
                        />
                      </div>

                      <div>
                        <div className="flex justify-between text-[10px] text-slate-400 font-bold mb-1">
                          <span>Watermark Opacity:</span>
                          <span>{Math.round(receiptSettings.watermark_opacity * 100)}%</span>
                        </div>
                        <input
                          type="range"
                          min="0.02"
                          max="0.4"
                          step="0.01"
                          value={receiptSettings.watermark_opacity}
                          onChange={(e) => {
                            const updated = { ...receiptSettings, watermark_opacity: parseFloat(e.target.value) };
                            setReceiptSettings(updated);
                            HospitalDataService.saveReceiptSettings(updated);
                          }}
                          className="w-full accent-rose-500"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* LOGO URL */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-400 mb-1">Hospital Logo URL</label>
                  <input
                    type="text"
                    value={receiptSettings.logo_url}
                    onChange={(e) => {
                      const updated = { ...receiptSettings, logo_url: e.target.value };
                      setReceiptSettings(updated);
                      HospitalDataService.saveReceiptSettings(updated);
                    }}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                  />
                </div>
              </div>
            </div>

            {/* LIVE PREVIEW OF WATERMARKED RECEIPT */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <span className="text-xs font-bold text-white flex items-center space-x-1.5">
                  <Eye className="w-3.5 h-3.5 text-rose-400" />
                  <span>Live Preview (Laser A4 / Thermal Format)</span>
                </span>
                <span className="text-[10px] text-slate-400">WYSIWYG Print Mockup</span>
              </div>

              {/* RENDERED INVOICE PREVIEW CONTAINER WITH WATERMARK */}
              <div className="bg-white text-slate-900 rounded-xl p-6 shadow-2xl relative overflow-hidden select-text text-xs min-h-[520px] flex flex-col justify-between">
                {/* WATERMARK LAYER */}
                {receiptSettings.show_watermark && (
                  <div
                    className="absolute inset-0 flex items-center justify-center pointer-events-none select-none z-0"
                    style={{ opacity: receiptSettings.watermark_opacity }}
                  >
                    <span className="text-6xl font-black text-rose-900 -rotate-30 tracking-widest text-center uppercase">
                      {receiptSettings.watermark_text}
                    </span>
                  </div>
                )}

                {/* INVOICE CONTENT (ABOVE WATERMARK) */}
                <div className="relative z-10 space-y-4">
                  {/* Header */}
                  <div className="flex justify-between items-start border-b border-slate-200 pb-3">
                    <div className="flex items-center space-x-3">
                      {receiptSettings.logo_url && (
                        <img
                          src={receiptSettings.logo_url}
                          alt="Hospital Logo"
                          className="w-12 h-12 object-cover rounded-lg border border-slate-200"
                        />
                      )}
                      <div>
                        <h1 className="font-extrabold text-sm text-slate-900">{receiptSettings.hospital_name}</h1>
                        <p className="text-[10px] text-slate-600 font-medium">{receiptSettings.address}</p>
                        <p className="text-[10px] text-slate-500">
                          Reg No: {receiptSettings.registration_number} • NABH: {receiptSettings.nabh_accreditation_no}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="px-2 py-0.5 bg-rose-100 text-rose-800 border border-rose-300 rounded font-bold text-[10px]">
                        MEDICAL RECEIPT
                      </span>
                      <p className="font-mono text-xs font-bold mt-1">#MED-2026-PREVIEW</p>
                    </div>
                  </div>

                  {/* Patient Info */}
                  <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200 grid grid-cols-2 gap-2 text-[11px]">
                    <div>
                      <span className="text-slate-500">Patient:</span>{' '}
                      <span className="font-bold text-slate-900">{selectedPatient?.full_name || 'Rameshwar Kulkarni'}</span>
                      <span className="block text-slate-500">
                        UHID: <span className="font-mono font-bold text-slate-800">{selectedPatient?.uhid || 'UHID-2026-1001'}</span>
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-slate-500">Doctor:</span>{' '}
                      <span className="font-semibold text-slate-900">{selectedPatient?.doctor_name || 'Dr. Anita Joshi, MD'}</span>
                      <span className="block text-slate-500">Ward: {selectedPatient?.room_bed_no || 'OPD Rm 3'}</span>
                    </div>
                  </div>

                  {/* Items Mock */}
                  <div className="space-y-1.5 text-[11px]">
                    <div className="flex justify-between font-bold border-b border-slate-300 pb-1">
                      <span>Service Head Description</span>
                      <span>Amount</span>
                    </div>
                    <div className="flex justify-between text-slate-800">
                      <span>Doctor Specialist OPD Consultation</span>
                      <span className="font-mono font-medium">₹600.00</span>
                    </div>
                    <div className="flex justify-between text-slate-800">
                      <span>Complete Blood Count (CBC) with Automated Differential</span>
                      <span className="font-mono font-medium">₹450.00</span>
                    </div>
                    <div className="flex justify-between text-slate-800">
                      <span>Augmentin 625 Duo (Strip of 10) - 1-0-1 After Food</span>
                      <span className="font-mono font-medium">₹198.00</span>
                    </div>
                  </div>
                </div>

                {/* Footer and Total */}
                <div className="relative z-10 border-t border-slate-200 pt-3 space-y-2 text-[11px]">
                  <div className="flex justify-between items-center text-sm font-black text-slate-900">
                    <span>Total Amount Paid (INR):</span>
                    <span className="font-mono text-base text-rose-700">₹1,248.00</span>
                  </div>
                  <p className="text-[10px] text-slate-500 italic">
                    {receiptSettings.discharge_instructions}
                  </p>
                  <div className="flex justify-between items-end pt-3">
                    <span className="text-[9px] text-slate-400">Emergency 24x7: {receiptSettings.emergency_helpline}</span>
                    <div className="text-center">
                      <div className="w-28 border-b border-slate-400 mb-1"></div>
                      <span className="text-[9px] font-bold text-slate-600">Authorized Signature</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------------
          MODAL 1: REGISTER NEW PATIENT
      --------------------------------------------------------------------- */}
      {showNewPatientModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 w-full max-w-lg rounded-2xl p-5 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                <UserPlus className="w-4 h-4 text-rose-400" />
                <span>Register New Clinical Patient (OPD / IPD)</span>
              </h3>
              <button
                onClick={() => setShowNewPatientModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleRegisterPatient} className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">Auto-Generated UHID</label>
                  <input
                    type="text"
                    required
                    value={newUhid}
                    onChange={(e) => setNewUhid(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-rose-300 font-bold"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">OPD / IPD Slip No</label>
                  <input
                    type="text"
                    required
                    value={newOpdNo}
                    onChange={(e) => setNewOpdNo(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 mb-1">Full Patient Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Aniket Sudhir Deshmukh"
                  value={newFullName}
                  onChange={(e) => setNewFullName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">Age (Years)</label>
                  <input
                    type="number"
                    min="0"
                    max="120"
                    required
                    value={newAge}
                    onChange={(e) => setNewAge(parseInt(e.target.value || '0', 10))}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">Gender</label>
                  <select
                    value={newGender}
                    onChange={(e) => setNewGender(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                  >
                    <option value="MALE">Male</option>
                    <option value="FEMALE">Female</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">Blood Group</label>
                  <select
                    value={newBloodGroup}
                    onChange={(e) => setNewBloodGroup(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono font-bold"
                  >
                    <option value="O+">O+</option>
                    <option value="O-">O-</option>
                    <option value="A+">A+</option>
                    <option value="A-">A-</option>
                    <option value="B+">B+</option>
                    <option value="B-">B-</option>
                    <option value="AB+">AB+</option>
                    <option value="AB-">AB-</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">Department</label>
                  <select
                    value={newDepartment}
                    onChange={(e) => setNewDepartment(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                  >
                    <option value="General Medicine">General Medicine</option>
                    <option value="Cardiology">Cardiology</option>
                    <option value="Pediatrics">Pediatrics</option>
                    <option value="Orthopedics">Orthopedics</option>
                    <option value="Gynecology & Obstetrics">Gynecology & Obstetrics</option>
                    <option value="General Surgery">General Surgery</option>
                    <option value="ENT & Pulmonology">ENT & Pulmonology</option>
                    <option value="Nephrology & Urology">Nephrology & Urology</option>
                    <option value="Emergency & Trauma">Emergency & Trauma</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">Attending Doctor</label>
                  <input
                    type="text"
                    required
                    value={newDoctorName}
                    onChange={(e) => setNewDoctorName(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">Phone Number</label>
                  <input
                    type="tel"
                    required
                    placeholder="+91 98200 11223"
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">Room / Bed No</label>
                  <input
                    type="text"
                    placeholder="e.g. OPD Rm 3 / Semi-Private 204"
                    value={newRoomBedNo}
                    onChange={(e) => setNewRoomBedNo(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 mb-1">Clinical Diagnosis</label>
                <input
                  type="text"
                  placeholder="e.g. Acute Gastritis / Hypertension review"
                  value={newDiagnosis}
                  onChange={(e) => setNewDiagnosis(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 mb-1">Emergency Attendant Contact</label>
                <input
                  type="text"
                  placeholder="e.g. Rohit (Son) - +91 98200 55441"
                  value={newEmergencyContact}
                  onChange={(e) => setNewEmergencyContact(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                />
              </div>

              <button
                type="submit"
                className="w-full py-2.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold transition cursor-pointer shadow-md shadow-rose-600/30"
              >
                Complete Patient Registration & Open Billing
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------------
          MODAL 2: POST-TRANSACTION MEDICAL INVOICE & DISPATCH
      --------------------------------------------------------------------- */}
      {showInvoiceModal && lastReceipt && selectedPatient && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 w-full max-w-xl rounded-2xl p-5 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                <span>Medical Receipt Generated — #{lastReceipt.invoice_number}</span>
              </h3>
              <button
                onClick={() => setShowInvoiceModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* WATERMARKED PREVIEW CARD */}
            <div className="bg-white text-slate-900 rounded-xl p-5 shadow-lg relative overflow-hidden select-text text-xs space-y-3">
              {receiptSettings.show_watermark && (
                <div
                  className="absolute inset-0 flex items-center justify-center pointer-events-none select-none z-0"
                  style={{ opacity: receiptSettings.watermark_opacity }}
                >
                  <span className="text-5xl font-black text-rose-900 -rotate-30 tracking-widest text-center uppercase">
                    {receiptSettings.watermark_text}
                  </span>
                </div>
              )}

              <div className="relative z-10 space-y-3">
                <div className="flex justify-between items-start border-b border-slate-200 pb-2">
                  <div>
                    <h2 className="font-extrabold text-sm">{receiptSettings.hospital_name}</h2>
                    <p className="text-[10px] text-slate-600">{receiptSettings.address}</p>
                    <p className="text-[10px] text-slate-500">Reg: {receiptSettings.registration_number}</p>
                  </div>
                  <div className="text-right">
                    <span className="px-2 py-0.5 bg-rose-100 text-rose-800 rounded font-bold text-[10px]">
                      PAID RECEIPT
                    </span>
                    <p className="font-mono text-xs font-bold mt-1">#{lastReceipt.invoice_number}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 bg-slate-50 p-2 rounded text-[11px]">
                  <div>
                    <span className="text-slate-500">Patient:</span> <b>{selectedPatient.full_name}</b>
                    <span className="block text-slate-500 font-mono">UHID: {selectedPatient.uhid}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-slate-500">Doctor:</span> {selectedPatient.doctor_name}
                    <span className="block text-slate-500">Date: {lastReceipt.invoice_date}</span>
                  </div>
                </div>

                <div className="space-y-1 text-[11px]">
                  {lastReceipt.lines.map((l) => (
                    <div key={l.id} className="flex justify-between text-slate-800">
                      <span>{l.name}</span>
                      <span className="font-mono">{formatPaise(l.line_total_paise)}</span>
                    </div>
                  ))}
                </div>

                <div className="border-t border-slate-200 pt-2 flex justify-between font-black text-sm">
                  <span>Net Amount Paid:</span>
                  <span className="text-rose-700 font-mono">
                    {formatPaise(lastReceipt.totals.total_amount_paise)}
                  </span>
                </div>

                {/* Amount in Words */}
                <div className="text-[10px] text-slate-600 italic pt-1 leading-snug">
                  <span className="font-semibold not-italic">Amount in Words:</span> {paiseToWords(lastReceipt.totals.total_amount_paise)}
                </div>
              </div>
            </div>

            {/* ACTION DISPATCH CONTROLS */}
            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                type="button"
                onClick={() => window.print()}
                className="py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold flex items-center justify-center space-x-2 transition cursor-pointer"
              >
                <Printer className="w-4 h-4 text-cyan-400" />
                <span>Print Medical Receipt</span>
              </button>

              <a
                href={generatePatientBillWhatsAppLink(
                  selectedPatient,
                  lastReceipt.invoice_number,
                  lastReceipt.totals.total_amount_paise,
                  lastReceipt.lines.map((l) => l.name).slice(0, 3).join(', ')
                )}
                target="_blank"
                rel="noreferrer"
                className="py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center justify-center space-x-2 transition cursor-pointer shadow-md shadow-emerald-600/30 text-center"
              >
                <Share2 className="w-4 h-4" />
                <span>WhatsApp to Patient</span>
              </a>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Add New Clinical Item / Medicine to Hospital Master */}
      {isNewMedItemModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-3 sm:p-4 animate-in fade-in duration-150">
          <div
            className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full max-h-[90vh] overflow-y-auto p-5 space-y-4 shadow-2xl animate-in zoom-in-95"
            role="dialog"
            aria-modal="true"
            aria-labelledby="clinical-drug-title"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <Pill className="w-5 h-5 text-rose-400" />
                <h3 id="clinical-drug-title" className="text-sm font-bold text-white">Add New Clinical Drug / Consumable</h3>
              </div>
              <button
                onClick={() => setIsNewMedItemModalOpen(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Item / Medicine Name *</label>
                <input
                  type="text"
                  value={newMedName}
                  onChange={(e) => setNewMedName(e.target.value)}
                  placeholder="e.g. Meropenem 1g IV Infusion"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Item Code</label>
                  <input
                    type="text"
                    value={newMedCode}
                    onChange={(e) => setNewMedCode(e.target.value.toUpperCase())}
                    placeholder="MED-MERO-1G"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Category</label>
                  <select
                    value={newMedCategory}
                    onChange={(e) => setNewMedCategory(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white"
                  >
                    <option value="INJECTIONS">Injections</option>
                    <option value="IV_FLUIDS">IV Fluids</option>
                    <option value="ANTIBIOTICS">Antibiotics</option>
                    <option value="CONSUMABLES">Consumables</option>
                    <option value="SURGICAL">Surgical</option>
                    <option value="MEDICINES">Oral Medicines</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Unit</label>
                  <select
                    value={newMedUnit}
                    onChange={(e) => setNewMedUnit(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white"
                  >
                    <option value="vial">vial</option>
                    <option value="ampoule">ampoule</option>
                    <option value="bottle">bottle</option>
                    <option value="box">box</option>
                    <option value="pack">pack</option>
                    <option value="roll">roll</option>
                    <option value="pcs">pcs</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Purchase Rate (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={newMedCostRupees}
                    onChange={(e) => setNewMedCostRupees(e.target.value)}
                    placeholder="450.00"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Billing Rate (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={newMedBillingRupees}
                    onChange={(e) => setNewMedBillingRupees(e.target.value)}
                    placeholder="750.00"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Batch Number</label>
                  <input
                    type="text"
                    value={newMedBatch}
                    onChange={(e) => setNewMedBatch(e.target.value.toUpperCase())}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Expiry Date</label>
                  <input
                    type="date"
                    value={newMedExpiry}
                    onChange={(e) => setNewMedExpiry(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono"
                  />
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsNewMedItemModalOpen(false)}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!newMedName.trim()) {
                      alert('Medicine/Item name is required');
                      return;
                    }
                    const costPaise = Math.round(parseFloat(newMedCostRupees || '100') * 100);
                    const billPaise = Math.round(parseFloat(newMedBillingRupees || '150') * 100);
                    const newItem: HospitalMedicalStockItem = {
                      id: `med_${Date.now()}`,
                      item_code: newMedCode.trim() || `MED-${Date.now().toString().slice(-4)}`,
                      name: newMedName.trim(),
                      category: newMedCategory,
                      unit: newMedUnit,
                      current_stock: 0,
                      cost_price_paise: costPaise,
                      billing_rate_paise: billPaise,
                      batch_no: newMedBatch.trim() || 'BATCH-01',
                      expiry_date: newMedExpiry || '2028-12-31',
                      reorder_level: 20,
                    };

                    const updated = HospitalDataService.addMedicalStockItem(newItem);
                    setMedStock(updated);
                    setSelectedInwardItemId(newItem.id);
                    setInwardCostRupees((costPaise / 100).toFixed(2));
                    setIsNewMedItemModalOpen(false);
                    setNewMedName('');
                    setNewMedCode('');
                    setNewMedCostRupees('');
                    setNewMedBillingRupees('');
                    posSound.playSuccess();
                    showToast(`Added ${newItem.name} to pharmacy stock!`);
                  }}
                  className="px-4 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-lg font-bold shadow-md shadow-rose-600/30 cursor-pointer"
                >
                  Save & Inward
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Printable & Shareable Hospital Purchase Expense Bill */}
      <PurchaseExpenseBillModal
        isOpen={isPurchaseVoucherModalOpen}
        onClose={() => setIsPurchaseVoucherModalOpen(false)}
        voucher={activePurchaseVoucher}
      />
    </div>
  );
};
