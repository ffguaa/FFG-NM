import React, { useState, useMemo, useRef } from 'react';
import {
  FfgInventoryBag,
  FfgShipment,
  FreightType,
  ShipmentStatus,
} from '../types';
import { supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import { parseShippingBagsExcel, normalizeBarcodeKey } from '../lib/excelParser';
import {
  Truck,
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  Ban,
  PackageCheck,
  Search,
  X,
  Trash2,
  Eye,
  Plus,
  RefreshCw,
  Copy,
  Database,
  Scale,
  DollarSign,
  Calendar,
  ArrowRightCircle,
  Pencil,
  Printer,
  Save,
  Undo2,
} from 'lucide-react';

interface ShippingModuleProps {
  shipments: FfgShipment[];
  inventoryBags: FfgInventoryBag[];
  shipmentsSchemaReady: boolean;
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
  return normalizeBarcodeKey(code);
};

const hasBagNumericQuality = (bag: FfgInventoryBag): boolean => {
  const fields = [
    bag.quality_acidity,
    bag.quality_peroxide,
    bag.quality_moisture,
    bag.quality_ether_extract,
    bag.quality_crude_protein,
    bag.quality_mineral_matter,
    bag.quality_digestibility,
  ];
  return fields.some(
    (v) => v !== null && v !== undefined && String(v).trim() !== '' && !isNaN(Number(v))
  );
};

const hasBagAnyQuality = (bag: FfgInventoryBag): boolean => {
  return hasBagNumericQuality(bag) || Boolean((bag.quality_classification || '').trim());
};

const inferBagProductFamily = (bag: FfgInventoryBag): string => {
  const hay = `${bag.product_description || ''} ${bag.product_code || ''}`.toUpperCase();
  if (hay.includes('PENA')) return 'PENA';
  if (hay.includes('GRAXO')) return 'GRAXO';
  if (hay.includes('ÓLEO') || hay.includes('OLEO')) return 'OLEO';
  return 'VISCERA';
};

const enrichBagsWithBatchLaudo = (
  targetBags: FfgInventoryBag[],
  allInventoryBags: FfgInventoryBag[]
): FfgInventoryBag[] => {
  if (targetBags.length === 0) return targetBags;

  const byFamilyDatePeriod = new Map<string, FfgInventoryBag>();
  const byDatePeriod = new Map<string, FfgInventoryBag>();

  const indexDonor = (bag: FfgInventoryBag) => {
    if (!hasBagNumericQuality(bag)) return;
    const prodDate = (bag.production_date || '').split('T')[0];
    const period = (bag.period || '').trim().toUpperCase();
    if (!prodDate || !period) return;

    const family = inferBagProductFamily(bag);
    const fullKey = `${family}|${prodDate}|${period}`;
    const fallbackKey = `${prodDate}|${period}`;

    if (!byFamilyDatePeriod.has(fullKey)) {
      byFamilyDatePeriod.set(fullKey, bag);
    }
    if (!byDatePeriod.has(fallbackKey)) {
      byDatePeriod.set(fallbackKey, bag);
    }
  };

  // Prefer bags already inside the shipment first, then fallback to the full inventory
  targetBags.forEach(indexDonor);
  allInventoryBags.forEach(indexDonor);

  return targetBags.map((bag) => {
    if (hasBagNumericQuality(bag)) return bag;
    const prodDate = (bag.production_date || '').split('T')[0];
    const period = (bag.period || '').trim().toUpperCase();
    if (!prodDate || !period) return bag;

    const family = inferBagProductFamily(bag);
    const donor =
      byFamilyDatePeriod.get(`${family}|${prodDate}|${period}`) ||
      byDatePeriod.get(`${prodDate}|${period}`);

    if (!donor) return bag;

    return {
      ...bag,
      quality_acidity: donor.quality_acidity ?? null,
      quality_peroxide: donor.quality_peroxide ?? null,
      quality_moisture: donor.quality_moisture ?? null,
      quality_ether_extract: donor.quality_ether_extract ?? null,
      quality_crude_protein: donor.quality_crude_protein ?? null,
      quality_mineral_matter: donor.quality_mineral_matter ?? null,
      quality_digestibility: donor.quality_digestibility ?? null,
      quality_classification:
        (bag.quality_classification || '').trim() ||
        (donor.quality_classification || '').trim() ||
        null,
    };
  });
};

const formatBagQualityStatus = (bag: FfgInventoryBag): string => {
  const desc = (bag.product_description || '').toUpperCase();
  const isPenas = desc.includes('PENA');
  const cls = (bag.quality_classification || '').trim().toUpperCase();
  if (isPenas) {
    return hasBagAnyQuality(bag) ? 'Com Laudo' : 'Sem Laudo';
  }
  if (cls) return cls;
  return hasBagNumericQuality(bag) ? 'Com Laudo' : 'Aguardando';
};

const normalizeProductOption = (rawProduct?: string | null): string => {
  const matched = SHIPPING_PRODUCTS.find((p) => p === rawProduct);
  if (matched) return matched;
  const upper = (rawProduct || '').toUpperCase();
  if (upper.includes('PENA')) return 'Farinha de Penas';
  if (upper.includes('GRAXO')) return 'Óleo Graxo';
  if (upper.includes('ÓLEO') || upper.includes('OLEO')) return 'Óleo de Aves';
  return 'Farinha de Vísceras';
};

const SHIPPING_SETUP_SQL = `-- Execute no SQL Editor do Supabase para habilitar Carregamentos / Expedição:
CREATE TABLE IF NOT EXISTS public.ffg_shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_date date NOT NULL,
  product text NOT NULL,
  client text NOT NULL,
  programmed_volume_kg numeric(12,2) NOT NULL DEFAULT 0,
  actual_weight_kg numeric(12,2) NOT NULL DEFAULT 0,
  bag_count integer NOT NULL DEFAULT 0,
  price_per_kg numeric(10,2) NOT NULL DEFAULT 0,
  payment_condition text NOT NULL DEFAULT 'À Vista',
  freight_type text NOT NULL DEFAULT 'FOB',
  documentation text NOT NULL DEFAULT 'LAUDO/NF/DCPOA',
  carrier text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'Programada',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ffg_inventory_bags
ADD COLUMN IF NOT EXISTS is_dispatched boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS shipment_id uuid REFERENCES public.ffg_shipments(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS dispatched_at timestamptz;`;

const SHIPPING_PRODUCTS = [
  'Farinha de Penas',
  'Farinha de Vísceras',
  'Óleo de Aves',
  'Óleo Graxo',
] as const;

export const ShippingModule: React.FC<ShippingModuleProps> = ({
  shipments,
  inventoryBags,
  shipmentsSchemaReady,
  onReload,
}) => {
  const { showToast, showSupabaseError } = useToast();

  // Form states
  const [editingShipmentId, setEditingShipmentId] = useState<string | number | null>(null);
  const [shipmentDate, setShipmentDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [product, setProduct] = useState<string>('Farinha de Vísceras');
  const [client, setClient] = useState<string>('');
  const [programmedVolumeKg, setProgrammedVolumeKg] = useState<string>('');
  const [pricePerKg, setPricePerKg] = useState<string>('');
  const [paymentCondition, setPaymentCondition] = useState<string>('À Vista');
  const [freightType, setFreightType] = useState<FreightType>('FOB');
  const [documentation, setDocumentation] = useState<string>('LAUDO/NF/DCPOA');
  const [carrier, setCarrier] = useState<string>('');
  const [status, setStatus] = useState<ShipmentStatus>('Programada');

  // Staged barcodes from Excel/CSV or manual scanner input
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string>('');
  const [stagedBarcodes, setStagedBarcodes] = useState<string[]>([]);
  const [manualBarcodeInput, setManualBarcodeInput] = useState<string>('');
  const [loadingExcel, setLoadingExcel] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // History filters & modals
  const [historySearch, setHistorySearch] = useState<string>('');
  const [historyProductFilter, setHistoryProductFilter] = useState<string>('Todos');
  const [historyStatusFilter, setHistoryStatusFilter] = useState<'Todos' | ShipmentStatus>('Todos');
  const [viewingShipmentBags, setViewingShipmentBags] = useState<FfgShipment | null>(null);
  const [shipmentPendingDelete, setShipmentPendingDelete] = useState<FfgShipment | null>(null);
  const [isDeletingShipment, setIsDeletingShipment] = useState<boolean>(false);

  // Edit Shipment Modal (general fields + unlinking bags back to stock)
  const [editModalShipment, setEditModalShipment] = useState<FfgShipment | null>(null);
  const [editForm, setEditForm] = useState<{
    shipment_date: string;
    product: string;
    client: string;
    carrier: string;
    programmed_volume_kg: string;
    price_per_kg: string;
    payment_condition: string;
    freight_type: FreightType;
    documentation: string;
    status: ShipmentStatus;
  }>({
    shipment_date: new Date().toISOString().split('T')[0],
    product: 'Farinha de Vísceras',
    client: '',
    carrier: '',
    programmed_volume_kg: '',
    price_per_kg: '',
    payment_condition: 'À Vista',
    freight_type: 'FOB',
    documentation: 'LAUDO/NF/DCPOA',
    status: 'Programada',
  });
  const [editRemovedBagIds, setEditRemovedBagIds] = useState<string[]>([]);
  const [isSavingEditModal, setIsSavingEditModal] = useState<boolean>(false);

  // Print PDF selected shipment
  const [printingShipment, setPrintingShipment] = useState<FfgShipment | null>(null);

  // Index inventory bags by normalized barcode
  const bagByBarcodeMap = useMemo(() => {
    const map = new Map<string, FfgInventoryBag>();
    inventoryBags.forEach((bag) => {
      const code = normalizeBarcode(bag.barcode);
      if (code) map.set(code, bag);
    });
    return map;
  }, [inventoryBags]);

  // Reconcile staged barcodes against Supabase inventoryBags
  const reconciliation = useMemo(() => {
    const availableBags: FfgInventoryBag[] = [];
    const blockedBags: FfgInventoryBag[] = [];
    const alreadyDispatchedBags: FfgInventoryBag[] = [];
    const notFoundBarcodes: string[] = [];

    stagedBarcodes.forEach((code) => {
      const bag = bagByBarcodeMap.get(normalizeBarcode(code));
      if (!bag) {
        notFoundBarcodes.push(code);
      } else if (bag.is_dispatched) {
        alreadyDispatchedBags.push(bag);
      } else if (bag.is_blocked) {
        blockedBags.push(bag);
      } else {
        availableBags.push(bag);
      }
    });

    const actualWeightKg = availableBags.reduce(
      (sum, b) => sum + Number(b.weight_kg || 0),
      0
    );
    const progVol = parseFloat(programmedVolumeKg) || 0;
    const diffKg = actualWeightKg - progVol;
    const diffPct = progVol > 0 ? (diffKg / progVol) * 100 : 0;
    const unitPrice = parseFloat(pricePerKg) || 0;
    const estimatedValue =
      (availableBags.length > 0 ? actualWeightKg : progVol) * unitPrice;

    return {
      availableBags,
      blockedBags,
      alreadyDispatchedBags,
      notFoundBarcodes,
      actualWeightKg,
      programmedVolumeKg: progVol,
      diffKg,
      diffPct,
      estimatedValue,
    };
  }, [stagedBarcodes, bagByBarcodeMap, programmedVolumeKg, pricePerKg]);

  // Filtered shipments history
  const filteredShipments = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    return shipments.filter((s) => {
      if (historyProductFilter !== 'Todos' && s.product !== historyProductFilter) return false;
      if (historyStatusFilter !== 'Todos' && s.status !== historyStatusFilter) return false;
      if (q) {
        const hay = `${s.client} ${s.product} ${s.carrier} ${s.documentation}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [shipments, historySearch, historyProductFilter, historyStatusFilter]);

  // Live linked bag count & weight per shipment from inventoryBags
  const linkedTotalsByShipmentId = useMemo(() => {
    const map = new Map<string, { count: number; weightKg: number }>();
    inventoryBags.forEach((b) => {
      if (b.shipment_id === null || b.shipment_id === undefined) return;
      const sid = String(b.shipment_id);
      const prev = map.get(sid) || { count: 0, weightKg: 0 };
      map.set(sid, {
        count: prev.count + 1,
        weightKg: Math.round((prev.weightKg + Number(b.weight_kg || 0)) * 100) / 100,
      });
    });
    return map;
  }, [inventoryBags]);

  const getEffectiveShipmentMetrics = (s: FfgShipment) => {
    const sid = s.id !== undefined && s.id !== null ? String(s.id) : '';
    const linked = sid ? linkedTotalsByShipmentId.get(sid) : undefined;

    let prog = Number(s.programmed_volume_kg || 0);
    let act = linked && linked.count > 0 ? linked.weightKg : Number(s.actual_weight_kg || 0);
    let bagCount = linked && linked.count > 0 ? linked.count : Number(s.bag_count || 0);
    let price = Number(s.price_per_kg || 0);
    let effectiveStatus: ShipmentStatus = s.status;

    if (editModalShipment && String(editModalShipment.id) === sid) {
      prog = parseFloat(editForm.programmed_volume_kg) || 0;
      price = parseFloat(editForm.price_per_kg) || 0;
      effectiveStatus = editForm.status;
      const removedSet = new Set(editRemovedBagIds);
      const remaining = inventoryBags.filter(
        (b) =>
          b.shipment_id !== null &&
          b.shipment_id !== undefined &&
          String(b.shipment_id) === sid &&
          (b.id === undefined || !removedSet.has(String(b.id)))
      );
      bagCount = remaining.length;
      act =
        Math.round(
          remaining.reduce((sum, b) => sum + Number(b.weight_kg || 0), 0) * 100
        ) / 100;
    } else if (editingShipmentId && String(editingShipmentId) === sid) {
      prog = parseFloat(programmedVolumeKg) || 0;
      price = parseFloat(pricePerKg) || 0;
      effectiveStatus = status;
      if (reconciliation.availableBags.length > 0) {
        bagCount = reconciliation.availableBags.length;
        act = Math.round(reconciliation.actualWeightKg * 100) / 100;
      }
    }

    const baseWeight = act > 0 ? act : prog;
    const totalVal = baseWeight * price;
    return {
      prog,
      act,
      bagCount,
      price,
      status: effectiveStatus,
      diff: act - prog,
      totalVal,
    };
  };

  // Top KPIs across all listed shipments (Programadas + Realizadas)
  const summaryKpis = useMemo(() => {
    let realizedCount = 0;
    let programmedCount = 0;
    let totalProgrammedKg = 0;
    let totalActualKg = 0;
    let totalBagsDispatched = 0;
    let totalShipmentsValue = 0;

    filteredShipments.forEach((s) => {
      const m = getEffectiveShipmentMetrics(s);
      totalProgrammedKg += m.prog;
      totalActualKg += m.act;
      totalBagsDispatched += m.bagCount;
      totalShipmentsValue += m.totalVal;

      if (m.status === 'Realizada') {
        realizedCount += 1;
      } else {
        programmedCount += 1;
      }
    });

    return {
      totalCount: filteredShipments.length,
      realizedCount,
      programmedCount,
      totalProgrammedKg,
      totalActualKg,
      totalBagsDispatched,
      totalShipmentsValue,
    };
  }, [
    filteredShipments,
    linkedTotalsByShipmentId,
    editModalShipment,
    editForm.programmed_volume_kg,
    editForm.price_per_kg,
    editForm.status,
    editRemovedBagIds,
    editingShipmentId,
    programmedVolumeKg,
    pricePerKg,
    status,
    reconciliation.availableBags,
    reconciliation.actualWeightKg,
    inventoryBags,
  ]);

  const resetForm = () => {
    setEditingShipmentId(null);
    setShipmentDate(new Date().toISOString().split('T')[0]);
    setProduct('Farinha de Vísceras');
    setClient('');
    setProgrammedVolumeKg('');
    setPricePerKg('');
    setPaymentCondition('À Vista');
    setFreightType('FOB');
    setDocumentation('LAUDO/NF/DCPOA');
    setCarrier('');
    setStatus('Programada');
    setStagedBarcodes([]);
    setUploadedFileName('');
    setManualBarcodeInput('');
  };

  const handleToggleDocToken = (token: string) => {
    const currentTokens = documentation
      .split('/')
      .map((t) => t.trim().toUpperCase())
      .filter(Boolean);
    const exists = currentTokens.includes(token);
    const nextTokens = exists
      ? currentTokens.filter((t) => t !== token)
      : [...currentTokens, token];
    setDocumentation(nextTokens.join('/'));
  };

  const handleExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoadingExcel(true);
    try {
      const result = await parseShippingBagsExcel(file);
      setStagedBarcodes(result.barcodes);
      setUploadedFileName(file.name);
      if (result.barcodes.length > 0) {
        setStatus('Realizada');
      }

      const duplicateNote =
        result.duplicateCount > 0
          ? ` (${result.duplicateCount} código(s) duplicado(s) ignorado(s))`
          : '';
      showToast(
        'success',
        'Planilha de Expedição Lida',
        `${result.barcodes.length} código(s) de barras carregado(s) para conferência${duplicateNote}.`
      );
    } catch (err: any) {
      showToast(
        'error',
        'Erro ao Ler Planilha de Expedição',
        err?.message || 'Verifique o formato do arquivo Excel/CSV.'
      );
    } finally {
      setLoadingExcel(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleAddManualBarcode = () => {
    const code = normalizeBarcode(manualBarcodeInput);
    if (!code) return;
    if (stagedBarcodes.includes(code)) {
      showToast('info', 'Código já na lista', `O código ${code} já foi adicionado.`);
      setManualBarcodeInput('');
      return;
    }
    setStagedBarcodes((prev) => [...prev, code]);
    setManualBarcodeInput('');
    setStatus('Realizada');
  };

  const handleRemoveStagedBarcode = (codeToRemove: string) => {
    setStagedBarcodes((prev) => prev.filter((c) => c !== codeToRemove));
  };

  const handleLoadShipmentForDispatch = (shipment: FfgShipment) => {
    setEditingShipmentId(shipment.id ?? null);
    setShipmentDate((shipment.shipment_date || '').split('T')[0]);
    const matchedProduct = SHIPPING_PRODUCTS.find((p) => p === shipment.product);
    if (matchedProduct) {
      setProduct(matchedProduct);
    } else {
      const upper = (shipment.product || '').toUpperCase();
      if (upper.includes('PENA')) setProduct('Farinha de Penas');
      else if (upper.includes('GRAXO')) setProduct('Óleo Graxo');
      else if (upper.includes('ÓLEO') || upper.includes('OLEO')) setProduct('Óleo de Aves');
      else setProduct('Farinha de Vísceras');
    }
    setClient(shipment.client || '');
    setProgrammedVolumeKg(
      shipment.programmed_volume_kg ? String(shipment.programmed_volume_kg) : ''
    );
    setPricePerKg(shipment.price_per_kg ? String(shipment.price_per_kg) : '');
    setPaymentCondition(shipment.payment_condition || 'À Vista');
    setFreightType((shipment.freight_type as FreightType) || 'FOB');
    setDocumentation(shipment.documentation || 'LAUDO/NF/DCPOA');
    setCarrier(shipment.carrier || '');
    setStatus(shipment.status || 'Programada');
    setStagedBarcodes([]);
    setUploadedFileName('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSubmitShipment = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!shipmentsSchemaReady) {
      showToast(
        'error',
        'Estrutura do Supabase Pendente',
        'Execute o script SQL exibido no topo da página para criar a tabela ffg_shipments.'
      );
      return;
    }

    if (!shipmentDate) {
      showToast('warning', 'Validação', 'Informe a Data do carregamento.');
      return;
    }
    if (!product.trim()) {
      showToast('warning', 'Validação', 'Informe o Produto.');
      return;
    }
    if (!client.trim()) {
      showToast('warning', 'Validação', 'Informe o Cliente.');
      return;
    }

    const progVol = parseFloat(programmedVolumeKg) || 0;
    if (progVol <= 0) {
      showToast('warning', 'Validação', 'Informe um Volume (kg) programado maior que zero.');
      return;
    }

    const hasStagedBarcodes = stagedBarcodes.length > 0;
    if (hasStagedBarcodes && reconciliation.availableBags.length === 0) {
      showToast(
        'error',
        'Nenhum Bag Válido para Baixa',
        'Todos os códigos lidos estão bloqueados, já expedidos ou não foram encontrados no estoque ativo.'
      );
      return;
    }

    if (reconciliation.blockedBags.length > 0) {
      showToast(
        'warning',
        'Bags Bloqueados Ignorados',
        `${reconciliation.blockedBags.length} bag(s) bloqueado(s) não serão expedidos e permanecerão retidos no estoque.`
      );
    }

    const finalStatus: ShipmentStatus =
      reconciliation.availableBags.length > 0 ? 'Realizada' : status;
    const nowIso = new Date().toISOString();

    setIsSubmitting(true);
    try {
      const shipmentPayload = {
        shipment_date: shipmentDate,
        product: product.trim(),
        client: client.trim(),
        programmed_volume_kg: Math.round(progVol * 100) / 100,
        actual_weight_kg:
          reconciliation.availableBags.length > 0
            ? Math.round(reconciliation.actualWeightKg * 100) / 100
            : 0,
        bag_count: reconciliation.availableBags.length,
        price_per_kg: Math.round((parseFloat(pricePerKg) || 0) * 100) / 100,
        payment_condition: paymentCondition,
        freight_type: freightType,
        documentation: documentation.trim() || 'LAUDO/NF/DCPOA',
        carrier: carrier.trim(),
        status: finalStatus,
      };

      let targetShipmentId = editingShipmentId;

      if (editingShipmentId !== null && editingShipmentId !== undefined) {
        // Fetch existing bag_count / actual_weight_kg if adding without replacing
        const { error: updateErr } = await supabase
          .from('ffg_shipments')
          .update({
            ...shipmentPayload,
            updated_at: nowIso,
          })
          .eq('id', editingShipmentId);

        if (updateErr) throw updateErr;
      } else {
        const { data: inserted, error: insertErr } = await supabase
          .from('ffg_shipments')
          .insert([shipmentPayload])
          .select()
          .single();

        if (insertErr) throw insertErr;
        targetShipmentId = inserted.id;
      }

      // Mark matched available bags as dispatched in batches of 10
      if (reconciliation.availableBags.length > 0 && targetShipmentId) {
        const bagsToDispatch = reconciliation.availableBags.filter(
          (b) => b.id !== undefined
        );
        const chunkSize = 10;
        for (let i = 0; i < bagsToDispatch.length; i += chunkSize) {
          const chunk = bagsToDispatch.slice(i, i + chunkSize);
          await Promise.all(
            chunk.map(async (bag) => {
              const { error: bagErr } = await supabase
                .from('ffg_inventory_bags')
                .update({
                  is_dispatched: true,
                  shipment_id: targetShipmentId,
                  dispatched_at: nowIso,
                })
                .eq('id', bag.id);

              if (bagErr) throw bagErr;
            })
          );
        }

        showToast(
          'success',
          'Expedição Confirmada & Estoque Baixado',
          `${bagsToDispatch.length} bag(s) (${reconciliation.actualWeightKg.toLocaleString('pt-BR', {
            minimumFractionDigits: 2,
          })} kg) baixados do estoque para ${client.trim()}.`
        );
      } else {
        showToast(
          'success',
          editingShipmentId ? 'Programação Atualizada' : 'Programação Salva',
          `Carregamento para ${client.trim()} (${formatDateDDMMYYYY(shipmentDate)}) salvo como ${finalStatus}.`
        );
      }

      resetForm();
      await onReload();
    } catch (err: any) {
      showSupabaseError('Falha ao Registrar Expedição no Supabase', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmDeleteShipment = async () => {
    if (!shipmentPendingDelete?.id) return;
    setIsDeletingShipment(true);
    try {
      // Restore any bags dispatched under this shipment back to active stock
      const linkedBags = inventoryBags.filter(
        (b) =>
          b.shipment_id !== null &&
          b.shipment_id !== undefined &&
          String(b.shipment_id) === String(shipmentPendingDelete.id)
      );

      if (linkedBags.length > 0) {
        const chunkSize = 10;
        for (let i = 0; i < linkedBags.length; i += chunkSize) {
          const chunk = linkedBags.slice(i, i + chunkSize);
          await Promise.all(
            chunk.map(async (bag) => {
              if (bag.id === undefined) return;
              const { error } = await supabase
                .from('ffg_inventory_bags')
                .update({
                  is_dispatched: false,
                  shipment_id: null,
                  dispatched_at: null,
                })
                .eq('id', bag.id);
              if (error) throw error;
            })
          );
        }
      }

      const { error: delErr } = await supabase
        .from('ffg_shipments')
        .delete()
        .eq('id', shipmentPendingDelete.id);

      if (delErr) throw delErr;

      showToast(
        'success',
        'Carregamento Excluído',
        linkedBags.length > 0
          ? `Expedição removida e ${linkedBags.length} bag(s) estornado(s) ao estoque ativo.`
          : 'Programação removida do Supabase.'
      );
      if (editingShipmentId === shipmentPendingDelete.id) {
        resetForm();
      }
      setShipmentPendingDelete(null);
      await onReload();
    } catch (err: any) {
      showSupabaseError('Falha ao Excluir Carregamento', err);
    } finally {
      setIsDeletingShipment(false);
    }
  };

  const modalLinkedBags = useMemo(() => {
    if (!viewingShipmentBags?.id) return [];
    const rawLinked = inventoryBags.filter(
      (b) =>
        b.shipment_id !== null &&
        b.shipment_id !== undefined &&
        String(b.shipment_id) === String(viewingShipmentBags.id)
    );
    return enrichBagsWithBatchLaudo(rawLinked, inventoryBags);
  }, [viewingShipmentBags, inventoryBags]);

  // Bags currently linked to the shipment open in the Edit Modal
  const editModalAllLinkedBags = useMemo(() => {
    if (!editModalShipment?.id) return [];
    return inventoryBags.filter(
      (b) =>
        b.shipment_id !== null &&
        b.shipment_id !== undefined &&
        String(b.shipment_id) === String(editModalShipment.id)
    );
  }, [editModalShipment, inventoryBags]);

  const editModalRemainingBags = useMemo(() => {
    const removedSet = new Set(editRemovedBagIds);
    return editModalAllLinkedBags.filter(
      (b) => b.id === undefined || !removedSet.has(String(b.id))
    );
  }, [editModalAllLinkedBags, editRemovedBagIds]);

  const editModalRemovedBags = useMemo(() => {
    const removedSet = new Set(editRemovedBagIds);
    return editModalAllLinkedBags.filter(
      (b) => b.id !== undefined && removedSet.has(String(b.id))
    );
  }, [editModalAllLinkedBags, editRemovedBagIds]);

  const editModalRecalculated = useMemo(() => {
    const remainingWeightKg = editModalRemainingBags.reduce(
      (sum, b) => sum + Number(b.weight_kg || 0),
      0
    );
    const progVol = parseFloat(editForm.programmed_volume_kg) || 0;
    const price = parseFloat(editForm.price_per_kg) || 0;
    const baseWeight = remainingWeightKg > 0 ? remainingWeightKg : progVol;
    const totalValue = baseWeight * price;
    return {
      remainingCount: editModalRemainingBags.length,
      remainingWeightKg: Math.round(remainingWeightKg * 100) / 100,
      totalValue,
    };
  }, [editModalRemainingBags, editForm.programmed_volume_kg, editForm.price_per_kg]);

  const handleOpenEditModal = (shipment: FfgShipment) => {
    setEditModalShipment(shipment);
    setEditForm({
      shipment_date: (shipment.shipment_date || '').split('T')[0],
      product: normalizeProductOption(shipment.product),
      client: shipment.client || '',
      carrier: shipment.carrier || '',
      programmed_volume_kg: String(shipment.programmed_volume_kg ?? ''),
      price_per_kg: String(shipment.price_per_kg ?? ''),
      payment_condition: shipment.payment_condition || 'À Vista',
      freight_type: (shipment.freight_type as FreightType) || 'FOB',
      documentation: shipment.documentation || 'LAUDO/NF/DCPOA',
      status: shipment.status || 'Programada',
    });
    setEditRemovedBagIds([]);
  };

  const handleToggleRemoveBagInEdit = (bagId: string | number) => {
    const key = String(bagId);
    setEditRemovedBagIds((prev) =>
      prev.includes(key) ? prev.filter((id) => id !== key) : [...prev, key]
    );
  };

  const handleSaveEditModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editModalShipment?.id) return;

    if (!editForm.shipment_date) {
      showToast('warning', 'Validação', 'Informe a Data do carregamento.');
      return;
    }
    if (!editForm.client.trim()) {
      showToast('warning', 'Validação', 'Informe o Cliente.');
      return;
    }
    const progVol = parseFloat(editForm.programmed_volume_kg) || 0;
    if (progVol <= 0) {
      showToast('warning', 'Validação', 'Informe um Volume Programado (kg) válido.');
      return;
    }

    setIsSavingEditModal(true);
    try {
      // 1. Return any removed bags back to active stock in Supabase
      if (editModalRemovedBags.length > 0) {
        const chunkSize = 10;
        for (let i = 0; i < editModalRemovedBags.length; i += chunkSize) {
          const chunk = editModalRemovedBags.slice(i, i + chunkSize);
          await Promise.all(
            chunk.map(async (bag) => {
              if (bag.id === undefined) return;
              const { error } = await supabase
                .from('ffg_inventory_bags')
                .update({
                  is_dispatched: false,
                  shipment_id: null,
                  dispatched_at: null,
                })
                .eq('id', bag.id);
              if (error) throw error;
            })
          );
        }
      }

      // 2. Recalculate actual weight & bag count from remaining linked bags
      const newBagCount = editModalRemainingBags.length;
      const newActualWeightKg =
        newBagCount > 0 ? editModalRecalculated.remainingWeightKg : 0;

      const { error: shipErr } = await supabase
        .from('ffg_shipments')
        .update({
          shipment_date: editForm.shipment_date,
          product: editForm.product,
          client: editForm.client.trim(),
          carrier: editForm.carrier.trim(),
          programmed_volume_kg: Math.round(progVol * 100) / 100,
          actual_weight_kg: newActualWeightKg,
          bag_count: newBagCount,
          price_per_kg: Math.round((parseFloat(editForm.price_per_kg) || 0) * 100) / 100,
          payment_condition: editForm.payment_condition,
          freight_type: editForm.freight_type,
          documentation: editForm.documentation.trim() || 'LAUDO/NF/DCPOA',
          status: editForm.status,
          updated_at: new Date().toISOString(),
        })
        .eq('id', editModalShipment.id);

      if (shipErr) throw shipErr;

      showToast(
        'success',
        'Carregamento Atualizado',
        editModalRemovedBags.length > 0
          ? `Carregamento atualizado e ${editModalRemovedBags.length} bag(s) devolvido(s) ao estoque ativo.`
          : `Dados do carregamento para ${editForm.client.trim()} atualizados com sucesso.`
      );
      setEditModalShipment(null);
      setEditRemovedBagIds([]);
      await onReload();
    } catch (err: any) {
      showSupabaseError('Falha ao Atualizar Carregamento', err);
    } finally {
      setIsSavingEditModal(false);
    }
  };

  // Linked bags for PDF printout
  const printingShipmentBags = useMemo(() => {
    if (!printingShipment?.id) return [];
    const rawLinked = inventoryBags.filter(
      (b) =>
        b.shipment_id !== null &&
        b.shipment_id !== undefined &&
        String(b.shipment_id) === String(printingShipment.id)
    );
    return enrichBagsWithBatchLaudo(rawLinked, inventoryBags);
  }, [printingShipment, inventoryBags]);

  const handlePrintShipment = (shipment: FfgShipment) => {
    setPrintingShipment(shipment);
    setTimeout(() => {
      window.print();
    }, 300);
  };

  const handleCopySql = async () => {
    try {
      await navigator.clipboard.writeText(SHIPPING_SETUP_SQL);
      showToast('success', 'SQL Copiado', 'Cole e execute no SQL Editor do Supabase.');
    } catch {
      showToast('info', 'Copiar SQL', 'Selecione o bloco SQL manualmente e copie.');
    }
  };

  return (
    <>
      <style type="text/css" media="print">{`
        @page { size: landscape; margin: 10mm; }
      `}</style>

      <div className="space-y-6 print:hidden">
        {/* Header Banner */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600 shrink-0">
            <Truck className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">
              Carregamentos &amp; Expedição FFG-NM
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Programação oficial de cargas, conferência por código de barras e baixa automática de bags no Supabase
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onReload}
          className="px-3.5 py-2 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-2xs transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5 text-emerald-600" />
          <span>Atualizar Dados</span>
        </button>
      </div>

      {/* Supabase Setup Alert if ffg_shipments table doesn't exist yet */}
      {!shipmentsSchemaReady && (
        <div className="bg-amber-50 border border-amber-300 rounded-2xl p-5 shadow-sm space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-amber-100 border border-amber-300 flex items-center justify-center text-amber-700 shrink-0 mt-0.5">
                <Database className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-amber-950">
                  Configuração Inicial no Supabase Necessária
                </h3>
                <p className="text-xs text-amber-900 mt-0.5">
                  Execute o SQL abaixo no <strong>SQL Editor</strong> do Supabase para criar a tabela{' '}
                  <code className="font-mono font-bold">ffg_shipments</code> e as colunas de expedição em{' '}
                  <code className="font-mono font-bold">ffg_inventory_bags</code>.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCopySql}
                className="px-3 py-1.5 bg-white hover:bg-amber-100 border border-amber-300 text-amber-900 rounded-lg text-xs font-bold flex items-center gap-1.5"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Copiar SQL</span>
              </button>
              <button
                type="button"
                onClick={onReload}
                className="px-3 py-1.5 bg-amber-700 hover:bg-amber-800 text-white rounded-lg text-xs font-bold flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Já Executei (Verificar)</span>
              </button>
            </div>
          </div>
          <pre className="p-3 bg-slate-900 text-emerald-300 rounded-xl text-[11px] font-mono overflow-x-auto leading-relaxed">
            {SHIPPING_SETUP_SQL}
          </pre>
        </div>
      )}

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 font-mono flex items-center gap-1.5">
            <Truck className="w-3.5 h-3.5 text-emerald-600" />
            Carregamentos Registrados
          </div>
          <div className="mt-1.5 text-3xl font-black font-mono text-slate-900">
            {summaryKpis.totalCount}
          </div>
          <div className="mt-1 text-[10px] text-slate-500 font-mono">
            {summaryKpis.realizedCount} realizada(s) &bull; {summaryKpis.programmedCount} programada(s)
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 font-mono flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-sky-600" />
            Volume Programado Total
          </div>
          <div className="mt-1.5 flex items-baseline gap-1.5">
            <span className="text-2xl font-black font-mono text-slate-900">
              {summaryKpis.totalProgrammedKg.toLocaleString('pt-BR', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
            <span className="text-xs text-slate-500 font-mono">kg</span>
          </div>
          <div className="mt-1 text-[10px] text-slate-500 font-mono">
            {(summaryKpis.totalProgrammedKg / 1000).toLocaleString('pt-BR', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}{' '}
            toneladas programadas
          </div>
        </div>

        <div className="bg-white border border-emerald-200 rounded-2xl p-4 shadow-sm">
          <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 font-mono flex items-center gap-1.5">
            <Scale className="w-3.5 h-3.5 text-emerald-600" />
            Peso Real Expedido (Bags)
          </div>
          <div className="mt-1.5 flex items-baseline gap-1.5">
            <span className="text-2xl font-black font-mono text-emerald-700">
              {summaryKpis.totalActualKg.toLocaleString('pt-BR', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
            <span className="text-xs text-emerald-600 font-mono">kg</span>
          </div>
          <div className="mt-1 text-[10px] text-slate-500 font-mono">
            {summaryKpis.totalBagsDispatched} bag(s) baixado(s) do estoque
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 font-mono flex items-center gap-1.5">
            <DollarSign className="w-3.5 h-3.5 text-amber-600" />
            Valor Total dos Carregamentos
          </div>
          <div className="mt-1.5 text-2xl font-black font-mono text-slate-900">
            {summaryKpis.totalShipmentsValue.toLocaleString('pt-BR', {
              style: 'currency',
              currency: 'BRL',
            })}
          </div>
          <div className="mt-1 text-[10px] text-slate-500 font-mono">
            Soma de todas as cargas (Programadas e Realizadas)
          </div>
        </div>
      </div>

      {/* Form: Cadastro de Programação & Baixa de Expedição */}
      <form
        onSubmit={handleSubmitShipment}
        className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <PackageCheck className="w-5 h-5 text-emerald-600" />
              {editingShipmentId
                ? `Finalizar / Editar Carregamento (${client || 'Programado'})`
                : 'Nova Programação / Expedição de Carga'}
            </h2>
            <p className="text-xs text-slate-500">
              Preencha os dados da programação oficial e anexe a planilha com os códigos de barras dos bags para baixa automática
            </p>
          </div>
          {editingShipmentId && (
            <button
              type="button"
              onClick={resetForm}
              className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-1.5"
            >
              <X className="w-3.5 h-3.5" />
              <span>Cancelar Edição</span>
            </button>
          )}
        </div>

        {/* Fields Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Data *
            </label>
            <input
              type="date"
              value={shipmentDate}
              onChange={(e) => setShipmentDate(e.target.value)}
              required
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs text-slate-900 font-mono focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Produto *
            </label>
            <select
              value={product}
              onChange={(e) => setProduct(e.target.value)}
              required
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs text-slate-900 font-semibold focus:border-emerald-500 focus:outline-none cursor-pointer"
            >
              {SHIPPING_PRODUCTS.map((prod) => (
                <option key={prod} value={prod}>
                  {prod}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Cliente *
            </label>
            <input
              type="text"
              value={client}
              onChange={(e) => setClient(e.target.value)}
              placeholder="Ex.: Hipala, Neovia..."
              required
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs text-slate-900 font-semibold focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Volume Programado (kg) *
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={programmedVolumeKg}
              onChange={(e) => setProgrammedVolumeKg(e.target.value)}
              placeholder="Ex.: 28000"
              required
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs text-slate-900 font-mono font-bold focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Preço (R$/kg)
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={pricePerKg}
              onChange={(e) => setPricePerKg(e.target.value)}
              placeholder="Ex.: 3.45"
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs text-slate-900 font-mono font-bold focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Condição de Pagamento
            </label>
            <select
              value={paymentCondition}
              onChange={(e) => setPaymentCondition(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs text-slate-900 font-semibold focus:border-emerald-500 focus:outline-none cursor-pointer"
            >
              <option value="À Vista">À Vista</option>
              <option value="30 Dias">30 Dias</option>
              <option value="15 Dias">15 Dias</option>
              <option value="45 Dias">45 Dias</option>
              <option value="A Combinar">A Combinar</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Carga
            </label>
            <select
              value={freightType}
              onChange={(e) => setFreightType(e.target.value as FreightType)}
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs text-slate-900 font-mono font-bold focus:border-emerald-500 focus:outline-none cursor-pointer"
            >
              <option value="FOB">FOB</option>
              <option value="CIF">CIF</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Documentação
            </label>
            <input
              type="text"
              value={documentation}
              onChange={(e) => setDocumentation(e.target.value)}
              placeholder="LAUDO/NF/DCPOA"
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs text-slate-900 font-mono font-semibold focus:border-emerald-500 focus:outline-none"
            />
            <div className="flex flex-wrap gap-1 mt-1.5">
              {['LAUDO', 'NF', 'DCPOA'].map((tok) => {
                const active = documentation
                  .toUpperCase()
                  .split('/')
                  .map((t) => t.trim())
                  .includes(tok);
                return (
                  <button
                    key={tok}
                    type="button"
                    onClick={() => handleToggleDocToken(tok)}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold border transition-colors ${
                      active
                        ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                        : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100'
                    }`}
                  >
                    {tok}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Transportadora
            </label>
            <input
              type="text"
              value={carrier}
              onChange={(e) => setCarrier(e.target.value)}
              placeholder="Nome da transportadora..."
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs text-slate-900 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Status
            </label>
            <select
              value={reconciliation.availableBags.length > 0 ? 'Realizada' : status}
              onChange={(e) => setStatus(e.target.value as ShipmentStatus)}
              disabled={reconciliation.availableBags.length > 0}
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs text-slate-900 font-bold focus:border-emerald-500 focus:outline-none cursor-pointer disabled:bg-emerald-50 disabled:text-emerald-800"
            >
              <option value="Programada">Programada</option>
              <option value="Realizada">Realizada</option>
            </select>
          </div>
        </div>

        {/* Upload de Planilha de Expedição + Scanner Manual */}
        <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 font-mono flex items-center gap-1.5">
                <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                Planilha de Expedição (Baixa Automática por Código de Barras)
              </h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Anexe o arquivo Excel/CSV contendo os códigos de barras dos bags carregados ou adicione manualmente
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <input
                type="file"
                ref={fileInputRef}
                accept=".xlsx,.xls,.csv"
                onChange={handleExcelUpload}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={loadingExcel}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm transition-colors disabled:opacity-50"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>
                  {loadingExcel
                    ? 'Lendo Planilha...'
                    : uploadedFileName
                    ? `Substituir Planilha (${uploadedFileName})`
                    : 'Anexar Planilha Excel/CSV'}
                </span>
              </button>

              {stagedBarcodes.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setStagedBarcodes([]);
                    setUploadedFileName('');
                  }}
                  className="px-3 py-2 bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 rounded-xl text-xs font-semibold flex items-center gap-1"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Limpar Bags</span>
                </button>
              )}
            </div>
          </div>

          {/* Manual barcode quick-add */}
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={manualBarcodeInput}
              onChange={(e) => setManualBarcodeInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddManualBarcode();
                }
              }}
              placeholder="Ou bipar / digitar Código de Barras manualmente (Enter)..."
              className="flex-1 min-w-[240px] px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs text-slate-900 font-mono focus:border-emerald-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={handleAddManualBarcode}
              className="px-3.5 py-2 bg-white hover:bg-slate-100 border border-slate-300 text-slate-800 rounded-xl text-xs font-semibold flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5 text-emerald-600" />
              <span>Adicionar Código</span>
            </button>
          </div>

          {/* Reconciliation & Weight Comparison */}
          {stagedBarcodes.length > 0 && (
            <div className="space-y-4 pt-2 border-t border-slate-200">
              {/* Weight vs Programmed Volume Comparison Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div className="bg-white border border-slate-200 rounded-xl p-3">
                  <div className="text-[10px] font-bold uppercase text-slate-500 font-mono">
                    Volume Programado
                  </div>
                  <div className="text-lg font-black font-mono text-slate-900 mt-0.5">
                    {reconciliation.programmedVolumeKg.toLocaleString('pt-BR', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{' '}
                    kg
                  </div>
                </div>

                <div className="bg-white border border-emerald-300 rounded-xl p-3">
                  <div className="text-[10px] font-bold uppercase text-emerald-700 font-mono">
                    Peso Real Lido ({reconciliation.availableBags.length} bags)
                  </div>
                  <div className="text-lg font-black font-mono text-emerald-700 mt-0.5">
                    {reconciliation.actualWeightKg.toLocaleString('pt-BR', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{' '}
                    kg
                  </div>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-3">
                  <div className="text-[10px] font-bold uppercase text-slate-500 font-mono">
                    Diferença (Real vs Prog.)
                  </div>
                  <div
                    className={`text-lg font-black font-mono mt-0.5 ${
                      Math.abs(reconciliation.diffPct) <= 5
                        ? 'text-emerald-700'
                        : 'text-amber-700'
                    }`}
                  >
                    {reconciliation.diffKg >= 0 ? '+' : ''}
                    {reconciliation.diffKg.toLocaleString('pt-BR', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{' '}
                    kg{' '}
                    <span className="text-xs font-semibold">
                      ({reconciliation.diffPct >= 0 ? '+' : ''}
                      {reconciliation.diffPct.toFixed(1)}%)
                    </span>
                  </div>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-3">
                  <div className="text-[10px] font-bold uppercase text-slate-500 font-mono">
                    Valor Total da Carga
                  </div>
                  <div className="text-lg font-black font-mono text-slate-900 mt-0.5">
                    {reconciliation.estimatedValue.toLocaleString('pt-BR', {
                      style: 'currency',
                      currency: 'BRL',
                    })}
                  </div>
                </div>
              </div>

              {/* Warnings: Blocked, Already Dispatched, Not Found */}
              {reconciliation.blockedBags.length > 0 && (
                <div className="p-3.5 rounded-xl bg-red-50 border border-red-300 space-y-1.5">
                  <div className="flex items-center gap-2 text-xs font-bold text-red-800">
                    <Ban className="w-4 h-4 text-red-600 shrink-0" />
                    <span>
                      {reconciliation.blockedBags.length} Bag(s) BLOQUEADO(S) na Planilha (não serão baixados):
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {reconciliation.blockedBags.map((b) => (
                      <span
                        key={b.barcode}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white border border-red-300 text-[11px] font-mono text-red-800"
                      >
                        #{b.bag_code} ({b.barcode})
                        <button
                          type="button"
                          onClick={() => handleRemoveStagedBarcode(b.barcode)}
                          className="text-red-500 hover:text-red-800 ml-0.5"
                          title="Remover da lista"
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {reconciliation.alreadyDispatchedBags.length > 0 && (
                <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-300 space-y-1.5">
                  <div className="flex items-center gap-2 text-xs font-bold text-amber-900">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>
                      {reconciliation.alreadyDispatchedBags.length} Bag(s) já expedido(s) anteriormente (ignorados):
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {reconciliation.alreadyDispatchedBags.map((b) => (
                      <span
                        key={b.barcode}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white border border-amber-300 text-[11px] font-mono text-amber-900"
                      >
                        #{b.bag_code} ({b.barcode})
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {reconciliation.notFoundBarcodes.length > 0 && (
                <div className="p-3.5 rounded-xl bg-slate-100 border border-slate-300 space-y-1.5">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
                    <AlertTriangle className="w-4 h-4 text-slate-600 shrink-0" />
                    <span>
                      {reconciliation.notFoundBarcodes.length} Código(s) não encontrado(s) no estoque cadastrado:
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {reconciliation.notFoundBarcodes.map((code) => (
                      <span
                        key={code}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white border border-slate-300 text-[11px] font-mono text-slate-700"
                      >
                        {code}
                        <button
                          type="button"
                          onClick={() => handleRemoveStagedBarcode(code)}
                          className="text-slate-400 hover:text-slate-800 ml-0.5"
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Valid Available Bags Preview Table */}
              {reconciliation.availableBags.length > 0 && (
                <div className="bg-white border border-emerald-200 rounded-xl overflow-hidden">
                  <div className="px-4 py-2.5 bg-emerald-50 border-b border-emerald-200 flex items-center justify-between">
                    <span className="text-xs font-bold text-emerald-900 flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      Bags Válidos Prontos para Baixa ({reconciliation.availableBags.length})
                    </span>
                    <span className="text-xs font-mono font-bold text-emerald-800">
                      {reconciliation.actualWeightKg.toLocaleString('pt-BR', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}{' '}
                      kg
                    </span>
                  </div>
                  <div className="max-h-56 overflow-y-auto">
                    <table className="w-full text-center text-xs">
                      <thead className="bg-slate-50 text-slate-600 uppercase font-mono border-b border-slate-200 sticky top-0">
                        <tr>
                          <th className="px-2.5 py-2 text-center">Cód. Bag</th>
                          <th className="px-2.5 py-2 text-center">Código de Barra</th>
                          <th className="px-2.5 py-2 text-center">Descrição</th>
                          <th className="px-2.5 py-2 text-center">Data Prod.</th>
                          <th className="px-2.5 py-2 text-center">Peso (kg)</th>
                          <th className="px-2.5 py-2 text-center">Classificação</th>
                          <th className="px-2.5 py-2 text-center">Remover</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-mono text-slate-800">
                        {reconciliation.availableBags.map((bag) => (
                          <tr key={bag.id ?? bag.barcode} className="hover:bg-slate-50">
                            <td className="px-2.5 py-1.5 text-center font-bold">{bag.bag_code}</td>
                            <td className="px-2.5 py-1.5 text-center">{bag.barcode}</td>
                            <td className="px-2.5 py-1.5 text-center font-sans max-w-[200px] truncate">
                              {bag.product_description}
                            </td>
                            <td className="px-2.5 py-1.5 text-center">
                              {formatDateDDMMYYYY(bag.production_date)}
                            </td>
                            <td className="px-2.5 py-1.5 text-center font-bold text-emerald-700">
                              {Number(bag.weight_kg || 0).toLocaleString('pt-BR', {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </td>
                            <td className="px-2.5 py-1.5 text-center">
                              {bag.quality_classification || '—'}
                            </td>
                            <td className="px-2.5 py-1.5 text-center">
                              <button
                                type="button"
                                onClick={() => handleRemoveStagedBarcode(bag.barcode)}
                                className="p-1 text-slate-400 hover:text-rose-600 rounded"
                                title="Remover da expedição"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Submit Button */}
        <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
          <button
            type="submit"
            disabled={isSubmitting || !shipmentsSchemaReady}
            className={`px-5 py-2.5 rounded-xl text-xs font-bold text-white flex items-center gap-2 shadow-sm transition-colors disabled:opacity-50 ${
              reconciliation.availableBags.length > 0
                ? 'bg-emerald-600 hover:bg-emerald-700'
                : 'bg-slate-800 hover:bg-slate-900'
            }`}
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>
              {isSubmitting
                ? 'Processando no Supabase...'
                : reconciliation.availableBags.length > 0
                ? `Confirmar Expedição e Baixar ${reconciliation.availableBags.length} Bag(s)`
                : editingShipmentId
                ? 'Atualizar Programação'
                : 'Salvar Programação'}
            </span>
          </button>
        </div>
      </form>

      {/* Histórico de Carregamentos / Expedições */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200">
          <div>
            <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
              <Truck className="w-5 h-5 text-emerald-600" />
              Histórico de Carregamentos &amp; Expedições ({filteredShipments.length})
            </h3>
            <p className="text-xs text-slate-500">
              Acompanhe cargas programadas, dê baixa anexando a planilha de bags ou consulte os romaneios realizados
            </p>
          </div>
        </div>

        {/* History Filter Bar */}
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200">
          <div className="sm:col-span-6 relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={historySearch}
              onChange={(e) => setHistorySearch(e.target.value)}
              placeholder="Buscar por Cliente, Transportadora ou Documentação..."
              className="w-full pl-8 pr-8 py-2 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 focus:border-emerald-500 focus:outline-none"
            />
            {historySearch && (
              <button
                type="button"
                onClick={() => setHistorySearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="sm:col-span-3">
            <select
              value={historyProductFilter}
              onChange={(e) => setHistoryProductFilter(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 font-semibold focus:border-emerald-500 focus:outline-none cursor-pointer"
            >
              <option value="Todos">Todos os Produtos</option>
              {SHIPPING_PRODUCTS.map((prod) => (
                <option key={prod} value={prod}>
                  {prod}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-3">
            <select
              value={historyStatusFilter}
              onChange={(e) =>
                setHistoryStatusFilter(e.target.value as 'Todos' | ShipmentStatus)
              }
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 font-semibold focus:border-emerald-500 focus:outline-none cursor-pointer"
            >
              <option value="Todos">Todos os Status</option>
              <option value="Programada">Programada</option>
              <option value="Realizada">Realizada</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-center text-xs">
            <thead className="bg-slate-100 text-slate-700 uppercase tracking-wider border-b border-slate-200 font-mono">
              <tr>
                <th className="px-2.5 py-2.5 text-center">Data</th>
                <th className="px-2.5 py-2.5 text-center">Status</th>
                <th className="px-2.5 py-2.5 text-center">Produto</th>
                <th className="px-2.5 py-2.5 text-center">Cliente</th>
                <th className="px-2.5 py-2.5 text-center">Transportadora</th>
                <th className="px-2.5 py-2.5 text-center">Carga</th>
                <th className="px-2.5 py-2.5 text-center">Pgto</th>
                <th className="px-2.5 py-2.5 text-center">Doc.</th>
                <th className="px-2.5 py-2.5 text-center">Vol. Prog. (kg)</th>
                <th className="px-2.5 py-2.5 text-center">Peso Real (kg)</th>
                <th className="px-2.5 py-2.5 text-center">Preço/kg</th>
                <th className="px-2.5 py-2.5 text-center">Total (R$)</th>
                <th className="px-2.5 py-2.5 text-center">Bags</th>
                <th className="px-2.5 py-2.5 text-center">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-mono text-slate-800">
              {filteredShipments.length === 0 ? (
                <tr>
                  <td colSpan={14} className="px-4 py-10 text-center text-slate-500 font-sans">
                    Nenhum carregamento registrado até o momento.
                  </td>
                </tr>
              ) : (
                filteredShipments.map((s) => {
                  const {
                    prog,
                    act,
                    bagCount,
                    price,
                    status: rowStatus,
                    diff,
                    totalVal,
                  } = getEffectiveShipmentMetrics(s);

                  return (
                    <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-2.5 py-2.5 text-center whitespace-nowrap font-semibold">
                        {formatDateDDMMYYYY(s.shipment_date)}
                      </td>
                      <td className="px-2.5 py-2.5 text-center whitespace-nowrap">
                        {rowStatus === 'Realizada' ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                            Realizada
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
                            Programada
                          </span>
                        )}
                      </td>
                      <td className="px-2.5 py-2.5 text-center font-sans font-semibold text-slate-900">
                        {s.product}
                      </td>
                      <td className="px-2.5 py-2.5 text-center font-sans font-bold text-slate-900">
                        {s.client}
                      </td>
                      <td className="px-2.5 py-2.5 text-center font-sans text-slate-700">
                        {s.carrier || '—'}
                      </td>
                      <td className="px-2.5 py-2.5 text-center font-bold">{s.freight_type}</td>
                      <td className="px-2.5 py-2.5 text-center font-sans text-[11px]">
                        {s.payment_condition}
                      </td>
                      <td className="px-2.5 py-2.5 text-center text-[11px]">
                        {s.documentation}
                      </td>
                      <td className="px-2.5 py-2.5 text-center whitespace-nowrap">
                        {prog.toLocaleString('pt-BR', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </td>
                      <td className="px-2.5 py-2.5 text-center whitespace-nowrap">
                        {act > 0 ? (
                          <div>
                            <div className="font-bold text-emerald-700">
                              {act.toLocaleString('pt-BR', {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </div>
                            <div className="text-[10px] text-slate-500">
                              ({diff >= 0 ? '+' : ''}
                              {diff.toLocaleString('pt-BR', {
                                minimumFractionDigits: 0,
                                maximumFractionDigits: 0,
                              })}{' '}
                              kg)
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-2.5 py-2.5 text-center whitespace-nowrap">
                        {price > 0
                          ? price.toLocaleString('pt-BR', {
                              style: 'currency',
                              currency: 'BRL',
                            })
                          : '—'}
                      </td>
                      <td className="px-2.5 py-2.5 text-center font-bold whitespace-nowrap">
                        {totalVal > 0
                          ? totalVal.toLocaleString('pt-BR', {
                              style: 'currency',
                              currency: 'BRL',
                            })
                          : '—'}
                      </td>
                      <td className="px-2.5 py-2.5 text-center font-bold">
                        {bagCount}
                      </td>
                      <td className="px-2.5 py-2.5 text-center whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1">
                          {Number(s.bag_count || 0) > 0 && (
                            <button
                              type="button"
                              onClick={() => setViewingShipmentBags(s)}
                              className="p-1 text-sky-600 hover:text-sky-800 rounded hover:bg-sky-50 transition-colors"
                              title="Ver Bags Expedidos"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleOpenEditModal(s)}
                            className="p-1 text-slate-600 hover:text-emerald-700 rounded hover:bg-emerald-50 transition-colors"
                            title="Editar Carregamento e Bags"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handlePrintShipment(s)}
                            className="p-1 text-slate-600 hover:text-indigo-700 rounded hover:bg-indigo-50 transition-colors"
                            title="Gerar PDF do Carregamento"
                          >
                            <Printer className="w-3.5 h-3.5" />
                          </button>
                          {s.status === 'Programada' && (
                            <button
                              type="button"
                              onClick={() => handleLoadShipmentForDispatch(s)}
                              className="p-1 text-emerald-600 hover:text-emerald-800 rounded hover:bg-emerald-50 transition-colors"
                              title="Anexar Planilha / Dar Baixa"
                            >
                              <ArrowRightCircle className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setShipmentPendingDelete(s)}
                            className="p-1 text-slate-400 hover:text-rose-600 rounded hover:bg-rose-50 transition-colors"
                            title="Excluir / Estornar Expedição"
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

      {/* Modal: Ver Bags Expedidos */}
      {viewingShipmentBags && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white border border-slate-200 w-full max-w-4xl max-h-[85vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Romaneio de Bags Expedidos &bull; {viewingShipmentBags.client}
                </h3>
                <p className="text-xs text-slate-500 font-mono">
                  {formatDateDDMMYYYY(viewingShipmentBags.shipment_date)} &bull;{' '}
                  {viewingShipmentBags.product} &bull; {modalLinkedBags.length} bag(s) &bull; Peso Real:{' '}
                  {Number(viewingShipmentBags.actual_weight_kg || 0).toLocaleString('pt-BR', {
                    minimumFractionDigits: 2,
                  })}{' '}
                  kg
                </p>
              </div>
              <button
                type="button"
                onClick={() => setViewingShipmentBags(null)}
                className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-200"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {modalLinkedBags.length === 0 ? (
                <p className="text-center text-xs text-slate-500 py-8">
                  Nenhum bag vinculado encontrado para este carregamento.
                </p>
              ) : (
                <table className="w-full text-center text-xs">
                  <thead className="bg-slate-100 text-slate-700 uppercase font-mono border-b border-slate-200">
                    <tr>
                      <th className="px-3 py-2 text-center">Cód. Bag</th>
                      <th className="px-3 py-2 text-center">Código de Barra</th>
                      <th className="px-3 py-2 text-center">Descrição</th>
                      <th className="px-3 py-2 text-center">Data Prod.</th>
                      <th className="px-3 py-2 text-center">Peso (kg)</th>
                      <th className="px-3 py-2 text-center">Classificação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 font-mono text-slate-800">
                    {modalLinkedBags.map((bag) => (
                      <tr key={bag.id ?? bag.barcode} className="hover:bg-slate-50">
                        <td className="px-3 py-2 text-center font-bold">{bag.bag_code}</td>
                        <td className="px-3 py-2 text-center">{bag.barcode}</td>
                        <td className="px-3 py-2 text-center font-sans">
                          {bag.product_description}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {formatDateDDMMYYYY(bag.production_date)}
                        </td>
                        <td className="px-3 py-2 text-center font-bold text-emerald-700">
                          {Number(bag.weight_kg || 0).toLocaleString('pt-BR', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {formatBagQualityStatus(bag)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  const target = viewingShipmentBags;
                  setViewingShipmentBags(null);
                  if (target) handlePrintShipment(target);
                }}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Gerar PDF</span>
              </button>
              <button
                type="button"
                onClick={() => setViewingShipmentBags(null)}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-xl text-xs font-semibold"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Editar Carregamento e Desvincular Bags (Retorno ao Estoque) */}
      {editModalShipment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in">
          <form
            onSubmit={handleSaveEditModal}
            className="bg-white border border-slate-200 w-full max-w-4xl max-h-[90vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden"
          >
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600 shrink-0">
                  <Pencil className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Editar Carregamento &bull; {editModalShipment.client}
                  </h3>
                  <p className="text-xs text-slate-500 font-mono">
                    {formatDateDDMMYYYY(editModalShipment.shipment_date)} &bull; Ajuste os dados ou remova bags para devolvê-los ao estoque ativo
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setEditModalShipment(null);
                  setEditRemovedBagIds([]);
                }}
                className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-200"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {/* General Shipment Fields */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 font-mono mb-3">
                  Dados Gerais do Carregamento
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Data *
                    </label>
                    <input
                      type="date"
                      value={editForm.shipment_date}
                      onChange={(e) =>
                        setEditForm((p) => ({ ...p, shipment_date: e.target.value }))
                      }
                      required
                      className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Produto *
                    </label>
                    <select
                      value={editForm.product}
                      onChange={(e) =>
                        setEditForm((p) => ({ ...p, product: e.target.value }))
                      }
                      required
                      className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 font-semibold cursor-pointer"
                    >
                      {SHIPPING_PRODUCTS.map((prod) => (
                        <option key={prod} value={prod}>
                          {prod}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Cliente *
                    </label>
                    <input
                      type="text"
                      value={editForm.client}
                      onChange={(e) =>
                        setEditForm((p) => ({ ...p, client: e.target.value }))
                      }
                      required
                      className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 font-semibold"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Transportadora
                    </label>
                    <input
                      type="text"
                      value={editForm.carrier}
                      onChange={(e) =>
                        setEditForm((p) => ({ ...p, carrier: e.target.value }))
                      }
                      className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Status
                    </label>
                    <select
                      value={editForm.status}
                      onChange={(e) =>
                        setEditForm((p) => ({
                          ...p,
                          status: e.target.value as ShipmentStatus,
                        }))
                      }
                      className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 font-bold cursor-pointer"
                    >
                      <option value="Programada">Programada</option>
                      <option value="Realizada">Realizada</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Vol. Programado (kg) *
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={editForm.programmed_volume_kg}
                      onChange={(e) =>
                        setEditForm((p) => ({
                          ...p,
                          programmed_volume_kg: e.target.value,
                        }))
                      }
                      required
                      className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 font-mono font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Preço (R$/kg)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={editForm.price_per_kg}
                      onChange={(e) =>
                        setEditForm((p) => ({ ...p, price_per_kg: e.target.value }))
                      }
                      className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 font-mono font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Pgto
                    </label>
                    <select
                      value={editForm.payment_condition}
                      onChange={(e) =>
                        setEditForm((p) => ({
                          ...p,
                          payment_condition: e.target.value,
                        }))
                      }
                      className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 font-semibold cursor-pointer"
                    >
                      <option value="À Vista">À Vista</option>
                      <option value="30 Dias">30 Dias</option>
                      <option value="15 Dias">15 Dias</option>
                      <option value="45 Dias">45 Dias</option>
                      <option value="A Combinar">A Combinar</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Carga
                    </label>
                    <select
                      value={editForm.freight_type}
                      onChange={(e) =>
                        setEditForm((p) => ({
                          ...p,
                          freight_type: e.target.value as FreightType,
                        }))
                      }
                      className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 font-mono font-bold cursor-pointer"
                    >
                      <option value="FOB">FOB</option>
                      <option value="CIF">CIF</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Documentação
                    </label>
                    <input
                      type="text"
                      value={editForm.documentation}
                      onChange={(e) =>
                        setEditForm((p) => ({ ...p, documentation: e.target.value }))
                      }
                      className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 font-mono"
                    />
                  </div>
                </div>
              </div>

              {/* Recalculated Live Totals Bar */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-500 font-mono">
                    Bags Vinculados Restantes
                  </div>
                  <div className="text-base font-black font-mono text-slate-900 mt-0.5">
                    {editModalRecalculated.remainingCount} bag(s)
                    {editModalRemovedBags.length > 0 && (
                      <span className="ml-2 text-xs font-semibold text-amber-700">
                        ({editModalRemovedBags.length} devolvido(s) ao estoque)
                      </span>
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase text-emerald-700 font-mono">
                    Peso Real Recalculado
                  </div>
                  <div className="text-base font-black font-mono text-emerald-700 mt-0.5">
                    {editModalRecalculated.remainingWeightKg.toLocaleString('pt-BR', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{' '}
                    kg
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-500 font-mono">
                    Novo Valor Total (R$)
                  </div>
                  <div className="text-base font-black font-mono text-slate-900 mt-0.5">
                    {editModalRecalculated.totalValue.toLocaleString('pt-BR', {
                      style: 'currency',
                      currency: 'BRL',
                    })}
                  </div>
                </div>
              </div>

              {/* Linked Bags List */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 font-mono">
                    Lista de Bags Vinculados ({editModalAllLinkedBags.length})
                  </h4>
                  {editModalRemovedBags.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setEditRemovedBagIds([])}
                      className="text-xs font-semibold text-sky-700 hover:text-sky-900 flex items-center gap-1"
                    >
                      <Undo2 className="w-3.5 h-3.5" />
                      <span>Desfazer Remoções ({editModalRemovedBags.length})</span>
                    </button>
                  )}
                </div>

                {editModalAllLinkedBags.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-500 border border-dashed border-slate-300 rounded-xl">
                    Este carregamento não possui bags vinculados no momento.
                  </div>
                ) : (
                  <div className="border border-slate-200 rounded-xl overflow-hidden max-h-64 overflow-y-auto">
                    <table className="w-full text-center text-xs">
                      <thead className="bg-slate-100 text-slate-700 uppercase font-mono border-b border-slate-200 sticky top-0">
                        <tr>
                          <th className="px-3 py-2 text-center">Cód. Bag</th>
                          <th className="px-3 py-2 text-center">Peso (kg)</th>
                          <th className="px-3 py-2 text-center">Código de Barras</th>
                          <th className="px-3 py-2 text-center">Data Prod.</th>
                          <th className="px-3 py-2 text-center">Status</th>
                          <th className="px-3 py-2 text-center">Remover / Estornar</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 font-mono text-slate-800">
                        {editModalAllLinkedBags.map((bag) => {
                          const isMarkedRemoved =
                            bag.id !== undefined &&
                            editRemovedBagIds.includes(String(bag.id));
                          return (
                            <tr
                              key={bag.id ?? bag.barcode}
                              className={
                                isMarkedRemoved
                                  ? 'bg-amber-50/80 opacity-65'
                                  : 'hover:bg-slate-50'
                              }
                            >
                              <td className="px-3 py-2 text-center font-bold">
                                {bag.bag_code}
                              </td>
                              <td className="px-3 py-2 text-center font-bold text-emerald-700">
                                {Number(bag.weight_kg || 0).toLocaleString('pt-BR', {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}
                              </td>
                              <td className="px-3 py-2 text-center">{bag.barcode}</td>
                              <td className="px-3 py-2 text-center">
                                {formatDateDDMMYYYY(bag.production_date)}
                              </td>
                              <td className="px-3 py-2 text-center font-sans">
                                {isMarkedRemoved ? (
                                  <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
                                    Voltará ao Estoque
                                  </span>
                                ) : (
                                  <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                                    Vinculado
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-center">
                                {bag.id !== undefined && (
                                  <button
                                    type="button"
                                    onClick={() => handleToggleRemoveBagInEdit(bag.id!)}
                                    className={`p-1 rounded transition-colors ${
                                      isMarkedRemoved
                                        ? 'text-sky-600 hover:text-sky-800 hover:bg-sky-50'
                                        : 'text-rose-500 hover:text-rose-700 hover:bg-rose-50'
                                    }`}
                                    title={
                                      isMarkedRemoved
                                        ? 'Manter Bag no Carregamento'
                                        : 'Remover Bag e Devolver ao Estoque'
                                    }
                                  >
                                    {isMarkedRemoved ? (
                                      <Undo2 className="w-3.5 h-3.5" />
                                    ) : (
                                      <Trash2 className="w-3.5 h-3.5" />
                                    )}
                                  </button>
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
            </div>

            <div className="px-6 py-3.5 border-t border-slate-200 bg-slate-50 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setEditModalShipment(null);
                  setEditRemovedBagIds([]);
                }}
                disabled={isSavingEditModal}
                className="px-4 py-2 bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 rounded-xl text-xs font-semibold"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isSavingEditModal}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                <span>
                  {isSavingEditModal ? 'Salvando...' : 'Salvar Alterações'}
                </span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Confirmar Exclusão / Estorno de Expedição */}
      {shipmentPendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white border border-slate-200 w-full max-w-md rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-rose-50 flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-rose-100 border border-rose-200 flex items-center justify-center text-rose-600 shrink-0">
                <Trash2 className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Excluir Carregamento?
                </h3>
                <p className="text-xs text-slate-600 font-mono">
                  {formatDateDDMMYYYY(shipmentPendingDelete.shipment_date)} &bull;{' '}
                  {shipmentPendingDelete.client}
                </p>
              </div>
            </div>
            <div className="p-6 text-xs text-slate-600">
              {Number(shipmentPendingDelete.bag_count || 0) > 0
                ? `Esta expedição possui ${shipmentPendingDelete.bag_count} bag(s) baixado(s). Ao excluir, os bags serão estornados automaticamente para o estoque ativo.`
                : 'Tem certeza que deseja excluir esta programação de carregamento do Supabase?'}
            </div>
            <div className="px-6 py-3.5 border-t border-slate-200 bg-slate-50 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setShipmentPendingDelete(null)}
                disabled={isDeletingShipment}
                className="px-4 py-2 bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 rounded-xl text-xs font-semibold"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteShipment}
                disabled={isDeletingShipment}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isDeletingShipment ? 'Excluindo...' : 'Confirmar Exclusão'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>

    {/* ========================================================================= */}
    {/* RELATÓRIO DEDICADO EXCLUSIVO PARA IMPRESSÃO / PDF DO CARREGAMENTO */}
    {/* ========================================================================= */}
    {printingShipment && (
      <div className="hidden print:block print:w-full space-y-4 text-slate-900">
        {/* Cabeçalho Corporativo */}
        <div className="border-b-2 border-slate-900 pb-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-900 text-white flex items-center justify-center font-black text-base tracking-wider">
              UA
            </div>
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-slate-700">
                União Avícola Agroindustrial &mdash; FFG-NM
              </div>
              <h1 className="text-lg font-black uppercase tracking-tight text-slate-900">
                RELATÓRIO DE EXPEDIÇÃO / CARREGAMENTO
              </h1>
            </div>
          </div>
          <div className="text-right font-mono text-[10px] text-slate-700">
            <div>Emissão: {new Date().toLocaleString('pt-BR')}</div>
            <div className="font-bold text-slate-900">
              Status: {printingShipment.status.toUpperCase()}
            </div>
          </div>
        </div>

        {/* Resumo da Operação */}
        <div className="border border-slate-400 rounded-lg p-3 space-y-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-700 font-mono border-b border-slate-300 pb-1">
            Resumo da Operação
          </div>
          <div className="grid grid-cols-4 gap-3 text-xs">
            <div>
              <span className="text-[10px] uppercase text-slate-500 block font-mono">Data</span>
              <span className="font-bold font-mono">
                {formatDateDDMMYYYY(printingShipment.shipment_date)}
              </span>
            </div>
            <div>
              <span className="text-[10px] uppercase text-slate-500 block font-mono">Status</span>
              <span className="font-bold">{printingShipment.status}</span>
            </div>
            <div>
              <span className="text-[10px] uppercase text-slate-500 block font-mono">Produto</span>
              <span className="font-bold">{printingShipment.product}</span>
            </div>
            <div>
              <span className="text-[10px] uppercase text-slate-500 block font-mono">Cliente</span>
              <span className="font-bold">{printingShipment.client}</span>
            </div>
            <div>
              <span className="text-[10px] uppercase text-slate-500 block font-mono">
                Transportadora
              </span>
              <span className="font-semibold">{printingShipment.carrier || '—'}</span>
            </div>
            <div>
              <span className="text-[10px] uppercase text-slate-500 block font-mono">
                Condição de Carga
              </span>
              <span className="font-bold font-mono">{printingShipment.freight_type}</span>
            </div>
            <div>
              <span className="text-[10px] uppercase text-slate-500 block font-mono">
                Pagamento
              </span>
              <span className="font-semibold">{printingShipment.payment_condition}</span>
            </div>
            <div>
              <span className="text-[10px] uppercase text-slate-500 block font-mono">
                Documentação
              </span>
              <span className="font-mono font-semibold">{printingShipment.documentation}</span>
            </div>
          </div>

          {/* Comparativo Volume / Peso / Financeiro */}
          {(() => {
            const prog = Number(printingShipment.programmed_volume_kg || 0);
            const act = Number(printingShipment.actual_weight_kg || 0);
            const price = Number(printingShipment.price_per_kg || 0);
            const diff = act - prog;
            const totalVal = (act > 0 ? act : prog) * price;
            return (
              <div className="grid grid-cols-4 gap-3 pt-2 border-t border-slate-300 font-mono text-xs">
                <div className="p-2 bg-slate-50 border border-slate-300 rounded">
                  <div className="text-[9px] uppercase text-slate-600">Volume Programado</div>
                  <div className="text-sm font-black">
                    {prog.toLocaleString('pt-BR', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{' '}
                    kg
                  </div>
                </div>
                <div className="p-2 bg-slate-50 border border-slate-300 rounded">
                  <div className="text-[9px] uppercase text-slate-600">
                    Peso Real Carregado ({printingShipmentBags.length} bags)
                  </div>
                  <div className="text-sm font-black">
                    {act.toLocaleString('pt-BR', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{' '}
                    kg{' '}
                    {act > 0 && (
                      <span className="text-[10px] font-normal text-slate-600">
                        ({diff >= 0 ? '+' : ''}
                        {diff.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} kg)
                      </span>
                    )}
                  </div>
                </div>
                <div className="p-2 bg-slate-50 border border-slate-300 rounded">
                  <div className="text-[9px] uppercase text-slate-600">Preço por kg</div>
                  <div className="text-sm font-black">
                    {price > 0
                      ? price.toLocaleString('pt-BR', {
                          style: 'currency',
                          currency: 'BRL',
                        })
                      : '—'}
                  </div>
                </div>
                <div className="p-2 bg-slate-100 border border-slate-400 rounded">
                  <div className="text-[9px] uppercase text-slate-700 font-bold">Valor Total</div>
                  <div className="text-sm font-black">
                    {totalVal > 0
                      ? totalVal.toLocaleString('pt-BR', {
                          style: 'currency',
                          currency: 'BRL',
                        })
                      : '—'}
                  </div>
                </div>
              </div>
            );
          })()}
        </div>

        {/* Tabela Detalhada de Bags Carregados */}
        <div className="border border-slate-400 rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between border-b border-slate-300 pb-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-700 font-mono">
              Detalhamento de Bags Carregados ({printingShipmentBags.length})
            </span>
          </div>

          {printingShipmentBags.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-600">
              Nenhum bag vinculado a este carregamento até o momento.
            </div>
          ) : (
            <table className="w-full text-center border-collapse border border-slate-400 text-[10px]">
              <thead className="bg-slate-100 text-slate-900 uppercase font-mono">
                <tr>
                  <th className="px-2 py-1.5 text-center border border-slate-400">Cód. Bag</th>
                  <th className="px-2 py-1.5 text-center border border-slate-400">
                    Código de Barras
                  </th>
                  <th className="px-2 py-1.5 text-center border border-slate-400">Descrição</th>
                  <th className="px-2 py-1.5 text-center border border-slate-400">
                    Data de Produção
                  </th>
                  <th className="px-2 py-1.5 text-center border border-slate-400">Período</th>
                  <th className="px-2 py-1.5 text-center border border-slate-400">Peso (kg)</th>
                  <th className="px-2 py-1.5 text-center border border-slate-400">
                    Status de Laudo / Qualidade
                  </th>
                </tr>
              </thead>
              <tbody className="font-mono text-slate-900">
                {printingShipmentBags.map((bag, idx) => (
                  <tr key={bag.id ?? `print-bag-${idx}`}>
                    <td className="px-2 py-1 text-center border border-slate-300 font-bold">
                      {bag.bag_code}
                    </td>
                    <td className="px-2 py-1 text-center border border-slate-300 font-semibold">
                      {bag.barcode}
                    </td>
                    <td className="px-2 py-1 text-center border border-slate-300 font-sans">
                      {bag.product_description}
                    </td>
                    <td className="px-2 py-1 text-center border border-slate-300">
                      {formatDateDDMMYYYY(bag.production_date)}
                    </td>
                    <td className="px-2 py-1 text-center border border-slate-300 font-bold">
                      {bag.period}
                    </td>
                    <td className="px-2 py-1 text-center border border-slate-300 font-bold">
                      {Number(bag.weight_kg || 0).toLocaleString('pt-BR', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    <td className="px-2 py-1 text-center border border-slate-300 font-bold">
                      {formatBagQualityStatus(bag)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-100 font-bold font-mono text-slate-900">
                  <td colSpan={5} className="px-2 py-1.5 text-center border border-slate-400">
                    TOTAL CARREGADO ({printingShipmentBags.length} bags)
                  </td>
                  <td className="px-2 py-1.5 text-center border border-slate-400">
                    {printingShipmentBags
                      .reduce((sum, b) => sum + Number(b.weight_kg || 0), 0)
                      .toLocaleString('pt-BR', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}{' '}
                    kg
                  </td>
                  <td className="px-2 py-1.5 text-center border border-slate-400">—</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
    )}
    </>
  );
};
