// ui/src/verticals/hospitalData.ts
// Hospital & Clinical Suite Data Service: 20 Patients, Doctors Matrix, Bed Categories, Diagnostics, Expenses, Watermark Settings, and CSV/WhatsApp Exports

import {
  PatientEntity,
  DoctorConsultationRule,
  BedCategoryRule,
  DiagnosticTestItem,
  HospitalExpense,
  HospitalReceiptSettings,
  HospitalBillPaymentRecord,
  PaymentMode,
  HospitalMedicalStockItem,
} from './types';
import { PurchaseExpenseVoucher } from '../components/common/PurchaseExpenseBillModal';
import { formatPaise } from '../lib/tax';
import { ErpStorageService } from '../lib/erpStorage';

// ----------------------------------------------------------------------------
// 1. SEEDED PATIENTS DIRECTORY (20 REALISTIC CLINICAL PROFILES)
// ----------------------------------------------------------------------------
export const INITIAL_HOSPITAL_PATIENTS: PatientEntity[] = [
  {
    id: 'ent_pat_001',
    entity_code: 'PAT-2026-1001',
    entity_type: 'PATIENT',
    full_name: 'Rameshwar Nath Kulkarni',
    uhid: 'UHID-2026-1001',
    opd_no: 'OPD-8821',
    age: 58,
    gender: 'MALE',
    doctor_name: 'Dr. Anita Joshi, MD (Medicine)',
    department: 'General Medicine',
    room_bed_no: 'OPD Rm 3',
    phone: '+91 98199 44332',
    state_code: '27',
    is_active: true,
    blood_group: 'B+',
    diagnosis: 'Hypertension & Type 2 Diabetes Mellitus',
    dues_balance_paise: 150000, // ₹1,500.00
    last_visit_date: '2026-10-18',
    emergency_contact: 'Suresh Kulkarni (Son) - +91 98200 11223',
    ipd_admitted: false,
  },
  {
    id: 'ent_pat_002',
    entity_code: 'PAT-2026-1002',
    entity_type: 'PATIENT',
    full_name: 'Meenakshi Sundaram',
    uhid: 'UHID-2026-1002',
    opd_no: 'IPD-4410',
    age: 42,
    gender: 'FEMALE',
    doctor_name: 'Dr. Vivek Malhotra, MS, MCh (Cardio)',
    department: 'Cardiology',
    room_bed_no: 'Semi-Private Bed 204',
    admission_date: '2026-10-17',
    phone: '+91 99887 76655',
    state_code: '27',
    is_active: true,
    blood_group: 'O+',
    diagnosis: 'Post-PTCA Angioplasty Recovery & Observation',
    dues_balance_paise: 1450000, // ₹14,500.00
    last_visit_date: '2026-10-20',
    emergency_contact: 'Sundaram Venkat (Husband) - +91 99887 76654',
    ipd_admitted: true,
  },
  {
    id: 'ent_pat_003',
    entity_code: 'PAT-2026-1003',
    entity_type: 'PATIENT',
    full_name: 'Master Reyansh Gupta',
    uhid: 'UHID-2026-1003',
    opd_no: 'OPD-8829',
    age: 6,
    gender: 'MALE',
    doctor_name: 'Dr. Sneha Patil, DCH (Pediatrics)',
    department: 'Pediatrics',
    room_bed_no: 'OPD Clinic 2',
    phone: '+91 91234 56789',
    state_code: '27',
    is_active: true,
    blood_group: 'A+',
    diagnosis: 'Acute Viral Bronchitis & Wheezing',
    dues_balance_paise: 0,
    last_visit_date: '2026-10-19',
    emergency_contact: 'Pooja Gupta (Mother) - +91 91234 56788',
    ipd_admitted: false,
  },
  {
    id: 'ent_pat_004',
    entity_code: 'PAT-2026-1004',
    entity_type: 'PATIENT',
    full_name: 'Sunita Devi Verma',
    uhid: 'UHID-2026-1004',
    opd_no: 'IPD-4415',
    age: 67,
    gender: 'FEMALE',
    doctor_name: 'Dr. Rajiv Deshmukh, MS (Ortho)',
    department: 'Orthopedics',
    room_bed_no: 'Deluxe Private Rm 301',
    admission_date: '2026-10-19',
    phone: '+91 98221 44556',
    state_code: '27',
    is_active: true,
    blood_group: 'AB+',
    diagnosis: 'Bilateral Knee Osteoarthritis Grade 3 (TKR Pre-op)',
    dues_balance_paise: 2800000, // ₹28,000.00
    last_visit_date: '2026-10-20',
    emergency_contact: 'Anil Verma (Son) - +91 98221 44557',
    ipd_admitted: true,
  },
  {
    id: 'ent_pat_005',
    entity_code: 'PAT-2026-1005',
    entity_type: 'PATIENT',
    full_name: 'Mohammed Zaid Khan',
    uhid: 'UHID-2026-1005',
    opd_no: 'OPD-8835',
    age: 31,
    gender: 'MALE',
    doctor_name: 'Dr. Farhan Qureshi, MS (ENT)',
    department: 'ENT & Pulmonology',
    room_bed_no: 'OPD Clinic 4',
    phone: '+91 97654 33221',
    state_code: '27',
    is_active: true,
    blood_group: 'O-',
    diagnosis: 'Deviated Nasal Septum & Chronic Maxillary Sinusitis',
    dues_balance_paise: 80000, // ₹800.00
    last_visit_date: '2026-10-15',
    emergency_contact: 'Nasir Khan (Brother) - +91 97654 33222',
    ipd_admitted: false,
  },
  {
    id: 'ent_pat_006',
    entity_code: 'PAT-2026-1006',
    entity_type: 'PATIENT',
    full_name: 'Priyanka Anand Shinde',
    uhid: 'UHID-2026-1006',
    opd_no: 'OPD-8840',
    age: 29,
    gender: 'FEMALE',
    doctor_name: 'Dr. Kavita Singhania, MD (OBG)',
    department: 'Gynecology & Obstetrics',
    room_bed_no: 'OPD Clinic 1',
    phone: '+91 98600 77112',
    state_code: '27',
    is_active: true,
    blood_group: 'B-',
    diagnosis: 'Antenatal Care - 32 Weeks Gestation Routine Followup',
    dues_balance_paise: 0,
    last_visit_date: '2026-10-20',
    emergency_contact: 'Anand Shinde (Husband) - +91 98600 77113',
    ipd_admitted: false,
  },
  {
    id: 'ent_pat_007',
    entity_code: 'PAT-2026-1007',
    entity_type: 'PATIENT',
    full_name: 'Harish Chandra Bansal',
    uhid: 'UHID-2026-1007',
    opd_no: 'IPD-4419',
    age: 72,
    gender: 'MALE',
    doctor_name: 'Dr. Arvind Nambiar, DM (Nephro)',
    department: 'Nephrology & Urology',
    room_bed_no: 'ICU Bed 03',
    admission_date: '2026-10-18',
    phone: '+91 98112 33445',
    state_code: '27',
    is_active: true,
    blood_group: 'A-',
    diagnosis: 'Acute Kidney Injury on Chronic Renal Disease Stage 3',
    dues_balance_paise: 4200000, // ₹42,000.00
    last_visit_date: '2026-10-20',
    emergency_contact: 'Manish Bansal (Son) - +91 98112 33446',
    ipd_admitted: true,
  },
  {
    id: 'ent_pat_008',
    entity_code: 'PAT-2026-1008',
    entity_type: 'PATIENT',
    full_name: 'Kavya Rajesh Iyer',
    uhid: 'UHID-2026-1008',
    opd_no: 'OPD-8848',
    age: 19,
    gender: 'FEMALE',
    doctor_name: 'Dr. Anita Joshi, MD (Medicine)',
    department: 'General Medicine',
    room_bed_no: 'OPD Rm 3',
    phone: '+91 98205 66778',
    state_code: '27',
    is_active: true,
    blood_group: 'O+',
    diagnosis: 'Allergic Contact Urticaria & Atopic Eczema',
    dues_balance_paise: 0,
    last_visit_date: '2026-10-16',
    emergency_contact: 'Rajesh Iyer (Father) - +91 98205 66779',
    ipd_admitted: false,
  },
  {
    id: 'ent_pat_009',
    entity_code: 'PAT-2026-1009',
    entity_type: 'PATIENT',
    full_name: 'Vikramaditya Rathore',
    uhid: 'UHID-2026-1009',
    opd_no: 'IPD-4422',
    age: 45,
    gender: 'MALE',
    doctor_name: 'Dr. Sanjay Kulkarni, MS (Gen Surg)',
    department: 'General Surgery',
    room_bed_no: 'Semi-Private Bed 208',
    admission_date: '2026-10-19',
    phone: '+91 99201 88990',
    state_code: '27',
    is_active: true,
    blood_group: 'B+',
    diagnosis: 'Laparoscopic Cholecystectomy Post-Op Stable',
    dues_balance_paise: 1850000, // ₹18,500.00
    last_visit_date: '2026-10-20',
    emergency_contact: 'Bhavna Rathore (Wife) - +91 99201 88991',
    ipd_admitted: true,
  },
  {
    id: 'ent_pat_010',
    entity_code: 'PAT-2026-1010',
    entity_type: 'PATIENT',
    full_name: 'Anandi Bai More',
    uhid: 'UHID-2026-1010',
    opd_no: 'OPD-8854',
    age: 81,
    gender: 'FEMALE',
    doctor_name: 'Dr. Anita Joshi, MD (Medicine)',
    department: 'General Medicine',
    room_bed_no: 'OPD Rm 3',
    phone: '+91 94225 11998',
    state_code: '27',
    is_active: true,
    blood_group: 'AB+',
    diagnosis: 'Severe Lumbar Spondylosis & Senile Dementia Support',
    dues_balance_paise: 60000, // ₹600.00
    last_visit_date: '2026-10-14',
    emergency_contact: 'Prakash More (Son) - +91 94225 11999',
    ipd_admitted: false,
  },
  {
    id: 'ent_pat_011',
    entity_code: 'PAT-2026-1011',
    entity_type: 'PATIENT',
    full_name: 'Deepak Manohar Joshi',
    uhid: 'UHID-2026-1011',
    opd_no: 'OPD-8861',
    age: 38,
    gender: 'MALE',
    doctor_name: 'Dr. Vivek Malhotra, MS, MCh (Cardio)',
    department: 'Cardiology',
    room_bed_no: 'OPD Clinic 6',
    phone: '+91 98231 22334',
    state_code: '27',
    is_active: true,
    blood_group: 'A+',
    diagnosis: 'Exertional Angina Screening & Stress TMT Planned',
    dues_balance_paise: 220000, // ₹2,200.00
    last_visit_date: '2026-10-17',
    emergency_contact: 'Rohini Joshi (Wife) - +91 98231 22335',
    ipd_admitted: false,
  },
  {
    id: 'ent_pat_012',
    entity_code: 'PAT-2026-1012',
    entity_type: 'PATIENT',
    full_name: 'Shalini Vikram Nair',
    uhid: 'UHID-2026-1012',
    opd_no: 'OPD-8868',
    age: 34,
    gender: 'FEMALE',
    doctor_name: 'Dr. Farhan Qureshi, MS (ENT)',
    department: 'ENT & Pulmonology',
    room_bed_no: 'OPD Clinic 4',
    phone: '+91 98190 44556',
    state_code: '27',
    is_active: true,
    blood_group: 'O+',
    diagnosis: 'Allergic Rhinitis & Vocal Cord Strain',
    dues_balance_paise: 0,
    last_visit_date: '2026-10-19',
    emergency_contact: 'Vikram Nair (Husband) - +91 98190 44557',
    ipd_admitted: false,
  },
  {
    id: 'ent_pat_013',
    entity_code: 'PAT-2026-1013',
    entity_type: 'PATIENT',
    full_name: 'Gaurav Pradeep Saxena',
    uhid: 'UHID-2026-1013',
    opd_no: 'EMG-1022',
    age: 26,
    gender: 'MALE',
    doctor_name: 'Dr. Sanjay Kulkarni, MS (Gen Surg)',
    department: 'Emergency & Trauma',
    room_bed_no: 'Trauma Bay Bed 02',
    phone: '+91 98765 12345',
    state_code: '27',
    is_active: true,
    blood_group: 'B+',
    diagnosis: 'Motorcycle Fall Soft Tissue Lacerations & Tetanus Prophylaxis',
    dues_balance_paise: 650000, // ₹6,500.00
    last_visit_date: '2026-10-21',
    emergency_contact: 'Pradeep Saxena (Father) - +91 98765 12346',
    ipd_admitted: false,
  },
  {
    id: 'ent_pat_014',
    entity_code: 'PAT-2026-1014',
    entity_type: 'PATIENT',
    full_name: 'Fatima Begum Sheikh',
    uhid: 'UHID-2026-1014',
    opd_no: 'OPD-8875',
    age: 54,
    gender: 'FEMALE',
    doctor_name: 'Dr. Anita Joshi, MD (Medicine)',
    department: 'General Medicine',
    room_bed_no: 'OPD Rm 3',
    phone: '+91 98202 33441',
    state_code: '27',
    is_active: true,
    blood_group: 'A-',
    diagnosis: 'Hypothyroidism (Eltroxin 75mcg) & Iron Deficiency Anemia',
    dues_balance_paise: 110000, // ₹1,100.00
    last_visit_date: '2026-10-16',
    emergency_contact: 'Irfan Sheikh (Son) - +91 98202 33442',
    ipd_admitted: false,
  },
  {
    id: 'ent_pat_015',
    entity_code: 'PAT-2026-1015',
    entity_type: 'PATIENT',
    full_name: 'Baby Aarohi Patil',
    uhid: 'UHID-2026-1015',
    opd_no: 'OPD-8882',
    age: 1, // 9 months
    gender: 'FEMALE',
    doctor_name: 'Dr. Sneha Patil, DCH (Pediatrics)',
    department: 'Pediatrics',
    room_bed_no: 'OPD Clinic 2',
    phone: '+91 97651 88990',
    state_code: '27',
    is_active: true,
    blood_group: 'B+',
    diagnosis: '9-Month MMR Vaccination & Developmental Milestones Check',
    dues_balance_paise: 0,
    last_visit_date: '2026-10-20',
    emergency_contact: 'Swapnil Patil (Father) - +91 97651 88991',
    ipd_admitted: false,
  },
  {
    id: 'ent_pat_016',
    entity_code: 'PAT-2026-1016',
    entity_type: 'PATIENT',
    full_name: 'Yashwantrao Bhonsle',
    uhid: 'UHID-2026-1016',
    opd_no: 'IPD-4430',
    age: 63,
    gender: 'MALE',
    doctor_name: 'Dr. Farhan Qureshi, MS (ENT)',
    department: 'ENT & Pulmonology',
    room_bed_no: 'Deluxe Private Rm 305',
    admission_date: '2026-10-20',
    phone: '+91 98220 55667',
    state_code: '27',
    is_active: true,
    blood_group: 'O-',
    diagnosis: 'COPD Exacerbation with Low Oxygen Saturation (SpO2 89%)',
    dues_balance_paise: 1600000, // ₹16,000.00
    last_visit_date: '2026-10-20',
    emergency_contact: 'Uday Bhonsle (Son) - +91 98220 55668',
    ipd_admitted: true,
  },
  {
    id: 'ent_pat_017',
    entity_code: 'PAT-2026-1017',
    entity_type: 'PATIENT',
    full_name: 'Tanvi Sameer Kothari',
    uhid: 'UHID-2026-1017',
    opd_no: 'OPD-8891',
    age: 22,
    gender: 'FEMALE',
    doctor_name: 'Dr. Sanjay Kulkarni, MS (Gen Surg)',
    department: 'General Surgery',
    room_bed_no: 'Day Care Bed 04',
    phone: '+91 98330 99881',
    state_code: '27',
    is_active: true,
    blood_group: 'AB+',
    diagnosis: 'Submandibular Lymphadenopathy FNAC Evaluation',
    dues_balance_paise: 350000, // ₹3,500.00
    last_visit_date: '2026-10-18',
    emergency_contact: 'Sameer Kothari (Father) - +91 98330 99882',
    ipd_admitted: false,
  },
  {
    id: 'ent_pat_018',
    entity_code: 'PAT-2026-1018',
    entity_type: 'PATIENT',
    full_name: 'Balram Krishan Tiwari',
    uhid: 'UHID-2026-1018',
    opd_no: 'OPD-8898',
    age: 50,
    gender: 'MALE',
    doctor_name: 'Dr. Sanjay Kulkarni, MS (Gen Surg)',
    department: 'General Surgery',
    room_bed_no: 'OPD Clinic 4',
    phone: '+91 98118 77665',
    state_code: '27',
    is_active: true,
    blood_group: 'B+',
    diagnosis: 'Recurrent Acid Peptic Disease & Upper GI Endoscopy',
    dues_balance_paise: 400000, // ₹4,000.00
    last_visit_date: '2026-10-17',
    emergency_contact: 'Shubham Tiwari (Son) - +91 98118 77666',
    ipd_admitted: false,
  },
  {
    id: 'ent_pat_019',
    entity_code: 'PAT-2026-1019',
    entity_type: 'PATIENT',
    full_name: 'Neha Sandeep Agarwal',
    uhid: 'UHID-2026-1019',
    opd_no: 'OPD-8905',
    age: 40,
    gender: 'FEMALE',
    doctor_name: 'Dr. Kavita Singhania, MD (OBG)',
    department: 'Gynecology & Obstetrics',
    room_bed_no: 'OPD Clinic 1',
    phone: '+91 99205 33445',
    state_code: '27',
    is_active: true,
    blood_group: 'A+',
    diagnosis: 'Annual Well-Woman Checkup & Bilateral Sonomammography',
    dues_balance_paise: 0,
    last_visit_date: '2026-10-21',
    emergency_contact: 'Sandeep Agarwal (Husband) - +91 99205 33446',
    ipd_admitted: false,
  },
  {
    id: 'ent_pat_020',
    entity_code: 'PAT-2026-1020',
    entity_type: 'PATIENT',
    full_name: 'Jagdish Chander Sethi',
    uhid: 'UHID-2026-1020',
    opd_no: 'IPD-4440',
    age: 69,
    gender: 'MALE',
    doctor_name: 'Dr. Vivek Malhotra, MS, MCh (Cardio)',
    department: 'Cardiology',
    room_bed_no: 'Semi-Private Bed 211',
    admission_date: '2026-10-16',
    phone: '+91 98100 88223',
    state_code: '27',
    is_active: true,
    blood_group: 'O+',
    diagnosis: 'Post-Ischemic Cardiac Event & In-Patient Physiotherapy',
    dues_balance_paise: 3500000, // ₹35,000.00
    last_visit_date: '2026-10-20',
    emergency_contact: 'Rohit Sethi (Son) - +91 98100 88224',
    ipd_admitted: true,
  },
];

