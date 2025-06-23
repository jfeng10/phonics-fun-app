import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Add this build configuration
  build: {
    target: 'es2020', // or 'esnext' for the very latest
  },
});