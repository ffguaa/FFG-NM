import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  FfgInventory,
  FfgInventoryBag,
  FlourType,
  ParsedQualityRow,
} from '../types';
import { supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import {
  parseInventoryBagsExcel,
  parseQualityReportExcel,
  normalizeBarcodeKey,
} from '../lib/excelParser';
import {
  PackageCheck,
  Upload,
  Plus,
  Save,
  Pencil,
  Trash2,
  Info,
  RefreshCw,
  FileSpreadsheet,
  FlaskConical,
  ClipboardList,
  Search,
  X,
  CheckCircle2,
  AlertTriangle,
  Scale,
  Boxes,
  Printer,
  Ban,
  Filter,
  Truck,
  Droplets,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Package,
  Copy,
  Database,
} from 'lucide-react';

interface InventoryModuleProps {
  inventories: FfgInventory[];
  inventoryBags: FfgInventoryBag[];
  onReload: () => Promise<void>;
}

const INVENTORY_PRODUCTS = [
  'Farinha de Penas',
  'Farinha de Vísceras',
  'Óleo de Aves',
  'Óleo Graxo',
] as const;

type StandardProductType = (typeof INVENTORY_PRODUCTS)[number];

const normalizeProductType = (raw?: string | null): StandardProductType => {
  const val = (raw || '').trim();
  if (val === 'Farinha de Penas' || val === 'Penas') return 'Farinha de Penas';
  if (val === 'Farinha de Vísceras' || val === 'Vísceras') return 'Farinha de Vísceras';
  if (val === 'Óleo de Aves') return 'Óleo de Aves';
  if (val === 'Óleo Graxo') return 'Óleo Graxo';
  const upper = val.toUpperCase();
  if (upper.includes('GRAXO')) return 'Óleo Graxo';
  if (upper.includes('ÓLEO') || upper.includes('OLEO')) return 'Óleo de Aves';
  if (upper.includes('PENA')) return 'Farinha de Penas';
  return 'Farinha de Vísceras';
};

const isOilProductType = (type?: string | null): boolean => {
  const normalized = normalizeProductType(type);
  return normalized === 'Óleo de Aves' || normalized === 'Óleo Graxo';
};

const getProductBadgeClasses = (type?: string | null): string => {
  const normalized = normalizeProductType(type);
  if (normalized === 'Farinha de Vísceras') {
    return 'bg-emerald-100 text-emerald-800 border-emerald-300';
  }
  if (normalized === 'Farinha de Penas') {
    return 'bg-sky-100 text-sky-800 border-sky-300';
  }
  if (normalized === 'Óleo de Aves') {
    return 'bg-amber-100 text-amber-800 border-amber-300';
  }
  return 'bg-orange-100 text-orange-800 border-orange-300';
};

const formatDateDDMMYYYY = (isoDate?: string | null): string => {
  if (!isoDate) return '—';
  const datePart = isoDate.split('T')[0];
  const parts = datePart.split('-');
  if (parts.length !== 3) return isoDate;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
};

const formatNumberBR = (val?: number | null, decimals = 2): string => {
  return Number(val || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
};

const normalizeBarcode = (code?: string | null): string => {
  return normalizeBarcodeKey(code);
};

const inferBagFlourType = (
  bag: FfgInventoryBag,
  inventoryMap: Map<string, FfgInventory>
): StandardProductType => {
  if (bag.inventory_id !== undefined && bag.inventory_id !== null) {
    const parent = inventoryMap.get(String(bag.inventory_id));
    if (parent?.flour_type) {
      return normalizeProductType(parent.flour_type);
    }
  }
  const desc = (bag.product_description || '').toUpperCase();
  const code = (bag.product_code || '').toUpperCase();
  if (desc.includes('GRAXO') || code.includes('GRAXO')) return 'Óleo Graxo';
  if (desc.includes('ÓLEO') || desc.includes('OLEO') || code.includes('OLEO')) {
    return 'Óleo de Aves';
  }
  if (desc.includes('PENA')) return 'Farinha de Penas';
  return 'Farinha de Vísceras';
};

const isOilBagEntry = (
  bag: FfgInventoryBag,
  inventoryMap: Map<string, FfgInventory>
): boolean => {
  return (
    isOilProductType(inferBagFlourType(bag, inventoryMap)) ||
    (bag.volume_liters !== null && bag.volume_liters !== undefined)
  );
};

const formatQualityNumber = (val?: number | null, suffix = ''): string => {
  if (val === undefined || val === null || isNaN(Number(val))) return '—';
  return `${Number(val).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}${suffix}`;
};

const hasBagNumericQuality = (bag?: FfgInventoryBag | null): boolean => {
  if (!bag) return false;
  const numericFields = [
    bag.quality_acidity,
    bag.quality_peroxide,
    bag.quality_moisture,
    bag.quality_ether_extract,
    bag.quality_crude_protein,
    bag.quality_mineral_matter,
    bag.quality_digestibility,
  ];
  return numericFields.some(
    (val) => val !== null && val !== undefined && String(val).trim() !== '' && !isNaN(Number(val))
  );
};

const renderClassificationBadge = (
  classification?: string | null,
  bag?: FfgInventoryBag | null
) => {
  const upper = (classification || '').trim().toUpperCase();
  if (upper === 'STANDARD') {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold font-mono bg-emerald-100 text-emerald-800 border border-emerald-300">
        STANDARD
      </span>
    );
  }
  if (upper === 'COMERCIAL') {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold font-mono bg-rose-100 text-rose-800 border border-rose-300">
        COMERCIAL
      </span>
    );
  }
  if (upper) {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold font-mono bg-amber-100 text-amber-800 border border-amber-300">
        {upper}
      </span>
    );
  }
  if (hasBagNumericQuality(bag)) {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold font-mono bg-blue-100 text-blue-800 border border-blue-200">
        Com Laudo
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-semibold font-mono bg-slate-100 text-slate-600 border border-slate-300">
      Sem Laudo
    </span>
  );
};

interface OilEntryDraft {
  rowId: string;
  production_date: string;
  lot_tank: string;
  weight_kg: string;
  volume_liters: string;
  barcode: string;
  quality_acidity: string;
  quality_moisture: string;
  quality_peroxide: string;
  quality_ether_extract: string;
  quality_classification: string;
}

const OIL_SCHEMA_SQL = `-- Execute no SQL Editor do Supabase para habilitar Inventário de Óleos (KG + Litros):
ALTER TABLE public.ffg_inventories
DROP CONSTRAINT IF EXISTS ffg_inventories_flour_type_check;

ALTER TABLE public.ffg_inventory_bags
ADD COLUMN IF NOT EXISTS volume_liters numeric(12,2);`;

