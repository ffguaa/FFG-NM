import React, { createContext, useContext, useState, useCallback } from 'react';
import { ToastMessage } from '../types';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';

interface ToastContextType {
  toasts: ToastMessage[];
  showToast: (type: 'success' | 'error' | 'info' | 'warning', title: string, message: string) => void;
  removeToast: (id: string) => void;
  showSupabaseError: (title: string, error: any) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((type: 'success' | 'error' | 'info' | 'warning', title: string, message: string) => {
    const id = Math.random().toString(36).substring(2, 9);
    const newToast: ToastMessage = {
      id,
      type,
      title,
      message,
      timestamp: Date.now(),
    };
    setToasts((prev) => [newToast, ...prev].slice(0, 5));

    // Auto dismiss after 8s for errors, 5s for others
    const timeout = type === 'error' ? 8000 : 5000;
    setTimeout(() => {
      removeToast(id);
    }, timeout);
  }, [removeToast]);

  const showSupabaseError = useCallback((title: string, error: any) => {
    const rawMsg = error?.message || error?.error_description || (typeof error === 'string' ? error : JSON.stringify(error));
    showToast('error', title, rawMsg);
    console.error(`[Supabase Error] ${title}:`, error);
  }, [showToast]);

  return (
    <ToastContext.Provider value={{ toasts, showToast, removeToast, showSupabaseError }}>
      {children}
      {/* Toast container */}
      <div className="fixed top-5 right-5 z-50 flex flex-col gap-3 max-w-md w-full pointer-events-none px-4 sm:px-0">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto p-4 rounded-xl border shadow-2xl backdrop-blur-md transition-all duration-300 animate-in slide-in-from-top-4 flex items-start gap-3 ${
              toast.type === 'error'
                ? 'bg-rose-950/95 border-rose-700/80 text-rose-100 shadow-rose-950/50'
                : toast.type === 'success'
                ? 'bg-emerald-950/95 border-emerald-700/80 text-emerald-100 shadow-emerald-950/50'
                : toast.type === 'warning'
                ? 'bg-amber-950/95 border-amber-700/80 text-amber-100 shadow-amber-950/50'
                : 'bg-slate-900/95 border-slate-700 text-slate-100 shadow-slate-950/50'
            }`}
          >
            <div className="shrink-0 mt-0.5">
              {toast.type === 'error' && <XCircle className="w-5 h-5 text-rose-400" />}
              {toast.type === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-400" />}
              {toast.type === 'warning' && <AlertTriangle className="w-5 h-5 text-amber-400" />}
              {toast.type === 'info' && <Info className="w-5 h-5 text-sky-400" />}
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-semibold tracking-wide">{toast.title}</h4>
              <p className="text-xs mt-1 text-slate-200/90 break-words leading-relaxed font-mono">
                {toast.message}
              </p>
            </div>
            <button
              onClick={() => removeToast(toast.id)}
              className="shrink-0 p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
              title="Fechar"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};
