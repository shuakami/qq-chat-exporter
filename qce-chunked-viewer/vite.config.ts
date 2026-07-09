import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Builds a single self-contained IIFE bundle (viewer.js + viewer.css) that
// scripts/bundle.mjs then merges into one assets/app.js with the CSS injected
// at runtime, so the exported viewer works from file:// with no extra assets.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  server: {
    fs: { allow: ['..'] },
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    target: 'es2019',
    cssCodeSplit: false,
    lib: {
      entry: resolve(__dirname, 'src/main.tsx'),
      name: 'QceViewer',
      formats: ['iife'],
      fileName: () => 'viewer.js',
    },
    rollupOptions: {
      output: {
        assetFileNames: 'viewer.[ext]',
        inlineDynamicImports: true,
      },
    },
  },
});
