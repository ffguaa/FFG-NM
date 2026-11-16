import React, { useState, useEffect } from 'react';
import { Calendar, Clock, HelpCircle } from 'lucide-react';
import { ShiftType } from '../types';

interface HeaderProps {
  activeTab: 'dashboard' | 'yield' | 'maintenance' | 'inventory';
  activeShift?: ShiftType;
  onOpenHelp?: () => void;
  onOpenSkus?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
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
    <header className="h-16 border-b border-slate-200 bg-white/95 backdrop-blur px-6 flex items-center justify-between sticky top-0 z-30 shadow-xs print:hidden">
      
      {/* Left branding */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white shadow-sm font-black text-lg tracking-wider">
            UA
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-sm tracking-wide text-slate-900 uppercase">
                União Avícola Agroindustrial
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-700 font-semibold tracking-wider uppercase">
                FFG-NM Industrial
              </span>
            </div>
            <p className="text-xs text-slate-500 font-medium">
              Fábrica de Farinhas e Gorduras &bull; Rendimento & Manutenção
            </p>
          </div>
        </div>
      </div>

      {/* Right widgets */}
      <div className="flex items-center gap-3">
        {onOpenSkus && (
          <button
            onClick={onOpenSkus}
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white hover:bg-slate-50 border border-slate-300 text-xs font-semibold text-slate-700 transition-colors shadow-2xs"
          >
            <span>Gerenciar SKUs (%)</span>
          </button>
        )}

        {onOpenHelp && (
          <button
            onClick={onOpenHelp}
            className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100 border border-transparent hover:border-slate-200 transition-colors"
            title="Instruções de Planilhas e Regras"
          >
            <HelpCircle className="w-4 h-4" />
          </button>
        )}

        <div className="h-6 w-px bg-slate-200 hidden md:block" />

        {/* Live clock */}
        <div className="hidden lg:flex items-center gap-3 text-xs font-mono bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200">
          <div className="flex items-center gap-1.5 text-slate-600">
            <Calendar className="w-3.5 h-3.5 text-emerald-600" />
            <span>{formatDate(currentTime)}</span>
          </div>
          <div className="flex items-center gap-1.5 text-slate-900 font-semibold">
            <Clock className="w-3.5 h-3.5 text-amber-600" />
            <span>{formatTime(currentTime)}</span>
          </div>
        </div>
      </div>
    </header>
  );
};
