/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';
import path from 'path';

export default defineConfig(({ mode }) => ({
  base: '/dash/',
  // Vitest runs in serve mode, where the plugin injects a fast refresh preamble that only a real
  // browser page provides — without this, importing any component from a test throws.
  plugins: [react({ fastRefresh: mode !== 'test' }), svgr()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
  },
}));
