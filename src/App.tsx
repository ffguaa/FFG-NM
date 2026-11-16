import React, { useState, useEffect, useCallback } from 'react';
import { supabase, testSupabaseConnection, ConnectionStatus } from './lib/supabase';
import { ToastProvider, useToast } from './context/ToastContext';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { ExecutiveDashboard } from './components/ExecutiveDashboard';
import { YieldForm } from './components/YieldForm';
import { MaintenanceForm } from './components/MaintenanceForm';
import { InventoryModule } from './components/InventoryModule';
import { SkuManagementModal } from './components/SkuManagementModal';
import { SpreadsheetHelpModal } from './components/SpreadsheetHelpModal';
import {
  FfgSku,
  FfgYieldRecord,
  FfgDowntime,
  FfgInventory,
  FfgInventoryBag,
} from './types';
import { RefreshCw } from 'lucide-react';

function AppContent() {
  const { showSupabaseError } = useToast();

  const [activeTab, setActiveTab] = useState<'dashboard' | 'yield' | 'maintenance' | 'inventory'>('dashboard');
  const mainContainerRef = React.useRef<HTMLElement>(null);

  // Supabase Data States
  const [skus, setSkus] = useState<FfgSku[]>([]);
  const [yieldRecords, setYieldRecords] = useState<FfgYieldRecord[]>([]);
  const [downtimes, setDowntimes] = useState<FfgDowntime[]>([]);
  const [inventories, setInventories] = useState<FfgInventory[]>([]);
  const [inventoryBags, setInventoryBags] = useState<FfgInventoryBag[]>([]);
  const [editingYieldRecord, setEditingYieldRecord] = useState<FfgYieldRecord | null>(null);

  // Connectivity State
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({
    connected: false,
    checking: true,
  });

  // Modals
  const [isSkuModalOpen, setIsSkuModalOpen] = useState(false);
  const [isHelpModalOpen, setIsHelpModalOpen] = useState(false);

  // Initial loading
  const [initialLoading, setInitialLoading] = useState(true);

  // Probe Supabase Connectivity
  const verifyConnection = useCallback(async () => {
    setConnectionStatus((prev) => ({ ...prev, checking: true }));
    const result = await testSupabaseConnection();
    setConnectionStatus({
      connected: result.ok,
      checking: false,
      errorMessage: result.message,
      latencyMs: result.latency,
    });
    if (!result.ok && result.message) {
      showSupabaseError('Falha de Conexão com Supabase', result.message);
    }
  }, [showSupabaseError]);

  // Load SKUs
  const fetchSkus = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('ffg_skus')
        .select('*')
        .order('produto', { ascending: true });

      if (error) throw error;
      setSkus(data || []);
    } catch (err: any) {
      showSupabaseError('Erro ao Carregar SKUs (ffg_skus)', err);
    }
  }, [showSupabaseError]);

  // Load Yield Records
  const fetchYieldRecords = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('ffg_yield_records')
        .select('*')
        .order('production_date', { ascending: false });

      if (error) throw error;
      setYieldRecords(data || []);
    } catch (err: any) {
      showSupabaseError('Erro ao Carregar Rendimentos (ffg_yield_records)', err);
    }
  }, [showSupabaseError]);

  // Load Downtimes
  const fetchDowntimes = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('ffg_downtimes')
        .select('*')
        .order('start_datetime', { ascending: false });

      if (error) throw error;
      setDowntimes(data || []);
    } catch (err: any) {
      showSupabaseError('Erro ao Carregar Paradas (ffg_downtimes)', err);
    }
  }, [showSupabaseError]);

  // Load Inventory & Bags
  const fetchInventoryData = useCallback(async () => {
    try {
      const [invRes, bagsRes] = await Promise.all([
        supabase
          .from('ffg_inventories')
          .select('*')
          .order('inventory_date', { ascending: false })
          .order('inventory_time', { ascending: false }),
        supabase
          .from('ffg_inventory_bags')
          .select('*')
          .order('production_date', { ascending: false })
          .order('created_at', { ascending: false }),
      ]);

      if (invRes.error) throw invRes.error;
      if (bagsRes.error) throw bagsRes.error;

      setInventories(invRes.data || []);
      setInventoryBags(bagsRes.data || []);
    } catch (err: any) {
      showSupabaseError('Erro ao Carregar Inventário (ffg_inventories / ffg_inventory_bags)', err);
    }
  }, [showSupabaseError]);

  // Reload all data
  const reloadAll = useCallback(async () => {
    await Promise.all([
      verifyConnection(),
      fetchSkus(),
      fetchYieldRecords(),
      fetchDowntimes(),
      fetchInventoryData(),
    ]);
  }, [verifyConnection, fetchSkus, fetchYieldRecords, fetchDowntimes, fetchInventoryData]);

  useEffect(() => {
    const init = async () => {
      setInitialLoading(true);
      await reloadAll();
      setInitialLoading(false);
    };
    init();
  }, []);

  const handleStartEditYieldRecord = (record: FfgYieldRecord) => {
    setEditingYieldRecord(record);
    setActiveTab('yield');
    setTimeout(() => {
      mainContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 50);
  };

  const handleCancelEditYieldRecord = () => {
    setEditingYieldRecord(null);
  };

  const handleYieldRecordUpdated = async () => {
    await fetchYieldRecords();
    setEditingYieldRecord(null);
    setActiveTab('dashboard');
    setTimeout(() => {
      mainContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    }, 50);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans selection:bg-emerald-500 selection:text-white">
      
      {/* Top Header */}
      <Header
        activeTab={activeTab}
        onOpenHelp={() => setIsHelpModalOpen(true)}
        onOpenSkus={() => setIsSkuModalOpen(true)}
      />

      {/* Main Layout */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* Left Sidebar */}
        <Sidebar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          connectionStatus={connectionStatus}
          onRetryConnection={verifyConnection}
          onOpenSkus={() => setIsSkuModalOpen(true)}
        />

        {/* Dynamic Content Area */}
        <main ref={mainContainerRef} className="flex-1 overflow-y-auto p-6 md:p-8 bg-slate-50">
          <div className="max-w-7xl mx-auto">
            {initialLoading ? (
              <div className="flex flex-col items-center justify-center py-32 space-y-4">
                <div className="relative">
                  <div className="w-12 h-12 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center animate-spin">
                    <RefreshCw className="w-6 h-6 text-emerald-600" />
                  </div>
                </div>
                <div className="text-center">
                  <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider font-mono">
                    Conectando ao Supabase...
                  </h3>
                  <p className="text-xs text-slate-500 mt-1">
                    Carregando tabelas ffg_skus, ffg_yield_records e ffg_downtimes
                  </p>
                </div>
              </div>
            ) : (
              <>
                {/* Tab 1: Executive Dashboard */}
                {activeTab === 'dashboard' && (
                  <ExecutiveDashboard
                    yieldRecords={yieldRecords}
                    downtimes={downtimes}
                    onReload={reloadAll}
                    onNavigateToYield={() => {
                      setEditingYieldRecord(null);
                      setActiveTab('yield');
                    }}
                    onNavigateToMaintenance={() => setActiveTab('maintenance')}
                    onEditYieldRecord={handleStartEditYieldRecord}
                  />
                )}

                {/* Tab 2: Yield & Overweight Form */}
                {activeTab === 'yield' && (
                  <YieldForm
                    skus={skus}
                    editingRecord={editingYieldRecord}
                    onCancelEdit={handleCancelEditYieldRecord}
                    onOpenSkus={() => setIsSkuModalOpen(true)}
                    onRecordSaved={fetchYieldRecords}
                    onRecordUpdated={handleYieldRecordUpdated}
                  />
                )}

                {/* Tab 3: Maintenance & Downtime Form */}
                {activeTab === 'maintenance' && (
                  <MaintenanceForm
                    downtimes={downtimes}
                    onReload={fetchDowntimes}
                  />
                )}

                {/* Tab 4: Inventory & Stock Quality */}
                {activeTab === 'inventory' && (
                  <InventoryModule
                    inventories={inventories}
                    inventoryBags={inventoryBags}
                    onReload={fetchInventoryData}
                  />
                )}
              </>
            )}
          </div>
        </main>

      </div>

      {/* Sku Management Modal */}
      <SkuManagementModal
        isOpen={isSkuModalOpen}
        onClose={() => setIsSkuModalOpen(false)}
        skus={skus}
        onReload={fetchSkus}
      />

      {/* Help Modal */}
      <SpreadsheetHelpModal
        isOpen={isHelpModalOpen}
        onClose={() => setIsHelpModalOpen(false)}
      />

    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  );
}
