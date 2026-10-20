// ui/src/verticals/HospitalBilling.tsx
// Hospital & Clinic Mode: Patient Registration (UHID, Age, Gender, Doctor), OPD Consultation, Pharmacy Billing, Room/Bed Charges

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
} from 'lucide-react';
import {
  PatientEntity,
  ResourceItem,
  ResourceLot,
  VerticalCartLine,
  PaymentMode,
  PaymentDetails,
  PostedTransactionReceipt,
  HospitalBillMeta,
} from './types';
import { VerticalIPCBridge } from './ipc';
import { computeSaleTotals, formatPaise, parseRupeesToPaise } from '../lib/tax';

export const HospitalBilling: React.FC = () => {
  // State
  const [patients, setPatients] = useState<PatientEntity[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState<string>('');
  const [catalog, setCatalog] = useState<ResourceItem[]>([]);

  // 3-in-1 Clinical Billing Line Items
  const [cart, setCart] = useState<VerticalCartLine[]>([]);

  // Room / Bed Stays state
  const [roomCategory, setRoomCategory] = useState<string>('Semi-Private Room & Monitored Bed (Per Day)');
  const [bedDaysCount, setBedDaysCount] = useState<number>(3);
  const [bedRatePaise, setBedRatePaise] = useState<number>(350000); // ₹3,500/day
  const [nursingChargesPaise, setNursingChargesPaise] = useState<number>(50000); // ₹500/day

  // Modals & Receipts
  const [showNewPatientModal, setShowNewPatientModal] = useState(false);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [lastReceipt, setLastReceipt] = useState<PostedTransactionReceipt | null>(null);

  // Payment State
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('CARD');
  const [paymentReference, setPaymentReference] = useState<string>('');

  // New Patient Form State
  const [newUhid, setNewUhid] = useState(`UHID-2026-${Math.floor(1000 + Math.random() * 9000)}`);
  const [newOpdNo, setNewOpdNo] = useState(`OPD-${Math.floor(2000 + Math.random() * 8000)}`);
  const [newFullName, setNewFullName] = useState('');
  const [newAge, setNewAge] = useState<number>(35);
  const [newGender, setNewGender] = useState<'MALE' | 'FEMALE' | 'OTHER'>('MALE');
  const [newDoctorName, setNewDoctorName] = useState('Dr. Anita Joshi, MD (Medicine)');
  const [newDepartment, setNewDepartment] = useState('General Medicine');
  const [newPhone, setNewPhone] = useState('');
  const [newRoomBedNo, setNewRoomBedNo] = useState('OPD Clinic 1');

  // Load Patients & Clinical Resources
  useEffect(() => {
    VerticalIPCBridge.getEntities('PATIENT').then((list) => {
      setPatients(list as PatientEntity[]);
      if (list.length > 0 && !selectedPatientId) {
        setSelectedPatientId(list[0].id);
      }
    });

    VerticalIPCBridge.getResources('HOSPITAL').then((res) => {
      setCatalog(res);
      // Auto-load OPD Consultation and 1 Pharmacy item for quick demo
      if (cart.length === 0 && res.length >= 3) {
        // 1. OPD Consult
        addItemToClinicalBill(res[0]);
        // 2. Augmentin Pharmacy
        addItemToClinicalBill(res[2], '1-0-1 After Food (5 Days)');
      }
    });
  }, []);

  const selectedPatient = useMemo(() => {
    return patients.find((p) => p.id === selectedPatientId) || patients[0] || null;
  }, [patients, selectedPatientId]);

  // Add Item to Clinical Bill (Consultation, Pharmacy, or Bed)
  const addItemToClinicalBill = (resource: ResourceItem, dosage?: string) => {
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

  const removeClinicalItem = (lineId: string) => {
    setCart((prev) => prev.filter((l) => l.id !== lineId));
  };

  const updateQuantity = (lineId: string, qtyUnits: number) => {
    setCart((prev) =>
      prev.map((l) => {
        if (l.id !== lineId) return l;
        const qMilli = Math.max(1, qtyUnits) * 1000;
        return { ...l, quantity_milli: qMilli };
      })
    );
  };

  // Add Bed / Room Charges to Bill
  const addBedStayCharges = () => {
    const totalBedPaise = (bedRatePaise + nursingChargesPaise) * bedDaysCount;
    const newLine: VerticalCartLine = {
      id: `bed_${Date.now()}`,
      resource_id: 'res_hosp_bed_stay',
      sku: 'BED-CHARGES',
      name: `${roomCategory} (${bedDaysCount} Days Stay + Nursing)`,
      hsn_sac: '999311',
      unit: 'DAYS',
      tax_rate_bps: 0, // Inpatient hospital bed exempt
      quantity_milli: bedDaysCount * 1000,
      unit_price_paise: bedRatePaise + nursingChargesPaise,
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
  };

  // Group items by category for clear clinical review
  const consultationLines = useMemo(() => {
    return cart.filter((l) => l.hsn_sac === '999312' || l.sku.includes('CONSULT'));
  }, [cart]);

  const pharmacyLines = useMemo(() => {
    return cart.filter((l) => l.hsn_sac === '3004' || l.sku.includes('PHARM'));
  }, [cart]);

  const bedLines = useMemo(() => {
    return cart.filter((l) => l.hsn_sac === '999311' || l.sku.includes('BED'));
  }, [cart]);

  // Compute Bill Totals
  const computedDocument = useMemo(() => {
    const rawLines = cart.map((line) => ({
      ...line,
      id: line.id,
      resource_id: line.resource_id,
      sku: line.sku,
      barcode: line.barcode || '',
      name: line.name,
      hsn: line.hsn_sac,
      unit: line.unit,
      quantity_milli: line.quantity_milli,
      unit_price_paise: line.unit_price_paise,
      discount_paise: line.discount_paise,
      tax_rate_bps: line.tax_rate_bps,
    }));

    return computeSaleTotals(rawLines as any, 'EXCLUSIVE', '27', '27');
  }, [cart]);

  const grandTotalPaise = computedDocument.totals.total_amount_paise;

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
      state_code: '27',
      is_active: true,
    };

    await VerticalIPCBridge.createEntity(newPatient);
    setPatients((prev) => [newPatient, ...prev]);
    setSelectedPatientId(newPatient.id);
    setShowNewPatientModal(false);

    // Refresh default values for next patient
    setNewFullName('');
    setNewUhid(`UHID-2026-${Math.floor(1000 + Math.random() * 9000)}`);
  };

  // Post Hospital Bill
  const handlePostHospitalBill = async () => {
    if (cart.length === 0 || !selectedPatient) return;

    const payment: PaymentDetails = {
      mode: paymentMode,
      amount_tendered_paise: grandTotalPaise,
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
        consultation_count: consultationLines.length,
        pharmacy_count: pharmacyLines.length,
        bed_count: bedLines.length,
      },
      lines: cart,
      totals: computedDocument.totals,
      payment,
      notes: `Clinical Billing & Pharmacy Discharge • UHID: ${selectedPatient.uhid} • Attending: ${selectedPatient.doctor_name}`,
    });

    setLastReceipt(receipt);
    setShowInvoiceModal(true);
  };

  return (
    <div className="flex flex-col h-full w-full bg-slate-950 text-slate-100 p-4 space-y-4 overflow-y-auto">
      {/* TOP ROW: Patient Registration (UHID, Age, Gender, Doctor) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Patient Selection Card */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center space-x-2">
              <HeartPulse className="w-5 h-5 text-rose-400" />
              <h2 className="text-sm font-bold text-slate-100">Patient Electronic Health Record (EHR)</h2>
            </div>
            <button
              onClick={() => setShowNewPatientModal(true)}
              type="button"
              className="px-2.5 py-1 bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 rounded-lg text-xs font-semibold flex items-center space-x-1 transition"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Register New Patient</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-slate-400 block mb-1">Search & Select Patient:</label>
              <select
                value={selectedPatientId}
                onChange={(e) => setSelectedPatientId(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-rose-500 font-medium"
              >
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name} ({p.uhid} • {p.age}Y/{p.gender[0]})
                  </option>
                ))}
              </select>
            </div>

            {selectedPatient && (
              <div className="bg-slate-950/80 p-2.5 rounded-xl border border-slate-800/80 text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-slate-400">UHID / OPD:</span>
                  <span className="font-mono font-bold text-rose-300">
                    {selectedPatient.uhid} / {selectedPatient.opd_no}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Attending Doctor:</span>
                  <span className="font-semibold text-slate-200">{selectedPatient.doctor_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Dept / Ward:</span>
                  <span className="text-slate-300">
                    {selectedPatient.department} ({selectedPatient.room_bed_no || 'OPD'})
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Room / Bed Stay Fast Calculator */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md flex flex-col justify-between space-y-2">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <div className="flex items-center space-x-2">
              <Bed className="w-4 h-4 text-rose-400" />
              <h4 className="text-xs font-bold text-slate-100">Room / Bed Day Charges</h4>
            </div>
            <button
              onClick={addBedStayCharges}
              type="button"
              className="text-[11px] px-2 py-0.5 bg-rose-600 hover:bg-rose-500 text-white rounded font-semibold"
            >
              + Add to Bill
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <label className="text-[10px] text-slate-400 block mb-0.5">Room Category:</label>
              <select
                value={roomCategory}
                onChange={(e) => {
                  setRoomCategory(e.target.value);
                  if (e.target.value.includes('General')) setBedRatePaise(150000);
                  else if (e.target.value.includes('Semi-Private')) setBedRatePaise(350000);
                  else if (e.target.value.includes('ICU')) setBedRatePaise(950000);
                }}
                className="w-full px-2 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-slate-200 text-[11px]"
              >
                <option value="General Ward Bed">General Ward (₹1,500/day)</option>
                <option value="Semi-Private Monitored Bed">Semi-Private (₹3,500/day)</option>
                <option value="ICU Critical Bed">ICU Care (₹9,500/day)</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-slate-400 block mb-0.5">Stay (Days):</label>
              <input
                type="number"
                min="1"
                value={bedDaysCount}
                onChange={(e) => setBedDaysCount(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full px-2 py-1 bg-slate-950 border border-slate-700 rounded-lg text-slate-200 font-mono"
              />
            </div>
          </div>

          <div className="flex justify-between items-center text-xs bg-slate-950 p-2 rounded-lg border border-slate-800">
            <span className="text-slate-400">Total Bed + Nursing:</span>
            <span className="font-mono font-bold text-rose-300">
              {formatPaise((bedRatePaise + nursingChargesPaise) * bedDaysCount)}
            </span>
          </div>
        </div>
      </div>

      {/* 3-IN-1 CLINICAL BILLING SECTIONS */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* SECTION 1: OPD CONSULTATION CHARGES */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <div className="flex items-center space-x-2">
              <Stethoscope className="w-4 h-4 text-emerald-400" />
              <h3 className="text-xs font-bold text-slate-100">1. OPD Consultation</h3>
            </div>
            <button
              onClick={() => {
                const consultItem = catalog.find((r) => r.category === 'Consultation');
                if (consultItem) addItemToClinicalBill(consultItem);
              }}
              type="button"
              className="text-[10px] text-emerald-400 hover:underline"
            >
              + Add Doctor Visit
            </button>
          </div>

          <div className="space-y-2 max-h-48 overflow-y-auto">
            {consultationLines.length === 0 ? (
              <p className="text-xs text-slate-500 italic py-4 text-center">No consultation charges added.</p>
            ) : (
              consultationLines.map((line) => (
                <div
                  key={line.id}
                  className="p-2 bg-slate-950 rounded-xl border border-slate-800 flex items-center justify-between text-xs"
                >
                  <div className="min-w-0 pr-2">
                    <div className="font-semibold text-slate-200 truncate">{line.name}</div>
                    <div className="text-[10px] text-emerald-400">SAC: {line.hsn_sac} • 0% GST</div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="font-mono font-bold text-slate-200">
                      {formatPaise(line.unit_price_paise)}
                    </span>
                    <button
                      onClick={() => removeClinicalItem(line.id)}
                      className="text-slate-500 hover:text-rose-400 p-1"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* SECTION 2: PHARMACY MEDICINE PRESCRIPTION BILLING */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <div className="flex items-center space-x-2">
              <Pill className="w-4 h-4 text-cyan-400" />
              <h3 className="text-xs font-bold text-slate-100">2. Pharmacy Medicines</h3>
            </div>
            <select
              onChange={(e) => {
                const med = catalog.find((r) => r.id === e.target.value);
                if (med) addItemToClinicalBill(med);
                e.target.value = '';
              }}
              defaultValue=""
              className="text-[10px] bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-cyan-300"
            >
              <option value="" disabled>
                + Prescribe Med
              </option>
              {catalog
                .filter((r) => r.category === 'Pharmacy')
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
            </select>
          </div>

          <div className="space-y-2 max-h-48 overflow-y-auto">
            {pharmacyLines.length === 0 ? (
              <p className="text-xs text-slate-500 italic py-4 text-center">No prescription medicines added.</p>
            ) : (
              pharmacyLines.map((line) => (
                <div
                  key={line.id}
                  className="p-2 bg-slate-950 rounded-xl border border-slate-800 flex items-center justify-between text-xs"
                >
                  <div className="min-w-0 pr-2">
                    <div className="font-semibold text-slate-200 truncate">{line.name}</div>
                    <div className="text-[10px] text-cyan-400 font-mono">
                      Batch: {line.batch_number || 'GEN'} (Exp: {line.expiry_date || '2027'})
                    </div>
                    {line.dosage_instructions && (
                      <div className="text-[9px] text-slate-400">{line.dosage_instructions}</div>
                    )}
                  </div>
                  <div className="flex items-center space-x-2">
                    <input
                      type="number"
                      min="1"
                      value={line.quantity_milli / 1000}
                      onChange={(e) => updateQuantity(line.id, parseInt(e.target.value) || 1)}
                      className="w-10 px-1 py-0.5 bg-slate-900 border border-slate-700 rounded text-center font-mono"
                    />
                    <span className="font-mono font-bold text-slate-200">
                      {formatPaise((line.unit_price_paise * line.quantity_milli) / 1000)}
                    </span>
                    <button
                      onClick={() => removeClinicalItem(line.id)}
                      className="text-slate-500 hover:text-rose-400 p-1"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* SECTION 3: ROOM / BED DAY CHARGES SUMMARY */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <div className="flex items-center space-x-2">
              <Bed className="w-4 h-4 text-amber-400" />
              <h3 className="text-xs font-bold text-slate-100">3. Inpatient Bed Charges</h3>
            </div>
            <span className="text-[10px] text-slate-400">SAC: 999311</span>
          </div>

          <div className="space-y-2 max-h-48 overflow-y-auto">
            {bedLines.length === 0 ? (
              <p className="text-xs text-slate-500 italic py-4 text-center">
                No room charges attached. Use calculator above if admitted.
              </p>
            ) : (
              bedLines.map((line) => (
                <div
                  key={line.id}
                  className="p-2 bg-slate-950 rounded-xl border border-slate-800 flex items-center justify-between text-xs"
                >
                  <div className="min-w-0 pr-2">
                    <div className="font-semibold text-slate-200 truncate">{line.name}</div>
                    <div className="text-[10px] text-amber-400">Inpatient Care Facility</div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="font-mono font-bold text-slate-200">
                      {formatPaise(line.line_total_paise)}
                    </span>
                    <button
                      onClick={() => removeClinicalItem(line.id)}
                      className="text-slate-500 hover:text-rose-400 p-1"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* GRAND TOTALS & POST ACTION */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="flex flex-wrap gap-4 text-xs">
          <div className="bg-slate-950 px-3 py-2 rounded-xl border border-slate-800">
            <span className="text-slate-400 block text-[10px]">Medical Subtotal:</span>
            <span className="font-mono font-bold text-slate-200">
              {formatPaise(computedDocument.totals.taxable_paise)}
            </span>
          </div>
          <div className="bg-slate-950 px-3 py-2 rounded-xl border border-slate-800">
            <span className="text-slate-400 block text-[10px]">Pharmacy GST:</span>
            <span className="font-mono font-bold text-slate-200">
              {formatPaise(computedDocument.totals.cgst_paise + computedDocument.totals.sgst_paise)}
            </span>
          </div>
          <div className="bg-slate-950 px-3 py-2 rounded-xl border border-slate-800">
            <span className="text-slate-400 block text-[10px]">Total Healthcare Bill:</span>
            <span className="font-mono font-extrabold text-rose-400 text-base">
              {formatPaise(grandTotalPaise)}
            </span>
          </div>
        </div>

        <div className="flex items-center space-x-3 w-full md:w-auto">
          <div className="w-36">
            <select
              value={paymentMode}
              onChange={(e) => setPaymentMode(e.target.value as PaymentMode)}
              className="w-full px-2.5 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs font-semibold text-slate-200"
            >
              <option value="CARD">Debit / Credit Card</option>
              <option value="UPI">UPI / Digital Payment</option>
              <option value="BANK_TRANSFER">TPA / Health Insurance</option>
              <option value="CASH">Cash Counter</option>
            </select>
          </div>

          <button
            onClick={handlePostHospitalBill}
            disabled={cart.length === 0 || !selectedPatient}
            type="button"
            className="flex-1 sm:flex-none px-5 py-2.5 bg-rose-600 hover:bg-rose-500 disabled:bg-slate-800 disabled:text-slate-500 text-white rounded-xl font-bold text-xs shadow-lg shadow-rose-950/60 flex items-center space-x-2 transition"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>Generate Discharge & Medical Bill</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* MODAL 1: REGISTER NEW PATIENT */}
      {showNewPatientModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 w-full max-w-md rounded-2xl p-5 shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-slate-100 flex items-center space-x-2">
                <HeartPulse className="w-4 h-4 text-rose-400" />
                <span>Patient Hospital Admission Registration</span>
              </h3>
              <button
                onClick={() => setShowNewPatientModal(false)}
                className="text-slate-400 hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleRegisterPatient} className="space-y-3 text-xs">
              <div>
                <label className="text-slate-400 block mb-1">Patient Full Name *</label>
                <input
                  required
                  type="text"
                  placeholder="e.g. Rameshwar Nath"
                  value={newFullName}
                  onChange={(e) => setNewFullName(e.target.value)}
                  className="w-full px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-slate-200"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">UHID *</label>
                  <input
                    required
                    type="text"
                    value={newUhid}
                    onChange={(e) => setNewUhid(e.target.value)}
                    className="w-full px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-slate-200 font-mono text-rose-300"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">OPD / IPD No</label>
                  <input
                    type="text"
                    value={newOpdNo}
                    onChange={(e) => setNewOpdNo(e.target.value)}
                    className="w-full px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-slate-200 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">Age (Years)</label>
                  <input
                    type="number"
                    min="1"
                    max="120"
                    value={newAge}
                    onChange={(e) => setNewAge(parseInt(e.target.value) || 1)}
                    className="w-full px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-slate-200 font-mono"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Gender</label>
                  <select
                    value={newGender}
                    onChange={(e) => setNewGender(e.target.value as any)}
                    className="w-full px-2 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-slate-200"
                  >
                    <option value="MALE">Male</option>
                    <option value="FEMALE">Female</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Consulting Doctor</label>
                <input
                  type="text"
                  value={newDoctorName}
                  onChange={(e) => setNewDoctorName(e.target.value)}
                  className="w-full px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-slate-200"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">Department</label>
                  <input
                    type="text"
                    value={newDepartment}
                    onChange={(e) => setNewDepartment(e.target.value)}
                    className="w-full px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-slate-200"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Room / Bed No</label>
                  <input
                    type="text"
                    value={newRoomBedNo}
                    onChange={(e) => setNewRoomBedNo(e.target.value)}
                    className="w-full px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-slate-200"
                  />
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowNewPatientModal(false)}
                  className="px-3 py-1.5 bg-slate-800 text-slate-300 rounded-lg font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-lg font-bold shadow"
                >
                  Register Patient
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: INTEGRATED HOSPITAL DISCHARGE & MEDICAL INVOICE */}
      {showInvoiceModal && lastReceipt && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white text-slate-900 w-full max-w-4xl rounded-2xl shadow-2xl p-6 overflow-y-auto max-h-[95vh] font-sans text-xs">
            {/* Header controls (Non-printable) */}
            <div className="flex justify-between items-center pb-3 mb-3 border-b border-gray-300 non-printable">
              <span className="font-bold text-gray-700">Integrated Healthcare Discharge & Clinical Bill</span>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => window.print()}
                  className="px-4 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-bold flex items-center space-x-1.5 shadow"
                >
                  <Printer className="w-4 h-4" />
                  <span>Print Medical Invoice</span>
                </button>
                <button
                  onClick={() => setShowInvoiceModal(false)}
                  className="px-3 py-1.5 bg-gray-200 text-gray-700 rounded-lg font-bold"
                >
                  Close
                </button>
              </div>
            </div>

            {/* HOSPITAL INVOICE PRINT VIEW */}
            <div id="hospital-bill-print" className="border border-gray-400 p-5 space-y-4">
              {/* Hospital Header */}
              <div className="flex justify-between items-start border-b border-gray-300 pb-3">
                <div>
                  <h1 className="text-xl font-black text-rose-900 tracking-tight">APEX MULTISPECIALITY HOSPITAL</h1>
                  <p className="text-[11px] text-gray-600">NABH Accredited Tertiary Care Center • Andheri West, Mumbai</p>
                  <p className="text-[10px] text-gray-600">Clinical Reg No: MAH/MUM/2019/992 • GSTIN: 27AABCU9603R1ZM</p>
                  <p className="text-[10px] text-gray-600">Emergency Helpline: +91 98200 12345 • 24x7 Pharmacy & Trauma</p>
                </div>
                <div className="text-right">
                  <h2 className="text-sm font-black uppercase text-gray-800">CLINICAL SUMMARY & BILL</h2>
                  <p className="text-xs font-mono font-bold text-rose-800">
                    Bill No: {lastReceipt.invoice_number}
                  </p>
                  <p className="text-[11px] text-gray-600">Date: {lastReceipt.invoice_date} {lastReceipt.invoice_time}</p>
                </div>
              </div>

              {/* Patient EHR Summary Bar */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 bg-gray-50 border border-gray-300 p-3 rounded text-[11px]">
                <div>
                  <div className="text-gray-500 text-[10px]">Patient Name:</div>
                  <div className="font-bold text-gray-900">{lastReceipt.entity_name}</div>
                </div>
                <div>
                  <div className="text-gray-500 text-[10px]">UHID / OPD:</div>
                  <div className="font-mono font-bold text-gray-900">
                    {lastReceipt.entity_details?.uhid} / {lastReceipt.entity_details?.opd_no}
                  </div>
                </div>
                <div>
                  <div className="text-gray-500 text-[10px]">Age / Gender:</div>
                  <div className="font-bold text-gray-900">
                    {lastReceipt.entity_details?.age} Yrs / {lastReceipt.entity_details?.gender}
                  </div>
                </div>
                <div>
                  <div className="text-gray-500 text-[10px]">Attending Doctor:</div>
                  <div className="font-bold text-gray-900">{lastReceipt.entity_details?.doctor_name}</div>
                </div>
              </div>

              {/* Itemized Clinical Table */}
              <table className="w-full text-left border border-gray-300 text-[11px]">
                <thead className="bg-gray-100 border-b border-gray-300 font-bold">
                  <tr>
                    <th className="p-1.5 border-r border-gray-300">#</th>
                    <th className="p-1.5 border-r border-gray-300">Service / Medicine Details</th>
                    <th className="p-1.5 border-r border-gray-300">HSN/SAC</th>
                    <th className="p-1.5 border-r border-gray-300">Batch / Details</th>
                    <th className="p-1.5 border-r border-gray-300 text-center">Qty / Days</th>
                    <th className="p-1.5 border-r border-gray-300 text-right">Rate</th>
                    <th className="p-1.5 text-right">Amount (₹)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {lastReceipt.lines.map((l, i) => (
                    <tr key={i}>
                      <td className="p-1.5 border-r border-gray-300 text-center font-mono">{i + 1}</td>
                      <td className="p-1.5 border-r border-gray-300">
                        <div className="font-semibold">{l.name}</div>
                        {l.dosage_instructions && (
                          <div className="text-[9px] text-gray-500 italic">{l.dosage_instructions}</div>
                        )}
                      </td>
                      <td className="p-1.5 border-r border-gray-300 font-mono text-[10px]">{l.hsn_sac}</td>
                      <td className="p-1.5 border-r border-gray-300 font-mono text-[10px]">
                        {l.batch_number ? `${l.batch_number} (Exp: ${l.expiry_date})` : 'Service'}
                      </td>
                      <td className="p-1.5 border-r border-gray-300 text-center font-mono">
                        {l.quantity_milli / 1000}
                      </td>
                      <td className="p-1.5 border-r border-gray-300 text-right font-mono">
                        {formatPaise(l.unit_price_paise, false)}
                      </td>
                      <td className="p-1.5 text-right font-bold font-mono">
                        {formatPaise((l.unit_price_paise * l.quantity_milli) / 1000, false)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Totals & Settlement */}
              <div className="border border-gray-300 p-3 bg-gray-50 flex justify-between items-center text-[11px]">
                <div>
                  <p><strong>Payment Mode:</strong> {lastReceipt.payment.mode}</p>
                  <p><strong>Txn Reference:</strong> {lastReceipt.payment.reference_number || 'Approved'}</p>
                  <p className="text-[10px] text-gray-500 mt-1">Hospital services exempted from GST under Notification No. 12/2017-CT(R).</p>
                </div>
                <div className="space-y-1 font-mono text-right min-w-[200px]">
                  <div className="flex justify-between">
                    <span className="font-sans">Taxable / Service Total:</span>
                    <span>{formatPaise(lastReceipt.totals.taxable_paise)}</span>
                  </div>
                  {(lastReceipt.totals.cgst_paise + lastReceipt.totals.sgst_paise) > 0 && (
                    <div className="flex justify-between">
                      <span className="font-sans">Pharmacy GST:</span>
                      <span>{formatPaise(lastReceipt.totals.cgst_paise + lastReceipt.totals.sgst_paise)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm font-black border-t border-gray-400 pt-1 text-rose-900">
                    <span className="font-sans">NET AMOUNT DUE:</span>
                    <span>{formatPaise(lastReceipt.totals.total_amount_paise)}</span>
                  </div>
                </div>
              </div>

              {/* Signatures */}
              <div className="flex justify-between items-end pt-6 border-t border-gray-300">
                <div className="text-center space-y-6">
                  <div className="border-b border-gray-400 w-36"></div>
                  <div className="text-[10px] text-gray-600">Patient / Relative Signature</div>
                </div>
                <div className="text-center space-y-6">
                  <div className="border-b border-gray-400 w-44"></div>
                  <div className="text-[10px] text-gray-600 font-bold">
                    Dr. Anita Joshi (Reg: MMC-49219)
                    <br />
                    Medical Superintendent / Attending Physician
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
