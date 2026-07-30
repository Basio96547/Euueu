import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/* زبير مشروع مستقل بذاته: لا يشارك متجر تالي شام بناءً ولا حزماً ولا نشراً.
 * base نسبي ('./') كي يعمل التطبيق مهما كان المسار الذي يُخدَم منه — نطاقاً
 * مستقلاً أو مجلداً فرعياً — فلا يُكسَر تثبيته على الشاشة الرئيسية عند النقل. */
export default defineConfig({
  plugins: [react()],
  base: './',
  server: { port: 5180, host: true },
  build: { outDir: 'dist', assetsDir: 'assets', sourcemap: true },
});