// ----------------------------------------------------------------------------
// 2. DOCTOR CONSULTATION & DEPARTMENT FEE MATRIX
// ----------------------------------------------------------------------------
export const INITIAL_DOCTOR_RULES: DoctorConsultationRule[] = [
  {
    id: 'doc_001',
    doctor_name: 'Dr. Anita Joshi, MD (Medicine)',
    degree: 'MBBS, MD (Internal Medicine - KEM Mumbai)',
    specialization: 'Senior Physician & Diabetologist',
    department: 'General Medicine',
    opd_fee_paise: 60000, // ₹600
    emergency_fee_paise: 120000, // ₹1,200
    follow_up_fee_paise: 30000, // ₹300
    room_no: 'OPD Consultation Room 3',
  },
  {
    id: 'doc_002',
    doctor_name: 'Dr. Vivek Malhotra, MS, MCh (Cardio)',
    degree: 'MBBS, MS, MCh (Cardiovascular & Thoracic Surgery - AIIMS)',
    specialization: 'Chief Interventional Cardiologist',
    department: 'Cardiology',
    opd_fee_paise: 120000, // ₹1,200
    emergency_fee_paise: 250000, // ₹2,500
    follow_up_fee_paise: 60000, // ₹600
    room_no: 'Cardiology Clinic 6',
  },
  {
    id: 'doc_003',
    doctor_name: 'Dr. Sneha Patil, DCH (Pediatrics)',
    degree: 'MBBS, DCH, DNB (Pediatrics & Neonatology)',
    specialization: 'Consultant Pediatrician & Neonatologist',
    department: 'Pediatrics',
    opd_fee_paise: 50000, // ₹500
    emergency_fee_paise: 100000, // ₹1,000
    follow_up_fee_paise: 25000, // ₹250
    room_no: 'Pediatric Clinic 2',
  },
  {
    id: 'doc_004',
    doctor_name: 'Dr. Rajiv Deshmukh, MS (Ortho)',
    degree: 'MBBS, MS (Orthopedics), Fellowship Joint Replacement (Germany)',
    specialization: 'Senior Orthopedic & Spine Surgeon',
    department: 'Orthopedics',
    opd_fee_paise: 80000, // ₹800
    emergency_fee_paise: 150000, // ₹1,500
    follow_up_fee_paise: 40000, // ₹400
    room_no: 'Orthopedic Suite 5',
  },
  {
    id: 'doc_005',
    doctor_name: 'Dr. Kavita Singhania, MD (OBG)',
    degree: 'MBBS, MD (Obstetrics & Gynecology), Fellowship Laparoscopy',
    specialization: 'Senior Gynecologist & High-Risk Pregnancy Specialist',
    department: 'Gynecology & Obstetrics',
    opd_fee_paise: 70000, // ₹700
    emergency_fee_paise: 150000, // ₹1,500
    follow_up_fee_paise: 35000, // ₹350
    room_no: 'OB-GYN Suite 1',
  },
  {
    id: 'doc_006',
    doctor_name: 'Dr. Sanjay Kulkarni, MS (Gen Surg)',
    degree: 'MBBS, MS (General & Laparoscopic Surgery), FMAS',
    specialization: 'Chief Laparoscopic & GI Surgeon',
    department: 'General Surgery',
    opd_fee_paise: 80000, // ₹800
    emergency_fee_paise: 180000, // ₹1,800
    follow_up_fee_paise: 40000, // ₹400
    room_no: 'Surgical OPD 4',
  },
  {
    id: 'doc_007',
    doctor_name: 'Dr. Farhan Qureshi, MS (ENT)',
    degree: 'MBBS, MS (Otorhinolaryngology & Head-Neck Surgery)',
    specialization: 'Senior ENT Surgeon & Rhinologist',
    department: 'ENT & Pulmonology',
    opd_fee_paise: 60000, // ₹600
    emergency_fee_paise: 120000, // ₹1,200
    follow_up_fee_paise: 30000, // ₹300
    room_no: 'ENT Clinic 4',
  },
  {
    id: 'doc_008',
    doctor_name: 'Dr. Arvind Nambiar, DM (Nephro)',
    degree: 'MBBS, MD, DM (Nephrology - PGI Chandigarh)',
    specialization: 'Senior Consultant Nephrologist & Renal Transplant',
    department: 'Nephrology & Urology',
    opd_fee_paise: 100000, // ₹1,000
    emergency_fee_paise: 200000, // ₹2,000
    follow_up_fee_paise: 50000, // ₹500
    room_no: 'Renal Care Suite 7',
  },
];

