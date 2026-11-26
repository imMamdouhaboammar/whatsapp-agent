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
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'vendor-react', test: /\/node_modules\/(react|react-dom|scheduler)\// },
            { name: 'vendor-astryx', test: /\/node_modules\/(@astryxdesign|@stylexjs)\// },
            { name: 'public-funnel', test: /\/ui\/src\/marketing\// },
            // Keep each icon with its variants. Size-based splits can cycle through shared icon helpers.
            { name: 'vendor-lobe-icons-a-c', test: /\/node_modules\/@lobehub\/icons\/es\/[A-C][^/]*\// },
            { name: 'vendor-lobe-icons-d-f', test: /\/node_modules\/@lobehub\/icons\/es\/[D-F][^/]*\// },
            { name: 'vendor-lobe-icons-g-m', test: /\/node_modules\/@lobehub\/icons\/es\/[G-M][^/]*\// },
            { name: 'vendor-lobe-icons-n-s', test: /\/node_modules\/@lobehub\/icons\/es\/[N-S][^/]*\// },
            { name: 'vendor-lobe-icons-t-z', test: /\/node_modules\/@lobehub\/icons\/es\/[T-Z][^/]*\// },
          ],
        },
      },
    },
  },
});
