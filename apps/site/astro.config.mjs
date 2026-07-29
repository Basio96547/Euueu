import { defineConfig } from 'astro/config';

// الأصل: صفر JavaScript. الجزر تُضاف عند الحاجة فقط (الفصل 5 §5.2).
export default defineConfig({
  site: process.env.PUBLIC_SITE_URL ?? 'http://localhost:4321',
  output: 'static',
  build: { inlineStylesheets: 'auto' },
  compressHTML: true,
  devToolbar: { enabled: false },
});
