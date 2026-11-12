import React, { useState } from 'react';
import { FfgSku } from '../types';
import { supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import { 
  X, Plus, Search, Trash2, Edit2, Save, Sparkles, RefreshCw, 
  HelpCircle, AlertCircle, Percent
} from 'lucide-react';

interface SkuManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  skus: FfgSku[];
  onReload: () => void;
}

export const SkuManagementModal: React.FC<SkuManagementModalProps> = ({
  isOpen,
  onClose,
  skus,
  onReload,
}) => {
  const { showToast, showSupabaseError } = useToast();
  const [searchTerm, setSearchTerm] = useState('');
  const [editingId, setEditingId] = useState<string | number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | number | null>(null);
  const [confirmSeed, setConfirmSeed] = useState(false);
  const deleteTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const seedTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  // Form state for creating/editing
  const [formData, setFormData] = useState<Partial<FfgSku>>({
    sku_uniao: '',
    sku_mbrf: '',
    produto: '',
    familia: 'Cortes',
    percentual_sobrepeso: 3.5,
  });

  if (!isOpen) return null;

  const formatSobrepesoDisplay = (val: number | null | undefined): string => {
    const num = Number(val) || 0;
    // Multiplica o valor decimal do banco por 100 na formatação de texto (ex: 0.04 -> 4.00%)
    const pct = num <= 1 ? num * 100 : num;
    return `${pct.toFixed(2)}%`;
  };

  const filteredSkus = skus.filter((item) => {
    const term = searchTerm.toLowerCase();
    return (
      (item.produto && item.produto.toLowerCase().includes(term)) ||
      (item.sku_uniao && item.sku_uniao.toLowerCase().includes(term)) ||
      (item.sku_mbrf && item.sku_mbrf.toLowerCase().includes(term)) ||
      (item.familia && item.familia.toLowerCase().includes(term))
    );
  });

  const handleStartEdit = (sku: FfgSku) => {
    setEditingId(sku.id || null);
    const rawVal = Number(sku.percentual_sobrepeso) || 0;
    // If stored as decimal 0.04 in DB, show 4.0 in input for user friendliness
    const displayInputVal = rawVal <= 1 ? Math.round(rawVal * 10000) / 100 : rawVal;
    setFormData({
      sku_uniao: sku.sku_uniao,
      sku_mbrf: sku.sku_mbrf,
      produto: sku.produto,
      familia: sku.familia,
      percentual_sobrepeso: displayInputVal,
    });
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setFormData({
      sku_uniao: '',
      sku_mbrf: '',
      produto: '',
      familia: 'Cortes',
      percentual_sobrepeso: 3.5,
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.produto?.trim()) {
      showToast('warning', 'Campo Obrigatório', 'Informe a descrição do produto.');
      return;
    }
    if (!formData.sku_uniao?.trim() && !formData.sku_mbrf?.trim()) {
      showToast('warning', 'Código Obrigatório', 'Informe ao menos o SKU União ou SKU MBRF.');
      return;
    }

    setIsSubmitting(true);
    try {
      const inputPct = Number(formData.percentual_sobrepeso) || 0;
      // Stored as decimal in DB (e.g. 4.0% -> 0.04)
      const normalizedPct = inputPct > 1 ? inputPct / 100 : inputPct;

      const payload = {
        sku_uniao: formData.sku_uniao?.trim() || '',
        sku_mbrf: formData.sku_mbrf?.trim() || '',
        produto: formData.produto?.trim() || '',
        familia: formData.familia?.trim() || 'Geral',
        percentual_sobrepeso: normalizedPct,
      };

      if (editingId) {
        const { error } = await supabase
          .from('ffg_skus')
          .update(payload)
          .eq('id', editingId);

        if (error) throw error;
        showToast('success', 'SKU Atualizado', `SKU ${payload.produto} atualizado com sucesso!`);
      } else {
        const { error } = await supabase
          .from('ffg_skus')
          .insert([payload]);

        if (error) throw error;
        showToast('success', 'SKU Cadastrado', `SKU ${payload.produto} adicionado ao Supabase!`);
      }

      handleCancelEdit();
      onReload();
    } catch (err: any) {
      showSupabaseError('Falha ao Salvar SKU no Supabase', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRequestDelete = (sku: FfgSku) => {
    if (deleteTimeoutRef.current) clearTimeout(deleteTimeoutRef.current);
    setConfirmDeleteId(sku.id || null);
    deleteTimeoutRef.current = setTimeout(() => {
      setConfirmDeleteId(null);
    }, 3000);
  };

  const handleDelete = async (sku: FfgSku) => {
    if (deleteTimeoutRef.current) clearTimeout(deleteTimeoutRef.current);
    setConfirmDeleteId(null);

    try {
      const { error } = await supabase
        .from('ffg_skus')
        .delete()
        .eq('id', sku.id);

      if (error) throw error;
      showToast('success', 'SKU Excluído', `Registro removido do banco de dados.`);
      onReload();
    } catch (err: any) {
      showSupabaseError('Falha ao Excluir SKU', err);
    }
  };

  const handleRequestSeed = () => {
    if (seedTimeoutRef.current) clearTimeout(seedTimeoutRef.current);
    setConfirmSeed(true);
    seedTimeoutRef.current = setTimeout(() => {
      setConfirmSeed(false);
    }, 3000);
  };

  const handleSeedDefaults = async () => {
    if (seedTimeoutRef.current) clearTimeout(seedTimeoutRef.current);
    setConfirmSeed(false);

    setIsSeeding(true);
    const defaultSkus = [
      { sku_uniao: '1001', sku_mbrf: 'M1001', produto: 'FILÉ DE PEITO CONGELADO', familia: 'Cortes Nobres', percentual_sobrepeso: 0.038 },
      { sku_uniao: '1002', sku_mbrf: 'M1002', produto: 'FILEZINHO SASSAMI BANDEJA', familia: 'Cortes Nobres', percentual_sobrepeso: 0.042 },
      { sku_uniao: '1003', sku_mbrf: 'M1003', produto: 'COXA E SOBRECOXA DESOSSADA', familia: 'Coxas/Sobrecoxas', percentual_sobrepeso: 0.035 },
      { sku_uniao: '1004', sku_mbrf: 'M1004', produto: 'COXA E SOBRECOXA C/ OSSO IQF', familia: 'Coxas/Sobrecoxas', percentual_sobrepeso: 0.030 },
      { sku_uniao: '1005', sku_mbrf: 'M1005', produto: 'MEIO DA ASA (TULIPA) INTERFOLHADO', familia: 'Asas', percentual_sobrepeso: 0.028 },
      { sku_uniao: '1006', sku_mbrf: 'M1006', produto: 'COXINHA DA ASA (DRUMET)', familia: 'Asas', percentual_sobrepeso: 0.025 },
      { sku_uniao: '1007', sku_mbrf: 'M1007', produto: 'ASA INTEIRA RESFRIADA', familia: 'Asas', percentual_sobrepeso: 0.020 },
      { sku_uniao: '1008', sku_mbrf: 'M1008', produto: 'FRANGO INTEIRO EVISCERADO', familia: 'Frango Inteiro', percentual_sobrepeso: 0.015 },
      { sku_uniao: '1009', sku_mbrf: 'M1009', produto: 'CORAÇÃO DE FRANGO RESFRIADO', familia: 'Miúdos', percentual_sobrepeso: 0.045 },
      { sku_uniao: '1010', sku_mbrf: 'M1010', produto: 'MOELA DE FRANGO CONGELADA', familia: 'Miúdos', percentual_sobrepeso: 0.040 },
      { sku_uniao: '1011', sku_mbrf: 'M1011', produto: 'FÍGADO DE FRANGO BANDEJA', familia: 'Miúdos', percentual_sobrepeso: 0.035 },
      { sku_uniao: '1012', sku_mbrf: 'M1012', produto: 'PÉ DE FRANGO CLASSIFICADO (EXPORTAÇÃO)', familia: 'Pés', percentual_sobrepeso: 0.022 },
    ];

    try {
      const { error } = await supabase.from('ffg_skus').insert(defaultSkus);
      if (error) throw error;
      showToast('success', 'SKUs Padrão Cadastrados', `${defaultSkus.length} produtos adicionados com sucesso ao Supabase!`);
      onReload();
    } catch (err: any) {
      showSupabaseError('Falha ao Semear SKUs Padrão', err);
    } finally {
      setIsSeeding(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
      <div className="bg-slate-900 border border-slate-700 w-full max-w-4xl max-h-[90vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 bg-slate-950 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Percent className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                Gerenciamento de SKUs e % Sobrepeso
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono">
                  {skus.length} cadastrados
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                Tabela <code className="text-emerald-400 font-mono">ffg_skus</code> — utilizada no cálculo automático de sobrepeso da FFG
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          
          {/* Form to Add / Edit */}
          <div className="p-4 bg-slate-950/70 border border-slate-800 rounded-xl">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-emerald-400 flex items-center gap-2">
                {editingId ? <Edit2 className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                {editingId ? 'Editar SKU Selecionado' : 'Cadastrar Novo SKU'}
              </h4>
              {editingId && (
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  className="text-xs text-slate-400 hover:text-white underline"
                >
                  Cancelar Edição
                </button>
              )}
            </div>

            <form onSubmit={handleSave} className="grid grid-cols-1 md:grid-cols-12 gap-3">
              <div className="md:col-span-2">
                <label className="block text-xs text-slate-400 mb-1 font-medium">SKU União</label>
                <input
                  type="text"
                  placeholder="Ex: 1042"
                  value={formData.sku_uniao || ''}
                  onChange={(e) => setFormData({ ...formData, sku_uniao: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 font-mono"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs text-slate-400 mb-1 font-medium">SKU MBRF</label>
                <input
                  type="text"
                  placeholder="Ex: M1042"
                  value={formData.sku_mbrf || ''}
                  onChange={(e) => setFormData({ ...formData, sku_mbrf: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 font-mono"
                />
              </div>

              <div className="md:col-span-3">
                <label className="block text-xs text-slate-400 mb-1 font-medium">Descrição do Produto *</label>
                <input
                  type="text"
                  placeholder="Ex: FILÉ DE PEITO IQF"
                  value={formData.produto || ''}
                  onChange={(e) => setFormData({ ...formData, produto: e.target.value })}
                  required
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs text-slate-400 mb-1 font-medium">Família</label>
                <input
                  type="text"
                  placeholder="Ex: Cortes"
                  value={formData.familia || ''}
                  onChange={(e) => setFormData({ ...formData, familia: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs text-slate-400 mb-1 font-medium flex items-center justify-between">
                  <span>% Sobrepeso</span>
                  <span className="text-[10px] text-emerald-400">Ex: 3.5%</span>
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    placeholder="3.5"
                    value={formData.percentual_sobrepeso ?? ''}
                    onChange={(e) => setFormData({ ...formData, percentual_sobrepeso: parseFloat(e.target.value) || 0 })}
                    required
                    className="w-full pl-3 pr-7 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 font-mono"
                  />
                  <span className="absolute right-2.5 top-2.5 text-xs text-slate-400 font-mono">%</span>
                </div>
              </div>

              <div className="md:col-span-1 flex items-end">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold rounded-lg text-sm flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                  title={editingId ? 'Salvar Alterações' : 'Adicionar SKU'}
                >
                  {isSubmitting ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : editingId ? (
                    <Save className="w-4 h-4" />
                  ) : (
                    <Plus className="w-4 h-4" />
                  )}
                </button>
              </div>
            </form>
          </div>

          {/* Search bar & quick actions */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="relative w-full sm:w-72">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-500" />
              <input
                type="text"
                placeholder="Buscar por SKU, nome ou família..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
              {skus.length === 0 && (
                <button
                  type="button"
                  onClick={confirmSeed ? handleSeedDefaults : handleRequestSeed}
                  disabled={isSeeding}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                    confirmSeed
                      ? 'bg-rose-600 hover:bg-rose-500 text-white animate-pulse shadow-md shadow-rose-950/40'
                      : 'bg-emerald-950 hover:bg-emerald-900 border border-emerald-700/50 text-emerald-300'
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  {isSeeding ? 'Cadastrando...' : confirmSeed ? 'Confirmar Semeadura?' : 'Semear Cortes Padrão'}
                </button>
              )}
              <button
                type="button"
                onClick={onReload}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs flex items-center gap-1.5 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Atualizar
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950">
            <div className="max-h-72 overflow-y-auto">
              <table className="w-full text-center text-xs">
                <thead className="bg-slate-900/90 text-slate-400 uppercase tracking-wider sticky top-0 border-b border-slate-800 font-mono">
                  <tr>
                    <th className="px-4 py-2.5 text-center">SKU União</th>
                    <th className="px-4 py-2.5 text-center">SKU MBRF</th>
                    <th className="px-4 py-2.5 text-center">Produto</th>
                    <th className="px-4 py-2.5 text-center">Família</th>
                    <th className="px-4 py-2.5 text-center">% Sobrepeso</th>
                    <th className="px-4 py-2.5 text-center">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono text-slate-200">
                  {filteredSkus.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                        {searchTerm ? 'Nenhum SKU encontrado para a busca informada.' : 'Nenhum SKU cadastrado no banco. Use o formulário acima ou o botão "Semear Cortes Padrão".'}
                      </td>
                    </tr>
                  ) : (
                    filteredSkus.map((sku) => (
                      <tr key={sku.id || `${sku.sku_uniao}-${sku.sku_mbrf}`} className="hover:bg-slate-900/40 transition-colors">
                        <td className="px-4 py-2 text-center text-emerald-400 font-semibold">{sku.sku_uniao || '—'}</td>
                        <td className="px-4 py-2 text-center text-sky-400">{sku.sku_mbrf || '—'}</td>
                        <td className="px-4 py-2 text-center font-sans font-medium text-white">{sku.produto}</td>
                        <td className="px-4 py-2 text-center text-slate-400">{sku.familia || '—'}</td>
                        <td className="px-4 py-2 text-center font-bold text-amber-300">
                          {formatSobrepesoDisplay(sku.percentual_sobrepeso)}
                        </td>
                        <td className="px-4 py-2 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => handleStartEdit(sku)}
                              className="p-1 text-slate-400 hover:text-emerald-400 rounded transition-colors"
                              title="Editar"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            {confirmDeleteId === sku.id ? (
                              <button
                                onClick={() => handleDelete(sku)}
                                className="px-2 py-0.5 rounded bg-rose-600 hover:bg-rose-500 text-white font-bold text-[11px] font-mono animate-pulse shadow-md shadow-rose-950/40 transition-all"
                                title="Clique novamente para confirmar a exclusão no Supabase"
                              >
                                Confirmar?
                              </button>
                            ) : (
                              <button
                                onClick={() => handleRequestDelete(sku)}
                                className="p-1 text-slate-400 hover:text-rose-400 rounded transition-colors"
                                title="Excluir"
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

          <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-3 text-xs text-slate-400 flex items-start gap-2">
            <HelpCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-slate-200">Como funciona o Sobrepeso na FFG:</span> O sistema compara os códigos de cada linha da planilha de produção com <code className="text-emerald-400 font-mono">sku_mbrf</code> e <code className="text-emerald-400 font-mono">sku_uniao</code>. O peso líquido produzido é multiplicado pelo percentual cadastrado aqui e subtraído da massa viva no cálculo da Matéria-Prima FFG.
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-800 bg-slate-950 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-sm font-medium transition-colors"
          >
            Fechar Janela
          </button>
        </div>

      </div>
    </div>
  );
};
