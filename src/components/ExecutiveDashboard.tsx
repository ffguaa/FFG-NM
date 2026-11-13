import React, { useState, useMemo } from 'react';
import {
  FfgYieldRecord, FfgDowntime, ProductionLine, MaintenanceType
} from '../types';
import {
  Wrench, Calendar, Scale, Clock,
  AlertTriangle, BarChart3,
  Activity, Eye, Trash2, Droplets
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';

interface ExecutiveDashboardProps {
  yieldRecords: FfgYieldRecord[];
  downtimes: FfgDowntime[];
  onReload: () => void;
  onNavigateToYield: () => void;
  onNavigateToMaintenance: () => void;
}

type ChartViewMode = 'comparativo' | 'oleo' | 'farinha' | 'total';

const getRecordOilKg = (rec: FfgYieldRecord): number => {
  return Number(rec.oil_produced_kg || 0);
};

const getRecordOilYieldPct = (rec: FfgYieldRecord): number => {
  if (rec.oil_yield_percent !== undefined && rec.oil_yield_percent !== null) {
    return Math.round(Number(rec.oil_yield_percent) * 100) / 100;
  }
  const mp = Number(rec.mp_destinada_ffg_kg || 0);
  const oil = getRecordOilKg(rec);
  if (mp <= 0) return 0;
  return Math.round(((oil / mp) * 100) * 100) / 100;
};

const getRecordFarinhaYieldPct = (rec: FfgYieldRecord): number => {
  return Math.round(Number(rec.rendimento_geral_ffg_pct || 0) * 100) / 100;
};

const getRecordTotalYieldPct = (rec: FfgYieldRecord): number => {
  return Math.round((getRecordFarinhaYieldPct(rec) + getRecordOilYieldPct(rec)) * 100) / 100;
};

export const ExecutiveDashboard: React.FC<ExecutiveDashboardProps> = ({
  yieldRecords,
  downtimes,
  onReload,
  onNavigateToYield,
  onNavigateToMaintenance,
}) => {
  const { showToast, showSupabaseError } = useToast();

  // Top View Selector: "Plano Rendimento" vs "Plano Manutenção"
  const [activePlan, setActivePlan] = useState<'rendimento' | 'manutencao'>('rendimento');

  // Chart Metric Selector
  const [chartMode, setChartMode] = useState<ChartViewMode>('comparativo');

  // Filters
  const [shiftFilter, setShiftFilter] = useState<string>('Todos');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [selectedRecordDetails, setSelectedRecordDetails] = useState<FfgYieldRecord | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | number | null>(null);
  const deleteTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Filtered Yield Records
  const filteredYieldRecords = useMemo(() => {
    return yieldRecords.filter((rec) => {
      if (shiftFilter !== 'Todos' && rec.shift !== shiftFilter) return false;
      if (startDate && rec.production_date < startDate) return false;
      if (endDate && rec.production_date > endDate) return false;
      return true;
    });
  }, [yieldRecords, shiftFilter, startDate, endDate]);

  // Filtered Downtimes
  const filteredDowntimes = useMemo(() => {
    return downtimes.filter((dt) => {
      const dtDate = dt.start_datetime.split('T')[0];
      if (startDate && dtDate < startDate) return false;
      if (endDate && dtDate > endDate) return false;
      return true;
    });
  }, [downtimes, startDate, endDate]);

  // RENDIMENTO KPIs
  const yieldKpis = useMemo(() => {
    const totalRecords = filteredYieldRecords.length;
    if (totalRecords === 0) {
      return {
        avgRendimentoFarinha: 0,
        avgRendimentoOleo: 0,
        avgRendimentoTotal: 0,
        avgRendimentoVisceras: 0,
        avgRendimentoPenas: 0,
        totalMpDestinada: 0,
        totalSobrepeso: 0,
        totalMassaViva: 0,
        totalTpa: 0,
        totalFarinhaVisceras: 0,
        totalFarinhaPenas: 0,
        totalOilProducedKg: 0,
        totalGordura: 0,
      };
    }

    const sumFarinhaPct = filteredYieldRecords.reduce((a, b) => a + getRecordFarinhaYieldPct(b), 0);
    const sumOilPct = filteredYieldRecords.reduce((a, b) => a + getRecordOilYieldPct(b), 0);
    const sumTotalPct = filteredYieldRecords.reduce((a, b) => a + getRecordTotalYieldPct(b), 0);
    const sumVisc = filteredYieldRecords.reduce((a, b) => a + Number(b.rendimento_visceras_pct || 0), 0);
    const sumPenas = filteredYieldRecords.reduce((a, b) => a + Number(b.rendimento_penas_pct || 0), 0);
    const sumMp = filteredYieldRecords.reduce((a, b) => a + Number(b.mp_destinada_ffg_kg || 0), 0);
    const sumSobrepeso = filteredYieldRecords.reduce((a, b) => a + Number(b.sobrepeso_total_kg || 0), 0);
    const sumMassaViva = filteredYieldRecords.reduce((a, b) => a + Number(b.massa_viva_kg || 0), 0);
    const sumTpa = filteredYieldRecords.reduce((a, b) => a + Number(b.tpa_total_kg || 0), 0);
    const sumFarVisc = filteredYieldRecords.reduce((a, b) => a + Number(b.farinha_visceras_kg || 0), 0);
    const sumFarPen = filteredYieldRecords.reduce((a, b) => a + Number(b.farinha_penas_kg || 0), 0);
    const sumOilKg = filteredYieldRecords.reduce((a, b) => a + getRecordOilKg(b), 0);
    const sumGordura = filteredYieldRecords.reduce((a, b) => a + Number(b.gordura_kg || 0), 0);

    return {
      avgRendimentoFarinha: sumFarinhaPct / totalRecords,
      avgRendimentoOleo: sumOilPct / totalRecords,
      avgRendimentoTotal: sumTotalPct / totalRecords,
      avgRendimentoVisceras: sumVisc / totalRecords,
      avgRendimentoPenas: sumPenas / totalRecords,
      totalMpDestinada: sumMp,
      totalSobrepeso: sumSobrepeso,
      totalMassaViva: sumMassaViva,
      totalTpa: sumTpa,
      totalFarinhaVisceras: sumFarVisc,
      totalFarinhaPenas: sumFarPen,
      totalOilProducedKg: sumOilKg,
      totalGordura: sumGordura,
    };
  }, [filteredYieldRecords]);

  // Chart data (chronological order for last 15 records)
  const chartRecords = useMemo(() => {
    const recent = filteredYieldRecords.slice(0, 15).slice().reverse();
    let maxVal = 10;
    recent.forEach((rec) => {
      const f = getRecordFarinhaYieldPct(rec);
      const o = getRecordOilYieldPct(rec);
      const t = getRecordTotalYieldPct(rec);
      if (chartMode === 'comparativo') {
        maxVal = Math.max(maxVal, f, o);
      } else if (chartMode === 'farinha') {
        maxVal = Math.max(maxVal, f);
      } else if (chartMode === 'oleo') {
        maxVal = Math.max(maxVal, o);
      } else {
        maxVal = Math.max(maxVal, t);
      }
    });
    const scaleMax = Math.max(10, Math.ceil(maxVal * 1.15));
    return { items: recent, scaleMax };
  }, [filteredYieldRecords, chartMode]);

  // MANUTENÇÃO KPIs
  const maintenanceKpis = useMemo(() => {
    const totalOccurrences = filteredDowntimes.length;
    const totalMinutes = filteredDowntimes.reduce((a, b) => a + Number(b.duration_minutes || 0), 0);

    const typeCounts: Record<MaintenanceType, { count: number; minutes: number }> = {
      'Não planejada': { count: 0, minutes: 0 },
      'Planejada': { count: 0, minutes: 0 },
      'Falta de MP': { count: 0, minutes: 0 },
    };

    const lineCounts: Record<ProductionLine, { count: number; minutes: number }> = {
      'Vísceras': { count: 0, minutes: 0 },
      'Penas': { count: 0, minutes: 0 },
      'Geral/Utilidades': { count: 0, minutes: 0 },
    };

    const equipMap = new Map<string, { minutes: number; count: number; line: string }>();

    filteredDowntimes.forEach((dt) => {
      const type = dt.maintenance_type as MaintenanceType;
      const line = dt.production_line as ProductionLine;
      const mins = Number(dt.duration_minutes || 0);

      if (typeCounts[type]) {
        typeCounts[type].count += 1;
        typeCounts[type].minutes += mins;
      }
      if (lineCounts[line]) {
        lineCounts[line].count += 1;
        lineCounts[line].minutes += mins;
      }

      const eq = dt.equipment_name || 'Desconhecido';
      const cur = equipMap.get(eq) || { minutes: 0, count: 0, line: dt.production_line };
      cur.minutes += mins;
      cur.count += 1;
      equipMap.set(eq, cur);
    });

    const equipmentRanking = Array.from(equipMap.entries())
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.minutes - a.minutes);

    const hours = Math.floor(totalMinutes / 60);
    const mins = Math.round(totalMinutes % 60);
    const durationFormatted = `${hours}h ${String(mins).padStart(2, '0')}min`;

    return {
      totalOccurrences,
      totalMinutes,
      durationFormatted,
      typeCounts,
      lineCounts,
      equipmentRanking,
    };
  }, [filteredDowntimes]);

  const handleRequestDeleteRecord = (rec: FfgYieldRecord) => {
    if (deleteTimeoutRef.current) clearTimeout(deleteTimeoutRef.current);
    setConfirmDeleteId(rec.id || null);
    deleteTimeoutRef.current = setTimeout(() => {
      setConfirmDeleteId(null);
    }, 3000);
  };

  const handleDeleteRecord = async (rec: FfgYieldRecord) => {
    if (deleteTimeoutRef.current) clearTimeout(deleteTimeoutRef.current);
    setConfirmDeleteId(null);

    try {
      const { error } = await supabase
        .from('ffg_yield_records')
        .delete()
        .eq('id', rec.id);

      if (error) throw error;
      showToast('success', 'Registro Excluído', 'Lançamento de rendimento removido do Supabase.');
      onReload();
    } catch (err: any) {
      showSupabaseError('Falha ao Excluir Registro de Rendimento', err);
    }
  };

  const formatHoursMinutes = (minutes: number) => {
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return `${h}h ${String(m).padStart(2, '0')}m`;
  };

  return (
    <div className="space-y-6">

      {/* Top Banner with Vision Selector & Filters */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
        <div className="flex flex-col xl:flex-row items-start xl:items-center justify-between gap-5">

          {/* Vision Selector (Plano Rendimento vs Plano Manutenção) */}
          <div className="flex items-center gap-3">
            <div className="bg-slate-100 p-1 rounded-xl border border-slate-200 flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setActivePlan('rendimento')}
                className={`flex items-center gap-2.5 px-5 py-2.5 rounded-lg text-xs font-bold transition-all ${
                  activePlan === 'rendimento'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white'
                }`}
              >
                <Scale className="w-4 h-4" />
                <span>Plano Rendimento</span>
              </button>

              <button
                type="button"
                onClick={() => setActivePlan('manutencao')}
                className={`flex items-center gap-2.5 px-5 py-2.5 rounded-lg text-xs font-bold transition-all ${
                  activePlan === 'manutencao'
                    ? 'bg-amber-500 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white'
                }`}
              >
                <Wrench className="w-4 h-4" />
                <span>Plano Manutenção</span>
              </button>
            </div>
          </div>

          {/* Filters Bar: Period & Shift */}
          <div className="flex flex-wrap items-center gap-3 w-full xl:w-auto">

            {/* Shift Filter (Applicable to Rendimento) */}
            {activePlan === 'rendimento' && (
              <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-slate-300 text-xs">
                <span className="text-slate-500 font-mono">Turno:</span>
                <select
                  value={shiftFilter}
                  onChange={(e) => setShiftFilter(e.target.value)}
                  className="bg-transparent text-slate-900 font-mono font-bold focus:outline-none cursor-pointer"
                >
                  <option value="Todos">Todos</option>
                  <option value="Indústria">Indústria</option>
                  <option value="1T">1T</option>
                  <option value="2T">2T</option>
                </select>
              </div>
            )}

            {/* Date Filters */}
            <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-slate-300 text-xs">
              <Calendar className="w-3.5 h-3.5 text-slate-500" />
              <span className="text-slate-500 font-mono">De:</span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="bg-transparent text-slate-900 font-mono font-medium focus:outline-none cursor-pointer"
              />
              <span className="text-slate-500 font-mono">Até:</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="bg-transparent text-slate-900 font-mono font-medium focus:outline-none cursor-pointer"
              />
              {(startDate || endDate) && (
                <button
                  onClick={() => { setStartDate(''); setEndDate(''); }}
                  className="text-[10px] text-amber-700 hover:underline font-mono font-bold ml-1"
                >
                  Limpar
                </button>
              )}
            </div>

            {/* Shortcut button to jump to form */}
            {activePlan === 'rendimento' ? (
              <button
                onClick={onNavigateToYield}
                className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm"
              >
                <span>+ Novo Rendimento</span>
              </button>
            ) : (
              <button
                onClick={onNavigateToMaintenance}
                className="px-3.5 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm"
              >
                <span>+ Nova Parada</span>
              </button>
            )}

          </div>

        </div>
      </div>

      {/* ========================================================================= */}
      {/* 1. VISÃO PLANO RENDIMENTO */}
      {/* ========================================================================= */}
      {activePlan === 'rendimento' && (
        <div className="space-y-6">

          {/* KPI Cards Grid (6 cards including dedicated Oil KPI & clear Farinha / Óleo / Total separation) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">

            {/* Card 1: Rendimento Geral Total (Farinha + Óleo) */}
            <div className="bg-white border border-emerald-200 rounded-2xl p-4 shadow-sm">
              <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 font-mono">
                Rendimento Geral Total
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-3xl font-black font-mono text-emerald-700">
                  {yieldKpis.avgRendimentoTotal.toFixed(2)}%
                </span>
                <span className="text-xs text-slate-500 font-mono">média</span>
              </div>
              <div className="mt-2 text-[10px] text-slate-600 font-mono flex items-center gap-1">
                <Activity className="w-3 h-3 text-emerald-600 shrink-0" />
                <span>
                  Far: {yieldKpis.avgRendimentoFarinha.toFixed(2)}% + Óleo: {yieldKpis.avgRendimentoOleo.toFixed(2)}%
                </span>
              </div>
            </div>

            {/* Card 2: Rendimento Farinha (%) */}
            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600 font-mono">
                Rendimento Farinha
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-3xl font-black font-mono text-slate-900">
                  {yieldKpis.avgRendimentoFarinha.toFixed(2)}%
                </span>
                <span className="text-xs text-slate-500 font-mono">média</span>
              </div>
              <div className="mt-2 text-[10px] text-slate-600 font-mono">
                Vísc: {yieldKpis.avgRendimentoVisceras.toFixed(2)}% | Penas: {yieldKpis.avgRendimentoPenas.toFixed(2)}%
              </div>
            </div>

            {/* Card 3: Óleo Produzido & Rendimento de Óleo (%) */}
            <div className="bg-white border border-amber-300 rounded-2xl p-4 shadow-sm">
              <div className="text-[10px] font-bold uppercase tracking-wider text-amber-700 font-mono flex items-center gap-1">
                <Droplets className="w-3.5 h-3.5 text-amber-600" />
                <span>Produção de Óleo</span>
              </div>
              <div className="mt-2 flex items-baseline gap-1.5">
                <span className="text-2xl font-black font-mono text-amber-700">
                  {yieldKpis.totalOilProducedKg.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}
                </span>
                <span className="text-xs text-slate-500 font-mono">kg</span>
                <span className="text-[11px] font-mono font-semibold text-slate-500">
                  ({(yieldKpis.totalOilProducedKg / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} t)
                </span>
              </div>
              <div className="mt-2 text-[11px] text-amber-800 font-mono font-bold">
                Rend. Óleo Médio: {yieldKpis.avgRendimentoOleo.toFixed(2)}%
              </div>
            </div>

            {/* Card 4: Farinhas Produzidas (Vísceras + Penas) */}
            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600 font-mono">
                Farinhas Produzidas
              </div>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-2xl font-black font-mono text-slate-900">
                  {(yieldKpis.totalFarinhaVisceras + yieldKpis.totalFarinhaPenas).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}
                </span>
                <span className="text-xs text-slate-500 font-mono">kg</span>
              </div>
              <div className="mt-2 text-[10px] text-slate-500 font-mono">
                V: {yieldKpis.totalFarinhaVisceras.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} | P: {yieldKpis.totalFarinhaPenas.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}
              </div>
            </div>

            {/* Card 5: Total MP Destinada FFG */}
            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600 font-mono">
                MP Destinada FFG
              </div>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-2xl font-black font-mono text-emerald-700">
                  {yieldKpis.totalMpDestinada.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}
                </span>
                <span className="text-xs text-slate-500 font-mono">kg</span>
              </div>
              <div className="mt-2 text-[10px] text-slate-500 font-mono">
                Massa Viva: {yieldKpis.totalMassaViva.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} kg
              </div>
            </div>

            {/* Card 6: Total Sobrepeso Descontado */}
            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600 font-mono">
                Sobrepeso Descontado
              </div>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-2xl font-black font-mono text-amber-700">
                  {yieldKpis.totalSobrepeso.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}
                </span>
                <span className="text-xs text-slate-500 font-mono">kg</span>
              </div>
              <div className="mt-2 text-[10px] text-slate-500 font-mono">
                TPA: {yieldKpis.totalTpa.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} kg
              </div>
            </div>

          </div>

          {/* Gráfico de Evolução Diária (Sem tooltips escuros no hover) */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-3 border-b border-slate-200">
              <div>
                <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-emerald-600" />
                  Evolução de Rendimento — Farinha vs Óleo (%) por Lançamento
                </h3>
                <p className="text-xs text-slate-500">
                  Acompanhamento de eficiência industrial ({filteredYieldRecords.length} lançamentos no filtro)
                </p>
              </div>

              {/* Chart Mode Selector */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs font-mono">
                  <button
                    type="button"
                    onClick={() => setChartMode('comparativo')}
                    className={`px-2.5 py-1 rounded-lg font-bold transition-colors ${
                      chartMode === 'comparativo'
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Farinha vs Óleo
                  </button>
                  <button
                    type="button"
                    onClick={() => setChartMode('oleo')}
                    className={`px-2.5 py-1 rounded-lg font-bold transition-colors ${
                      chartMode === 'oleo'
                        ? 'bg-amber-500 text-white shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Rend. Óleo
                  </button>
                  <button
                    type="button"
                    onClick={() => setChartMode('farinha')}
                    className={`px-2.5 py-1 rounded-lg font-bold transition-colors ${
                      chartMode === 'farinha'
                        ? 'bg-emerald-600 text-white shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Rend. Farinha
                  </button>
                  <button
                    type="button"
                    onClick={() => setChartMode('total')}
                    className={`px-2.5 py-1 rounded-lg font-bold transition-colors ${
                      chartMode === 'total'
                        ? 'bg-teal-600 text-white shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Total (F+O)
                  </button>
                </div>

                {/* Legend */}
                <div className="flex items-center gap-3 text-xs font-mono pl-1">
                  {(chartMode === 'comparativo' || chartMode === 'farinha') && (
                    <div className="flex items-center gap-1.5">
                      <span className="w-3 h-3 rounded bg-emerald-600" />
                      <span className="text-slate-700">Farinha (%)</span>
                    </div>
                  )}
                  {(chartMode === 'comparativo' || chartMode === 'oleo') && (
                    <div className="flex items-center gap-1.5">
                      <span className="w-3 h-3 rounded bg-amber-500" />
                      <span className="text-slate-700">Óleo (%)</span>
                    </div>
                  )}
                  {chartMode === 'total' && (
                    <div className="flex items-center gap-1.5">
                      <span className="w-3 h-3 rounded bg-teal-600" />
                      <span className="text-slate-700">Geral Total (%)</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {filteredYieldRecords.length === 0 ? (
              <div className="py-16 text-center text-slate-500">
                Nenhum registro de rendimento encontrado para os filtros selecionados.
              </div>
            ) : (
              <div className="space-y-3 pt-2">
                <div className="h-56 flex items-end gap-2.5 pt-6 pb-2 px-2 border-b border-slate-200 overflow-x-auto">
                  {chartRecords.items.map((rec, i) => {
                    const farinhaPct = getRecordFarinhaYieldPct(rec);
                    const oilPct = getRecordOilYieldPct(rec);
                    const totalPct = getRecordTotalYieldPct(rec);

                    if (chartMode === 'comparativo') {
                      const farinhaHeight = Math.min(100, Math.max(4, (farinhaPct / chartRecords.scaleMax) * 100));
                      const oilHeight = Math.min(100, Math.max(4, (oilPct / chartRecords.scaleMax) * 100));

                      return (
                        <div
                          key={rec.id || i}
                          className="flex-1 min-w-[66px] max-w-[92px] flex flex-col items-center gap-1.5"
                        >
                          <div className="flex items-center justify-center gap-1.5 text-[10px] font-bold font-mono">
                            <span className="text-emerald-700">{farinhaPct.toFixed(1)}%</span>
                            <span className="text-slate-300">/</span>
                            <span className="text-amber-600">{oilPct.toFixed(1)}%</span>
                          </div>

                          <div className="w-full bg-slate-50 rounded-t-lg h-36 flex items-end justify-center gap-1 p-1 border border-slate-200">
                            <div
                              className="w-1/2 rounded-t-md bg-emerald-600 transition-all duration-500"
                              style={{ height: `${farinhaHeight}%` }}
                            />
                            <div
                              className="w-1/2 rounded-t-md bg-amber-500 transition-all duration-500"
                              style={{ height: `${oilHeight}%` }}
                            />
                          </div>

                          <span className="text-[10px] font-mono text-slate-600 truncate w-full text-center">
                            {rec.production_date.slice(5)} ({rec.shift})
                          </span>
                        </div>
                      );
                    }

                    const pct =
                      chartMode === 'oleo'
                        ? oilPct
                        : chartMode === 'farinha'
                        ? farinhaPct
                        : totalPct;
                    const heightPct = Math.min(100, Math.max(4, (pct / chartRecords.scaleMax) * 100));
                    const barColor =
                      chartMode === 'oleo'
                        ? 'bg-amber-500'
                        : chartMode === 'farinha'
                        ? 'bg-emerald-600'
                        : 'bg-teal-600';
                    const textColor =
                      chartMode === 'oleo'
                        ? 'text-amber-700'
                        : chartMode === 'farinha'
                        ? 'text-emerald-700'
                        : 'text-teal-700';

                    return (
                      <div
                        key={rec.id || i}
                        className="flex-1 min-w-[52px] max-w-[78px] flex flex-col items-center gap-1.5"
                      >
                        <span className={`text-[10px] font-bold font-mono ${textColor}`}>
                          {pct.toFixed(2)}%
                        </span>

                        <div className="w-full bg-slate-50 rounded-t-lg h-36 flex items-end p-1 border border-slate-200">
                          <div
                            className={`w-full rounded-t-md transition-all duration-500 ${barColor}`}
                            style={{ height: `${heightPct}%` }}
                          />
                        </div>

                        <span className="text-[10px] font-mono text-slate-600 truncate w-full text-center">
                          {rec.production_date.slice(5)} ({rec.shift})
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Tabela Resumo dos Lançamentos */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div>
                <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                  <TableSummaryIcon className="w-5 h-5 text-emerald-600" />
                  Registros Gravados de Rendimento FFG
                </h3>
                <p className="text-xs text-slate-500">
                  {filteredYieldRecords.length} lançamentos gravados no Supabase
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-center text-xs">
                <thead className="bg-slate-100 text-slate-700 uppercase tracking-wider border-b border-slate-200 font-mono">
                  <tr>
                    <th className="px-3 py-2.5 text-center">Data</th>
                    <th className="px-3 py-2.5 text-center">Turno</th>
                    <th className="px-3 py-2.5 text-center">Massa Viva (kg)</th>
                    <th className="px-3 py-2.5 text-center">TPA Total (kg)</th>
                    <th className="px-3 py-2.5 text-center">Sobrepeso (kg)</th>
                    <th className="px-3 py-2.5 text-center">MP Destinada FFG</th>
                    <th className="px-3 py-2.5 text-center">Farinhas (V+P)</th>
                    <th className="px-3 py-2.5 text-center">Óleo (kg)</th>
                    <th className="px-3 py-2.5 text-center">Rend. Farinha (%)</th>
                    <th className="px-3 py-2.5 text-center">Rend. Óleo (%)</th>
                    <th className="px-3 py-2.5 text-center">Rend. Total (%)</th>
                    <th className="px-3 py-2.5 text-center">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 font-mono text-slate-800">
                  {filteredYieldRecords.length === 0 ? (
                    <tr>
                      <td colSpan={12} className="px-4 py-8 text-center text-slate-500 font-sans">
                        Nenhum registro encontrado.
                      </td>
                    </tr>
                  ) : (
                    filteredYieldRecords.map((item) => {
                      const oilKg = getRecordOilKg(item);
                      const oilYield = getRecordOilYieldPct(item);
                      const farinhaYield = getRecordFarinhaYieldPct(item);
                      const totalYield = getRecordTotalYieldPct(item);

                      return (
                        <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-3 py-2.5 text-center font-bold text-slate-900 whitespace-nowrap">
                            {item.production_date}
                          </td>
                          <td className="px-3 py-2.5 text-center whitespace-nowrap">
                            <span className="px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 font-bold text-[10px]">
                              {item.shift}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-center text-slate-700">
                            {Number(item.massa_viva_kg).toLocaleString('pt-BR')}
                          </td>
                          <td className="px-3 py-2.5 text-center text-slate-600">
                            {Number(item.tpa_total_kg).toLocaleString('pt-BR')}
                          </td>
                          <td className="px-3 py-2.5 text-center text-amber-700 font-semibold">
                            {Number(item.sobrepeso_total_kg).toLocaleString('pt-BR')}
                          </td>
                          <td className="px-3 py-2.5 text-center font-bold text-emerald-700">
                            {Number(item.mp_destinada_ffg_kg).toLocaleString('pt-BR')}
                          </td>
                          <td className="px-3 py-2.5 text-center text-slate-700">
                            {(Number(item.farinha_visceras_kg) + Number(item.farinha_penas_kg)).toLocaleString('pt-BR')}
                          </td>
                          <td className="px-3 py-2.5 text-center font-semibold text-amber-700">
                            {oilKg.toLocaleString('pt-BR')}
                          </td>
                          <td className="px-3 py-2.5 text-center font-bold text-emerald-700">
                            {farinhaYield.toFixed(2)}%
                          </td>
                          <td className="px-3 py-2.5 text-center font-bold text-amber-700">
                            {oilYield.toFixed(2)}%
                          </td>
                          <td className="px-3 py-2.5 text-center font-black text-teal-800">
                            {totalYield.toFixed(2)}%
                          </td>
                          <td className="px-3 py-2.5 text-center whitespace-nowrap">
                            <div className="flex items-center justify-center gap-1.5">
                              {item.detalhes_sobrepeso && item.detalhes_sobrepeso.length > 0 && (
                                <button
                                  onClick={() => setSelectedRecordDetails(item)}
                                  className="p-1 text-sky-600 hover:text-sky-800 rounded hover:bg-sky-50"
                                  title="Ver Detalhes do Sobrepeso"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                </button>
                              )}
                              {confirmDeleteId === item.id ? (
                                <button
                                  onClick={() => handleDeleteRecord(item)}
                                  className="px-2 py-0.5 rounded bg-rose-600 hover:bg-rose-700 text-white font-bold text-[11px] font-mono animate-pulse shadow-sm transition-all"
                                  title="Clique novamente para confirmar a exclusão no Supabase"
                                >
                                  Confirmar?
                                </button>
                              ) : (
                                <button
                                  onClick={() => handleRequestDeleteRecord(item)}
                                  className="p-1 text-slate-400 hover:text-rose-600 rounded hover:bg-rose-50"
                                  title="Excluir Registro"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
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
      {/* 2. VISÃO PLANO MANUTENÇÃO */}
      {/* ========================================================================= */}
      {activePlan === 'manutencao' && (
        <div className="space-y-6">

          {/* KPI Cards Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">

            {/* KPI 1: Tempo Total Parado */}
            <div className="bg-white border border-amber-300 rounded-2xl p-5 shadow-sm">
              <div className="text-[10px] font-bold uppercase tracking-wider text-amber-700 font-mono">
                Tempo Total Parado
              </div>
              <div className="mt-2 text-3xl font-black font-mono text-amber-700">
                {maintenanceKpis.durationFormatted}
              </div>
              <div className="mt-2 text-[10px] text-slate-500 font-mono">
                {maintenanceKpis.totalMinutes} minutos acumulados
              </div>
            </div>

            {/* KPI 2: Total de Ocorrências */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600 font-mono">
                Total de Ocorrências
              </div>
              <div className="mt-2 text-3xl font-black font-mono text-slate-900">
                {maintenanceKpis.totalOccurrences}
              </div>
              <div className="mt-2 text-[10px] text-slate-500 font-mono">
                Registros de parada no período
              </div>
            </div>

            {/* KPI 3: Por Tipo de Manutenção */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-2">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600 font-mono">
                Distribuição por Tipo
              </div>
              <div className="space-y-1 text-xs font-mono">
                <div className="flex justify-between items-center text-rose-700">
                  <span>Não planejada:</span>
                  <span className="font-bold">{maintenanceKpis.typeCounts['Não planejada'].count}x ({formatHoursMinutes(maintenanceKpis.typeCounts['Não planejada'].minutes)})</span>
                </div>
                <div className="flex justify-between items-center text-emerald-700">
                  <span>Planejada:</span>
                  <span className="font-bold">{maintenanceKpis.typeCounts['Planejada'].count}x ({formatHoursMinutes(maintenanceKpis.typeCounts['Planejada'].minutes)})</span>
                </div>
                <div className="flex justify-between items-center text-amber-700">
                  <span>Falta de MP:</span>
                  <span className="font-bold">{maintenanceKpis.typeCounts['Falta de MP'].count}x ({formatHoursMinutes(maintenanceKpis.typeCounts['Falta de MP'].minutes)})</span>
                </div>
              </div>
            </div>

            {/* KPI 4: Por Linha de Produção */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-2">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600 font-mono">
                Divisão por Linha
              </div>
              <div className="space-y-1 text-xs font-mono">
                <div className="flex justify-between items-center text-sky-700">
                  <span>Vísceras:</span>
                  <span className="font-bold">{formatHoursMinutes(maintenanceKpis.lineCounts['Vísceras'].minutes)} ({maintenanceKpis.lineCounts['Vísceras'].count}x)</span>
                </div>
                <div className="flex justify-between items-center text-teal-700">
                  <span>Penas:</span>
                  <span className="font-bold">{formatHoursMinutes(maintenanceKpis.lineCounts['Penas'].minutes)} ({maintenanceKpis.lineCounts['Penas'].count}x)</span>
                </div>
                <div className="flex justify-between items-center text-slate-700">
                  <span>Geral/Utilidades:</span>
                  <span className="font-bold">{formatHoursMinutes(maintenanceKpis.lineCounts['Geral/Utilidades'].minutes)} ({maintenanceKpis.lineCounts['Geral/Utilidades'].count}x)</span>
                </div>
              </div>
            </div>

          </div>

          {/* Ranking dos Equipamentos que Mais Pararam */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

            {/* Ranking Bar List */}
            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                <div>
                  <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-amber-600" />
                    Ranking de Indisponibilidade por Equipamento
                  </h3>
                  <p className="text-xs text-slate-500">
                    Equipamentos que acumularam maior tempo de parada
                  </p>
                </div>
              </div>

              {maintenanceKpis.equipmentRanking.length === 0 ? (
                <div className="py-12 text-center text-slate-500 font-sans">
                  Nenhuma parada registrada para gerar ranking.
                </div>
              ) : (
                <div className="space-y-3">
                  {maintenanceKpis.equipmentRanking.slice(0, 8).map((eq, idx) => {
                    const pctOfTotal = maintenanceKpis.totalMinutes > 0
                      ? (eq.minutes / maintenanceKpis.totalMinutes) * 100
                      : 0;

                    return (
                      <div key={eq.name} className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <span className="w-5 h-5 rounded-md bg-slate-200 text-slate-700 font-mono text-[10px] flex items-center justify-center font-bold">
                              #{idx + 1}
                            </span>
                            <span className="font-bold text-slate-900">{eq.name}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-600 font-mono">
                              {eq.line}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 font-mono">
                            <span className="text-slate-500 text-[11px]">{eq.count} ocorrências</span>
                            <span className="font-bold text-amber-700">{formatHoursMinutes(eq.minutes)}</span>
                          </div>
                        </div>

                        {/* Progress Bar */}
                        <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                          <div
                            className="bg-amber-500 h-full rounded-full transition-all duration-500"
                            style={{ width: `${Math.min(100, Math.max(3, pctOfTotal))}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Recent Occurrences Summary */}
            <div className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
              <div className="pb-3 border-b border-slate-200 flex items-center justify-between">
                <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                  <Clock className="w-5 h-5 text-amber-600" />
                  Últimas Ocorrências Registradas
                </h3>
              </div>

              {filteredDowntimes.length === 0 ? (
                <div className="py-12 text-center text-slate-500 font-sans">
                  Nenhuma ocorrência recente.
                </div>
              ) : (
                <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
                  {filteredDowntimes.slice(0, 6).map((item) => (
                    <div key={item.id} className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-slate-900 truncate max-w-[180px]">{item.equipment_name}</span>
                        <span className="text-amber-700 font-mono font-bold">
                          {formatHoursMinutes(item.duration_minutes)}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-600 line-clamp-1">{item.problem_description}</p>
                      <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono pt-1">
                        <span>{new Date(item.start_datetime).toLocaleDateString('pt-BR')} &bull; {item.responsible_person || 'Equipe FFG'}</span>
                        <span className={`px-1.5 py-0.5 rounded font-semibold ${
                          item.maintenance_type === 'Não planejada'
                            ? 'bg-rose-50 text-rose-700 border border-rose-200'
                            : 'bg-slate-200 text-slate-700'
                        }`}>
                          {item.maintenance_type}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>

        </div>
      )}

      {/* Modal: Detalhes de Sobrepeso do Registro Selecionado */}
      {selectedRecordDetails && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white border border-slate-200 w-full max-w-3xl max-h-[80vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Detalhamento de Sobrepeso &bull; {selectedRecordDetails.production_date} ({selectedRecordDetails.shift})
                </h3>
                <p className="text-xs text-slate-500">
                  Total descontado: {Number(selectedRecordDetails.sobrepeso_total_kg).toLocaleString('pt-BR')} kg
                </p>
              </div>
              <button
                onClick={() => setSelectedRecordDetails(null)}
                className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-200"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              <table className="w-full text-center text-xs">
                <thead className="bg-slate-100 text-slate-700 uppercase font-mono sticky top-0 border-b border-slate-200">
                  <tr>
                    <th className="px-3 py-2 text-center">Código</th>
                    <th className="px-3 py-2 text-center">Produto</th>
                    <th className="px-3 py-2 text-center">Peso Líquido</th>
                    <th className="px-3 py-2 text-center">%</th>
                    <th className="px-3 py-2 text-center">Sobrepeso</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 font-mono text-slate-800">
                  {selectedRecordDetails.detalhes_sobrepeso?.map((item, idx) => (
                    <tr key={idx} className="hover:bg-slate-50">
                      <td className="px-3 py-2 text-center font-semibold text-sky-700">{item.codigo_encontrado || item.sku}</td>
                      <td className="px-3 py-2 text-center font-sans text-slate-900">{item.produto}</td>
                      <td className="px-3 py-2 text-center text-slate-700">{item.peso_produzido.toLocaleString('pt-BR')} kg</td>
                      <td className="px-3 py-2 text-center text-amber-700 font-semibold">
                        {((Number(item.percentual) <= 1 ? Number(item.percentual) * 100 : Number(item.percentual)).toFixed(2))}%
                      </td>
                      <td className="px-3 py-2 text-center font-bold text-amber-700">{item.sobrepeso_kg.toLocaleString('pt-BR')} kg</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex justify-end">
              <button
                onClick={() => setSelectedRecordDetails(null)}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-lg text-xs font-semibold"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

const TableSummaryIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 9h18" />
    <path d="M3 15h18" />
    <path d="M9 9v12" />
  </svg>
);