const parseFlexibleDecimal = (val?: string | number | null): number => {
  if (val === undefined || val === null || val === '') return 0;
  if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
  const cleaned = String(val).trim().replace(/\s+/g, '');
  if (!cleaned) return 0;
  let normalized = cleaned;
  if (cleaned.includes(',') && cleaned.includes('.')) {
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (cleaned.includes(',')) {
    normalized = cleaned.replace(',', '.');
  }
  const num = parseFloat(normalized);
  return Number.isFinite(num) ? num : 0;
};

const createOilTankRow = (
  tankNumber: number,
  defaultDate?: string
): OilEntryDraft => ({
  rowId: `tank-${Date.now()}-${tankNumber}-${Math.random().toString(36).slice(2, 7)}`,
  production_date: defaultDate || new Date().toISOString().split('T')[0],
  lot_tank: `Tanque ${String(tankNumber).padStart(2, '0')}`,
  weight_kg: '',
  volume_liters: '',
  barcode: '',
  quality_acidity: '',
  quality_moisture: '',
  quality_peroxide: '',
  quality_ether_extract: '',
  quality_classification: '',
});

const createDefaultOilTankRows = (
  product: StandardProductType,
  defaultDate?: string
): OilEntryDraft[] => {
  const count = product === 'Óleo de Aves' ? 4 : 2;
  return Array.from({ length: count }, (_, idx) =>
    createOilTankRow(idx + 1, defaultDate)
  );
};

const emptyManualBag = (): Omit<FfgInventoryBag, 'id' | 'inventory_id'> => {
  const today = new Date().toISOString().split('T')[0];
  const nowTime = new Date().toTimeString().slice(0, 5);
  return {
    product_code: '',
    product_description: '',
    bag_code: '',
    production_date: today,
    posting_date: today,
    posting_time: nowTime,
    period: 'A',
    weight_kg: 0,
    barcode: '',
  };
};

export const InventoryModule: React.FC<InventoryModuleProps> = ({
  inventories,
  inventoryBags,
  onReload,
}) => {
  const { showToast, showSupabaseError } = useToast();

  // Sub-tabs
  const [subTab, setSubTab] = useState<'bags' | 'quality'>('bags');

  // Selected inventory & calendar popover workflow state
  const [selectedInventoryId, setSelectedInventoryId] = useState<string | null>(null);
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<string | null>(null);
  const [isCalendarPopoverOpen, setIsCalendarPopoverOpen] = useState<boolean>(false);
  const [isCreatingNewInventory, setIsCreatingNewInventory] = useState<boolean>(false);
  const [calendarMonth, setCalendarMonth] = useState<{ year: number; month: number }>(() => {
    if (inventories.length > 0 && inventories[0].inventory_date) {
      const parts = inventories[0].inventory_date.split('T')[0].split('-').map(Number);
      if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        return { year: parts[0], month: parts[1] - 1 };
      }
    }
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [hasAutoAlignedCalendarMonth, setHasAutoAlignedCalendarMonth] = useState<boolean>(
    () => inventories.length > 0
  );
  const [loadingCalendarDay, setLoadingCalendarDay] = useState<boolean>(false);
  const [fetchedDayInventories, setFetchedDayInventories] = useState<FfgInventory[] | null>(null);
  const [fetchedDayBags, setFetchedDayBags] = useState<FfgInventoryBag[] | null>(null);

  // Inventory Header Form State
  const [flourType, setFlourType] = useState<FlourType>('Farinha de Vísceras');
  const [inventoryDate, setInventoryDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [inventoryTime, setInventoryTime] = useState<string>(
    new Date().toTimeString().slice(0, 5)
  );
  const [participants, setParticipants] = useState<string>('');
  const [isEditingHeader, setIsEditingHeader] = useState<boolean>(false);

  // Draft bags when creating a brand new inventory before saving
  const [draftBags, setDraftBags] = useState<FfgInventoryBag[]>([]);

  // Manual Bag Form State
  const [showManualBagForm, setShowManualBagForm] = useState<boolean>(false);
  const [manualBag, setManualBag] = useState<Omit<FfgInventoryBag, 'id' | 'inventory_id'>>(
    emptyManualBag()
  );

  // Oil Dual-Control (KG + Liters) Multi-Tank Form State
  const [oilTankRows, setOilTankRows] = useState<OilEntryDraft[]>(() =>
    createDefaultOilTankRows('Óleo Graxo', new Date().toISOString().split('T')[0])
  );
  const [isAddingOilEntry, setIsAddingOilEntry] = useState<boolean>(false);
  const [oilSchemaNeedsSql, setOilSchemaNeedsSql] = useState<boolean>(false);

  // File refs, section refs & loading flags
  const excelInputRef = useRef<HTMLInputElement>(null);
  const qualityExcelInputRef = useRef<HTMLInputElement>(null);
  const dailyStockInputRef = useRef<HTMLInputElement>(null);
  const headerEditorRef = useRef<HTMLDivElement>(null);
  const bagsListSectionRef = useRef<HTMLDivElement>(null);
  const calendarPopoverRef = useRef<HTMLDivElement>(null);
  const [loadingExcel, setLoadingExcel] = useState<boolean>(false);
  const [loadingQualityExcel, setLoadingQualityExcel] = useState<boolean>(false);
  const [loadingDailyStock, setLoadingDailyStock] = useState<boolean>(false);
  const [isSavingInventory, setIsSavingInventory] = useState<boolean>(false);
  const [dailyStockSummary, setDailyStockSummary] = useState<{
    fileName: string;
    addedCount: number;
    skippedDuplicates: number;
    totalAddedKg: number;
    breakdown: string[];
  } | null>(null);
  const [qualityImportSummary, setQualityImportSummary] = useState<{
    fileName: string;
    totalRows: number;
    matchedCount: number;
    notFoundCount: number;
    unmatchedBarcodes: string[];
  } | null>(null);

  // Modals: Info (i), Edit Bag, Delete Bag, Delete Inventory
  const [infoModalBag, setInfoModalBag] = useState<FfgInventoryBag | null>(null);
  const [editingBag, setEditingBag] = useState<FfgInventoryBag | null>(null);
  const [editingBagIndex, setEditingBagIndex] = useState<number | null>(null);
  const [isSavingBagEdit, setIsSavingBagEdit] = useState<boolean>(false);

  const [bagPendingDelete, setBagPendingDelete] = useState<{
    bag: FfgInventoryBag;
    draftIndex?: number;
  } | null>(null);
  const [isDeletingBag, setIsDeletingBag] = useState<boolean>(false);

  const [inventoryPendingDelete, setInventoryPendingDelete] = useState<FfgInventory | null>(
    null
  );
  const [isDeletingInventory, setIsDeletingInventory] = useState<boolean>(false);
  const [togglingBlockBagKey, setTogglingBlockBagKey] = useState<string | null>(null);

  // Quality Tab Filters
  const [qualityClassFilter, setQualityClassFilter] = useState<string>('Todas');
  const [qualityFlourFilter, setQualityFlourFilter] = useState<string>('Todas');
  const [qualitySearch, setQualitySearch] = useState<string>('');

  // Lista de Bags Filters (Sub-tab 1)
  const [bagProductFilter, setBagProductFilter] = useState<string>('Todos');
  const [bagSearch, setBagSearch] = useState<string>('');
  const [bagClassFilter, setBagClassFilter] = useState<string>('Todos');
  const [bagBlockFilter, setBagBlockFilter] = useState<'Todos' | 'Ativos' | 'Bloqueados' | 'Expedidos'>('Todos');

  // PDF Export Options Modal State
  const [isExportModalOpen, setIsExportModalOpen] = useState<boolean>(false);
  const [draftExportMode, setDraftExportMode] = useState<'general' | 'byDate'>('byDate');
  const [draftExportDate, setDraftExportDate] = useState<string>('');
  const [committedExportMode, setCommittedExportMode] = useState<'general' | 'byDate'>('byDate');
  const [committedExportDate, setCommittedExportDate] = useState<string>('');

  // Map inventories grouped by inventory_date (YYYY-MM-DD) for fast Calendar lookup
  const inventoriesByDateMap = useMemo(() => {
    const groups = new Map<string, FfgInventory[]>();
    const sorted = [...inventories].sort((a, b) => {
      const da = (a.inventory_date || '').split('T')[0];
      const db = (b.inventory_date || '').split('T')[0];
      if (da !== db) return db.localeCompare(da);
      return (b.inventory_time || '').localeCompare(a.inventory_time || '');
    });
    sorted.forEach((inv) => {
      const dateKey = (inv.inventory_date || '').split('T')[0];
      if (!dateKey) return;
      const list = groups.get(dateKey) || [];
      list.push(inv);
      groups.set(dateKey, list);
    });
    return groups;
  }, [inventories]);

  // Align initial calendar month once when inventories load asynchronously from Supabase
  useEffect(() => {
    if (hasAutoAlignedCalendarMonth || inventories.length === 0) return;
    const currentMonthPrefix = `${calendarMonth.year}-${String(calendarMonth.month + 1).padStart(
      2,
      '0'
    )}`;
    const hasInCurrentMonth = inventories.some((inv) =>
      (inv.inventory_date || '').startsWith(currentMonthPrefix)
    );
    if (!hasInCurrentMonth && inventories[0]?.inventory_date) {
      const parts = inventories[0].inventory_date.split('T')[0].split('-').map(Number);
      if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        setCalendarMonth({ year: parts[0], month: parts[1] - 1 });
      }
    }
    setHasAutoAlignedCalendarMonth(true);
  }, [inventories, hasAutoAlignedCalendarMonth, calendarMonth]);

  // Clear cached day fetch when global props reload after edits/deletes/imports
  useEffect(() => {
    setFetchedDayInventories(null);
    setFetchedDayBags(null);
  }, [inventories, inventoryBags]);

  // Map inventories by id (combining global props and live-fetched day inventories)
  const inventoryMap = useMemo(() => {
    const map = new Map<string, FfgInventory>();
    inventories.forEach((inv) => {
      if (inv.id !== undefined) map.set(String(inv.id), inv);
    });
    (fetchedDayInventories || []).forEach((inv) => {
      if (inv.id !== undefined) map.set(String(inv.id), inv);
    });
    return map;
  }, [inventories, fetchedDayInventories]);

  // Keep selectedInventoryId valid when inventories list reloads (without auto-selecting another)
  useEffect(() => {
    if (selectedInventoryId !== null && !fetchedDayInventories) {
      const exists = inventories.some((inv) => String(inv.id) === selectedInventoryId);
      if (!exists) {
        setSelectedInventoryId(null);
      }
    }
  }, [inventories, selectedInventoryId, fetchedDayInventories]);

  const selectedInventory = useMemo(() => {
    if (!selectedInventoryId) return null;
    return inventoryMap.get(selectedInventoryId) || null;
  }, [selectedInventoryId, inventoryMap]);

  // Inventories for the currently clicked Calendar date (live Supabase result or synced props)
  const selectedDateInventories = useMemo(() => {
    if (!selectedCalendarDate) return [];
    if (fetchedDayInventories !== null) return fetchedDayInventories;
    return inventoriesByDateMap.get(selectedCalendarDate) || [];
  }, [selectedCalendarDate, fetchedDayInventories, inventoriesByDateMap]);

  // Close calendar popover on outside click or Escape key
  useEffect(() => {
    if (!isCalendarPopoverOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (
        calendarPopoverRef.current &&
        !calendarPopoverRef.current.contains(event.target as Node)
      ) {
        setIsCalendarPopoverOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsCalendarPopoverOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isCalendarPopoverOpen]);

  // Fetch inventories & bags directly from Supabase when clicking a day in the Calendar
  const handleSelectCalendarDate = async (dateKey: string) => {
    setIsCalendarPopoverOpen(false);
    setSelectedCalendarDate(dateKey);
    setSelectedInventoryId(null);
    setIsCreatingNewInventory(false);
    setIsEditingHeader(false);
    setShowManualBagForm(false);
    setLoadingCalendarDay(true);

    try {
      const { data: dayInvs, error: invErr } = await supabase
        .from('ffg_inventories')
        .select('*')
        .eq('inventory_date', dateKey)
        .order('inventory_time', { ascending: false });

      if (invErr) throw invErr;

      const loadedInvs = (dayInvs || []) as FfgInventory[];
      setFetchedDayInventories(loadedInvs);

      const invIds = loadedInvs
        .map((inv) => inv.id)
        .filter((id): id is string | number => id !== undefined && id !== null);

      if (invIds.length > 0) {
        const { data: dayBags, error: bagsErr } = await supabase
          .from('ffg_inventory_bags')
          .select('*')
          .in('inventory_id', invIds);

        if (bagsErr) throw bagsErr;
        setFetchedDayBags((dayBags || []) as FfgInventoryBag[]);
      } else {
        setFetchedDayBags([]);
      }

      if (loadedInvs.length === 1 && loadedInvs[0].id !== undefined) {
        setSelectedInventoryId(String(loadedInvs[0].id));
        setTimeout(() => {
          bagsListSectionRef.current?.scrollIntoView({
            behavior: 'smooth',
            block: 'start',
          });
        }, 80);
      }
    } catch (err: any) {
      showSupabaseError('Falha ao Carregar Inventários do Dia', err);
      setFetchedDayInventories(null);
      setFetchedDayBags(null);
    } finally {
      setLoadingCalendarDay(false);
    }
  };

  // Probe Supabase volume_liters column when an oil product is active
  useEffect(() => {
    if (!isOilProductType(flourType)) return;
    let active = true;
    const probeOilColumn = async () => {
      const { error } = await supabase
        .from('ffg_inventory_bags')
        .select('volume_liters')
        .limit(1);
      if (!active) return;
      if (
        error &&
        (error.code === '42703' ||
          error.code === 'PGRST204' ||
          String(error.message || '').includes('volume_liters'))
      ) {
        setOilSchemaNeedsSql(true);
      } else {
        setOilSchemaNeedsSql(false);
      }
    };
    probeOilColumn();
    return () => {
      active = false;
    };
  }, [flourType]);

  // Populate header form whenever selectedInventory changes
  useEffect(() => {
    if (selectedInventory) {
      const normalized = normalizeProductType(selectedInventory.flour_type);
      setFlourType(normalized);
      const invDateStr = selectedInventory.inventory_date.split('T')[0];
      setInventoryDate(invDateStr);
      setInventoryTime((selectedInventory.inventory_time || '00:00').slice(0, 5));
      setParticipants(selectedInventory.participants || '');
      setIsEditingHeader(false);
      if (isOilProductType(normalized)) {
        setOilTankRows(createDefaultOilTankRows(normalized, invDateStr));
      }
    }
  }, [selectedInventory]);

  // Active bags displayed in Sub-tab 1:
  // - Creating new inventory -> draftBags
  // - Specific inventory selected -> that inventory's bags
  // - Calendar date selected (multiple inventories on day) -> all bags for that day
  // - General view (default on open) -> all stock bags for immediate yard lookup
  const activeInventoryBags = useMemo(() => {
    if (isCreatingNewInventory) return draftBags;
    const sourceBags = fetchedDayBags !== null ? fetchedDayBags : inventoryBags;
    if (selectedInventoryId) {
      return sourceBags.filter(
        (b) => String(b.inventory_id) === String(selectedInventoryId)
      );
    }
    if (selectedCalendarDate) {
      const dayIds = new Set(
        selectedDateInventories
          .map((inv) => (inv.id !== undefined ? String(inv.id) : ''))
          .filter(Boolean)
      );
      return sourceBags.filter(
        (b) => b.inventory_id !== undefined && dayIds.has(String(b.inventory_id))
      );
    }
    return inventoryBags;
  }, [
    isCreatingNewInventory,
    draftBags,
    fetchedDayBags,
    inventoryBags,
    selectedInventoryId,
    selectedCalendarDate,
    selectedDateInventories,
  ]);

  // Filtered Lista de Bags (Product + Classification + Status Bloqueado/Expedido + Search by barcode/bag_code)
  const filteredActiveBags = useMemo(() => {
    const query = bagSearch.trim().toLowerCase();
    return activeInventoryBags.filter((bag) => {
      if (bagProductFilter !== 'Todos') {
        const inferredProduct = bag.inventory_id
          ? inferBagFlourType(bag, inventoryMap)
          : normalizeProductType(flourType);
        if (inferredProduct !== bagProductFilter) return false;
      }

      if (query) {
        const barcodeMatch = (bag.barcode || '').toLowerCase().includes(query);
        const bagCodeMatch = (bag.bag_code || '').toLowerCase().includes(query);
        if (!barcodeMatch && !bagCodeMatch) return false;
      }

      const cls = (bag.quality_classification || '').trim().toUpperCase();
      if (bagClassFilter === 'STANDARD' && cls !== 'STANDARD') return false;
      if (bagClassFilter === 'COMERCIAL' && cls !== 'COMERCIAL') return false;
      if (
        bagClassFilter === 'Com Laudo' &&
        !(cls === 'COM LAUDO' || (cls === '' && hasBagNumericQuality(bag)))
      ) {
        return false;
      }
      if (
        bagClassFilter === 'Sem Laudo' &&
        !(cls === '' && !hasBagNumericQuality(bag))
      ) {
        return false;
      }

      if (bagBlockFilter === 'Ativos' && (bag.is_blocked || bag.is_dispatched)) return false;
      if (bagBlockFilter === 'Bloqueados' && !bag.is_blocked) return false;
      if (bagBlockFilter === 'Expedidos' && !bag.is_dispatched) return false;

      return true;
    });
  }, [activeInventoryBags, bagProductFilter, bagSearch, bagClassFilter, bagBlockFilter, inventoryMap, flourType]);

  // Data alvo consolidada para o Resumo do Dia
  const activeSummaryDate = useMemo(() => {
    if (selectedInventory?.inventory_date) {
      return selectedInventory.inventory_date.split('T')[0];
    }
    return inventoryDate;
  }, [selectedInventory, inventoryDate]);

  // ROW 1 KPIs: Resumo do Dia (consolida todos os inventários com a mesma data)
  const daySummaryKpis = useMemo(() => {
    const sameDayInventories = inventories.filter(
      (inv) => inv.inventory_date && inv.inventory_date.split('T')[0] === activeSummaryDate
    );
    const sameDayIds = new Set(
      sameDayInventories
        .map((inv) => (inv.id !== undefined ? String(inv.id) : ''))
        .filter(Boolean)
    );

    const savedDayBags = inventoryBags.filter(
      (b) => b.inventory_id !== undefined && sameDayIds.has(String(b.inventory_id))
    );

    // Quando estiver criando um novo rascunho naquela data, soma também os itens do rascunho
    const dayBags = !selectedInventoryId ? [...savedDayBags, ...draftBags] : savedDayBags;

    const totalBags = dayBags.length;
    let viscerasBags = 0;
    let penasBags = 0;
    let oleoAvesCount = 0;
    let oleoGraxoCount = 0;

    let totalWeightKg = 0;
    let viscerasWeightKg = 0;
    let penasWeightKg = 0;
    let oleoAvesWeightKg = 0;
    let oleoAvesLiters = 0;
    let oleoGraxoWeightKg = 0;
    let oleoGraxoLiters = 0;

    const viscerasList: FfgInventoryBag[] = [];
    const penasList: FfgInventoryBag[] = [];
    const oleoAvesList: FfgInventoryBag[] = [];
    const oleoGraxoList: FfgInventoryBag[] = [];

    dayBags.forEach((bag) => {
      const weight = Number(bag.weight_kg || 0);
      const liters = Number(bag.volume_liters || 0);
      totalWeightKg += weight;

      let type: StandardProductType;
      if (bag.inventory_id !== undefined && bag.inventory_id !== null) {
        type = inferBagFlourType(bag, inventoryMap);
      } else {
        const descUpper = (bag.product_description || '').toUpperCase();
        if (descUpper.includes('GRAXO')) {
          type = 'Óleo Graxo';
        } else if (descUpper.includes('ÓLEO') || descUpper.includes('OLEO')) {
          type = 'Óleo de Aves';
        } else if (descUpper.includes('PENA')) {
          type = 'Farinha de Penas';
        } else if (descUpper.includes('VISC') || descUpper.includes('VÍSC')) {
          type = 'Farinha de Vísceras';
        } else {
          type = normalizeProductType(flourType);
        }
      }

      if (type === 'Farinha de Penas') {
        penasBags += 1;
        penasWeightKg += weight;
        penasList.push(bag);
      } else if (type === 'Óleo de Aves') {
        oleoAvesCount += 1;
        oleoAvesWeightKg += weight;
        oleoAvesLiters += liters;
        oleoAvesList.push(bag);
      } else if (type === 'Óleo Graxo') {
        oleoGraxoCount += 1;
        oleoGraxoWeightKg += weight;
        oleoGraxoLiters += liters;
        oleoGraxoList.push(bag);
      } else {
        viscerasBags += 1;
        viscerasWeightKg += weight;
        viscerasList.push(bag);
      }
    });

    const viscerasInventories = sameDayInventories.filter(
      (i) => normalizeProductType(i.flour_type) === 'Farinha de Vísceras'
    );
    const penasInventories = sameDayInventories.filter(
      (i) => normalizeProductType(i.flour_type) === 'Farinha de Penas'
    );
    const oleoAvesInventories = sameDayInventories.filter(
      (i) => normalizeProductType(i.flour_type) === 'Óleo de Aves'
    );
    const oleoGraxoInventories = sameDayInventories.filter(
      (i) => normalizeProductType(i.flour_type) === 'Óleo Graxo'
    );

    return {
      totalBags,
      viscerasBags,
      penasBags,
      oleoAvesCount,
      oleoGraxoCount,
      totalWeightKg,
      viscerasWeightKg,
      penasWeightKg,
      oleoAvesWeightKg,
      oleoAvesLiters,
      oleoGraxoWeightKg,
      oleoGraxoLiters,
      totalOilLiters: oleoAvesLiters + oleoGraxoLiters,
      viscerasList,
      penasList,
      oleoAvesList,
      oleoGraxoList,
      viscerasInventories,
      penasInventories,
      oleoAvesInventories,
      oleoGraxoInventories,
      dayInventoryCount: sameDayInventories.length,
    };
  }, [
    inventories,
    inventoryBags,
    activeSummaryDate,
    selectedInventoryId,
    draftBags,
    inventoryMap,
    flourType,
  ]);

  // Unique inventory dates sorted descending for PDF Export Modal
  const uniqueInventoryDates = useMemo(() => {
    const dateSet = new Set<string>();
    inventories.forEach((inv) => {
      if (inv.inventory_date) {
        dateSet.add(inv.inventory_date.split('T')[0]);
      }
    });
    return Array.from(dateSet).sort((a, b) => b.localeCompare(a));
  }, [inventories]);

  // Consolidated dataset used specifically for the hidden Landscape PDF Print Layout
  const printReportData = useMemo(() => {
    const targetDate = committedExportDate || activeSummaryDate;
    let sourceBags: FfgInventoryBag[] = [];

    if (committedExportMode === 'general') {
      sourceBags = inventoryBags.filter((b) => !b.is_dispatched);
    } else {
      const sameDayInvIds = new Set(
        inventories
          .filter((inv) => inv.inventory_date && inv.inventory_date.split('T')[0] === targetDate)
          .map((inv) => (inv.id !== undefined ? String(inv.id) : ''))
          .filter(Boolean)
      );
      sourceBags = inventoryBags.filter(
        (b) => b.inventory_id !== undefined && sameDayInvIds.has(String(b.inventory_id))
      );
    }

    const viscerasList: FfgInventoryBag[] = [];
    const penasList: FfgInventoryBag[] = [];
    const oleoAvesList: FfgInventoryBag[] = [];
    const oleoGraxoList: FfgInventoryBag[] = [];

    let viscerasWeightKg = 0;
    let penasWeightKg = 0;
    let oleoAvesWeightKg = 0;
    let oleoAvesLiters = 0;
    let oleoGraxoWeightKg = 0;
    let oleoGraxoLiters = 0;

    sourceBags.forEach((bag) => {
      const weight = Number(bag.weight_kg || 0);
      const liters = Number(bag.volume_liters || 0);
      const type = inferBagFlourType(bag, inventoryMap);
      if (type === 'Farinha de Penas') {
        penasList.push(bag);
        penasWeightKg += weight;
      } else if (type === 'Óleo de Aves') {
        oleoAvesList.push(bag);
        oleoAvesWeightKg += weight;
        oleoAvesLiters += liters;
      } else if (type === 'Óleo Graxo') {
        oleoGraxoList.push(bag);
        oleoGraxoWeightKg += weight;
        oleoGraxoLiters += liters;
      } else {
        viscerasList.push(bag);
        viscerasWeightKg += weight;
      }
    });

    const dateInventories = inventories.filter(
      (inv) => inv.inventory_date && inv.inventory_date.split('T')[0] === targetDate
    );

    return {
      mode: committedExportMode,
      targetDate,
      totalBags: sourceBags.length,
      totalWeightKg:
        viscerasWeightKg + penasWeightKg + oleoAvesWeightKg + oleoGraxoWeightKg,
      totalOilLiters: oleoAvesLiters + oleoGraxoLiters,
      viscerasList,
      penasList,
      oleoAvesList,
      oleoGraxoList,
      viscerasWeightKg,
      penasWeightKg,
      oleoAvesWeightKg,
      oleoAvesLiters,
      oleoGraxoWeightKg,
      oleoGraxoLiters,
      viscerasInventories:
        committedExportMode === 'byDate'
          ? dateInventories.filter(
              (i) => normalizeProductType(i.flour_type) === 'Farinha de Vísceras'
            )
          : [],
      penasInventories:
        committedExportMode === 'byDate'
          ? dateInventories.filter(
              (i) => normalizeProductType(i.flour_type) === 'Farinha de Penas'
            )
          : [],
      oleoAvesInventories:
        committedExportMode === 'byDate'
          ? dateInventories.filter(
              (i) => normalizeProductType(i.flour_type) === 'Óleo de Aves'
            )
          : [],
      oleoGraxoInventories:
        committedExportMode === 'byDate'
          ? dateInventories.filter(
              (i) => normalizeProductType(i.flour_type) === 'Óleo Graxo'
            )
          : [],
      dayInventoryCount: dateInventories.length,
    };
  }, [
    committedExportMode,
    committedExportDate,
    activeSummaryDate,
    inventories,
    inventoryBags,
    inventoryMap,
  ]);

  const handleOpenExportModal = () => {
    const defaultDate = uniqueInventoryDates.includes(activeSummaryDate)
      ? activeSummaryDate
      : uniqueInventoryDates[0] || activeSummaryDate;
    setDraftExportDate(defaultDate);
    setDraftExportMode(uniqueInventoryDates.length > 0 ? 'byDate' : 'general');
    setIsExportModalOpen(true);
  };

  const handleGeneratePdfReport = () => {
    if (draftExportMode === 'byDate' && !draftExportDate) {
      showToast('warning', 'Validação', 'Selecione uma data de inventário para gerar o relatório.');
      return;
    }
    setCommittedExportMode(draftExportMode);
    setCommittedExportDate(draftExportDate || activeSummaryDate);
    setIsExportModalOpen(false);
    setTimeout(() => window.print(), 500);
  };

  // Active stock bags (excluding dispatched bags)
  const activeStockBags = useMemo(() => {
    return inventoryBags.filter((b) => !b.is_dispatched);
  }, [inventoryBags]);

  // ROW 2 KPIs: Resumo Geral do Estoque (active bags across all inventories)
  const globalStockKpis = useMemo(() => {
    const totalBags = activeStockBags.length;
    const dispatchedBags = inventoryBags.length - activeStockBags.length;
    let viscerasBags = 0;
    let viscerasWeightKg = 0;
    let penasBags = 0;
    let penasWeightKg = 0;
    let oleoAvesCount = 0;
    let oleoAvesWeightKg = 0;
    let oleoAvesLiters = 0;
    let oleoGraxoCount = 0;
    let oleoGraxoWeightKg = 0;
    let oleoGraxoLiters = 0;
    let totalWeightKg = 0;

    activeStockBags.forEach((bag) => {
      const weight = Number(bag.weight_kg || 0);
      const liters = Number(bag.volume_liters || 0);
      totalWeightKg += weight;
      const type = inferBagFlourType(bag, inventoryMap);
      if (type === 'Farinha de Penas') {
        penasBags += 1;
        penasWeightKg += weight;
      } else if (type === 'Óleo de Aves') {
        oleoAvesCount += 1;
        oleoAvesWeightKg += weight;
        oleoAvesLiters += liters;
      } else if (type === 'Óleo Graxo') {
        oleoGraxoCount += 1;
        oleoGraxoWeightKg += weight;
        oleoGraxoLiters += liters;
      } else {
        viscerasBags += 1;
        viscerasWeightKg += weight;
      }
    });

    return {
      totalBags,
      dispatchedBags,
      viscerasBags,
      viscerasWeightKg,
      penasBags,
      penasWeightKg,
      oleoAvesCount,
      oleoAvesWeightKg,
      oleoAvesLiters,
      oleoGraxoCount,
      oleoGraxoWeightKg,
      oleoGraxoLiters,
      totalWeightKg,
      totalOilLiters: oleoAvesLiters + oleoGraxoLiters,
    };
  }, [activeStockBags, inventoryBags.length, inventoryMap]);

  // Quality Tab KPIs & Filtered List (active stock)
  const qualityMetrics = useMemo(() => {
    const total = activeStockBags.length;
    let standardCount = 0;
    let comercialCount = 0;
    let pendingCount = 0;

    let sumProtein = 0;
    let countProtein = 0;
    let sumAcidity = 0;
    let countAcidity = 0;
    let sumMoisture = 0;
    let countMoisture = 0;
    let sumDigestibility = 0;
    let countDigestibility = 0;

    activeStockBags.forEach((b) => {
      const cls = (b.quality_classification || '').trim().toUpperCase();
      if (cls === 'STANDARD') standardCount += 1;
      else if (cls === 'COMERCIAL') comercialCount += 1;
      else if (!hasBagNumericQuality(b)) pendingCount += 1;

      if (b.quality_crude_protein !== null && b.quality_crude_protein !== undefined) {
        sumProtein += Number(b.quality_crude_protein);
        countProtein += 1;
      }
      if (b.quality_acidity !== null && b.quality_acidity !== undefined) {
        sumAcidity += Number(b.quality_acidity);
        countAcidity += 1;
      }
      if (b.quality_moisture !== null && b.quality_moisture !== undefined) {
        sumMoisture += Number(b.quality_moisture);
        countMoisture += 1;
      }
      if (b.quality_digestibility !== null && b.quality_digestibility !== undefined) {
        sumDigestibility += Number(b.quality_digestibility);
        countDigestibility += 1;
      }
    });

    return {
      total,
      standardCount,
      comercialCount,
      pendingCount,
      standardPct: total > 0 ? (standardCount / total) * 100 : 0,
      comercialPct: total > 0 ? (comercialCount / total) * 100 : 0,
      pendingPct: total > 0 ? (pendingCount / total) * 100 : 0,
      avgProtein: countProtein > 0 ? sumProtein / countProtein : 0,
      avgAcidity: countAcidity > 0 ? sumAcidity / countAcidity : 0,
      avgMoisture: countMoisture > 0 ? sumMoisture / countMoisture : 0,
      avgDigestibility: countDigestibility > 0 ? sumDigestibility / countDigestibility : 0,
      analyzedChemCount: Math.max(countProtein, countAcidity, countMoisture, countDigestibility),
    };
  }, [activeStockBags]);

  const filteredQualityBags = useMemo(() => {
    const query = qualitySearch.trim().toLowerCase();
    return activeStockBags.filter((bag) => {
      const cls = (bag.quality_classification || '').trim().toUpperCase();
      if (qualityClassFilter === 'STANDARD' && cls !== 'STANDARD') return false;
      if (qualityClassFilter === 'COMERCIAL' && cls !== 'COMERCIAL') return false;
      if (qualityClassFilter === 'Com Laudo' && (cls !== '' || !hasBagNumericQuality(bag))) return false;
      if (qualityClassFilter === 'Sem Laudo' && (cls !== '' || hasBagNumericQuality(bag))) return false;

      if (qualityFlourFilter !== 'Todas') {
        const type = inferBagFlourType(bag, inventoryMap);
        if (type !== qualityFlourFilter) return false;
      }

      if (query) {
        const haystack = `${bag.barcode} ${bag.bag_code} ${bag.product_description} ${bag.product_code}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }

      return true;
    });
  }, [activeStockBags, qualityClassFilter, qualityFlourFilter, qualitySearch, inventoryMap]);

  // Switch to "Novo Inventário" mode
  const handleStartNewInventory = (prefillDate?: string) => {
    const targetDate = prefillDate || selectedCalendarDate || new Date().toISOString().split('T')[0];
    setSelectedInventoryId(null);
    setIsCreatingNewInventory(true);
    setFlourType('Farinha de Vísceras');
    setInventoryDate(targetDate);
    setInventoryTime(new Date().toTimeString().slice(0, 5));
    setParticipants('');
    setDraftBags([]);
    setOilTankRows(createDefaultOilTankRows('Óleo Graxo', targetDate));
    setIsEditingHeader(true);
    setQualityImportSummary(null);
    setTimeout(() => {
      headerEditorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
  };

  // Start editing an existing inventory
  const handleSelectAndEditInventory = (inv: FfgInventory) => {
    const invDateStr = inv.inventory_date.split('T')[0];
    const normalized = normalizeProductType(inv.flour_type);
    setSelectedCalendarDate(invDateStr);
    setIsCreatingNewInventory(false);
    setSelectedInventoryId(String(inv.id));
    setFlourType(normalized);
    setInventoryDate(invDateStr);
    setInventoryTime((inv.inventory_time || '00:00').slice(0, 5));
    setParticipants(inv.participants || '');
    if (isOilProductType(normalized)) {
      setOilTankRows(createDefaultOilTankRows(normalized, invDateStr));
    }
    setIsEditingHeader(true);
    setQualityImportSummary(null);
    setTimeout(() => {
      headerEditorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
  };

  const parseOptionalOilNum = (val: string): number | null => {
    const cleaned = String(val || '').trim();
    if (!cleaned) return null;
    let normalized = cleaned.replace(/\s+/g, '');
    if (normalized.includes(',') && normalized.includes('.')) {
      normalized = normalized.replace(/\./g, '').replace(',', '.');
    } else if (normalized.includes(',')) {
      normalized = normalized.replace(',', '.');
    }
    const parsed = parseFloat(normalized);
    return isNaN(parsed) ? null : Math.round(parsed * 10000) / 10000;
  };

  const buildOilBagRecord = (
    entry: OilEntryDraft,
    product: StandardProductType,
    postingTimeStr: string,
    rowIndex = 0
  ): FfgInventoryBag => {
    const weightKg = Math.round(parseFlexibleDecimal(entry.weight_kg) * 100) / 100;
    const volumeLiters = Math.round(parseFlexibleDecimal(entry.volume_liters) * 100) / 100;
    const cleanLot = entry.lot_tank.trim();
    const prefix = product === 'Óleo de Aves' ? 'OLAV' : 'OLGX';
    const sanitizedLot =
      cleanLot.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 8) || 'LOT';
    const compactDate = (entry.production_date || inventoryDate).replace(/-/g, '');
    const uniquePart = `${rowIndex + 1}${Math.floor(100 + Math.random() * 900)}`;
    const autoBarcode = `${prefix}-${sanitizedLot}-${compactDate}-${uniquePart}`;

    return {
      product_code: product === 'Óleo de Aves' ? 'OLEO-AVES' : 'OLEO-GRAXO',
      product_description: product === 'Óleo de Aves' ? 'ÓLEO DE AVES' : 'ÓLEO GRAXO',
      bag_code: cleanLot,
      production_date: entry.production_date || inventoryDate,
      posting_date: entry.production_date || inventoryDate,
      posting_time: postingTimeStr || '00:00',
      period: 'A',
      weight_kg: weightKg,
      volume_liters: volumeLiters,
      barcode: normalizeBarcode(entry.barcode) || autoBarcode,
      quality_acidity: parseOptionalOilNum(entry.quality_acidity),
      quality_moisture: parseOptionalOilNum(entry.quality_moisture),
      quality_peroxide: parseOptionalOilNum(entry.quality_peroxide),
      quality_ether_extract: parseOptionalOilNum(entry.quality_ether_extract),
      quality_classification: entry.quality_classification
        ? entry.quality_classification.trim().toUpperCase()
        : null,
    };
  };

  const handleSupabaseOilColumnOrConstraintError = (err: any, fallbackTitle: string): boolean => {
    const msg = String(err?.message || '');
    if (
      (err?.code === '42703' || err?.code === 'PGRST204') &&
      msg.includes('volume_liters')
    ) {
      setOilSchemaNeedsSql(true);
      showToast(
        'error',
        'Coluna volume_liters ausente no Supabase',
        'Execute o SQL exibido acima do formulário de óleos no SQL Editor do Supabase.'
      );
      return true;
    }
    if (err?.code === '23514' && msg.includes('flour_type')) {
      setOilSchemaNeedsSql(true);
      showToast(
        'error',
        'Restrição de flour_type no Supabase',
        'Execute o SQL exibido acima do formulário de óleos para liberar Óleo de Aves e Óleo Graxo.'
      );
      return true;
    }
    showSupabaseError(fallbackTitle, err);
    return false;
  };

  const handleAddOilTankRow = () => {
    setOilTankRows((prev) => [
      ...prev,
      createOilTankRow(prev.length + 1, inventoryDate),
    ]);
  };

  const handleRemoveOilTankRow = (rowId: string) => {
    setOilTankRows((prev) => prev.filter((r) => r.rowId !== rowId));
  };

  const handleUpdateOilTankRow = (
    rowId: string,
    patch: Partial<OilEntryDraft>
  ) => {
    setOilTankRows((prev) =>
      prev.map((row) => (row.rowId === rowId ? { ...row, ...patch } : row))
    );
  };

  // Live consolidated totals for the dynamic oil tank rows currently in the form
  const oilFormTotals = useMemo(() => {
    let filledCount = 0;
    let totalKg = 0;
    let totalLiters = 0;
    oilTankRows.forEach((row) => {
      const kg = parseFlexibleDecimal(row.weight_kg);
      const liters = parseFlexibleDecimal(row.volume_liters);
      if (kg > 0 || liters > 0) {
        filledCount += 1;
        totalKg += kg;
        totalLiters += liters;
      }
    });
    return {
      filledCount,
      totalKg: Math.round(totalKg * 100) / 100,
      totalLiters: Math.round(totalLiters * 100) / 100,
    };
  }, [oilTankRows]);

  const buildValidatedOilBagsFromForm = (
    normalizedProduct: StandardProductType
  ): FfgInventoryBag[] | null => {
    const filledRows: { row: OilEntryDraft; index: number }[] = [];
    for (let i = 0; i < oilTankRows.length; i++) {
      const row = oilTankRows[i];
      const kg = parseFlexibleDecimal(row.weight_kg);
      const liters = parseFlexibleDecimal(row.volume_liters);
      const hasQuality =
        row.quality_acidity.trim() !== '' ||
        row.quality_moisture.trim() !== '' ||
        row.quality_peroxide.trim() !== '' ||
        row.quality_ether_extract.trim() !== '' ||
        row.quality_classification.trim() !== '';

      if (kg > 0 || liters > 0 || hasQuality) {
        if (!row.lot_tank.trim()) {
          showToast(
            'warning',
            'Identificação Obrigatória',
            `Informe a Identificação do Tanque / Lote na linha ${i + 1}.`
          );
          return null;
        }
        if (kg <= 0 && liters <= 0) {
          showToast(
            'warning',
            'Quantidade Obrigatória',
            `Informe Estoque KG e/ou Estoque L maiores que zero para "${row.lot_tank.trim()}".`
          );
          return null;
        }
        filledRows.push({ row, index: i });
      }
    }

    if (filledRows.length === 0) {
      showToast(
        'warning',
        'Nenhum Tanque Preenchido',
        'Preencha Estoque KG e Estoque L em pelo menos um tanque antes de salvar.'
      );
      return null;
    }

    return filledRows.map(({ row, index }) =>
      buildOilBagRecord(row, normalizedProduct, inventoryTime, index)
    );
  };

  // Save new inventory (header + draftBags / oilTankRows) or update existing inventory header
  const handleSaveInventoryHeader = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!inventoryDate) {
      showToast('warning', 'Validação', 'Informe a Data do Inventário.');
      return;
    }
    if (!inventoryTime) {
      showToast('warning', 'Validação', 'Informe o Horário do Inventário.');
      return;
    }
    if (!participants.trim()) {
      showToast('warning', 'Validação', 'Informe as pessoas que participaram do inventário.');
      return;
    }

    const normalizedProduct = normalizeProductType(flourType);

    setIsSavingInventory(true);
    try {
      if (selectedInventoryId) {
        // UPDATE existing inventory header
        const { error } = await supabase
          .from('ffg_inventories')
          .update({
            flour_type: normalizedProduct,
            inventory_date: inventoryDate,
            inventory_time: inventoryTime,
            participants: participants.trim(),
          })
          .eq('id', selectedInventoryId);

        if (error) throw error;

        showToast(
          'success',
          'Inventário Atualizado',
          `Cabeçalho do inventário de ${formatDateDDMMYYYY(inventoryDate)} (${normalizedProduct}) atualizado no Supabase.`
        );
        setIsEditingHeader(false);
        await onReload();
      } else {
        // Auto-include filled oil tank rows when saving a new oil inventory
        let bagsToSave = [...draftBags];
        let includedOilRowsCount = 0;
        if (isOilProductType(normalizedProduct)) {
          const oilRecords: FfgInventoryBag[] = [];
          for (let i = 0; i < oilTankRows.length; i++) {
            const row = oilTankRows[i];
            const kg = parseFlexibleDecimal(row.weight_kg);
            const liters = parseFlexibleDecimal(row.volume_liters);
            if (row.lot_tank.trim() && (kg > 0 || liters > 0)) {
              oilRecords.push(
                buildOilBagRecord(row, normalizedProduct, inventoryTime, i)
              );
            }
          }
          bagsToSave = [...bagsToSave, ...oilRecords];
          includedOilRowsCount = oilRecords.length;
        }

        // INSERT new inventory + staged draftBags / oil tanks
        const { data: insertedInv, error: invError } = await supabase
          .from('ffg_inventories')
          .insert([
            {
              flour_type: normalizedProduct,
              inventory_date: inventoryDate,
              inventory_time: inventoryTime,
              participants: participants.trim(),
            },
          ])
          .select()
          .single();

        if (invError) throw invError;
        const newInventoryId = insertedInv.id;

        if (bagsToSave.length > 0) {
          const bagsToInsert = bagsToSave.map((b) => ({
            inventory_id: newInventoryId,
            product_code: b.product_code,
            product_description: b.product_description,
            bag_code: b.bag_code,
            production_date: b.production_date,
            posting_date: b.posting_date,
            posting_time: b.posting_time,
            period: b.period,
            weight_kg: Number(b.weight_kg || 0),
            volume_liters:
              b.volume_liters !== null && b.volume_liters !== undefined
                ? Number(b.volume_liters)
                : null,
            barcode: normalizeBarcode(b.barcode),
            quality_acidity: b.quality_acidity ?? null,
            quality_peroxide: b.quality_peroxide ?? null,
            quality_moisture: b.quality_moisture ?? null,
            quality_ether_extract: b.quality_ether_extract ?? null,
            quality_crude_protein: b.quality_crude_protein ?? null,
            quality_mineral_matter: b.quality_mineral_matter ?? null,
            quality_digestibility: b.quality_digestibility ?? null,
            quality_classification: b.quality_classification ?? null,
            ...(b.is_blocked ? { is_blocked: true } : {}),
          }));

          const { error: bagsError } = await supabase
            .from('ffg_inventory_bags')
            .insert(bagsToInsert);

          if (bagsError) throw bagsError;
        }

        showToast(
          'success',
          'Inventário Salvo no Supabase',
          `Inventário de ${formatDateDDMMYYYY(inventoryDate)} (${normalizedProduct}) criado com ${bagsToSave.length} registro(s).`
        );
        setDraftBags([]);
        if (includedOilRowsCount > 0) {
          setOilTankRows(createDefaultOilTankRows(normalizedProduct, inventoryDate));
        }
        setOilSchemaNeedsSql(false);
        setIsCreatingNewInventory(false);
        setIsEditingHeader(false);
        setSelectedCalendarDate(inventoryDate);
        setSelectedInventoryId(String(newInventoryId));
        await onReload();
      }
    } catch (err: any) {
      handleSupabaseOilColumnOrConstraintError(err, 'Falha ao Salvar Inventário no Supabase');
    } finally {
      setIsSavingInventory(false);
    }
  };

  // Batch-save dynamic oil tank rows (either creating new inventory + tanks OR inserting into selected inventory)
  const handleSaveOilTanks = async (e: React.FormEvent) => {
    e.preventDefault();

    const normalizedProduct = normalizeProductType(flourType);
    if (!isOilProductType(normalizedProduct)) return;

    const validatedOilBags = buildValidatedOilBagsFromForm(normalizedProduct);
    if (!validatedOilBags) return;

    // Validate header fields if creating a brand new inventory
    if (!selectedInventoryId) {
      if (!inventoryDate) {
        showToast('warning', 'Validação', 'Informe a Data do Inventário no cabeçalho.');
        return;
      }
      if (!inventoryTime) {
        showToast('warning', 'Validação', 'Informe o Horário do Inventário no cabeçalho.');
        return;
      }
      if (!participants.trim()) {
        showToast(
          'warning',
          'Validação',
          'Informe as Pessoas que Participaram no cabeçalho antes de salvar.'
        );
        return;
      }
    }

    setIsAddingOilEntry(true);
    try {
      let targetInventoryId = selectedInventoryId;

      if (!targetInventoryId) {
        const { data: insertedInv, error: invError } = await supabase
          .from('ffg_inventories')
          .insert([
            {
              flour_type: normalizedProduct,
              inventory_date: inventoryDate,
              inventory_time: inventoryTime,
              participants: participants.trim(),
            },
          ])
          .select()
          .single();

        if (invError) throw invError;
        targetInventoryId = String(insertedInv.id);
      }

      const payload = validatedOilBags.map((b) => ({
        inventory_id: targetInventoryId,
        product_code: b.product_code,
        product_description: b.product_description,
        bag_code: b.bag_code,
        production_date: b.production_date,
        posting_date: b.posting_date,
        posting_time: b.posting_time,
        period: b.period,
        weight_kg: Number(b.weight_kg || 0),
        volume_liters:
          b.volume_liters !== null && b.volume_liters !== undefined
            ? Number(b.volume_liters)
            : null,
        barcode: normalizeBarcode(b.barcode),
        quality_acidity: b.quality_acidity ?? null,
        quality_peroxide: b.quality_peroxide ?? null,
        quality_moisture: b.quality_moisture ?? null,
        quality_ether_extract: b.quality_ether_extract ?? null,
        quality_crude_protein: b.quality_crude_protein ?? null,
        quality_mineral_matter: b.quality_mineral_matter ?? null,
        quality_digestibility: b.quality_digestibility ?? null,
        quality_classification: b.quality_classification ?? null,
      }));

      const { error: bagsError } = await supabase
        .from('ffg_inventory_bags')
        .insert(payload);

      if (bagsError) throw bagsError;

      const totalKgSaved = validatedOilBags.reduce(
        (sum, b) => sum + Number(b.weight_kg || 0),
        0
      );
      const totalLitersSaved = validatedOilBags.reduce(
        (sum, b) => sum + Number(b.volume_liters || 0),
        0
      );

      showToast(
        'success',
        'Tanques de Óleo Salvos no Supabase',
        `${validatedOilBags.length} tanque(s) de ${normalizedProduct} gravado(s): ${formatNumberBR(totalKgSaved)} kg / ${formatNumberBR(totalLitersSaved)} L.`
      );
      setOilSchemaNeedsSql(false);
      setDraftBags([]);
      setOilTankRows(createDefaultOilTankRows(normalizedProduct, inventoryDate));
      setIsCreatingNewInventory(false);
      setIsEditingHeader(false);
      setSelectedCalendarDate(inventoryDate);
      setSelectedInventoryId(targetInventoryId);
      await onReload();
    } catch (err: any) {
      handleSupabaseOilColumnOrConstraintError(err, 'Falha ao Salvar Tanques de Óleo no Supabase');
    } finally {
      setIsAddingOilEntry(false);
    }
  };

  const handleCopyOilSchemaSql = async () => {
    try {
      await navigator.clipboard.writeText(OIL_SCHEMA_SQL);
      showToast('success', 'SQL Copiado', 'Cole e execute no SQL Editor do Supabase.');
    } catch {
      showToast('info', 'Copiar SQL', 'Selecione o bloco SQL manualmente e copie.');
    }
  };

  // Import Excel / CSV of bags
  const handleExcelFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoadingExcel(true);
    try {
      const parsedBags = await parseInventoryBagsExcel(file);

      if (selectedInventoryId) {
        // Persist directly to the currently selected saved inventory in Supabase
        const payload = parsedBags.map((b) => ({
          ...b,
          inventory_id: selectedInventoryId,
          barcode: normalizeBarcode(b.barcode),
        }));

        const { error } = await supabase.from('ffg_inventory_bags').insert(payload);
        if (error) throw error;

        showToast(
          'success',
          'Planilha Importada para o Inventário',
          `${parsedBags.length} bags gravados no Supabase para o inventário selecionado.`
        );
        await onReload();
      } else {
        // Stage in draftBags when creating a new inventory
        setDraftBags((prev) => [...prev, ...parsedBags]);
        showToast(
          'success',
          'Planilha Carregada no Rascunho',
          `${parsedBags.length} bags prontos. Clique em "Salvar Inventário no Supabase" para gravar.`
        );
      }
    } catch (err: any) {
      showToast('error', 'Falha na Importação de Bags', err?.message || 'Erro ao ler planilha.');
    } finally {
      setLoadingExcel(false);
      if (excelInputRef.current) excelInputRef.current.value = '';
    }
  };

  // "+ Incluir Estoque" (Entrada Diária de Produção) - Appends new bags directly to active stock without recreating/replacing monthly inventory
  const handleDailyStockFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoadingDailyStock(true);
    try {
      const parsedBags = await parseInventoryBagsExcel(file);
      if (!parsedBags.length) {
        showToast('warning', 'Planilha Vazia', 'Nenhum bag válido encontrado na planilha.');
        return;
      }

      // Deduplicate against active/existing barcodes in stock & within the uploaded file
      const existingBarcodeKeys = new Set<string>();
      inventoryBags.forEach((b) => {
        const key = normalizeBarcodeKey(b.barcode);
        if (key) existingBarcodeKeys.add(key);
      });

      const productCodeToType = new Map<string, StandardProductType>();
      inventoryBags.forEach((b) => {
        const codeKey = (b.product_code || '').trim().toUpperCase();
        if (codeKey && !productCodeToType.has(codeKey)) {
          productCodeToType.set(codeKey, inferBagFlourType(b, inventoryMap));
        }
      });

      const seenInFile = new Set<string>();
      const newBags: FfgInventoryBag[] = [];
      let skippedDuplicates = 0;

      for (const bag of parsedBags) {
        const key = normalizeBarcodeKey(bag.barcode);
        if (key && (existingBarcodeKeys.has(key) || seenInFile.has(key))) {
          skippedDuplicates += 1;
          continue;
        }
        if (key) seenInFile.add(key);
        newBags.push(bag);
      }

      if (newBags.length === 0) {
        showToast(
          'info',
          'Estoque Já Atualizado',
          `Todos os ${skippedDuplicates} código(s) da planilha já constam no estoque ativo.`
        );
        setDailyStockSummary({
          fileName: file.name,
          addedCount: 0,
          skippedDuplicates,
          totalAddedKg: 0,
          breakdown: [],
        });
        return;
      }

      // Group new bags by detected product type
      const bagsByProduct = new Map<StandardProductType, FfgInventoryBag[]>();
      const emptyInvMap = new Map<string, FfgInventory>();
      for (const bag of newBags) {
        const codeKey = (bag.product_code || '').trim().toUpperCase();
        const detectedType =
          (codeKey ? productCodeToType.get(codeKey) : undefined) ||
          inferBagFlourType(bag, emptyInvMap);
        const list = bagsByProduct.get(detectedType) || [];
        list.push(bag);
        bagsByProduct.set(detectedType, list);
      }

      // Sort existing inventories newest first so new daily bags append to the active/current inventory of each product
      const sortedInventories = [...inventories].sort((a, b) => {
        const da = (a.inventory_date || '').split('T')[0];
        const db = (b.inventory_date || '').split('T')[0];
        if (da !== db) return db.localeCompare(da);
        return (b.inventory_time || '').localeCompare(a.inventory_time || '');
      });

      const breakdown: string[] = [];
      let totalAddedKg = 0;

      for (const [productType, groupBags] of bagsByProduct.entries()) {
        let targetInventoryId: string | number | undefined;

        if (
          selectedInventory &&
          normalizeProductType(selectedInventory.flour_type) === productType &&
          selectedInventory.id !== undefined
        ) {
          targetInventoryId = selectedInventory.id;
        } else {
          const activeInvForProduct = sortedInventories.find(
            (inv) => normalizeProductType(inv.flour_type) === productType && inv.id !== undefined
          );
          targetInventoryId = activeInvForProduct?.id;
        }

        // Only create an inventory header if none exists yet in the database for this product
        if (targetInventoryId === undefined) {
          const fallbackDate =
            groupBags[0]?.production_date ||
            groupBags[0]?.posting_date ||
            new Date().toISOString().split('T')[0];
          const fallbackTime =
            (groupBags[0]?.posting_time || '').slice(0, 5) ||
            new Date().toTimeString().slice(0, 5);

          const { data: createdInv, error: invErr } = await supabase
            .from('ffg_inventories')
            .insert([
              {
                flour_type: productType,
                inventory_date: fallbackDate,
                inventory_time: fallbackTime,
                participants: 'Entrada Produção Diária',
              },
            ])
            .select()
            .single();

          if (invErr) throw invErr;
          targetInventoryId = createdInv.id;
        }

        const payload = groupBags.map((b) => ({
          inventory_id: targetInventoryId,
          product_code: b.product_code,
          product_description: b.product_description,
          bag_code: b.bag_code,
          production_date: b.production_date,
          posting_date: b.posting_date,
          posting_time: b.posting_time,
          period: b.period,
          weight_kg: Number(b.weight_kg || 0),
          barcode: normalizeBarcode(b.barcode),
        }));

        // Insert in chunks of 300 rows to avoid payload size limits
        for (let i = 0; i < payload.length; i += 300) {
          const chunk = payload.slice(i, i + 300);
          const { error: insertErr } = await supabase
            .from('ffg_inventory_bags')
            .insert(chunk);
          if (insertErr) throw insertErr;
        }

        const groupKg = groupBags.reduce((sum, b) => sum + Number(b.weight_kg || 0), 0);
        totalAddedKg += groupKg;
        breakdown.push(`${productType}: +${groupBags.length} bag(s) (${formatNumberBR(groupKg)} kg)`);
      }

      setDailyStockSummary({
        fileName: file.name,
        addedCount: newBags.length,
        skippedDuplicates,
        totalAddedKg,
        breakdown,
      });

      showToast(
        'success',
        'Estoque Diário Incluído',
        `+${newBags.length} bag(s) (${formatNumberBR(totalAddedKg)} kg) somados ao estoque ativo.${
          skippedDuplicates > 0 ? ` ${skippedDuplicates} código(s) já existente(s) ignorado(s).` : ''
        }`
      );
      await onReload();
    } catch (err: any) {
      if (err?.code) {
        showSupabaseError('Falha ao Incluir Estoque no Supabase', err);
      } else {
        showToast(
          'error',
          'Falha ao Incluir Estoque',
          err?.message || 'Erro ao processar planilha de produção.'
        );
      }
    } finally {
      setLoadingDailyStock(false);
      if (dailyStockInputRef.current) dailyStockInputRef.current.value = '';
    }
  };

  // Add manual bag
  const handleAddManualBag = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!manualBag.product_code.trim() || !manualBag.product_description.trim()) {
      showToast('warning', 'Validação', 'Informe o Código e a Descrição do produto.');
      return;
    }
    if (!manualBag.bag_code.trim() || !manualBag.barcode.trim()) {
      showToast('warning', 'Validação', 'Informe o Cód. Bag e o Código de Barra.');
      return;
    }
    if (Number(manualBag.weight_kg) <= 0) {
      showToast('warning', 'Validação', 'Informe um Peso (kg) válido maior que zero.');
      return;
    }

    const newBag: FfgInventoryBag = {
      ...manualBag,
      barcode: normalizeBarcode(manualBag.barcode),
      weight_kg: Math.round(Number(manualBag.weight_kg) * 100) / 100,
    };

    try {
      if (selectedInventoryId) {
        const { error } = await supabase
          .from('ffg_inventory_bags')
          .insert([{ ...newBag, inventory_id: selectedInventoryId }]);

        if (error) throw error;
        showToast('success', 'Bag Adicionado', `Bag ${newBag.bag_code} gravado no Supabase.`);
        await onReload();
      } else {
        setDraftBags((prev) => [...prev, newBag]);
        showToast('success', 'Bag Adicionado ao Rascunho', `Bag ${newBag.bag_code} incluído.`);
      }
      setManualBag(emptyManualBag());
    } catch (err: any) {
      showSupabaseError('Falha ao Adicionar Bag no Supabase', err);
    }
  };

  // Import Quality Excel/CSV -> Exact Barcode Match -> Update Supabase / Draft
  const handleQualityExcelChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoadingQualityExcel(true);
    setQualityImportSummary(null);
    try {
      const qualityRows = await parseQualityReportExcel(file);

      // Build exact lookup map by normalized barcode (last row wins if duplicated in file)
      const qualityLookup = new Map<string, ParsedQualityRow>();
      const periodLookupByProduct = new Map<string, ParsedQualityRow>();
      const periodLookupByDate = new Map<string, ParsedQualityRow>();

      const registerPeriodRow = (
        row: ParsedQualityRow,
        prodDate?: string | null,
        period?: string | null,
        productType?: StandardProductType | null
      ) => {
        const cleanDate = (prodDate || '').split('T')[0];
        const cleanPeriod = (period || '').trim().toUpperCase();
        if (!cleanDate || !cleanPeriod) return;
        if (productType) {
          periodLookupByProduct.set(`${productType}|${cleanDate}|${cleanPeriod}`, row);
        }
        periodLookupByDate.set(`${cleanDate}|${cleanPeriod}`, row);
      };

      qualityRows.forEach((row) => {
        const code = normalizeBarcode(row.barcode);
        if (code) {
          qualityLookup.set(code, row);
        }
        registerPeriodRow(row, row.production_date, row.period, null);
      });

      const matchedRowBarcodes = new Set<string>();
      const matchedDraftIdx = new Set<number>();
      const matchedBagIds = new Set<string>();
      let matchedBagsCount = 0;

      const buildQualityPayload = (match: ParsedQualityRow) => ({
        quality_acidity: match.acidity ?? null,
        quality_peroxide: match.peroxide ?? null,
        quality_moisture: match.moisture ?? null,
        quality_ether_extract: match.ether_extract ?? null,
        quality_crude_protein: match.crude_protein ?? null,
        quality_mineral_matter: match.mineral_matter ?? null,
        quality_digestibility: match.digestibility ?? null,
        quality_classification: match.classification
          ? match.classification.trim().toUpperCase()
          : null,
      });

      // 1A. Exact barcode pass on draftBags (also learns period keys from matched bags)
      let workingDraft = [...draftBags];
      if (!selectedInventoryId && workingDraft.length > 0) {
        workingDraft = workingDraft.map((bag, idx) => {
          const bagCode = normalizeBarcode(bag.barcode);
          const match = qualityLookup.get(bagCode);
          if (!match) return bag;
          matchedBagsCount += 1;
          matchedDraftIdx.add(idx);
          matchedRowBarcodes.add(bagCode);
          registerPeriodRow(
            match,
            bag.production_date,
            bag.period,
            inferBagFlourType(bag, inventoryMap)
          );
          return {
            ...bag,
            ...buildQualityPayload(match),
          };
        });
      }

      // 1B. Exact barcode pass on saved bags in Supabase
      const savedMatches: { bag: FfgInventoryBag; match: ParsedQualityRow; barcode: string }[] = [];
      inventoryBags.forEach((bag) => {
        const bagCode = normalizeBarcode(bag.barcode);
        if (!bagCode || bag.id === undefined) return;
        const match = qualityLookup.get(bagCode);
        if (match) {
          savedMatches.push({ bag, match, barcode: bagCode });
          matchedBagIds.add(String(bag.id));
          registerPeriodRow(
            match,
            bag.production_date,
            bag.period,
            inferBagFlourType(bag, inventoryMap)
          );
        }
      });

      // 2A. Period/Batch inheritance pass for remaining draftBags sharing same production_date + period
      if (!selectedInventoryId && workingDraft.length > 0) {
        workingDraft = workingDraft.map((bag, idx) => {
          if (matchedDraftIdx.has(idx)) return bag;
          if (hasBagNumericQuality(bag) || (bag.quality_classification || '').trim()) return bag;
          const prodDate = (bag.production_date || '').split('T')[0];
          const period = (bag.period || '').trim().toUpperCase();
          if (!prodDate || !period) return bag;
          const pType = inferBagFlourType(bag, inventoryMap);
          const inherited =
            periodLookupByProduct.get(`${pType}|${prodDate}|${period}`) ||
            periodLookupByDate.get(`${prodDate}|${period}`);
          if (!inherited) return bag;
          matchedBagsCount += 1;
          return {
            ...bag,
            ...buildQualityPayload(inherited),
          };
        });
        setDraftBags(workingDraft);
      }

      // 2B. Period/Batch inheritance pass for remaining saved bags sharing same production_date + period
      inventoryBags.forEach((bag) => {
        if (bag.id === undefined || matchedBagIds.has(String(bag.id))) return;
        if (hasBagNumericQuality(bag) || (bag.quality_classification || '').trim()) return;
        const prodDate = (bag.production_date || '').split('T')[0];
        const period = (bag.period || '').trim().toUpperCase();
        if (!prodDate || !period) return;
        const pType = inferBagFlourType(bag, inventoryMap);
        const inherited =
          periodLookupByProduct.get(`${pType}|${prodDate}|${period}`) ||
          periodLookupByDate.get(`${prodDate}|${period}`);
        if (inherited) {
          savedMatches.push({
            bag,
            match: inherited,
            barcode: normalizeBarcode(bag.barcode),
          });
          matchedBagIds.add(String(bag.id));
        }
      });

      if (savedMatches.length > 0) {
        const chunkSize = 10;
        for (let i = 0; i < savedMatches.length; i += chunkSize) {
          const chunk = savedMatches.slice(i, i + chunkSize);
          await Promise.all(
            chunk.map(async ({ bag, match, barcode }) => {
              const { error } = await supabase
                .from('ffg_inventory_bags')
                .update(buildQualityPayload(match))
                .eq('id', bag.id);

              if (error) throw error;
              matchedBagsCount += 1;
              if (barcode) matchedRowBarcodes.add(barcode);
            })
          );
        }
        await onReload();
      }

      const unmatchedBarcodes = qualityRows
        .map((r) => normalizeBarcode(r.barcode))
        .filter((code) => code && !matchedRowBarcodes.has(code));

      const notFoundCount = unmatchedBarcodes.length;

      setQualityImportSummary({
        fileName: file.name,
        totalRows: qualityRows.length,
        matchedCount: matchedBagsCount,
        notFoundCount,
        unmatchedBarcodes,
      });

      const summaryText = `${matchedBagsCount} laudos vinculados com sucesso (incluindo herança por data/período). ${notFoundCount} códigos não encontrados no estoque atual.`;

      if (matchedBagsCount > 0) {
        showToast('success', 'Laudos de Qualidade Importados', summaryText);
      } else {
        showToast('info', 'Importação Concluída Sem Correspondência', summaryText);
      }
    } catch (err: any) {
      if (err?.message && err?.code) {
        showSupabaseError('Falha ao Gravar Laudos no Supabase', err);
      } else {
        showToast(
          'error',
          'Falha na Importação de Qualidade',
          err?.message || 'Erro ao ler a planilha de Qualidade.'
        );
      }
    } finally {
      setLoadingQualityExcel(false);
      if (qualityExcelInputRef.current) qualityExcelInputRef.current.value = '';
    }
  };

  // Save edited bag
  const handleSaveBagEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingBag) return;

    const cleanBarcode = normalizeBarcode(editingBag.barcode);
    const parseNullableNum = (v: any): number | null => {
      if (v === '' || v === null || v === undefined) return null;
      const n = Number(v);
      return isNaN(n) ? null : n;
    };

    const parsedLiters = parseNullableNum(editingBag.volume_liters);
    const updatedData: FfgInventoryBag = {
      ...editingBag,
      barcode: cleanBarcode,
      weight_kg: Math.round(Number(editingBag.weight_kg || 0) * 100) / 100,
      volume_liters:
        parsedLiters !== null ? Math.round(parsedLiters * 100) / 100 : null,
      quality_acidity: parseNullableNum(editingBag.quality_acidity),
      quality_peroxide: parseNullableNum(editingBag.quality_peroxide),
      quality_moisture: parseNullableNum(editingBag.quality_moisture),
      quality_ether_extract: parseNullableNum(editingBag.quality_ether_extract),
      quality_crude_protein: parseNullableNum(editingBag.quality_crude_protein),
      quality_mineral_matter: parseNullableNum(editingBag.quality_mineral_matter),
      quality_digestibility: parseNullableNum(editingBag.quality_digestibility),
      quality_classification: editingBag.quality_classification
        ? editingBag.quality_classification.trim().toUpperCase()
        : null,
    };

    if (editingBag.id !== undefined) {
      setIsSavingBagEdit(true);
      try {
        const updatePayload: Record<string, any> = {
          product_code: updatedData.product_code,
          product_description: updatedData.product_description,
          bag_code: updatedData.bag_code,
          production_date: updatedData.production_date,
          posting_date: updatedData.posting_date,
          posting_time: updatedData.posting_time,
          period: updatedData.period,
          weight_kg: updatedData.weight_kg,
          barcode: updatedData.barcode,
          quality_acidity: updatedData.quality_acidity,
          quality_peroxide: updatedData.quality_peroxide,
          quality_moisture: updatedData.quality_moisture,
          quality_ether_extract: updatedData.quality_ether_extract,
          quality_crude_protein: updatedData.quality_crude_protein,
          quality_mineral_matter: updatedData.quality_mineral_matter,
          quality_digestibility: updatedData.quality_digestibility,
          quality_classification: updatedData.quality_classification,
        };
        if (updatedData.volume_liters !== null && updatedData.volume_liters !== undefined) {
          updatePayload.volume_liters = updatedData.volume_liters;
        }

        const { error } = await supabase
          .from('ffg_inventory_bags')
          .update(updatePayload)
          .eq('id', editingBag.id);

        if (error) throw error;
        showToast('success', 'Registro Atualizado', `Item ${updatedData.bag_code} atualizado no Supabase.`);
        setEditingBag(null);
        setEditingBagIndex(null);
        await onReload();
      } catch (err: any) {
        handleSupabaseOilColumnOrConstraintError(err, 'Falha ao Atualizar Registro no Supabase');
      } finally {
        setIsSavingBagEdit(false);
      }
    } else if (editingBagIndex !== null) {
      setDraftBags((prev) =>
        prev.map((b, idx) => (idx === editingBagIndex ? updatedData : b))
      );
      showToast('success', 'Registro Atualizado no Rascunho', `Item ${updatedData.bag_code} atualizado.`);
      setEditingBag(null);
      setEditingBagIndex(null);
    }
  };

  // Confirm Delete Bag (without window.confirm)
  const handleConfirmDeleteBag = async () => {
    if (!bagPendingDelete) return;
    const { bag, draftIndex } = bagPendingDelete;

    if (bag.id !== undefined) {
      setIsDeletingBag(true);
      try {
        const { error } = await supabase
          .from('ffg_inventory_bags')
          .delete()
          .eq('id', bag.id);

        if (error) throw error;
        showToast('success', 'Bag Excluído', `Bag ${bag.bag_code} removido do Supabase.`);
        setBagPendingDelete(null);
        await onReload();
      } catch (err: any) {
        showSupabaseError('Falha ao Excluir Bag no Supabase', err);
      } finally {
        setIsDeletingBag(false);
      }
    } else if (draftIndex !== undefined) {
      setDraftBags((prev) => prev.filter((_, idx) => idx !== draftIndex));
      setBagPendingDelete(null);
      showToast('info', 'Bag Removido', 'Bag removido do rascunho.');
    }
  };

  // Toggle Bag Block status (is_blocked) in real time in Supabase or draft
  const handleToggleBlockBag = async (bag: FfgInventoryBag, draftIndex?: number) => {
    const nextBlocked = !Boolean(bag.is_blocked);
    const bagKey = bag.id !== undefined ? String(bag.id) : `draft-${draftIndex}`;

    if (bag.id !== undefined) {
      setTogglingBlockBagKey(bagKey);
      try {
        const { error } = await supabase
          .from('ffg_inventory_bags')
          .update({ is_blocked: nextBlocked })
          .eq('id', bag.id);

        if (error) {
          const msg = String(error.message || '');
          if (error.code === '42703' || error.code === 'PGRST204' || msg.includes('is_blocked')) {
            showToast(
              'error',
              'Coluna is_blocked ausente no Supabase',
              'Execute no SQL Editor do Supabase: ALTER TABLE public.ffg_inventory_bags ADD COLUMN IF NOT EXISTS is_blocked boolean NOT NULL DEFAULT false;'
            );
            return;
          }
          throw error;
        }

        showToast(
          nextBlocked ? 'warning' : 'success',
          nextBlocked ? 'Bag Bloqueado' : 'Bag Desbloqueado',
          `Bag #${bag.bag_code} ${nextBlocked ? 'bloqueado' : 'desbloqueado'} com sucesso.`
        );
        await onReload();
      } catch (err: any) {
        showSupabaseError('Falha ao Alterar Bloqueio do Bag', err);
      } finally {
        setTogglingBlockBagKey(null);
      }
    } else if (draftIndex !== undefined) {
      setDraftBags((prev) =>
        prev.map((b, idx) => (idx === draftIndex ? { ...b, is_blocked: nextBlocked } : b))
      );
      showToast(
        nextBlocked ? 'warning' : 'success',
        nextBlocked ? 'Bag Bloqueado no Rascunho' : 'Bag Desbloqueado no Rascunho',
        `Bag #${bag.bag_code} marcado como ${nextBlocked ? 'bloqueado' : 'desbloqueado'}.`
      );
    }
  };

  // Confirm Delete Inventory (without window.confirm)
  const handleConfirmDeleteInventory = async () => {
    if (!inventoryPendingDelete?.id) return;
    setIsDeletingInventory(true);

    try {
      // Delete associated bags first to guarantee clean removal even without cascade FK
      const { error: bagsError } = await supabase
        .from('ffg_inventory_bags')
        .delete()
        .eq('inventory_id', inventoryPendingDelete.id);

      if (bagsError) throw bagsError;

      const { error: invError } = await supabase
        .from('ffg_inventories')
        .delete()
        .eq('id', inventoryPendingDelete.id);

      if (invError) throw invError;

      showToast(
        'success',
        'Inventário Excluído',
        `Inventário de ${formatDateDDMMYYYY(inventoryPendingDelete.inventory_date)} removido do Supabase.`
      );
      if (selectedInventoryId === String(inventoryPendingDelete.id)) {
        setSelectedInventoryId(null);
      }
      setInventoryPendingDelete(null);
      await onReload();
    } catch (err: any) {
      showSupabaseError('Falha ao Excluir Inventário no Supabase', err);
    } finally {
      setIsDeletingInventory(false);
    }
  };

  return (
    <div className="space-y-6">
      <input
        type="file"
        ref={qualityExcelInputRef}
        accept=".xlsx,.xls,.csv"
        onChange={handleQualityExcelChange}
        className="hidden"
        id="inventory-quality-excel-input"
      />
      <input
        type="file"
        ref={dailyStockInputRef}
        accept=".xlsx,.xls,.csv"
        onChange={handleDailyStockFileChange}
        className="hidden"
        id="daily-stock-excel-input"
      />

      {/* Estilo global dedicado para impressão em Paisagem */}
      <style type="text/css" media="print">{`
        @page { size: landscape; margin: 10mm; }
      `}</style>

      {/* CABEÇALHO EXCLUSIVO DE IMPRESSÃO / PDF */}
      <div className="hidden print:flex items-center justify-between border-b-2 border-slate-800 pb-2 mb-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-600 font-mono">
            União Avícola Agroindustrial &bull; FFG-NM
          </div>
          <h1 className="text-base font-black text-slate-900 uppercase tracking-tight">
            {printReportData.mode === 'general'
              ? 'Relatório Consolidado — Estoque Geral'
              : `Relatório Consolidado de Inventário — ${formatDateDDMMYYYY(printReportData.targetDate)}`}
          </h1>
        </div>
        <div className="text-right text-[10px] font-mono text-slate-700">
          <div>
            Emitido em: {new Date().toLocaleDateString('pt-BR')} às{' '}
            {new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          </div>
          <div>
            {printReportData.totalBags} registro(s) &bull;{' '}
            {formatNumberBR(printReportData.totalWeightKg)} kg
            {printReportData.totalOilLiters > 0 && (
              <> &bull; {formatNumberBR(printReportData.totalOilLiters)} L</>
            )}
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* TOP SUMMARY CARDS: APENAS RESUMO GERAL DO ESTOQUE CONSOLIDADO NA TELA     */}
      {/* (O bloco "Resumo do Dia" fica exclusivo para impressão PDF por Data)       */}
      {/* ========================================================================= */}
      <div className="space-y-4 print:space-y-3">
        {/* Resumo do Dia — exclusivo para impressão PDF quando modo = byDate */}
        <div
          className={`hidden ${
            printReportData.mode === 'general' ? 'print:hidden' : 'print:block'
          } space-y-2.5`}
        >
          <div className="flex items-center justify-between px-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 font-mono flex items-center gap-1.5">
              <ClipboardList className="w-3.5 h-3.5" />
              <span>
                {`RESUMO DO DIA (${formatDateDDMMYYYY(printReportData.targetDate)})`}
                {printReportData.dayInventoryCount > 0 && (
                  <span className="text-slate-600 font-normal">
                    {' '}
                    &bull; {printReportData.dayInventoryCount} inventário(s) consolidado(s)
                  </span>
                )}
              </span>
            </span>
          </div>
          <div className="grid grid-cols-4 gap-2">
            <div className="bg-white border border-slate-400 rounded-2xl p-2.5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 font-mono">
                Total de Bags / Lotes (Dia)
              </div>
              <div className="mt-0.5 text-xl font-black font-mono text-emerald-700">
                {printReportData.totalBags}
              </div>
              <div className="mt-1 text-[10px] text-slate-500 font-mono">
                Soma dos inventários do dia
              </div>
            </div>

            <div className="bg-white border border-slate-400 rounded-2xl p-2.5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600 font-mono">
                Bags Farinha de Vísceras
              </div>
              <div className="mt-0.5 text-xl font-black font-mono text-slate-900">
                {printReportData.viscerasList.length}
              </div>
              <div className="mt-1 text-[10px] text-slate-500 font-mono">
                {formatNumberBR(printReportData.viscerasWeightKg)} kg no dia
              </div>
            </div>

            <div className="bg-white border border-slate-400 rounded-2xl p-2.5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600 font-mono">
                Bags Farinha de Penas
              </div>
              <div className="mt-0.5 text-xl font-black font-mono text-slate-900">
                {printReportData.penasList.length}
              </div>
              <div className="mt-1 text-[10px] text-slate-500 font-mono">
                {formatNumberBR(printReportData.penasWeightKg)} kg no dia
              </div>
            </div>

            <div className="bg-white border border-slate-400 rounded-2xl p-2.5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600 font-mono">
                Peso Total (Dia)
              </div>
              <div className="mt-0.5 flex items-baseline gap-1.5">
                <span className="text-lg font-black font-mono text-slate-900">
                  {formatNumberBR(printReportData.totalWeightKg)}
                </span>
                <span className="text-xs text-slate-500 font-mono">kg</span>
              </div>
              <div className="mt-1 text-[10px] text-slate-500 font-mono">
                {formatNumberBR(printReportData.totalWeightKg / 1000)} t
                {printReportData.totalOilLiters > 0 &&
                  ` • ${formatNumberBR(printReportData.totalOilLiters)} L óleo`}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="bg-white border border-slate-400 rounded-2xl p-2 flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-amber-700 font-mono flex items-center gap-1.5">
                  <Droplets className="w-3.5 h-3.5" />
                  Óleo de Aves (Dia)
                </div>
                <div className="mt-1 text-xs font-mono text-slate-600">
                  {printReportData.oleoAvesList.length} lote(s)
                </div>
              </div>
              <div className="text-right font-mono">
                <div className="text-sm font-black text-slate-900">
                  {formatNumberBR(printReportData.oleoAvesWeightKg)} kg
                </div>
                <div className="text-xs font-bold text-amber-700">
                  {formatNumberBR(printReportData.oleoAvesLiters)} L
                </div>
              </div>
            </div>

            <div className="bg-white border border-slate-400 rounded-2xl p-2 flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-orange-700 font-mono flex items-center gap-1.5">
                  <Droplets className="w-3.5 h-3.5" />
                  Óleo Graxo (Dia)
                </div>
                <div className="mt-1 text-xs font-mono text-slate-600">
                  {printReportData.oleoGraxoList.length} lote(s)
                </div>
              </div>
              <div className="text-right font-mono">
                <div className="text-sm font-black text-slate-900">
                  {formatNumberBR(printReportData.oleoGraxoWeightKg)} kg
                </div>
                <div className="text-xs font-bold text-orange-700">
                  {formatNumberBR(printReportData.oleoGraxoLiters)} L
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 1. Resumo Geral do Estoque Consolidado (exibido imediatamente ao abrir a aba) */}
        <div className="bg-white border border-amber-200 print:border-slate-400 rounded-2xl p-5 print:p-3 shadow-sm print:shadow-none space-y-4">
          <div className="flex items-center gap-2 text-amber-800 font-bold text-xs tracking-wider uppercase font-mono">
            <Package className="w-4 h-4 text-amber-600" />
            <span>
              Resumo Geral do Estoque Consolidado ({inventories.length} Inventário(s) Gravado(s))
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 print:grid-cols-4 gap-4 print:gap-3">
            <div className="bg-slate-50 border border-amber-200/80 print:border-slate-400 rounded-xl p-4">
              <div className="text-[10px] font-bold uppercase tracking-wider text-amber-700 font-mono">
                Total em Estoque (Itens)
              </div>
              <div className="mt-1.5 text-3xl font-black font-mono text-amber-700">
                {globalStockKpis.totalBags}
              </div>
              <div className="mt-1 text-[10px] text-slate-500 font-mono">
                {globalStockKpis.dispatchedBags > 0
                  ? `${globalStockKpis.dispatchedBags} item(ns) já expedido(s)`
                  : 'Soma do estoque ativo'}
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-200 print:border-slate-400 rounded-xl p-4">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600 font-mono">
                Farinha de Vísceras em Estoque
              </div>
              <div className="mt-1.5 text-3xl font-black font-mono text-slate-900">
                {globalStockKpis.viscerasBags}
              </div>
              <div className="mt-1 text-[10px] text-slate-500 font-mono">
                {formatNumberBR(globalStockKpis.viscerasWeightKg)} kg ativos
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-200 print:border-slate-400 rounded-xl p-4">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600 font-mono">
                Farinha de Penas em Estoque
              </div>
              <div className="mt-1.5 text-3xl font-black font-mono text-slate-900">
                {globalStockKpis.penasBags}
              </div>
              <div className="mt-1 text-[10px] text-slate-500 font-mono">
                {formatNumberBR(globalStockKpis.penasWeightKg)} kg ativos
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-200 print:border-slate-400 rounded-xl p-4">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600 font-mono">
                Peso Total Acumulado
              </div>
              <div className="mt-1.5 flex items-baseline gap-1.5">
                <span className="text-2xl font-black font-mono text-slate-900">
                  {formatNumberBR(globalStockKpis.totalWeightKg)}
                </span>
                <span className="text-xs text-slate-500 font-mono">kg</span>
              </div>
              <div className="mt-1 text-[10px] text-slate-500 font-mono">
                {formatNumberBR(globalStockKpis.totalWeightKg / 1000)} t em estoque
                {globalStockKpis.totalOilLiters > 0 &&
                  ` • ${formatNumberBR(globalStockKpis.totalOilLiters)} L óleo`}
              </div>
            </div>
          </div>

          {/* Sub-row: Óleo de Aves & Óleo Graxo em Estoque (KG e Litros separados) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 print:grid-cols-2 gap-4 print:gap-3">
            <div className="bg-amber-50/40 border border-amber-200 print:border-slate-400 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-amber-700 font-mono flex items-center gap-1.5">
                  <Droplets className="w-3.5 h-3.5" />
                  Óleo de Aves em Estoque
                </div>
                <div className="mt-1 text-[11px] font-mono text-slate-500">
                  {globalStockKpis.oleoAvesCount} lote(s) / tanque(s) ativo(s)
                </div>
              </div>
              <div className="text-right font-mono">
                <div className="text-lg font-black text-slate-900">
                  {formatNumberBR(globalStockKpis.oleoAvesWeightKg)} kg
                </div>
                <div className="text-xs font-bold text-amber-700">
                  {formatNumberBR(globalStockKpis.oleoAvesLiters)} L
                </div>
              </div>
            </div>

            <div className="bg-orange-50/40 border border-orange-200 print:border-slate-400 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-orange-700 font-mono flex items-center gap-1.5">
                  <Droplets className="w-3.5 h-3.5" />
                  Óleo Graxo em Estoque
                </div>
                <div className="mt-1 text-[11px] font-mono text-slate-500">
                  {globalStockKpis.oleoGraxoCount} lote(s) / tanque(s) ativo(s)
                </div>
              </div>
              <div className="text-right font-mono">
                <div className="text-lg font-black text-slate-900">
                  {formatNumberBR(globalStockKpis.oleoGraxoWeightKg)} kg
                </div>
                <div className="text-xs font-bold text-orange-700">
                  {formatNumberBR(globalStockKpis.oleoGraxoLiters)} L
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* SUB-TABS NAVIGATION + EXPORTAR PDF */}
      {/* ========================================================================= */}
      <div className="bg-white border border-slate-200 rounded-2xl p-2 shadow-sm flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl border border-slate-200">
          <button
            type="button"
            onClick={() => setSubTab('bags')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
              subTab === 'bags'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900 hover:bg-white'
            }`}
          >
            <PackageCheck className="w-4 h-4" />
            <span>Lista de Bags (Inventário)</span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab('quality')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
              subTab === 'quality'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900 hover:bg-white'
            }`}
          >
            <FlaskConical className="w-4 h-4" />
            <span>Qualidade do Estoque</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Botão Discreto de Calendário com Popover Suspenso */}
          <div ref={calendarPopoverRef} className="relative">
            <div className="flex items-center">
              <button
                type="button"
                onClick={() => setIsCalendarPopoverOpen((prev) => !prev)}
                aria-expanded={isCalendarPopoverOpen}
                className={`px-3.5 py-2 border rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-2xs transition-colors ${
                  selectedCalendarDate
                    ? 'bg-emerald-50 hover:bg-emerald-100 border-emerald-300 text-emerald-800'
                    : 'bg-white hover:bg-slate-50 border-slate-300 text-slate-700'
                }`}
                title="Abrir calendário para filtrar inventário por data"
              >
                <Calendar className="w-4 h-4 text-emerald-600" />
                <span>
                  {selectedCalendarDate
                    ? `Data: ${formatDateDDMMYYYY(selectedCalendarDate)}`
                    : 'Selecionar Data'}
                </span>
              </button>
              {selectedCalendarDate && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCalendarDate(null);
                    setSelectedInventoryId(null);
                    setFetchedDayInventories(null);
                    setFetchedDayBags(null);
                    setIsEditingHeader(false);
                    setIsCalendarPopoverOpen(false);
                  }}
                  className="ml-1 p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-900 transition-colors"
                  title="Voltar para Estoque Geral"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {isCalendarPopoverOpen && (() => {
              const monthNames = [
                'Janeiro',
                'Fevereiro',
                'Março',
                'Abril',
                'Maio',
                'Junho',
                'Julho',
                'Agosto',
                'Setembro',
                'Outubro',
                'Novembro',
                'Dezembro',
              ];
              const weekDays = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
              const { year, month } = calendarMonth;
              const firstWeekDay = new Date(year, month, 1).getDay();
              const daysInMonth = new Date(year, month + 1, 0).getDate();
              const todayKey = new Date().toISOString().split('T')[0];

              const shiftMonth = (delta: number) => {
                const d = new Date(year, month + delta, 1);
                setCalendarMonth({ year: d.getFullYear(), month: d.getMonth() });
              };

              const monthsWithRecords = Array.from(
                new Set(
                  inventories
                    .map((inv) => (inv.inventory_date || '').split('T')[0].slice(0, 7))
                    .filter((ym) => /^\d{4}-\d{2}$/.test(ym))
                )
              ).sort((a, b) => b.localeCompare(a));

              return (
                <div className="absolute right-0 top-full mt-2 z-40 w-[320px] sm:w-[344px] bg-white border border-slate-200 rounded-2xl shadow-2xl p-4 space-y-3 animate-in fade-in">
                  <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-100">
                    <button
                      type="button"
                      onClick={() => shiftMonth(-1)}
                      className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-700 transition-colors"
                      title="Mês anterior"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>

                    {monthsWithRecords.length > 1 ? (
                      <select
                        value={`${year}-${String(month + 1).padStart(2, '0')}`}
                        onChange={(e) => {
                          const [y, m] = e.target.value.split('-').map(Number);
                          if (!isNaN(y) && !isNaN(m)) {
                            setCalendarMonth({ year: y, month: m - 1 });
                          }
                        }}
                        className="px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-900 focus:outline-none cursor-pointer"
                      >
                        {!monthsWithRecords.includes(
                          `${year}-${String(month + 1).padStart(2, '0')}`
                        ) && (
                          <option value={`${year}-${String(month + 1).padStart(2, '0')}`}>
                            {monthNames[month]} {year}
                          </option>
                        )}
                        {monthsWithRecords.map((ym) => {
                          const [y, m] = ym.split('-').map(Number);
                          return (
                            <option key={ym} value={ym}>
                              {monthNames[m - 1]} {y}
                            </option>
                          );
                        })}
                      </select>
                    ) : (
                      <span className="text-xs font-bold text-slate-900">
                        {monthNames[month]} {year}
                      </span>
                    )}

                    <button
                      type="button"
                      onClick={() => shiftMonth(1)}
                      className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-700 transition-colors"
                      title="Próximo mês"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-7 gap-1">
                    {weekDays.map((wd, i) => (
                      <div
                        key={`${wd}-${i}`}
                        className="text-center text-[10px] font-bold text-slate-400 font-mono py-0.5"
                      >
                        {wd}
                      </div>
                    ))}

                    {Array.from({ length: firstWeekDay }).map((_, idx) => (
                      <div key={`pop-empty-${idx}`} className="h-9" />
                    ))}

                    {Array.from({ length: daysInMonth }).map((_, idx) => {
                      const dayNum = idx + 1;
                      const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(
                        dayNum
                      ).padStart(2, '0')}`;
                      const dayInvs = inventoriesByDateMap.get(dateKey) || [];
                      const hasInventories = dayInvs.length > 0;
                      const isSelected = selectedCalendarDate === dateKey;
                      const isToday = dateKey === todayKey;
                      const productHint = dayInvs
                        .map((i) => normalizeProductType(i.flour_type))
                        .join(', ');

                      return (
                        <button
                          key={dateKey}
                          type="button"
                          onClick={() => {
                            setSubTab('bags');
                            handleSelectCalendarDate(dateKey);
                          }}
                          title={
                            hasInventories
                              ? `${formatDateDDMMYYYY(dateKey)}: ${dayInvs.length} inventário(s) (${productHint})`
                              : `${formatDateDDMMYYYY(dateKey)}: Sem inventários`
                          }
                          className={`h-9 rounded-lg border text-xs font-mono font-bold flex flex-col items-center justify-center transition-all cursor-pointer relative ${
                            isSelected
                              ? hasInventories
                                ? 'bg-emerald-700 border-emerald-800 text-white ring-2 ring-emerald-300'
                                : 'bg-slate-800 border-slate-900 text-white ring-2 ring-slate-300'
                              : hasInventories
                              ? 'bg-emerald-500 border-emerald-600 text-white hover:bg-emerald-600'
                              : isToday
                              ? 'bg-slate-100 border-slate-400 text-slate-900 hover:bg-slate-200'
                              : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          <span className="leading-none">{dayNum}</span>
                          {hasInventories && (
                            <span
                              className={`w-1.5 h-1.5 rounded-full mt-0.5 ${
                                isSelected ? 'bg-white' : 'bg-emerald-100'
                              }`}
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 text-[10px]">
                    <span className="inline-flex items-center gap-1.5 text-slate-600 font-medium">
                      <span className="w-2.5 h-2.5 rounded bg-emerald-500 inline-block" />
                      Dia com inventário salvo
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCalendarDate(null);
                        setSelectedInventoryId(null);
                        setFetchedDayInventories(null);
                        setFetchedDayBags(null);
                        setIsEditingHeader(false);
                        setIsCalendarPopoverOpen(false);
                      }}
                      className="text-emerald-700 hover:text-emerald-900 font-bold"
                    >
                      Ver Estoque Geral
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>

          <label
            htmlFor="daily-stock-excel-input"
            onClick={() => {
              setIsCalendarPopoverOpen(false);
              setSubTab('bags');
            }}
            className={`cursor-pointer px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm transition-colors ${
              loadingDailyStock ? 'opacity-60 pointer-events-none' : ''
            }`}
            title="Upload rápido da planilha de produção diária para somar diretamente ao estoque ativo"
          >
            {loadingDailyStock ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Upload className="w-4 h-4" />
            )}
            <span>{loadingDailyStock ? 'Incluindo Estoque...' : '+ Incluir Estoque'}</span>
          </label>

          <button
            type="button"
            onClick={handleOpenExportModal}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm transition-colors"
            title="Configurar e Exportar Relatório em PDF"
          >
            <Printer className="w-4 h-4" />
            <span>Exportar PDF</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setIsCalendarPopoverOpen(false);
              setSubTab('bags');
              handleStartNewInventory();
            }}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Novo Inventário</span>
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* SUB-TAB 1: LISTA DE BAGS (INVENTÁRIO) - MODO INTERATIVO EM TELA */}
      {/* ========================================================================= */}
      {subTab === 'bags' && (
        <div className="space-y-6 print:hidden">

          {/* Resumo da Última Entrada Diária de Estoque (+ Incluir Estoque) */}
          {dailyStockSummary && (
            <div className="bg-sky-50 border border-sky-200 rounded-2xl p-4 shadow-xs flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <CheckCircle2 className="w-5 h-5 text-sky-600 shrink-0 mt-0.5" />
                <div className="space-y-1 text-xs">
                  <div className="font-bold text-sky-950">
                    Entrada de Produção Diária Processada ({dailyStockSummary.fileName})
                  </div>
                  <div className="text-sky-900 font-mono">
                    {dailyStockSummary.addedCount > 0 ? (
                      <>
                        <strong>+{dailyStockSummary.addedCount} bag(s)</strong> (
                        <strong>{formatNumberBR(dailyStockSummary.totalAddedKg)} kg</strong>)
                        adicionados diretamente ao estoque ativo.
                      </>
                    ) : (
                      'Nenhum novo bag adicionado (todos os códigos já estavam em estoque).'
                    )}
                    {dailyStockSummary.skippedDuplicates > 0 &&
                      ` • ${dailyStockSummary.skippedDuplicates} duplicado(s) ignorado(s).`}
                  </div>
                  {dailyStockSummary.breakdown.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-0.5">
                      {dailyStockSummary.breakdown.map((item) => (
                        <span
                          key={item}
                          className="px-2 py-0.5 rounded-full bg-white border border-sky-200 text-[11px] font-mono font-semibold text-sky-900"
                        >
                          {item}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDailyStockSummary(null)}
                className="p-1 text-sky-600 hover:text-sky-900 rounded-lg hover:bg-sky-100"
                title="Fechar aviso"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Cards de Seleção do Dia Clicado no Calendário */}
          {selectedCalendarDate && !isCreatingNewInventory && (
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-emerald-600" />
                    <span>
                      Inventários do dia {formatDateDDMMYYYY(selectedCalendarDate)} (
                      {selectedDateInventories.length})
                    </span>
                    {loadingCalendarDay && (
                      <RefreshCw className="w-3.5 h-3.5 text-emerald-600 animate-spin" />
                    )}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {selectedDateInventories.length > 1
                      ? 'Mais de um produto inventariado nesta data. Selecione um card abaixo para abrir sua lista.'
                      : selectedDateInventories.length === 1
                      ? 'Inventário carregado diretamente do Supabase.'
                      : 'Nenhum inventário encontrado no Supabase para esta data.'}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleStartNewInventory(selectedCalendarDate)}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Novo Inventário neste Dia</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCalendarDate(null);
                      setSelectedInventoryId(null);
                      setFetchedDayInventories(null);
                      setFetchedDayBags(null);
                      setIsEditingHeader(false);
                    }}
                    className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold flex items-center gap-1 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>Limpar Seleção</span>
                  </button>
                </div>
              </div>

              {loadingCalendarDay ? (
                <div className="p-6 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
                  <RefreshCw className="w-4 h-4 text-emerald-600 animate-spin" />
                  <span>Buscando inventários de {formatDateDDMMYYYY(selectedCalendarDate)} no Supabase...</span>
                </div>
              ) : selectedDateInventories.length === 0 ? (
                <div className="p-6 text-center rounded-xl border border-dashed border-slate-300 bg-slate-50 space-y-2">
                  <p className="text-xs text-slate-600">
                    Não há inventários registrados em{' '}
                    <strong>{formatDateDDMMYYYY(selectedCalendarDate)}</strong>.
                  </p>
                  <button
                    type="button"
                    onClick={() => handleStartNewInventory(selectedCalendarDate)}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Criar Inventário para {formatDateDDMMYYYY(selectedCalendarDate)}</span>
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {selectedDateInventories.map((inv) => {
                    const isActive = selectedInventoryId === String(inv.id);
                    const sourceBags = fetchedDayBags !== null ? fetchedDayBags : inventoryBags;
                    const invBagsList = sourceBags.filter(
                      (b) => String(b.inventory_id) === String(inv.id)
                    );
                    const invBagCount = invBagsList.length;
                    const invTotalKg = invBagsList.reduce(
                      (s, b) => s + Number(b.weight_kg || 0),
                      0
                    );
                    const invTotalLiters = invBagsList.reduce(
                      (s, b) => s + Number(b.volume_liters || 0),
                      0
                    );
                    const normalizedType = normalizeProductType(inv.flour_type);
                    const isOilInv = isOilProductType(inv.flour_type);

                    return (
                      <div
                        key={inv.id}
                        onClick={() => {
                          setSelectedInventoryId(String(inv.id));
                          setIsEditingHeader(false);
                          setShowManualBagForm(false);
                          setTimeout(() => {
                            bagsListSectionRef.current?.scrollIntoView({
                              behavior: 'smooth',
                              block: 'start',
                            });
                          }, 60);
                        }}
                        className={`cursor-pointer p-4 rounded-xl border transition-all flex items-center justify-between gap-3 ${
                          isActive
                            ? 'bg-emerald-50/90 border-emerald-500 ring-1 ring-emerald-400 shadow-xs'
                            : 'bg-white border-slate-200 hover:border-emerald-300 hover:bg-slate-50'
                        }`}
                      >
                        <div className="min-w-0 space-y-1.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold font-mono border ${getProductBadgeClasses(
                                inv.flour_type
                              )}`}
                            >
                              {normalizedType}
                            </span>
                            <span className="text-xs font-bold font-mono text-slate-900">
                              {(inv.inventory_time || '').slice(0, 5)}
                            </span>
                          </div>
                          <div className="text-xs text-slate-600 truncate">
                            Participantes: <span className="font-medium text-slate-800">{inv.participants}</span>
                          </div>
                          <div className="text-[11px] font-mono font-bold text-slate-800">
                            {invBagCount} {isOilInv ? 'tanque(s)/lote(s)' : 'bag(s)'} &bull;{' '}
                            {formatNumberBR(invTotalKg)} kg
                            {isOilInv && (
                              <span className="text-amber-700">
                                {' '}
                                / {formatNumberBR(invTotalLiters)} L
                              </span>
                            )}
                          </div>
                        </div>

                        <div
                          className="flex items-center gap-1 shrink-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() => handleSelectAndEditInventory(inv)}
                            className="p-2 text-slate-500 hover:text-emerald-700 rounded-lg hover:bg-emerald-50 transition-colors"
                            title="Editar Cabeçalho / Importar"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setInventoryPendingDelete(inv)}
                            className="p-2 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition-colors"
                            title="Excluir Inventário"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Header Form + Import / Oil Blocks (Completamente ocultos por padrão ao visualizar inventário salvo; exibidos ao criar novo ou clicar em "Editar Cabeçalho") */}
          {(isCreatingNewInventory || (selectedInventoryId && isEditingHeader)) && (
            <div ref={headerEditorRef} className="space-y-6 scroll-mt-4">
              <form
                onSubmit={handleSaveInventoryHeader}
                className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-emerald-700 font-mono">
                    {selectedInventoryId
                      ? 'Editando Inventário Existente'
                      : 'Novo Inventário de Estoque'}
                  </span>
                </div>
                <h2 className="text-lg font-black text-slate-900 tracking-tight">
                  Dados do Inventário &amp; Participantes
                </h2>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (selectedInventory) {
                      setFlourType(normalizeProductType(selectedInventory.flour_type));
                      setInventoryDate(selectedInventory.inventory_date.split('T')[0]);
                      setInventoryTime((selectedInventory.inventory_time || '00:00').slice(0, 5));
                      setParticipants(selectedInventory.participants || '');
                    }
                    setIsCreatingNewInventory(false);
                    setIsEditingHeader(false);
                  }}
                  className="px-3.5 py-2 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 rounded-xl text-xs font-semibold"
                >
                  Cancelar
                </button>
                    <button
                      type="submit"
                      disabled={isSavingInventory}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm disabled:opacity-50"
                    >
                      {isSavingInventory ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Save className="w-3.5 h-3.5" />
                      )}
                      <span>
                        {selectedInventoryId
                          ? 'Atualizar Inventário'
                          : 'Salvar Inventário no Supabase'}
                      </span>
                    </button>
              </div>
            </div>

            {(isCreatingNewInventory || isEditingHeader) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Produto *
                  </label>
                  <select
                    value={normalizeProductType(flourType)}
                    onChange={(e) => {
                      const nextType = e.target.value as FlourType;
                      setFlourType(nextType);
                      if (isOilProductType(nextType)) {
                        setOilTankRows(
                          createDefaultOilTankRows(
                            normalizeProductType(nextType),
                            inventoryDate
                          )
                        );
                      }
                    }}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs text-slate-900 font-bold focus:border-emerald-500 focus:outline-none cursor-pointer"
                  >
                    {INVENTORY_PRODUCTS.map((prod) => (
                      <option key={prod} value={prod}>
                        {prod}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Data do Inventário *
                  </label>
                  <input
                    type="date"
                    value={inventoryDate}
                    onChange={(e) => setInventoryDate(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs text-slate-900 font-mono font-semibold focus:border-emerald-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Horário do Inventário *
                  </label>
                  <input
                    type="time"
                    value={inventoryTime}
                    onChange={(e) => setInventoryTime(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs text-slate-900 font-mono font-semibold focus:border-emerald-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Pessoas que Participaram *
                  </label>
                  <input
                    type="text"
                    value={participants}
                    onChange={(e) => setParticipants(e.target.value)}
                    placeholder="Ex.: João Silva, Maria Oliveira"
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs text-slate-900 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </div>
            )}
          </form>

          {/* Oil Dual-Control Multi-Tank Form (KG + Liters + Lab Params) when Óleo de Aves or Óleo Graxo is selected */}
          {isOilProductType(flourType) ? (
            <form
              onSubmit={handleSaveOilTanks}
              className="bg-white border border-amber-200 rounded-2xl p-5 shadow-sm space-y-4"
            >
              {oilSchemaNeedsSql && (
                <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 space-y-2.5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5">
                      <Database className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
                      <div>
                        <h4 className="text-xs font-bold text-amber-950">
                          Atualização de Schema Necessária no Supabase para Óleos (KG + Litros)
                        </h4>
                        <p className="text-[11px] text-amber-900 mt-0.5">
                          Execute o comando abaixo no <strong>SQL Editor</strong> do Supabase para criar a coluna{' '}
                          <code className="font-mono font-bold">volume_liters</code> e liberar os tipos{' '}
                          <code className="font-mono font-bold">Óleo de Aves</code> e{' '}
                          <code className="font-mono font-bold">Óleo Graxo</code>.
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleCopyOilSchemaSql}
                        className="px-2.5 py-1 bg-white hover:bg-amber-100 border border-amber-300 text-amber-900 rounded-lg text-[11px] font-bold flex items-center gap-1"
                      >
                        <Copy className="w-3 h-3" />
                        <span>Copiar SQL</span>
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const { error } = await supabase
                            .from('ffg_inventory_bags')
                            .select('volume_liters')
                            .limit(1);
                          if (!error) {
                            setOilSchemaNeedsSql(false);
                            showToast('success', 'Schema Verificado', 'Coluna volume_liters pronta no Supabase!');
                          } else {
                            showToast('warning', 'Ainda Pendente', 'Execute o SQL no Supabase antes de verificar novamente.');
                          }
                        }}
                        className="px-2.5 py-1 bg-amber-700 hover:bg-amber-800 text-white rounded-lg text-[11px] font-bold flex items-center gap-1"
                      >
                        <RefreshCw className="w-3 h-3" />
                        <span>Já Executei (Verificar)</span>
                      </button>
                    </div>
                  </div>
                  <pre className="p-2.5 bg-slate-900 text-emerald-300 rounded-lg text-[11px] font-mono overflow-x-auto leading-relaxed">
                    {OIL_SCHEMA_SQL}
                  </pre>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600">
                    <Droplets className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      Apontamento de Tanques de Óleo (Controle Duplo: KG e Litros) &bull;{' '}
                      {normalizeProductType(flourType)}
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      {normalizeProductType(flourType) === 'Óleo Graxo'
                        ? 'Padrão inicial com 2 tanques principais. Adicione ou remova tanques dinamicamente conforme a leitura do dia.'
                        : 'Estrutura dinâmica para 4 a 5+ tanques de Óleo de Aves. Preencha os tanques ativos e salve em lote.'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-[10px] px-2.5 py-1 rounded-full font-bold font-mono border ${getProductBadgeClasses(
                      flourType
                    )}`}
                  >
                    {normalizeProductType(flourType)}
                  </span>
                  <button
                    type="button"
                    onClick={handleAddOilTankRow}
                    className="px-3.5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    <span>+ Adicionar Tanque / Lote</span>
                  </button>
                </div>
              </div>

              {oilTankRows.length === 0 ? (
                <div className="p-6 text-center border border-dashed border-amber-300 rounded-xl bg-amber-50/30 space-y-2">
                  <p className="text-xs text-slate-600">
                    Nenhum tanque na lista atual. Clique no botão abaixo para adicionar um tanque.
                  </p>
                  <button
                    type="button"
                    onClick={handleAddOilTankRow}
                    className="px-3.5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>+ Adicionar Tanque / Lote</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {oilTankRows.map((row, idx) => (
                    <div
                      key={row.rowId}
                      className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-3"
                    >
                      <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-200/80">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-amber-800 font-mono">
                          Linha #{idx + 1} &bull; {row.lot_tank.trim() || 'Novo Tanque / Lote'}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRemoveOilTankRow(row.rowId)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors flex items-center gap-1 text-[11px] font-semibold"
                          title="Remover este tanque"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">Remover</span>
                        </button>
                      </div>

                      {/* Primary Tank Fields: Identification, Date, KG, Liters, Barcode */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                            Identificação do Tanque *
                          </label>
                          <input
                            type="text"
                            value={row.lot_tank}
                            onChange={(e) =>
                              handleUpdateOilTankRow(row.rowId, { lot_tank: e.target.value })
                            }
                            placeholder={`Ex.: Tanque ${String(idx + 1).padStart(2, '0')}`}
                            className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs text-slate-900 font-mono font-bold focus:border-amber-500 focus:outline-none"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                            Data (Produção / Apont.) *
                          </label>
                          <input
                            type="date"
                            value={row.production_date}
                            onChange={(e) =>
                              handleUpdateOilTankRow(row.rowId, {
                                production_date: e.target.value,
                              })
                            }
                            className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs text-slate-900 font-mono font-semibold focus:border-amber-500 focus:outline-none"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                            Estoque KG (Quilos) *
                          </label>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={row.weight_kg}
                            onChange={(e) =>
                              handleUpdateOilTankRow(row.rowId, { weight_kg: e.target.value })
                            }
                            placeholder="Ex.: 18500,00"
                            className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs text-slate-900 font-mono font-bold focus:border-amber-500 focus:outline-none"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                            Estoque L (Litros) *
                          </label>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={row.volume_liters}
                            onChange={(e) =>
                              handleUpdateOilTankRow(row.rowId, { volume_liters: e.target.value })
                            }
                            placeholder="Ex.: 20108,70"
                            className="w-full px-3 py-2 bg-white border border-amber-300 rounded-xl text-xs text-amber-900 font-mono font-bold focus:border-amber-500 focus:outline-none"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                            Cód. Rastreio (Opcional)
                          </label>
                          <input
                            type="text"
                            value={row.barcode}
                            onChange={(e) =>
                              handleUpdateOilTankRow(row.rowId, { barcode: e.target.value })
                            }
                            placeholder="Automático se vazio"
                            className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs text-slate-900 font-mono focus:border-amber-500 focus:outline-none"
                          />
                        </div>
                      </div>

                      {/* Quality Parameters for this Tank */}
                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 pt-1">
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-600 mb-1">
                            Acidez (%)
                          </label>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={row.quality_acidity}
                            onChange={(e) =>
                              handleUpdateOilTankRow(row.rowId, {
                                quality_acidity: e.target.value,
                              })
                            }
                            placeholder="Ex.: 1,45"
                            className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 font-mono"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-600 mb-1">
                            Umidade (%)
                          </label>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={row.quality_moisture}
                            onChange={(e) =>
                              handleUpdateOilTankRow(row.rowId, {
                                quality_moisture: e.target.value,
                              })
                            }
                            placeholder="Ex.: 0,35"
                            className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 font-mono"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-600 mb-1">
                            Índ. Peróxido
                          </label>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={row.quality_peroxide}
                            onChange={(e) =>
                              handleUpdateOilTankRow(row.rowId, {
                                quality_peroxide: e.target.value,
                              })
                            }
                            placeholder="Ex.: 2,10"
                            className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 font-mono"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-600 mb-1">
                            Impurezas / Ext. Et. (%)
                          </label>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={row.quality_ether_extract}
                            onChange={(e) =>
                              handleUpdateOilTankRow(row.rowId, {
                                quality_ether_extract: e.target.value,
                              })
                            }
                            placeholder="Ex.: 0,20"
                            className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 font-mono"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-600 mb-1">
                            Classificação
                          </label>
                          <select
                            value={row.quality_classification}
                            onChange={(e) =>
                              handleUpdateOilTankRow(row.rowId, {
                                quality_classification: e.target.value,
                              })
                            }
                            className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 font-mono font-bold cursor-pointer"
                          >
                            <option value="">Sem Laudo</option>
                            <option value="APROVADO">APROVADO</option>
                            <option value="STANDARD">STANDARD</option>
                            <option value="COMERCIAL">COMERCIAL</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Live Consolidated Summary & Submit Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-200">
                <div className="flex flex-wrap items-center gap-3 text-xs font-mono">
                  <span className="px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 font-bold">
                    Consolidado dos Tanques ({oilFormTotals.filledCount} preenchido(s)):
                  </span>
                  <span className="font-black text-slate-900">
                    {formatNumberBR(oilFormTotals.totalKg)} kg
                  </span>
                  <span className="text-slate-400">|</span>
                  <span className="font-black text-amber-700">
                    {formatNumberBR(oilFormTotals.totalLiters)} L
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleAddOilTankRow}
                    className="px-3.5 py-2 bg-white hover:bg-amber-50 border border-amber-300 text-amber-800 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>+ Adicionar Tanque / Lote</span>
                  </button>

                  <button
                    type="submit"
                    disabled={isAddingOilEntry || oilTankRows.length === 0}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm disabled:opacity-50"
                  >
                    {isAddingOilEntry ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Save className="w-3.5 h-3.5" />
                    )}
                    <span>
                      {selectedInventoryId
                        ? 'Registrar Tanques no Supabase'
                        : 'Salvar Inventário & Tanques no Supabase'}
                    </span>
                  </button>
                </div>
              </div>
            </form>
          ) : (
            /* Import Excel + Quality Excel + Manual Bag Entry (for Farinhas) */
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Card A: Importação de Planilha de Bags (.xlsx / .xls / .csv) */}
              <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
                      <FileSpreadsheet className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">
                        1. Importar Planilha de Bags (.xlsx / .xls / .csv)
                      </h3>
                      <p className="text-[11px] text-slate-500">
                        Lê as 9 colunas padrão (Código, Descrição, Cód. Bag, Datas, Hora, Período, Peso e Cód. Barras)
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <input
                    type="file"
                    ref={excelInputRef}
                    accept=".xlsx,.xls,.csv"
                    onChange={handleExcelFileChange}
                    className="hidden"
                    id="inventory-excel-input"
                  />
                  <label
                    htmlFor="inventory-excel-input"
                    className="cursor-pointer px-4 py-2.5 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 text-emerald-800 rounded-xl text-xs font-bold flex items-center gap-2 transition-colors shadow-2xs"
                  >
                    {loadingExcel ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Upload className="w-4 h-4" />
                    )}
                    <span>
                      {loadingExcel
                        ? 'Importando Planilha...'
                        : 'Importar Excel / CSV de Bags'}
                    </span>
                  </label>

                  <button
                    type="button"
                    onClick={() => setShowManualBagForm((prev) => !prev)}
                    className="px-4 py-2.5 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors"
                  >
                    <Plus className="w-4 h-4 text-emerald-600" />
                    <span>{showManualBagForm ? 'Ocultar Cadastro Manual' : 'Adicionar Bag Manual'}</span>
                  </button>
                </div>
              </div>

              {/* Card B: Importar Laudos de Qualidade (Excel/CSV) */}
              <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600">
                      <FlaskConical className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">
                        2. Importar Laudos de Qualidade (Excel/CSV)
                      </h3>
                      <p className="text-[11px] text-slate-500">
                        Cruza o N° CODIGO DE BARRAS da planilha consolidada com o estoque e grava os laudos
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <label
                    htmlFor="inventory-quality-excel-input"
                    className="cursor-pointer px-4 py-2.5 bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-800 rounded-xl text-xs font-bold flex items-center gap-2 transition-colors shadow-2xs"
                  >
                    {loadingQualityExcel ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Upload className="w-4 h-4" />
                    )}
                    <span>
                      {loadingQualityExcel
                        ? 'Importando Laudos...'
                        : 'Importar Laudos de Qualidade (Excel/CSV)'}
                    </span>
                  </label>
                </div>

                {qualityImportSummary && (
                  <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs space-y-1">
                    <div className="flex items-center justify-between gap-2 font-semibold text-emerald-900">
                      <span className="flex items-center gap-1.5 truncate">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                        {qualityImportSummary.matchedCount} laudos vinculados com sucesso.{' '}
                        {qualityImportSummary.notFoundCount} códigos não encontrados no estoque atual.
                      </span>
                    </div>
                    <div className="text-[11px] text-emerald-800 font-mono">
                      Arquivo: {qualityImportSummary.fileName} ({qualityImportSummary.totalRows} linha(s) lida(s))
                    </div>
                    {qualityImportSummary.unmatchedBarcodes.length > 0 && (
                      <p className="text-[10px] text-slate-600 font-mono">
                        Códigos não encontrados: {qualityImportSummary.unmatchedBarcodes.slice(0, 6).join(', ')}
                        {qualityImportSummary.unmatchedBarcodes.length > 6 ? '...' : ''}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
            </div>
          )}

          {/* Manual Quick Bag Entry Form */}
          {!isOilProductType(flourType) && showManualBagForm && (
            <form
              onSubmit={handleAddManualBag}
              className="bg-white border border-emerald-200 rounded-2xl p-5 shadow-sm space-y-4"
            >
              <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                <h3 className="text-sm font-bold text-slate-900">
                  Cadastro Manual de Bag (9 Colunas Padrão)
                </h3>
                <button
                  type="button"
                  onClick={() => setShowManualBagForm(false)}
                  className="text-slate-400 hover:text-slate-700 p-1"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Código (Produto) *
                  </label>
                  <input
                    type="text"
                    value={manualBag.product_code}
                    onChange={(e) =>
                      setManualBag((p) => ({ ...p, product_code: e.target.value }))
                    }
                    placeholder="Ex.: 757"
                    className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 font-mono"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Descrição *
                  </label>
                  <input
                    type="text"
                    value={manualBag.product_description}
                    onChange={(e) =>
                      setManualBag((p) => ({ ...p, product_description: e.target.value }))
                    }
                    placeholder="Ex.: FARINHA DE VISCERAS DE AVES"
                    className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Cód. Bag *
                  </label>
                  <input
                    type="text"
                    value={manualBag.bag_code}
                    onChange={(e) =>
                      setManualBag((p) => ({ ...p, bag_code: e.target.value }))
                    }
                    placeholder="Ex.: 15939"
                    className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Data Produção *
                  </label>
                  <input
                    type="date"
                    value={manualBag.production_date}
                    onChange={(e) =>
                      setManualBag((p) => ({ ...p, production_date: e.target.value }))
                    }
                    className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Data Apontamento *
                  </label>
                  <input
                    type="date"
                    value={manualBag.posting_date}
                    onChange={(e) =>
                      setManualBag((p) => ({ ...p, posting_date: e.target.value }))
                    }
                    className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Hora Apont. *
                  </label>
                  <input
                    type="time"
                    value={manualBag.posting_time}
                    onChange={(e) =>
                      setManualBag((p) => ({ ...p, posting_time: e.target.value }))
                    }
                    className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Período *
                  </label>
                  <select
                    value={manualBag.period}
                    onChange={(e) =>
                      setManualBag((p) => ({ ...p, period: e.target.value }))
                    }
                    className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 font-mono"
                  >
                    <option value="A">A</option>
                    <option value="B">B</option>
                    <option value="C">C</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Peso (kg) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={manualBag.weight_kg || ''}
                    onChange={(e) =>
                      setManualBag((p) => ({
                        ...p,
                        weight_kg: parseFloat(e.target.value) || 0,
                      }))
                    }
                    placeholder="1197.50"
                    className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 font-mono font-bold"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Código de Barra *
                  </label>
                  <input
                    type="text"
                    value={manualBag.barcode}
                    onChange={(e) =>
                      setManualBag((p) => ({ ...p, barcode: e.target.value }))
                    }
                    placeholder="Ex.: 7570000159396"
                    className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 font-mono"
                  />
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Adicionar Bag</span>
                </button>
              </div>
            </form>
          )}

          {/* Tabela: Lista de Bags (Consulta Geral de Estoque ou Inventário Selecionado) */}
          <div
            ref={bagsListSectionRef}
            className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4 scroll-mt-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200">
              <div>
                <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                  <Scale className="w-5 h-5 text-emerald-600" />
                  {selectedInventory
                    ? isOilProductType(flourType)
                      ? 'Lista de Lotes / Tanques'
                      : 'Lista de Bags'
                    : isCreatingNewInventory
                    ? isOilProductType(flourType)
                      ? 'Lista de Lotes / Tanques (Rascunho)'
                      : 'Lista de Bags (Rascunho)'
                    : 'Consulta Geral de Estoque (Bags e Tanques)'}{' '}
                  ({filteredActiveBags.length}
                  {filteredActiveBags.length !== activeInventoryBags.length
                    ? ` de ${activeInventoryBags.length}`
                    : ''}
                  )
                </h3>
                <p className="text-xs text-slate-500">
                  {selectedInventory
                    ? `Inventário de ${formatDateDDMMYYYY(selectedInventory.inventory_date)} (${normalizeProductType(selectedInventory.flour_type)}) • Participantes: ${selectedInventory.participants}`
                    : isCreatingNewInventory
                    ? 'Itens no rascunho do novo inventário (clique em "Salvar Inventário no Supabase" para gravar)'
                    : selectedCalendarDate
                    ? `Exibindo itens do dia ${formatDateDDMMYYYY(selectedCalendarDate)} — clique em um card acima para filtrar por produto ou use os filtros abaixo`
                    : 'Visualizando todos os itens registrados em estoque — use os filtros rápidos abaixo ou selecione uma data no calendário'}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 print:hidden">
                {selectedInventoryId && !isEditingHeader && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsEditingHeader(true);
                      setTimeout(() => {
                        headerEditorRef.current?.scrollIntoView({
                          behavior: 'smooth',
                          block: 'start',
                        });
                      }, 60);
                    }}
                    className="px-3.5 py-2 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-2xs transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Editar Cabeçalho</span>
                  </button>
                )}
                {(bagProductFilter !== 'Todos' ||
                  bagSearch.trim() !== '' ||
                  bagClassFilter !== 'Todos' ||
                  bagBlockFilter !== 'Todos') && (
                  <button
                    type="button"
                    onClick={() => {
                      setBagProductFilter('Todos');
                      setBagSearch('');
                      setBagClassFilter('Todos');
                      setBagBlockFilter('Todos');
                    }}
                    className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>Limpar Filtros</span>
                  </button>
                )}
              </div>
            </div>

            {/* Barra de Filtros e Busca (Ordem: Produto -> Classificação -> Status -> Busca) */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200 print:hidden">
              <div className="md:col-span-3">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 font-mono mb-1 flex items-center gap-1">
                  <Package className="w-3 h-3" />
                  Produto
                </label>
                <select
                  value={bagProductFilter}
                  onChange={(e) => setBagProductFilter(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 font-semibold focus:border-emerald-500 focus:outline-none cursor-pointer"
                >
                  <option value="Todos">Todos</option>
                  {INVENTORY_PRODUCTS.map((prod) => (
                    <option key={prod} value={prod}>
                      {prod}
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-3">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 font-mono mb-1 flex items-center gap-1">
                  <Filter className="w-3 h-3" />
                  Classificação
                </label>
                <select
                  value={bagClassFilter}
                  onChange={(e) => setBagClassFilter(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 font-semibold focus:border-emerald-500 focus:outline-none cursor-pointer"
                >
                  <option value="Todos">Todos</option>
                  <option value="STANDARD">Standard</option>
                  <option value="COMERCIAL">Comercial</option>
                  <option value="Com Laudo">Com Laudo</option>
                  <option value="Sem Laudo">Sem Laudo</option>
                </select>
              </div>

              <div className="md:col-span-2">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 font-mono mb-1 flex items-center gap-1">
                  <Ban className="w-3 h-3" />
                  Status
                </label>
                <select
                  value={bagBlockFilter}
                  onChange={(e) =>
                    setBagBlockFilter(
                      e.target.value as 'Todos' | 'Ativos' | 'Bloqueados' | 'Expedidos'
                    )
                  }
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 font-semibold focus:border-emerald-500 focus:outline-none cursor-pointer"
                >
                  <option value="Todos">Todos</option>
                  <option value="Ativos">Ativos</option>
                  <option value="Bloqueados">Bloqueados</option>
                  <option value="Expedidos">Expedidos</option>
                </select>
              </div>

              <div className="md:col-span-4">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 font-mono mb-1">
                  Buscar por Código de Barras ou Cód. Bag
                </label>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={bagSearch}
                    onChange={(e) => setBagSearch(e.target.value)}
                    placeholder="Ex.: 6980000043228 ou 4322..."
                    className="w-full pl-8 pr-8 py-2 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 font-mono focus:border-emerald-500 focus:outline-none"
                  />
                  {bagSearch && (
                    <button
                      type="button"
                      onClick={() => setBagSearch('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                      title="Limpar busca"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-center text-xs">
                <thead className="bg-slate-100 text-slate-700 uppercase tracking-wider border-b border-slate-200 font-mono">
                  <tr>
                    <th className="px-3 py-2.5 text-center">Código</th>
                    <th className="px-3 py-2.5 text-center">Descrição</th>
                    <th className="px-3 py-2.5 text-center">Cód. Bag / Lote</th>
                    <th className="px-3 py-2.5 text-center">Data Produção</th>
                    <th className="px-3 py-2.5 text-center">Data Apontamento</th>
                    <th className="px-3 py-2.5 text-center">Hora Apont.</th>
                    <th className="px-3 py-2.5 text-center">Período</th>
                    <th className="px-3 py-2.5 text-center">Peso (kg) / Vol. (L)</th>
                    <th className="px-3 py-2.5 text-center">Código de Barra</th>
                    <th className="px-3 py-2.5 text-center print:hidden">Qualidade / Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 font-mono text-slate-800">
                  {filteredActiveBags.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-4 py-10 text-center text-slate-500 font-sans">
                        {activeInventoryBags.length === 0
                          ? 'Nenhum bag cadastrado neste inventário. Importe uma planilha Excel/CSV ou adicione manualmente acima.'
                          : 'Nenhum bag encontrado com os filtros aplicados.'}
                      </td>
                    </tr>
                  ) : (
                    filteredActiveBags.map((bag, idx) => {
                      const isBlocked = Boolean(bag.is_blocked);
                      const isDispatched = Boolean(bag.is_dispatched);
                      const originalIndex = activeInventoryBags.indexOf(bag);
                      const draftIdx = originalIndex >= 0 ? originalIndex : idx;
                      const rowKey = bag.id !== undefined ? String(bag.id) : `draft-${draftIdx}`;
                      return (
                        <tr
                          key={bag.id ?? `draft-${draftIdx}`}
                          className={`transition-colors ${
                            isBlocked
                              ? 'bg-red-50 hover:bg-red-100/70'
                              : isDispatched
                              ? 'bg-slate-100/70 hover:bg-slate-100'
                              : 'hover:bg-slate-50'
                          }`}
                        >
                          <td
                            className={`px-3 py-2.5 text-center font-semibold text-slate-900 ${
                              isBlocked || isDispatched ? 'opacity-70' : ''
                            }`}
                          >
                            {bag.product_code}
                          </td>
                          <td
                            className={`px-3 py-2.5 text-center font-sans text-slate-800 max-w-[220px] truncate ${
                              isBlocked || isDispatched ? 'opacity-70' : ''
                            }`}
                          >
                            {bag.product_description}
                          </td>
                          <td
                            className={`px-3 py-2.5 text-center font-bold text-slate-900 ${
                              isBlocked || isDispatched ? 'opacity-70' : ''
                            }`}
                          >
                            {bag.bag_code}
                          </td>
                          <td
                            className={`px-3 py-2.5 text-center whitespace-nowrap ${
                              isBlocked || isDispatched ? 'opacity-70' : ''
                            }`}
                          >
                            {formatDateDDMMYYYY(bag.production_date)}
                          </td>
                          <td
                            className={`px-3 py-2.5 text-center whitespace-nowrap ${
                              isBlocked || isDispatched ? 'opacity-70' : ''
                            }`}
                          >
                            {formatDateDDMMYYYY(bag.posting_date)}
                          </td>
                          <td
                            className={`px-3 py-2.5 text-center whitespace-nowrap ${
                              isBlocked || isDispatched ? 'opacity-70' : ''
                            }`}
                          >
                            {(bag.posting_time || '').slice(0, 5)}
                          </td>
                          <td
                            className={`px-3 py-2.5 text-center font-bold ${
                              isBlocked || isDispatched ? 'opacity-70' : ''
                            }`}
                          >
                            <span className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700 text-[10px]">
                              {bag.period}
                            </span>
                          </td>
                          <td
                            className={`px-3 py-2.5 text-center font-bold text-emerald-700 whitespace-nowrap ${
                              isBlocked || isDispatched ? 'opacity-70' : ''
                            }`}
                          >
                            <div>{formatNumberBR(bag.weight_kg)} kg</div>
                            {(isOilBagEntry(bag, inventoryMap) ||
                              (bag.volume_liters !== null && bag.volume_liters !== undefined)) && (
                              <div className="text-[11px] font-bold text-amber-700">
                                {bag.volume_liters !== null && bag.volume_liters !== undefined
                                  ? `${formatNumberBR(bag.volume_liters)} L`
                                  : '— L'}
                              </div>
                            )}
                          </td>
                          <td
                            className={`px-3 py-2.5 text-center font-semibold text-slate-900 whitespace-nowrap ${
                              isBlocked || isDispatched ? 'opacity-70' : ''
                            }`}
                          >
                            {bag.barcode}
                          </td>
                          <td className="px-3 py-2.5 text-center whitespace-nowrap print:hidden">
                            <div className="flex items-center justify-center gap-1.5">
                              {isDispatched && (
                                <span
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold font-mono bg-indigo-100 text-indigo-800 border border-indigo-200"
                                  title="Bag já expedido/baixado do estoque ativo"
                                >
                                  <Truck className="w-2.5 h-2.5" />
                                  Expedido
                                </span>
                              )}
                              {renderClassificationBadge(bag.quality_classification, bag)}
                              <button
                                type="button"
                                onClick={() => setInfoModalBag(bag)}
                                className="p-1 text-sky-600 hover:text-sky-800 rounded hover:bg-sky-50 transition-colors"
                                title="Ver Indicadores Laboratoriais"
                              >
                                <Info className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingBag({ ...bag });
                                  setEditingBagIndex(bag.id === undefined ? draftIdx : null);
                                }}
                                className="p-1 text-slate-500 hover:text-emerald-700 rounded hover:bg-emerald-50 transition-colors"
                                title="Editar Bag"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  handleToggleBlockBag(
                                    bag,
                                    bag.id === undefined ? draftIdx : undefined
                                  )
                                }
                                disabled={togglingBlockBagKey === rowKey}
                                className={`p-1 rounded transition-colors disabled:opacity-50 ${
                                  isBlocked
                                    ? 'text-red-500 hover:text-red-700 bg-red-100/80 hover:bg-red-200/80'
                                    : 'text-slate-400 hover:text-red-600 hover:bg-red-50'
                                }`}
                                title={isBlocked ? 'Desbloquear Bag' : 'Bloquear Bag'}
                              >
                                <Ban className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setBagPendingDelete({
                                    bag,
                                    draftIndex: bag.id === undefined ? draftIdx : undefined,
                                  })
                                }
                                className="p-1 text-slate-400 hover:text-rose-600 rounded hover:bg-rose-50 transition-colors"
                                title="Excluir Bag"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
                {filteredActiveBags.length > 0 && (() => {
                  const totalFilteredKg = filteredActiveBags.reduce(
                    (sum, b) => sum + Number(b.weight_kg || 0),
                    0
                  );
                  const totalFilteredLiters = filteredActiveBags.reduce(
                    (sum, b) => sum + Number(b.volume_liters || 0),
                    0
                  );
                  const hasAnyOil =
                    isOilProductType(flourType) ||
                    filteredActiveBags.some(
                      (b) =>
                        isOilBagEntry(b, inventoryMap) ||
                        (b.volume_liters !== null && b.volume_liters !== undefined)
                    );
                  return (
                    <tfoot className="bg-slate-100 border-t-2 border-slate-300 font-mono text-slate-900">
                      <tr>
                        <td colSpan={7} className="px-3 py-2.5 text-center font-bold">
                          TOTAL CONSOLIDADO ({filteredActiveBags.length}{' '}
                          {hasAnyOil ? 'tanque(s) / registro(s)' : 'bag(s)'})
                        </td>
                        <td className="px-3 py-2.5 text-center font-black whitespace-nowrap">
                          <div className="text-emerald-700">
                            {formatNumberBR(totalFilteredKg)} kg
                          </div>
                          {hasAnyOil && (
                            <div className="text-amber-700 text-[11px]">
                              {formatNumberBR(totalFilteredLiters)} L
                            </div>
                          )}
                        </td>
                        <td colSpan={2} className="px-3 py-2.5 text-center text-slate-500">
                          —
                        </td>
                      </tr>
                    </tfoot>
                  );
                })()}
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SUB-TAB 2: QUALIDADE DO ESTOQUE */}
      {/* ========================================================================= */}
      {subTab === 'quality' && (
        <div className="space-y-6 print:hidden">

          {/* Quality Distribution Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white border border-emerald-200 rounded-2xl p-4 shadow-sm">
              <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 font-mono">
                % Standard
              </div>
              <div className="mt-1.5 flex items-baseline gap-2">
                <span className="text-3xl font-black font-mono text-emerald-700">
                  {qualityMetrics.standardPct.toFixed(1)}%
                </span>
                <span className="text-xs text-slate-500 font-mono">
                  ({qualityMetrics.standardCount} bags)
                </span>
              </div>
            </div>

            <div className="bg-white border border-rose-200 rounded-2xl p-4 shadow-sm">
              <div className="text-[10px] font-bold uppercase tracking-wider text-rose-700 font-mono">
                % Comercial
              </div>
              <div className="mt-1.5 flex items-baseline gap-2">
                <span className="text-3xl font-black font-mono text-rose-700">
                  {qualityMetrics.comercialPct.toFixed(1)}%
                </span>
                <span className="text-xs text-slate-500 font-mono">
                  ({qualityMetrics.comercialCount} bags)
                </span>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600 font-mono">
                % Aguardando Análise
              </div>
              <div className="mt-1.5 flex items-baseline gap-2">
                <span className="text-3xl font-black font-mono text-slate-700">
                  {qualityMetrics.pendingPct.toFixed(1)}%
                </span>
                <span className="text-xs text-slate-500 font-mono">
                  ({qualityMetrics.pendingCount} bags)
                </span>
              </div>
            </div>
          </div>

          {/* Chemical Parameter Averages */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600 font-mono">
                Proteína Bruta Média
              </div>
              <div className="mt-1.5 text-2xl font-black font-mono text-slate-900">
                {qualityMetrics.avgProtein.toFixed(2)}%
              </div>
              <div className="mt-1 text-[10px] text-slate-500 font-mono">
                Média dos laudos analisados
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600 font-mono">
                Acidez Média
              </div>
              <div className="mt-1.5 text-2xl font-black font-mono text-slate-900">
                {qualityMetrics.avgAcidity.toFixed(2)}
              </div>
              <div className="mt-1 text-[10px] text-slate-500 font-mono">
                Média dos laudos analisados
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600 font-mono">
                Umidade Média
              </div>
              <div className="mt-1.5 text-2xl font-black font-mono text-slate-900">
                {qualityMetrics.avgMoisture.toFixed(2)}%
              </div>
              <div className="mt-1 text-[10px] text-slate-500 font-mono">
                Média dos laudos analisados
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600 font-mono">
                Digestibilidade Média
              </div>
              <div className="mt-1.5 text-2xl font-black font-mono text-slate-900">
                {qualityMetrics.avgDigestibility.toFixed(2)}%
              </div>
              <div className="mt-1 text-[10px] text-slate-500 font-mono">
                Média dos laudos analisados
              </div>
            </div>
          </div>

          {/* Quality Filters & Upload Quality Photo shortcut */}
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-slate-300 text-xs">
                <span className="text-slate-500 font-mono">Produto:</span>
                <select
                  value={qualityFlourFilter}
                  onChange={(e) => setQualityFlourFilter(e.target.value)}
                  className="bg-transparent text-slate-900 font-mono font-bold focus:outline-none cursor-pointer"
                >
                  <option value="Todas">Todos</option>
                  {INVENTORY_PRODUCTS.map((prod) => (
                    <option key={prod} value={prod}>
                      {prod}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-slate-300 text-xs">
                <span className="text-slate-500 font-mono">Classificação:</span>
                <select
                  value={qualityClassFilter}
                  onChange={(e) => setQualityClassFilter(e.target.value)}
                  className="bg-transparent text-slate-900 font-mono font-bold focus:outline-none cursor-pointer"
                >
                  <option value="Todas">Todas</option>
                  <option value="STANDARD">STANDARD</option>
                  <option value="COMERCIAL">COMERCIAL</option>
                  <option value="Com Laudo">Com Laudo</option>
                  <option value="Sem Laudo">Sem Laudo</option>
                </select>
              </div>

              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={qualitySearch}
                  onChange={(e) => setQualitySearch(e.target.value)}
                  placeholder="Buscar Cód. Barra, Bag ou Descrição..."
                  className="pl-8 pr-3 py-1.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-900 focus:border-emerald-500 focus:outline-none w-64"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="inventory-quality-excel-input"
                className="cursor-pointer px-3.5 py-2 bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-800 rounded-xl text-xs font-bold flex items-center gap-2 transition-colors"
              >
                {loadingQualityExcel ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Upload className="w-3.5 h-3.5" />
                )}
                <span>Importar Laudos de Qualidade (Excel/CSV)</span>
              </label>
            </div>
          </div>

          {/* Quality Table */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div>
                <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                  <FlaskConical className="w-5 h-5 text-emerald-600" />
                  Painel Laboratorial dos Bags em Estoque ({filteredQualityBags.length})
                </h3>
                <p className="text-xs text-slate-500">
                  Parâmetros químicos vinculados por Código de Barra
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-center text-xs">
                <thead className="bg-slate-100 text-slate-700 uppercase tracking-wider border-b border-slate-200 font-mono">
                  <tr>
                    <th className="px-2.5 py-2.5 text-center">Cód. Barras</th>
                    <th className="px-2.5 py-2.5 text-center">Cód. Bag</th>
                    <th className="px-2.5 py-2.5 text-center">Descrição</th>
                    <th className="px-2.5 py-2.5 text-center">Data Prod.</th>
                    <th className="px-2.5 py-2.5 text-center">Per.</th>
                    <th className="px-2.5 py-2.5 text-center">Acidez</th>
                    <th className="px-2.5 py-2.5 text-center">Peróxido</th>
                    <th className="px-2.5 py-2.5 text-center">Umidade</th>
                    <th className="px-2.5 py-2.5 text-center">Ext. Etéreo</th>
                    <th className="px-2.5 py-2.5 text-center">Prot. Bruta</th>
                    <th className="px-2.5 py-2.5 text-center">Mat. Min.</th>
                    <th className="px-2.5 py-2.5 text-center">Digestib.</th>
                    <th className="px-2.5 py-2.5 text-center">Classificação</th>
                    <th className="px-2.5 py-2.5 text-center">Detalhes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 font-mono text-slate-800">
                  {filteredQualityBags.length === 0 ? (
                    <tr>
                      <td colSpan={14} className="px-4 py-10 text-center text-slate-500 font-sans">
                        Nenhum bag encontrado para os filtros selecionados.
                      </td>
                    </tr>
                  ) : (
                    filteredQualityBags.map((bag) => (
                      <tr
                        key={bag.id}
                        className={`transition-colors ${
                          bag.is_blocked ? 'bg-red-50 hover:bg-red-100/70' : 'hover:bg-slate-50'
                        }`}
                      >
                        <td className="px-2.5 py-2.5 text-center font-semibold text-slate-900 whitespace-nowrap">
                          {bag.barcode}
                        </td>
                        <td className="px-2.5 py-2.5 text-center font-bold text-slate-900">
                          {bag.bag_code}
                        </td>
                        <td className="px-2.5 py-2.5 text-center font-sans text-slate-700 max-w-[180px] truncate">
                          {bag.product_description}
                        </td>
                        <td className="px-2.5 py-2.5 text-center whitespace-nowrap">
                          {formatDateDDMMYYYY(bag.production_date)}
                        </td>
                        <td className="px-2.5 py-2.5 text-center font-bold">{bag.period}</td>
                        <td className="px-2.5 py-2.5 text-center">
                          {formatQualityNumber(bag.quality_acidity)}
                        </td>
                        <td className="px-2.5 py-2.5 text-center">
                          {formatQualityNumber(bag.quality_peroxide)}
                        </td>
                        <td className="px-2.5 py-2.5 text-center">
                          {formatQualityNumber(bag.quality_moisture, '%')}
                        </td>
                        <td className="px-2.5 py-2.5 text-center">
                          {formatQualityNumber(bag.quality_ether_extract, '%')}
                        </td>
                        <td className="px-2.5 py-2.5 text-center font-bold text-emerald-700">
                          {formatQualityNumber(bag.quality_crude_protein, '%')}
                        </td>
                        <td className="px-2.5 py-2.5 text-center">
                          {formatQualityNumber(bag.quality_mineral_matter, '%')}
                        </td>
                        <td className="px-2.5 py-2.5 text-center">
                          {formatQualityNumber(bag.quality_digestibility, '%')}
                        </td>
                        <td className="px-2.5 py-2.5 text-center whitespace-nowrap">
                          {renderClassificationBadge(bag.quality_classification, bag)}
                        </td>
                        <td className="px-2.5 py-2.5 text-center whitespace-nowrap">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={() => setInfoModalBag(bag)}
                              className="p-1 text-sky-600 hover:text-sky-800 rounded hover:bg-sky-50 transition-colors"
                              title="Ver Ficha Laboratorial Completa"
                            >
                              <Info className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingBag({ ...bag });
                                setEditingBagIndex(null);
                              }}
                              className="p-1 text-slate-500 hover:text-emerald-700 rounded hover:bg-emerald-50 transition-colors"
                              title="Editar Laudo / Bag"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          </div>
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

      {/* ========================================================================= */}
      {/* RELATÓRIO OCULTO EXCLUSIVO PARA IMPRESSÃO EM PAISAGEM (LANDSCAPE PDF) */}
      {/* ========================================================================= */}
      <div className="hidden print:block print:w-full space-y-4 mt-3">
        {printReportData.viscerasList.length === 0 &&
        printReportData.penasList.length === 0 &&
        printReportData.oleoAvesList.length === 0 &&
        printReportData.oleoGraxoList.length === 0 ? (
          <div className="border border-slate-400 rounded-xl p-6 text-center text-sm text-slate-700">
            Nenhum registro encontrado para os critérios selecionados.
          </div>
        ) : (
          <>
            {(
              [
                {
                  product: 'Farinha de Vísceras' as StandardProductType,
                  bagsList: printReportData.viscerasList,
                  groupWeightKg: printReportData.viscerasWeightKg,
                  groupLiters: 0,
                  groupInventories: printReportData.viscerasInventories,
                },
                {
                  product: 'Farinha de Penas' as StandardProductType,
                  bagsList: printReportData.penasList,
                  groupWeightKg: printReportData.penasWeightKg,
                  groupLiters: 0,
                  groupInventories: printReportData.penasInventories,
                },
                {
                  product: 'Óleo de Aves' as StandardProductType,
                  bagsList: printReportData.oleoAvesList,
                  groupWeightKg: printReportData.oleoAvesWeightKg,
                  groupLiters: printReportData.oleoAvesLiters,
                  groupInventories: printReportData.oleoAvesInventories,
                },
                {
                  product: 'Óleo Graxo' as StandardProductType,
                  bagsList: printReportData.oleoGraxoList,
                  groupWeightKg: printReportData.oleoGraxoWeightKg,
                  groupLiters: printReportData.oleoGraxoLiters,
                  groupInventories: printReportData.oleoGraxoInventories,
                },
              ] as const
            )
              .filter((g) => g.bagsList.length > 0)
              .map((group, nonEmptyIdx) => {
                const { product: groupProduct, bagsList, groupWeightKg, groupLiters, groupInventories } =
                  group;
                const isOilGroup = isOilProductType(groupProduct);
                const needsPageBreak = nonEmptyIdx > 0;

                return (
                  <React.Fragment key={groupProduct}>
                    {needsPageBreak && (
                      <div
                        className="print:break-before-page"
                        style={{ pageBreakBefore: 'always' }}
                      />
                    )}
                    <section className="bg-white border border-slate-400 rounded-lg p-2.5 print:shadow-none space-y-2">
                      <div className="flex items-center justify-between border-b border-slate-400 pb-1.5">
                        <div>
                          <h3 className="text-xs font-black text-slate-900 uppercase tracking-wide">
                            {groupProduct}{' '}
                            {printReportData.mode === 'byDate'
                              ? `— ${formatDateDDMMYYYY(printReportData.targetDate)}`
                              : '— Estoque Geral'}
                          </h3>
                          {groupInventories.length > 0 && (
                            <p className="text-[10px] text-slate-700 font-mono">
                              {groupInventories
                                .map(
                                  (inv) =>
                                    `Horário: ${(inv.inventory_time || '').slice(0, 5)} | Participantes: ${inv.participants}`
                                )
                                .join(' • ')}
                            </p>
                          )}
                        </div>
                        <div className="text-right text-[10px] font-mono font-bold text-slate-900">
                          <span>
                            {bagsList.length} {isOilGroup ? 'lote(s)' : 'bag(s)'} &bull;{' '}
                          </span>
                          <span>{formatNumberBR(groupWeightKg)} kg</span>
                          {isOilGroup && <span> / {formatNumberBR(groupLiters)} L</span>}
                        </div>
                      </div>

                      <table className="w-full text-center border-collapse border border-slate-400 text-[9px] leading-tight print:shadow-none">
                        <thead className="bg-slate-100 text-slate-900 uppercase font-mono">
                          <tr>
                            <th className="px-1.5 py-1 text-center border border-slate-400 whitespace-nowrap">
                              Cód.
                            </th>
                            <th className="px-1.5 py-1 text-center border border-slate-400 whitespace-nowrap">
                              Descrição
                            </th>
                            <th className="px-1.5 py-1 text-center border border-slate-400 whitespace-nowrap">
                              {isOilGroup ? 'Lote / Tanque' : 'Cód. Bag'}
                            </th>
                            <th className="px-1.5 py-1 text-center border border-slate-400 whitespace-nowrap">
                              Data Prod.
                            </th>
                            <th className="px-1.5 py-1 text-center border border-slate-400 whitespace-nowrap">
                              Hora
                            </th>
                            <th className="px-1.5 py-1 text-center border border-slate-400 whitespace-nowrap">
                              Per.
                            </th>
                            <th className="px-1.5 py-1 text-center border border-slate-400 whitespace-nowrap">
                              {isOilGroup ? 'Qtd. (kg / L)' : 'Peso (kg)'}
                            </th>
                            <th className="px-1.5 py-1 text-center border border-slate-400 whitespace-nowrap">
                              Cód. Barra
                            </th>
                            <th className="px-1.5 py-1 text-center border border-slate-400 whitespace-nowrap">
                              Acidez
                            </th>
                            <th className="px-1.5 py-1 text-center border border-slate-400 whitespace-nowrap">
                              Peróx.
                            </th>
                            <th className="px-1.5 py-1 text-center border border-slate-400 whitespace-nowrap">
                              Umid.
                            </th>
                            <th className="px-1.5 py-1 text-center border border-slate-400 whitespace-nowrap">
                              Ext. Et.
                            </th>
                            <th className="px-1.5 py-1 text-center border border-slate-400 whitespace-nowrap">
                              Prot. Br.
                            </th>
                            <th className="px-1.5 py-1 text-center border border-slate-400 whitespace-nowrap">
                              Mat. Min.
                            </th>
                            <th className="px-1.5 py-1 text-center border border-slate-400 whitespace-nowrap">
                              Digest.
                            </th>
                            <th className="px-1.5 py-1 text-center border border-slate-400 whitespace-nowrap">
                              Classificação / Laudo
                            </th>
                          </tr>
                        </thead>
                        <tbody className="font-mono text-slate-900">
                          {bagsList.map((bag, idx) => {
                            const cls = (bag.quality_classification || '').trim().toUpperCase();
                            const hasNumericLab = hasBagNumericQuality(bag);

                            let qualityCellContent: React.ReactNode;
                            if (groupProduct === 'Farinha de Vísceras') {
                              if (cls === 'STANDARD') {
                                qualityCellContent = (
                                  <span className="font-bold text-emerald-800">STANDARD</span>
                                );
                              } else if (cls === 'COMERCIAL') {
                                qualityCellContent = (
                                  <span className="font-bold text-rose-800">COMERCIAL</span>
                                );
                              } else if (cls) {
                                qualityCellContent = (
                                  <span className="font-bold text-amber-800">{cls}</span>
                                );
                              } else {
                                qualityCellContent = (
                                  <span className="text-slate-500">Aguardando</span>
                                );
                              }
                            } else if (groupProduct === 'Farinha de Penas') {
                              qualityCellContent = hasNumericLab ? (
                                <span className="font-bold text-blue-800">Com Laudo</span>
                              ) : (
                                <span className="text-slate-500">Sem Laudo</span>
                              );
                            } else {
                              qualityCellContent = cls ? (
                                <span className="font-bold text-amber-800">{cls}</span>
                              ) : hasNumericLab ? (
                                <span className="font-bold text-blue-800">Com Laudo</span>
                              ) : (
                                <span className="text-slate-500">Sem Laudo</span>
                              );
                            }

                            return (
                              <tr key={bag.id ?? `print-${groupProduct}-${idx}`}>
                                <td className="px-1.5 py-1 text-center border border-slate-300 font-semibold whitespace-nowrap">
                                  {bag.product_code}
                                </td>
                                <td className="px-1.5 py-1 text-center border border-slate-300 font-sans max-w-[125px] truncate">
                                  {bag.product_description}
                                </td>
                                <td className="px-1.5 py-1 text-center border border-slate-300 font-bold whitespace-nowrap">
                                  {bag.bag_code}
                                </td>
                                <td className="px-1.5 py-1 text-center border border-slate-300 whitespace-nowrap">
                                  {formatDateDDMMYYYY(bag.production_date)}
                                </td>
                                <td className="px-1.5 py-1 text-center border border-slate-300 whitespace-nowrap">
                                  {(bag.posting_time || '').slice(0, 5)}
                                </td>
                                <td className="px-1.5 py-1 text-center border border-slate-300 font-bold whitespace-nowrap">
                                  {bag.period}
                                </td>
                                <td className="px-1.5 py-1 text-center border border-slate-300 font-bold whitespace-nowrap">
                                  {formatNumberBR(bag.weight_kg)} kg
                                  {isOilGroup && bag.volume_liters != null && (
                                    <span className="block text-[8px] text-amber-800">
                                      {formatNumberBR(bag.volume_liters)} L
                                    </span>
                                  )}
                                </td>
                                <td className="px-1.5 py-1 text-center border border-slate-300 font-semibold whitespace-nowrap">
                                  {bag.barcode}
                                </td>
                                <td className="px-1.5 py-1 text-center border border-slate-300 whitespace-nowrap">
                                  {formatQualityNumber(bag.quality_acidity)}
                                </td>
                                <td className="px-1.5 py-1 text-center border border-slate-300 whitespace-nowrap">
                                  {formatQualityNumber(bag.quality_peroxide)}
                                </td>
                                <td className="px-1.5 py-1 text-center border border-slate-300 whitespace-nowrap">
                                  {formatQualityNumber(bag.quality_moisture, '%')}
                                </td>
                                <td className="px-1.5 py-1 text-center border border-slate-300 whitespace-nowrap">
                                  {formatQualityNumber(bag.quality_ether_extract, '%')}
                                </td>
                                <td className="px-1.5 py-1 text-center border border-slate-300 font-bold whitespace-nowrap">
                                  {formatQualityNumber(bag.quality_crude_protein, '%')}
                                </td>
                                <td className="px-1.5 py-1 text-center border border-slate-300 whitespace-nowrap">
                                  {formatQualityNumber(bag.quality_mineral_matter, '%')}
                                </td>
                                <td className="px-1.5 py-1 text-center border border-slate-300 whitespace-nowrap">
                                  {formatQualityNumber(bag.quality_digestibility, '%')}
                                </td>
                                <td className="px-1.5 py-1 text-center border border-slate-300 whitespace-nowrap">
                                  {qualityCellContent}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="bg-slate-100 font-bold font-mono text-slate-900">
                            <td colSpan={6} className="px-1.5 py-1 text-center border border-slate-400">
                              TOTAL {groupProduct.toUpperCase()} ({bagsList.length}{' '}
                              {isOilGroup ? 'lotes' : 'bags'})
                            </td>
                            <td className="px-1.5 py-1 text-center border border-slate-400 whitespace-nowrap">
                              {formatNumberBR(groupWeightKg)} kg
                              {isOilGroup && ` / ${formatNumberBR(groupLiters)} L`}
                            </td>
                            <td colSpan={9} className="px-1.5 py-1 text-center border border-slate-400">
                              —
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </section>
                  </React.Fragment>
                );
              })}
          </>
        )}
      </div>

      {/* ========================================================================= */}
      {/* MODAL: OPÇÕES DE EXPORTAÇÃO DE RELATÓRIO EM PDF */}
      {/* ========================================================================= */}
      {isExportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in print:hidden">
          <div className="bg-white border border-slate-200 w-full max-w-md rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-slate-800 text-white flex items-center justify-center shrink-0">
                  <Printer className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Opções de Exportação PDF
                  </h3>
                  <p className="text-xs text-slate-500">
                    Relatório otimizado em formato Paisagem (Landscape)
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsExportModalOpen(false)}
                className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-200"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="space-y-2.5">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 font-mono">
                  Escolha o escopo do relatório
                </label>

                <button
                  type="button"
                  onClick={() => setDraftExportMode('general')}
                  className={`w-full text-left p-3.5 rounded-xl border transition-all flex items-start gap-3 ${
                    draftExportMode === 'general'
                      ? 'bg-emerald-50 border-emerald-400 ring-1 ring-emerald-400'
                      : 'bg-white border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded-full border mt-0.5 flex items-center justify-center shrink-0 ${
                      draftExportMode === 'general'
                        ? 'border-emerald-600 bg-emerald-600'
                        : 'border-slate-300'
                    }`}
                  >
                    {draftExportMode === 'general' && (
                      <span className="w-1.5 h-1.5 rounded-full bg-white" />
                    )}
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-900">
                      Estoque Geral
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      Exporta o consolidado de todos os {inventoryBags.length} bag(s) cadastrados no Supabase.
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setDraftExportMode('byDate')}
                  className={`w-full text-left p-3.5 rounded-xl border transition-all flex items-start gap-3 ${
                    draftExportMode === 'byDate'
                      ? 'bg-emerald-50 border-emerald-400 ring-1 ring-emerald-400'
                      : 'bg-white border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded-full border mt-0.5 flex items-center justify-center shrink-0 ${
                      draftExportMode === 'byDate'
                        ? 'border-emerald-600 bg-emerald-600'
                        : 'border-slate-300'
                    }`}
                  >
                    {draftExportMode === 'byDate' && (
                      <span className="w-1.5 h-1.5 rounded-full bg-white" />
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="text-xs font-bold text-slate-900">
                      Por Inventário (Data)
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      Consolida todos os inventários (Vísceras e Penas) da data selecionada.
                    </div>
                  </div>
                </button>
              </div>

              {draftExportMode === 'byDate' && (
                <div className="pt-1 space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-700">
                    Selecione a Data do Inventário *
                  </label>
                  {uniqueInventoryDates.length === 0 ? (
                    <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800">
                      Nenhum inventário salvo encontrado no Supabase. Utilize a opção Estoque Geral ou salve um inventário primeiro.
                    </div>
                  ) : (
                    <select
                      value={draftExportDate}
                      onChange={(e) => setDraftExportDate(e.target.value)}
                      className="w-full px-3 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-900 font-mono font-bold focus:border-emerald-500 focus:outline-none cursor-pointer"
                    >
                      {uniqueInventoryDates.map((dateStr) => {
                        const invCount = inventories.filter(
                          (inv) => inv.inventory_date && inv.inventory_date.split('T')[0] === dateStr
                        ).length;
                        return (
                          <option key={dateStr} value={dateStr}>
                            {formatDateDDMMYYYY(dateStr)} ({invCount} inventário(s))
                          </option>
                        );
                      })}
                    </select>
                  )}
                </div>
              )}
            </div>

            <div className="px-6 py-3.5 border-t border-slate-200 bg-slate-50 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setIsExportModalOpen(false)}
                className="px-4 py-2 bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 rounded-xl text-xs font-semibold"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleGeneratePdfReport}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Gerar Relatório</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL FLUTUANTE (i): DETALHES DE QUALIDADE DO BAG */}
      {/* ========================================================================= */}
      {infoModalBag && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in print:hidden">
          <div className="bg-white border border-slate-200 w-full max-w-xl rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-sky-50 border border-sky-200 flex items-center justify-center text-sky-600">
                  <FlaskConical className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Laudo Laboratorial do Bag &bull; #{infoModalBag.bag_code}
                  </h3>
                  <p className="text-xs text-slate-500 font-mono">
                    Cód. Barras: {infoModalBag.barcode}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setInfoModalBag(null)}
                className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-200"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-5">
              {/* Bag Header Summary */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-slate-900 text-sm">
                    {infoModalBag.product_description}
                  </span>
                  {renderClassificationBadge(infoModalBag.quality_classification, infoModalBag)}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-slate-200 font-mono text-[11px] text-slate-600">
                  <div>
                    <span className="text-slate-400 block">Data Prod.</span>
                    <span className="font-semibold text-slate-900">
                      {formatDateDDMMYYYY(infoModalBag.production_date)}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block">Hora Apont.</span>
                    <span className="font-semibold text-slate-900">
                      {(infoModalBag.posting_time || '').slice(0, 5)}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block">Período</span>
                    <span className="font-semibold text-slate-900">{infoModalBag.period}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block">Peso / Volume</span>
                    <span className="font-bold text-emerald-700">
                      {formatNumberBR(infoModalBag.weight_kg)} kg
                    </span>
                    {infoModalBag.volume_liters !== null &&
                      infoModalBag.volume_liters !== undefined && (
                        <span className="block font-bold text-amber-700">
                          {formatNumberBR(infoModalBag.volume_liters)} L
                        </span>
                      )}
                  </div>
                </div>
              </div>

              {/* 8 Laboratory Indicators */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded-xl bg-white border border-slate-200 text-center">
                  <div className="text-[10px] font-bold uppercase text-slate-500 font-mono">
                    Acidez
                  </div>
                  <div className="text-base font-black font-mono text-slate-900 mt-1">
                    {formatQualityNumber(infoModalBag.quality_acidity)}
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-white border border-slate-200 text-center">
                  <div className="text-[10px] font-bold uppercase text-slate-500 font-mono">
                    Índ. Peróxido
                  </div>
                  <div className="text-base font-black font-mono text-slate-900 mt-1">
                    {formatQualityNumber(infoModalBag.quality_peroxide)}
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-white border border-slate-200 text-center">
                  <div className="text-[10px] font-bold uppercase text-slate-500 font-mono">
                    Umidade
                  </div>
                  <div className="text-base font-black font-mono text-slate-900 mt-1">
                    {formatQualityNumber(infoModalBag.quality_moisture, '%')}
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-white border border-slate-200 text-center">
                  <div className="text-[10px] font-bold uppercase text-slate-500 font-mono">
                    Extrato Etéreo
                  </div>
                  <div className="text-base font-black font-mono text-slate-900 mt-1">
                    {formatQualityNumber(infoModalBag.quality_ether_extract, '%')}
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-center">
                  <div className="text-[10px] font-bold uppercase text-emerald-700 font-mono">
                    Proteína Bruta
                  </div>
                  <div className="text-base font-black font-mono text-emerald-800 mt-1">
                    {formatQualityNumber(infoModalBag.quality_crude_protein, '%')}
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-white border border-slate-200 text-center">
                  <div className="text-[10px] font-bold uppercase text-slate-500 font-mono">
                    Matéria Mineral
                  </div>
                  <div className="text-base font-black font-mono text-slate-900 mt-1">
                    {formatQualityNumber(infoModalBag.quality_mineral_matter, '%')}
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-white border border-slate-200 text-center">
                  <div className="text-[10px] font-bold uppercase text-slate-500 font-mono">
                    Digestibilidade
                  </div>
                  <div className="text-base font-black font-mono text-slate-900 mt-1">
                    {formatQualityNumber(infoModalBag.quality_digestibility, '%')}
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-center flex flex-col items-center justify-center">
                  <div className="text-[10px] font-bold uppercase text-slate-500 font-mono mb-1">
                    Classificação
                  </div>
                  {renderClassificationBadge(infoModalBag.quality_classification, infoModalBag)}
                </div>
              </div>
            </div>

            <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  const bag = infoModalBag;
                  setInfoModalBag(null);
                  setEditingBag({ ...bag });
                  setEditingBagIndex(null);
                }}
                className="px-4 py-2 bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 rounded-xl text-xs font-semibold flex items-center gap-1.5"
              >
                <Pencil className="w-3.5 h-3.5 text-emerald-600" />
                <span>Editar Bag / Laudo</span>
              </button>
              <button
                type="button"
                onClick={() => setInfoModalBag(null)}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-xl text-xs font-semibold"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: EDITAR BAG E PARÂMETROS DE QUALIDADE */}
      {/* ========================================================================= */}
      {editingBag && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in print:hidden">
          <form
            onSubmit={handleSaveBagEdit}
            className="bg-white border border-slate-200 w-full max-w-3xl max-h-[90vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden"
          >
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Editar Bag #{editingBag.bag_code}
                </h3>
                <p className="text-xs text-slate-500 font-mono">
                  Cód. Barras: {editingBag.barcode}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setEditingBag(null);
                  setEditingBagIndex(null);
                }}
                className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-200"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 font-mono mb-3">
                  Dados do Bag (Relatório)
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Código (Produto)
                    </label>
                    <input
                      type="text"
                      value={editingBag.product_code}
                      onChange={(e) =>
                        setEditingBag((p) => (p ? { ...p, product_code: e.target.value } : null))
                      }
                      className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 font-mono"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Descrição
                    </label>
                    <input
                      type="text"
                      value={editingBag.product_description}
                      onChange={(e) =>
                        setEditingBag((p) =>
                          p ? { ...p, product_description: e.target.value } : null
                        )
                      }
                      className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Cód. Bag
                    </label>
                    <input
                      type="text"
                      value={editingBag.bag_code}
                      onChange={(e) =>
                        setEditingBag((p) => (p ? { ...p, bag_code: e.target.value } : null))
                      }
                      className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Peso (kg)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={editingBag.weight_kg ?? ''}
                      onChange={(e) =>
                        setEditingBag((p) =>
                          p ? { ...p, weight_kg: parseFloat(e.target.value) || 0 } : null
                        )
                      }
                      className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 font-mono font-bold"
                    />
                  </div>
                  {(isOilBagEntry(editingBag, inventoryMap) ||
                    (editingBag.volume_liters !== null &&
                      editingBag.volume_liters !== undefined)) && (
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Estoque L (Litros)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={editingBag.volume_liters ?? ''}
                        onChange={(e) =>
                          setEditingBag((p) =>
                            p
                              ? {
                                  ...p,
                                  volume_liters:
                                    e.target.value === ''
                                      ? null
                                      : parseFloat(e.target.value) || 0,
                                }
                              : null
                          )
                        }
                        className="w-full px-3 py-1.5 bg-white border border-amber-300 rounded-lg text-xs text-amber-900 font-mono font-bold"
                      />
                    </div>
                  )}
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Período
                    </label>
                    <select
                      value={editingBag.period}
                      onChange={(e) =>
                        setEditingBag((p) => (p ? { ...p, period: e.target.value } : null))
                      }
                      className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 font-mono"
                    >
                      <option value="A">A</option>
                      <option value="B">B</option>
                      <option value="C">C</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Data Produção
                    </label>
                    <input
                      type="date"
                      value={(editingBag.production_date || '').split('T')[0]}
                      onChange={(e) =>
                        setEditingBag((p) => (p ? { ...p, production_date: e.target.value } : null))
                      }
                      className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Data Apontamento
                    </label>
                    <input
                      type="date"
                      value={(editingBag.posting_date || '').split('T')[0]}
                      onChange={(e) =>
                        setEditingBag((p) => (p ? { ...p, posting_date: e.target.value } : null))
                      }
                      className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Hora Apont.
                    </label>
                    <input
                      type="time"
                      value={(editingBag.posting_time || '').slice(0, 5)}
                      onChange={(e) =>
                        setEditingBag((p) => (p ? { ...p, posting_time: e.target.value } : null))
                      }
                      className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 font-mono"
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Código de Barra
                    </label>
                    <input
                      type="text"
                      value={editingBag.barcode}
                      onChange={(e) =>
                        setEditingBag((p) => (p ? { ...p, barcode: e.target.value } : null))
                      }
                      className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 font-mono"
                    />
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-200">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 font-mono mb-3">
                  Indicadores de Qualidade Laboratorial
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Acidez
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={editingBag.quality_acidity ?? ''}
                      onChange={(e) =>
                        setEditingBag((p) =>
                          p
                            ? {
                                ...p,
                                quality_acidity:
                                  e.target.value === '' ? null : parseFloat(e.target.value),
                              }
                            : null
                        )
                      }
                      className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Índ. Peróxido
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={editingBag.quality_peroxide ?? ''}
                      onChange={(e) =>
                        setEditingBag((p) =>
                          p
                            ? {
                                ...p,
                                quality_peroxide:
                                  e.target.value === '' ? null : parseFloat(e.target.value),
                              }
                            : null
                        )
                      }
                      className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Umidade (%)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={editingBag.quality_moisture ?? ''}
                      onChange={(e) =>
                        setEditingBag((p) =>
                          p
                            ? {
                                ...p,
                                quality_moisture:
                                  e.target.value === '' ? null : parseFloat(e.target.value),
                              }
                            : null
                        )
                      }
                      className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Extrato Etéreo (%)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={editingBag.quality_ether_extract ?? ''}
                      onChange={(e) =>
                        setEditingBag((p) =>
                          p
                            ? {
                                ...p,
                                quality_ether_extract:
                                  e.target.value === '' ? null : parseFloat(e.target.value),
                              }
                            : null
                        )
                      }
                      className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Proteína Bruta (%)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={editingBag.quality_crude_protein ?? ''}
                      onChange={(e) =>
                        setEditingBag((p) =>
                          p
                            ? {
                                ...p,
                                quality_crude_protein:
                                  e.target.value === '' ? null : parseFloat(e.target.value),
                              }
                            : null
                        )
                      }
                      className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Matéria Mineral (%)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={editingBag.quality_mineral_matter ?? ''}
                      onChange={(e) =>
                        setEditingBag((p) =>
                          p
                            ? {
                                ...p,
                                quality_mineral_matter:
                                  e.target.value === '' ? null : parseFloat(e.target.value),
                              }
                            : null
                        )
                      }
                      className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Digestibilidade (%)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={editingBag.quality_digestibility ?? ''}
                      onChange={(e) =>
                        setEditingBag((p) =>
                          p
                            ? {
                                ...p,
                                quality_digestibility:
                                  e.target.value === '' ? null : parseFloat(e.target.value),
                              }
                            : null
                        )
                      }
                      className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Classificação
                    </label>
                    <select
                      value={editingBag.quality_classification || ''}
                      onChange={(e) =>
                        setEditingBag((p) =>
                          p
                            ? {
                                ...p,
                                quality_classification: e.target.value || null,
                              }
                            : null
                        )
                      }
                      className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 font-mono font-bold"
                    >
                      <option value="">Sem Laudo</option>
                      <option value="APROVADO">APROVADO</option>
                      <option value="STANDARD">STANDARD</option>
                      <option value="COMERCIAL">COMERCIAL</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>

            <div className="px-6 py-3.5 border-t border-slate-200 bg-slate-50 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setEditingBag(null);
                  setEditingBagIndex(null);
                }}
                className="px-4 py-2 bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 rounded-xl text-xs font-semibold"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isSavingBagEdit}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{isSavingBagEdit ? 'Salvando...' : 'Salvar Alterações'}</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: CONFIRMAÇÃO DE EXCLUSÃO DE BAG (SEM window.confirm) */}
      {/* ========================================================================= */}
      {bagPendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in print:hidden">
          <div className="bg-white border border-slate-200 w-full max-w-md rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-rose-50 flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-rose-100 border border-rose-200 flex items-center justify-center text-rose-600 shrink-0">
                <Trash2 className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Excluir Bag #{bagPendingDelete.bag.bag_code}?
                </h3>
                <p className="text-xs text-slate-600 font-mono">
                  Cód. Barras: {bagPendingDelete.bag.barcode}
                </p>
              </div>
            </div>
            <div className="p-6 text-xs text-slate-600">
              Tem certeza que deseja excluir este bag ({bagPendingDelete.bag.weight_kg.toLocaleString('pt-BR')} kg)?
            </div>
            <div className="px-6 py-3.5 border-t border-slate-200 bg-slate-50 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setBagPendingDelete(null)}
                disabled={isDeletingBag}
                className="px-4 py-2 bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 rounded-xl text-xs font-semibold"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteBag}
                disabled={isDeletingBag}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isDeletingBag ? 'Excluindo...' : 'Confirmar Exclusão'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: CONFIRMAÇÃO DE EXCLUSÃO DE INVENTÁRIO (SEM window.confirm) */}
      {/* ========================================================================= */}
      {inventoryPendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in print:hidden">
          <div className="bg-white border border-slate-200 w-full max-w-md rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-rose-50 flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-rose-100 border border-rose-200 flex items-center justify-center text-rose-600 shrink-0">
                <AlertTriangle className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Excluir Inventário Completo?
                </h3>
                <p className="text-xs text-slate-600 font-mono">
                  {formatDateDDMMYYYY(inventoryPendingDelete.inventory_date)} &bull;{' '}
                  {inventoryPendingDelete.flour_type}
                </p>
              </div>
            </div>
            <div className="p-6 text-xs text-slate-600">
              Esta ação removerá o inventário e todos os bags vinculados a ele do banco de dados Supabase.
            </div>
            <div className="px-6 py-3.5 border-t border-slate-200 bg-slate-50 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setInventoryPendingDelete(null)}
                disabled={isDeletingInventory}
                className="px-4 py-2 bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 rounded-xl text-xs font-semibold"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteInventory}
                disabled={isDeletingInventory}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isDeletingInventory ? 'Excluindo...' : 'Confirmar Exclusão'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
