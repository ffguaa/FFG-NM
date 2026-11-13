import React from 'react';
import { X, FileSpreadsheet, Calculator, CheckCircle2 } from 'lucide-react';

interface SpreadsheetHelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SpreadsheetHelpModal: React.FC<SpreadsheetHelpModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in">
      <div className="bg-white border border-slate-200 w-full max-w-3xl max-h-[90vh] rounded-2xl shadow-xl flex flex-col overflow-hidden">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Guia de Importação de Planilhas & Cálculos da FFG-NM
              </h3>
              <p className="text-xs text-slate-500">
                Padrões de leitura automatizada do Excel (.xlsx) para a União Avícola
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-200/60 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-6 text-xs text-slate-700">
          
          {/* Planilha 1 */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-sm text-emerald-700 flex items-center gap-2">
                <span className="w-6 h-6 rounded-lg bg-emerald-100 text-emerald-700 font-mono flex items-center justify-center text-xs">1</span>
                Planilha de Abate / TPA (.xlsx)
              </h4>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-white border border-slate-200 text-slate-600">
                Leitura por Coordenadas
              </span>
            </div>

            <p className="text-slate-600">
              O sistema lê automaticamente as linhas e colunas exatas da planilha de abate:
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 font-mono">
              <div className="p-3 bg-white border border-slate-200 rounded-lg">
                <div className="text-emerald-700 font-bold mb-1">Linha 164: PESO VIVO RECEBIDO</div>
                <ul className="space-y-1 text-slate-600 text-[11px]">
                  <li>• Turno 1T: <span className="text-slate-900 font-bold">Coluna C</span></li>
                  <li>• Turno 2T: <span className="text-slate-900 font-bold">Coluna D</span></li>
                  <li>• Turno Indústria: <span className="text-slate-900 font-bold">Coluna E</span></li>
                </ul>
                <div className="mt-2 text-[10px] text-slate-500">
                  Preenche o campo <code className="text-emerald-700 font-semibold">massa_viva_kg</code>
                </div>
              </div>

              <div className="p-3 bg-white border border-slate-200 rounded-lg">
                <div className="text-amber-700 font-bold mb-1">Linhas 160 e 159: TPA & PENDÊNCIAS</div>
                <ul className="space-y-1 text-slate-600 text-[11px]">
                  <li>• Linha 160 (TOTAL GERAL TPA): Col C (1T), Col D (2T), Col E (Indústria)</li>
                  <li>• Linha 159 (PENDÊNCIAS): <span className="text-slate-900 font-bold">Coluna G</span></li>
                </ul>
                <div className="mt-2 text-[10px] text-slate-500">
                  Preenche <code className="text-amber-700 font-semibold">tpa_total_kg</code> e <code className="text-slate-600">tpa_pendentes_kg</code>
                </div>
              </div>
            </div>

            <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-[11px] text-emerald-800 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>
                <strong>Recálculo dinâmico de turno:</strong> se você mudar o turno após subir a planilha, o sistema troca a coluna instantaneamente sem precisar recarregar o arquivo!
              </span>
            </div>
          </div>

          {/* Planilha 2 */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-sm text-sky-700 flex items-center gap-2">
                <span className="w-6 h-6 rounded-lg bg-sky-100 text-sky-700 font-mono flex items-center justify-center text-xs">2</span>
                Planilha de Produção — Cálculo de Sobrepeso (.xlsx)
              </h4>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-white border border-slate-200 text-slate-600">
                Cruzamento de SKUs
              </span>
            </div>

            <p className="text-slate-600">
              O motor de leitura varre as linhas procurando os códigos de produto da indústria e cruza com a tabela <code className="text-slate-900 font-mono font-semibold">ffg_skus</code>:
            </p>

            <ul className="space-y-2 list-disc list-inside text-slate-700">
              <li>
                <strong>Códigos aceitos:</strong> Cruzamento simultâneo com <code className="text-sky-700 font-mono font-semibold">sku_mbrf</code> e <code className="text-emerald-700 font-mono font-semibold">sku_uniao</code>.
              </li>
              <li>
                <strong>Peso líquido:</strong> Pega a coluna do turno correspondente (Col C para 1T, Col D para 2T, Col E ou Peso Líquido para Indústria).
              </li>
              <li>
                <strong>Cálculo do item:</strong> <code className="bg-white border border-slate-200 px-2 py-0.5 rounded font-mono text-amber-700">sobrepeso = peso_produzido * % sobrepeso</code>
              </li>
              <li>
                O total é somado em <code className="text-amber-700 font-mono font-semibold">sobrepeso_total_kg</code> e a lista analítica é salva em formato JSON no campo <code className="text-slate-800 font-mono">detalhes_sobrepeso</code>.
              </li>
            </ul>
          </div>

          {/* Formulas FFG */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
            <h4 className="font-bold text-sm text-amber-700 flex items-center gap-2">
              <Calculator className="w-4 h-4" />
              Equações Oficiais de Rendimento FFG-NM
            </h4>

            <div className="space-y-2 font-mono text-[11px]">
              <div className="p-2.5 rounded bg-white border border-slate-200 flex items-center justify-between gap-2">
                <span className="text-slate-600">Matéria-Prima FFG (kg):</span>
                <span className="text-slate-900 font-bold">Massa Viva - TPA Total - Sobrepeso Total</span>
              </div>
              <div className="p-2.5 rounded bg-white border border-slate-200 flex items-center justify-between gap-2">
                <span className="text-slate-600">Rendimento de Vísceras (%):</span>
                <span className="text-emerald-700 font-bold">(Farinha de Vísceras / MP FFG) * 100</span>
              </div>
              <div className="p-2.5 rounded bg-white border border-slate-200 flex items-center justify-between gap-2">
                <span className="text-slate-600">Rendimento de Penas (%):</span>
                <span className="text-emerald-700 font-bold">(Farinha de Penas / MP FFG) * 100</span>
              </div>
              <div className="p-2.5 rounded bg-white border border-slate-200 flex items-center justify-between gap-2">
                <span className="text-slate-600">Rendimento Farinha (%):</span>
                <span className="text-emerald-700 font-bold">((Farinha Vísceras + Farinha Penas) / MP FFG) * 100</span>
              </div>
              <div className="p-2.5 rounded bg-white border border-slate-200 flex items-center justify-between gap-2">
                <span className="text-slate-600">Rendimento de Óleo (%):</span>
                <span className="text-amber-700 font-bold">(Produção de Óleo / MP FFG) * 100</span>
              </div>
              <div className="p-2.5 rounded bg-white border border-slate-200 flex items-center justify-between gap-2">
                <span className="text-slate-600">Rendimento Geral Total (%):</span>
                <span className="text-slate-900 font-bold">Rendimento Farinha (%) + Rendimento Óleo (%)</span>
              </div>
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs transition-colors"
          >
            Entendido
          </button>
        </div>

      </div>
    </div>
  );
};
