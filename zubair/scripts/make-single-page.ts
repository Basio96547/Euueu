/* ————— نسخة صفحة واحدة —————
 *
 * يجمع البناء كله في ملف واحد: الأنماط والشيفرة مدمجتان في الصفحة نفسها بلا أي
 * طلب خارجي.
 *
 * ولماذا يلزم هذا: الاستضافة التي تُعطي الأب رابطاً يفتحه من جواله تمنع كل طلب
 * إلى مضيف آخر — لا ملف أنماط ولا شيفرة ولا خط. فما لم يكن في الصفحة لم يوجد.
 * وهذا يوافق زبير أصلاً: دماغه كله محلّي ولا يطلب من الشبكة شيئاً.
 *
 * وثلاثة أشياء تُنزَع بقصد:
 *   • إشارة خريطة المصدر: تُشير إلى ملف لن يُنشَر، فتُنتج طلباً فاشلاً في كل فتح
 *   • تسجيل عامل الخدمة: لا ملف له في صفحة واحدة، ولا تثبيت على الشاشة منها
 *   • وسوم الصفحة الخارجية: الغلاف يأتي من المستضيف لا منّا
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const root = resolve(dirname(process.argv[1] ?? '.'), '..');
const dist = resolve(root, 'dist');
const assets = resolve(dist, 'assets');

const files = readdirSync(assets);
const jsName = files.find((f) => f.endsWith('.js'));
const cssName = files.find((f) => f.endsWith('.css'));
if (!jsName || !cssName) throw new Error('لم يُوجد بناء: شغّل pnpm build أولاً');

const css = readFileSync(resolve(assets, cssName), 'utf8');
let js = readFileSync(resolve(assets, jsName), 'utf8');

// خريطة المصدر لن تُنشَر: إشارتها تُنتج طلباً فاشلاً في كل فتح للصفحة
js = js.replace(/\/\/#\s*sourceMappingURL=.*$/gm, '');

/* عامل الخدمة: لا وجود له في صفحة واحدة. نستبدل شرط التسجيل بشرط لا يتحقّق بدل
 * أن نحذف الكتلة، فيبقى الفرق بين النسختين سطراً واحداً يسهل تتبّعه. */
js = js.replace(/"serviceWorker"in navigator/g, 'false');
js = js.replace(/'serviceWorker'in navigator/g, 'false');

const page = `<title>زبير — طفل إلكتروني يتعلّم منك</title>
<meta name="description" content="طفل إلكتروني عربي يتعلّم منك وحدك: دماغه ثمانية عشر فصاً مبنيّة من الصفر، ويسكن جهازك ولا يخرج منه شيء." />

<style>
/* الصفحة تُلفّ في غلاف المستضيف، فنضبط الاتجاه والخطّ على جذرها لا على body */
:root {
  direction: rtl;
}
body {
  margin: 0;
  overflow: hidden;
}
${css}
</style>

<div id="root" dir="rtl" lang="ar"></div>

<script type="module">
${js}
</script>
`;

const out = resolve(root, 'dist', 'zubair-single-page.html');
writeFileSync(out, page, 'utf8');
console.log(`${out} — ${(page.length / 1024).toFixed(0)} كيلوبايت`);
