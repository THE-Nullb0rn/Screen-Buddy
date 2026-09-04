import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import { resolve } from 'path'
import { fileURLToPath } from 'url'

// ESM-compatible __dirname
const __dirname = fileURLToPath(new URL('.', import.meta.url))

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),

    // Bundle the Electron main process.
    // Entry paths must be ABSOLUTE so vite-plugin-electron finds them
    // regardless of the Vite `root` being set to src/renderer.
    electron([
      {
        entry: resolve(__dirname, 'src/main/main.js'),
        vite: {
          build: {
            outDir: resolve(__dirname, 'dist-electron'),
            rollupOptions: {
              external: ['electron'],
            },
          },
        },
      },
      {
        entry: resolve(__dirname, 'src/main/preload.js'),
        vite: {
          build: {
            outDir: resolve(__dirname, 'dist-electron'),
            rollupOptions: {
              external: ['electron'],
            },
          },
        },
      },
      {
        entry: resolve(__dirname, 'src/main/settings.js'),
        vite: {
          build: {
            outDir: resolve(__dirname, 'dist-electron'),
            rollupOptions: {
              external: ['electron'],
            },
          },
        },
      },
      {
        entry: resolve(__dirname, 'src/main/autostart.js'),
        vite: {
          build: {
            outDir: resolve(__dirname, 'dist-electron'),
            rollupOptions: {
              external: ['electron'],
            },
          },
        },
      },
    ]),

    // Allow renderer to use Node.js APIs through the contextBridge
    renderer(),
  ],

  // Vite root: where index.html lives
  root: resolve(__dirname, 'src/renderer'),

  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
  },

  server: {
    port: 5173,
  },
})
