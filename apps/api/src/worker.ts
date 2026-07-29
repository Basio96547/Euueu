import { buildDeps, createApp, type Deps } from './http/app.js';
import { useCloudflareKv, type CfKvNamespace } from './common/kv.js';

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
  DATABASE_URL?: string;
  KV?: CfKvNamespace;
  JWT_SECRET?: string;
  [key: string]: unknown;
}

/**
 * اتصالٌ لكل طلب.
 *
 * التجميع بين الطلبات هو الغريزة الصحيحة على خادم دائم، وهو خطأ هنا:
 * كائنات الإدخال والإخراج في workerd لا تعبر حدود الطلب، فاتصالٌ فُتح
 * في طلبٍ ثم استُعمل في التالي يُعلَّق حتى يقتله وقت التشغيل — وهو ما
 * كان يُنتج نجاحاً وفشلاً بالتناوب في كل مسار يمسّ القاعدة.
 *
 * الثمن اتصالٌ جديد لكل طلب، ويُخفَّض لاحقاً بـHyperdrive بلا تغيير
 * سطر واحد هنا: يكفي أن يشير DATABASE_URL إلى ربط Hyperdrive.
 */
function api(env: Env) {
  const deps = buildDeps(String(env.DATABASE_URL ?? ''));
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
      if (!env.DATABASE_URL) {
        /* الصمت هنا خطر: بلا قاعدة تعمل الواجهة كأنها موجودة وتفشل
           فشلاً غامضاً في كل شاشة. الرسالة تقول ما ينقص بالضبط. */
        return Response.json({
          error: {
            code: 'DATABASE_NOT_CONFIGURED',
            message: {
              ar: 'قاعدة البيانات غير مضبوطة على هذا الـWorker — اضبط السرّ DATABASE_URL',
              en: 'DATABASE_URL secret is not set on this Worker',
            },
          },
        }, { status: 503 });
      }
      useCloudflareKv(env.KV);
      const { deps, app } = api(env);
      try {
        return await app.fetch(request, env, ctx);
      } finally {
        // الإغلاق بعد إرسال الجواب: تركُه مفتوحاً يستهلك اتصالات القاعدة
        ctx.waitUntil(deps.prisma.$disconnect().catch(() => {}));
      }
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
    if (!env.DATABASE_URL) {
      console.error('[cron] DATABASE_URL غير مضبوط — تُخطّى المهمة');
      return;
    }
    useCloudflareKv(env.KV);
    const { deps } = api(env);

    ctx.waitUntil((async () => {
      try {
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
      } finally {
        await deps.prisma.$disconnect().catch(() => {});
      }
    })());
  },
};
