/* ————— أيقونة زبير مولَّدة من الصفر —————
 *
 * لا مكتبة صور ولا ملف جاهز: نكتب ترميز PNG بأنفسنا — التوقيع، وقطعة IHDR،
 * وIDAT مضغوطة بـ zlib، وIEND، وCRC32 بجدول نبنيه بيدنا.
 *
 * ولماذا لا SVG وهو أسهل؟ لأن أندرويد يطلب PNG لأيقونة الشاشة الرئيسية، وبلا
 * أيقونة صحيحة لا يصير التطبيق تطبيقاً بل صفحة في متصفّح. وبلا مكتبة يبقى
 * المشروع خالياً من التبعيات كما هو دماغه: كل شيء مكتوب هنا.
 *
 * الشكل: بذرة تنبت — لأن زبير يبدأ نواةً لا يعرف شيئاً ثم ينمو بما تعلّمه.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/* ————— ترميز PNG ————— */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new Uint8Array(4);
  for (let i = 0; i < 4; i++) typeBytes[i] = type.charCodeAt(i);
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes, 0);
  body.set(data, 4);

  const out = new Uint8Array(4 + body.length + 4);
  writeUint32(out, 0, data.length);
  out.set(body, 4);
  writeUint32(out, 4 + body.length, crc32(body));
  return out;
}

function writeUint32(target: Uint8Array, offset: number, value: number): void {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}

export interface Bitmap {
  width: number;
  height: number;
  /** أربع قنوات لكل بكسل: أحمر وأخضر وأزرق وشفافية */
  pixels: Uint8Array;
}

export function encodePng(bitmap: Bitmap): Uint8Array {
  const { width, height, pixels } = bitmap;

  const ihdr = new Uint8Array(13);
  writeUint32(ihdr, 0, width);
  writeUint32(ihdr, 4, height);
  ihdr[8] = 8;  // ثمانية بتات لكل قناة
  ihdr[9] = 6;  // نوع اللون: RGBA
  ihdr[10] = 0; // الضغط: deflate — الوحيد المسموح في المواصفة
  ihdr[11] = 0; // الترشيح: قياسي
  ihdr[12] = 0; // بلا تشابك

  /* كل سطر يُصدَّر ببايت المرشّح. نستخدم صفراً (بلا ترشيح) لأن الصورة صغيرة
   * وأنماطها مسطّحة، فالترشيح لا يوفّر ما يستحقّ تعقيده. */
  const raw = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4);
    raw[rowStart] = 0;
    raw.set(pixels.subarray(y * width * 4, (y + 1) * width * 4), rowStart + 1);
  }

  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const parts = [
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', new Uint8Array(deflateSync(raw, { level: 9 }))),
    chunk('IEND', new Uint8Array(0)),
  ];

  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const png = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    png.set(part, offset);
    offset += part.length;
  }
  return png;
}

/* ————— الرسم ————— */

type Rgb = [number, number, number];

const BACKGROUND: Rgb = [0x0d, 0x1b, 0x1e]; // نفس theme_color فلا يظهر إطار مختلف
const SEED: Rgb = [0xf2, 0xc1, 0x4e];       // ذهبي دافئ: بذرة
const LEAF: Rgb = [0x4e, 0xc9, 0x8a];       // أخضر: نبت

function bitmap(size: number): Bitmap {
  return { width: size, height: size, pixels: new Uint8Array(size * size * 4) };
}

function fill(target: Bitmap, color: Rgb): void {
  for (let i = 0; i < target.pixels.length; i += 4) {
    target.pixels[i] = color[0];
    target.pixels[i + 1] = color[1];
    target.pixels[i + 2] = color[2];
    target.pixels[i + 3] = 255;
  }
}

/** يمزج لوناً في بكسل بشفافية — به تنعم الحدود فلا تظهر مسنّنة. */
function blend(target: Bitmap, x: number, y: number, color: Rgb, alpha: number): void {
  if (x < 0 || y < 0 || x >= target.width || y >= target.height || alpha <= 0) return;
  const a = alpha > 1 ? 1 : alpha;
  const index = (y * target.width + x) * 4;
  for (let c = 0; c < 3; c++) {
    const existing = target.pixels[index + c]!;
    target.pixels[index + c] = Math.round(existing * (1 - a) + color[c]! * a);
  }
  target.pixels[index + 3] = 255;
}

