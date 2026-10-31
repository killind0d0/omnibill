// ui/src/components/importer/CatalogImporterModal.tsx
// High-performance Excel (.xlsx/.xls) and CSV bulk inventory catalog importer

import React, { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Download,
  X,
  ArrowRight,
  Database,
  Layers,
  Store,
  RefreshCw,
} from 'lucide-react';
import { ResourceItem } from '../../types/pos';
import { getActiveVertical, posStorage } from '../../lib/api';
import { ErpStorageService } from '../../lib/erpStorage';
import { posSound } from '../../lib/sound';
import { formatPaise } from '../../lib/tax';

interface CatalogImporterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportSuccess: (importedCount: number) => void;
}

interface ColumnMapping {
  name: string;
  sku: string;
  barcode: string;
  base_price: string;
  mrp: string;
  cost_price: string;
  stock: string;
  tax_rate: string;
  hsn: string;
  unit: string;
  category: string;
}

interface ParsedPreviewItem {
  id: string;
  name: string;
  sku: string;
  barcode: string;
  base_price_paise: number;
  mrp_paise?: number;
  cost_price_paise: number;
  stock_milli: number;
  tax_rate_bps: number;
  hsn: string;
  unit: string;
  category: string;
  isValid: boolean;
  validationError?: string;
}

