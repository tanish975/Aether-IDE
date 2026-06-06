import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL?.trim();
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY?.trim();
const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey);
const supabaseConfigError = !supabaseUrl
  ? 'Missing REACT_APP_SUPABASE_URL in .env.'
  : !supabaseAnonKey
    ? 'Missing REACT_APP_SUPABASE_ANON_KEY in .env.'
    : '';

if (!hasSupabaseConfig) {
  console.warn(`${supabaseConfigError} Real-time sync and authentication will be disabled until the env vars are set and the dev server is restarted.`);
}

export const supabase = createClient(supabaseUrl || 'https://placeholder.supabase.co', supabaseAnonKey || 'placeholder');
export { hasSupabaseConfig, supabaseConfigError };
