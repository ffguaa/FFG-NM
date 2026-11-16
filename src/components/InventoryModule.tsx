import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  FfgInventory,
  FfgInventoryBag,
  FlourType,
  ParsedQualityRow,
} from '../types';
import { supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import { parseInventoryBagsExcel, parseQualityReportExcel } from '../lib/excelParser';
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
} from 'lucide-react';

interface InventoryModuleProps {
  inventories: FfgInventory[];
  inventoryBags: FfgInventoryBag[];
  onReload: () => Promise<void>;
}

const formatDateDDMMYYYY = (isoDate?: string | null): string => {
  if (!isoDate) return '—';
  const datePart = isoDate.split('T')[0];
  const parts = datePart.split('-');
  if (parts.length !== 3) return isoDate;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
};

const normalizeBarcode = (code?: string | null): string => {
  return String(code ?? '').trim().replace(/\s+/g, '');
};

const inferBagFlourType = (
  bag: FfgInventoryBag,
  inventoryMap: Map<string, FfgInventory>
): FlourType => {
  if (bag.inventory_id !== undefined && bag.inventory_id !== null) {
    const parent = inventoryMap.get(String(bag.inventory_id));
    if (parent?.flour_type === 'Penas' || parent?.flour_type === 'Vísceras') {
      return parent.flour_type;
    }
  }
  const desc = (bag.product_description || '').toUpperCase();
  if (desc.includes('PENA')) return 'Penas';
  return 'Vísceras';
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
    (val) => val !== null && val !== undefined && !isNaN(Number(val)) && Number(val) > 0
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

  // Selected inventory mode: null means "Novo Inventário (Rascunho)", otherwise editing/viewing saved inventory
  const [selectedInventoryId, setSelectedInventoryId] = useState<string | null>(() => {
    return inventories.length > 0 && inventories[0].id !== undefined
      ? String(inventories[0].id)
      : null;
  });

  // Inventory Header Form State
  const [flourType, setFlourType] = useState<FlourType>('Vísceras');
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

  // File refs & loading flags
  const excelInputRef = useRef<HTMLInputElement>(null);
  const qualityExcelInputRef = useRef<HTMLInputElement>(null);
  const [loadingExcel, setLoadingExcel] = useState<boolean>(false);
  const [loadingQualityExcel, setLoadingQualityExcel] = useState<boolean>(false);
  const [isSavingInventory, setIsSavingInventory] = useState<boolean>(false);
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

  // PDF Export Options Modal State
  const [isExportModalOpen, setIsExportModalOpen] = useState<boolean>(false);
  const [draftExportMode, setDraftExportMode] = useState<'general' | 'byDate'>('byDate');
  const [draftExportDate, setDraftExportDate] = useState<string>('');
  const [committedExportMode, setCommittedExportMode] = useState<'general' | 'byDate'>('byDate');
  const [committedExportDate, setCommittedExportDate] = useState<string>('');

  // Map inventories by id
  const inventoryMap = useMemo(() => {
    const map = new Map<string, FfgInventory>();
    inventories.forEach((inv) => {
      if (inv.id !== undefined) map.set(String(inv.id), inv);
    });
    return map;
  }, [inventories]);

  // Keep selectedInventoryId valid when inventories list reloads
  useEffect(() => {
    if (selectedInventoryId !== null) {
      const exists = inventories.some((inv) => String(inv.id) === selectedInventoryId);
      if (!exists) {
        setSelectedInventoryId(
          inventories.length > 0 && inventories[0].id !== undefined
            ? String(inventories[0].id)
            : null
        );
      }
    }
  }, [inventories, selectedInventoryId]);

  const selectedInventory = useMemo(() => {
    if (!selectedInventoryId) return null;
    return inventoryMap.get(selectedInventoryId) || null;
  }, [selectedInventoryId, inventoryMap]);

  // Populate header form whenever selectedInventory changes
  useEffect(() => {
    if (selectedInventory) {
      setFlourType(selectedInventory.flour_type);
      setInventoryDate(selectedInventory.inventory_date.split('T')[0]);
      setInventoryTime((selectedInventory.inventory_time || '00:00').slice(0, 5));
      setParticipants(selectedInventory.participants || '');
      setIsEditingHeader(false);
    }
  }, [selectedInventory]);

  // Active bags displayed in Sub-tab 1 (either saved inventory's bags or draft bags)
  const activeInventoryBags = useMemo(() => {
    if (!selectedInventoryId) return draftBags;
    return inventoryBags.filter(
      (b) => String(b.inventory_id) === String(selectedInventoryId)
    );
  }, [selectedInventoryId, inventoryBags, draftBags]);

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

    // Quando estiver criando um novo rascunho naquela data, soma também os bags do rascunho
    const dayBags = !selectedInventoryId ? [...savedDayBags, ...draftBags] : savedDayBags;

    const totalBags = dayBags.length;
    let viscerasBags = 0;
    let penasBags = 0;
    let totalWeightKg = 0;
    let viscerasWeightKg = 0;
    let penasWeightKg = 0;
    const viscerasList: FfgInventoryBag[] = [];
    const penasList: FfgInventoryBag[] = [];

    dayBags.forEach((bag) => {
      const weight = Number(bag.weight_kg || 0);
      totalWeightKg += weight;

      let type: FlourType;
      if (bag.inventory_id !== undefined && bag.inventory_id !== null) {
        type = inferBagFlourType(bag, inventoryMap);
      } else {
        const descUpper = (bag.product_description || '').toUpperCase();
        if (descUpper.includes('PENA')) {
          type = 'Penas';
        } else if (descUpper.includes('VISC') || descUpper.includes('VÍSC')) {
          type = 'Vísceras';
        } else {
          type = flourType;
        }
      }

      if (type === 'Penas') {
        penasBags += 1;
        penasWeightKg += weight;
        penasList.push(bag);
      } else {
        viscerasBags += 1;
        viscerasWeightKg += weight;
        viscerasList.push(bag);
      }
    });

    const viscerasInventories = sameDayInventories.filter((i) => i.flour_type === 'Vísceras');
    const penasInventories = sameDayInventories.filter((i) => i.flour_type === 'Penas');

    return {
      totalBags,
      viscerasBags,
      penasBags,
      totalWeightKg,
      viscerasWeightKg,
      penasWeightKg,
      viscerasList,
      penasList,
      viscerasInventories,
      penasInventories,
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
      sourceBags = inventoryBags;
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
    let viscerasWeightKg = 0;
    let penasWeightKg = 0;

    sourceBags.forEach((bag) => {
      const weight = Number(bag.weight_kg || 0);
      const type = inferBagFlourType(bag, inventoryMap);
      if (type === 'Penas') {
        penasList.push(bag);
        penasWeightKg += weight;
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
      totalWeightKg: viscerasWeightKg + penasWeightKg,
      viscerasList,
      penasList,
      viscerasWeightKg,
      penasWeightKg,
      viscerasInventories:
        committedExportMode === 'byDate'
          ? dateInventories.filter((i) => i.flour_type === 'Vísceras')
          : [],
      penasInventories:
        committedExportMode === 'byDate'
          ? dateInventories.filter((i) => i.flour_type === 'Penas')
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

  // ROW 2 KPIs: Resumo Geral do Estoque (all saved bags across all inventories)
  const globalStockKpis = useMemo(() => {
    const totalBags = inventoryBags.length;
    let viscerasBags = 0;
    let penasBags = 0;
    let totalWeightKg = 0;

    inventoryBags.forEach((bag) => {
      totalWeightKg += Number(bag.weight_kg || 0);
      const type = inferBagFlourType(bag, inventoryMap);
      if (type === 'Penas') {
        penasBags += 1;
      } else {
        viscerasBags += 1;
      }
    });

    return {
      totalBags,
      viscerasBags,
      penasBags,
      totalWeightKg,
    };
  }, [inventoryBags, inventoryMap]);

  // Quality Tab KPIs & Filtered List
  const qualityMetrics = useMemo(() => {
    const total = inventoryBags.length;
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

    inventoryBags.forEach((b) => {
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
  }, [inventoryBags]);

  const filteredQualityBags = useMemo(() => {
    const query = qualitySearch.trim().toLowerCase();
    return inventoryBags.filter((bag) => {
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
  }, [inventoryBags, qualityClassFilter, qualityFlourFilter, qualitySearch, inventoryMap]);

  // Switch to "Novo Inventário" mode
  const handleStartNewInventory = () => {
    setSelectedInventoryId(null);
    setFlourType('Vísceras');
    setInventoryDate(new Date().toISOString().split('T')[0]);
    setInventoryTime(new Date().toTimeString().slice(0, 5));
    setParticipants('');
    setDraftBags([]);
    setIsEditingHeader(true);
    setQualityImportSummary(null);
  };

  // Start editing an existing inventory
  const handleSelectAndEditInventory = (inv: FfgInventory) => {
    setSelectedInventoryId(String(inv.id));
    setFlourType(inv.flour_type);
    setInventoryDate(inv.inventory_date.split('T')[0]);
    setInventoryTime((inv.inventory_time || '00:00').slice(0, 5));
    setParticipants(inv.participants || '');
    setIsEditingHeader(true);
    setQualityImportSummary(null);
  };

  // Save new inventory (header + draftBags) or update existing inventory header
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

    setIsSavingInventory(true);
    try {
      if (selectedInventoryId) {
        // UPDATE existing inventory header
        const { error } = await supabase
          .from('ffg_inventories')
          .update({
            flour_type: flourType,
            inventory_date: inventoryDate,
            inventory_time: inventoryTime,
            participants: participants.trim(),
          })
          .eq('id', selectedInventoryId);

        if (error) throw error;

        showToast(
          'success',
          'Inventário Atualizado',
          `Cabeçalho do inventário de ${formatDateDDMMYYYY(inventoryDate)} atualizado no Supabase.`
        );
        setIsEditingHeader(false);
        await onReload();
      } else {
        // INSERT new inventory + staged draftBags
        const { data: insertedInv, error: invError } = await supabase
          .from('ffg_inventories')
          .insert([
            {
              flour_type: flourType,
              inventory_date: inventoryDate,
              inventory_time: inventoryTime,
              participants: participants.trim(),
            },
          ])
          .select()
          .single();

        if (invError) throw invError;
        const newInventoryId = insertedInv.id;

        if (draftBags.length > 0) {
          const bagsToInsert = draftBags.map((b) => ({
            inventory_id: newInventoryId,
            product_code: b.product_code,
            product_description: b.product_description,
            bag_code: b.bag_code,
            production_date: b.production_date,
            posting_date: b.posting_date,
            posting_time: b.posting_time,
            period: b.period,
            weight_kg: Number(b.weight_kg || 0),
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
          `Inventário de ${formatDateDDMMYYYY(inventoryDate)} (${flourType}) criado com ${draftBags.length} bags.`
        );
        setDraftBags([]);
        setIsEditingHeader(false);
        setSelectedInventoryId(String(newInventoryId));
        await onReload();
      }
    } catch (err: any) {
      showSupabaseError('Falha ao Salvar Inventário no Supabase', err);
    } finally {
      setIsSavingInventory(false);
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
      qualityRows.forEach((row) => {
        const code = normalizeBarcode(row.barcode);
        if (code) {
          qualityLookup.set(code, row);
        }
      });

      const matchedRowBarcodes = new Set<string>();
      let matchedBagsCount = 0;

      // 1. Update draftBags if creating a new inventory
      if (!selectedInventoryId && draftBags.length > 0) {
        const updatedDraft = draftBags.map((bag) => {
          const bagCode = normalizeBarcode(bag.barcode);
          const match = qualityLookup.get(bagCode);
          if (!match) return bag;
          matchedBagsCount += 1;
          matchedRowBarcodes.add(bagCode);
          return {
            ...bag,
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
          };
        });
        setDraftBags(updatedDraft);
      }

      // 2. Match and update saved bags in Supabase (ffg_inventory_bags)
      const savedMatches: { bag: FfgInventoryBag; match: ParsedQualityRow; barcode: string }[] = [];
      inventoryBags.forEach((bag) => {
        const bagCode = normalizeBarcode(bag.barcode);
        if (!bagCode || bag.id === undefined) return;
        const match = qualityLookup.get(bagCode);
        if (match) {
          savedMatches.push({ bag, match, barcode: bagCode });
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
                .update({
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
                })
                .eq('id', bag.id);

              if (error) throw error;
              matchedBagsCount += 1;
              matchedRowBarcodes.add(barcode);
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

      const summaryText = `${matchedBagsCount} laudos vinculados com sucesso. ${notFoundCount} códigos não encontrados no estoque atual.`;

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

    const updatedData: FfgInventoryBag = {
      ...editingBag,
      barcode: cleanBarcode,
      weight_kg: Math.round(Number(editingBag.weight_kg || 0) * 100) / 100,
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
        const { error } = await supabase
          .from('ffg_inventory_bags')
          .update({
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
          })
          .eq('id', editingBag.id);

        if (error) throw error;
        showToast('success', 'Bag Atualizado', `Bag ${updatedData.bag_code} atualizado no Supabase.`);
        setEditingBag(null);
        setEditingBagIndex(null);
        await onReload();
      } catch (err: any) {
        showSupabaseError('Falha ao Atualizar Bag no Supabase', err);
      } finally {
        setIsSavingBagEdit(false);
      }
    } else if (editingBagIndex !== null) {
      setDraftBags((prev) =>
        prev.map((b, idx) => (idx === editingBagIndex ? updatedData : b))
      );
      showToast('success', 'Bag Atualizado no Rascunho', `Bag ${updatedData.bag_code} atualizado.`);
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
            {printReportData.totalBags} bag(s) &bull;{' '}
            {printReportData.totalWeightKg.toLocaleString('pt-BR', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}{' '}
            kg
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* TOP SUMMARY CARDS (ROW 1: RESUMO DO DIA | ROW 2: ESTOQUE GERAL) */}
      {/* ========================================================================= */}
      <div className="space-y-3 print:space-y-3">
        {/* Row 1: Resumo do Dia (oculta no PDF se o relatório escolhido for Estoque Geral) */}
        <div className={`space-y-2 ${printReportData.mode === 'general' ? 'print:hidden' : ''}`}>
          <div className="flex items-center justify-between px-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 font-mono flex items-center gap-1.5">
              <ClipboardList className="w-3.5 h-3.5" />
              <span className="print:hidden">
                {`RESUMO DO DIA (${formatDateDDMMYYYY(activeSummaryDate)})`}
                {daySummaryKpis.dayInventoryCount > 0 && (
                  <span className="text-slate-500 font-normal">
                    {' '}
                    &bull; {daySummaryKpis.dayInventoryCount} inventário(s) consolidado(s)
                  </span>
                )}
              </span>
              <span className="hidden print:inline">
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 print:grid-cols-4 gap-4 print:gap-2">
            <div className="bg-white border border-emerald-200 print:border-slate-400 rounded-2xl p-4 print:p-2.5 shadow-sm print:shadow-none">
              <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 font-mono">
                Total de Bags (Dia)
              </div>
              <div className="mt-1.5 print:mt-0.5 text-3xl print:text-xl font-black font-mono text-emerald-700">
                <span className="print:hidden">{daySummaryKpis.totalBags}</span>
                <span className="hidden print:inline">{printReportData.totalBags}</span>
              </div>
              <div className="mt-1 text-[10px] text-slate-500 font-mono">
                Soma dos inventários do dia
              </div>
            </div>

            <div className="bg-white border border-slate-200 print:border-slate-400 rounded-2xl p-4 print:p-2.5 shadow-sm print:shadow-none">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600 font-mono">
                Bags Farinha de Vísceras
              </div>
              <div className="mt-1.5 print:mt-0.5 text-3xl print:text-xl font-black font-mono text-slate-900">
                <span className="print:hidden">{daySummaryKpis.viscerasBags}</span>
                <span className="hidden print:inline">{printReportData.viscerasList.length}</span>
              </div>
              <div className="mt-1 text-[10px] text-slate-500 font-mono">
                Total de vísceras no dia
              </div>
            </div>

            <div className="bg-white border border-slate-200 print:border-slate-400 rounded-2xl p-4 print:p-2.5 shadow-sm print:shadow-none">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600 font-mono">
                Bags Farinha de Penas
              </div>
              <div className="mt-1.5 print:mt-0.5 text-3xl print:text-xl font-black font-mono text-slate-900">
                <span className="print:hidden">{daySummaryKpis.penasBags}</span>
                <span className="hidden print:inline">{printReportData.penasList.length}</span>
              </div>
              <div className="mt-1 text-[10px] text-slate-500 font-mono">
                Total de penas no dia
              </div>
            </div>

            <div className="bg-white border border-slate-200 print:border-slate-400 rounded-2xl p-4 print:p-2.5 shadow-sm print:shadow-none">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600 font-mono">
                Peso Total (Dia)
              </div>
              <div className="mt-1.5 print:mt-0.5 flex items-baseline gap-1.5">
                <span className="text-2xl print:text-lg font-black font-mono text-slate-900">
                  <span className="print:hidden">
                    {daySummaryKpis.totalWeightKg.toLocaleString('pt-BR', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                  <span className="hidden print:inline">
                    {printReportData.totalWeightKg.toLocaleString('pt-BR', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </span>
                <span className="text-xs text-slate-500 font-mono">kg</span>
              </div>
              <div className="mt-1 text-[10px] text-slate-500 font-mono">
                <span className="print:hidden">
                  {(daySummaryKpis.totalWeightKg / 1000).toLocaleString('pt-BR', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
                <span className="hidden print:inline">
                  {(printReportData.totalWeightKg / 1000).toLocaleString('pt-BR', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>{' '}
                toneladas no dia
              </div>
            </div>
          </div>
        </div>

        {/* Row 2: Resumo Geral do Estoque */}
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600 font-mono flex items-center gap-1.5">
              <Boxes className="w-3.5 h-3.5 text-amber-600" />
              Resumo Geral do Estoque Consolidado ({inventories.length} inventário(s) gravado(s))
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 print:grid-cols-4 gap-4 print:gap-3">
            <div className="bg-white border border-amber-200 print:border-slate-400 rounded-2xl p-4 shadow-sm print:shadow-none">
              <div className="text-[10px] font-bold uppercase tracking-wider text-amber-700 font-mono">
                Total de Bags em Estoque
              </div>
              <div className="mt-1.5 text-3xl font-black font-mono text-amber-700">
                {globalStockKpis.totalBags}
              </div>
              <div className="mt-1 text-[10px] text-slate-500 font-mono">
                Soma de todos os inventários
              </div>
            </div>

            <div className="bg-white border border-slate-200 print:border-slate-400 rounded-2xl p-4 shadow-sm print:shadow-none">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600 font-mono">
                Bags de Vísceras em Estoque
              </div>
              <div className="mt-1.5 text-3xl font-black font-mono text-slate-900">
                {globalStockKpis.viscerasBags}
              </div>
              <div className="mt-1 text-[10px] text-slate-500 font-mono">
                Consolidado geral
              </div>
            </div>

            <div className="bg-white border border-slate-200 print:border-slate-400 rounded-2xl p-4 shadow-sm print:shadow-none">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600 font-mono">
                Bags de Penas em Estoque
              </div>
              <div className="mt-1.5 text-3xl font-black font-mono text-slate-900">
                {globalStockKpis.penasBags}
              </div>
              <div className="mt-1 text-[10px] text-slate-500 font-mono">
                Consolidado geral
              </div>
            </div>

            <div className="bg-white border border-slate-200 print:border-slate-400 rounded-2xl p-4 shadow-sm print:shadow-none">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600 font-mono">
                Peso Total Acumulado
              </div>
              <div className="mt-1.5 flex items-baseline gap-1.5">
                <span className="text-2xl font-black font-mono text-slate-900">
                  {globalStockKpis.totalWeightKg.toLocaleString('pt-BR', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
                <span className="text-xs text-slate-500 font-mono">kg</span>
              </div>
              <div className="mt-1 text-[10px] text-slate-500 font-mono">
                {(globalStockKpis.totalWeightKg / 1000).toLocaleString('pt-BR', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}{' '}
                toneladas em estoque
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

        <div className="flex items-center gap-2">
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

          {/* Saved Inventories Strip */}
          {inventories.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 font-mono">
                  Inventários Salvos no Supabase ({inventories.length})
                </h3>
                {!selectedInventoryId && (
                  <span className="text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-0.5 rounded-full">
                    Criando Novo Inventário
                  </span>
                )}
              </div>

              <div className="flex gap-2.5 overflow-x-auto pb-1">
                {inventories.map((inv) => {
                  const isActive = selectedInventoryId === String(inv.id);
                  const invBagCount = inventoryBags.filter(
                    (b) => String(b.inventory_id) === String(inv.id)
                  ).length;

                  return (
                    <div
                      key={inv.id}
                      onClick={() => {
                        setSelectedInventoryId(String(inv.id));
                        setIsEditingHeader(false);
                      }}
                      className={`min-w-[235px] cursor-pointer rounded-xl p-3 border transition-all flex flex-col justify-between gap-2 ${
                        isActive
                          ? 'bg-emerald-50 border-emerald-300 shadow-xs'
                          : 'bg-slate-50 border-slate-200 hover:bg-white'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full font-bold font-mono border ${
                            inv.flour_type === 'Vísceras'
                              ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                              : 'bg-sky-100 text-sky-800 border-sky-300'
                          }`}
                        >
                          {inv.flour_type}
                        </span>
                        <div
                          className="flex items-center gap-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() => handleSelectAndEditInventory(inv)}
                            className="p-1 text-slate-500 hover:text-emerald-700 rounded hover:bg-white transition-colors"
                            title="Editar Inventário"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setInventoryPendingDelete(inv)}
                            className="p-1 text-slate-400 hover:text-rose-600 rounded hover:bg-white transition-colors"
                            title="Excluir Inventário"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      <div>
                        <div className="text-xs font-black font-mono text-slate-900">
                          {formatDateDDMMYYYY(inv.inventory_date)} &bull;{' '}
                          {(inv.inventory_time || '').slice(0, 5)}
                        </div>
                        <div className="text-[11px] text-slate-600 truncate mt-0.5">
                          {inv.participants}
                        </div>
                      </div>

                      <div className="text-[10px] font-mono font-semibold text-slate-500">
                        {invBagCount} bag(s) registrado(s)
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Header Form: Cadastro / Edição do Inventário */}
          <form
            onSubmit={handleSaveInventoryHeader}
            className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-emerald-700 font-mono">
                    {selectedInventoryId
                      ? isEditingHeader
                        ? 'Editando Inventário Existente'
                        : 'Cabeçalho do Inventário Selecionado'
                      : 'Novo Inventário de Estoque'}
                  </span>
                </div>
                <h2 className="text-lg font-black text-slate-900 tracking-tight">
                  Dados do Inventário & Participantes
                </h2>
              </div>

              <div className="flex items-center gap-2">
                {selectedInventoryId && !isEditingHeader ? (
                  <button
                    type="button"
                    onClick={() => setIsEditingHeader(true)}
                    className="px-3.5 py-2 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 rounded-xl text-xs font-bold flex items-center gap-1.5"
                  >
                    <Pencil className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Editar Cabeçalho</span>
                  </button>
                ) : (
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
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Tipo de Farinha *
                </label>
                <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200">
                  {(['Vísceras', 'Penas'] as FlourType[]).map((ft) => (
                    <button
                      key={ft}
                      type="button"
                      disabled={Boolean(selectedInventoryId && !isEditingHeader)}
                      onClick={() => setFlourType(ft)}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
                        flourType === ft
                          ? 'bg-emerald-600 text-white shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      } disabled:opacity-75`}
                    >
                      {ft}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Data do Inventário *
                </label>
                <input
                  type="date"
                  value={inventoryDate}
                  disabled={Boolean(selectedInventoryId && !isEditingHeader)}
                  onChange={(e) => setInventoryDate(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs text-slate-900 font-mono font-semibold focus:border-emerald-500 focus:outline-none disabled:bg-slate-50"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Horário do Inventário *
                </label>
                <input
                  type="time"
                  value={inventoryTime}
                  disabled={Boolean(selectedInventoryId && !isEditingHeader)}
                  onChange={(e) => setInventoryTime(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs text-slate-900 font-mono font-semibold focus:border-emerald-500 focus:outline-none disabled:bg-slate-50"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Pessoas que Participaram *
                </label>
                <input
                  type="text"
                  value={participants}
                  disabled={Boolean(selectedInventoryId && !isEditingHeader)}
                  onChange={(e) => setParticipants(e.target.value)}
                  placeholder="Ex.: João Silva, Maria Oliveira"
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs text-slate-900 focus:border-emerald-500 focus:outline-none disabled:bg-slate-50"
                />
              </div>
            </div>
          </form>

          {/* Import Excel + Quality Image OCR + Manual Bag Entry */}
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

          {/* Manual Quick Bag Entry Form */}
          {showManualBagForm && (
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

          {/* Tabela: Lista de Bags (Inventário) */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200">
              <div>
                <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                  <Scale className="w-5 h-5 text-emerald-600" />
                  Lista de Bags ({activeInventoryBags.length})
                </h3>
                <p className="text-xs text-slate-500">
                  {selectedInventory
                    ? `Inventário de ${formatDateDDMMYYYY(selectedInventory.inventory_date)} (${selectedInventory.flour_type}) • Participantes: ${selectedInventory.participants}`
                    : 'Bags no rascunho do novo inventário (clique em "Salvar Inventário no Supabase" para gravar)'}
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-center text-xs">
                <thead className="bg-slate-100 text-slate-700 uppercase tracking-wider border-b border-slate-200 font-mono">
                  <tr>
                    <th className="px-3 py-2.5 text-center">Código</th>
                    <th className="px-3 py-2.5 text-center">Descrição</th>
                    <th className="px-3 py-2.5 text-center">Cód. Bag</th>
                    <th className="px-3 py-2.5 text-center">Data Produção</th>
                    <th className="px-3 py-2.5 text-center">Data Apontamento</th>
                    <th className="px-3 py-2.5 text-center">Hora Apont.</th>
                    <th className="px-3 py-2.5 text-center">Período</th>
                    <th className="px-3 py-2.5 text-center">Peso (kg)</th>
                    <th className="px-3 py-2.5 text-center">Código de Barra</th>
                    <th className="px-3 py-2.5 text-center print:hidden">Qualidade / Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 font-mono text-slate-800">
                  {activeInventoryBags.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-4 py-10 text-center text-slate-500 font-sans">
                        Nenhum bag cadastrado neste inventário. Importe uma planilha Excel/CSV ou adicione manualmente acima.
                      </td>
                    </tr>
                  ) : (
                    activeInventoryBags.map((bag, idx) => {
                      const isBlocked = Boolean(bag.is_blocked);
                      const rowKey = bag.id !== undefined ? String(bag.id) : `draft-${idx}`;
                      return (
                        <tr
                          key={bag.id ?? `draft-${idx}`}
                          className={`transition-colors ${
                            isBlocked ? 'bg-red-50 hover:bg-red-100/70' : 'hover:bg-slate-50'
                          }`}
                        >
                          <td
                            className={`px-3 py-2.5 text-center font-semibold text-slate-900 ${
                              isBlocked ? 'opacity-75' : ''
                            }`}
                          >
                            {bag.product_code}
                          </td>
                          <td
                            className={`px-3 py-2.5 text-center font-sans text-slate-800 max-w-[220px] truncate ${
                              isBlocked ? 'opacity-75' : ''
                            }`}
                          >
                            {bag.product_description}
                          </td>
                          <td
                            className={`px-3 py-2.5 text-center font-bold text-slate-900 ${
                              isBlocked ? 'opacity-75' : ''
                            }`}
                          >
                            {bag.bag_code}
                          </td>
                          <td
                            className={`px-3 py-2.5 text-center whitespace-nowrap ${
                              isBlocked ? 'opacity-75' : ''
                            }`}
                          >
                            {formatDateDDMMYYYY(bag.production_date)}
                          </td>
                          <td
                            className={`px-3 py-2.5 text-center whitespace-nowrap ${
                              isBlocked ? 'opacity-75' : ''
                            }`}
                          >
                            {formatDateDDMMYYYY(bag.posting_date)}
                          </td>
                          <td
                            className={`px-3 py-2.5 text-center whitespace-nowrap ${
                              isBlocked ? 'opacity-75' : ''
                            }`}
                          >
                            {(bag.posting_time || '').slice(0, 5)}
                          </td>
                          <td
                            className={`px-3 py-2.5 text-center font-bold ${
                              isBlocked ? 'opacity-75' : ''
                            }`}
                          >
                            <span className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700 text-[10px]">
                              {bag.period}
                            </span>
                          </td>
                          <td
                            className={`px-3 py-2.5 text-center font-bold text-emerald-700 whitespace-nowrap ${
                              isBlocked ? 'opacity-75' : ''
                            }`}
                          >
                            {Number(bag.weight_kg || 0).toLocaleString('pt-BR', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </td>
                          <td
                            className={`px-3 py-2.5 text-center font-semibold text-slate-900 whitespace-nowrap ${
                              isBlocked ? 'opacity-75' : ''
                            }`}
                          >
                            {bag.barcode}
                          </td>
                          <td className="px-3 py-2.5 text-center whitespace-nowrap print:hidden">
                            <div className="flex items-center justify-center gap-1.5">
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
                                  setEditingBagIndex(bag.id === undefined ? idx : null);
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
                                    bag.id === undefined ? idx : undefined
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
                                    draftIndex: bag.id === undefined ? idx : undefined,
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

              <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-slate-300 text-xs">
                <span className="text-slate-500 font-mono">Farinha:</span>
                <select
                  value={qualityFlourFilter}
                  onChange={(e) => setQualityFlourFilter(e.target.value)}
                  className="bg-transparent text-slate-900 font-mono font-bold focus:outline-none cursor-pointer"
                >
                  <option value="Todas">Todas</option>
                  <option value="Vísceras">Vísceras</option>
                  <option value="Penas">Penas</option>
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
        {printReportData.viscerasList.length === 0 && printReportData.penasList.length === 0 ? (
          <div className="border border-slate-400 rounded-xl p-6 text-center text-sm text-slate-700">
            Nenhum bag encontrado para os critérios selecionados.
          </div>
        ) : (
          <>
            {(['Vísceras', 'Penas'] as FlourType[]).map((groupType, groupIndex) => {
              const bagsList =
                groupType === 'Vísceras'
                  ? printReportData.viscerasList
                  : printReportData.penasList;
              const groupWeightKg =
                groupType === 'Vísceras'
                  ? printReportData.viscerasWeightKg
                  : printReportData.penasWeightKg;
              const groupInventories =
                groupType === 'Vísceras'
                  ? printReportData.viscerasInventories
                  : printReportData.penasInventories;

              if (bagsList.length === 0) return null;

              const needsPageBreak =
                groupIndex === 1 && printReportData.viscerasList.length > 0;

              return (
                <React.Fragment key={groupType}>
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
                          Farinha de {groupType}{' '}
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
                        <span>{bagsList.length} bag(s) &bull; </span>
                        <span>
                          {groupWeightKg.toLocaleString('pt-BR', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}{' '}
                          kg
                        </span>
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
                            Cód. Bag
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
                            Peso (kg)
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
                          if (groupType === 'Vísceras') {
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
                          } else {
                            // Farinha de Penas: nunca exibe Standard/Comercial
                            qualityCellContent = hasNumericLab ? (
                              <span className="font-bold text-blue-800">Com Laudo</span>
                            ) : (
                              <span className="text-slate-500">Sem Laudo</span>
                            );
                          }

                          return (
                            <tr key={bag.id ?? `print-${groupType}-${idx}`}>
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
                                {Number(bag.weight_kg || 0).toLocaleString('pt-BR', {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}
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
                            TOTAL FARINHA DE {groupType.toUpperCase()} ({bagsList.length} bags)
                          </td>
                          <td className="px-1.5 py-1 text-center border border-slate-400 whitespace-nowrap">
                            {groupWeightKg.toLocaleString('pt-BR', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}{' '}
                            kg
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
                    <span className="text-slate-400 block">Peso</span>
                    <span className="font-bold text-emerald-700">
                      {Number(infoModalBag.weight_kg || 0).toLocaleString('pt-BR', {
                        minimumFractionDigits: 2,
                      })}{' '}
                      kg
                    </span>
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
