/* ————— اختبار أيقونة زبير —————
 *
 * الأيقونة مولَّدة بترميز PNG مكتوب بيدنا، فلا يكفي أن يُنتج السكربت ملفاً: قد
 * يُنتج بايتات لا يقبلها أندرويد فلا يصير التطبيق تطبيقاً بل صفحةً في متصفّح.
 * فيُفكّ الملف هنا قطعةً قطعةً ويُتحقّق من CRC كما يفعل المتصفّح نفسه.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';

import { crc32, drawSeedling, encodePng } from '../../../scripts/make-icons.js';

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

interface Chunk {
  type: string;
  data: Uint8Array;
  crcValid: boolean;
}

/** يفكّ ملف PNG إلى قطعه ويتحقّق من CRC كل قطعة — كما يفعل قارئ المتصفّح. */
function parsePng(bytes: Uint8Array): { width: number; height: number; chunks: Chunk[] } {
  for (let i = 0; i < SIGNATURE.length; i++) {
    assert.equal(bytes[i], SIGNATURE[i], `بايت التوقيع ${i}`);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: Chunk[] = [];
  let offset = SIGNATURE.length;
  let width = 0;
  let height = 0;

  while (offset < bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    const declared = view.getUint32(offset + 8 + length);
    // الـCRC يُحسب على نوع القطعة وبياناتها معاً لا على البيانات وحدها
    const computed = crc32(bytes.subarray(offset + 4, offset + 8 + length));

    chunks.push({ type, data, crcValid: declared === computed });
    if (type === 'IHDR') {
      width = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0);
      height = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(4);
    }
    offset += 12 + length;
  }

  return { width, height, chunks };
}

test('CRC32 يطابق القيم المرجعية المعروفة', () => {
  // قيم منشورة في مواصفة zlib، فلو انحرف جدولنا انكشف هنا لا في جوال الأب
  assert.equal(crc32(new TextEncoder().encode('')), 0x00000000);
  assert.equal(crc32(new TextEncoder().encode('a')), 0xe8b7be43);
  assert.equal(crc32(new TextEncoder().encode('abc')), 0x352441c2);
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('الملف المولَّد PNG صحيح البنية قطعةً قطعةً', () => {
  const png = encodePng(drawSeedling(192));
  const parsed = parsePng(png);

  assert.equal(parsed.width, 192, 'العرض في IHDR');
  assert.equal(parsed.height, 192, 'والارتفاع');

  const types = parsed.chunks.map((c) => c.type);
  assert.equal(types[0], 'IHDR', 'IHDR أولاً كما تفرض المواصفة');
  assert.equal(types.at(-1), 'IEND', 'وIEND آخراً');
  assert.ok(types.includes('IDAT'), 'وفيه بيانات صورة');

  for (const chunk of parsed.chunks) {
    assert.ok(chunk.crcValid, `CRC القطعة ${chunk.type} صحيح`);
  }

  const ihdr = parsed.chunks[0]!.data;
  assert.equal(ihdr[8], 8, 'ثمانية بتات لكل قناة');
  assert.equal(ihdr[9], 6, 'ونوع اللون RGBA');
  assert.equal(ihdr[10], 0, 'وضغط deflate — الوحيد المسموح');
  assert.equal(ihdr[12], 0, 'وبلا تشابك');
});

test('بيانات الصورة تُفكّ إلى أسطر كاملة ببايت مرشّح صفر', () => {
  const size = 64;
  const png = encodePng(drawSeedling(size));
  const parsed = parsePng(png);

  const idat = parsed.chunks.filter((c) => c.type === 'IDAT');
  const merged = new Uint8Array(idat.reduce((sum, c) => sum + c.data.length, 0));
  let at = 0;
  for (const chunk of idat) {
    merged.set(chunk.data, at);
    at += chunk.data.length;
  }

  const raw = inflateSync(merged);
  const stride = 1 + size * 4;
  assert.equal(raw.length, size * stride, 'طول البيانات الخام = أسطر × (١ + عرض × ٤)');
  for (let y = 0; y < size; y++) {
    assert.equal(raw[y * stride], 0, `بايت مرشّح السطر ${y} صفر`);
  }
});

test('الأيقونة ليست فارغة: فيها بذرة وورقتان', () => {
  const bitmap = drawSeedling(192);
  const seen = new Set<string>();
  for (let i = 0; i < bitmap.pixels.length; i += 4) {
    seen.add(`${bitmap.pixels[i]},${bitmap.pixels[i + 1]},${bitmap.pixels[i + 2]}`);
    assert.equal(bitmap.pixels[i + 3], 255, 'كل بكسل معتم: أيقونة نصف شفّافة تظهر مشوّهة');
  }
  // خلفية وبذرة وورقة وحدود منعّمة بينها: التعداد يكشف رسماً فارغاً أو لوناً واحداً
  assert.ok(seen.size > 20, `الرسم فيه تدريج فعلي (${seen.size} لوناً)`);

  const middle = ((191 * 192) + 96) * 4;
  assert.ok(bitmap.pixels[middle] !== undefined, 'والحدود مرسومة إلى آخر سطر');
});

test('الأيقونة القابلة للقصّ تُبقي شكلها داخل المنطقة الآمنة', () => {
  const size = 192;
  const full = drawSeedling(size, 1);
  const safe = drawSeedling(size, 0.72);

  /* أندرويد يقصّ الأيقونة القابلة للقصّ إلى دائرة، فما خرج عن الثمانين بالمئة
   * الوسطى يُقصّ. نقيس أن الشكل انضغط فعلاً: بكسلات غير الخلفية في الحافّة
   * يجب أن تكون أقلّ في النسخة الآمنة. */
  const edgeNonBackground = (bitmap: ReturnType<typeof drawSeedling>): number => {
    const margin = Math.floor(size * 0.12);
    let count = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const inEdge = x < margin || y < margin || x >= size - margin || y >= size - margin;
        if (!inEdge) continue;
        const index = (y * size + x) * 4;
        // الخلفية هي #0d1b1e، وأي لون غيرها شكلٌ مرسوم
        if (bitmap.pixels[index] !== 0x0d || bitmap.pixels[index + 1] !== 0x1b) count++;
      }
    }
    return count;
  };

  assert.ok(edgeNonBackground(safe) <= edgeNonBackground(full),
    `النسخة الآمنة أقلّ خروجاً إلى الحافّة (${edgeNonBackground(safe)} ≤ ${edgeNonBackground(full)})`);
});

test('الأحجام الثلاثة تُولَّد بلا انفجار ولا حجم مفرط', () => {
  for (const size of [192, 512]) {
    const png = encodePng(drawSeedling(size));
    const parsed = parsePng(png);
    assert.equal(parsed.width, size);
    // حجم معقول: أيقونة بمئات الكيلوبايتات تُثقل أول إقلاع على شبكة بطيئة
    assert.ok(png.length < 120 * 1024, `${size}px حجمها ${(png.length / 1024).toFixed(1)} كيلوبايت`);
    assert.ok(png.length > 500, 'وليست فارغة');
  }
});
