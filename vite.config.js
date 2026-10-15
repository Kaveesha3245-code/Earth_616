import { defineConfig } from 'vite';
import { installApi } from './server/api.mjs';

export default defineConfig({
  plugins: [{ name: 'earth-616-private-portal', configureServer: installApi, configurePreviewServer: installApi }],
  server: { fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.data/**', '**/private/**', '**/server/**', '**/tests/**', '**/.env*'] } },
  build: { target: 'es2022', chunkSizeWarningLimit: 750 },
});
