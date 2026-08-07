/* pnpm ownership — يطبع الجدول كما هو في الشيفرة، فلا يُقرأ من وصفٍ يتقادم. */

import { formatTable, OWNERSHIP } from '../src/brain/core/ownership.js';

console.log('———— جدول الملكية ————\n');
console.log(formatTable());
console.log(`\n${OWNERSHIP.length} صفاً · ${new Set(OWNERSHIP.map((r) => r.ownerAr)).size} مالكاً`);
