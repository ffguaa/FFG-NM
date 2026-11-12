import React, { useState, useMemo } from 'react';
import { 
  FfgYieldRecord, FfgDowntime, ShiftType, ProductionLine, MaintenanceType 
} from '../types';
import { 
  TrendingUp, Wrench, Calendar, Filter, Scale, Clock, 
  AlertTriangle, CheckCircle2, ChevronRight, BarChart3, 
  Activity, Layers, Eye, Trash2, ArrowUpRight, ArrowDownRight
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

  // Filters
  const [shiftFilter, setShiftFilter] = useState<string>('Todos');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [selectedRecordDetails, setSelectedRecordDetails] = useState<FfgYieldRecord | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | number | null>(null);
  const deleteTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

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
        avgRendimentoGeral: 0,
        avgRendimentoVisceras: 0,
        avgRendimentoPenas: 0,
        totalMpDestinada: 0,
        totalSobrepeso: 0,
        totalMassaViva: 0,
        totalTpa: 0,
        totalFarinhaVisceras: 0,
        totalFarinhaPenas: 0,
        totalGordura: 0,
      };
    }

    const sumGeral = filteredYieldRecords.reduce((a, b) => a + Number(b.rendimento_geral_ffg_pct || 0), 0);
    const sumVisc = filteredYieldRecords.reduce((a, b) => a + Number(b.rendimento_visceras_pct || 0), 0);
    const sumPenas = filteredYieldRecords.reduce((a, b) => a + Number(b.rendimento_penas_pct || 0), 0);
    const sumMp = filteredYieldRecords.reduce((a, b) => a + Number(b.mp_destinada_ffg_kg || 0), 0);
    const sumSobrepeso = filteredYieldRecords.reduce((a, b) => a + Number(b.sobrepeso_total_kg || 0), 0);
    const sumMassaViva = filteredYieldRecords.reduce((a, b) => a + Number(b.massa_viva_kg || 0), 0);
    const sumTpa = filteredYieldRecords.reduce((a, b) => a + Number(b.tpa_total_kg || 0), 0);
    const sumFarVisc = filteredYieldRecords.reduce((a, b) => a + Number(b.farinha_visceras_kg || 0), 0);
    const sumFarPen = filteredYieldRecords.reduce((a, b) => a + Number(b.farinha_penas_kg || 0), 0);
    const sumGordura = filteredYieldRecords.reduce((a, b) => a + Number(b.gordura_kg || 0), 0);

    return {
      avgRendimentoGeral: sumGeral / totalRecords,
      avgRendimentoVisceras: sumVisc / totalRecords,
      avgRendimentoPenas: sumPenas / totalRecords,
      totalMpDestinada: sumMp,
      totalSobrepeso: sumSobrepeso,
      totalMassaViva: sumMassaViva,
      totalTpa: sumTpa,
      totalFarinhaVisceras: sumFarVisc,
      totalFarinhaPenas: sumFarPen,
      totalGordura: sumGordura,
    };
  }, [filteredYieldRecords]);

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
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
        <div className="flex flex-col xl:flex-row items-start xl:items-center justify-between gap-5">
          
          {/* Vision Selector (Plano Rendimento vs Plano Manutenção) */}
          <div className="flex items-center gap-3">
            <div className="bg-slate-950 p-1.5 rounded-xl border border-slate-800 flex items-center gap-1.5 shadow-inner">
              <button
                type="button"
                onClick={() => setActivePlan('rendimento')}
                className={`flex items-center gap-2.5 px-5 py-2.5 rounded-lg text-xs font-bold transition-all ${
                  activePlan === 'rendimento'
                    ? 'bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-500/30'
                    : 'text-slate-400 hover:text-white hover:bg-slate-900'
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
                    ? 'bg-amber-500 text-slate-950 shadow-lg shadow-amber-500/30'
                    : 'text-slate-400 hover:text-white hover:bg-slate-900'
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
              <div className="flex items-center gap-2 bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800 text-xs">
                <span className="text-slate-400 font-mono">Turno:</span>
                <select
                  value={shiftFilter}
                  onChange={(e) => setShiftFilter(e.target.value)}
                  className="bg-transparent text-white font-mono font-bold focus:outline-none cursor-pointer"
                >
                  <option value="Todos" className="bg-slate-900">Todos</option>
                  <option value="Indústria" className="bg-slate-900">Indústria</option>
                  <option value="1T" className="bg-slate-900">1T</option>
                  <option value="2T" className="bg-slate-900">2T</option>
                </select>
              </div>
            )}

            {/* Date Filters */}
            <div className="flex items-center gap-2 bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800 text-xs">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-slate-400 font-mono">De:</span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="bg-transparent text-white font-mono focus:outline-none cursor-pointer"
              />
              <span className="text-slate-400 font-mono">Até:</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="bg-transparent text-white font-mono focus:outline-none cursor-pointer"
              />
              {(startDate || endDate) && (
                <button
                  onClick={() => { setStartDate(''); setEndDate(''); }}
                  className="text-[10px] text-amber-400 hover:underline font-mono ml-1"
                >
                  Limpar
                </button>
              )}
            </div>

            {/* Shortcut button to jump to form */}
            {activePlan === 'rendimento' ? (
              <button
                onClick={onNavigateToYield}
                className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-slate-950 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-md shadow-emerald-600/20"
              >
                <span>+ Novo Rendimento</span>
              </button>
            ) : (
              <button
                onClick={onNavigateToMaintenance}
                className="px-3.5 py-2 bg-amber-600 hover:bg-amber-500 text-slate-950 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-md shadow-amber-600/20"
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
          
          {/* KPI Cards Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            
            {/* Card 1: Rendimento Geral FFG */}
            <div className="bg-slate-900 border border-emerald-500/40 rounded-2xl p-4 shadow-xl relative overflow-hidden">
              <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none" />
              <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 font-mono">
                Rendimento Geral FFG
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-3xl font-black font-mono text-emerald-300">
                  {yieldKpis.avgRendimentoGeral.toFixed(2)}%
                </span>
                <span className="text-xs text-slate-400 font-mono">média</span>
              </div>
              <div className="mt-2 text-[10px] text-slate-400 flex items-center gap-1">
                <Activity className="w-3 h-3 text-emerald-400" />
                <span>Base: (Vísceras + Penas) / MP</span>
              </div>
            </div>

            {/* Card 2: Rendimento Vísceras */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono">
                Rendimento Vísceras
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-3xl font-black font-mono text-white">
                  {yieldKpis.avgRendimentoVisceras.toFixed(2)}%
                </span>
                <span className="text-xs text-slate-400 font-mono">média</span>
              </div>
              <div className="mt-2 text-[10px] text-slate-400 font-mono">
                Total: {yieldKpis.totalFarinhaVisceras.toLocaleString('pt-BR')} kg farinha
              </div>
            </div>

            {/* Card 3: Rendimento Penas */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono">
                Rendimento Penas
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-3xl font-black font-mono text-white">
                  {yieldKpis.avgRendimentoPenas.toFixed(2)}%
                </span>
                <span className="text-xs text-slate-400 font-mono">média</span>
              </div>
              <div className="mt-2 text-[10px] text-slate-400 font-mono">
                Total: {yieldKpis.totalFarinhaPenas.toLocaleString('pt-BR')} kg farinha
              </div>
            </div>

            {/* Card 4: Total MP Destinada FFG */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono">
                MP Destinada FFG (kg)
              </div>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-2xl font-black font-mono text-emerald-400">
                  {yieldKpis.totalMpDestinada.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}
                </span>
                <span className="text-xs text-slate-400 font-mono">kg</span>
              </div>
              <div className="mt-2 text-[10px] text-slate-400 font-mono">
                Massa Viva: {yieldKpis.totalMassaViva.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} kg
              </div>
            </div>

            {/* Card 5: Total Sobrepeso Descontado */}
            <div className="bg-slate-900 border border-amber-500/30 rounded-2xl p-4 shadow-xl">
              <div className="text-[10px] font-bold uppercase tracking-wider text-amber-400 font-mono">
                Sobrepeso Descontado
              </div>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-2xl font-black font-mono text-amber-300">
                  {yieldKpis.totalSobrepeso.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}
                </span>
                <span className="text-xs text-slate-400 font-mono">kg</span>
              </div>
              <div className="mt-2 text-[10px] text-slate-400 font-mono">
                TPA: {yieldKpis.totalTpa.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} kg
              </div>
            </div>

          </div>

          {/* Gráfico de Evolução Diária */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div>
                <h3 className="font-bold text-white text-base flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-emerald-400" />
                  Evolução do Rendimento Geral FFG (%) por Lançamento
                </h3>
                <p className="text-xs text-slate-400">
                  Acompanhamento de eficiência industrial ({filteredYieldRecords.length} lançamentos no filtro)
                </p>
              </div>

              <div className="flex items-center gap-4 text-xs font-mono">
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded bg-emerald-500" />
                  <span className="text-slate-300">Rendimento Geral (%)</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-1 rounded bg-amber-400" />
                  <span className="text-slate-400">Meta FFG (~10-12%)</span>
                </div>
              </div>
            </div>

            {filteredYieldRecords.length === 0 ? (
              <div className="py-16 text-center text-slate-500">
                Nenhum registro de rendimento encontrado para os filtros selecionados.
              </div>
            ) : (
              <div className="space-y-3 pt-2">
                {/* Visual Bar Chart */}
                <div className="h-48 flex items-end gap-2 pt-6 pb-2 px-2 border-b border-slate-800 overflow-x-auto">
                  {filteredYieldRecords.slice(-15).map((rec, i) => {
                    const pct = Number(rec.rendimento_geral_ffg_pct || 0);
                    // Scale height against max 16%
                    const heightPct = Math.min(100, Math.max(5, (pct / 16) * 100));

                    return (
                      <div
                        key={rec.id || i}
                        className="flex-1 min-w-[48px] max-w-[72px] flex flex-col items-center gap-2 group relative"
                      >
                        {/* Tooltip */}
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity absolute -top-16 bg-slate-950 border border-slate-700 text-white rounded-lg p-2 text-[10px] font-mono shadow-2xl z-20 pointer-events-none whitespace-nowrap">
                          <div>Data: {rec.production_date} ({rec.shift})</div>
                          <div className="text-emerald-400 font-bold">Rend. Geral: {pct.toFixed(2)}%</div>
                          <div>MP: {Number(rec.mp_destinada_ffg_kg).toLocaleString('pt-BR')} kg</div>
                        </div>

                        {/* Value label */}
                        <span className="text-[10px] font-bold font-mono text-emerald-400">
                          {pct.toFixed(1)}%
                        </span>

                        {/* Bar */}
                        <div className="w-full bg-slate-950 rounded-t-lg h-32 flex items-end p-0.5 border border-slate-800">
                          <div
                            className={`w-full rounded-t-md transition-all duration-500 ${
                              pct >= 11
                                ? 'bg-gradient-to-t from-emerald-600 to-teal-400'
                                : pct >= 9
                                ? 'bg-gradient-to-t from-emerald-700 to-emerald-500'
                                : 'bg-gradient-to-t from-amber-700 to-amber-500'
                            }`}
                            style={{ height: `${heightPct}%` }}
                          />
                        </div>

                        {/* Date label */}
                        <span className="text-[9px] font-mono text-slate-400 truncate w-full text-center">
                          {rec.production_date.slice(5)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Tabela Resumo dos Lançamentos */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div>
                <h3 className="font-bold text-white text-base flex items-center gap-2">
                  <TableSummaryIcon className="w-5 h-5 text-emerald-400" />
                  Registros Gravados de Rendimento FFG
                </h3>
                <p className="text-xs text-slate-400">
                  {filteredYieldRecords.length} lançamentos gravados no Supabase
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950 text-slate-400 uppercase tracking-wider border-b border-slate-800 font-mono">
                  <tr>
                    <th className="px-3 py-2.5">Data</th>
                    <th className="px-3 py-2.5">Turno</th>
                    <th className="px-3 py-2.5 text-right">Massa Viva (kg)</th>
                    <th className="px-3 py-2.5 text-right">TPA Total (kg)</th>
                    <th className="px-3 py-2.5 text-right">Sobrepeso (kg)</th>
                    <th className="px-3 py-2.5 text-right">MP Destinada FFG</th>
                    <th className="px-3 py-2.5 text-right">Farinhas (V+P)</th>
                    <th className="px-3 py-2.5 text-right">Rend. Geral</th>
                    <th className="px-3 py-2.5 text-center">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono text-slate-200">
                  {filteredYieldRecords.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-8 text-center text-slate-500 font-sans">
                        Nenhum registro encontrado.
                      </td>
                    </tr>
                  ) : (
                    filteredYieldRecords.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-800/40 transition-colors">
                        <td className="px-3 py-2.5 font-bold text-white whitespace-nowrap">
                          {item.production_date}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <span className="px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-emerald-400 font-bold text-[10px]">
                            {item.shift}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right text-slate-300">
                          {Number(item.massa_viva_kg).toLocaleString('pt-BR')}
                        </td>
                        <td className="px-3 py-2.5 text-right text-slate-400">
                          {Number(item.tpa_total_kg).toLocaleString('pt-BR')}
                        </td>
                        <td className="px-3 py-2.5 text-right text-amber-300 font-semibold">
                          {Number(item.sobrepeso_total_kg).toLocaleString('pt-BR')}
                        </td>
                        <td className="px-3 py-2.5 text-right font-bold text-emerald-400">
                          {Number(item.mp_destinada_ffg_kg).toLocaleString('pt-BR')}
                        </td>
                        <td className="px-3 py-2.5 text-right text-slate-300">
                          {(Number(item.farinha_visceras_kg) + Number(item.farinha_penas_kg)).toLocaleString('pt-BR')}
                        </td>
                        <td className="px-3 py-2.5 text-right font-black text-emerald-300">
                          {Number(item.rendimento_geral_ffg_pct).toFixed(2)}%
                        </td>
                        <td className="px-3 py-2.5 text-center whitespace-nowrap">
                          <div className="flex items-center justify-center gap-1.5">
                            {item.detalhes_sobrepeso && item.detalhes_sobrepeso.length > 0 && (
                              <button
                                onClick={() => setSelectedRecordDetails(item)}
                                className="p-1 text-sky-400 hover:text-white rounded hover:bg-slate-800"
                                title="Ver Detalhes do Sobrepeso"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {confirmDeleteId === item.id ? (
                              <button
                                onClick={() => handleDeleteRecord(item)}
                                className="px-2 py-0.5 rounded bg-rose-600 hover:bg-rose-500 text-white font-bold text-[11px] font-mono animate-pulse shadow-md shadow-rose-950/40 transition-all"
                                title="Clique novamente para confirmar a exclusão no Supabase"
                              >
                                Confirmar?
                              </button>
                            ) : (
                              <button
                                onClick={() => handleRequestDeleteRecord(item)}
                                className="p-1 text-slate-400 hover:text-rose-400 rounded hover:bg-rose-950/40"
                                title="Excluir Registro"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
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
      {/* 2. VISÃO PLANO MANUTENÇÃO */}
      {/* ========================================================================= */}
      {activePlan === 'manutencao' && (
        <div className="space-y-6">
          
          {/* KPI Cards Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            
            {/* KPI 1: Tempo Total Parado */}
            <div className="bg-slate-900 border border-amber-500/40 rounded-2xl p-5 shadow-xl relative overflow-hidden">
              <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/10 rounded-full blur-2xl pointer-events-none" />
              <div className="text-[10px] font-bold uppercase tracking-wider text-amber-400 font-mono">
                Tempo Total Parado
              </div>
              <div className="mt-2 text-3xl font-black font-mono text-amber-300">
                {maintenanceKpis.durationFormatted}
              </div>
              <div className="mt-2 text-[10px] text-slate-400 font-mono">
                {maintenanceKpis.totalMinutes} minutos acumulados
              </div>
            </div>

            {/* KPI 2: Total de Ocorrências */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono">
                Total de Ocorrências
              </div>
              <div className="mt-2 text-3xl font-black font-mono text-white">
                {maintenanceKpis.totalOccurrences}
              </div>
              <div className="mt-2 text-[10px] text-slate-400 font-mono">
                Registros de parada no período
              </div>
            </div>

            {/* KPI 3: Por Tipo de Manutenção */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-2">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono">
                Distribuição por Tipo
              </div>
              <div className="space-y-1 text-xs font-mono">
                <div className="flex justify-between items-center text-rose-300">
                  <span>Não planejada:</span>
                  <span className="font-bold">{maintenanceKpis.typeCounts['Não planejada'].count}x ({formatHoursMinutes(maintenanceKpis.typeCounts['Não planejada'].minutes)})</span>
                </div>
                <div className="flex justify-between items-center text-emerald-300">
                  <span>Planejada:</span>
                  <span className="font-bold">{maintenanceKpis.typeCounts['Planejada'].count}x ({formatHoursMinutes(maintenanceKpis.typeCounts['Planejada'].minutes)})</span>
                </div>
                <div className="flex justify-between items-center text-amber-300">
                  <span>Falta de MP:</span>
                  <span className="font-bold">{maintenanceKpis.typeCounts['Falta de MP'].count}x ({formatHoursMinutes(maintenanceKpis.typeCounts['Falta de MP'].minutes)})</span>
                </div>
              </div>
            </div>

            {/* KPI 4: Por Linha de Produção */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-2">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono">
                Divisão por Linha
              </div>
              <div className="space-y-1 text-xs font-mono">
                <div className="flex justify-between items-center text-sky-300">
                  <span>Vísceras:</span>
                  <span className="font-bold">{formatHoursMinutes(maintenanceKpis.lineCounts['Vísceras'].minutes)} ({maintenanceKpis.lineCounts['Vísceras'].count}x)</span>
                </div>
                <div className="flex justify-between items-center text-teal-300">
                  <span>Penas:</span>
                  <span className="font-bold">{formatHoursMinutes(maintenanceKpis.lineCounts['Penas'].minutes)} ({maintenanceKpis.lineCounts['Penas'].count}x)</span>
                </div>
                <div className="flex justify-between items-center text-slate-300">
                  <span>Geral/Utilidades:</span>
                  <span className="font-bold">{formatHoursMinutes(maintenanceKpis.lineCounts['Geral/Utilidades'].minutes)} ({maintenanceKpis.lineCounts['Geral/Utilidades'].count}x)</span>
                </div>
              </div>
            </div>

          </div>

          {/* Ranking dos Equipamentos que Mais Pararam */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            {/* Ranking Bar List */}
            <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div>
                  <h3 className="font-bold text-white text-base flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-amber-400" />
                    Ranking de Indisponibilidade por Equipamento
                  </h3>
                  <p className="text-xs text-slate-400">
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
                      <div key={eq.name} className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <span className="w-5 h-5 rounded-md bg-slate-800 text-slate-400 font-mono text-[10px] flex items-center justify-center font-bold">
                              #{idx + 1}
                            </span>
                            <span className="font-bold text-white">{eq.name}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-900 text-slate-400 font-mono">
                              {eq.line}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 font-mono">
                            <span className="text-slate-400 text-[11px]">{eq.count} ocorrências</span>
                            <span className="font-bold text-amber-400">{formatHoursMinutes(eq.minutes)}</span>
                          </div>
                        </div>

                        {/* Progress Bar */}
                        <div className="w-full bg-slate-900 rounded-full h-2 overflow-hidden">
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
            <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
              <div className="pb-3 border-b border-slate-800 flex items-center justify-between">
                <h3 className="font-bold text-white text-base flex items-center gap-2">
                  <Clock className="w-5 h-5 text-amber-400" />
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
                    <div key={item.id} className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-white truncate max-w-[180px]">{item.equipment_name}</span>
                        <span className="text-amber-400 font-mono font-bold">
                          {formatHoursMinutes(item.duration_minutes)}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 line-clamp-1">{item.problem_description}</p>
                      <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono pt-1">
                        <span>{new Date(item.start_datetime).toLocaleDateString('pt-BR')} &bull; {item.responsible_person || 'Equipe FFG'}</span>
                        <span className={`px-1.5 py-0.5 rounded ${
                          item.maintenance_type === 'Não planejada' ? 'bg-rose-950 text-rose-300' : 'bg-slate-800 text-slate-300'
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-slate-900 border border-slate-700 w-full max-w-3xl max-h-[80vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-800 bg-slate-950 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-white">
                  Detalhamento de Sobrepeso &bull; {selectedRecordDetails.production_date} ({selectedRecordDetails.shift})
                </h3>
                <p className="text-xs text-slate-400">
                  Total descontado: {Number(selectedRecordDetails.sobrepeso_total_kg).toLocaleString('pt-BR')} kg
                </p>
              </div>
              <button
                onClick={() => setSelectedRecordDetails(null)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950 text-slate-400 uppercase font-mono sticky top-0 border-b border-slate-800">
                  <tr>
                    <th className="px-3 py-2">Código</th>
                    <th className="px-3 py-2">Produto</th>
                    <th className="px-3 py-2 text-right">Peso Líquido</th>
                    <th className="px-3 py-2 text-right">%</th>
                    <th className="px-3 py-2 text-right">Sobrepeso</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono text-slate-200">
                  {selectedRecordDetails.detalhes_sobrepeso?.map((item, idx) => (
                    <tr key={idx}>
                      <td className="px-3 py-2 text-sky-400">{item.codigo_encontrado || item.sku}</td>
                      <td className="px-3 py-2 font-sans text-white">{item.produto}</td>
                      <td className="px-3 py-2 text-right">{item.peso_produzido.toLocaleString('pt-BR')} kg</td>
                      <td className="px-3 py-2 text-right text-amber-300 font-semibold">
                        {((Number(item.percentual) <= 1 ? Number(item.percentual) * 100 : Number(item.percentual)).toFixed(2))}%
                      </td>
                      <td className="px-3 py-2 text-right font-bold text-amber-400">{item.sobrepeso_kg.toLocaleString('pt-BR')} kg</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="px-6 py-3 border-t border-slate-800 bg-slate-950 flex justify-end">
              <button
                onClick={() => setSelectedRecordDetails(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs"
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
