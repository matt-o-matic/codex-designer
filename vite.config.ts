import path from 'node:path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import electron from 'vite-plugin-electron/simple'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          build: {
            rollupOptions: {
              external: ['@openai/codex-sdk'],
            },
          },
        },
      },
      preload: {
        input: path.join(__dirname, 'electron/preload.ts'),
      },
      // Polyfill Electron/Node APIs for the renderer when needed.
      // We still prefer IPC + main-process APIs for privileged operations.
      renderer: process.env.NODE_ENV === 'test' ? undefined : {},
    }),
  ],
})
