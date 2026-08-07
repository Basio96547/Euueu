/* سُلّم صعوبة: عشرة مواقف يعرف أولها يقيناً ولا يعرف آخرها شيئاً.
 * السؤال الوحيد: هل يفرّق رقمُه بينها؟ */

import { Zubair } from '../src/brain/brain.js';
import { memoryStorage } from '../src/brain/core/persist.js';

const LADDER: Array<{ label: string; teach: string[]; ask: string }> = [
  { label: '١. مؤكَّد: علّمه أربع مرات', teach: ['الزقفوط نبات', 'الزقفوط نبات', 'الزقفوط نبات', 'الزقفوط نبات'], ask: 'شو الزقفوط؟' },
  { label: '٢. درسٌ واحد', teach: ['المرنجل أداة'], ask: 'شو المرنجل؟' },
  { label: '٣. ميراثٌ راسخ', teach: [], ask: 'شو التفاحة؟' },
  { label: '٤. ميراثٌ أدقّ', teach: [], ask: 'شو العصفور؟' },
  { label: '٥. عُلّم ثم نُوقض', teach: ['الخبنتر فاكهة', 'الخبنتر خضار'], ask: 'شو الخبنتر؟' },
  { label: '٦. يعرف جنسه لا صفته', teach: ['الشفنترة أداة'], ask: 'كيف الشفنترة؟' },
  { label: '٧. سلسلة: جدٌّ لا أب', teach: ['الفسطاق شفنترة', 'الشفنترة درقاوة'], ask: 'شو الفسطاق؟' },
  { label: '٨. لفظٌ لم يسمعه قط', teach: [], ask: 'شو البنغول؟' },
  { label: '٩. سببٌ لا يملكه', teach: [], ask: 'ليش البحر واسع؟' },
  { label: '١٠. رأيٌ لا يملكه', teach: [], ask: 'شو رأيك بالسياسة؟' },
];

const SEEDS = [0x5eed, 0x1379, 0x2b17];
const CLOCK = 1_700_000_000_000;

const rows: Array<{ label: string; mean: number; values: number[]; said: string; strategy: string }> = [];

for (const item of LADDER) {
  const values: number[] = [];
  let said = '';
  let strategy = '';
  for (const seed of SEEDS) {
    const z = await Zubair.create({ storage: memoryStorage(), seed, fresh: true, heritage: true });
    let clock = CLOCK;
    for (const line of item.teach) { await z.hear(line, clock); clock += 45_000; }
    const out = await z.hear(item.ask, clock);
    values.push(out.confidence);
    if (seed === SEEDS[0]) { said = out.text; strategy = out.strategy; }
  }
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  rows.push({ label: item.label, mean, values, said, strategy });
}

console.log('الموقف'.padEnd(30) + 'الثقة    المدى           قال');
for (const r of rows) {
  const lo = Math.min(...r.values), hi = Math.max(...r.values);
  console.log(
    r.label.padEnd(30)
    + r.mean.toFixed(3) + '   '
    + `[${lo.toFixed(3)}–${hi.toFixed(3)}]  `
    + r.said.slice(0, 34),
  );
}

const all = rows.map((r) => r.mean);
const lo = Math.min(...all), hi = Math.max(...all);
const mean = all.reduce((a, b) => a + b, 0) / all.length;
const sd = Math.sqrt(all.reduce((s, x) => s + (x - mean) ** 2, 0) / all.length);
console.log(`\nالمدى كله: ${lo.toFixed(3)} – ${hi.toFixed(3)}  (اتّساع ${(hi - lo).toFixed(3)})`);
console.log(`المتوسّط ${mean.toFixed(3)}، الانحراف المعياري ${sd.toFixed(3)}`);
console.log(`قيمٌ مميّزة: ${new Set(all.map((x) => x.toFixed(2))).size} من ${all.length}`);
