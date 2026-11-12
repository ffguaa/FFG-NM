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
  Upload, FileSpreadsheet, Check, AlertCircle, Save, RefreshCw, 
  Calculator, ChevronRight, Layers, Table, Info, Trash2, Eye
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
    ? (farinhaViscerasKg / mpDestinadaFfgKg) * 100 
    : 0;

  const rendimentoPenasPct = mpDestinadaFfgKg > 0 
    ? (farinhaPenasKg / mpDestinadaFfgKg) * 100 
    : 0;

  const rendimentoGeralFfgPct = mpDestinadaFfgKg > 0 
    ? ((farinhaViscerasKg + farinhaPenasKg) / mpDestinadaFfgKg) * 100 
    : 0;

  // AUTO-RECALCULATE WHEN SHIFT CHANGES:
  // If user switches shift after loading the abate spreadsheet, automatically update fields from that shift's column!
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

      // Extract values according to current shift:
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

    if (farinhaViscerasKg <= 0 && farinhaPenasKg <= 0) {
      showToast('warning', 'Validação', 'Informe a produção de ao menos uma farinha (Vísceras ou Penas).');
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
        rendimento_visceras_pct: Math.round(rendimentoViscerasPct * 100) / 100,
        rendimento_penas_pct: Math.round(rendimentoPenasPct * 100) / 100,
        rendimento_geral_ffg_pct: Math.round(rendimentoGeralFfgPct * 100) / 100,
        detalhes_sobrepeso: detalhesSobrepeso.length > 0 ? detalhesSobrepeso : null,
      };

      // Strict Supabase insert with zero silent fallback
      const { data, error } = await supabase
        .from('ffg_yield_records')
        .insert([payload])
        .select();

      if (error) {
        throw error;
      }

      showToast(
        'success',
        'Lançamento Salvo no Supabase',
        `Rendimento registrado com sucesso! Rendimento Geral: ${payload.rendimento_geral_ffg_pct.toFixed(2)}%`
      );

      // Trigger reload in parent
      onRecordSaved();
      // Reset form
      handleResetForm();
    } catch (err: any) {
      showSupabaseError('Falha ao Gravar Rendimento no Supabase', err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Top Banner: Shift Selector (Strict Requirement) */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-400 font-mono">
                Lançamento Operacional FFG
              </span>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span className="text-xs text-slate-400 font-mono">Fábrica de Farinhas e Gorduras</span>
            </div>
            <h2 className="text-xl font-black text-white mt-0.5 tracking-tight">
              Apontamento de Rendimento & Desconto de Sobrepeso
            </h2>
          </div>

          {/* Shift Selector & Date */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 bg-slate-950 p-1.5 rounded-xl border border-slate-800">
              <span className="text-xs font-semibold text-slate-400 px-2 font-mono">Turno:</span>
              {(['Indústria', '1T', '2T'] as ShiftType[]).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setShift(st)}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-bold font-mono transition-all ${
                    shift === st
                      ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/30'
                      : 'text-slate-400 hover:text-white hover:bg-slate-900'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800">
              <span className="text-xs font-semibold text-slate-400 font-mono">Data:</span>
              <input
                type="date"
                value={productionDate}
                onChange={(e) => setProductionDate(e.target.value)}
                className="bg-transparent text-xs text-white font-mono focus:outline-none cursor-pointer"
              />
            </div>

            <button
              type="button"
              onClick={onOpenSkus}
              className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-emerald-300 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors border border-slate-700"
            >
              <Layers className="w-3.5 h-3.5 text-emerald-400" />
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
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                  <FileSpreadsheet className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">
                    1. Planilha de Abate / TPA (.xlsx)
                  </h3>
                  <p className="text-[11px] text-slate-400">
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
                  className="cursor-pointer px-3.5 py-1.5 bg-emerald-950 hover:bg-emerald-900 border border-emerald-700/50 text-emerald-300 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all shadow-sm"
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
              <div className="p-2.5 bg-emerald-950/40 border border-emerald-800/50 rounded-xl flex items-center justify-between text-xs">
                <span className="text-emerald-300 font-mono truncate max-w-xs">
                  {abateFileName}
                </span>
                <span className="text-[10px] text-emerald-400 bg-emerald-900/60 px-2 py-0.5 rounded font-mono">
                  Lido com sucesso
                </span>
              </div>
            )}

            {/* Inputs: Massa Viva & TPA */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
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
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-sm text-white font-mono focus:border-emerald-500 focus:outline-none"
                  />
                  <span className="absolute right-3 top-2.5 text-xs text-slate-500 font-mono">kg</span>
                </div>
                <span className="text-[10px] text-slate-500 font-mono mt-1 block">
                  Linha 164 &bull; Col {shift === '1T' ? 'C' : shift === '2T' ? 'D' : 'E'}
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
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
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-sm text-white font-mono focus:border-emerald-500 focus:outline-none"
                  />
                  <span className="absolute right-3 top-2.5 text-xs text-slate-500 font-mono">kg</span>
                </div>
                <span className="text-[10px] text-slate-500 font-mono mt-1 block">
                  Linha 160 &bull; Col {shift === '1T' ? 'C' : shift === '2T' ? 'D' : 'E'}
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
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
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-sm text-slate-300 font-mono focus:border-emerald-500 focus:outline-none"
                  />
                  <span className="absolute right-3 top-2.5 text-xs text-slate-500 font-mono">kg</span>
                </div>
                <span className="text-[10px] text-slate-500 font-mono mt-1 block">
                  Linha 159 &bull; Col G (Conferência)
                </span>
              </div>
            </div>
          </div>

          {/* Card: Planilha 2 - Produção & Sobrepeso */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400">
                  <Table className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">
                    2. Produção para Cálculo de Sobrepeso (.xlsx)
                  </h3>
                  <p className="text-[11px] text-slate-400">
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
                  className="cursor-pointer px-3.5 py-1.5 bg-sky-950 hover:bg-sky-900 border border-sky-700/50 text-sky-300 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all shadow-sm"
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
                <label className="block text-xs font-semibold text-slate-300 mb-1">
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
                    className="w-full px-3 py-2 bg-slate-950 border border-amber-500/40 rounded-xl text-sm text-amber-300 font-mono font-bold focus:border-amber-400 focus:outline-none"
                  />
                  <span className="absolute right-3 top-2.5 text-xs text-slate-500 font-mono">kg</span>
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
                    className="w-full py-2.5 bg-slate-950 hover:bg-slate-800 border border-slate-700 text-slate-200 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
                  >
                    <Eye className="w-4 h-4 text-sky-400" />
                    <span>Conferir {detalhesSobrepeso.length} SKUs Apurados</span>
                  </button>
                ) : (
                  <div className="p-2.5 bg-slate-950/60 border border-slate-800 rounded-xl text-center text-xs text-slate-500 font-mono">
                    Nenhuma planilha de produção carregada
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Card: Farinhas & Gordura Produzidas (Entradas Manuais) */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-4">
            <div className="pb-3 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <span>3. Produção da FFG (Entradas de Farinhas e Gordura)</span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 font-mono">
                    Apontamento FFG
                  </span>
                </h3>
                <p className="text-[11px] text-slate-400">
                  Informe o peso produzido de farinhas e gordura no período
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
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
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-sm text-emerald-300 font-mono font-bold focus:border-emerald-500 focus:outline-none"
                  />
                  <span className="absolute right-3 top-2.5 text-xs text-slate-500 font-mono">kg</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
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
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-sm text-emerald-300 font-mono font-bold focus:border-emerald-500 focus:outline-none"
                  />
                  <span className="absolute right-3 top-2.5 text-xs text-slate-500 font-mono">kg</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Gordura (kg) <span className="text-slate-500 text-[10px]">(Opcional)</span>
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={gorduraKg || ''}
                    onChange={(e) => setGorduraKg(parseFloat(e.target.value) || 0)}
                    placeholder="0.00"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-sm text-slate-300 font-mono focus:border-emerald-500 focus:outline-none"
                  />
                  <span className="absolute right-3 top-2.5 text-xs text-slate-500 font-mono">kg</span>
                </div>
              </div>
            </div>
          </div>

        </div>

        {/* Right Column: Real-time Live Calculations & Submission */}
        <div className="lg:col-span-5 space-y-6">
          
          <div className="bg-gradient-to-b from-slate-900 to-slate-950 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-6 sticky top-20">
            
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Calculator className="w-5 h-5 text-emerald-400" />
                <h3 className="font-extrabold text-white text-base tracking-tight">
                  Cálculo de Rendimento em Tempo Real
                </h3>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
                {shift}
              </span>
            </div>

            {/* MP Destinada FFG Box */}
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Massa Viva Recebida:</span>
                <span className="font-mono text-white font-medium">{massaVivaKg.toLocaleString('pt-BR')} kg</span>
              </div>
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>(-) Desconto TPA Total:</span>
                <span className="font-mono text-rose-400 font-medium">- {tpaTotalKg.toLocaleString('pt-BR')} kg</span>
              </div>
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>(-) Desconto Sobrepeso:</span>
                <span className="font-mono text-amber-400 font-medium">- {sobrepesoTotalKg.toLocaleString('pt-BR')} kg</span>
              </div>
              <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                    MP Destinada à FFG
                  </span>
                  <div className="text-[10px] text-slate-500">Base para cálculo dos rendimentos</div>
                </div>
                <span className="text-lg font-black font-mono text-emerald-300">
                  {mpDestinadaFfgKg.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} kg
                </span>
              </div>
            </div>

            {/* Rendimentos KPI Cards */}
            <div className="space-y-3">
              
              {/* Rendimento Geral */}
              <div className="p-4 rounded-xl bg-gradient-to-r from-emerald-950/70 to-slate-900 border border-emerald-500/40 shadow-lg">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-400 font-mono">
                      Rendimento Geral FFG
                    </span>
                    <p className="text-[10px] text-slate-400">
                      (Farinha Vísceras + Penas) / MP FFG
                    </p>
                  </div>
                  <div className="text-2xl font-black font-mono text-emerald-300">
                    {rendimentoGeralFfgPct.toFixed(2)}%
                  </div>
                </div>
                {/* Progress bar */}
                <div className="mt-2 w-full bg-slate-950 rounded-full h-2 overflow-hidden border border-slate-800">
                  <div 
                    className="bg-emerald-500 h-full rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(100, (rendimentoGeralFfgPct / 15) * 100)}%` }}
                  />
                </div>
              </div>

              {/* Rendimento Vísceras & Penas */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800">
                  <div className="text-[10px] font-bold uppercase text-slate-400 font-mono">
                    Rend. Vísceras
                  </div>
                  <div className="text-lg font-extrabold font-mono text-white mt-1">
                    {rendimentoViscerasPct.toFixed(2)}%
                  </div>
                  <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                    {farinhaViscerasKg.toLocaleString('pt-BR')} kg farinha
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800">
                  <div className="text-[10px] font-bold uppercase text-slate-400 font-mono">
                    Rend. Penas
                  </div>
                  <div className="text-lg font-extrabold font-mono text-white mt-1">
                    {rendimentoPenasPct.toFixed(2)}%
                  </div>
                  <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                    {farinhaPenasKg.toLocaleString('pt-BR')} kg farinha
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
                className="w-full py-3.5 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-black rounded-xl text-sm shadow-xl shadow-emerald-500/20 flex items-center justify-center gap-2 transition-all disabled:opacity-50"
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
                className="w-full py-2 bg-slate-950 hover:bg-slate-900 border border-slate-800 text-slate-400 hover:text-white rounded-xl text-xs font-semibold transition-colors"
              >
                Limpar Campos
              </button>
            </div>

          </div>

        </div>

      </div>

      {/* Modal: Tabela Analítica de Conferência de Sobrepeso */}
      {showSobrepesoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-slate-900 border border-slate-700 w-full max-w-4xl max-h-[85vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-800 bg-slate-950 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Table className="w-4 h-4 text-sky-400" />
                  Conferência Analítica de Sobrepeso por SKU
                </h3>
                <p className="text-xs text-slate-400">
                  {detalhesSobrepeso.length} itens localizados na planilha de produção para o turno {shift}
                </p>
              </div>
              <button
                onClick={() => setShowSobrepesoModal(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950 text-slate-400 uppercase tracking-wider sticky top-0 border-b border-slate-800 font-mono">
                  <tr>
                    <th className="px-3 py-2">Código SKU</th>
                    <th className="px-3 py-2">Descrição</th>
                    <th className="px-3 py-2">Família</th>
                    <th className="px-3 py-2 text-right">Peso Líquido</th>
                    <th className="px-3 py-2 text-right">% Sobrepeso</th>
                    <th className="px-3 py-2 text-right">Desconto (kg)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono text-slate-200">
                  {detalhesSobrepeso.map((item, idx) => (
                    <tr key={idx} className="hover:bg-slate-800/40">
                      <td className="px-3 py-2 font-semibold text-sky-400">
                        {item.codigo_encontrado || item.sku}
                      </td>
                      <td className="px-3 py-2 font-sans text-white">{item.produto}</td>
                      <td className="px-3 py-2 text-slate-400">{item.familia || '—'}</td>
                      <td className="px-3 py-2 text-right font-medium text-slate-300">
                        {item.peso_produzido.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} kg
                      </td>
                      <td className="px-3 py-2 text-right text-amber-300 font-semibold">
                        {((item.percentual <= 1 ? item.percentual * 100 : item.percentual).toFixed(2))}%
                      </td>
                      <td className="px-3 py-2 text-right font-bold text-amber-400">
                        {item.sobrepeso_kg.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} kg
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-950 text-white font-mono font-bold border-t border-slate-800">
                  <tr>
                    <td colSpan={3} className="px-3 py-2 text-right uppercase text-slate-400">Total:</td>
                    <td className="px-3 py-2 text-right text-slate-200">
                      {detalhesSobrepeso.reduce((a, b) => a + b.peso_produzido, 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} kg
                    </td>
                    <td className="px-3 py-2 text-right text-slate-500">—</td>
                    <td className="px-3 py-2 text-right text-amber-400">
                      {detalhesSobrepeso.reduce((a, b) => a + b.sobrepeso_kg, 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} kg
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="px-6 py-3 border-t border-slate-800 bg-slate-950 flex justify-end">
              <button
                onClick={() => setShowSobrepesoModal(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-semibold"
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
