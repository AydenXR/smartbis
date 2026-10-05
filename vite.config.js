import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let appVersion = '0.43.0'
try {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf8'))
  if (pkg?.version) appVersion = String(pkg.version)
} catch (err) {
  console.warn('[vite] no se pudo leer package.json version', err?.message)
}

export default defineConfig({
  base: './',
  plugins: [
    react({
      babel: {
        plugins: ['react-dev-locator'],
      },
    }),
    tsconfigPaths(),
  ],
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion),
  },
  envPrefix: ['VITE_', 'SMARTBIS_'],
  server: {
    allowedHosts: [
      'smartbis.ai',
      'www.smartbis.ai',
      'api.smartbis.ai',
      'pvlibapi.smartbis.ai',
      'cotizador.smartbis.ai',
      '.smartbis.ai',
    ],
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      },
    },
  },
  preview: {
    allowedHosts: [
      'smartbis.ai',
      'www.smartbis.ai',
      'api.smartbis.ai',
      'pvlibapi.smartbis.ai',
      'cotizador.smartbis.ai',
      '.smartbis.ai',
    ],
  },
})
