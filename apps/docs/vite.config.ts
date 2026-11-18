import { reactRouter } from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import mdx from 'fumadocs-mdx/vite';

export default defineConfig({
  plugins: [mdx(), tailwindcss(), reactRouter()],
  preview: {
    host: '127.0.0.1',
  },
  resolve: {
    tsconfigPaths: true,
  },
});
