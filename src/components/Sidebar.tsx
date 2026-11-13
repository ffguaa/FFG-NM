import React from 'react';
import { 
  BarChart3, Scale, Wrench, Database, RefreshCw, Layers
} from 'lucide-react';
import { ConnectionStatus } from '../lib/supabase';

interface SidebarProps {
  activeTab: 'dashboard' | 'yield' | 'maintenance';
  setActiveTab: (tab: 'dashboard' | 'yield' | 'maintenance') => void;
  connectionStatus: ConnectionStatus;
  onRetryConnection: () => void;
  onOpenSkus: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  connectionStatus,
  onRetryConnection,
  onOpenSkus,
}) => {
  return (
    <aside className="w-64 bg-white border-r border-slate-200 flex flex-col justify-between shrink-0 select-none">
      
      {/* Top Nav Links */}
      <div className="p-4 space-y-6">
        <div className="px-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono">
            Módulos Operacionais
          </span>
        </div>

        <nav className="space-y-1.5">
          {/* Tab 1 */}
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-xs font-semibold transition-all border ${
              activeTab === 'dashboard'
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50 border-transparent'
            }`}
          >
            <BarChart3 className={`w-4 h-4 shrink-0 ${activeTab === 'dashboard' ? 'text-emerald-600' : 'text-slate-500'}`} />
            <div className="text-left">
              <div>Dashboard Executivo</div>
              <div className={`text-[10px] font-normal ${activeTab === 'dashboard' ? 'text-emerald-600/80' : 'text-slate-400'}`}>
                Visão Geral e KPIs
              </div>
            </div>
          </button>

          {/* Tab 2 */}
          <button
            onClick={() => setActiveTab('yield')}
            className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-xs font-semibold transition-all border ${
              activeTab === 'yield'
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50 border-transparent'
            }`}
          >
            <Scale className={`w-4 h-4 shrink-0 ${activeTab === 'yield' ? 'text-emerald-600' : 'text-slate-500'}`} />
            <div className="text-left">
              <div>Rendimento & Sobrepeso</div>
              <div className={`text-[10px] font-normal ${activeTab === 'yield' ? 'text-emerald-600/80' : 'text-slate-400'}`}>
                Importação e Lançamento
              </div>
            </div>
          </button>

          {/* Tab 3 */}
          <button
            onClick={() => setActiveTab('maintenance')}
            className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-xs font-semibold transition-all border ${
              activeTab === 'maintenance'
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50 border-transparent'
            }`}
          >
            <Wrench className={`w-4 h-4 shrink-0 ${activeTab === 'maintenance' ? 'text-emerald-600' : 'text-slate-500'}`} />
            <div className="text-left">
              <div>Paradas & Manutenção</div>
              <div className={`text-[10px] font-normal ${activeTab === 'maintenance' ? 'text-emerald-600/80' : 'text-slate-400'}`}>
                Apontamento Rápido
              </div>
            </div>
          </button>
        </nav>

        {/* Separator & Admin Tools */}
        <div className="pt-4 border-t border-slate-200 space-y-2">
          <div className="px-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono">
              Configurações
            </span>
          </div>

          <button
            onClick={onOpenSkus}
            className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium text-slate-700 hover:text-slate-900 hover:bg-slate-50 border border-slate-200 transition-colors"
          >
            <div className="flex items-center gap-2.5">
              <Layers className="w-3.5 h-3.5 text-emerald-600" />
              <span>Cadastro de SKUs</span>
            </div>
            <span className="text-[10px] text-slate-500 font-mono">% Sobrepeso</span>
          </button>
        </div>
      </div>

      {/* Footer: Supabase Status Indicator */}
      <div className="p-4 border-t border-slate-200 bg-slate-50/70">
        <div className="rounded-xl p-3 bg-white border border-slate-200 shadow-2xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Database className="w-3.5 h-3.5 text-slate-500" />
              <span className="text-xs font-semibold text-slate-800">Supabase DB</span>
            </div>

            <button
              onClick={onRetryConnection}
              disabled={connectionStatus.checking}
              className="p-1 text-slate-400 hover:text-slate-700 rounded hover:bg-slate-100 transition-colors"
              title="Testar Conexão Novamente"
            >
              <RefreshCw className={`w-3 h-3 ${connectionStatus.checking ? 'animate-spin text-emerald-600' : ''}`} />
            </button>
          </div>

          <div className="mt-2.5 flex items-center gap-2">
            {connectionStatus.checking ? (
              <div className="flex items-center gap-2 text-slate-500 text-xs">
                <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                <span className="text-[11px] font-mono">Verificando...</span>
              </div>
            ) : connectionStatus.connected ? (
              <div className="flex items-center gap-2 text-emerald-700 text-xs">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <span className="text-[11px] font-bold font-mono">Supabase Conectado</span>
                {connectionStatus.latencyMs !== undefined && (
                  <span className="text-[10px] text-slate-500 font-mono">
                    ({connectionStatus.latencyMs}ms)
                  </span>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-1.5 text-rose-600 text-xs">
                  <span className="w-2 h-2 rounded-full bg-rose-500" />
                  <span className="text-[11px] font-bold font-mono">Erro de Conexão</span>
                </div>
                {connectionStatus.errorMessage && (
                  <p className="text-[10px] text-rose-600 font-mono line-clamp-2 leading-tight">
                    {connectionStatus.errorMessage}
                  </p>
                )}
              </div>
            )}
          </div>
          
          <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-500 font-mono">
            <span>mydyqae...supabase.co</span>
            <span className="text-emerald-600 font-semibold">prod</span>
          </div>
        </div>
      </div>

    </aside>
  );
};