// ----------------------------------------------------------------------------
// 3. BED / ROOM CATEGORY CHARGES (PER DAY)
// ----------------------------------------------------------------------------
export const INITIAL_BED_RULES: BedCategoryRule[] = [
  {
    id: 'bed_gw',
    category_name: 'General Ward Monitored Bed',
    room_type: 'GENERAL_WARD',
    daily_bed_rate_paise: 120000, // ₹1,200/day
    daily_nursing_paise: 30000, // ₹300/day
    total_daily_paise: 150000, // ₹1,500/day
    description: 'Shared 6-bed ward with central oxygen and 24x7 staff nurse monitoring',
  },
  {
    id: 'bed_sp',
    category_name: 'Semi-Private Room (Twin Sharing)',
    room_type: 'SEMI_PRIVATE',
    daily_bed_rate_paise: 280000, // ₹2,800/day
    daily_nursing_paise: 70000, // ₹700/day
    total_daily_paise: 350000, // ₹3,500/day
    description: 'Air-conditioned 2-patient room with attendant couch, TV, and attached washroom',
  },
  {
    id: 'bed_dx',
    category_name: 'Deluxe Private Suite',
    room_type: 'DELUXE_PRIVATE',
    daily_bed_rate_paise: 500000, // ₹5,000/day
    daily_nursing_paise: 100000, // ₹1,000/day
    total_daily_paise: 600000, // ₹6,000/day
    description: 'Single executive private room with dedicated attendant bed, refrigerator, and premium nurse call',
  },
  {
    id: 'bed_icu',
    category_name: 'Intensive Care Unit (ICU / CCU)',
    room_type: 'ICU',
    daily_bed_rate_paise: 900000, // ₹9,000/day
    daily_nursing_paise: 250000, // ₹2,500/day
    total_daily_paise: 1150000, // ₹11,500/day
    description: '1:1 Critical Care nursing, invasive arterial line monitoring, multi-para Philips monitors, central ventilator ready',
  },
  {
    id: 'bed_nicu',
    category_name: 'Neonatal ICU (NICU / Level 3)',
    room_type: 'NICU',
    daily_bed_rate_paise: 800000, // ₹8,000/day
    daily_nursing_paise: 200000, // ₹2,000/day
    total_daily_paise: 1000000, // ₹10,000/day
    description: 'Giraffe infant radiant warmer, continuous phototherapy, micro-infusion pumps, neonatal intensivist care',
  },
];

