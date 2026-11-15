import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(() => {
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      build: {
        rollupOptions: {
          output: {
            manualChunks(id) {
              if (!id.includes('node_modules')) return;

              if (id.includes('recharts')) return 'charts';
              if (id.includes('xlsx') || id.includes('jspdf') || id.includes('html2canvas')) return 'exports';
              if (id.includes('react-markdown') || id.includes('remark-gfm')) return 'markdown';
              if (id.includes('qrcode.react') || id.includes('html5-qrcode') || id.includes('jsqr')) return 'qr';
              if (id.includes('tus-js-client')) return 'uploads';
              if (id.includes('@supabase')) return 'supabase';
              if (id.includes('framer-motion')) return 'motion';

              return 'vendor';
            }
          }
        }
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
