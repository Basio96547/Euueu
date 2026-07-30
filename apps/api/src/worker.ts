import { buildDeps, createApp, type Deps } from './http/app.js';
import { useCloudflareKv, type CfKvNamespace } from './common/kv.js';
import type { D1Binding } from './common/prisma.service.js';
import type { R2Binding } from './modules/storage.js';
import { BootstrapService } from './modules/bootstrap.module.js';

/**
 * تالي شام — Worker واحد يخدم كل شيء.
 *
 * كانت أربعة تطبيقات في أربعة أماكن: موقعٌ ساكن على Worker، وتطبيقان
 * على Workers بلا نطاق، وواجهة برمجية بلا استضافة أصلاً. ونتيجتها أن
 * ‎/app/cart‎ ترجع 404 على النطاق الحيّ، وأن أي شاشة تحتاج بيانات لا
 * تعمل. الجمع في Worker واحد يحلّ ذلك من جذره:
 *
 *   ‎/api/v1/*‎  → الواجهة البرمجية (Hono + Prisma)
 *   ‎/app/*‎     → تطبيق السلة والحساب (SPA)
 *   ‎/admin/*‎   → لوحة التحكم (SPA)
 *   ما عداه      → الموقع الساكن (Astro)
 *
 * وأصلٌ واحد يعني بلا CORS وبلا نطاق ثانٍ وبلا رمز يُرسَل عبر أصلين.
 */

export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  /** ربط قاعدة D1 — لا رابط اتصال ولا كلمة سرّ */
  DB?: D1Binding;
  /** حاوية صور المنتجات على R2 */
  MEDIA?: R2Binding;
  KV?: CfKvNamespace;
  JWT_SECRET?: string;
  [key: string]: unknown;
}

/**
 * عميلٌ لكل طلب.
 *
 * الربط `env.DB` صالح داخل الطلب الذي جاء معه، ولا يُخزَّن بين الطلبات:
 * كائنات وقت التشغيل في workerd لا تعبر حدود الطلب. والبناء رخيص هنا
 * لأن D1 بلا اتصال يُفتح أصلاً — لا مصافحة ولا تجمّع.
 */
function api(env: Env) {
  const deps = buildDeps(env.DB!, env.MEDIA);
  return { deps, app: createApp(deps, { ...env, RUNTIME: 'cloudflare-worker' }) };
}

/**
 * SPA: مسارٌ داخلي لا ملف له يُخدَم بصفحة التطبيق نفسها.
 *
 * الفصل بالامتداد لا بمحاولة الجلب أولاً: خدمة الأصول تردّ على
 * ‎/app/cart‎ بتحويل 307 إلى ‎/app/cart/‎ لا بـ404، فمحاولة «اجلب ثم
 * احتَط عند 404» تُعيد التحويل إلى المتصفح ويرى الزبون صفحة مفقودة.
 */