// ----------------------------------------------------------------------------
// 4. DIAGNOSTIC LAB & RADIOLOGY TEST CATALOG
// ----------------------------------------------------------------------------
export const INITIAL_DIAGNOSTIC_TESTS: DiagnosticTestItem[] = [
  {
    id: 'diag_001',
    test_code: 'LAB-CBC',
    test_name: 'Complete Blood Count (CBC) with Automated Differential & ESR',
    department: 'PATHOLOGY',
    fee_paise: 45000, // ₹450
    sample_type: 'Whole Blood EDTA',
    turnaround_hours: 2,
  },
  {
    id: 'diag_002',
    test_code: 'LAB-LFT',
    test_name: 'Liver Function Test (Bilirubin, SGOT, SGPT, Alk Phos, Albumin)',
    department: 'BIOCHEMISTRY',
    fee_paise: 85000, // ₹850
    sample_type: 'Serum Gel Tube',
    turnaround_hours: 4,
  },
  {
    id: 'diag_003',
    test_code: 'LAB-KFT',
    test_name: 'Renal / Kidney Function Test (Creatinine, Urea, Electrolytes)',
    department: 'BIOCHEMISTRY',
    fee_paise: 75000, // ₹750
    sample_type: 'Serum Gel Tube',
    turnaround_hours: 3,
  },
  {
    id: 'diag_004',
    test_code: 'LAB-LIPID',
    test_name: 'Lipid Profile (Total Cholesterol, Triglycerides, HDL, LDL, VLDL)',
    department: 'BIOCHEMISTRY',
    fee_paise: 75000, // ₹750
    sample_type: 'Fasting Serum',
    turnaround_hours: 4,
  },
  {
    id: 'diag_005',
    test_code: 'RAD-ECG',
    test_name: '12-Lead Electrocardiogram (ECG) with Cardiologist Report',
    department: 'CARDIOLOGY',
    fee_paise: 35000, // ₹350
    sample_type: 'Non-Invasive Diagnostic',
    turnaround_hours: 1,
  },
  {
    id: 'diag_006',
    test_code: 'RAD-XRAY',
    test_name: 'Digital Chest X-Ray (PA View) High Resolution',
    department: 'RADIOLOGY',
    fee_paise: 60000, // ₹600
    sample_type: 'Digital X-Ray',
    turnaround_hours: 1,
  },
  {
    id: 'diag_007',
    test_code: 'RAD-USG',
    test_name: 'Ultrasound Whole Abdomen & Pelvis with Color Doppler',
    department: 'RADIOLOGY',
    fee_paise: 180000, // ₹1,800
    sample_type: 'Radiological Imaging',
    turnaround_hours: 2,
  },
  {
    id: 'diag_008',
    test_code: 'RAD-ECHO',
    test_name: '2D Echocardiography with Color Doppler & EF Assessment',
    department: 'CARDIOLOGY',
    fee_paise: 250000, // ₹2,500
    sample_type: 'Echocardiogram',
    turnaround_hours: 2,
  },
  {
    id: 'diag_009',
    test_code: 'RAD-CT',
    test_name: 'High-Resolution Chest CT Scan (HRCT Thorax Non-Contrast)',
    department: 'RADIOLOGY',
    fee_paise: 450000, // ₹4,500
    sample_type: '128-Slice CT Scan',
    turnaround_hours: 4,
  },
  {
    id: 'diag_010',
    test_code: 'RAD-MRI',
    test_name: 'Brain MRI with Diffusion & Angiography Screening (1.5 Tesla)',
    department: 'RADIOLOGY',
    fee_paise: 650000, // ₹6,500
    sample_type: 'Magnetic Resonance Imaging',
    turnaround_hours: 6,
  },
];

