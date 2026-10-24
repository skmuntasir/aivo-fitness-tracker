import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 3000 },
  esbuild: {
    loader: 'jsx', include: /src\/.*\.[jt]sx?$/, exclude: [],
    // Strip noisy debug logging from production bundles (console.error/warn are kept)
    pure: process.env.NODE_ENV === 'production' ? ['console.log', 'console.debug', 'console.info'] : [],
    legalComments: 'none',
  },
  optimizeDeps: { esbuildOptions: { loader: { '.js': 'jsx' } } },
  build: {
    target: 'es2020',            // modern output = smaller, faster bundles
    cssCodeSplit: true,          // each lazy page only downloads its own CSS
    cssMinify: true,
    reportCompressedSize: false, // faster builds
    assetsInlineLimit: 4096,     // inline only tiny assets; everything else is cached separately
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
