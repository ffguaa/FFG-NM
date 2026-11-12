import React, { useState, useMemo } from 'react';
import { 
  FfgDowntime, ProductionLine, MaintenanceType 
} from '../types';
import { supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import { 
  Clock, Wrench, AlertTriangle, CheckCircle, Trash2, Search, 
  Filter, Calendar, User, Save, RefreshCw, Cpu, Layers
} from 'lucide-react';

interface MaintenanceFormProps {
  downtimes: FfgDowntime[];
  onReload: () => void;
}

export const MaintenanceForm: React.FC<MaintenanceFormProps> = ({
  downtimes,
  onReload,
}) => {
  const { showToast, showSupabaseError } = useToast();

  // Helper: Format date for datetime-local
  const getDefaultDates = () => {
    const now = new Date();
    const endStr = now.toISOString().slice(0, 16);
    // default 30 min before
    const startObj = new Date(now.getTime() - 30 * 60 * 1000);
    const startStr = startObj.toISOString().slice(0, 16);
    return { startStr, endStr };
  };

  const { startStr: initialStart, endStr: initialEnd } = getDefaultDates();

  // Form states
  const [startDatetime, setStartDatetime] = useState<string>(initialStart);
  const [endDatetime, setEndDatetime] = useState<string>(initialEnd);
  const [equipmentName, setEquipmentName] = useState<string>('');
  const [productionLine, setProductionLine] = useState<ProductionLine>('Vísceras');
  const [maintenanceType, setMaintenanceType] = useState<MaintenanceType>('Não planejada');
  const [problemDescription, setProblemDescription] = useState<string>('');
  const [responsiblePerson, setResponsiblePerson] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | number | null>(null);
  const deleteTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  // Filters for History table
  const [filterLine, setFilterLine] = useState<string>('Todas');
  const [filterType, setFilterType] = useState<string>('Todos');
  const [filterEquipment, setFilterEquipment] = useState<string>('Todos');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Extract unique equipment and responsible persons from history
  const uniqueEquipments = useMemo(() => {
    const set = new Set<string>();
    // Default poultry industrial equipment seeds for helpful autocompletion
    const defaults = [
      'Cozinhador de Penas 01',
      'Cozinhador de Penas 02',
      'Digestor de Vísceras 01',
      'Digestor de Vísceras 02',
      'Prensa Contínua de Farinha',
      'Moinho de Martelos',
      'Secador Rotativo',
      'Centrífuga Decanter de Gordura',
      'Trilho Elevador de Penas',
      'Rosca Transportadora de Vísceras',
      'Caldeira Principal (Vapor)',
      'Condensador Barométrico',
    ];
    defaults.forEach((e) => set.add(e));
    downtimes.forEach((d) => {
      if (d.equipment_name?.trim()) set.add(d.equipment_name.trim());
    });
    return Array.from(set).sort();
  }, [downtimes]);

  const uniqueResponsibles = useMemo(() => {
    const set = new Set<string>();
    const defaults = [
      'Equipe Manutenção Mecânica',
      'Equipe Manutenção Elétrica',
      'Operador Líder FFG',
      'Supervisor de Produção',
      'Técnico de Utilidades',
    ];
    defaults.forEach((r) => set.add(r));
    downtimes.forEach((d) => {
      if (d.responsible_person?.trim()) set.add(d.responsible_person.trim());
    });
    return Array.from(set).sort();
  }, [downtimes]);

  // Calculate duration in minutes and format as XXh YYmin
  const durationCalc = useMemo(() => {
    if (!startDatetime || !endDatetime) {
      return { minutes: 0, text: '00h 00min', isValid: false };
    }
    const start = new Date(startDatetime).getTime();
    const end = new Date(endDatetime).getTime();

    if (isNaN(start) || isNaN(end)) {
      return { minutes: 0, text: '00h 00min', isValid: false };
    }

    const diffMinutes = Math.round((end - start) / (1000 * 60));
    if (diffMinutes < 0) {
      return { minutes: diffMinutes, text: 'Data de Fim anterior ao Início', isValid: false };
    }

    const hours = Math.floor(diffMinutes / 60);
    const mins = diffMinutes % 60;
    const text = `${String(hours).padStart(2, '0')}h ${String(mins).padStart(2, '0')}min`;
    return { minutes: diffMinutes, text, isValid: true };
  }, [startDatetime, endDatetime]);

  // Submit new downtime
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!durationCalc.isValid || durationCalc.minutes <= 0) {
      showToast('warning', 'Horário Inválido', 'O retorno/fim da parada deve ser posterior ao início da parada.');
      return;
    }

    if (!equipmentName.trim()) {
      showToast('warning', 'Campo Obrigatório', 'Informe o nome do equipamento que parou.');
      return;
    }

    if (!problemDescription.trim()) {
      showToast('warning', 'Campo Obrigatório', 'Descreva o problema ou a causa da parada.');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        start_datetime: new Date(startDatetime).toISOString(),
        end_datetime: new Date(endDatetime).toISOString(),
        duration_minutes: durationCalc.minutes,
        equipment_name: equipmentName.trim(),
        production_line: productionLine,
        maintenance_type: maintenanceType,
        problem_description: problemDescription.trim(),
        responsible_person: responsiblePerson.trim() || 'Equipe FFG',
      };

      const { error } = await supabase
        .from('ffg_downtimes')
        .insert([payload]);

      if (error) throw error;

      showToast(
        'success',
        'Parada Registrada com Sucesso',
        `Parada de ${durationCalc.text} no equipamento "${payload.equipment_name}" gravada no Supabase.`
      );

      // Reset problem and equipment, keep dates updated
      setEquipmentName('');
      setProblemDescription('');
      const dates = getDefaultDates();
      setStartDatetime(dates.startStr);
      setEndDatetime(dates.endStr);

      onReload();
    } catch (err: any) {
      showSupabaseError('Falha ao Gravar Parada no Supabase', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRequestDelete = (item: FfgDowntime) => {
    if (deleteTimeoutRef.current) clearTimeout(deleteTimeoutRef.current);
    setConfirmDeleteId(item.id || null);
    deleteTimeoutRef.current = setTimeout(() => {
      setConfirmDeleteId(null);
    }, 3000);
  };

  // Delete downtime directly without window.confirm
  const handleDelete = async (item: FfgDowntime) => {
    if (deleteTimeoutRef.current) clearTimeout(deleteTimeoutRef.current);
    setConfirmDeleteId(null);

    setDeletingId(item.id || null);
    try {
      const { error } = await supabase
        .from('ffg_downtimes')
        .delete()
        .eq('id', item.id);

      if (error) throw error;

      showToast('success', 'Registro Excluído', 'Apontamento de parada removido do Supabase.');
      onReload();
    } catch (err: any) {
      showSupabaseError('Falha ao Excluir Parada do Supabase', err);
    } finally {
      setDeletingId(null);
    }
  };

  // Filtered Downtimes
  const filteredDowntimes = useMemo(() => {
    return downtimes.filter((d) => {
      if (filterLine !== 'Todas' && d.production_line !== filterLine) return false;
      if (filterType !== 'Todos' && d.maintenance_type !== filterType) return false;
      if (filterEquipment !== 'Todos' && d.equipment_name !== filterEquipment) return false;
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchEquip = d.equipment_name?.toLowerCase().includes(query);
        const matchDesc = d.problem_description?.toLowerCase().includes(query);
        const matchResp = d.responsible_person?.toLowerCase().includes(query);
        if (!matchEquip && !matchDesc && !matchResp) return false;
      }
      return true;
    });
  }, [downtimes, filterLine, filterType, filterEquipment, searchQuery]);

  const formatDisplayDuration = (mins: number) => {
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}min`;
  };

  return (
    <div className="space-y-6">
      
      {/* Top Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-amber-400 font-mono">
                Apontamento de Engenharia & Manutenção
              </span>
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              <span className="text-xs text-slate-400 font-mono">Gestão de Paradas e Ocorrências</span>
            </div>
            <h2 className="text-xl font-black text-white mt-0.5 tracking-tight">
              Lançamento Rápido de Paradas & Manutenção FFG
            </h2>
          </div>

          <div className="flex items-center gap-3">
            <span className="px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-300">
              Total Registrado: <strong className="text-amber-400">{downtimes.length}</strong> paradas
            </span>
          </div>
        </div>
      </div>

      {/* Fast Recording Form (Strict Requirements 1 to 7) */}
      <form onSubmit={handleSubmit} className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
        
        <div className="pb-3 border-b border-slate-800 flex items-center justify-between">
          <h3 className="font-bold text-white text-base flex items-center gap-2">
            <Wrench className="w-5 h-5 text-amber-400" />
            Novo Apontamento de Parada Industrial
          </h3>
          <span className="text-xs text-slate-400 font-mono">Tabela Supabase: ffg_downtimes</span>
        </div>

        {/* Row 1: Datetimes & Highlighted Duration Card */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
          
          {/* 1. Início da Parada */}
          <div className="md:col-span-4">
            <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-amber-400" />
              1. Início da Parada (Data & Hora) *
            </label>
            <input
              type="datetime-local"
              value={startDatetime}
              onChange={(e) => setStartDatetime(e.target.value)}
              required
              className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-sm text-white font-mono focus:border-amber-400 focus:outline-none"
            />
          </div>

          {/* 1. Retorno / Fim da Parada */}
          <div className="md:col-span-4">
            <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-emerald-400" />
              1. Retorno / Fim da Parada (Data & Hora) *
            </label>
            <input
              type="datetime-local"
              value={endDatetime}
              onChange={(e) => setEndDatetime(e.target.value)}
              required
              className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-sm text-white font-mono focus:border-emerald-400 focus:outline-none"
            />
          </div>

          {/* 2. Quadro Indicativo de Tempo Parado (Auto) */}
          <div className="md:col-span-4">
            <label className="block text-xs font-semibold text-slate-400 mb-1.5 font-mono">
              2. Tempo Total Parado (Cálculo Automático)
            </label>
            <div className={`px-4 py-2.5 rounded-xl border flex items-center justify-between ${
              durationCalc.isValid
                ? 'bg-amber-950/60 border-amber-600/70 text-amber-300 shadow-lg shadow-amber-950/30'
                : 'bg-rose-950/60 border-rose-600/70 text-rose-300'
            }`}>
              <div className="flex items-center gap-2">
                <Clock className="w-5 h-5 animate-pulse" />
                <span className="text-xs font-semibold">Duração:</span>
              </div>
              <span className="text-xl font-black font-mono tracking-wider">
                {durationCalc.text}
              </span>
            </div>
          </div>

        </div>

        {/* Row 2: Equipamento (Input + Dropdown de Histórico) */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
          
          {/* 3. Equipamento */}
          <div className="md:col-span-6">
            <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5 text-sky-400" />
                3. Equipamento (Digite ou selecione do histórico) *
              </span>
              <span className="text-[10px] text-slate-500 font-mono">Autossugestão ativa</span>
            </label>
            <div className="relative">
              <input
                type="text"
                list="equipments-list"
                placeholder="Ex: Cozinhador de Penas 01, Digestor 02..."
                value={equipmentName}
                onChange={(e) => setEquipmentName(e.target.value)}
                required
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 focus:border-amber-400 focus:outline-none font-mono"
              />
              <datalist id="equipments-list">
                {uniqueEquipments.map((eq, i) => (
                  <option key={i} value={eq} />
                ))}
              </datalist>
            </div>
          </div>

          {/* 7. Responsável pela Solução (Input + Dropdown de Histórico) */}
          <div className="md:col-span-6">
            <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-emerald-400" />
                7. Responsável pela Solução / Manutenção *
              </span>
              <span className="text-[10px] text-slate-500 font-mono">Técnico ou Equipe</span>
            </label>
            <div className="relative">
              <input
                type="text"
                list="responsibles-list"
                placeholder="Ex: Mecânica, Elétrica, João Silva..."
                value={responsiblePerson}
                onChange={(e) => setResponsiblePerson(e.target.value)}
                required
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 focus:border-emerald-400 focus:outline-none font-mono"
              />
              <datalist id="responsibles-list">
                {uniqueResponsibles.map((resp, i) => (
                  <option key={i} value={resp} />
                ))}
              </datalist>
            </div>
          </div>

        </div>

        {/* Row 3: Linha de Produção & Tipo de Manutenção (Quick Select Buttons) */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
          
          {/* 4. Linha de Produção */}
          <div className="md:col-span-6 space-y-2">
            <label className="block text-xs font-semibold text-slate-300">
              4. Linha de Produção *
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['Vísceras', 'Penas', 'Geral/Utilidades'] as ProductionLine[]).map((line) => (
                <button
                  key={line}
                  type="button"
                  onClick={() => setProductionLine(line)}
                  className={`py-2.5 px-3 rounded-xl text-xs font-bold transition-all text-center ${
                    productionLine === line
                      ? 'bg-sky-600 text-white shadow-md shadow-sky-600/30 border border-sky-400'
                      : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
                  }`}
                >
                  {line}
                </button>
              ))}
            </div>
          </div>

          {/* 5. Tipo de Manutenção */}
          <div className="md:col-span-6 space-y-2">
            <label className="block text-xs font-semibold text-slate-300">
              5. Tipo de Manutenção / Motivo *
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['Planejada', 'Não planejada', 'Falta de MP'] as MaintenanceType[]).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setMaintenanceType(type)}
                  className={`py-2.5 px-3 rounded-xl text-xs font-bold transition-all text-center ${
                    maintenanceType === type
                      ? type === 'Não planejada'
                        ? 'bg-rose-600 text-white shadow-md shadow-rose-600/30 border border-rose-400'
                        : type === 'Planejada'
                        ? 'bg-emerald-600 text-slate-950 shadow-md shadow-emerald-600/30 border border-emerald-400'
                        : 'bg-amber-600 text-slate-950 shadow-md shadow-amber-600/30 border border-amber-400'
                      : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

        </div>

        {/* Row 4: 6. Descrição do Problema / Causa */}
        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
            <span>6. Descrição Detalhada do Problema / Causa Raiz / Ação Executada *</span>
          </label>
          <textarea
            rows={2}
            placeholder="Descreva o que ocorreu (ex: rompimento da correia de acionamento do motor principal, substituição efetuada pela equipe mecânica e teste a vazio)..."
            value={problemDescription}
            onChange={(e) => setProblemDescription(e.target.value)}
            required
            className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 focus:border-amber-400 focus:outline-none"
          />
        </div>

        {/* Submit Button */}
        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={isSubmitting}
            className="px-6 py-3 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black rounded-xl text-sm shadow-xl shadow-amber-500/20 flex items-center gap-2 transition-all disabled:opacity-50"
          >
            {isSubmitting ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Gravando no Supabase...</span>
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                <span>Salvar Apontamento de Parada</span>
              </>
            )}
          </button>
        </div>

      </form>

      {/* Chronological Downtimes History Table with Filters */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
        
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-400" />
              Histórico Cronológico de Paradas Gravadas
            </h3>
            <p className="text-xs text-slate-400">
              {filteredDowntimes.length} de {downtimes.length} registros exibidos
            </p>
          </div>

          {/* Filters Bar */}
          <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
            {/* Search */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-500" />
              <input
                type="text"
                placeholder="Buscar equipamento/problema..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-400"
              />
            </div>

            {/* Filter by Line */}
            <select
              value={filterLine}
              onChange={(e) => setFilterLine(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-300 focus:outline-none focus:border-amber-400"
            >
              <option value="Todas">Todas as Linhas</option>
              <option value="Vísceras">Vísceras</option>
              <option value="Penas">Penas</option>
              <option value="Geral/Utilidades">Geral/Utilidades</option>
            </select>

            {/* Filter by Type */}
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-300 focus:outline-none focus:border-amber-400"
            >
              <option value="Todos">Todos os Tipos</option>
              <option value="Não planejada">Não planejada</option>
              <option value="Planejada">Planejada</option>
              <option value="Falta de MP">Falta de MP</option>
            </select>

            <button
              onClick={onReload}
              className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs transition-colors"
              title="Recarregar do Supabase"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950 text-slate-400 uppercase tracking-wider border-b border-slate-800 font-mono">
              <tr>
                <th className="px-3 py-2.5">Início / Fim</th>
                <th className="px-3 py-2.5">Duração</th>
                <th className="px-3 py-2.5">Equipamento</th>
                <th className="px-3 py-2.5">Linha</th>
                <th className="px-3 py-2.5">Tipo</th>
                <th className="px-3 py-2.5">Causa / Problema</th>
                <th className="px-3 py-2.5">Responsável</th>
                <th className="px-3 py-2.5 text-center">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono text-slate-200">
              {filteredDowntimes.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-500 font-sans">
                    Nenhuma parada registrada encontrada para os filtros selecionados.
                  </td>
                </tr>
              ) : (
                filteredDowntimes.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="px-3 py-2.5 text-slate-300 whitespace-nowrap">
                      <div>{new Date(item.start_datetime).toLocaleDateString('pt-BR')}</div>
                      <div className="text-[10px] text-slate-500">
                        {new Date(item.start_datetime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} →{' '}
                        {new Date(item.end_datetime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap font-bold text-amber-400">
                      {formatDisplayDuration(item.duration_minutes)}
                    </td>
                    <td className="px-3 py-2.5 font-bold text-white whitespace-nowrap">
                      {item.equipment_name}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                        item.production_line === 'Vísceras'
                          ? 'bg-sky-950 text-sky-400 border border-sky-800'
                          : item.production_line === 'Penas'
                          ? 'bg-teal-950 text-teal-400 border border-teal-800'
                          : 'bg-slate-800 text-slate-300 border border-slate-700'
                      }`}>
                        {item.production_line}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                        item.maintenance_type === 'Não planejada'
                          ? 'bg-rose-950 text-rose-400 border border-rose-800'
                          : item.maintenance_type === 'Planejada'
                          ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                          : 'bg-amber-950 text-amber-400 border border-amber-800'
                      }`}>
                        {item.maintenance_type}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 font-sans text-slate-300 max-w-xs truncate" title={item.problem_description}>
                      {item.problem_description}
                    </td>
                    <td className="px-3 py-2.5 font-sans text-slate-400 whitespace-nowrap">
                      {item.responsible_person || '—'}
                    </td>
                    <td className="px-3 py-2.5 text-center whitespace-nowrap">
                      {deletingId === item.id ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin text-rose-400 mx-auto" />
                      ) : confirmDeleteId === item.id ? (
                        <button
                          onClick={() => handleDelete(item)}
                          className="px-2 py-0.5 rounded bg-rose-600 hover:bg-rose-500 text-white font-bold text-[11px] font-mono animate-pulse shadow-md shadow-rose-950/40 transition-all"
                          title="Clique novamente para confirmar a exclusão no Supabase"
                        >
                          Confirmar?
                        </button>
                      ) : (
                        <button
                          onClick={() => handleRequestDelete(item)}
                          className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 rounded transition-colors"
                          title="Excluir Parada"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

      </div>

    </div>
  );
};
