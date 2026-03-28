import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
// react-pacman ships `import './style.scss'` — requires the `sass` package (see npm readme).
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
    resolve: {
      dedupe: ['react', 'react-dom'],
      alias: {
        react: path.resolve(__dirname, 'node_modules/react'),
        'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
      },
    },
    optimizeDeps: {
      include: ['react-pacman'],
    },
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(supabaseUrl),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(supabaseAnonKey),
    },
  }
})