// ----------------------------------------------------------------------------
// 5. SEEDED HOSPITAL OPERATIONAL EXPENSES
// ----------------------------------------------------------------------------
export const INITIAL_HOSPITAL_EXPENSES: HospitalExpense[] = [
  {
    id: 'exp_hosp_001',
    date: '2026-10-20',
    payee: 'Praxair Linde India Ltd',
    category: 'OXYGEN_CYLINDERS',
    amount_paise: 1850000, // ₹18,500
    payment_mode: 'BANK_TRANSFER',
    voucher_no: 'EXP-OXY-9912',
    remarks: 'Refill of 12 Jumbo High-Pressure Medical Oxygen D-Type Cylinders for ICU',
  },
  {
    id: 'exp_hosp_002',
    date: '2026-10-19',
    payee: 'Bio-Cleanse Pollution Control Pvt Ltd',
    category: 'BIOMEDICAL_WASTE',
    amount_paise: 420000, // ₹4,200
    payment_mode: 'UPI',
    voucher_no: 'EXP-BMW-8812',
    remarks: 'Fortnightly yellow & red bag bio-hazard autoclave incineration charges',
  },
  {
    id: 'exp_hosp_003',
    date: '2026-10-18',
    payee: 'Hindustan Syringes & Disposables',
    category: 'SURGICAL_DISPOSABLES',
    amount_paise: 1280000, // ₹12,800
    payment_mode: 'BANK_TRANSFER',
    voucher_no: 'EXP-DISP-4102',
    remarks: 'DispoVan 2ml/5ml syringes, IV Cannula 20G/22G, surgical gloves 7.0/7.5',
  },
  {
    id: 'exp_hosp_004',
    date: '2026-10-17',
    payee: 'Sun Pharma Distribution Agency',
    category: 'PHARMACY_RESTOCK',
    amount_paise: 4500000, // ₹45,000
    payment_mode: 'CHEQUE',
    voucher_no: 'EXP-PHARM-1102',
    remarks: 'Emergency ward injectable antibiotics, Noradrenaline, Pantoprazole IV vials',
  },
  {
    id: 'exp_hosp_005',
    date: '2026-10-16',
    payee: 'Sparkle Fresh Linen Laundry Works',
    category: 'HOUSEKEEPING',
    amount_paise: 360000, // ₹3,600
    payment_mode: 'UPI',
    voucher_no: 'EXP-LINEN-7711',
    remarks: 'Steam thermal wash & ethylene oxide sterilization of 180 OT and bed sheets',
  },
];

// ----------------------------------------------------------------------------
// 6. DEFAULT HOSPITAL RECEIPT & WATERMARK SETTINGS
// ----------------------------------------------------------------------------
export const DEFAULT_HOSPITAL_RECEIPT_SETTINGS: HospitalReceiptSettings = {
  hospital_name: 'Lifecare Multi-Speciality Hospital & Research Center',
  registration_number: 'MH-PUN-CLINIC-2024-8812',
  nabh_accreditation_no: 'NABH-SHCO-2025-0991',
  address: 'Plot 18, Health City Avenue, Off Senapati Bapat Road, Pune - 411016',
  phone: '+91 (020) 2567-8899 / 2567-8800',
  emergency_helpline: '1066 / +91 98200 99911',
  email: 'billing@lifecarehospital.org • www.lifecarehospital.org',
  logo_url: 'https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?w=120&auto=format&fit=crop&q=80',
  show_watermark: true,
  watermark_text: 'LIFECARE HOSPITAL',
  watermark_opacity: 0.08,
  paper_size: 'A4',
  show_doctor_signature: true,
  discharge_instructions: 'Follow prescribed medications strictly. Review in OPD on emergency or scheduled date.',
  terms_conditions: 'All medications and diagnostic payments are valid under medical council regulations. Disputes subject to Pune jurisdiction.',
};

// ----------------------------------------------------------------------------
// 7. SEEDED RECENT CLINICAL BILLING AUDIT LOGS (50 REALISTIC CLINICAL BILLS)
// ----------------------------------------------------------------------------
const generateSeeded50HospitalPayments = (): HospitalBillPaymentRecord[] => {
  const docs = [
    { name: 'Dr. Anita Joshi, MD', dept: 'General Medicine', fee: 60000 },
    { name: 'Dr. Vivek Malhotra, MS, MCh', dept: 'Cardiology', fee: 120000 },
    { name: 'Dr. Sneha Patil, DCH', dept: 'Pediatrics', fee: 50000 },
    { name: 'Dr. Rajesh Kulkarni, MS', dept: 'General Surgery', fee: 100000 },
  ];
  const billTypes: ('OPD_CONSULT' | 'COMPOSITE' | 'IPD_DISCHARGE' | 'PHARMACY_DISPENSE')[] = [
    'OPD_CONSULT',
    'COMPOSITE',
    'IPD_DISCHARGE',
    'PHARMACY_DISPENSE',
  ];
  const paymentModes: PaymentMode[] = ['UPI', 'CASH', 'CARD', 'BANK_TRANSFER'];
  const list: HospitalBillPaymentRecord[] = [];
  const today = new Date().toISOString().split('T')[0];

  for (let h = 1; h <= 50; h++) {
    const billNo = `MED-2026-${String(9000 + h)}`;
    const doc = docs[(h - 1) % docs.length];
    const bType = billTypes[(h - 1) % billTypes.length];
    const mode = paymentModes[(h - 1) % paymentModes.length];
    const consult = doc.fee;
    const pharma = ((h % 3) + 1) * 8500;
    const bed = (h % 3 === 0) ? 350000 : 0;
    const subtotal = consult + pharma + bed;
    const disc = (h % 5 === 0) ? 10000 : 0;
    const netPaid = subtotal - disc;

    list.push({
      id: `hosp_rec_seed_${h}`,
      receipt_no: billNo,
      date: today,
      patient_id: `ent_pat_${(h % 15) + 1}`,
      patient_name: `Patient #${h} (Age: ${(h * 7) % 60 + 18})`,
      uhid: `UHID-2026-${String(1000 + h)}`,
      opd_no: `OPD-${String(8800 + h)}`,
      doctor_name: doc.name,
      department: doc.dept,
      bill_type: bType,
      subtotal_paise: subtotal,
      discount_paise: disc,
      tax_paise: 0,
      net_paid_paise: netPaid,
      payment_mode: mode,
      transaction_ref: mode === 'UPI' ? `UPI-${98218000 + h}` : `POS-${100000 + h}`,
      staff_name: 'Clinical Billing Desk',
      remarks: bType === 'IPD_DISCHARGE' ? 'IPD Room Stay & Clinical Discharge' : 'Clinical Consultation & Medications',
    });
  }
  return list;
};

export const INITIAL_HOSPITAL_PAYMENTS: HospitalBillPaymentRecord[] = generateSeeded50HospitalPayments();

