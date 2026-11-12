import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://mydyqaeoljydhityrnqc.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_fIub9w1uKcS0GFR8laPcMQ_-XcGqAqA';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

export interface ConnectionStatus {
  connected: boolean;
  checking: boolean;
  errorMessage?: string;
  latencyMs?: number;
}

/**
 * Probes the Supabase backend to confirm connectivity and permissions.
 */
export async function testSupabaseConnection(): Promise<{ ok: boolean; message?: string; latency?: number }> {
  const start = performance.now();
  try {
    // Attempt lightweight query on ffg_skus or ffg_yield_records
    const { error } = await supabase
      .from('ffg_skus')
      .select('id', { count: 'exact', head: true });

    const latency = Math.round(performance.now() - start);

    if (error) {
      // If table exists but empty, count is fine. If permission or network error, it will throw error
      return { ok: false, message: error.message || 'Erro ao conectar ao Supabase', latency };
    }

    return { ok: true, latency };
  } catch (err: any) {
    const latency = Math.round(performance.now() - start);
    return { ok: false, message: err?.message || 'Falha na conexão de rede com o Supabase', latency };
  }
}
