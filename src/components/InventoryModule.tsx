import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  FfgInventory,
  FfgInventoryBag,
  FlourType,
  ParsedQualityRow,
} from '../types';
import { supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import { parseInventoryBagsExcel } from '../lib/excelParser';
import {
  PackageCheck,
  Upload,
  Plus,
  Save,
  Pencil,
  Trash2,
  Info,
  Camera,
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

const renderClassificationBadge = (classification?: string | null) => {
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
  const qualityImageInputRef = useRef<HTMLInputElement>(null);
  const [loadingExcel, setLoadingExcel] = useState<boolean>(false);
  const [loadingOcr, setLoadingOcr] = useState<boolean>(false);
  const [isSavingInventory, setIsSavingInventory] = useState<boolean>(false);
  const [ocrSummary, setOcrSummary] = useState<{
    fileName: string;
    totalExtracted: number;
    matchedCount: number;
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

  // Quality Tab Filters
  const [qualityClassFilter, setQualityClassFilter] = useState<string>('Todas');
  const [qualityFlourFilter, setQualityFlourFilter] = useState<string>('Todas');
  const [qualitySearch, setQualitySearch] = useState<string>('');

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

  // ROW 1 KPIs: Resumo do Inventário Selecionado
  const currentInventoryKpis = useMemo(() => {
    const totalBags = activeInventoryBags.length;
    let viscerasBags = 0;
    let penasBags = 0;
    let totalWeightKg = 0;

    activeInventoryBags.forEach((bag) => {
      const weight = Number(bag.weight_kg || 0);
      totalWeightKg += weight;
      const type = selectedInventory
        ? selectedInventory.flour_type
        : flourType || inferBagFlourType(bag, inventoryMap);
      const descUpper = (bag.product_description || '').toUpperCase();
      if (descUpper.includes('PENA')) {
        penasBags += 1;
      } else if (descUpper.includes('VISC') || descUpper.includes('VÍSC')) {
        viscerasBags += 1;
      } else if (type === 'Penas') {
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
  }, [activeInventoryBags, selectedInventory, flourType, inventoryMap]);

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
      else pendingCount += 1;

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
      if (qualityClassFilter === 'Sem Laudo' && cls !== '') return false;

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
    setOcrSummary(null);
  };

  // Start editing an existing inventory
  const handleSelectAndEditInventory = (inv: FfgInventory) => {
    setSelectedInventoryId(String(inv.id));
    setFlourType(inv.flour_type);
    setInventoryDate(inv.inventory_date.split('T')[0]);
    setInventoryTime((inv.inventory_time || '00:00').slice(0, 5));
    setParticipants(inv.participants || '');
    setIsEditingHeader(true);
    setOcrSummary(null);
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

  // Upload Quality Image -> Gemini Vision OCR -> Match Barcodes -> Update Supabase / Draft
  const handleQualityImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoadingOcr(true);
    setOcrSummary(null);
    try {
      const imageBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Não foi possível ler o arquivo de imagem.'));
        reader.readAsDataURL(file);
      });

      const response = await fetch('/api/inventory/parse-quality-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64,
          mimeType: file.type || 'image/png',
        }),
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result?.error || 'Falha ao analisar imagem com Gemini Vision.');
      }

      const extractedRows: ParsedQualityRow[] = Array.isArray(result.rows) ? result.rows : [];
      if (extractedRows.length === 0) {
        showToast(
          'warning',
          'Nenhuma Linha Encontrada',
          'O OCR não identificou linhas com N° Código de Barras na imagem anexada.'
        );
        return;
      }

      // Build lookup map by normalized barcode (exact + stripped leading zeroes fallback)
      const ocrLookup = new Map<string, ParsedQualityRow>();
      extractedRows.forEach((row) => {
        const code = normalizeBarcode(row.barcode);
        if (code) {
          ocrLookup.set(code, row);
          const stripped = code.replace(/^0+/, '');
          if (stripped && !ocrLookup.has(stripped)) {
            ocrLookup.set(stripped, row);
          }
        }
      });

      const findMatch = (barcode: string): ParsedQualityRow | undefined => {
        const clean = normalizeBarcode(barcode);
        if (!clean) return undefined;
        return ocrLookup.get(clean) || ocrLookup.get(clean.replace(/^0+/, ''));
      };

      const matchedBarcodes = new Set<string>();
      let updatedCount = 0;

      // 1. Update draftBags if creating a new inventory
      if (!selectedInventoryId && draftBags.length > 0) {
        const updatedDraft = draftBags.map((bag) => {
          const match = findMatch(bag.barcode);
          if (!match) return bag;
          updatedCount += 1;
          matchedBarcodes.add(normalizeBarcode(match.barcode));
          return {
            ...bag,
            quality_acidity: match.acidity,
            quality_peroxide: match.peroxide,
            quality_moisture: match.moisture,
            quality_ether_extract: match.ether_extract,
            quality_crude_protein: match.crude_protein,
            quality_mineral_matter: match.mineral_matter,
            quality_digestibility: match.digestibility,
            quality_classification: match.classification
              ? match.classification.trim().toUpperCase()
              : null,
          };
        });
        setDraftBags(updatedDraft);
      }

      // 2. Also match and update saved bags in Supabase (across stock/active inventory)
      const savedMatches = inventoryBags
        .map((bag) => ({ bag, match: findMatch(bag.barcode) }))
        .filter((entry): entry is { bag: FfgInventoryBag; match: ParsedQualityRow } =>
          Boolean(entry.match && entry.bag.id !== undefined)
        );

      if (savedMatches.length > 0) {
        await Promise.all(
          savedMatches.map(async ({ bag, match }) => {
            const { error } = await supabase
              .from('ffg_inventory_bags')
              .update({
                quality_acidity: match.acidity,
                quality_peroxide: match.peroxide,
                quality_moisture: match.moisture,
                quality_ether_extract: match.ether_extract,
                quality_crude_protein: match.crude_protein,
                quality_mineral_matter: match.mineral_matter,
                quality_digestibility: match.digestibility,
                quality_classification: match.classification
                  ? match.classification.trim().toUpperCase()
                  : null,
              })
              .eq('id', bag.id);

            if (error) throw error;
            updatedCount += 1;
            matchedBarcodes.add(normalizeBarcode(match.barcode));
          })
        );
        await onReload();
      }

      const unmatchedBarcodes = extractedRows
        .map((r) => normalizeBarcode(r.barcode))
        .filter((code) => code && !matchedBarcodes.has(code));

      setOcrSummary({
        fileName: file.name,
        totalExtracted: extractedRows.length,
        matchedCount: updatedCount,
        unmatchedBarcodes,
      });

      if (updatedCount > 0) {
        showToast(
          'success',
          'Laudos de Qualidade Vinculados',
          `${updatedCount} bag(s) atualizados automaticamente a partir de ${extractedRows.length} linha(s) lida(s) na imagem.`
        );
      } else {
        showToast(
          'info',
          'OCR Concluído Sem Correspondência',
          `${extractedRows.length} linha(s) lida(s), mas nenhum Código de Barra correspondeu aos bags cadastrados.`
        );
      }
    } catch (err: any) {
      showToast(
        'error',
        'Erro na Leitura de Qualidade (Gemini Vision)',
        err?.message || 'Falha ao processar a imagem.'
      );
    } finally {
      setLoadingOcr(false);
      if (qualityImageInputRef.current) qualityImageInputRef.current.value = '';
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

      {/* ========================================================================= */}
      {/* TOP SUMMARY CARDS (ROW 1: INVENTÁRIO SELECIONADO | ROW 2: ESTOQUE GERAL) */}
      {/* ========================================================================= */}
      <div className="space-y-3">
        {/* Row 1: Resumo do Inventário Selecionado */}
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 font-mono flex items-center gap-1.5">
              <ClipboardList className="w-3.5 h-3.5" />
              {selectedInventory
                ? `Resumo do Inventário Selecionado (${formatDateDDMMYYYY(selectedInventory.inventory_date)} • ${selectedInventory.flour_type})`
                : 'Resumo do Novo Inventário (Rascunho)'}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-emerald-200 rounded-2xl p-4 shadow-sm">
              <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 font-mono">
                Total de Bags (Inventário)
              </div>
              <div className="mt-1.5 text-3xl font-black font-mono text-emerald-700">
                {currentInventoryKpis.totalBags}
              </div>
              <div className="mt-1 text-[10px] text-slate-500 font-mono">
                Bags listados neste inventário
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600 font-mono">
                Bags Farinha de Vísceras
              </div>
              <div className="mt-1.5 text-3xl font-black font-mono text-slate-900">
                {currentInventoryKpis.viscerasBags}
              </div>
              <div className="mt-1 text-[10px] text-slate-500 font-mono">
                No inventário atual
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600 font-mono">
                Bags Farinha de Penas
              </div>
              <div className="mt-1.5 text-3xl font-black font-mono text-slate-900">
                {currentInventoryKpis.penasBags}
              </div>
              <div className="mt-1 text-[10px] text-slate-500 font-mono">
                No inventário atual
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600 font-mono">
                Peso Total (Inventário)
              </div>
              <div className="mt-1.5 flex items-baseline gap-1.5">
                <span className="text-2xl font-black font-mono text-slate-900">
                  {currentInventoryKpis.totalWeightKg.toLocaleString('pt-BR', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
                <span className="text-xs text-slate-500 font-mono">kg</span>
              </div>
              <div className="mt-1 text-[10px] text-slate-500 font-mono">
                {(currentInventoryKpis.totalWeightKg / 1000).toLocaleString('pt-BR', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}{' '}
                toneladas
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-amber-200 rounded-2xl p-4 shadow-sm">
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

            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
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

            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
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

            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
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
      {/* SUB-TABS NAVIGATION */}
      {/* ========================================================================= */}
      <div className="bg-white border border-slate-200 rounded-2xl p-2 shadow-sm flex flex-wrap items-center justify-between gap-3">
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

      {/* ========================================================================= */}
      {/* SUB-TAB 1: LISTA DE BAGS (INVENTÁRIO) */}
      {/* ========================================================================= */}
      {subTab === 'bags' && (
        <div className="space-y-6">

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

            {/* Card B: Vinculação Automática de Qualidade via Imagem (Gemini Vision OCR) */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600">
                    <Camera className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      2. Vincular Qualidade via Imagem do Relatório (OCR)
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      Cruza automaticamente o N° Código de Barras da foto com os bags e grava os laudos
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <input
                  type="file"
                  ref={qualityImageInputRef}
                  accept="image/*"
                  onChange={handleQualityImageChange}
                  className="hidden"
                  id="inventory-quality-image-input"
                />
                <label
                  htmlFor="inventory-quality-image-input"
                  className="cursor-pointer px-4 py-2.5 bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-800 rounded-xl text-xs font-bold flex items-center gap-2 transition-colors shadow-2xs"
                >
                  {loadingOcr ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <FlaskConical className="w-4 h-4" />
                  )}
                  <span>
                    {loadingOcr
                      ? 'Lendo Relatório com Gemini Vision...'
                      : 'Anexar Imagem do Relatório de Qualidade'}
                  </span>
                </label>
              </div>

              {ocrSummary && (
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1">
                  <div className="flex items-center justify-between font-semibold text-slate-800">
                    <span className="flex items-center gap-1.5 truncate">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      {ocrSummary.fileName}
                    </span>
                    <span className="font-mono text-emerald-700 shrink-0">
                      {ocrSummary.matchedCount} / {ocrSummary.totalExtracted} vinculado(s)
                    </span>
                  </div>
                  {ocrSummary.unmatchedBarcodes.length > 0 && (
                    <p className="text-[10px] text-slate-500 font-mono">
                      Códigos sem bag correspondente: {ocrSummary.unmatchedBarcodes.slice(0, 6).join(', ')}
                      {ocrSummary.unmatchedBarcodes.length > 6 ? '...' : ''}
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
                    <th className="px-3 py-2.5 text-center">Qualidade / Ações</th>
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
                    activeInventoryBags.map((bag, idx) => (
                      <tr key={bag.id ?? `draft-${idx}`} className="hover:bg-slate-50 transition-colors">
                        <td className="px-3 py-2.5 text-center font-semibold text-slate-900">
                          {bag.product_code}
                        </td>
                        <td className="px-3 py-2.5 text-center font-sans text-slate-800 max-w-[220px] truncate">
                          {bag.product_description}
                        </td>
                        <td className="px-3 py-2.5 text-center font-bold text-slate-900">
                          {bag.bag_code}
                        </td>
                        <td className="px-3 py-2.5 text-center whitespace-nowrap">
                          {formatDateDDMMYYYY(bag.production_date)}
                        </td>
                        <td className="px-3 py-2.5 text-center whitespace-nowrap">
                          {formatDateDDMMYYYY(bag.posting_date)}
                        </td>
                        <td className="px-3 py-2.5 text-center whitespace-nowrap">
                          {(bag.posting_time || '').slice(0, 5)}
                        </td>
                        <td className="px-3 py-2.5 text-center font-bold">
                          <span className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700 text-[10px]">
                            {bag.period}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-center font-bold text-emerald-700 whitespace-nowrap">
                          {Number(bag.weight_kg || 0).toLocaleString('pt-BR', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </td>
                        <td className="px-3 py-2.5 text-center font-semibold text-slate-900 whitespace-nowrap">
                          {bag.barcode}
                        </td>
                        <td className="px-3 py-2.5 text-center whitespace-nowrap">
                          <div className="flex items-center justify-center gap-1.5">
                            {renderClassificationBadge(bag.quality_classification)}
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
                    ))
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
        <div className="space-y-6">

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
                htmlFor="inventory-quality-image-input"
                className="cursor-pointer px-3.5 py-2 bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-800 rounded-xl text-xs font-bold flex items-center gap-2 transition-colors"
              >
                {loadingOcr ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Camera className="w-3.5 h-3.5" />
                )}
                <span>Atualizar Laudos via Imagem</span>
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
                      <tr key={bag.id} className="hover:bg-slate-50 transition-colors">
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
                          {renderClassificationBadge(bag.quality_classification)}
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
      {/* MODAL FLUTUANTE (i): DETALHES DE QUALIDADE DO BAG */}
      {/* ========================================================================= */}
      {infoModalBag && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in">
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
                  {renderClassificationBadge(infoModalBag.quality_classification)}
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
                  {renderClassificationBadge(infoModalBag.quality_classification)}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in">
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
