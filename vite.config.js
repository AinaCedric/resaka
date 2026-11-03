import { defineConfig } from 'vite';
import pkg from './package.json' with { type: 'json' };
export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: { target: 'es2020', outDir: 'dist', assetsInlineLimit: 0 }
});