// ----------------------------------------------------------------------------
// STARTER CATALOG TEMPLATES FOR 1-CLICK ONBOARDING
// ----------------------------------------------------------------------------
const STARTER_PRESETS = [
  {
    id: 'grocery',
    name: 'Supermarket & Kirana Pack',
    icon: Store,
    count: 15,
    description: 'Dairy, biscuits, spices, pulses, rice, cooking oil with Indian barcodes & GST',
    items: [
      { name: 'Amul Butter 100g', sku: 'AMUL-BUT-100', barcode: '8901262010107', price: 58.0, mrp: 60.0, cost: 52.0, stock: 40, tax: 12, hsn: '0405', unit: 'pkt' },
      { name: 'Fortune Sunlite Sunflower Oil 1L', sku: 'FORT-OIL-1L', barcode: '8906007281014', price: 145.0, mrp: 160.0, cost: 130.0, stock: 50, tax: 5, hsn: '1512', unit: 'pouch' },
      { name: 'Tata Tea Gold 250g', sku: 'TATA-TEA-250', barcode: '8901052002018', price: 160.0, mrp: 175.0, cost: 140.0, stock: 30, tax: 5, hsn: '0902', unit: 'box' },
      { name: 'Aashirvaad Shudh Chakki Atta 5kg', sku: 'AASH-ATTA-5K', barcode: '8901725181222', price: 245.0, mrp: 275.0, cost: 215.0, stock: 25, tax: 5, hsn: '1101', unit: 'bag' },
      { name: 'Good Day Butter Cookies 200g', sku: 'GOOD-DAY-200', barcode: '8901063141157', price: 40.0, mrp: 45.0, cost: 34.0, stock: 80, tax: 18, hsn: '1905', unit: 'pkt' },
      { name: 'Surf Excel Quick Wash Detergent 1kg', sku: 'SURF-EX-1K', barcode: '8901030381012', price: 155.0, mrp: 170.0, cost: 135.0, stock: 35, tax: 18, hsn: '3402', unit: 'pkt' },
      { name: 'Vim Dishwash Gel 500ml', sku: 'VIM-GEL-500', barcode: '8901030781010', price: 110.0, mrp: 125.0, cost: 95.0, stock: 45, tax: 18, hsn: '3402', unit: 'btl' },
      { name: 'Dabur Red Toothpaste 150g', sku: 'DAB-RED-150', barcode: '8901207010520', price: 105.0, mrp: 120.0, cost: 90.0, stock: 60, tax: 18, hsn: '3306', unit: 'tube' },
      { name: 'Haldiram Bhujia Sev 400g', sku: 'HALD-BHUJ-400', barcode: '8904063200102', price: 115.0, mrp: 130.0, cost: 98.0, stock: 50, tax: 12, hsn: '2106', unit: 'pkt' },
      { name: 'Maggi 2-Minute Noodles 70g (Pack of 4)', sku: 'MAGG-4PK', barcode: '8901058852303', price: 56.0, mrp: 60.0, cost: 48.0, stock: 90, tax: 12, hsn: '1902', unit: 'pack' },
      { name: 'Tata Salt Crystal Salt 1kg', sku: 'TATA-SALT-1K', barcode: '8904043901005', price: 25.0, mrp: 28.0, cost: 21.0, stock: 120, tax: 5, hsn: '2501', unit: 'kg' },
      { name: 'Everest Turmeric Powder 200g', sku: 'EVER-TURM-200', barcode: '8901786101016', price: 62.0, mrp: 70.0, cost: 52.0, stock: 40, tax: 5, hsn: '0910', unit: 'pkt' },
      { name: 'Toor Dal Premium Desi 1kg', sku: 'TOOR-DAL-1K', barcode: '8908001001019', price: 165.0, mrp: 180.0, cost: 145.0, stock: 60, tax: 0, hsn: '0713', unit: 'kg' },
      { name: 'Madhur Pure Sugar 1kg', sku: 'MADH-SUG-1K', barcode: '8906001001021', price: 52.0, mrp: 58.0, cost: 45.0, stock: 100, tax: 5, hsn: '1701', unit: 'kg' },
      { name: 'Kissan Fresh Tomato Ketchup 500g', sku: 'KISS-KET-500', barcode: '8901030611010', price: 95.0, mrp: 110.0, cost: 80.0, stock: 35, tax: 12, hsn: '2103', unit: 'btl' },
    ],
  },
  {
    id: 'pharmacy',
    name: 'Pharmacy & Medical Pack',
    icon: Layers,
    count: 10,
    description: 'Pain relief, antibiotics, antacids, vitamins, cough syrups with HSN 3004',
    items: [
      { name: 'Dolo 650mg Strip of 15 Tab', sku: 'DOLO-650', barcode: '8901117101015', price: 34.0, mrp: 38.0, cost: 24.0, stock: 150, tax: 12, hsn: '3004', unit: 'strip' },
      { name: 'Pan 40 Tablet (Strip of 15)', sku: 'PAN-40-TAB', barcode: '8901117102029', price: 145.0, mrp: 162.0, cost: 110.0, stock: 80, tax: 12, hsn: '3004', unit: 'strip' },
      { name: 'Azithral 500mg (Strip of 3)', sku: 'AZITH-500', barcode: '8901117103033', price: 118.0, mrp: 132.0, cost: 90.0, stock: 45, tax: 12, hsn: '3004', unit: 'strip' },
      { name: 'Becosules Z Capsules (Strip of 20)', sku: 'BECO-Z-CAP', barcode: '8901117104047', price: 48.0, mrp: 54.0, cost: 36.0, stock: 100, tax: 12, hsn: '3004', unit: 'strip' },
      { name: 'Benadryl Cough Syrup 100ml', sku: 'BENA-SYR-100', barcode: '8901117105051', price: 125.0, mrp: 140.0, cost: 95.0, stock: 40, tax: 12, hsn: '3004', unit: 'btl' },
      { name: 'Volini Pain Relief Spray 55g', sku: 'VOLI-SPRAY-55', barcode: '8901117106065', price: 185.0, mrp: 210.0, cost: 145.0, stock: 30, tax: 12, hsn: '3004', unit: 'can' },
      { name: 'Ecosprin 75mg (Strip of 14)', sku: 'ECO-75-TAB', barcode: '8901117107079', price: 8.5, mrp: 10.0, cost: 5.5, stock: 200, tax: 12, hsn: '3004', unit: 'strip' },
      { name: 'Ciplox 500mg Tablet (Strip of 10)', sku: 'CIPLOX-500', barcode: '8901117108083', price: 42.0, mrp: 48.0, cost: 31.0, stock: 65, tax: 12, hsn: '3004', unit: 'strip' },
      { name: 'Shelcal 500 Calcium (Strip of 15)', sku: 'SHEL-500-CAL', barcode: '8901117109097', price: 115.0, mrp: 130.0, cost: 88.0, stock: 90, tax: 12, hsn: '3004', unit: 'strip' },
      { name: 'Betadine 10% Ointment 20g', sku: 'BETA-OINT-20', barcode: '8901117110109', price: 95.0, mrp: 110.0, cost: 72.0, stock: 50, tax: 12, hsn: '3004', unit: 'tube' },
    ],
  },
];

