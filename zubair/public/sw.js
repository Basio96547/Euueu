/* ————— عامل الخدمة: زبير يعمل بلا شبكة —————
 *
 * دماغه كله على جهازك، فلا يحتاج الشبكة أصلاً بعد أول زيارة. وهذا ليس ترفاً
 * على شبكة سورية: تطبيق ينتظر الشبكة ليفتح تطبيق لا يُفتح.
 *
 * الاستراتيجية: الذاكرة أولاً للأصول (cache-first) لأن ملفات البناء موسومة
 * ببصمة في أسمائها، فما تغيّر تغيّر اسمه. والصفحة نفسها تُجلب من الشبكة أولاً
 * حين تتوفّر كي يصل التحديث، وتسقط إلى الذاكرة حين تغيب.
 */

const CACHE = 'zubair-v1';

/* ما يلزم لأول إقلاع. البقية تُخزَّن أول ما تُطلب. */
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // addAll تفشل كلها لو فشل ملف واحد، فنضيف كل ملف على حدة: أيقونة مفقودة
      // لا يجوز أن تمنع التطبيق من العمل بلا شبكة
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => undefined))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // لا نتدخّل إلا في القراءة: الطلبات الأخرى تمرّ كما هي
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // التنقّل إلى الصفحة: الشبكة أولاً ليصل التحديث، والذاكرة عند غيابها
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined);
          return response;
        })
        .catch(() => caches.match(request).then((hit) => hit ?? caches.match('./index.html')).then((hit) => hit ?? Response.error())),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit;
      return fetch(request).then((response) => {
        // لا نخزّن إلا الناجح: تخزين صفحة خطأ يعني تطبيقاً معطوباً إلى الأبد
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined);
        }
        return response;
      });
    }),
  );
});
