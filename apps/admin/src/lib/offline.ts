/**
 * طابور المزامنة لواجهة المندوب — الفصل 17 §17.11
 *
 * المندوب يعمل في أقبية وأدراج ومناطق بلا تغطية. لو اشترطنا الشبكة
 * لتسجيل تسليم، لسجّل على ورقة ثم أدخل عشرة تسليمات مساءً من الذاكرة —
 * وذاكرةُ آخر النهار أسوأ دفتر صندوق.
 *
 * فالتسجيل يقع فوراً في الجهاز، ويُرسَل حين تعود الشبكة، بثلاثة ضمانات:
 *
 *  ١. مفتاح تفرّد من (الطلب، الجهاز، تسلسل محلي) — الإرسال المكرر
 *     بعد عودة الشبكة يعيد النتيجة الأولى ولا يحصّل مرتين.
 *  ٢. occurred_at من ساعة الجهاز لحظة التسليم، وreceived_at من الخادم.
 *     التقارير المالية تُبنى على الأول، وإلا ظهر تحصيل الأمس في حصيلة اليوم.
 *  ٣. ساعة منحرفة أكثر من عشر دقائق تمنع التسجيل: طابع زمني خاطئ
 *     يفسد التسوية بصمت، والصمت أخطر من الرفض.
 */

const QUEUE_KEY = 'courier_queue_v1';
const DEVICE_KEY = 'courier_device_id';
const SEQ_KEY = 'courier_local_seq';
const SKEW_KEY = 'courier_clock_skew_ms';

export interface QueuedAction {
  id: string;
  idempotencyKey: string;
  path: string;
  body: Record<string, unknown>;
  occurredAt: string;
  queuedAt: string;
  attempts: number;
  lastError?: string;
  label: string;
}

function read(): QueuedAction[] {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]'); }
  catch { return []; }
}

function write(q: QueuedAction[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  window.dispatchEvent(new CustomEvent('courier:queue', { detail: q.length }));
}

export function deviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) { id = crypto.randomUUID().slice(0, 8); localStorage.setItem(DEVICE_KEY, id); }
  return id;
}

function nextSeq(): number {
  const n = Number(localStorage.getItem(SEQ_KEY) ?? '0') + 1;
  localStorage.setItem(SEQ_KEY, String(n));
  return n;
}

/** انحراف ساعة الجهاز عن الخادم، يُقاس عند كل استجابة تحمل تاريخاً */
export function recordSkew(serverDate: string | null) {
  if (!serverDate) return;
  const skew = new Date(serverDate).getTime() - Date.now();
  localStorage.setItem(SKEW_KEY, String(skew));
}

export function clockSkewMs(): number {
  return Number(localStorage.getItem(SKEW_KEY) ?? '0');
}

export function clockOk(): boolean {
  return Math.abs(clockSkewMs()) <= 10 * 60_000;
}

export const queueLength = () => read().length;
export const queued = () => read();

/**
 * إدراج إجراء في الطابور.
 * المفتاح يُولَّد هنا مرة واحدة ويُخزَّن مع الإجراء: لو وُلِّد عند الإرسال
 * لتغيّر مع كل محاولة، ولصار مفتاحُ التفرّد أداةَ تكرارٍ لا منعِه.
 */
export function enqueue(args: {
  orderNo: string; path: string; body: Record<string, unknown>; label: string;
}): QueuedAction {
  const occurredAt = new Date(Date.now() + clockSkewMs()).toISOString();
  const action: QueuedAction = {
    id: crypto.randomUUID(),
    idempotencyKey: `${args.orderNo}:${deviceId()}:${nextSeq()}`,
    path: args.path,
    body: { ...args.body, occurredAt },
    occurredAt,
    queuedAt: new Date().toISOString(),
    attempts: 0,
    label: args.label,
  };
  write([...read(), action]);
  return action;
}

export interface FlushResult { sent: number; failed: number; offline: boolean }

/**
 * تفريغ الطابور بالترتيب.
 * التسلسل مقصود: التسليم قبل التحصيل، والحالة قبل الحالة التي تليها.
 * إرسالٌ متوازٍ قد يصل مقلوباً فيرفض الخادم انتقالاً صحيحاً.
 */
export async function flush(
  send: (a: QueuedAction) => Promise<Response>,
): Promise<FlushResult> {
  if (!navigator.onLine) return { sent: 0, failed: 0, offline: true };

  const q = read();
  if (!q.length) return { sent: 0, failed: 0, offline: false };

  const remaining: QueuedAction[] = [];
  let sent = 0, failed = 0;

  for (const a of q) {
    try {
      const res = await send(a);
      recordSkew(res.headers.get('date'));

      if (res.ok) { sent++; continue; }

      /* خطأ العميل (4xx) نهائي: إعادة الإرسال لن تغيّر شيئاً، وإبقاؤه
         في الطابور يعني محاولات أبدية تحجب ما خلفه. يُسقَط ويُبلَّغ عنه.
         أما 409 على التحصيل فغالباً «سُجِّل من قبل» — وهو نجاح متأخر. */
      if (res.status >= 400 && res.status < 500) {
        if (res.status === 409) { sent++; continue; }
        failed++;
        const err = await res.json().catch(() => ({}));
        remaining.push({
          ...a, attempts: a.attempts + 1,
          lastError: (err as any)?.error?.message?.ar ?? `خطأ ${res.status}`,
        });
        continue;
      }

      // خطأ خادم أو شبكة: يبقى في الطابور بلا عدّ فشل نهائي
      remaining.push({ ...a, attempts: a.attempts + 1, lastError: `الخادم ${res.status}` });
    } catch {
      remaining.push({ ...a, attempts: a.attempts + 1, lastError: 'الشبكة منقطعة' });
      // انقطاع أثناء التفريغ: أوقف الباقي حفاظاً على الترتيب
      const idx = q.indexOf(a);
      remaining.push(...q.slice(idx + 1));
      break;
    }
  }

  write(remaining);
  return { sent, failed, offline: false };
}

/** إسقاط إجراء عالق يدوياً — بعد أن يقرأ المندوب سبب فشله */
export function drop(id: string) {
  write(read().filter((a) => a.id !== id));
}

/** حدّ البيانات على الجهاز: لا يبقى شيء بعد 24 ساعة (الفصل 17 §17.8) */
export function purgeStale(hours = 24) {
  const cutoff = Date.now() - hours * 3_600_000;
  const q = read();
  const kept = q.filter((a) => new Date(a.queuedAt).getTime() > cutoff);
  if (kept.length !== q.length) write(kept);
  return q.length - kept.length;
}