async function spa(env: Env, request: Request, base: '/app' | '/admin'): Promise<Response> {
  const url = new URL(request.url);
  const last = url.pathname.split('/').pop() ?? '';

  if (last.includes('.')) return env.ASSETS.fetch(request);   // ملف حقيقي: JS أو CSS أو صورة

  const indexUrl = new URL(request.url);
  indexUrl.pathname = `${base}/index.html`;
  const res = await env.ASSETS.fetch(new Request(indexUrl.toString(), { method: 'GET' }));
  /* الحالة تُعاد 200: الصفحة موجودة فعلاً، والمسار الداخلي يحلّه
     الموجّه في المتصفح — و404 هنا تُفسد الفهرسة والمشاركة. */
  return new Response(res.body, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const path = new URL(request.url).pathname;

    if (path.startsWith('/api/v1')) {
      if (!env.DB) {
        /* الصمت هنا خطر: بلا قاعدة تعمل الواجهة كأنها موجودة وتفشل
           فشلاً غامضاً في كل شاشة. الرسالة تقول ما ينقص بالضبط. */
        return Response.json({
          error: {
            code: 'DATABASE_NOT_BOUND',
            message: {
              ar: 'ربط قاعدة D1 غير موجود على هذا الـWorker — راجع d1_databases في wrangler.jsonc',
              en: 'D1 binding (DB) is missing on this Worker',
            },
          },
        }, { status: 503 });
      }
      /* التهيئة تسبق كل شيء: تعمل والقاعدة بلا جداول، فلا تمرّ بطبقة
         الخدمات التي تفترض وجودها. وتُرفض على قاعدة مهيّأة. */
      if (path === '/api/v1/bootstrap') {
        const boot = new BootstrapService(env.DB);
        if (request.method === 'GET') return Response.json({ data: await boot.status() });
        if (request.method === 'POST') {
          try {
            return Response.json({ data: await boot.run() });
          } catch (e: any) {
            return Response.json(e?.body?.() ?? { error: { code: 'BOOTSTRAP_FAILED' } }, { status: e?.status ?? 500 });
          }
        }
      }

      useCloudflareKv(env.KV);
      const { app } = api(env);
      return app.fetch(request, env, ctx);
    }

    /* الصور من R2 مباشرةً: روابطها مخزَّنة في القاعدة منذ رفعها، فتبقى
       ثابتة مهما تبدّلت طبقة التخزين تحتها. */
    if (path.startsWith('/media/')) {
      if (!env.MEDIA) return new Response('لا حاوية صور مربوطة', { status: 503 });
      const obj = await env.MEDIA.get(path.slice('/media/'.length));
      if (!obj) return new Response('غير موجودة', { status: 404 });
      return new Response(obj.body as BodyInit, {
        headers: {
          'content-type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
          // الاسم بصمةُ المحتوى، فالتغيير يعني رابطاً جديداً — والتخزين أبديّ
          'cache-control': 'public, max-age=31536000, immutable',
        },
      });
    }

    if (path === '/app' || path.startsWith('/app/')) return spa(env, request, '/app');
    if (path === '/admin' || path.startsWith('/admin/')) return spa(env, request, '/admin');

    return env.ASSETS.fetch(request);
  },

  /**
   * المهام المجدوَلة — بديل المؤقّتات التي كانت داخل العملية.
   * لا عملية دائمة في Worker تحمل `setInterval`، والكنس ليس ترفاً:
   * بلا تحرير للحجوزات المنتهية يقول المتجر «نفدت» ورفّه ممتلئ.
   */
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    if (!env.DB) {
      console.error('[cron] ربط D1 غير موجود — تُخطّى المهمة');
      return;
    }
    useCloudflareKv(env.KV);
    const { deps } = api(env);

    ctx.waitUntil((async () => {
        // كل دقيقة: تحرير الحجوزات المنتهية
        const swept = await deps.sweeper.sweep().catch((e) => {
          console.error('[cron] الكنّاس:', e);
          return null;
        });
        if (swept?.released) console.log(`[cron] حُرّر ${swept.released} حجزاً`);

        const at = new Date(event.scheduledTime);
        const minute = at.getUTCMinutes();

        // كل خمس دقائق: تنبيهات التوفّر والسعر
        if (minute % 5 === 0) {
          const sent = await deps.alerts.scan().catch((e) => {
            console.error('[cron] التنبيهات:', e);
            return null;
          });
          if (sent && (sent.stock || sent.price)) {
            console.log(`[cron] تنبيهات: ${sent.stock} توفّر · ${sent.price} سعر`);
          }
        }

        // مرة يومياً: تنفيذ طلبات حذف الحساب التي استحقّ موعدها
        if (minute === 0 && at.getUTCHours() === 1) {
          const del = await deps.account.runDueDeletions().catch((e) => {
            console.error('[cron] الحذف المستحق:', e);
            return null;
          });
          if (del?.deleted) console.log(`[cron] نُفِّذ حذف ${del.deleted} حساباً`);
        }
    })());
  },
};
