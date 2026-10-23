import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 3000 },
  esbuild: { loader: 'jsx', include: /src\/.*\.[jt]sx?$/, exclude: [] },
  optimizeDeps: { esbuildOptions: { loader: { '.js': 'jsx' } } },
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Heavy libs get their own cacheable chunks; recharts only loads on the Progress page.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
          realtime: ['socket.io-client', 'axios'],
        },
      },
    },
  },
});
