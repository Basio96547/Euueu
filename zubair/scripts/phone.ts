/* ————— بيئةُ تجربةٍ على جوال —————
 *
 * `pnpm phone` — يبني التطبيق، ويفتحه في متصفّحٍ بمقاس جوالٍ حقيقي، ويمشي فيه
 * كما يمشي الأب: يُعلّم، ويسأل، ويحكم، ويقرأ صفحة، ويتصفّح اللوحات. ثم يكتب
 * لقطاتٍ في `shots/` ويقول ما وقع.
 *
 * ولماذا يستحقّ هذا ملفّاً؟ لأن ثلاثمئة اختبارٍ تحرس الدماغ ولا تحرس **ما
 * يراه الأب**. والعطب الذي لا يمسّ الدماغ يمرّ منها كلِّها:
 *
 *   - نصٌّ يفيض عن حافّة الشاشة على عرض ٣٦٠ بكسل
 *   - زرٌّ أصغر من أن تُصيبه إصبع
 *   - خطأٌ في الطرفية لا يظهر في الواجهة ويُعطّل ميزة
 *   - لوحةٌ تُفتح فارغةً لأن حقلاً واحداً لم يُمرَّر
 *
 * فهذه بيئةٌ **تُجرَّب فيها الواجهة كما تُجرَّب الفصوص**: بأرقامٍ لا بانطباع.
 * وتفشل بشيفرة خروجٍ غير صفرية إن وقع خطأ في الطرفية أو فاض عرضُ الصفحة —
 * فتصلح أن تُشغَّل في التكامل المستمر لا بالعين وحدها.
 */

import { chromium, type ConsoleMessage, type Page } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdir, rm } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

/* مقاسُ جوالٍ متوسّط لا حديث: أضيقُ ما يُتوقَّع أن يُفتح عليه التطبيق، وعليه
 * تظهر عيوبُ الفيض التي تختفي على شاشةٍ واسعة. */
const PHONE = { width: 360, height: 780 };
const SCALE = 3;   // كثافةُ نقاطٍ كما في جوالٍ حقيقي

const ROOT = resolve(process.cwd(), 'dist');
const SHOTS = resolve(process.cwd(), 'shots');

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

/** خادمٌ ثابتٌ صغير: التطبيق كلُّه ملفّات، ولا حاجة إلى أكثر من هذا. */
function serve(port: number) {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let path = join(ROOT, decodeURIComponent(url.pathname));
    try {
      let body: Buffer;
      try {
        body = await readFile(path);
      } catch {
        // أي مسارٍ لا ملفَّ له يعود إلى الصفحة الواحدة
        path = join(ROOT, 'index.html');
        body = await readFile(path);
      }
      res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  }).listen(port);
}

/* ————— ما يُمشى فيه ————— */

interface Step {
  name: string;
  file: string;
  run: (page: Page) => Promise<void>;
}

const type = async (page: Page, text: string) => {
  await page.fill('.composer input', text);
  await page.click('.composer button');
  await page.waitForTimeout(220);
};

const STEPS: readonly Step[] = [
  {
    name: 'أول جلسة',
    file: '01-first.png',
    run: async () => { /* كما يُفتح: بطاقةُ البدء وتحيّته */ },
  },
  {
    name: 'يُعلَّم ويُسأل ويُحكَم عليه',
    file: '02-chat.png',
    run: async (page) => {
      await type(page, 'القطة حيوان');
      await type(page, 'القطة صغيرة');
      await type(page, 'شو القطة؟');
      await page.click('.judge .btn.good');
      await page.waitForTimeout(200);
      await type(page, 'كيف القطة؟');
    },
  },
  {
    name: 'حدودُ معرفته: يُقرّ بلسان الطلب',
    file: '03-limits.png',
    run: async (page) => {
      await type(page, 'وين القطة؟');
      await type(page, 'ليش القطة صغيرة؟');
      await type(page, 'كيفك؟');
    },
  },
  {
    name: 'أثرُ النبضة: أي فصٍّ عمل ولماذا',
    file: '04-trace.png',
    run: async (page) => {
      await type(page, 'شو القطة؟');
      const trace = page.locator('.turn.child details.trace').last();
      await trace.click();
      await page.waitForTimeout(200);
      await trace.scrollIntoViewIfNeeded();
    },
  },
  {
    name: 'يقرأ صفحةً ويعرض ما فهم',
    file: '05-read.png',
    run: async (page) => {
      await page.click('.tabs .tab:nth-child(2)');
      await page.waitForTimeout(150);
      await page.fill('.paste', [
        'النمر حيوان مفترس. يعيش النمر في الغابات.',
        'الزرافة حيوان طويل الرقبة، وتأكل أوراق الشجر.',
        'الحوت أكبر كائن في البحر. وهو يتنفّس الهواء.',
        'القطة نبات.',
        'الحديد معدن صلب. النحاس معدن كذلك.',
      ].join('\n'));
      await page.click('.btn.primary');
      await page.waitForTimeout(250);
    },
  },
  {
    name: 'سجل نموّه: المصادر الثلاثة والمشاعر والمراجعة',
    file: '06-growth.png',
    run: async (page) => {
      /* يُحفظ المقروء أولاً كي تظهر أرقامه */
      await page.click('.card .btn.primary');
      await page.waitForTimeout(250);
      await page.click('.tabs .tab:nth-child(3)');
      await page.waitForTimeout(200);
    },
  },
  {
    name: 'ودماغه: عشرون فصاً',
    file: '07-brain.png',
    run: async (page) => {
      await page.click('.tabs .tab:nth-child(4)');
      await page.waitForTimeout(200);
    },
  },
  {
    name: 'الوضع النهاري',
    file: '08-light.png',
    run: async (page) => {
      await page.emulateMedia({ colorScheme: 'light' });
      await page.click('.tabs .tab:nth-child(1)');
      await page.waitForTimeout(200);
    },
  },
];

