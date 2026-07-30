import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './App.js';

const host = document.getElementById('root');
if (host) {
  createRoot(host).render(
    <StrictMode><App /></StrictMode>,
  );
}

/* تسجيل عامل الخدمة نسبةً إلى **الصفحة** (document.baseURI) لا إلى ملف الشيفرة.
 * الفرق ليس تفصيلاً: بعد البناء يسكن هذا الملف في assets/، فلو حُلَّ المسار
 * نسبةً إليه (import.meta.url) لبُحث عن العامل في assets/sw.js وهو في الجذر،
 * فلا يُسجَّل ولا يعمل التطبيق بلا شبكة. وbaseURI يوافق base النسبي في
 * vite.config.ts فيصحّ المسار مهما كان المجلد الذي يُخدَم منه. */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const base = document.baseURI;
    navigator.serviceWorker
      .register(new URL('sw.js', base).href, { scope: new URL('./', base).href })
      .catch(() => {
        // فشل التسجيل يعني فقدان العمل بلا شبكة فقط، والتطبيق يبقى عاملاً
      });
  });
}
