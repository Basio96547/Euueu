/* ————— قراءة نصّ الـPDF من الصفر —————
 *
 * بلا مكتبة، كما بُني كلُّ شيء في هذا الدماغ. وفكُّ الضغط وحده يأتي من
 * المتصفّح (`DecompressionStream`) لأنه فيه أصلاً، ولا معنى لكتابة zlib بيدٍ
 * حين يكون في كل جهازٍ نسخةٌ مُحسَّنة منه.
 *
 * ———— وحدودُه تُقال قبل مزاياه ————
 *
 * الـPDF ليس صيغة نصّ: هو **أوامرُ طباعة**. الملف يقول «ضع هذا الرمز في هذا
 * الموضع بهذا الخطّ»، ولا يقول «هذه كلمة». فاستخراجُ النصّ منه استنتاجٌ لا
 * قراءة، ويسقط في ثلاث حالاتٍ شائعة — والعربية أسوأ ما يقع فيها:
 *
 *  ١) **ملفٌّ مصوَّر** (صفحاتٌ ممسوحة ضوئياً): لا نصَّ فيه أصلاً، بل صورة.
 *     ولا يُقرأ بحال إلا بتعرّفٍ ضوئي على الحروف، وذاك مشروعٌ آخر كامل.
 *  ٢) **خطٌّ مُضمَّن بترميزٍ خاص** بلا خريطة `ToUnicode`: الرموز في الملف
 *     أرقامُ أشكالٍ في الخطّ لا حروفاً، فتخرج حروفاً مبعثرة. وهذا شائعٌ جداً
 *     في الملفات العربية.
 *  ٣) **العربية المتّصلة**: بعض المولِّدات تكتب الأشكال المتّصلة (ـعـ، ـع)
 *     بدل الحروف الأصلية، فتخرج كلماتٌ لا يعرفها معجمُه. ويُعالَج ما شاع منها
 *     بردّ الأشكال إلى أصولها أدناه.
 *
 * فالقاعدة الحاكمة هنا: **يُقال العجز ولا يُبتلَع الملف صامتاً**. صفحةٌ لا
 * تُقرأ تُحسب وتُعرَض، ونتيجةٌ فارغة تقول لماذا فرغت. وأسوأ ما يمكن أن يفعله
 * هذا الملف أن يُخرج ركاماً من الحروف فيبدو أنه قرأ.
 */

/** ما خرج من الملف، ولماذا لم يخرج أكثر. */
export interface PdfText {
  text: string;
  /** كم صفحةً وُجدت */
  pages: number;
  /** وكم منها أخرجت نصّاً */
  pagesWithText: number;
  /** سببُ العجز بالعربية إن كان الناتج فارغاً أو ضئيلاً */
  warningAr: string | null;
}

/* ————— أدوات ثنائية ————— */

const enc = new TextDecoder('latin1');

function bytesToLatin(bytes: Uint8Array): string {
  return enc.decode(bytes);
}

/** فكُّ ضغط `FlateDecode` عبر المتصفّح. ويُرجِع null لما لا يُفكّ. */
async function inflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  const G = globalThis as { DecompressionStream?: new (f: string) => TransformStream };
  if (!G.DecompressionStream) return null;
  for (const format of ['deflate', 'deflate-raw'] as const) {
    try {
      const stream = new Response(
        new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(new G.DecompressionStream(format)),
      );
      return new Uint8Array(await stream.arrayBuffer());
    } catch { /* الصيغة الأخرى */ }
  }
  return null;
}

/* ————— الأشكال المتّصلة —————
 *
 * بعض المولِّدات تكتب صورة الحرف في موضعه (أوّلية، وسطى، نهائية) بدل الحرف
 * نفسه، فتخرج كلمةٌ لا يعرفها المعجم. والمدى `FE70–FEFF` هو مدى هذه الأشكال
 * في يونيكود، وردُّها إلى أصولها تحويلٌ معياريّ يقوم به المتصفّح نفسه.
 */
