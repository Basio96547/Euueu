/**
 * عامل خدمة مقصور على واجهة المندوب — الفصل 10 §10.5
 *
 * لا يخزّن شيئاً من لوحة الإدارة: اللوحة تعمل على شبكة مكتب، والمندوب
 * على شبكة شارع. وخلطهما يعني إما لوحةً تعرض أرقاماً قديمة، أو مندوباً
 * يحمل في جهازه بيانات لا تخصّه.
 *
 * القاعدة: الهيكل يُخزَّن (فيفتح التطبيق بلا شبكة)، والبيانات لا تُخزَّن
 * أبداً. مهمة اليوم القادمة من الذاكرة قد تكون مهمة الأمس — ومندوبٌ
 * يقرع باباً سُلِّم أمس أسوأ من مندوب ينتظر إشارة.
 */
const SHELL = 'talisham-courier-shell-v1';
const SHELL_FILES = ['/', '/index.html'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // لا يُلمس شيء من الواجهة البرمجية: الطابور في التطبيق يتولّى الانقطاع
  if (url.pathname.startsWith('/api/')) return;
  if (e.request.method !== 'GET') return;

  // الهيكل والأصول: من الشبكة أولاً ومن المخزن عند انقطاعها
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok && url.origin === self.location.origin) {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r ?? caches.match('/index.html'))),
  );
});
