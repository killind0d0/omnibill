import React, { useState, useEffect, useMemo } from 'react';
import {
  Package,
  Plus,
  Search,
  Filter,
  Layers,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  Tag,
  ArrowUpDown,
  Barcode,
  Sparkles,
  ChevronRight,
  ChevronDown,
  X,
  Boxes,
  Clock,
  Coins,
  FileSpreadsheet,
} from 'lucide-react';
import { ResourceItem, ResourceLot } from '../types/accounting';
import { ErpStorageService } from '../lib/erpStorage';
import { formatPaise, formatMilliQty } from '../lib/tax';
import { GST_RATES_BPS } from '../lib/constants';
import { Modal } from '../components/common/Modal';
import { CatalogImporterModal } from '../components/importer/CatalogImporterModal';

export const ItemMaster: React.FC = () => {
  const [items, setItems] = useState<ResourceItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isImporterOpen, setIsImporterOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [selectedTaxRate, setSelectedTaxRate] = useState<string>('ALL');
  const [stockFilter, setStockFilter] = useState<'ALL' | 'LOW' | 'IN_STOCK' | 'NEAR_EXPIRY'>('ALL');
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);

  // Sorting
  const [sortField, setSortField] = useState<'name' | 'sku' | 'base_price' | 'stock'>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  // Modals
  const [isAddItemOpen, setIsAddItemOpen] = useState(false);
  const [isAddLotOpen, setIsAddLotOpen] = useState(false);
  const [targetItemForLot, setTargetItemForLot] = useState<ResourceItem | null>(null);

  // Form states - Add Item
  const [itemForm, setItemForm] = useState({
    sku: '',
    name: '',
    hsn_sac: '',
    tax_rate_bps: 1800,
    base_price_inr: '',
    cost_price_inr: '',
    unit: 'PCS',
    category: 'General',
    reorder_level: '10',
    initial_stock: '',
    batch_number: '',
    expiry_date: '',
    mrp_inr: '',
  });

  // Form states - Add Lot
  const [lotForm, setLotForm] = useState({
    resource_id: '',
    batch_number: '',
    expiry_date: '',
    mrp_inr: '',
    cost_price_inr: '',
    quantity: '',
  });

  // Load items from storage
  const loadData = () => {
    const loaded = ErpStorageService.getItems();
    setItems(loaded);
  };

  useEffect(() => {
    loadData();
  }, []);

  // Keyboard shortcut listener: Alt+N for New Item, Alt+L for New Lot
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault();
        setIsAddItemOpen(true);
      } else if (e.altKey && (e.key === 'l' || e.key === 'L')) {
        e.preventDefault();
        if (items.length > 0) {
          setTargetItemForLot(items[0]);
          setLotForm((prev) => ({
            ...prev,
            resource_id: items[0].id,
            cost_price_inr: (items[0].cost_price_paise / 100).toString(),
          }));
          setIsAddLotOpen(true);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [items]);

  // Unique categories for filter dropdown
  const categories = useMemo(() => {
    const cats = new Set<string>();
    items.forEach((i) => {
      if (i.category) cats.add(i.category);
    });
    return Array.from(cats);
  }, [items]);

  // Helper for expiry check
  const isLotNearExpiry = (expiryDate: string): boolean => {
    if (!expiryDate) return false;
    const exp = new Date(expiryDate).getTime();
    const now = new Date().getTime();
    const diffDays = (exp - now) / (1000 * 60 * 60 * 24);
    return diffDays <= 30; // within 30 days or expired
  };

  // Filter and sort items
  const filteredItems = useMemo(() => {
    let result = [...items];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          i.sku.toLowerCase().includes(q) ||
          i.hsn_sac.includes(q) ||
          i.category.toLowerCase().includes(q) ||
          i.lots.some((lot) => lot.batch_number.toLowerCase().includes(q))
      );
    }

    if (selectedCategory !== 'ALL') {
      result = result.filter((i) => i.category === selectedCategory);
    }

    if (selectedTaxRate !== 'ALL') {
      const bps = Number(selectedTaxRate);
      result = result.filter((i) => i.tax_rate_bps === bps);
    }

    if (stockFilter === 'LOW') {
      result = result.filter((i) => {
        const total = i.lots.reduce((acc, l) => acc + l.current_stock_milli, 0);
        return total <= i.reorder_level_milli;
      });
    } else if (stockFilter === 'IN_STOCK') {
      result = result.filter((i) => {
        const total = i.lots.reduce((acc, l) => acc + l.current_stock_milli, 0);
        return total > 0;
      });
    } else if (stockFilter === 'NEAR_EXPIRY') {
      result = result.filter((i) => i.lots.some((l) => isLotNearExpiry(l.expiry_date)));
    }

    result.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'name') cmp = a.name.localeCompare(b.name);
      else if (sortField === 'sku') cmp = a.sku.localeCompare(b.sku);
      else if (sortField === 'base_price') cmp = a.base_price_paise - b.base_price_paise;
      else if (sortField === 'stock') {
        const stockA = a.lots.reduce((acc, l) => acc + l.current_stock_milli, 0);
        const stockB = b.lots.reduce((acc, l) => acc + l.current_stock_milli, 0);
        cmp = stockA - stockB;
      }
      return sortOrder === 'asc' ? cmp : -cmp;
    });

    return result;
  }, [items, searchQuery, selectedCategory, selectedTaxRate, stockFilter, sortField, sortOrder]);

  const toggleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  // Add Item Submit
  const handleAddItemSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!itemForm.sku.trim() || !itemForm.name.trim() || !itemForm.hsn_sac.trim()) {
      alert('Please fill in SKU, Item Name, and HSN/SAC code.');
      return;
    }

    const basePricePaise = Math.round(parseFloat(itemForm.base_price_inr || '0') * 100);
    const costPricePaise = Math.round(parseFloat(itemForm.cost_price_inr || '0') * 100);
    const initialQty = parseFloat(itemForm.initial_stock || '0');
    const mrpPaise = itemForm.mrp_inr ? Math.round(parseFloat(itemForm.mrp_inr) * 100) : Math.round(basePricePaise * 1.15);

    ErpStorageService.addItem({
      sku: itemForm.sku,
      name: itemForm.name,
      hsn_sac: itemForm.hsn_sac,
      tax_rate_bps: Number(itemForm.tax_rate_bps),
      base_price_paise: basePricePaise,
      cost_price_paise: costPricePaise,
      unit: itemForm.unit,
      category: itemForm.category,
      is_stock_tracked: true,
      reorder_level_milli: Math.round(parseFloat(itemForm.reorder_level || '10') * 1000),
      initial_stock_milli: initialQty > 0 ? Math.round(initialQty * 1000) : 0,
      batch_number: itemForm.batch_number || `BATCH-${new Date().getFullYear()}-01`,
      expiry_date: itemForm.expiry_date || '2028-12-31',
      mrp_paise: mrpPaise,
    });

    loadData();
    setIsAddItemOpen(false);
    setItemForm({
      sku: '',
      name: '',
      hsn_sac: '',
      tax_rate_bps: 1800,
      base_price_inr: '',
      cost_price_inr: '',
      unit: 'PCS',
      category: 'General',
      reorder_level: '10',
      initial_stock: '',
      batch_number: '',
      expiry_date: '',
      mrp_inr: '',
    });
  };

  // Add Lot Submit
  const handleAddLotSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!lotForm.resource_id || !lotForm.batch_number.trim() || !lotForm.expiry_date) {
      alert('Please select an item and provide a batch number and expiry date.');
      return;
    }

    const mrpPaise = Math.round(parseFloat(lotForm.mrp_inr || '0') * 100);
    const costPaise = Math.round(parseFloat(lotForm.cost_price_inr || '0') * 100);
    const qtyMilli = Math.round(parseFloat(lotForm.quantity || '0') * 1000);

    ErpStorageService.addLot(lotForm.resource_id, {
      batch_number: lotForm.batch_number,
      expiry_date: lotForm.expiry_date,
      mrp_paise: mrpPaise,
      cost_price_paise: costPaise,
      quantity_milli: qtyMilli,
    });

    loadData();
    setIsAddLotOpen(false);
    setLotForm({
      resource_id: '',
      batch_number: '',
      expiry_date: '',
      mrp_inr: '',
      cost_price_inr: '',
      quantity: '',
    });
  };

  const openAddLotModalForItem = (item: ResourceItem) => {
    setTargetItemForLot(item);
    setLotForm({
      resource_id: item.id,
      batch_number: `B-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`,
      expiry_date: '2027-12-31',
      mrp_inr: (item.base_price_paise * 1.15 / 100).toFixed(2),
      cost_price_inr: (item.cost_price_paise / 100).toFixed(2),
      quantity: '25',
    });
    setIsAddLotOpen(true);
  };

  // High-level KPI Counts
  const totalItemCount = items.length;
  const totalLotsCount = items.reduce((acc, i) => acc + i.lots.length, 0);
  const lowStockCount = items.filter((i) => {
    const total = i.lots.reduce((acc, l) => acc + l.current_stock_milli, 0);
    return total <= i.reorder_level_milli;
  }).length;
  const nearExpiryCount = items.reduce(
    (acc, i) => acc + i.lots.filter((l) => isLotNearExpiry(l.expiry_date)).length,
    0
  );

  return (
    <div className="flex-1 flex flex-col bg-slate-950 text-slate-100 overflow-hidden">
      {/* Top Banner & Action Bar */}
      <div className="border-b border-slate-800 bg-slate-900/60 px-6 py-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2.5">
              <div className="p-2 rounded-xl bg-blue-600/20 text-blue-400 border border-blue-500/30">
                <Package className="w-5 h-5" />
              </div>
              <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
                Item & Resource Master
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono font-medium border border-slate-700">
                  {totalItemCount} Resources
                </span>
              </h2>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Catalog inventory items, HSN/SAC classification, GST slabs, and multi-batch tracking.
            </p>
          </div>

          <div className="flex items-center space-x-3">
            {/* Bulk Import Excel / CSV Button */}
            <button
              onClick={() => setIsImporterOpen(true)}
              className="flex items-center space-x-2 px-3.5 py-2 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 text-xs font-semibold border border-emerald-500/40 transition-colors shadow-sm cursor-pointer"
              title="Import Inventory from Excel or CSV"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
              <span>Import Excel / CSV</span>
            </button>

            {/* Quick Add Lot Button */}
            <button
              onClick={() => {
                if (items.length > 0) {
                  openAddLotModalForItem(items[0]);
                }
              }}
              className="flex items-center space-x-2 px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700/80 text-slate-200 text-xs font-semibold border border-slate-700 transition-colors shadow-sm"
              title="Add Batch / Lot to Item (Alt+L)"
            >
              <Layers className="w-4 h-4 text-emerald-400" />
              <span>Add Lot / Batch</span>
              <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] bg-slate-900 border border-slate-700 text-slate-400 rounded">
                Alt+L
              </kbd>
            </button>

            {/* Add New Item Button */}
            <button
              onClick={() => setIsAddItemOpen(true)}
              className="flex items-center space-x-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-lg shadow-blue-600/20 transition-all cursor-pointer"
              title="Create New Master Item (Alt+N)"
            >
              <Plus className="w-4 h-4" />
              <span>New Item</span>
              <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] bg-blue-700/80 text-blue-100 rounded">
                Alt+N
              </kbd>
            </button>
          </div>
        </div>

        {/* Quick KPI Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
          <div className="bg-slate-900/90 border border-slate-800 p-2.5 rounded-xl flex items-center justify-between">
            <div>
              <span className="text-[11px] text-slate-400">Total Items</span>
              <div className="text-lg font-bold text-slate-100 font-mono">{totalItemCount}</div>
            </div>
            <Boxes className="w-5 h-5 text-blue-400" />
          </div>

          <div className="bg-slate-900/90 border border-slate-800 p-2.5 rounded-xl flex items-center justify-between">
            <div>
              <span className="text-[11px] text-slate-400">Active Batches</span>
              <div className="text-lg font-bold text-slate-100 font-mono">{totalLotsCount}</div>
            </div>
            <Layers className="w-5 h-5 text-indigo-400" />
          </div>

          <div
            onClick={() => setStockFilter(stockFilter === 'LOW' ? 'ALL' : 'LOW')}
            className={`p-2.5 rounded-xl border flex items-center justify-between cursor-pointer transition-colors ${
              lowStockCount > 0
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/20'
                : 'bg-slate-900/90 border-slate-800 text-slate-300'
            }`}
          >
            <div>
              <span className="text-[11px]">Low Stock Items</span>
              <div className="text-lg font-bold font-mono">{lowStockCount}</div>
            </div>
            <AlertTriangle className="w-5 h-5 text-amber-400" />
          </div>

          <div
            onClick={() => setStockFilter(stockFilter === 'NEAR_EXPIRY' ? 'ALL' : 'NEAR_EXPIRY')}
            className={`p-2.5 rounded-xl border flex items-center justify-between cursor-pointer transition-colors ${
              nearExpiryCount > 0
                ? 'bg-rose-500/10 border-rose-500/30 text-rose-300 hover:bg-rose-500/20'
                : 'bg-slate-900/90 border-slate-800 text-slate-300'
            }`}
          >
            <div>
              <span className="text-[11px]">Near-Expiry Batches</span>
              <div className="text-lg font-bold font-mono">{nearExpiryCount}</div>
            </div>
            <Clock className="w-5 h-5 text-rose-400" />
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-slate-900/40 border-b border-slate-800 px-6 py-3 flex flex-wrap items-center justify-between gap-3 select-none">
        <div className="flex items-center space-x-3 flex-1 min-w-[280px] max-w-md">
          <div className="relative w-full">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
            <input
              type="text"
              placeholder="Search by SKU, Name, HSN, Batch... (Press / to focus)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700/80 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-mono"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center space-x-2 flex-wrap">
          {/* Category Dropdown */}
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="bg-slate-900 border border-slate-700/80 text-slate-300 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-blue-500"
          >
            <option value="ALL">All Categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          {/* Tax Rate Dropdown */}
          <select
            value={selectedTaxRate}
            onChange={(e) => setSelectedTaxRate(e.target.value)}
            className="bg-slate-900 border border-slate-700/80 text-slate-300 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-blue-500"
          >
            <option value="ALL">All Tax Rates</option>
            {GST_RATES_BPS.map((r) => (
              <option key={r.bps} value={r.bps}>
                {r.label}
              </option>
            ))}
          </select>

          {/* Stock Filter Pills */}
          <div className="flex items-center bg-slate-900 p-0.5 rounded-lg border border-slate-800 text-xs">
            <button
              onClick={() => setStockFilter('ALL')}
              className={`px-2.5 py-1 rounded-md transition-colors ${
                stockFilter === 'ALL' ? 'bg-blue-600 text-white font-medium' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setStockFilter('LOW')}
              className={`px-2.5 py-1 rounded-md transition-colors ${
                stockFilter === 'LOW' ? 'bg-amber-600 text-white font-medium' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Low Stock
            </button>
            <button
              onClick={() => setStockFilter('NEAR_EXPIRY')}
              className={`px-2.5 py-1 rounded-md transition-colors ${
                stockFilter === 'NEAR_EXPIRY' ? 'bg-rose-600 text-white font-medium' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Near Expiry
            </button>
          </div>
        </div>
      </div>

      {/* Main Items Table */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-900/60 shadow-xl">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-900/90 text-[11px] font-semibold text-slate-400 uppercase tracking-wider select-none">
                <th className="py-3 px-4 w-10"></th>
                <th
                  onClick={() => toggleSort('sku')}
                  className="py-3 px-4 cursor-pointer hover:text-slate-200"
                >
                  <div className="flex items-center space-x-1.5">
                    <span>SKU / Code</span>
                    <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
                <th
                  onClick={() => toggleSort('name')}
                  className="py-3 px-4 cursor-pointer hover:text-slate-200"
                >
                  <div className="flex items-center space-x-1.5">
                    <span>Item Name & Category</span>
                    <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
                <th className="py-3 px-4 text-center">HSN / SAC</th>
                <th className="py-3 px-4 text-center">GST Slab</th>
                <th
                  onClick={() => toggleSort('base_price')}
                  className="py-3 px-4 text-right cursor-pointer hover:text-slate-200"
                >
                  <div className="flex items-center justify-end space-x-1.5">
                    <span>Base Price (₹)</span>
                    <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
                <th className="py-3 px-4 text-right">Cost Price (₹)</th>
                <th
                  onClick={() => toggleSort('stock')}
                  className="py-3 px-4 text-center cursor-pointer hover:text-slate-200"
                >
                  <div className="flex items-center justify-center space-x-1.5">
                    <span>Total Stock</span>
                    <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
                <th className="py-3 px-4 text-center">Lots</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-800/80 text-xs">
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-slate-500">
                    <Package className="w-10 h-10 mx-auto mb-2 text-slate-600 opacity-60" />
                    <p className="font-medium text-slate-400">No resources matched your search criteria.</p>
                    <p className="text-xs text-slate-500 mt-1">Try resetting the filters or create a new item.</p>
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => {
                  const totalStockMilli = item.lots.reduce((acc, l) => acc + l.current_stock_milli, 0);
                  const isLow = totalStockMilli <= item.reorder_level_milli;
                  const isExpanded = expandedItemId === item.id;
                  const hasNearExpiry = item.lots.some((l) => isLotNearExpiry(l.expiry_date));

                  return (
                    <React.Fragment key={item.id}>
                      <tr
                        onClick={() => setExpandedItemId(isExpanded ? null : item.id)}
                        className={`hover:bg-slate-800/50 transition-colors cursor-pointer ${
                          isExpanded ? 'bg-slate-800/40' : ''
                        }`}
                      >
                        {/* Expand Toggle */}
                        <td className="py-3 px-4 text-slate-500">
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4 text-blue-400" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-slate-500" />
                          )}
                        </td>

                        {/* SKU */}
                        <td className="py-3 px-4 font-mono font-semibold text-slate-200">
                          <div className="flex items-center space-x-1.5">
                            <Barcode className="w-3.5 h-3.5 text-slate-500" />
                            <span>{item.sku}</span>
                          </div>
                        </td>

                        {/* Item Name */}
                        <td className="py-3 px-4">
                          <div className="font-medium text-slate-100">{item.name}</div>
                          <div className="flex items-center space-x-2 text-[11px] text-slate-400 mt-0.5">
                            <span className="px-1.5 py-0.2 bg-slate-800 rounded text-slate-300">
                              {item.category}
                            </span>
                            <span>•</span>
                            <span>Unit: {item.unit}</span>
                          </div>
                        </td>

                        {/* HSN */}
                        <td className="py-3 px-4 text-center font-mono text-slate-300">
                          {item.hsn_sac}
                        </td>

                        {/* Tax Rate */}
                        <td className="py-3 px-4 text-center">
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20 font-mono">
                            {(item.tax_rate_bps / 100).toFixed(0)}% GST
                          </span>
                        </td>

                        {/* Base Price */}
                        <td className="py-3 px-4 text-right font-mono font-bold text-slate-100">
                          {formatPaise(item.base_price_paise)}
                        </td>

                        {/* Cost Price */}
                        <td className="py-3 px-4 text-right font-mono text-slate-400">
                          {formatPaise(item.cost_price_paise)}
                        </td>

                        {/* Total Stock */}
                        <td className="py-3 px-4 text-center">
                          <div className="inline-flex items-center space-x-1.5">
                            <span
                              className={`font-mono font-semibold ${
                                isLow
                                  ? 'text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20'
                                  : 'text-emerald-400'
                              }`}
                            >
                              {formatMilliQty(totalStockMilli)} {item.unit}
                            </span>
                            {isLow && (
                              <span title={`Below reorder point of ${formatMilliQty(item.reorder_level_milli)} ${item.unit}`}>
                                <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Lots Badge */}
                        <td className="py-3 px-4 text-center">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[11px] font-semibold inline-flex items-center gap-1 ${
                              hasNearExpiry
                                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                : 'bg-slate-800 text-slate-300 border border-slate-700'
                            }`}
                          >
                            <Layers className="w-3 h-3" />
                            <span>{item.lots.length}</span>
                          </span>
                        </td>

                        {/* Actions */}
                        <td className="py-3 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => openAddLotModalForItem(item)}
                            className="px-2.5 py-1 text-[11px] font-semibold rounded-md bg-slate-800 hover:bg-slate-700 text-blue-400 hover:text-blue-300 border border-slate-700 transition-colors"
                            title="Add Lot / Batch"
                          >
                            + Lot
                          </button>
                        </td>
                      </tr>

                      {/* Expandable Lot & Batch Inventory Viewer */}
                      {isExpanded && (
                        <tr className="bg-slate-900/90 border-b border-slate-800">
                          <td colSpan={10} className="p-4 pl-12">
                            <div className="border border-slate-800 rounded-xl bg-slate-950 p-4 shadow-inner">
                              <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-800 text-xs">
                                <div className="flex items-center space-x-2 text-slate-300">
                                  <Layers className="w-4 h-4 text-blue-400" />
                                  <span className="font-bold text-slate-100">
                                    Lot & Batch Inventory Breakdown: {item.name}
                                  </span>
                                </div>
                                <button
                                  onClick={() => openAddLotModalForItem(item)}
                                  className="flex items-center space-x-1.5 px-2.5 py-1 rounded bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 text-xs font-semibold cursor-pointer"
                                >
                                  <Plus className="w-3.5 h-3.5" />
                                  <span>Add New Batch Lot</span>
                                </button>
                              </div>

                              {item.lots.length === 0 ? (
                                <div className="text-center py-6 text-slate-500 text-xs">
                                  No active batches recorded for this resource. Click "+ Add New Batch Lot" to create one.
                                </div>
                              ) : (
                                <div className="overflow-x-auto">
                                  <table className="w-full text-left text-xs">
                                    <thead>
                                      <tr className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-800 pb-2">
                                        <th className="py-2 px-3">Batch Number</th>
                                        <th className="py-2 px-3">Expiry Date</th>
                                        <th className="py-2 px-3 text-right">MRP (₹)</th>
                                        <th className="py-2 px-3 text-right">Cost Price (₹)</th>
                                        <th className="py-2 px-3 text-right">Batch Stock Balance</th>
                                        <th className="py-2 px-3 text-center">Batch Status</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-900 font-mono">
                                      {item.lots.map((lot) => {
                                        const nearExpiry = isLotNearExpiry(lot.expiry_date);
                                        const expDate = new Date(lot.expiry_date);
                                        const isExpired = expDate.getTime() < new Date().getTime();

                                        return (
                                          <tr key={lot.id} className="hover:bg-slate-900/60">
                                            <td className="py-2.5 px-3 font-semibold text-slate-200">
                                              {lot.batch_number}
                                            </td>
                                            <td className="py-2.5 px-3">
                                              <span
                                                className={`inline-flex items-center gap-1.5 ${
                                                  nearExpiry ? 'text-rose-400 font-bold' : 'text-slate-300'
                                                }`}
                                              >
                                                <Calendar className="w-3.5 h-3.5" />
                                                <span>{lot.expiry_date}</span>
                                              </span>
                                            </td>
                                            <td className="py-2.5 px-3 text-right text-slate-100 font-bold">
                                              {formatPaise(lot.mrp_paise)}
                                            </td>
                                            <td className="py-2.5 px-3 text-right text-slate-400">
                                              {formatPaise(lot.cost_price_paise)}
                                            </td>
                                            <td className="py-2.5 px-3 text-right text-emerald-400 font-bold">
                                              {formatMilliQty(lot.current_stock_milli)} {item.unit}
                                            </td>
                                            <td className="py-2.5 px-3 text-center">
                                              {isExpired ? (
                                                <span className="px-2 py-0.5 rounded text-[10px] bg-rose-500/20 text-rose-300 border border-rose-500/30 font-semibold">
                                                  EXPIRED
                                                </span>
                                              ) : nearExpiry ? (
                                                <span className="px-2 py-0.5 rounded text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30 font-semibold">
                                                  EXPIRING SOON
                                                </span>
                                              ) : (
                                                <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-semibold">
                                                  HEALTHY
                                                </span>
                                              )}
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL: ADD NEW ITEM */}
      <Modal
        isOpen={isAddItemOpen}
        onClose={() => setIsAddItemOpen(false)}
        title="Add New Catalog Resource Item"
        icon={<Package className="w-5 h-5 text-blue-400" />}
        width="max-w-2xl"
      >
        <form onSubmit={handleAddItemSubmit} className="space-y-4 text-xs select-none">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* SKU / Code */}
            <div>
              <label className="block text-slate-400 font-medium mb-1">
                Resource Code / SKU <span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="e.g. MED-PARACET-500"
                value={itemForm.sku}
                onChange={(e) => setItemForm({ ...itemForm, sku: e.target.value.toUpperCase() })}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-blue-500"
              />
            </div>

            {/* HSN / SAC */}
            <div>
              <label className="block text-slate-400 font-medium mb-1">
                HSN / SAC Code <span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="e.g. 3004 or 8504"
                value={itemForm.hsn_sac}
                onChange={(e) => setItemForm({ ...itemForm, hsn_sac: e.target.value })}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-blue-500"
              />
            </div>

            {/* Name */}
            <div className="md:col-span-2">
              <label className="block text-slate-400 font-medium mb-1">
                Item Full Name / Description <span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Paracetamol 500mg Tablets (Strip of 10)"
                value={itemForm.name}
                onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-blue-500"
              />
            </div>

            {/* Tax Rate */}
            <div>
              <label className="block text-slate-400 font-medium mb-1">
                GST Tax Rate Slab <span className="text-rose-400">*</span>
              </label>
              <select
                value={itemForm.tax_rate_bps}
                onChange={(e) => setItemForm({ ...itemForm, tax_rate_bps: Number(e.target.value) })}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-blue-500"
              >
                {GST_RATES_BPS.map((r) => (
                  <option key={r.bps} value={r.bps}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Unit */}
            <div>
              <label className="block text-slate-400 font-medium mb-1">Unit of Measure</label>
              <input
                type="text"
                placeholder="PCS, BOX, STRIP, KG, TIN"
                value={itemForm.unit}
                onChange={(e) => setItemForm({ ...itemForm, unit: e.target.value.toUpperCase() })}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-blue-500"
              />
            </div>

            {/* Base Price (INR) */}
            <div>
              <label className="block text-slate-400 font-medium mb-1">
                Base Selling Price (₹) <span className="text-rose-400">*</span>
              </label>
              <input
                type="number"
                step="0.01"
                required
                placeholder="0.00"
                value={itemForm.base_price_inr}
                onChange={(e) => setItemForm({ ...itemForm, base_price_inr: e.target.value })}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-blue-500"
              />
            </div>

            {/* Cost Price (INR) */}
            <div>
              <label className="block text-slate-400 font-medium mb-1">Cost / Purchase Price (₹)</label>
              <input
                type="number"
                step="0.01"
                placeholder="0.00"
                value={itemForm.cost_price_inr}
                onChange={(e) => setItemForm({ ...itemForm, cost_price_inr: e.target.value })}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-blue-500"
              />
            </div>

            {/* Category */}
            <div>
              <label className="block text-slate-400 font-medium mb-1">Department / Category</label>
              <input
                type="text"
                placeholder="e.g. Pharmaceuticals, Grocery, Electronics"
                value={itemForm.category}
                onChange={(e) => setItemForm({ ...itemForm, category: e.target.value })}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-blue-500"
              />
            </div>

            {/* Reorder Threshold */}
            <div>
              <label className="block text-slate-400 font-medium mb-1">Reorder Alert Threshold</label>
              <input
                type="number"
                placeholder="10"
                value={itemForm.reorder_level}
                onChange={(e) => setItemForm({ ...itemForm, reorder_level: e.target.value })}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {/* Initial Opening Lot (Optional) */}
          <div className="pt-3 border-t border-slate-800">
            <h4 className="text-xs font-semibold text-slate-300 flex items-center gap-1.5 mb-2.5">
              <Layers className="w-3.5 h-3.5 text-blue-400" />
              <span>Initial Opening Batch (Optional)</span>
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 bg-slate-950/60 p-3 rounded-lg border border-slate-800/80">
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Batch Number</label>
                <input
                  type="text"
                  placeholder="BATCH-01"
                  value={itemForm.batch_number}
                  onChange={(e) => setItemForm({ ...itemForm, batch_number: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100 font-mono text-xs focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Expiry Date</label>
                <input
                  type="date"
                  value={itemForm.expiry_date}
                  onChange={(e) => setItemForm({ ...itemForm, expiry_date: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100 font-mono text-xs focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">MRP (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={itemForm.mrp_inr}
                  onChange={(e) => setItemForm({ ...itemForm, mrp_inr: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100 font-mono text-xs focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Opening Stock Qty</label>
                <input
                  type="number"
                  placeholder="0"
                  value={itemForm.initial_stock}
                  onChange={(e) => setItemForm({ ...itemForm, initial_stock: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100 font-mono text-xs focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
          </div>

          {/* Modal Actions */}
          <div className="flex items-center justify-end space-x-3 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={() => setIsAddItemOpen(false)}
              className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold shadow-lg shadow-blue-600/30 transition-all cursor-pointer"
            >
              Save Item Master
            </button>
          </div>
        </form>
      </Modal>

      {/* MODAL: ADD NEW LOT */}
      <Modal
        isOpen={isAddLotOpen}
        onClose={() => setIsAddLotOpen(false)}
        title={targetItemForLot ? `Add Inventory Lot: ${targetItemForLot.name}` : 'Add New Inventory Lot'}
        icon={<Layers className="w-5 h-5 text-emerald-400" />}
        width="max-w-md"
      >
        <form onSubmit={handleAddLotSubmit} className="space-y-4 text-xs select-none">
          {/* Target Item Selector */}
          <div>
            <label className="block text-slate-400 font-medium mb-1">
              Resource Item <span className="text-rose-400">*</span>
            </label>
            <select
              value={lotForm.resource_id}
              onChange={(e) => {
                const it = items.find((i) => i.id === e.target.value);
                setLotForm({
                  ...lotForm,
                  resource_id: e.target.value,
                  cost_price_inr: it ? (it.cost_price_paise / 100).toString() : '',
                  mrp_inr: it ? ((it.base_price_paise * 1.15) / 100).toFixed(2) : '',
                });
                setTargetItemForLot(it || null);
              }}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-blue-500"
            >
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} ({i.sku})
                </option>
              ))}
            </select>
          </div>

          {/* Batch Number */}
          <div>
            <label className="block text-slate-400 font-medium mb-1">
              Batch / Lot Number <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              required
              placeholder="e.g. DL-24K09"
              value={lotForm.batch_number}
              onChange={(e) => setLotForm({ ...lotForm, batch_number: e.target.value.toUpperCase() })}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Expiry Date */}
          <div>
            <label className="block text-slate-400 font-medium mb-1">
              Expiry Date <span className="text-rose-400">*</span>
            </label>
            <input
              type="date"
              required
              value={lotForm.expiry_date}
              onChange={(e) => setLotForm({ ...lotForm, expiry_date: e.target.value })}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* MRP */}
            <div>
              <label className="block text-slate-400 font-medium mb-1">
                Maximum Retail Price (₹) <span className="text-rose-400">*</span>
              </label>
              <input
                type="number"
                step="0.01"
                required
                placeholder="0.00"
                value={lotForm.mrp_inr}
                onChange={(e) => setLotForm({ ...lotForm, mrp_inr: e.target.value })}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-blue-500"
              />
            </div>

            {/* Cost Price */}
            <div>
              <label className="block text-slate-400 font-medium mb-1">Lot Cost Price (₹)</label>
              <input
                type="number"
                step="0.01"
                placeholder="0.00"
                value={lotForm.cost_price_inr}
                onChange={(e) => setLotForm({ ...lotForm, cost_price_inr: e.target.value })}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {/* Lot Quantity */}
          <div>
            <label className="block text-slate-400 font-medium mb-1">
              Inward Stock Quantity ({targetItemForLot?.unit || 'Units'}) <span className="text-rose-400">*</span>
            </label>
            <input
              type="number"
              step="any"
              required
              placeholder="e.g. 50"
              value={lotForm.quantity}
              onChange={(e) => setLotForm({ ...lotForm, quantity: e.target.value })}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Modal Actions */}
          <div className="flex items-center justify-end space-x-3 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={() => setIsAddLotOpen(false)}
              className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold shadow-lg shadow-emerald-600/30 transition-all cursor-pointer"
            >
              Add Lot to Inventory
            </button>
          </div>
        </form>
      </Modal>

      {/* Excel / CSV Catalog Importer */}
      <CatalogImporterModal
        isOpen={isImporterOpen}
        onClose={() => setIsImporterOpen(false)}
        onImportSuccess={() => loadData()}
      />
    </div>
  );
};
