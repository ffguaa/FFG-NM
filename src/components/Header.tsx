import React, { useState, useEffect } from 'react';
import { Factory, Calendar, Clock, ShieldCheck, HelpCircle } from 'lucide-react';
import { ShiftType } from '../types';

interface HeaderProps {
  activeTab: 'dashboard' | 'yield' | 'maintenance';
  activeShift?: ShiftType;
  onOpenHelp?: () => void;
  onOpenSkus?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  activeShift,
  onOpenHelp,
  onOpenSkus,
}) => {
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('pt-BR', {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  return (
    <header className="h-16 border-b border-slate-800 bg-slate-950/95 backdrop-blur px-6 flex items-center justify-between sticky top-0 z-30">
      
      {/* Left branding */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-700 flex items-center justify-center text-slate-950 shadow-lg shadow-emerald-950/40 font-black text-lg tracking-wider">
            UA
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-sm tracking-wide text-white uppercase">
                União Avícola Agroindustrial
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-950/80 border border-emerald-700/50 text-emerald-400 font-semibold tracking-wider uppercase">
                FFG Industrial
              </span>
            </div>
            <p className="text-xs text-slate-400 font-medium">
              Fábrica de Farinhas e Gorduras &bull; Rendimento & Manutenção
            </p>
          </div>
        </div>
      </div>

      {/* Right widgets */}
      <div className="flex items-center gap-4">
        {onOpenSkus && (
          <button
            onClick={onOpenSkus}
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-medium text-slate-200 transition-colors"
          >
            <span>Gerenciar SKUs (%)</span>
          </button>
        )}

        {onOpenHelp && (
          <button
            onClick={onOpenHelp}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-900 border border-transparent hover:border-slate-800 transition-colors"
            title="Instruções de Planilhas e Regras"
          >
            <HelpCircle className="w-4 h-4 text-slate-400" />
          </button>
        )}

        <div className="h-6 w-px bg-slate-800 hidden md:block" />

        {/* Live clock */}
        <div className="hidden lg:flex items-center gap-3 text-xs font-mono bg-slate-900/80 px-3 py-1.5 rounded-lg border border-slate-800">
          <div className="flex items-center gap-1.5 text-slate-400">
            <Calendar className="w-3.5 h-3.5 text-emerald-400" />
            <span>{formatDate(currentTime)}</span>
          </div>
          <div className="flex items-center gap-1.5 text-slate-200 font-semibold">
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            <span>{formatTime(currentTime)}</span>
          </div>
        </div>
      </div>
    </header>
  );
};
