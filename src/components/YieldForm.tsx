import React, { useState, useEffect, useRef } from 'react';
import {
  ShiftType, FfgSku, DetalheSobrepesoItem, FfgYieldRecord
} from '../types';
import { supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import {
  parseAbateTpaExcel,
  parseProducaoSobrepesoExcel,
  AbateTpaParsedData
} from '../lib/excelParser';
import {
  Upload, FileSpreadsheet, Save, RefreshCw,
  Calculator, Layers, Table, Eye, Droplets
} from 'lucide-react';

interface YieldFormProps {
  skus: FfgSku[];
  onOpenSkus: () => void;
  onRecordSaved: () => void;
}

export const YieldForm: React.FC<YieldFormProps> = ({
  skus,
  onOpenSkus,
  onRecordSaved,
}) => {
  const { showToast, showSupabaseError } = useToast();

  // Form State
  const [productionDate, setProductionDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [shift, setShift] = useState<ShiftType>('Indústria');

  // Input numbers (kg)
  const [massaVivaKg, setMassaVivaKg] = useState<number>(0);
  const [tpaTotalKg, setTpaTotalKg] = useState<number>(0);
  const [tpaPendentesKg, setTpaPendentesKg] = useState<number>(0);
  const [sobrepesoTotalKg, setSobrepesoTotalKg] = useState<number>(0);
  const [farinhaViscerasKg, setFarinhaViscerasKg] = useState<number>(0);
  const [farinhaPenasKg, setFarinhaPenasKg] = useState<number>(0);
  const [oilProducedKg, setOilProducedKg] = useState<number>(0);
  const [gorduraKg, setGorduraKg] = useState<number>(0);

  // Cached parsed data from spreadsheets
  const [cachedAbateData, setCachedAbateData] = useState<AbateTpaParsedData | null>(null);
  const [abateFileName, setAbateFileName] = useState<string>('');

  const [cachedProducaoFile, setCachedProducaoFile] = useState<File | null>(null);
  const [producaoFileName, setProducaoFileName] = useState<string>('');
  const [detalhesSobrepeso, setDetalhesSobrepeso] = useState<DetalheSobrepesoItem[]>([]);
  const [showSobrepesoModal, setShowSobrepesoModal] = useState(false);

  // Loading flags
  const [loadingAbate, setLoadingAbate] = useState(false);
  const [loadingProducao, setLoadingProducao] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const fileInputAbateRef = useRef<HTMLInputElement>(null);
  const fileInputProducaoRef = useRef<HTMLInputElement>(null);

  // Calculated values
  const mpDestinadaFfgKg = Math.max(0, massaVivaKg - tpaTotalKg - sobrepesoTotalKg);

  const rendimentoViscerasPct = mpDestinadaFfgKg > 0
    ? Math.round(((farinhaViscerasKg / mpDestinadaFfgKg) * 100) * 100) / 100
    : 0;

  const rendimentoPenasPct = mpDestinadaFfgKg > 0
    ? Math.round(((farinhaPenasKg / mpDestinadaFfgKg) * 100) * 100) / 100
    : 0;

  // Rendimento Farinha (%) = (Farinha Vísceras + Farinha Penas) / MP Destinada * 100
  const rendimentoFarinhaPct = mpDestinadaFfgKg > 0
    ? Math.round((((farinhaViscerasKg + farinhaPenasKg) / mpDestinadaFfgKg) * 100) * 100) / 100
    : 0;

  // Rendimento de Óleo (%) = (Produção de Óleo (kg) / Matéria-Prima Processada (kg)) * 100
  const oilYieldPct = mpDestinadaFfgKg > 0
    ? Math.round(((oilProducedKg / mpDestinadaFfgKg) * 100) * 100) / 100
    : 0;

  // Rendimento Geral Total (Farinha + Óleo %)
  const rendimentoGeralTotalPct = Math.round((rendimentoFarinhaPct + oilYieldPct) * 100) / 100;

  // Auto-recalculate when shift changes after loading abate spreadsheet
  useEffect(() => {
    if (cachedAbateData) {
      const mv = cachedAbateData.massaViva[shift] || 0;
      const tpa = cachedAbateData.tpaTotal[shift] || 0;
      const pend = cachedAbateData.tpaPendentes[shift] || 0;

      setMassaVivaKg(mv);
      setTpaTotalKg(tpa);
      setTpaPendentesKg(pend);

      showToast(
        'info',
        'Turno Atualizado',
        `Valores de Abate/TPA recalculados para a coluna do turno ${shift}.`
      );
    }
  }, [shift]);

  // When shift or skus change, if we have a cached production spreadsheet, re-run sobrepeso
  useEffect(() => {
    if (cachedProducaoFile && skus.length > 0) {
      reprocessProducao(cachedProducaoFile, shift, skus);
    }
  }, [shift, skus]);

  // Handler: Import Abate/TPA Spreadsheet
  const handleAbateFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoadingAbate(true);
    try {
      const parsed = await parseAbateTpaExcel(file);
      setCachedAbateData(parsed);
      setAbateFileName(file.name);

      const mv = parsed.massaViva[shift] || 0;
      const tpa = parsed.tpaTotal[shift] || 0;
      const pend = parsed.tpaPendentes[shift] || 0;

      setMassaVivaKg(mv);
      setTpaTotalKg(tpa);
      setTpaPendentesKg(pend);

      showToast(
        'success',
        'Planilha de Abate/TPA Importada',
        `Massa Viva: ${mv.toLocaleString('pt-BR')} kg | TPA: ${tpa.toLocaleString('pt-BR')} kg (Turno: ${shift})`
      );
    } catch (err: any) {
      showToast('error', 'Falha ao Ler Planilha de Abate', err?.message || 'Arquivo inválido');
    } finally {
      setLoadingAbate(false);
      if (fileInputAbateRef.current) fileInputAbateRef.current.value = '';
    }
  };

  // Handler: Import Produção Spreadsheet for Sobrepeso
  const handleProducaoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setCachedProducaoFile(file);
    setProducaoFileName(file.name);
    await reprocessProducao(file, shift, skus);

    if (fileInputProducaoRef.current) fileInputProducaoRef.current.value = '';
  };

  const reprocessProducao = async (file: File, activeShift: ShiftType, currentSkus: FfgSku[]) => {
    setLoadingProducao(true);
    try {
      const result = await parseProducaoSobrepesoExcel(file, activeShift, currentSkus);
      setDetalhesSobrepeso(result.detalhes);
      setSobrepesoTotalKg(result.totalSobrepesoKg);

      showToast(
        'success',
        'Sobrepeso Calculado',
        `Total Sobrepeso: ${result.totalSobrepesoKg.toLocaleString('pt-BR')} kg em ${result.detalhes.length} itens analisados.`
      );
    } catch (err: any) {
      showToast('error', 'Falha no Cálculo de Sobrepeso', err?.message || 'Erro na planilha de produção');
    } finally {
      setLoadingProducao(false);
    }
  };

  // Reset form
  const handleResetForm = () => {
    setMassaVivaKg(0);
    setTpaTotalKg(0);
    setTpaPendentesKg(0);
    setSobrepesoTotalKg(0);
    setFarinhaViscerasKg(0);
    setFarinhaPenasKg(0);
    setOilProducedKg(0);
    setGorduraKg(0);
    setCachedAbateData(null);
    setAbateFileName('');
    setCachedProducaoFile(null);
    setProducaoFileName('');
    setDetalhesSobrepeso([]);
  };

  // Submit to Supabase
  const handleSaveYieldRecord = async (e: React.FormEvent) => {
    e.preventDefault();

    if (massaVivaKg <= 0) {
      showToast('warning', 'Validação', 'Informe a Massa Viva Recebida (kg).');
      return;
    }

    if (mpDestinadaFfgKg <= 0) {
      showToast('warning', 'Validação', 'A Matéria-Prima destinada à FFG deve ser maior que zero (Massa Viva - TPA - Sobrepeso).');
      return;
    }

    if (farinhaViscerasKg <= 0 && farinhaPenasKg <= 0 && oilProducedKg <= 0) {
      showToast('warning', 'Validação', 'Informe a produção de ao menos uma farinha (Vísceras/Penas) ou produção de óleo.');
      return;
    }

    setIsSaving(true);
    try {
      const payload: FfgYieldRecord = {
        production_date: productionDate,
        shift,
        massa_viva_kg: Number(massaVivaKg),
        tpa_total_kg: Number(tpaTotalKg),
        tpa_pendentes_kg: Number(tpaPendentesKg),
        sobrepeso_total_kg: Number(sobrepesoTotalKg),
        mp_destinada_ffg_kg: Math.round(mpDestinadaFfgKg * 100) / 100,
        farinha_visceras_kg: Number(farinhaViscerasKg),
        farinha_penas_kg: Number(farinhaPenasKg),
        gordura_kg: Number(gorduraKg) || 0,
        oil_produced_kg: Number(oilProducedKg) || 0,
        oil_yield_percent: oilYieldPct,
        rendimento_visceras_pct: rendimentoViscerasPct,
        rendimento_penas_pct: rendimentoPenasPct,
        rendimento_geral_ffg_pct: rendimentoFarinhaPct,
        detalhes_sobrepeso: detalhesSobrepeso.length > 0 ? detalhesSobrepeso : null,
      };

      const { error } = await supabase
        .from('ffg_yield_records')
        .insert([payload])
        .select();

      if (error) {
        throw error;
      }

      showToast(
        'success',
        'Lançamento Salvo no Supabase',
        `Rendimento registrado! Farinha: ${rendimentoFarinhaPct.toFixed(2)}% | Óleo: ${oilYieldPct.toFixed(2)}% | Total: ${rendimentoGeralTotalPct.toFixed(2)}%`
      );

      onRecordSaved();
      handleResetForm();
    } catch (err: any) {
      showSupabaseError('Falha ao Gravar Rendimento no Supabase', err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">

      {/* Top Banner: Shift Selector */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-700 font-mono">
                Lançamento Operacional FFG
              </span>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span className="text-xs text-slate-500 font-mono">Fábrica de Farinhas e Gorduras</span>
            </div>
            <h2 className="text-xl font-black text-slate-900 mt-0.5 tracking-tight">
              Apontamento de Rendimento, Óleo & Desconto de Sobrepeso
            </h2>
          </div>

          {/* Shift Selector & Date */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl border border-slate-200">
              <span className="text-xs font-semibold text-slate-600 px-2 font-mono">Turno:</span>
              {(['Indústria', '1T', '2T'] as ShiftType[]).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setShift(st)}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-bold font-mono transition-all ${
                    shift === st
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-white'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-slate-300">
              <span className="text-xs font-semibold text-slate-600 font-mono">Data:</span>
              <input
                type="date"
                value={productionDate}
                onChange={(e) => setProductionDate(e.target.value)}
                className="bg-transparent text-xs text-slate-900 font-mono font-semibold focus:outline-none cursor-pointer"
              />
            </div>

            <button
              type="button"
              onClick={onOpenSkus}
              className="px-3 py-2 bg-white hover:bg-slate-50 text-emerald-700 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors border border-slate-300 shadow-sm"
            >
              <Layers className="w-3.5 h-3.5 text-emerald-600" />
              <span>Gerenciar SKUs ({skus.length})</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Grid: Spreadsheets and Manual Inputs */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

        {/* Left Column: Spreadsheet Import & Raw Data Inputs */}
        <div className="lg:col-span-7 space-y-6">

          {/* Card: Planilha 1 - Abate / TPA */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
                  <FileSpreadsheet className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    1. Planilha de Abate / TPA (.xlsx)
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Lê Linha 164 (Massa Viva) e Linha 160 (TPA Total) da coluna do turno selecionado
                  </p>
                </div>
              </div>

              <div>
                <input
                  type="file"
                  ref={fileInputAbateRef}
                  accept=".xlsx, .xls"
                  onChange={handleAbateFileChange}
                  className="hidden"
                  id="abate-file-input"
                />
                <label
                  htmlFor="abate-file-input"
                  className="cursor-pointer px-3.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 text-emerald-700 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all shadow-sm"
                >
                  {loadingAbate ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Upload className="w-3.5 h-3.5" />
                  )}
                  <span>{abateFileName ? 'Trocar Planilha' : 'Carregar Excel Abate'}</span>
                </label>
              </div>
            </div>

            {abateFileName && (
              <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between text-xs">
                <span className="text-emerald-800 font-mono truncate max-w-xs font-medium">
                  {abateFileName}
                </span>
                <span className="text-[10px] text-emerald-700 bg-white border border-emerald-200 px-2 py-0.5 rounded font-mono font-semibold">
                  Lido com sucesso
                </span>
              </div>
            )}

            {/* Inputs: Massa Viva & TPA */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Massa Viva Recebida (kg) *
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={massaVivaKg || ''}
                    onChange={(e) => setMassaVivaKg(parseFloat(e.target.value) || 0)}
                    placeholder="0.00"
                    className="w-full px-3 py-2 pr-9 bg-white border border-slate-300 rounded-xl text-sm text-slate-900 font-mono focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 focus:outline-none"
                  />
                  <span className="absolute right-3 top-2.5 text-xs text-slate-400 font-mono">kg</span>
                </div>
                <span className="text-[10px] text-slate-500 font-mono mt-1 block">
                  Linha 164 &bull; Col {shift === '1T' ? 'C' : shift === '2T' ? 'D' : 'E'}
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  TPA Total (kg) *
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={tpaTotalKg || ''}
                    onChange={(e) => setTpaTotalKg(parseFloat(e.target.value) || 0)}
                    placeholder="0.00"
                    className="w-full px-3 py-2 pr-9 bg-white border border-slate-300 rounded-xl text-sm text-slate-900 font-mono focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 focus:outline-none"
                  />
                  <span className="absolute right-3 top-2.5 text-xs text-slate-400 font-mono">kg</span>
                </div>
                <span className="text-[10px] text-slate-500 font-mono mt-1 block">
                  Linha 160 &bull; Col {shift === '1T' ? 'C' : shift === '2T' ? 'D' : 'E'}
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  TPA Pendentes (kg)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={tpaPendentesKg || ''}
                    onChange={(e) => setTpaPendentesKg(parseFloat(e.target.value) || 0)}
                    placeholder="0.00"
                    className="w-full px-3 py-2 pr-9 bg-white border border-slate-300 rounded-xl text-sm text-slate-900 font-mono focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 focus:outline-none"
                  />
                  <span className="absolute right-3 top-2.5 text-xs text-slate-400 font-mono">kg</span>
                </div>
                <span className="text-[10px] text-slate-500 font-mono mt-1 block">
                  Linha 159 &bull; Col G (Conferência)
                </span>
              </div>
            </div>
          </div>

          {/* Card: Planilha 2 - Produção & Sobrepeso */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-sky-50 border border-sky-200 flex items-center justify-center text-sky-600">
                  <Table className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    2. Produção para Cálculo de Sobrepeso (.xlsx)
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Cruza SKUs União/MBRF com % de sobrepeso e calcula desconto
                  </p>
                </div>
              </div>

              <div>
                <input
                  type="file"
                  ref={fileInputProducaoRef}
                  accept=".xlsx, .xls"
                  onChange={handleProducaoFileChange}
                  className="hidden"
                  id="producao-file-input"
                />
                <label
                  htmlFor="producao-file-input"
                  className="cursor-pointer px-3.5 py-1.5 bg-sky-50 hover:bg-sky-100 border border-sky-300 text-sky-700 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all shadow-sm"
                >
                  {loadingProducao ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Upload className="w-3.5 h-3.5" />
                  )}
                  <span>{producaoFileName ? 'Trocar Planilha' : 'Carregar Excel Produção'}</span>
                </label>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Sobrepeso Total Calculado (kg) *
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={sobrepesoTotalKg || ''}
                    onChange={(e) => setSobrepesoTotalKg(parseFloat(e.target.value) || 0)}
                    placeholder="0.00"
                    className="w-full px-3 py-2 pr-9 bg-white border border-amber-400 rounded-xl text-sm text-amber-700 font-mono font-bold focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 focus:outline-none"
                  />
                  <span className="absolute right-3 top-2.5 text-xs text-slate-400 font-mono">kg</span>
                </div>
                <span className="text-[10px] text-slate-500 font-mono mt-1 block">
                  Permite edição manual se não houver planilha
                </span>
              </div>

              <div className="flex flex-col justify-end pt-1">
                {detalhesSobrepeso.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setShowSobrepesoModal(true)}
                    className="w-full py-2.5 bg-slate-50 hover:bg-slate-100 border border-slate-300 text-slate-800 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
                  >
                    <Eye className="w-4 h-4 text-sky-600" />
                    <span>Conferir {detalhesSobrepeso.length} SKUs Apurados</span>
                  </button>
                ) : (
                  <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-center text-xs text-slate-500 font-mono">
                    Nenhuma planilha de produção carregada
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Card: Farinhas, Óleo & Gordura Produzidas */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
            <div className="pb-3 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2 flex-wrap">
                  <span>3. Produção da FFG (Farinhas, Óleo e Gordura)</span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-mono font-semibold">
                    Apontamento FFG
                  </span>
                </h3>
                <p className="text-[11px] text-slate-500">
                  Informe o peso produzido de farinhas, óleo e gordura no período
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Farinha de Vísceras (kg) *
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={farinhaViscerasKg || ''}
                    onChange={(e) => setFarinhaViscerasKg(parseFloat(e.target.value) || 0)}
                    placeholder="0.00"
                    className="w-full px-3 py-2 pr-9 bg-white border border-slate-300 rounded-xl text-sm text-emerald-700 font-mono font-bold focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 focus:outline-none"
                  />
                  <span className="absolute right-3 top-2.5 text-xs text-slate-400 font-mono">kg</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Farinha de Penas (kg) *
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={farinhaPenasKg || ''}
                    onChange={(e) => setFarinhaPenasKg(parseFloat(e.target.value) || 0)}
                    placeholder="0.00"
                    className="w-full px-3 py-2 pr-9 bg-white border border-slate-300 rounded-xl text-sm text-emerald-700 font-mono font-bold focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 focus:outline-none"
                  />
                  <span className="absolute right-3 top-2.5 text-xs text-slate-400 font-mono">kg</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-amber-800 mb-1 flex items-center gap-1.5">
                  <Droplets className="w-3.5 h-3.5 text-amber-600" />
                  <span>Produção de Óleo (kg)</span>
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={oilProducedKg || ''}
                    onChange={(e) => setOilProducedKg(parseFloat(e.target.value) || 0)}
                    placeholder="0.00"
                    className="w-full px-3 py-2 pr-9 bg-white border border-amber-400 rounded-xl text-sm text-amber-700 font-mono font-bold focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 focus:outline-none"
                  />
                  <span className="absolute right-3 top-2.5 text-xs text-slate-400 font-mono">kg</span>
                </div>
                <span className="text-[10px] text-slate-500 font-mono mt-1 block">
                  Base para cálculo do Rendimento de Óleo (%)
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Gordura (kg) <span className="text-slate-400 text-[10px]">(Opcional)</span>
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={gorduraKg || ''}
                    onChange={(e) => setGorduraKg(parseFloat(e.target.value) || 0)}
                    placeholder="0.00"
                    className="w-full px-3 py-2 pr-9 bg-white border border-slate-300 rounded-xl text-sm text-slate-900 font-mono focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 focus:outline-none"
                  />
                  <span className="absolute right-3 top-2.5 text-xs text-slate-400 font-mono">kg</span>
                </div>
              </div>
            </div>
          </div>

        </div>

        {/* Right Column: Real-time Live Calculations & Submission */}
        <div className="lg:col-span-5 space-y-6">

          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-5 sticky top-20">

            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <Calculator className="w-5 h-5 text-emerald-600" />
                <h3 className="font-extrabold text-slate-900 text-base tracking-tight">
                  Cálculo de Rendimento em Tempo Real
                </h3>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700 font-mono font-bold">
                {shift}
              </span>
            </div>

            {/* MP Destinada FFG Box */}
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-600">
                <span>Massa Viva Recebida:</span>
                <span className="font-mono text-slate-900 font-semibold">{massaVivaKg.toLocaleString('pt-BR')} kg</span>
              </div>
              <div className="flex items-center justify-between text-xs text-slate-600">
                <span>(-) Desconto TPA Total:</span>
                <span className="font-mono text-rose-600 font-semibold">- {tpaTotalKg.toLocaleString('pt-BR')} kg</span>
              </div>
              <div className="flex items-center justify-between text-xs text-slate-600">
                <span>(-) Desconto Sobrepeso:</span>
                <span className="font-mono text-amber-600 font-semibold">- {sobrepesoTotalKg.toLocaleString('pt-BR')} kg</span>
              </div>
              <div className="pt-2 border-t border-slate-200 flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-emerald-700">
                    MP Destinada à FFG
                  </span>
                  <div className="text-[10px] text-slate-500">Matéria-prima processada (base)</div>
                </div>
                <span className="text-lg font-black font-mono text-emerald-700">
                  {mpDestinadaFfgKg.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} kg
                </span>
              </div>
            </div>

            {/* Rendimentos KPI Cards */}
            <div className="space-y-3">

              {/* Rendimento Geral Total (Farinha + Óleo) */}
              <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-800 font-mono">
                      Rendimento Geral Total
                    </span>
                    <p className="text-[10px] text-emerald-700/80">
                      Farinha ({rendimentoFarinhaPct.toFixed(2)}%) + Óleo ({oilYieldPct.toFixed(2)}%)
                    </p>
                  </div>
                  <div className="text-2xl font-black font-mono text-emerald-700">
                    {rendimentoGeralTotalPct.toFixed(2)}%
                  </div>
                </div>
                <div className="mt-2.5 w-full bg-white rounded-full h-2 overflow-hidden border border-emerald-200">
                  <div
                    className="bg-emerald-600 h-full rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(100, (rendimentoGeralTotalPct / 30) * 100)}%` }}
                  />
                </div>
              </div>

              {/* Rendimento Farinha (%) & Rendimento de Óleo (%) separados */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="text-[10px] font-bold uppercase text-emerald-700 font-mono">
                    Rendimento Farinha
                  </div>
                  <div className="text-xl font-black font-mono text-slate-900 mt-1">
                    {rendimentoFarinhaPct.toFixed(2)}%
                  </div>
                  <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                    {(farinhaViscerasKg + farinhaPenasKg).toLocaleString('pt-BR')} kg farinhas
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200">
                  <div className="text-[10px] font-bold uppercase text-amber-800 font-mono flex items-center gap-1">
                    <Droplets className="w-3 h-3 text-amber-600" />
                    <span>Rendimento de Óleo</span>
                  </div>
                  <div className="text-xl font-black font-mono text-amber-700 mt-1">
                    {oilYieldPct.toFixed(2)}%
                  </div>
                  <div className="text-[10px] text-amber-800/75 font-mono mt-0.5">
                    {oilProducedKg.toLocaleString('pt-BR')} kg óleo
                  </div>
                </div>
              </div>

              {/* Rendimento Vísceras & Penas */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-xl bg-white border border-slate-200">
                  <div className="text-[10px] font-bold uppercase text-slate-500 font-mono">
                    Rend. Vísceras
                  </div>
                  <div className="text-base font-extrabold font-mono text-slate-900 mt-0.5">
                    {rendimentoViscerasPct.toFixed(2)}%
                  </div>
                  <div className="text-[10px] text-slate-500 font-mono">
                    {farinhaViscerasKg.toLocaleString('pt-BR')} kg
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-white border border-slate-200">
                  <div className="text-[10px] font-bold uppercase text-slate-500 font-mono">
                    Rend. Penas
                  </div>
                  <div className="text-base font-extrabold font-mono text-slate-900 mt-0.5">
                    {rendimentoPenasPct.toFixed(2)}%
                  </div>
                  <div className="text-[10px] text-slate-500 font-mono">
                    {farinhaPenasKg.toLocaleString('pt-BR')} kg
                  </div>
                </div>
              </div>

            </div>

            {/* Action buttons */}
            <div className="pt-2 space-y-2">
              <button
                type="button"
                onClick={handleSaveYieldRecord}
                disabled={isSaving}
                className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-sm shadow-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50"
              >
                {isSaving ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Gravando no Supabase...</span>
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    <span>Salvar Lançamento no Supabase</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleResetForm}
                className="w-full py-2 bg-white hover:bg-slate-50 border border-slate-300 text-slate-600 hover:text-slate-900 rounded-xl text-xs font-semibold transition-colors"
              >
                Limpar Campos
              </button>
            </div>

          </div>

        </div>

      </div>

      {/* Modal: Tabela Analítica de Conferência de Sobrepeso */}
      {showSobrepesoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white border border-slate-200 w-full max-w-4xl max-h-[85vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Table className="w-4 h-4 text-sky-600" />
                  Conferência Analítica de Sobrepeso por SKU
                </h3>
                <p className="text-xs text-slate-500">
                  {detalhesSobrepeso.length} itens localizados na planilha de produção para o turno {shift}
                </p>
              </div>
              <button
                onClick={() => setShowSobrepesoModal(false)}
                className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-200"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              <table className="w-full text-center text-xs">
                <thead className="bg-slate-100 text-slate-700 uppercase tracking-wider sticky top-0 border-b border-slate-200 font-mono">
                  <tr>
                    <th className="px-3 py-2 text-center">Código SKU</th>
                    <th className="px-3 py-2 text-center">Descrição</th>
                    <th className="px-3 py-2 text-center">Família</th>
                    <th className="px-3 py-2 text-center">Peso Líquido</th>
                    <th className="px-3 py-2 text-center">% Sobrepeso</th>
                    <th className="px-3 py-2 text-center">Desconto (kg)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 font-mono text-slate-800">
                  {detalhesSobrepeso.map((item, idx) => (
                    <tr key={idx} className="hover:bg-slate-50">
                      <td className="px-3 py-2 text-center font-semibold text-sky-700">
                        {item.codigo_encontrado || item.sku}
                      </td>
                      <td className="px-3 py-2 text-center font-sans text-slate-900">{item.produto}</td>
                      <td className="px-3 py-2 text-center text-slate-600">{item.familia || '—'}</td>
                      <td className="px-3 py-2 text-center font-medium text-slate-700">
                        {item.peso_produzido.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} kg
                      </td>
                      <td className="px-3 py-2 text-center text-amber-700 font-semibold">
                        {((item.percentual <= 1 ? item.percentual * 100 : item.percentual).toFixed(2))}%
                      </td>
                      <td className="px-3 py-2 text-center font-bold text-amber-700">
                        {item.sobrepeso_kg.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} kg
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-100 text-slate-900 font-mono font-bold border-t border-slate-200">
                  <tr>
                    <td colSpan={3} className="px-3 py-2 text-center uppercase text-slate-600">Total:</td>
                    <td className="px-3 py-2 text-center text-slate-900">
                      {detalhesSobrepeso.reduce((a, b) => a + b.peso_produzido, 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} kg
                    </td>
                    <td className="px-3 py-2 text-center text-slate-400">—</td>
                    <td className="px-3 py-2 text-center text-amber-700">
                      {detalhesSobrepeso.reduce((a, b) => a + b.sobrepeso_kg, 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} kg
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex justify-end">
              <button
                onClick={() => setShowSobrepesoModal(false)}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-lg text-xs font-semibold"
              >
                Fechar Conferência
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