// ----------------------------------------------------------------------------
// 7.5 SEEDED HOSPITAL PHARMACY & MEDICAL SUPPLIES STOCK (15 CLINICAL CONSUMABLES)
// ----------------------------------------------------------------------------
export const INITIAL_HOSPITAL_STOCK: HospitalMedicalStockItem[] = [
  {
    id: 'med_001',
    item_code: 'MED-PCM-IV',
    name: 'Paracetamol IV Infusion 100ml',
    category: 'IV_FLUIDS',
    unit: 'vial',
    current_stock: 120,
    cost_price_paise: 2800, // ₹28.00 purchase rate
    billing_rate_paise: 6500, // ₹65.00 patient billing rate
    batch_no: 'PCM-26B04',
    expiry_date: '2028-06-30',
    reorder_level: 30,
  },
  {
    id: 'med_002',
    item_code: 'MED-CEF-1G',
    name: 'Ceftriaxone Sodium 1g Injection',
    category: 'ANTIBIOTICS',
    unit: 'vial',
    current_stock: 85,
    cost_price_paise: 4200, // ₹42.00
    billing_rate_paise: 9500, // ₹95.00
    batch_no: 'CEF-26D19',
    expiry_date: '2027-11-30',
    reorder_level: 25,
  },
  {
    id: 'med_003',
    item_code: 'MED-AMX-625',
    name: 'Amoxicillin + Clavulanate 625mg (Box of 10)',
    category: 'MEDICINES',
    unit: 'box',
    current_stock: 45,
    cost_price_paise: 11000, // ₹110.00
    billing_rate_paise: 18500, // ₹185.00
    batch_no: 'AMX-26A12',
    expiry_date: '2028-02-28',
    reorder_level: 15,
  },
  {
    id: 'med_004',
    item_code: 'MED-NS-500',
    name: 'Normal Saline 0.9% IV 500ml',
    category: 'IV_FLUIDS',
    unit: 'bottle',
    current_stock: 200,
    cost_price_paise: 1900, // ₹19.00
    billing_rate_paise: 4800, // ₹48.00
    batch_no: 'NS-26E01',
    expiry_date: '2029-01-31',
    reorder_level: 50,
  },
  {
    id: 'med_005',
    item_code: 'MED-RL-500',
    name: 'Ringer Lactate (RL) Solution 500ml',
    category: 'IV_FLUIDS',
    unit: 'bottle',
    current_stock: 160,
    cost_price_paise: 2100, // ₹21.00
    billing_rate_paise: 5200, // ₹52.00
    batch_no: 'RL-26C14',
    expiry_date: '2028-12-31',
    reorder_level: 40,
  },
  {
    id: 'med_006',
    item_code: 'CON-SYR-5ML',
    name: 'Disposable Syringes 5ml with 24G Needle (Box of 100)',
    category: 'CONSUMABLES',
    unit: 'box',
    current_stock: 35,
    cost_price_paise: 29500, // ₹295.00 per box
    billing_rate_paise: 45000, // ₹450.00
    batch_no: 'SYR-26K08',
    expiry_date: '2030-05-31',
    reorder_level: 10,
  },
  {
    id: 'med_007',
    item_code: 'CON-SYR-2ML',
    name: 'Disposable Syringes 2ml with 24G Needle (Box of 100)',
    category: 'CONSUMABLES',
    unit: 'box',
    current_stock: 40,
    cost_price_paise: 26000, // ₹260.00 per box
    billing_rate_paise: 42000, // ₹420.00
    batch_no: 'SYR-26J11',
    expiry_date: '2030-04-30',
    reorder_level: 10,
  },
  {
    id: 'med_008',
    item_code: 'CON-CAN-20G',
    name: 'IV Cannula 20G Pink with Port (Box of 50)',
    category: 'SURGICAL',
    unit: 'box',
    current_stock: 25,
    cost_price_paise: 45000, // ₹450.00
    billing_rate_paise: 75000, // ₹750.00
    batch_no: 'CAN-26H02',
    expiry_date: '2029-08-31',
    reorder_level: 8,
  },
  {
    id: 'med_009',
    item_code: 'CON-GLV-75',
    name: 'Surgical Sterile Gloves Size 7.5 (Box of 50 Pairs)',
    category: 'SURGICAL',
    unit: 'box',
    current_stock: 30,
    cost_price_paise: 55000, // ₹550.00
    billing_rate_paise: 90000, // ₹900.00
    batch_no: 'GLV-26L15',
    expiry_date: '2029-10-31',
    reorder_level: 10,
  },
  {
    id: 'med_010',
    item_code: 'CON-GAUZE-10',
    name: 'Sterile Gauze Swabs 10cm x 10cm (Pack of 100)',
    category: 'CONSUMABLES',
    unit: 'pack',
    current_stock: 50,
    cost_price_paise: 16000, // ₹160.00
    billing_rate_paise: 28000, // ₹280.00
    batch_no: 'GZ-26A20',
    expiry_date: '2031-01-31',
    reorder_level: 15,
  },
  {
    id: 'med_011',
    item_code: 'CON-TAPE-1IN',
    name: 'Micropore Surgical Tape 1 Inch (Pack of 12 Rolls)',
    category: 'CONSUMABLES',
    unit: 'pack',
    current_stock: 22,
    cost_price_paise: 32000, // ₹320.00
    billing_rate_paise: 48000, // ₹480.00
    batch_no: 'TP-26B17',
    expiry_date: '2029-06-30',
    reorder_level: 6,
  },
  {
    id: 'med_012',
    item_code: 'MED-BETA-500',
    name: 'Betadine Antiseptic Solution 500ml',
    category: 'CONSUMABLES',
    unit: 'bottle',
    current_stock: 28,
    cost_price_paise: 18500, // ₹185.00
    billing_rate_paise: 26000, // ₹260.00
    batch_no: 'BET-26D09',
    expiry_date: '2028-09-30',
    reorder_level: 8,
  },
  {
    id: 'med_013',
    item_code: 'MED-DICLO-75',
    name: 'Diclofenac Sodium 75mg/3ml Ampoule (Box of 10)',
    category: 'INJECTIONS',
    unit: 'box',
    current_stock: 60,
    cost_price_paise: 4500, // ₹45.00
    billing_rate_paise: 9000, // ₹90.00
    batch_no: 'DIC-26G14',
    expiry_date: '2028-04-30',
    reorder_level: 15,
  },
  {
    id: 'med_014',
    item_code: 'MED-ONDAN-4',
    name: 'Ondansetron 4mg/2ml Antiemetic Injection (Box of 10)',
    category: 'INJECTIONS',
    unit: 'box',
    current_stock: 55,
    cost_price_paise: 5200, // ₹52.00
    billing_rate_paise: 11000, // ₹110.00
    batch_no: 'OND-26F22',
    expiry_date: '2028-03-31',
    reorder_level: 15,
  },
  {
    id: 'med_015',
    item_code: 'MED-PAN-40',
    name: 'Pantoprazole 40mg IV Injection (Vial)',
    category: 'INJECTIONS',
    unit: 'vial',
    current_stock: 110,
    cost_price_paise: 2400, // ₹24.00
    billing_rate_paise: 6000, // ₹60.00
    batch_no: 'PAN-26E18',
    expiry_date: '2028-11-30',
    reorder_level: 30,
  },
];

// ----------------------------------------------------------------------------
// 8. STORAGE KEYS & PERSISTENCE HELPER SERVICE
// ----------------------------------------------------------------------------
const STORAGE_KEYS = {
  PATIENTS: 'omnibill_hospital_patients_v2',
  DOCTORS: 'omnibill_hospital_doctors_v2',
  BEDS: 'omnibill_hospital_beds_v2',
  DIAGNOSTICS: 'omnibill_hospital_diagnostics_v2',
  EXPENSES: 'omnibill_hospital_expenses_v2',
  SETTINGS: 'omnibill_hospital_settings_v2',
  PAYMENTS: 'omnibill_hospital_payments_v2',
  MED_STOCK: 'omnibill_hospital_med_stock_v2',
  PURCHASE_VOUCHERS: 'omnibill_hospital_purchase_vouchers_v2',
};

