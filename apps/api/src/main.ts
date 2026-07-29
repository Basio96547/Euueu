import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync, mkdirSync } from 'node:fs';
import { buildDeps, createApp } from './http/app.js';
import { assertNoPublishedDemoInProd } from './common/boot-guard.js';
import { mediaPublicBase, mediaRoot, usesLocalDisk } from './modules/storage.js';
import { initKv } from './common/kv.js';

/**
 * تشغيل الواجهة نفسها على Node.
 *
 * التطبيق واحد (`createApp`) والمنفَّذان اثنان: هذا للتطوير وللفحص من
 * طرف إلى طرف، و`worker.ts` للإنتاج على Cloudflare. طبقتا HTTP اثنتان
 * تعنيان اختلافاً صامتاً بين ما يُختبَر وما يُنشَر، ولذلك واحدة.
 */
const PORT = Number(process.env.API_PORT ?? process.env.PORT ?? 4000);

async function bootstrap() {
  await assertNoPublishedDemoInProd();
  await initKv();

  const deps = buildDeps(process.env.DATABASE_URL ?? '');
  const app = createApp(deps, process.env as Record<string, unknown>);

  if (usesLocalDisk) {
    if (!existsSync(mediaRoot)) mkdirSync(mediaRoot, { recursive: true });
    // الصور تُخدَم من خارج البادئة api/v1: روابطها تُحفظ في القاعدة وتبقى ثابتة
    app.use(`${mediaPublicBase}/*`, serveStatic({ root: '.', rewriteRequestPath: (p) => `${mediaRoot}${p.slice(mediaPublicBase.length)}` }));
  }

  /* دورات دورية على Node وحده: على Cloudflare تقوم بها مهام Cron
     المعرَّفة في wrangler.jsonc، ولا مؤقّتات في Worker أصلاً. */
  const sweepMs = Number(process.env.SWEEP_INTERVAL_MS ?? 60_000);
  if (process.env.SWEEP_DISABLED !== '1') {
    setInterval(() => { void deps.sweeper.sweep().catch(() => {}); }, sweepMs).unref?.();
  }
  const alertsMs = Number(process.env.ALERTS_INTERVAL_MS ?? 300_000);
  if (process.env.ALERTS_DISABLED !== '1') {
    setInterval(() => { void deps.alerts.scan().catch(() => {}); }, alertsMs).unref?.();
  }

  serve({ fetch: app.fetch, port: PORT, hostname: '0.0.0.0' });
  console.log(`API على http://localhost:${PORT}/api/v1`);
  if (usesLocalDisk) {
    console.log(`الصور على القرص: ${mediaRoot} — لنسخة خادم واحدة فقط.`);
    console.log('عند تشغيل أكثر من نسخة اضبط S3_ENDPOINT وإلا لم ترَ كل نسخة صور الأخرى.');
  }
}

bootstrap();
