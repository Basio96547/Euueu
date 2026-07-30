import { Errors } from '../common/errors.js';

/**
 * تخزين الصور على Cloudflare R2.
 *
 * كان سائقان: قرص الخادم المحلي وS3. وكلاهما مات مع انتقال الواجهة إلى
 * Worker — لا قرص هناك أصلاً، وS3 يعني مفاتيح تُدار وتُدوَّر بلا داعٍ
 * وربط R2 في متناول اليد. فحُذف الميت وبقي واحد.
 *
 * الصور تُخدَم من الـWorker نفسه على ‎/media/*‎، فروابطها المخزَّنة في
 * القاعدة تبقى ثابتة كما كانت.
 */

const PUBLIC_BASE = '/media';
const MAX_BYTES = 3 * 1024 * 1024;

/** الشكل الأدنى من ربط R2 — بلا استيراد أنواع Cloudflare */
export interface R2Binding {
  put(key: string, value: ArrayBuffer | Uint8Array, options?: {
    httpMetadata?: { contentType?: string };
  }): Promise<unknown>;
  get(key: string): Promise<{ body: unknown; httpMetadata?: { contentType?: string } } | null>;
  delete(key: string): Promise<void>;
}

/** أنواع الصور المقبولة وبصماتها الأولى */
const SIGNATURES: Array<{ ext: string; mime: string; test: (b: Uint8Array) => boolean }> = [
  { ext: '.jpg', mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: '.png', mime: 'image/png', test: (b) => hex(b, 0, 8) === '89504e470d0a1a0a' },
  { ext: '.webp', mime: 'image/webp', test: (b) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP' },
  { ext: '.gif', mime: 'image/gif', test: (b) => ascii(b, 0, 3) === 'GIF' },
];

const hex = (b: Uint8Array, from: number, to: number) =>
  [...b.slice(from, to)].map((n) => n.toString(16).padStart(2, '0')).join('');
const ascii = (b: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...b.slice(from, to));

export interface StoredMedia { url: string; key: string; bytes: number; mime: string }

/**
 * النوع يُقرأ من محتوى الملف لا من امتداده ولا من ترويسة العميل.
 * ملفٌ اسمه ‎.jpg‎ قد يكون سكربتاً، والثقة بالاسم أقدم ثغرة رفع في الوجود.
 */
function sniff(buf: Uint8Array) {
  const hit = SIGNATURES.find((s) => s.test(buf));
  if (!hit) {
    throw Errors.badRequest('MEDIA_TYPE_UNSUPPORTED',
      'الصورة يجب أن تكون JPEG أو PNG أو WebP أو GIF',
      'Unsupported image type');
  }
  return hit;
}

export function decodeDataUrl(dataUrl: string): Uint8Array {
  const m = /^data:([\w/+.-]+);base64,(.+)$/s.exec(dataUrl.trim());
  if (!m) {
    throw Errors.badRequest('MEDIA_PAYLOAD_INVALID',
      'الصورة تُرسل كـ data URL بترميز base64', 'Expected base64 data URL');
  }
  const binary = atob(m[2]!);
  const buf = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);

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

async function sha256Hex(buf: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buf as unknown as ArrayBuffer);
  return [...new Uint8Array(digest)].map((n) => n.toString(16).padStart(2, '0')).join('');
}

export async function putImage(
  bucket: R2Binding | undefined,
  dataUrl: string,
  prefix = 'products',
): Promise<StoredMedia> {
  if (!bucket) {
    throw Errors.badRequest('MEDIA_BUCKET_MISSING',
      'تخزين الصور غير مربوط بهذا الـWorker — راجع r2_buckets في wrangler.jsonc',
      'R2 bucket binding is missing');
  }
  const buf = decodeDataUrl(dataUrl);
  const kind = sniff(buf);

  /* الاسم من بصمة المحتوى: الصورة نفسها لا تُخزَّن مرتين مهما رُفعت،
     ورفعُ صورة باسم موجود لا يدهس صورة منتج آخر. */
  const digest = (await sha256Hex(buf)).slice(0, 32);
  const key = `${prefix}/${digest}${kind.ext}`;

  await bucket.put(key, buf, { httpMetadata: { contentType: kind.mime } });
  return { url: `${PUBLIC_BASE}/${key}`, key, bytes: buf.length, mime: kind.mime };
}

export async function deleteImage(bucket: R2Binding | undefined, url: string): Promise<boolean> {
  if (!bucket) return false;
  if (!url.startsWith(`${PUBLIC_BASE}/`)) return false;   // رابط خارجي: ليس لنا حذفه
  const key = url.slice(PUBLIC_BASE.length + 1);
  if (key.includes('..')) return false;                   // مفتاحٌ يحاول الخروج من مجاله
  try { await bucket.delete(key); return true; } catch { return false; }
}

export const mediaPublicBase = PUBLIC_BASE;