export class HospitalDataService {
  // Patients
  static getPatients(): PatientEntity[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.PATIENTS);
      if (data) {
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed) && parsed.length >= INITIAL_HOSPITAL_PATIENTS.length) {
          return parsed;
        }
      }
    } catch (e) {
      console.warn('Failed to parse hospital patients from localStorage:', e);
    }
    this.savePatients(INITIAL_HOSPITAL_PATIENTS);
    return INITIAL_HOSPITAL_PATIENTS;
  }

  static savePatients(patients: PatientEntity[]): void {
    try {
      localStorage.setItem(STORAGE_KEYS.PATIENTS, JSON.stringify(patients));
    } catch (e) {
      console.error('Failed to save hospital patients:', e);
    }
  }

  static addPatient(patient: PatientEntity): PatientEntity[] {
    const list = this.getPatients();
    const updated = [patient, ...list];
    this.savePatients(updated);
    return updated;
  }

  // Doctor Rules
  static getDoctorRules(): DoctorConsultationRule[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.DOCTORS);
      if (data) return JSON.parse(data);
    } catch (e) {
      console.warn('Failed to parse doctor rules:', e);
    }
    this.saveDoctorRules(INITIAL_DOCTOR_RULES);
    return INITIAL_DOCTOR_RULES;
  }

  static saveDoctorRules(rules: DoctorConsultationRule[]): void {
    try {
      localStorage.setItem(STORAGE_KEYS.DOCTORS, JSON.stringify(rules));
    } catch (e) {
      console.error('Failed to save doctor rules:', e);
    }
  }

  // Bed Rules
  static getBedRules(): BedCategoryRule[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.BEDS);
      if (data) return JSON.parse(data);
    } catch (e) {
      console.warn('Failed to parse bed rules:', e);
    }
    this.saveBedRules(INITIAL_BED_RULES);
    return INITIAL_BED_RULES;
  }

  static saveBedRules(rules: BedCategoryRule[]): void {
    try {
      localStorage.setItem(STORAGE_KEYS.BEDS, JSON.stringify(rules));
    } catch (e) {
      console.error('Failed to save bed rules:', e);
    }
  }

  // Diagnostics
  static getDiagnosticTests(): DiagnosticTestItem[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.DIAGNOSTICS);
      if (data) return JSON.parse(data);
    } catch (e) {
      console.warn('Failed to parse diagnostic tests:', e);
    }
    this.saveDiagnosticTests(INITIAL_DIAGNOSTIC_TESTS);
    return INITIAL_DIAGNOSTIC_TESTS;
  }

  static saveDiagnosticTests(tests: DiagnosticTestItem[]): void {
    try {
      localStorage.setItem(STORAGE_KEYS.DIAGNOSTICS, JSON.stringify(tests));
    } catch (e) {
      console.error('Failed to save diagnostic tests:', e);
    }
  }

  // Expenses
  static getExpenses(): HospitalExpense[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.EXPENSES);
      if (data) return JSON.parse(data);
    } catch (e) {
      console.warn('Failed to parse hospital expenses:', e);
    }
    this.saveExpenses(INITIAL_HOSPITAL_EXPENSES);
    return INITIAL_HOSPITAL_EXPENSES;
  }

  static saveExpenses(expenses: HospitalExpense[]): void {
    try {
      localStorage.setItem(STORAGE_KEYS.EXPENSES, JSON.stringify(expenses));
    } catch (e) {
      console.error('Failed to save hospital expenses:', e);
    }
  }

  static addExpense(expense: HospitalExpense): HospitalExpense[] {
    const list = this.getExpenses();
    const updated = [expense, ...list];
    this.saveExpenses(updated);
    return updated;
  }

  // Settings
  static getReceiptSettings(): HospitalReceiptSettings {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      if (data) return JSON.parse(data);
    } catch (e) {
      console.warn('Failed to parse hospital receipt settings:', e);
    }
    this.saveReceiptSettings(DEFAULT_HOSPITAL_RECEIPT_SETTINGS);
    return DEFAULT_HOSPITAL_RECEIPT_SETTINGS;
  }

  static saveReceiptSettings(settings: HospitalReceiptSettings): void {
    try {
      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
    } catch (e) {
      console.error('Failed to save hospital receipt settings:', e);
    }
  }

  // Payments / Audit History
  static getPayments(): HospitalBillPaymentRecord[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.PAYMENTS);
      if (data) {
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed) && parsed.length >= 50) return parsed;
      }
    } catch (e) {
      console.warn('Failed to parse hospital payments:', e);
    }
    this.savePayments(INITIAL_HOSPITAL_PAYMENTS);
    return INITIAL_HOSPITAL_PAYMENTS;
  }

  static savePayments(payments: HospitalBillPaymentRecord[]): void {
    try {
      localStorage.setItem(STORAGE_KEYS.PAYMENTS, JSON.stringify(payments));
    } catch (e) {
      console.error('Failed to save hospital payments:', e);
    }
  }

  static recordPayment(payment: HospitalBillPaymentRecord): HospitalBillPaymentRecord[] {
    const list = this.getPayments();
    const updated = [payment, ...list];
    this.savePayments(updated);
    return updated;
  }

  // Medical Pharmacy & Consumables Stock
  static getMedicalStock(): HospitalMedicalStockItem[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.MED_STOCK);
      if (data) {
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed) && parsed.length >= INITIAL_HOSPITAL_STOCK.length) {
          return parsed;
        }
      }
    } catch (e) {
      console.warn('Failed to parse hospital medical stock:', e);
    }
    this.saveMedicalStock(INITIAL_HOSPITAL_STOCK);
    return INITIAL_HOSPITAL_STOCK;
  }

  static saveMedicalStock(items: HospitalMedicalStockItem[]): void {
    try {
      localStorage.setItem(STORAGE_KEYS.MED_STOCK, JSON.stringify(items));
    } catch (e) {
      console.error('Failed to save hospital medical stock:', e);
    }
  }

  static addMedicalStockItem(item: HospitalMedicalStockItem): HospitalMedicalStockItem[] {
    const list = this.getMedicalStock();
    const updated = [item, ...list];
    this.saveMedicalStock(updated);
    return updated;
  }

  // Inward Purchase Vouchers History
  static getPurchaseVouchers(): PurchaseExpenseVoucher[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.PURCHASE_VOUCHERS);
      if (data) return JSON.parse(data);
    } catch (e) {
      console.warn('Failed to parse hospital purchase vouchers:', e);
    }
    return [];
  }

  static savePurchaseVouchers(vouchers: PurchaseExpenseVoucher[]): void {
    try {
      localStorage.setItem(STORAGE_KEYS.PURCHASE_VOUCHERS, JSON.stringify(vouchers));
    } catch (e) {
      console.error('Failed to save hospital purchase vouchers:', e);
    }
  }

  // Inward Clinical Stock, increment quantity, update cost rate, and generate voucher
  static inwardMedicalStock(purchase: {
    supplierName: string;
    supplierGstin?: string;
    supplierPhone?: string;
    invoiceDate: string;
    voucherNumber: string;
    paymentMode: 'CASH' | 'BANK_TRANSFER' | 'CREDIT' | 'UPI';
    remarks?: string;
    lines: Array<{
      itemId: string;
      quantity: number;
      costPricePaise: number;
    }>;
  }): PurchaseExpenseVoucher {
    const stock = this.getMedicalStock();
    const voucherItems: Array<{
      name: string;
      sku: string;
      quantity: number;
      unit: string;
      costPricePaise: number;
      lineTotalPaise: number;
    }> = [];

    let totalExpensePaise = 0;

    purchase.lines.forEach((line) => {
      const item = stock.find((s) => s.id === line.itemId);
      if (item) {
        item.current_stock += line.quantity;
        item.cost_price_paise = line.costPricePaise;
        const lineTotal = line.quantity * line.costPricePaise;
        totalExpensePaise += lineTotal;
        voucherItems.push({
          name: item.name,
          sku: item.item_code,
          quantity: line.quantity,
          unit: item.unit,
          costPricePaise: line.costPricePaise,
          lineTotalPaise: lineTotal,
        });
      }
    });

    this.saveMedicalStock(stock);

    // Also inward to ErpStorageService (Item Master & Inventory Lots)
    try {
      ErpStorageService.inwardStock(
        purchase.lines.map((l) => {
          const item = stock.find((s) => s.id === l.itemId);
          return {
            resource_id: l.itemId,
            sku: item?.item_code,
            name: item?.name,
            quantity_milli: l.quantity * 1000,
            cost_price_paise: l.costPricePaise,
          };
        })
      );
    } catch (e) {
      console.warn('Failed to inward hospital stock to ErpStorageService:', e);
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('omnibill_catalog_sync', {
          detail: { vertical: 'HOSPITAL' },
        })
      );
    }

    const settings = this.getReceiptSettings();
    const voucher: PurchaseExpenseVoucher = {
      voucherNumber: purchase.voucherNumber,
      invoiceDate: purchase.invoiceDate,
      supplierName: purchase.supplierName,
      supplierGstin: purchase.supplierGstin,
      supplierPhone: purchase.supplierPhone,
      businessName: settings.hospital_name || 'City Multispeciality Hospital',
      businessGstin: settings.registration_number,
      businessAddress: settings.address,
      paymentMode: purchase.paymentMode,
      remarks: purchase.remarks,
      items: voucherItems,
      totalExpensePaise,
      verticalType: 'HOSPITAL',
    };

    const pastVouchers = this.getPurchaseVouchers();
    this.savePurchaseVouchers([voucher, ...pastVouchers]);

    // Also automatically log as a hospital operational expense
    this.addExpense({
      id: 'exp_' + Date.now(),
      date: purchase.invoiceDate,
      payee: purchase.supplierName,
      category: 'PHARMACY_RESTOCK',
      amount_paise: totalExpensePaise,
      payment_mode: purchase.paymentMode,
      voucher_no: purchase.voucherNumber,
      remarks: `Inward of ${voucherItems.length} clinical items: ${voucherItems.map((i) => i.name).slice(0, 2).join(', ')}`,
    });

    return voucher;
  }
}