export const CatalogImporterModal: React.FC<CatalogImporterModalProps> = ({
  isOpen,
  onClose,
  onImportSuccess,
}) => {
  const [fileData, setFileData] = useState<any[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [fileName, setFileName] = useState<string>('');
  const [mapping, setMapping] = useState<ColumnMapping>({
    name: '',
    sku: '',
    barcode: '',
    base_price: '',
    mrp: '',
    cost_price: '',
    stock: '',
    tax_rate: '',
    hsn: '',
    unit: '',
    category: '',
  });
  const [previewItems, setPreviewItems] = useState<ParsedPreviewItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeStep, setActiveStep] = useState<'UPLOAD' | 'MAP' | 'PREVIEW'>('UPLOAD');

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  // Smart Header Auto-Detection
  const autoDetectColumns = (colHeaders: string[]) => {
    const newMapping: ColumnMapping = {
      name: '',
      sku: '',
      barcode: '',
      base_price: '',
      mrp: '',
      cost_price: '',
      stock: '',
      tax_rate: '',
      hsn: '',
      unit: '',
      category: '',
    };

    colHeaders.forEach((h) => {
      const lower = h.toLowerCase().trim();
      if (!newMapping.name && (lower.includes('name') || lower.includes('product') || lower.includes('item') || lower.includes('desc'))) {
        newMapping.name = h;
      } else if (!newMapping.sku && (lower.includes('sku') || lower.includes('code') || lower.includes('id'))) {
        newMapping.sku = h;
      } else if (!newMapping.barcode && (lower.includes('barcode') || lower.includes('ean') || lower.includes('upc'))) {
        newMapping.barcode = h;
      } else if (!newMapping.base_price && (lower.includes('sale') || lower.includes('selling') || lower.includes('price') || lower.includes('rate'))) {
        newMapping.base_price = h;
      } else if (!newMapping.mrp && lower.includes('mrp')) {
        newMapping.mrp = h;
      } else if (!newMapping.cost_price && (lower.includes('cost') || lower.includes('purchase') || lower.includes('buy'))) {
        newMapping.cost_price = h;
      } else if (!newMapping.stock && (lower.includes('stock') || lower.includes('qty') || lower.includes('quantity') || lower.includes('balance'))) {
        newMapping.stock = h;
      } else if (!newMapping.tax_rate && (lower.includes('tax') || lower.includes('gst'))) {
        newMapping.tax_rate = h;
      } else if (!newMapping.hsn && (lower.includes('hsn') || lower.includes('sac'))) {
        newMapping.hsn = h;
      } else if (!newMapping.unit && (lower.includes('unit') || lower.includes('uom'))) {
        newMapping.unit = h;
      } else if (!newMapping.category && lower.includes('cat')) {
        newMapping.category = h;
      }
    });

    setMapping(newMapping);
  };

  // Handle uploaded file (Excel or CSV)
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    setFileName(file.name);
    setIsProcessing(true);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json<any>(ws, { header: 1 });

        if (data.length < 2) {
          alert('Uploaded sheet is empty or contains no header row.');
          setIsProcessing(false);
          return;
        }

        const colHeaders = (data[0] as string[]).map((h) => String(h || '').trim());
        const rowData = data.slice(1).filter((r: any) => r && r.length > 0);

        setHeaders(colHeaders);
        setFileData(rowData);
        autoDetectColumns(colHeaders);
        setActiveStep('MAP');
        posSound.playItemAdd();
      } catch (err) {
        alert('Failed to parse file. Please verify it is a valid .xlsx or .csv file.');
      } finally {
        setIsProcessing(false);
      }
    };
    reader.readAsBinaryString(file);
  };

  // Generate preview items based on current mapping
  const buildPreviewItems = () => {
    if (!mapping.name) {
      alert('Please select which column contains the Item Name.');
      return;
    }

    const nameIdx = headers.indexOf(mapping.name);
    const skuIdx = headers.indexOf(mapping.sku);
    const barcodeIdx = headers.indexOf(mapping.barcode);
    const priceIdx = headers.indexOf(mapping.base_price);
    const mrpIdx = headers.indexOf(mapping.mrp);
    const costIdx = headers.indexOf(mapping.cost_price);
    const stockIdx = headers.indexOf(mapping.stock);
    const taxIdx = headers.indexOf(mapping.tax_rate);
    const hsnIdx = headers.indexOf(mapping.hsn);
    const unitIdx = headers.indexOf(mapping.unit);
    const catIdx = headers.indexOf(mapping.category);

    const parsed: ParsedPreviewItem[] = [];

    fileData.forEach((row, index) => {
      const rawName = String(row[nameIdx] || '').trim();
      if (!rawName) return;

      const rawSku = skuIdx >= 0 ? String(row[skuIdx] || '').trim() : '';
      const rawBarcode = barcodeIdx >= 0 ? String(row[barcodeIdx] || '').trim() : '';
      const rawPrice = priceIdx >= 0 ? parseFloat(String(row[priceIdx]).replace(/[^0-9.]/g, '')) : 0;
      const rawMrp = mrpIdx >= 0 ? parseFloat(String(row[mrpIdx]).replace(/[^0-9.]/g, '')) : undefined;
      const rawCost = costIdx >= 0 ? parseFloat(String(row[costIdx]).replace(/[^0-9.]/g, '')) : 0;
      const rawStock = stockIdx >= 0 ? parseFloat(String(row[stockIdx]).replace(/[^0-9.]/g, '')) : 0;
      const rawTax = taxIdx >= 0 ? parseFloat(String(row[taxIdx]).replace(/[^0-9.]/g, '')) : 0;
      const rawHsn = hsnIdx >= 0 ? String(row[hsnIdx] || '').trim() : '9999';
      const rawUnit = unitIdx >= 0 ? String(row[unitIdx] || 'pcs').trim() : 'pcs';
      const rawCat = catIdx >= 0 ? String(row[catIdx] || 'General').trim() : 'General';

      // Integer paise conversion
      const pricePaise = isNaN(rawPrice) ? 0 : Math.round(rawPrice * 100);
      const mrpPaise = rawMrp && !isNaN(rawMrp) ? Math.round(rawMrp * 100) : undefined;
      const costPaise = isNaN(rawCost) ? Math.round(pricePaise * 0.8) : Math.round(rawCost * 100);
      const stockMilli = isNaN(rawStock) ? 10000 : Math.round(rawStock * 1000);
      
      // Standardize tax basis points (e.g. 18% -> 1800 bps, 5 -> 500)
      let taxBps = isNaN(rawTax) ? 0 : Math.round(rawTax * 100);
      if (taxBps > 0 && taxBps < 100) taxBps = taxBps * 100; // if entered as 18 instead of 1800

      const autoSku = rawSku || `ITEM-${Math.floor(1000 + Math.random() * 9000)}`;
      const autoBarcode = rawBarcode || autoSku;

      parsed.push({
        id: `imp_${Date.now()}_${index}`,
        name: rawName,
        sku: autoSku,
        barcode: autoBarcode,
        base_price_paise: pricePaise,
        mrp_paise: mrpPaise,
        cost_price_paise: costPaise,
        stock_milli: stockMilli,
        tax_rate_bps: taxBps,
        hsn: rawHsn,
        unit: rawUnit,
        category: rawCat,
        isValid: pricePaise >= 0,
      });
    });

    setPreviewItems(parsed);
    setActiveStep('PREVIEW');
    posSound.playItemAdd();
  };

  // Load a Starter Preset Pack
  const handleLoadPreset = (presetId: string) => {
    const preset = STARTER_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;

    const parsed: ParsedPreviewItem[] = preset.items.map((item, idx) => ({
      id: `preset_${preset.id}_${idx}`,
      name: item.name,
      sku: item.sku,
      barcode: item.barcode,
      base_price_paise: Math.round(item.price * 100),
      mrp_paise: Math.round(item.mrp * 100),
      cost_price_paise: Math.round(item.cost * 100),
      stock_milli: Math.round(item.stock * 1000),
      tax_rate_bps: item.tax * 100,
      hsn: item.hsn,
      unit: item.unit,
      category: preset.name,
      isValid: true,
    }));

    setFileName(`${preset.name} (Preset Template)`);
    setPreviewItems(parsed);
    setActiveStep('PREVIEW');
    posSound.playSuccess();
  };

  // Download Sample CSV Template
  const handleDownloadSampleCsv = () => {
    const sampleHeaders = ['Item Name', 'SKU', 'Barcode', 'Sale Price', 'MRP', 'Cost Price', 'Opening Stock', 'GST Rate %', 'HSN Code', 'Unit', 'Category'];
    const sampleRows = [
      ['Amul Taaza Milk 500ml', 'MILK-500', '8901262010053', '28.00', '28.00', '25.00', '45', '0', '0401', 'pkt', 'Dairy'],
      ['Parle-G Biscuit 100g', 'PARLE-100', '8901719101014', '10.00', '10.00', '8.50', '120', '5', '1905', 'pkt', 'Snacks'],
      ['Dettol Liquid 250ml', 'DET-250', '8901396112104', '165.00', '175.00', '140.00', '25', '12', '3004', 'btl', 'Personal Care'],
    ];

    const csvContent = [sampleHeaders.join(','), ...sampleRows.map((r) => r.map((c) => `"${c}"`).join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'omnibill_sample_inventory_template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    posSound.playItemAdd();
  };

  // Commit Items into LocalStorage & System State
  const handleCommitImport = () => {
    if (previewItems.length === 0) return;

    try {
      const v = getActiveVertical();

      // 1. Ingest into posStorage (LightningPOS & Counter Catalog)
      const existingPos = posStorage.getProducts();
      const newPosItems: ResourceItem[] = previewItems.map((p) => ({
        id: p.id,
        sku: p.sku,
        barcode: p.barcode,
        name: p.name,
        hsn: p.hsn,
        unit: p.unit,
        tax_rate_bps: p.tax_rate_bps,
        base_price_paise: p.base_price_paise,
        cost_price_paise: p.cost_price_paise,
        stock_milli: p.stock_milli,
      }));

      // Merge and deduplicate by barcode/sku
      const posMap = new Map<string, ResourceItem>();
      existingPos.forEach((item) => posMap.set(item.barcode.toLowerCase(), item));
      newPosItems.forEach((item) => posMap.set(item.barcode.toLowerCase(), item));
      const mergedPos = Array.from(posMap.values());
      posStorage.setProducts(mergedPos);

      // 2. Ingest into ErpStorage for Item Master, Stock Valuation & Downstream Reports
      const existingErp = ErpStorageService.getItems();
      const erpMap = new Map<string, any>();
      existingErp.forEach((item) => erpMap.set((item.barcode || item.sku).toLowerCase(), item));

      for (const p of previewItems) {
        erpMap.set((p.barcode || p.sku).toLowerCase(), {
          id: p.id,
          sku: p.sku,
          barcode: p.barcode,
          name: p.name,
          hsn_sac: p.hsn,
          tax_rate_bps: p.tax_rate_bps,
          base_price_paise: p.base_price_paise,
          cost_price_paise: p.cost_price_paise,
          unit: p.unit,
          is_stock_tracked: true,
          reorder_level_milli: 10000,
          category: p.category,
          created_at: new Date().toISOString(),
          lots: [
            {
              id: `lot_${p.id}`,
              resource_id: p.id,
              batch_number: 'BATCH-INIT',
              expiry_date: '2027-12-31',
              mrp_paise: p.mrp_paise || p.base_price_paise,
              cost_price_paise: p.cost_price_paise,
              current_stock_milli: p.stock_milli,
              created_at: new Date().toISOString(),
            },
          ],
        });
      }
      const mergedErp = Array.from(erpMap.values());
      ErpStorageService.saveItems(mergedErp);

      // 3. Dispatch global catalog sync event
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('omnibill_catalog_sync', { detail: { vertical: v } }));
      }

      posSound.playSuccess();
      onImportSuccess(previewItems.length);
      onClose();
    } catch (err: any) {
      alert(`Import failed: ${err?.message || 'Storage quota error'}`);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 select-none animate-in fade-in duration-150">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 bg-slate-850 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center text-white shadow-md shadow-emerald-500/20">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center space-x-2">
                <span>Excel & CSV Catalog Importer</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 uppercase font-mono font-bold">
                  Zero-Friction Migration
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                Migrate inventory from Tally, Vyapar, myBillBook, or Excel in seconds.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Multi-Step Wizard Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* STEP 1: UPLOAD OR LOAD PRESETS */}
          {activeStep === 'UPLOAD' && (
            <div className="space-y-6">
              {/* Drag and Drop Zone */}
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-slate-700 hover:border-emerald-500/60 bg-slate-950/60 hover:bg-slate-950 rounded-2xl p-8 flex flex-col items-center justify-center text-center cursor-pointer transition-all group"
              >
                <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 mb-3 group-hover:scale-110 transition-transform">
                  <Upload className="w-7 h-7" />
                </div>
                <h4 className="text-sm font-bold text-white">
                  Drag and drop your spreadsheet here, or click to browse
                </h4>
                <p className="text-xs text-slate-400 mt-1 max-w-sm">
                  Supports Excel (<span className="text-slate-300 font-mono">.xlsx</span>, <span className="text-slate-300 font-mono">.xls</span>) and Comma-Separated Values (<span className="text-slate-300 font-mono">.csv</span>)
                </p>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx, .xls, .csv, .tsv"
                  onChange={handleFileUpload}
                  className="hidden"
                />

                <div className="mt-4 pt-3 border-t border-slate-800 flex items-center space-x-3 text-xs text-slate-500">
                  <span>Fast Batch Parsing</span>
                  <span>•</span>
                  <span>Auto Column Matching</span>
                  <span>•</span>
                  <span>Auto Barcode & GST Formatting</span>
                </div>
              </div>

              {/* Sample Template & Starter Presets Section */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-4 bg-slate-950 border border-slate-800 rounded-xl">
                <div>
                  <h5 className="text-xs font-bold text-slate-200">Need a blank template?</h5>
                  <p className="text-[11px] text-slate-400">Download the recommended spreadsheet layout.</p>
                </div>
                <button
                  onClick={handleDownloadSampleCsv}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 border border-slate-700 transition cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-blue-400" />
                  <span>Download Sample CSV</span>
                </button>
              </div>

              {/* 1-Click Starter Presets */}
              <div className="space-y-3">
                <div className="flex items-center space-x-2 text-xs font-bold text-slate-300 uppercase tracking-wider">
                  <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Or Load a Ready-to-Bill Starter Catalog (1-Click)</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {STARTER_PRESETS.map((preset) => {
                    const Icon = preset.icon;
                    return (
                      <div
                        key={preset.id}
                        onClick={() => handleLoadPreset(preset.id)}
                        className="p-4 bg-slate-950/80 hover:bg-slate-950 border border-slate-800 hover:border-emerald-500/50 rounded-xl cursor-pointer transition flex items-start space-x-3 group"
                      >
                        <div className="w-10 h-10 rounded-lg bg-slate-800 flex items-center justify-center text-emerald-400 group-hover:scale-105 transition shrink-0">
                          <Icon className="w-5 h-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <h5 className="text-xs font-bold text-white group-hover:text-emerald-300 transition truncate">
                              {preset.name}
                            </h5>
                            <span className="text-[10px] px-1.5 py-0.2 bg-emerald-500/10 text-emerald-400 rounded font-mono font-bold">
                              {preset.count} items
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400 mt-1 line-clamp-2">
                            {preset.description}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: MAP COLUMNS */}
          {activeStep === 'MAP' && (
            <div className="space-y-5">
              <div className="flex items-center justify-between bg-slate-950 p-3 rounded-xl border border-slate-800">
                <div className="flex items-center space-x-2 text-xs text-slate-300">
                  <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                  <span>File: <strong className="text-white font-mono">{fileName}</strong></span>
                  <span className="text-slate-500">({fileData.length} rows found)</span>
                </div>
                <button
                  onClick={() => setActiveStep('UPLOAD')}
                  className="text-xs text-slate-400 hover:text-white underline cursor-pointer"
                >
                  Change File
                </button>
              </div>

              <div className="space-y-2">
                <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                  Match Your Spreadsheet Columns to OmniBill Fields
                </h4>
                <p className="text-xs text-slate-400">
                  We automatically matched common headers. Review and adjust any dropdowns if needed.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-950 p-4 rounded-xl border border-slate-800">
                {/* Item Name (Required) */}
                <div>
                  <label className="block text-xs font-semibold text-emerald-300 mb-1">
                    Item / Product Name * (Required)
                  </label>
                  <select
                    value={mapping.name}
                    onChange={(e) => setMapping({ ...mapping, name: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                  >
                    <option value="">-- Select Column --</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </div>

                {/* Selling Price (Required) */}
                <div>
                  <label className="block text-xs font-semibold text-emerald-300 mb-1">
                    Selling Price / Rate (₹) *
                  </label>
                  <select
                    value={mapping.base_price}
                    onChange={(e) => setMapping({ ...mapping, base_price: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                  >
                    <option value="">-- Select Column --</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </div>

                {/* Barcode */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Barcode (EAN / UPC)
                  </label>
                  <select
                    value={mapping.barcode}
                    onChange={(e) => setMapping({ ...mapping, barcode: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                  >
                    <option value="">-- Auto-generate if missing --</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </div>

                {/* SKU Code */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Item Code / SKU
                  </label>
                  <select
                    value={mapping.sku}
                    onChange={(e) => setMapping({ ...mapping, sku: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                  >
                    <option value="">-- Auto-generate if missing --</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </div>

                {/* MRP */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    MRP (Maximum Retail Price)
                  </label>
                  <select
                    value={mapping.mrp}
                    onChange={(e) => setMapping({ ...mapping, mrp: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                  >
                    <option value="">-- Same as Selling Price --</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </div>

                {/* Purchase Cost */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Purchase Cost Price (₹)
                  </label>
                  <select
                    value={mapping.cost_price}
                    onChange={(e) => setMapping({ ...mapping, cost_price: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                  >
                    <option value="">-- Default (80% of price) --</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </div>

                {/* Opening Stock */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Opening Stock Quantity
                  </label>
                  <select
                    value={mapping.stock}
                    onChange={(e) => setMapping({ ...mapping, stock: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                  >
                    <option value="">-- Default (10 units) --</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </div>

                {/* GST Rate */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    GST Rate % (e.g. 0, 5, 12, 18, 28)
                  </label>
                  <select
                    value={mapping.tax_rate}
                    onChange={(e) => setMapping({ ...mapping, tax_rate: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                  >
                    <option value="">-- Default (0% GST) --</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex justify-between items-center pt-2">
                <button
                  onClick={() => setActiveStep('UPLOAD')}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  Back to File Select
                </button>
                <button
                  onClick={buildPreviewItems}
                  className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-emerald-600/30 flex items-center space-x-2 transition cursor-pointer"
                >
                  <span>Preview Parsed Items</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: PREVIEW & COMMIT */}
          {activeStep === 'PREVIEW' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center space-x-2">
                    <span>Ready to Import {previewItems.length} Products</span>
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  </h4>
                  <p className="text-xs text-slate-400">
                    Verify the calculated prices, stock, and tax rates before adding to your counter.
                  </p>
                </div>

                <button
                  onClick={() => setActiveStep('MAP')}
                  className="text-xs text-slate-400 hover:text-white underline cursor-pointer"
                >
                  Adjust Column Mapping
                </button>
              </div>

              {/* Preview Table */}
              <div className="overflow-x-auto border border-slate-800 rounded-xl max-h-80 overflow-y-auto">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="bg-slate-950 text-slate-400 sticky top-0 border-b border-slate-800">
                    <tr>
                      <th className="py-2.5 px-3 font-sans">#</th>
                      <th className="py-2.5 px-3 font-sans">Item Name</th>
                      <th className="py-2.5 px-3 font-sans">SKU / Code</th>
                      <th className="py-2.5 px-3 font-sans">Barcode</th>
                      <th className="py-2.5 px-3 text-right font-sans">Price (₹)</th>
                      <th className="py-2.5 px-3 text-right font-sans">Cost (₹)</th>
                      <th className="py-2.5 px-3 text-center font-sans">Stock</th>
                      <th className="py-2.5 px-3 text-center font-sans">GST</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 bg-slate-900/60">
                    {previewItems.map((item, idx) => (
                      <tr key={item.id} className="hover:bg-slate-800/40">
                        <td className="py-2 px-3 text-slate-500 font-sans">{idx + 1}</td>
                        <td className="py-2 px-3 text-slate-100 font-sans font-medium truncate max-w-[200px]">
                          {item.name}
                        </td>
                        <td className="py-2 px-3 text-slate-400">{item.sku}</td>
                        <td className="py-2 px-3 text-emerald-400/90">{item.barcode}</td>
                        <td className="py-2 px-3 text-right text-white font-bold">
                          {formatPaise(item.base_price_paise)}
                        </td>
                        <td className="py-2 px-3 text-right text-slate-400">
                          {formatPaise(item.cost_price_paise)}
                        </td>
                        <td className="py-2 px-3 text-center text-slate-200">
                          {item.stock_milli / 1000} {item.unit}
                        </td>
                        <td className="py-2 px-3 text-center text-blue-400">
                          {item.tax_rate_bps / 100}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-between pt-3 border-t border-slate-800">
                <button
                  onClick={() => setActiveStep('UPLOAD')}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  Start Over
                </button>

                <button
                  onClick={handleCommitImport}
                  className="px-8 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl text-xs font-bold shadow-xl shadow-emerald-600/30 flex items-center space-x-2 transition transform hover:scale-[1.02] cursor-pointer"
                >
                  <Database className="w-4 h-4" />
                  <span>Import {previewItems.length} Products to Counter</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