function unshape(text: string): string {
  /* NFKD يفكّ الأشكال إلى حروفها الأصلية، ويفكّ اللام-ألف إلى حرفين. */
  const normalized = text.normalize('NFKD');
  // ثم تُحذف علامات التشكيل المنفصلة التي خلّفها الفكّ
  return normalized.replace(/[ؐ-ًؚ-ٰٟۖ-ۭ]/g, '');
}

/* ————— قراءة السلاسل من مجرى المحتوى —————
 *
 * أوامر النصّ في الـPDF ثلاثة تهمّنا: `Tj` تطبع سلسلة، و`TJ` تطبع مصفوفةً
 * من سلاسل وأرقامِ تباعد، و`'`/`"` تطبعان بعد سطرٍ جديد. وما عداها أوامرُ
 * رسمٍ لا نصّ فيها.
 */
function textFromContent(content: string): string {
  const out: string[] = [];
  /* السلسلة بين قوسين، والهروب `\(` و`\)` و`\\` يمنع القوس من إنهائها.
   * والسلسلة الستّ عشرية بين `<` و`>` تُقرأ رموزاً من محرفين أو أربعة. */
  const TEXT_OP = /(\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]*>)\s*(?:TJ|Tj|'|")|\[((?:[^\]\\]|\\.)*)\]\s*TJ|(T\*|Td|TD|ET)/g;
  let match: RegExpExecArray | null;
  while ((match = TEXT_OP.exec(content)) !== null) {
    if (match[3]) { out.push('\n'); continue; }
    const single = match[1];
    if (single) { out.push(decodeString(single)); continue; }
    const array = match[2];
    if (array) {
      const PARTS = /(\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]*>)|(-?\d+(?:\.\d+)?)/g;
      let part: RegExpExecArray | null;
      while ((part = PARTS.exec(array)) !== null) {
        if (part[1]) out.push(decodeString(part[1]));
        /* تباعدٌ سالبٌ كبير يعني فراغاً بين كلمتين. والعتبة عُرفية في كل
         * قارئ — دونها تلتصق الكلمات، وفوقها تتقطّع. */
        else if (part[2] && Number(part[2]) < -140) out.push(' ');
      }
    }
  }
  return out.join('');
}

const ESCAPES: Record<string, string> = {
  n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\',
};

function decodeString(token: string): string {
  if (token.startsWith('<')) {
    const hex = token.slice(1, -1).replace(/\s+/g, '');
    /* الرموز الستّ عشرية غالباً UTF-16BE في الملفات التي تحمل خريطة يونيكود،
     * وهي وحدها التي تُخرج عربيةً صحيحة. */
    let out = '';
    for (let i = 0; i + 3 < hex.length; i += 4) {
      out += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
    }
    return out;
  }
  const body = token.slice(1, -1);
  let out = '';
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (ch !== '\\') { out += ch; continue; }
    const next = body[++i];
    if (next === undefined) break;
    if (ESCAPES[next] !== undefined) { out += ESCAPES[next]; continue; }
    if (next >= '0' && next <= '7') {
      let oct = next;
      while (oct.length < 3 && body[i + 1] && body[i + 1]! >= '0' && body[i + 1]! <= '7') oct += body[++i]!;
      out += String.fromCharCode(parseInt(oct, 8));
      continue;
    }
    out += next;
  }
  return out;
}

/* ————— الملف كلُّه ————— */

/** أيبدو هذا نصّاً عربياً مقروءاً؟ به يُعرَف أن الاستخراج نجح أو خرج ركاماً. */
function looksArabic(text: string): boolean {
  const arabic = (text.match(/[؀-ۿ]/g) ?? []).length;
  return arabic >= 20 && arabic / Math.max(1, text.replace(/\s/g, '').length) > 0.3;
}