// ----------------------------------------------------------------------------
// 9. EXPORT & SHARING HELPERS (CSV, WHATSAPP)
// ----------------------------------------------------------------------------
export const exportHospitalPaymentsToCSV = (payments: HospitalBillPaymentRecord[]): void => {
  const headers = [
    'Receipt No',
    'Date',
    'UHID',
    'Patient Name',
    'OPD/IPD No',
    'Doctor',
    'Department',
    'Bill Type',
    'Subtotal (INR)',
    'Discount (INR)',
    'Net Paid (INR)',
    'Payment Mode',
    'Transaction Ref',
    'Staff Signatory',
    'Remarks',
  ];

  const rows = payments.map((p) => [
    `"${p.receipt_no}"`,
    `"${p.date}"`,
    `"${p.uhid}"`,
    `"${p.patient_name.replace(/"/g, '""')}"`,
    `"${p.opd_no}"`,
    `"${p.doctor_name.replace(/"/g, '""')}"`,
    `"${p.department}"`,
    `"${p.bill_type}"`,
    (p.subtotal_paise / 100).toFixed(2),
    (p.discount_paise / 100).toFixed(2),
    (p.net_paid_paise / 100).toFixed(2),
    `"${p.payment_mode}"`,
    `"${p.transaction_ref}"`,
    `"${p.staff_name}"`,
    `"${(p.remarks || '').replace(/"/g, '""')}"`,
  ]);

  const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `Hospital_Collection_Report_${new Date().toISOString().split('T')[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

export const exportPatientsToCSV = (patients: PatientEntity[]): void => {
  const headers = [
    'UHID',
    'OPD/IPD No',
    'Patient Name',
    'Age',
    'Gender',
    'Blood Group',
    'Department',
    'Doctor',
    'Room/Bed',
    'Phone',
    'Diagnosis',
    'Outstanding Dues (INR)',
    'Emergency Contact',
  ];

  const rows = patients.map((p) => [
    `"${p.uhid}"`,
    `"${p.opd_no}"`,
    `"${p.full_name.replace(/"/g, '""')}"`,
    p.age,
    `"${p.gender}"`,
    `"${p.blood_group || '-'}"`,
    `"${p.department}"`,
    `"${p.doctor_name.replace(/"/g, '""')}"`,
    `"${p.room_bed_no || 'OPD'}"`,
    `"${p.phone || '-'}"`,
    `"${(p.diagnosis || '').replace(/"/g, '""')}"`,
    ((p.dues_balance_paise || 0) / 100).toFixed(2),
    `"${(p.emergency_contact || '').replace(/"/g, '""')}"`,
  ]);

  const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `Patients_Directory_${new Date().toISOString().split('T')[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

export const generateHospitalDayBookWhatsAppLink = (
  date: string,
  totalCollectedPaise: number,
  billsCount: number,
  staffName: string
): string => {
  const text = encodeURIComponent(
    `🏥 *LIFECARE MULTI-SPECIALITY HOSPITAL — DAILY COLLECTION DAY-BOOK*\n` +
      `📅 *Date:* ${date}\n` +
      `👤 *Cashier / Billing In-Charge:* ${staffName}\n` +
      `🧾 *Total Invoices Generated:* ${billsCount}\n` +
      `💰 *Total Revenue Collected:* ₹${(totalCollectedPaise / 100).toLocaleString('en-IN')}\n\n` +
      `✅ *All OPD, IPD, Diagnostics & Pharmacy ledger vouchers balanced.*`
  );
  return `https://wa.me/?text=${text}`;
};

export const generatePatientBillWhatsAppLink = (
  patient: PatientEntity,
  receiptNo: string,
  amountPaise: number,
  itemsSummary: string
): string => {
  const cleanPhone = (patient.phone || '').replace(/[^0-9]/g, '');
  const targetPhone = cleanPhone.startsWith('91') ? cleanPhone : cleanPhone.length === 10 ? `91${cleanPhone}` : '';

  const text = encodeURIComponent(
    `🏥 *LIFECARE MULTI-SPECIALITY HOSPITAL*\n` +
      `Dear *${patient.full_name}*,\n` +
      `Your medical bill receipt *#${receiptNo}* has been successfully generated.\n\n` +
      `📋 *UHID:* ${patient.uhid}\n` +
      `👨‍⚕️ *Attending Doctor:* ${patient.doctor_name}\n` +
      `💉 *Services / Items:* ${itemsSummary}\n` +
      `💵 *Amount Paid:* ₹${(amountPaise / 100).toLocaleString('en-IN')}\n\n` +
      `Thank you for trusting Lifecare. Wishing you a swift recovery! 🌸`
  );

  return targetPhone ? `https://wa.me/${targetPhone}?text=${text}` : `https://wa.me/?text=${text}`;
};
