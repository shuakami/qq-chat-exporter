import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';

export default [
  {
    input: 'main-exporter-pro.js',
    output: {
      file: 'public/dist/qce-pro.bundle.js',
      format: 'iife',
      name: 'QCEPro',
      globals: {
        'dexie': 'Dexie'
      }
    },
    external: ['dexie'],
    plugins: [
      resolve(),
      commonjs(),
      terser()
    ]
  },
  {
    input: 'history-manager.js',
    output: {
      file: 'public/dist/qce-history.bundle.js',
      format: 'iife',
      name: 'QCEHistory',
      globals: {
        'dexie': 'Dexie'
      }
    },
    external: ['dexie'],
    plugins: [
      resolve(),
      commonjs(),
      terser()
    ]
  }
]; 