import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const base = env.VITE_BASE_PATH?.trim() || '/'

  // Vite only exposes import.meta.env.VITE_* to the browser. Map common Supabase
  // .env names (SUPABASE_*) so the app still sees them as VITE_*.
  const supabaseUrl =
    env.VITE_SUPABASE_URL?.trim() || env.SUPABASE_URL?.trim() || ''
  const supabaseAnonKey =
    env.VITE_SUPABASE_ANON_KEY?.trim() ||
    env.SUPABASE_ANON_KEY?.trim() ||
    ''

  return {
    plugins: [react()],
    base,
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(supabaseUrl),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(supabaseAnonKey),
    },
  }
})
