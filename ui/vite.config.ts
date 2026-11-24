import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/@lobehub') || id.includes('node_modules/antd') || id.includes('node_modules/@ant-design')) {
            return 'vendor-lobehub';
          }
          if (id.includes('node_modules/@astryxdesign') || id.includes('node_modules/@stylexjs')) {
            return 'vendor-astryx';
          }
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
            return 'vendor-react';
          }
          if (id.includes('ui/src/marketing')) {
            return 'public-funnel';
          }
        }
      }
    }
  }
});
