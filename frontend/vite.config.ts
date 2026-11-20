import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';

// HTTPS=1 npm run dev → serves https on the LAN so phones can use the camera (needs a secure origin)
const https = process.env.HTTPS === '1' && fs.existsSync('.cert/key.pem')
  ? { key: fs.readFileSync('.cert/key.pem'), cert: fs.readFileSync('.cert/cert.pem') }
  : undefined;

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../backend/public',
    emptyOutDir: true,
  },
  server: {
    host: true,
    port: 5173,
    https,
    proxy: {
      '/api': { target: 'http://localhost:4001', changeOrigin: true },
      '/uploads': { target: 'http://localhost:4001', changeOrigin: true },
    },
  },
});
