// @ts-check
import { defineConfig } from 'astro/config';

// Site URL is a placeholder until the domain is decided (see README).
export default defineConfig({
  site: 'https://dominio.exemplo', // [dominio] placeholder – see README,
  trailingSlash: 'never',
  build: { format: 'file' },
});
