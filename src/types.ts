export type ShiftType = 'Indústria' | '1T' | '2T';
export type ProductionLine = 'Vísceras' | 'Penas' | 'Geral/Utilidades';
export type MaintenanceType = 'Planejada' | 'Não planejada' | 'Falta de MP';

export interface FfgSku {
  id?: number | string;
  sku_uniao: string;
  sku_mbrf: string;
  produto: string;
  familia: string;
  percentual_sobrepeso: number; // e.g. 0.035 for 3.5% or 3.5
  created_at?: string;
}

export interface DetalheSobrepesoItem {
  sku: string;
  codigo_encontrado?: string;
  produto: string;
  familia?: string;
  peso_produzido: number;
  percentual: number;
  sobrepeso_kg: number;
}

export interface FfgYieldRecord {
  id?: number | string;
  production_date: string; // YYYY-MM-DD
  shift: ShiftType;
  massa_viva_kg: number;
  tpa_total_kg: number;
  tpa_pendentes_kg: number;
  sobrepeso_total_kg: number;
  mp_destinada_ffg_kg: number;
  farinha_visceras_kg: number;
  farinha_penas_kg: number;
  gordura_kg: number;
  oil_produced_kg?: number;
  oil_yield_percent?: number;
  rendimento_visceras_pct: number;
  rendimento_penas_pct: number;
  rendimento_geral_ffg_pct: number;
  detalhes_sobrepeso: DetalheSobrepesoItem[] | null;
  created_at?: string;
}

export interface FfgDowntime {
  id?: number | string;
  start_datetime: string; // ISO / timestamptz
  end_datetime: string;   // ISO / timestamptz
  duration_minutes: number;
  equipment_name: string;
  production_line: ProductionLine;
  maintenance_type: MaintenanceType;
  problem_description: string;
  responsible_person: string;
  created_at?: string;
}

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  title: string;
  message: string;
  timestamp: number;
}