/**
 * قطع ناقص مائل. نحسب لكل بكسل مسافته المعيارية من المركز، ونمزج على الحدّ
 * بتدريج بعرض بكسل واحد — هذا هو التنعيم (anti-aliasing) بأبسط صوره، وبلاه
 * تظهر الأيقونة مسنّنة على شاشة الجوال عالية الكثافة.
 */
function ellipse(target: Bitmap, cx: number, cy: number, rx: number, ry: number, rotation: number, color: Rgb): void {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const reach = Math.ceil(Math.max(rx, ry)) + 2;

  for (let y = Math.floor(cy - reach); y <= Math.ceil(cy + reach); y++) {
    for (let x = Math.floor(cx - reach); x <= Math.ceil(cx + reach); x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const u = (dx * cos + dy * sin) / rx;
      const v = (-dx * sin + dy * cos) / ry;
      const distance = Math.sqrt(u * u + v * v);
      const edge = 1.5 / Math.min(rx, ry);
      if (distance <= 1 - edge) blend(target, x, y, color, 1);
      else if (distance < 1 + edge) blend(target, x, y, color, (1 + edge - distance) / (2 * edge));
    }
  }
}

/** ساق منحنية: نرسم دوائر صغيرة على طول منحنى بيزييه تربيعي. */
function stem(target: Bitmap, x0: number, y0: number, cx: number, cy: number, x1: number, y1: number, width: number, color: Rgb): void {
  const steps = 220;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const inverse = 1 - t;
    const x = inverse * inverse * x0 + 2 * inverse * t * cx + t * t * x1;
    const y = inverse * inverse * y0 + 2 * inverse * t * cy + t * t * y1;
    // الساق تنحف كلما ارتفعت، كما ينحف ساق نبتة حقيقية
    ellipse(target, x, y, width * (1 - 0.35 * t), width * (1 - 0.35 * t), 0, color);
  }
}

/**
 * بذرة تنبت.
 *
 * `safe` هو نسبة المنطقة الآمنة: أيقونة maskable قد يقصّها أندرويد إلى دائرة،
 * فيجب أن يبقى الشكل داخل ثمانين بالمئة الوسطى وإلا قُصّت أطرافه.
 */
export function drawSeedling(size: number, safe = 1): Bitmap {
  const canvas = bitmap(size);
  fill(canvas, BACKGROUND);

  const unit = (size / 100) * safe;
  const cx = size / 2;
  const groundY = size * 0.72;

  // البذرة: قطع ناقص مائل قليلاً كأنها مغروسة
  ellipse(canvas, cx, groundY, 17 * unit, 21 * unit, 0.18, SEED);

  // شقّ البذرة: خطّ داكن يفصل فلقتيها
  ellipse(canvas, cx, groundY, 1.6 * unit, 19 * unit, 0.18, BACKGROUND);

  // الساق تصعد من البذرة
  stem(canvas, cx, groundY - 14 * unit, cx - 3 * unit, groundY - 30 * unit, cx + 1 * unit, size * 0.2, 2.6 * unit, LEAF);

  // ورقتان: واحدة لكل جهة، بميل متعاكس
  ellipse(canvas, cx - 11 * unit, groundY - 30 * unit, 11 * unit, 5.5 * unit, -0.55, LEAF);
  ellipse(canvas, cx + 11 * unit, groundY - 38 * unit, 11 * unit, 5.5 * unit, 0.55, LEAF);

  return canvas;
}

/* ————— التوليد ————— */

const OUTPUTS: Array<{ file: string; size: number; safe: number }> = [
  { file: 'public/icon-192.png', size: 192, safe: 1 },
  { file: 'public/icon-512.png', size: 512, safe: 1 },
  // الأيقونة القابلة للقصّ: الشكل مضغوط في المنطقة الآمنة كي لا تُقصّ أطرافه
  { file: 'public/icon-maskable-512.png', size: 512, safe: 0.72 },
];

export function generateIcons(root: string): Array<{ file: string; bytes: number }> {
  const written: Array<{ file: string; bytes: number }> = [];
  for (const target of OUTPUTS) {
    const png = encodePng(drawSeedling(target.size, target.safe));
    const path = resolve(root, target.file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, png);
    written.push({ file: target.file, bytes: png.length });
  }
  return written;
}

// يُشغَّل مباشرة: pnpm icons
if (process.argv[1] && process.argv[1].endsWith('make-icons.ts')) {
  const root = resolve(dirname(process.argv[1]), '..');
  for (const written of generateIcons(root)) {
    console.log(`${written.file} — ${(written.bytes / 1024).toFixed(1)} كيلوبايت`);
  }
}
