import React from 'react';
import { 
  BarChart3, Scale, Wrench, Database, RefreshCw, 
  Settings, CheckCircle2, AlertOctagon, Layers
} from 'lucide-react';
import { ConnectionStatus } from '../lib/supabase';

interface SidebarProps {
  activeTab: 'dashboard' | 'yield' | 'maintenance';
  setActiveTab: (tab: 'dashboard' | 'yield' | 'maintenance') => void;
  connectionStatus: ConnectionStatus;
  onRetryConnection: () => void;
  onOpenSkus: () => void;
  yieldCount: number;
  downtimeCount: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  connectionStatus,
  onRetryConnection,
  onOpenSkus,
  yieldCount,
  downtimeCount,
}) => {
  return (
    <aside className="w-64 bg-slate-950 border-r border-slate-800 flex flex-col justify-between shrink-0 select-none">
      
      {/* Top Nav Links */}
      <div className="p-4 space-y-6">
        <div className="px-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 font-mono">
            Módulos Operacionais
          </span>
        </div>

        <nav className="space-y-1.5">
          {/* Tab 1 */}
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-xs font-semibold transition-all ${
              activeTab === 'dashboard'
                ? 'bg-gradient-to-r from-emerald-950 to-slate-900 border border-emerald-500/50 text-white shadow-lg shadow-emerald-950/30'
                : 'text-slate-400 hover:text-white hover:bg-slate-900/80 border border-transparent'
            }`}
          >
            <div className="flex items-center gap-3">
              <BarChart3 className={`w-4 h-4 ${activeTab === 'dashboard' ? 'text-emerald-400' : 'text-slate-400'}`} />
              <span>Dashboard Executivo</span>
            </div>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800/80 text-slate-400 font-mono">
              Visão
            </span>
          </button>

          {/* Tab 2 */}
          <button
            onClick={() => setActiveTab('yield')}
            className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-xs font-semibold transition-all ${
              activeTab === 'yield'
                ? 'bg-gradient-to-r from-emerald-950 to-slate-900 border border-emerald-500/50 text-white shadow-lg shadow-emerald-950/30'
                : 'text-slate-400 hover:text-white hover:bg-slate-900/80 border border-transparent'
            }`}
          >
            <div className="flex items-center gap-3">
              <Scale className={`w-4 h-4 ${activeTab === 'yield' ? 'text-emerald-400' : 'text-slate-400'}`} />
              <div className="text-left">
                <div>Rendimento & Sobrepeso</div>
                <div className="text-[10px] font-normal text-slate-400">Importação e Lançamento</div>
              </div>
            </div>
            {yieldCount > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-950 border border-emerald-800 text-emerald-400 font-mono">
                {yieldCount}
              </span>
            )}
          </button>

          {/* Tab 3 */}
          <button
            onClick={() => setActiveTab('maintenance')}
            className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-xs font-semibold transition-all ${
              activeTab === 'maintenance'
                ? 'bg-gradient-to-r from-amber-950 to-slate-900 border border-amber-500/50 text-white shadow-lg shadow-amber-950/30'
                : 'text-slate-400 hover:text-white hover:bg-slate-900/80 border border-transparent'
            }`}
          >
            <div className="flex items-center gap-3">
              <Wrench className={`w-4 h-4 ${activeTab === 'maintenance' ? 'text-amber-400' : 'text-slate-400'}`} />
              <div className="text-left">
                <div>Paradas & Manutenção</div>
                <div className="text-[10px] font-normal text-slate-400">Apontamento Rápido</div>
              </div>
            </div>
            {downtimeCount > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-950 border border-amber-800 text-amber-400 font-mono">
                {downtimeCount}
              </span>
            )}
          </button>
        </nav>

        {/* Separator & Admin Tools */}
        <div className="pt-4 border-t border-slate-900 space-y-2">
          <div className="px-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 font-mono">
              Configurações
            </span>
          </div>

          <button
            onClick={onOpenSkus}
            className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-900 border border-slate-800 transition-colors"
          >
            <div className="flex items-center gap-2.5">
              <Layers className="w-3.5 h-3.5 text-emerald-400" />
              <span>Cadastro de SKUs</span>
            </div>
            <span className="text-[10px] text-slate-500 font-mono">% Sobrepeso</span>
          </button>
        </div>
      </div>

      {/* Footer: Supabase Status Indicator (Strict Requirement 1) */}
      <div className="p-4 border-t border-slate-900 bg-slate-950/80">
        <div className="rounded-xl p-3 bg-slate-900/60 border border-slate-800/80">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Database className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-xs font-semibold text-slate-200">Supabase DB</span>
            </div>

            <button
              onClick={onRetryConnection}
              disabled={connectionStatus.checking}
              className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-800 transition-colors"
              title="Testar Conexão Novamente"
            >
              <RefreshCw className={`w-3 h-3 ${connectionStatus.checking ? 'animate-spin text-emerald-400' : ''}`} />
            </button>
          </div>

          <div className="mt-2.5 flex items-center gap-2">
            {connectionStatus.checking ? (
              <div className="flex items-center gap-2 text-slate-400 text-xs">
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                <span className="text-[11px] font-mono">Verificando...</span>
              </div>
            ) : connectionStatus.connected ? (
              <div className="flex items-center gap-2 text-emerald-400 text-xs">
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
                <div className="flex items-center gap-1.5 text-rose-400 text-xs">
                  <span className="w-2 h-2 rounded-full bg-rose-500" />
                  <span className="text-[11px] font-bold font-mono">Erro de Conexão</span>
                </div>
                {connectionStatus.errorMessage && (
                  <p className="text-[10px] text-rose-300 font-mono line-clamp-2 leading-tight">
                    {connectionStatus.errorMessage}
                  </p>
                )}
              </div>
            )}
          </div>
          
          <div className="mt-2 pt-2 border-t border-slate-800/60 flex items-center justify-between text-[10px] text-slate-500 font-mono">
            <span>mydyqae...supabase.co</span>
            <span className="text-emerald-500/80">prod</span>
          </div>
        </div>
      </div>

    </aside>
  );
};
