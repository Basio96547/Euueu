/* ————— pnpm exam —————
 *
 * يطبع التقرير، ويكتب `exam-baseline.json` عند طلبه صراحةً بـ `--save`. الفصل
 * مقصود: الحفظ التلقائي يجعل كل تشغيلٍ يُثبّت السقوط الجديد أساساً جديداً، فلا
 * يبقى شيءٌ يحرس.
 */

import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { runExam, formatReport, baselineOf } from '../src/brain/exam/run.js';

const report = await runExam();
console.log(formatReport(report));

if (process.argv.includes('--save')) {
  const path = resolve(process.cwd(), 'exam-baseline.json');
  await writeFile(path, `${JSON.stringify(baselineOf(report), null, 2)}\n`, 'utf8');
  console.log(`\nحُفظ الأساس في ${path}`);
}
