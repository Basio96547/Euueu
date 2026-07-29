import { createHash } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { Errors } from '../common/errors.js';

/**
 * تخزين الصور.
 *
 * سائقان بواجهة واحدة: قرص محلي حين لا يُضبط S3، وS3 حين يُضبط.
 * المتجر الصغير يبدأ بقرص الخادم ولا يُجبَر على تشغيل MinIO ليضيف صورة،
 * والانتقال لاحقاً يغيّر متغيّر بيئة لا شيفرة.
 *
 * القرص المحلي ليس حلاً دائماً: نسخة ثانية من الخادم لن ترى صور الأولى.
 * لذلك يُطبع تحذير عند الإقلاع بدل أن يُكتشف الأمر يوم التوسّع.
 */
const ROOT = resolve(process.env.MEDIA_DIR ?? './media');
const PUBLIC_BASE = process.env.MEDIA_PUBLIC_BASE ?? '/media';
const MAX_BYTES = Number(process.env.MEDIA_MAX_BYTES ?? 3 * 1024 * 1024);

/** أنواع الصور المقبولة وبصماتها الأولى */
const SIGNATURES: Array<{ ext: string; mime: string; test: (b: Buffer) => boolean }> = [
  { ext: '.jpg', mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: '.png', mime: 'image/png', test: (b) => b.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' },
  { ext: '.webp', mime: 'image/webp', test: (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
  { ext: '.gif', mime: 'image/gif', test: (b) => b.subarray(0, 3).toString() === 'GIF' },
];

export interface StoredMedia { url: string; key: string; bytes: number; mime: string }

/**
 * النوع يُقرأ من محتوى الملف لا من امتداده ولا من ترويسة العميل.
 * ملفٌ اسمه ‎.jpg‎ قد يكون سكربتاً، والثقة بالاسم أقدم ثغرة رفع في الوجود.
 */
function sniff(buf: Buffer) {
  const hit = SIGNATURES.find((s) => s.test(buf));
  if (!hit) {
    throw Errors.badRequest('MEDIA_TYPE_UNSUPPORTED',
      'الصورة يجب أن تكون JPEG أو PNG أو WebP أو GIF',
      'Unsupported image type');
  }
  return hit;
}

export function decodeDataUrl(dataUrl: string): Buffer {
  const m = /^data:([\w/+.-]+);base64,(.+)$/s.exec(dataUrl.trim());
  if (!m) {
    throw Errors.badRequest('MEDIA_PAYLOAD_INVALID',
      'الصورة تُرسل كـ data URL بترميز base64', 'Expected base64 data URL');
  }
  const buf = Buffer.from(m[2]!, 'base64');
  if (buf.length === 0) {
    throw Errors.badRequest('MEDIA_EMPTY', 'الملف فارغ', 'Empty file');
  }
  if (buf.length > MAX_BYTES) {
    throw Errors.badRequest('MEDIA_TOO_LARGE',
      `الحد الأقصى ${Math.round(MAX_BYTES / 1024 / 1024)} ميغابايت — اضغط الصورة أولاً`,
      'File too large');
  }
  return buf;
}

export async function putImage(dataUrl: string, prefix = 'products'): Promise<StoredMedia> {
  const buf = decodeDataUrl(dataUrl);
  const kind = sniff(buf);

  /* الاسم من بصمة المحتوى: الصورة نفسها لا تُخزَّن مرتين مهما رُفعت،
     ورفعُ صورة باسم موجود لا يدهس صورة منتج آخر. */
  const digest = createHash('sha256').update(buf).digest('hex').slice(0, 32);
  const key = `${prefix}/${digest}${kind.ext}`;
  const dest = join(ROOT, key);

  await mkdir(join(ROOT, prefix), { recursive: true });
  await writeFile(dest, buf);

  return { url: `${PUBLIC_BASE}/${key}`, key, bytes: buf.length, mime: kind.mime };
}

export async function deleteImage(url: string): Promise<boolean> {
  if (!url.startsWith(`${PUBLIC_BASE}/`)) return false;   // رابط خارجي: ليس لنا حذفه
  const key = url.slice(PUBLIC_BASE.length + 1);
  // منع الخروج من الجذر: «..» في المفتاح يمحو ملفات النظام
  const dest = resolve(ROOT, key);
  if (!dest.startsWith(ROOT)) return false;
  try { await unlink(dest); return true; } catch { return false; }
}

export const mediaRoot = ROOT;
export const mediaPublicBase = PUBLIC_BASE;
export const usesLocalDisk = !process.env.S3_ENDPOINT || process.env.MEDIA_DRIVER === 'local';
export { extname };
