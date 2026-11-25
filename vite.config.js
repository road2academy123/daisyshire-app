import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.GITHUB_PAGES === 'true'
    ? '/daisyshire-app/'
    : '/',

  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
    allowedHosts: [
      'orientation-basename-prove-editor.trycloudflare.com'
    ]
  }
});
