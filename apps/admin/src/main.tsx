import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@talisham/ui/tokens.css';
import '@talisham/ui/base.css';
import './app.css';
import App from './App.js';

createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>,
);

/*
 * عامل الخدمة لواجهة المندوب وحدها.
 * لا يُسجَّل إلا على مسار /courier: اللوحة تعمل على شبكة مكتب وتحتاج
 * أحدث الأرقام دائماً، والمندوب يحتاج تطبيقاً يفتح في قبو بلا إشارة.
 */
if ('serviceWorker' in navigator && location.pathname.startsWith('/courier')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