/**
 * يستخرج نصّ الملف. ولا يرمي استثناءً على ملفٍّ لا يُقرأ: يُرجِع نصّاً فارغاً
 * وسبباً بالعربية — لأن الأب يقرأ السبب، ولا يقرأ استثناءً.
 */
export async function readPdf(bytes: Uint8Array): Promise<PdfText> {
  const raw = bytesToLatin(bytes);
  if (!raw.startsWith('%PDF')) {
    return { text: '', pages: 0, pagesWithText: 0, warningAr: 'هذا الملف ليس PDF.' };
  }

  /* لا يُقرأ جدول المراجع (`xref`): كثيرٌ من الملفات جداولُها معطوبة أو
   * مضغوطة، وقارئٌ يعتمد عليها يسقط على ملفاتٍ تفتحها كلُّ البرامج. فتُمسَح
   * الأجسام مسحاً مباشراً — أبطأ وأصلب. */
  const OBJECT = /(\d+)\s+(\d+)\s+obj\b([\s\S]*?)\bendobj/g;
  const streams: Array<{ dict: string; body: Uint8Array }> = [];
  let pages = 0;
  let match: RegExpExecArray | null;

  while ((match = OBJECT.exec(raw)) !== null) {
    const body = match[3] ?? '';
    if (/\/Type\s*\/Page\b/.test(body)) pages++;
    const streamAt = body.indexOf('stream');
    if (streamAt < 0) continue;
    const dict = body.slice(0, streamAt);
    /* بعد `stream` سطرٌ جديد قد يكون `\r\n` أو `\n` وحده */
    let start = (match.index ?? 0) + (match[0]?.indexOf('stream') ?? 0) + 'stream'.length;
    if (raw[start] === '\r') start++;
    if (raw[start] === '\n') start++;
    const endAt = raw.indexOf('endstream', start);
    if (endAt < 0) continue;
    streams.push({ dict, body: bytes.subarray(start, endAt) });
  }

  let text = '';
  let pagesWithText = 0;
  let compressedUnread = 0;

  for (const stream of streams) {
    // الصور والخطوط تُتجاوز: لا نصَّ فيها، وفكُّها إهدارُ وقتٍ على جوال
    if (/\/Subtype\s*\/Image|\/Type\s*\/Font|\/FontFile/.test(stream.dict)) continue;
    let data: Uint8Array | null = stream.body;
    if (/\/Filter/.test(stream.dict)) {
      if (/FlateDecode/.test(stream.dict)) {
        data = await inflate(stream.body);
        if (!data) { compressedUnread++; continue; }
      } else {
        // مرشّحاتٌ أخرى (LZW، JBIG2، DCT…) لا تُفكّ هنا، وتُحسب ولا تُبتلَع
        compressedUnread++;
        continue;
      }
    }
    const piece = textFromContent(bytesToLatin(data));
    if (piece.trim().length > 0) {
      pagesWithText++;
      text += `${piece}\n`;
    }
  }

  text = unshape(text).replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

  let warningAr: string | null = null;
  if (text.length === 0) {
    warningAr = compressedUnread > 0
      ? 'الملف مضغوطٌ بطريقةٍ لا أفكّها، أو صفحاته صور. جرّب أن تنسخ النصّ وتلصقه.'
      : pages > 0
        ? 'صفحاتُ الملف صورٌ لا نصّ فيها — لا أستطيع قراءتها. انسخ النصّ والصقه.'
        : 'لم أجد في الملف نصّاً أقرؤه.';
  } else if (!looksArabic(text)) {
    warningAr = 'قرأتُ الملف لكن ما خرج ليس عربيةً مفهومة — غالباً خطُّه مضمَّنٌ '
      + 'بترميزٍ خاص. راجع ما فهمتُه قبل أن تحفظه، أو الصق النصّ بدل الملف.';
  }

  return { text, pages, pagesWithText, warningAr };
}
