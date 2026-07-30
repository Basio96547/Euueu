/**
 * قياسُ تباين رموز اللون مقابل WCAG 2.2 AA.
 *
 * لم يكن في المشروع ما يقيسه، فسقط `--ink-3` في السمتين معاً بلا أن
 * ينتبه أحد — وهو اللون الذي يحمل السعر بالعملة الثانية، أي رقمَ مال.
 * والعين لا تحكم في هذا: فرقُ 3.7 عن 4.5 لا يُرى، ويُقاس.
 *
 * يقرأ القيم من tokens.css نفسه لا من نسخةٍ مكتوبة هنا — فنسخةٌ ثانية
 * تنحرف عن الأصل يوماً ما وتُطمئن كذباً.
 *
 *   node scripts/contrast.mjs          → يفشل إن سقط زوجٌ واجب
 *   node scripts/contrast.mjs --all    → يطبع كل الأزواج ولو نجحت
 */
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../packages/ui/src/tokens.css', import.meta.url), 'utf8');

/** الكتلة الأولى `:root{…}` هي النهارية، و`[data-theme="dark"]` الليلية */
function vars(block) {
  const out = {};
  for (const m of block.matchAll(/(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})/g)) out[m[1]] = m[2];
  return out;
}
/* الحدّ الأعلى للشريحة لازم: كتلة `[data-theme="light"]` تأتي بعد
   الليلية في الملف، وقراءةٌ حتى آخره تجعل قيمَ النهار تطمس قيمَ الليل —
   فيُقاس النهار مرّتين ويُقال إن الليل سليم. */
const between = (from, to) => {
  const i = css.indexOf(from);
  const j = to ? css.indexOf(to, i + 1) : -1;
  return css.slice(i, j > -1 ? j : undefined);
};
const light = vars(between(':root {', '@media (prefers-color-scheme: dark)'));
const dark = vars(between(':root[data-theme="dark"]', ':root[data-theme="light"]'));

const lum = (h) => {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

/* الأزواج التي تحمل نصّاً فعلياً في الواجهة. `min` ثلاثة للنصّ الكبير
   (١٨٫٦٦px عريض أو ٢٤px) وأربعةٌ ونصف لما دونه. */
const PAIRS = [
  ['--ink', '--surface', 4.5], ['--ink', '--ground', 4.5],
  ['--ink-2', '--surface', 4.5], ['--ink-2', '--ground', 4.5],
  ['--ink-3', '--surface', 4.5], ['--ink-3', '--ground', 4.5],
  ['--brass', '--surface', 4.5], ['--brass', '--ground', 4.5],
  ['--jade', '--surface', 4.5], ['--clay', '--surface', 4.5],
  ['--brass-ink', '--brass', 4.5],
];

const all = process.argv.includes('--all');
let bad = 0;
for (const [theme, v] of [['نهاري', light], ['ليلي', dark]]) {
  console.log(`\n── ${theme} ──`);
  for (const [fg, bg, min] of PAIRS) {
    if (!v[fg] || !v[bg]) continue;
    const r = ratio(v[fg], v[bg]);
    const ok = r >= min;
    if (!ok) bad++;
    if (all || !ok) {
      console.log(`  ${ok ? '✓' : '✗'} ${fg} على ${bg}: ${r.toFixed(2)}:1 (المطلوب ${min})`);
    }
  }
  if (!all) console.log(bad === 0 ? '  كلّها تمرّ ✓' : '');
}
console.log();
if (bad) { console.error(`✘ ${bad} زوجاً يسقط دون AA.`); process.exit(1); }
console.log('✓ كل الأزواج تمرّ WCAG AA.');