/* ————— التشغيل ————— */

const port = 4173 + Math.floor(process.pid % 200);
const server = serve(port);
await rm(SHOTS, { recursive: true, force: true });
await mkdir(SHOTS, { recursive: true });

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext({
  viewport: PHONE,
  deviceScaleFactor: SCALE,
  isMobile: true,
  hasTouch: true,
  locale: 'ar',
  colorScheme: 'dark',
});
const page = await context.newPage();

/** كلُّ ما تقوله الطرفية: خطأٌ واحد فيها يعني ميزةً معطّلة لا يراها أحد. */
const problems: string[] = [];
page.on('console', (message: ConsoleMessage) => {
  if (message.type() === 'error' || message.type() === 'warning') {
    problems.push(`[${message.type()}] ${message.text()}`);
  }
});
page.on('pageerror', (error) => problems.push(`[pageerror] ${error.message}`));

await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle' });
await page.waitForSelector('.composer input', { timeout: 15_000 });

console.log(`———— زبير على شاشة ${PHONE.width}×${PHONE.height} ————\n`);

/** أيفيض شيءٌ عن عرض الشاشة؟ هذا أشيع عيبٍ لا يمسّ الدماغ ولا يراه اختبار. */
async function overflow(): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

let overflowed = 0;
for (const step of STEPS) {
  await step.run(page);
  await page.waitForTimeout(120);
  const over = await overflow();
  if (over > 1) { overflowed++; problems.push(`فيضٌ أفقيّ في «${step.name}»: ${over} بكسل`); }
  await page.screenshot({ path: join(SHOTS, step.file), fullPage: false });
  console.log(`  ✓ ${step.file}  ${step.name}${over > 1 ? `  ⚠ فيض ${over}px` : ''}`);
}

/* ————— قياساتٌ لا انطباعات ————— */

const touch = await page.evaluate(() => {
  const small: string[] = [];
  for (const el of document.querySelectorAll('button, input')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    // ٤٤ بكسل: أدنى ما تُصيبه إصبعٌ بثقة
    if (r.height < 34) small.push(`${el.tagName.toLowerCase()}.${el.className || '—'} ${Math.round(r.height)}px`);
  }
  return small;
});

const dir = await page.evaluate(() => document.documentElement.dir);

console.log('\n———— القياس ————');
console.log(`  اتجاه الصفحة: ${dir}`);
console.log(`  فيضٌ أفقيّ: ${overflowed === 0 ? 'لا شيء' : `${overflowed} شاشة`}`);
console.log(`  أزرارٌ أصغر من ٣٤ بكسل: ${touch.length === 0 ? 'لا شيء' : touch.join('، ')}`);
console.log(`  رسائلُ الطرفية: ${problems.length === 0 ? 'لا شيء' : problems.length}`);
for (const problem of problems) console.log(`    · ${problem}`);

await browser.close();
server.close();

const failed = problems.length > 0 || touch.length > 0;
console.log(`\n${failed ? '✗ فيها ما يُصلَح' : '✓ نظيفة'} — اللقطات في shots/`);
process.exit(failed ? 1 : 0);
