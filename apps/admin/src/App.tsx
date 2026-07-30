import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, idemKey, fmtSyp, tokens } from './lib/api.js';
import { clockOk, clockSkewMs, drop, enqueue, flush, purgeStale, queued, type QueuedAction } from './lib/offline.js';
import { useRoute } from './lib/router.js';

interface AdminOrder {
  orderNo: string; status: string; paymentStatus: string;
  cashDueSyp: number; fxStale: boolean; confirmationAttempts: number; hoursLeft: number;
  customer: string; phone: string; governorate: string; landmark: string;
  itemCount: number; placedAt: string;
}
interface Fx {
  rate: number; baseRate: number; health: 'FRESH' | 'EXPIRING' | 'STALE_MARGIN' | 'STALE_HALT';
  validUntil: string; hoursLeft: number; safetyMarginBp: number;
}
interface FxPreview {
  currentRate: number; newRate: number; deviationPct: number;
  changedCount: number; totalCount: number; protectedOrders: number;
  top: Array<{ sku: string; name: string; before: number; after: number; delta: number }>;
}
interface CourierTask {
  orderNo: string; status: string; cashDueSyp: number;
  governorate: string; city: string; itemCount: number;
  /* بيانات الزبون لا تصل إلا لمن أُسنِد إليه الطلب */
  assigned: boolean; mine: boolean;
  customer?: string; phone?: string; altPhone?: string;
  neighborhood?: string; landmark?: string;
}

const STATUS_AR: Record<string, string> = {
  PENDING_CONFIRMATION: 'بانتظار التأكيد', PROCESSING: 'قيد التجهيز',
  SHIPPED: 'مشحون', OUT_FOR_DELIVERY: 'خرج للتوصيل', DELIVERED: 'مسلَّم',
  DELIVERY_FAILED: 'تعذّر التسليم', CANCELLED: 'ملغى',
};
const GOV_AR: Record<string, string> = {
  DAMASCUS: 'دمشق', RIF_DIMASHQ: 'ريف دمشق', ALEPPO: 'حلب',
  HOMS: 'حمص', HAMA: 'حماة', LATAKIA: 'اللاذقية', TARTUS: 'طرطوس',
};

/**
 * صفّ التحصيل: أرقام الأجهزة قبل المال.
 *
 * الرقم يُقرأ من علبة الجهاز أو بطلب *#06# عليه، ويُدخَل لكل قطعة في
 * الطلب. والزرّ لا يعمل حتى تكتمل — لأن تحصيلاً بلا أرقام يعني كفالةً
 * على جهازٍ آخر، ولا يُكتشف الخطأ إلا يوم يعود الزبون بعطل.
 *
 * ولوحة أرقام لا حروف: المندوب يُدخلها على باب البيت بيدٍ واحدة.
 */
function CollectRow({ task, onCollect, onFail }: {
  task: CourierTask;
  onCollect: (t: CourierTask, imeis: string[]) => void;
  onFail: () => void;
}) {
  const n = Math.max(1, task.itemCount);
  const [imeis, setImeis] = useState<string[]>(() => Array(n).fill(''));
  const clean = imeis.map((x) => x.replace(/\D/g, ''));
  /* خمس عشرة خانة هو طول IMEI القياسي — والقصير خطأُ إدخالٍ لا رقمٌ آخر */
  const ready = clean.every((x) => x.length >= 14 && x.length <= 17);

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'grid', gap: 8 }}>
        {imeis.map((v, i) => (
          <div className="field" key={i}>
            <label htmlFor={`imei-${task.orderNo}-${i}`}>
              رقم الجهاز {n > 1 ? `${i + 1} من ${n}` : ''} (IMEI)
            </label>
            <input
              id={`imei-${task.orderNo}-${i}`}
              value={v}
              inputMode="numeric"
              dir="ltr"
              autoComplete="off"
              placeholder="١٥ رقماً — من العلبة أو ‎*#06#‎"
              onChange={(e) => {
                const next = [...imeis];
                next[i] = e.target.value;
                setImeis(next);
              }}
            />
          </div>
        ))}
        {!ready && <span className="hint">أدخل رقم كل جهاز تسلّمه للزبون قبل قبض المبلغ.</span>}
      </div>
      <div className="acts">
        <Btn
          label={`حصّلت ${fmtSyp(task.cashDueSyp)}`}
          disabled={!ready}
          onClick={async () => onCollect(task, clean)}
        />
        <Btn label="تعذّر التسليم" kind="btn--danger" onClick={async () => onFail()} />
      </div>
    </div>
  );
}

function Btn(props: { label: string; onClick: () => Promise<void>; kind?: string; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={`btn ${props.kind ?? ''}`}
      disabled={busy || props.disabled}
      data-busy={busy || undefined}
      onClick={async () => { if (busy) return; setBusy(true); try { await props.onClick(); } finally { setBusy(false); } }}
    >
      {busy ? '…' : props.label}
    </button>
  );
}

/* ————— شريط صحة سعر الصرف: حاضر في كل شاشة ————— */
function FxBanner({ fx }: { fx: Fx | null }) {
  if (!fx) return null;
  if (fx.health === 'FRESH') return null;
  const cls = fx.health === 'STALE_HALT' ? 'sysbar sysbar--halt' : 'sysbar';
  const text =
    fx.health === 'EXPIRING' ? `سعر الصرف ينتهي خلال ${fx.hoursLeft} ساعة — حدّثه قبل أن يتوقف البيع`
    : fx.health === 'STALE_MARGIN' ? `سعر الصرف متقادم — يُطبَّق هامش أمان ${fx.safetyMarginBp / 100}% مؤقتاً`
    : 'سعر الصرف متقادم — استقبال الطلبات متوقف تلقائياً';
  return <div className={cls} role="status">{text}</div>;
}

/* ————— لوحة المؤشرات ————— */
interface DashboardData {
  pending: number; processing: number; delivered: number;
  lowStock: number; staleOrders: number; collectedSyp: number;
}

function Dashboard() {
  const [d, setD] = useState<DashboardData | null>(null);
  useEffect(() => { api.get<DashboardData>('/admin/dashboard').then(setD).catch(() => {}); }, []);
  if (!d) return <p className="muted">جارٍ التحميل…</p>;
  const cards: Array<[string, string]> = [
    ['بانتظار التأكيد', String(d.pending)], ['قيد التجهيز', String(d.processing)],
    ['مسلَّم', String(d.delivered)], ['مخزون منخفض', String(d.lowStock)],
    ['طلبات بسعر متقادم', String(d.staleOrders)], ['المحصَّل', fmtSyp(d.collectedSyp)],
  ];
  return (
    <div className="grid2">
      {cards.map(([k, v]) => (
        <div className="kpi glass" key={k}><small>{k}</small><b>{v}</b></div>
      ))}
    </div>
  );
}

/* ————— قائمة عمل التأكيد ————— */
function OrdersQueue({ onChanged }: { onChanged: () => void }) {
  const [status, setStatus] = useState('PENDING_CONFIRMATION');
  const [rows, setRows] = useState<AdminOrder[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setRows(await api.get<AdminOrder[]>(`/admin/orders?status=${status}`)); }
    catch (e) { setErr(e instanceof ApiError ? e.messageAr : 'تعذّر التحميل'); }
  }, [status]);
  useEffect(() => { load(); }, [load]);

  const act = async (no: string, outcome: string) => {
    setErr(null);
    try {
      await api.post(`/admin/orders/${no}/confirm`, { outcome });
      await load(); onChanged();
    } catch (e) { setErr(e instanceof ApiError ? e.messageAr : 'تعذّر تنفيذ الإجراء'); }
  };

  return (
    <>
      <div className="tabs">
        {[['PENDING_CONFIRMATION', 'بانتظار التأكيد'], ['PROCESSING', 'قيد التجهيز'],
          ['OUT_FOR_DELIVERY', 'خرج للتوصيل'], ['DELIVERED', 'مسلَّم']].map(([v, l]) => (
          <button key={v} aria-pressed={status === v} onClick={() => setStatus(v as string)}>{l}</button>
        ))}
      </div>

      {err && <div className="err">{err}</div>}
      {!rows.length && <p className="empty">لا طلبات في هذه الحالة.</p>}

      {rows.map((o) => (
        <div className="qrow glass" key={o.orderNo}>
          <div className="top">
            <div>
              <div className="no">{o.orderNo}</div>
              <div className="muted">{o.customer} · <span dir="ltr">{o.phone}</span></div>
              <div className="muted">{GOV_AR[o.governorate] ?? o.governorate} — {o.landmark}</div>
            </div>
            <div style={{ textAlign: 'end' }}>
              <div className="tnum" style={{ fontWeight: 800 }}>{fmtSyp(o.cashDueSyp)}</div>
              {o.status === 'PENDING_CONFIRMATION' && (
                <div className="clock" data-urgent={o.hoursLeft < 12 || undefined}>
                  يتبقّى {o.hoursLeft.toFixed(1)} ساعة
                </div>
              )}
              {o.fxStale && <span className="tag tag--clay">سعر متقادم</span>}
            </div>
          </div>

          {o.status === 'PENDING_CONFIRMATION' && (
            <div className="acts">
              <Btn label="تأكيد" onClick={() => act(o.orderNo, 'CONFIRMED')} />
              <Btn label="لم يردّ" kind="btn--ghost" onClick={() => act(o.orderNo, 'NO_ANSWER')} />
              <Btn label="إعادة جدولة" kind="btn--ghost" onClick={() => act(o.orderNo, 'RESCHEDULE')} />
              <Btn label="إلغاء" kind="btn--danger" onClick={() => act(o.orderNo, 'CANCELLED')} />
              {o.confirmationAttempts > 0 && (
                <span className="muted" style={{ alignSelf: 'center' }}>
                  محاولات: {o.confirmationAttempts}/3
                </span>
              )}
            </div>
          )}
        </div>
      ))}
    </>
  );
}

/* ————— شاشة سعر الصرف مع معاينة الأثر ————— */
function FxScreen({ fx, reload }: { fx: Fx | null; reload: () => void }) {
  const [rate, setRate] = useState('');
  const [preview, setPreview] = useState<FxPreview | null>(null);
  const [done, setDone] = useState(false);

  const sharp = preview && Math.abs(preview.deviationPct) > 3;

  return (
    <>
      {fx && (
        <div className="grid2">
          <div className="kpi glass"><small>السعر الساري</small><b>{fx.baseRate.toLocaleString('en-US')}</b></div>
          <div className="kpi glass"><small>ينتهي بعد</small><b>{fx.hoursLeft} ساعة</b></div>
        </div>
      )}

      <div className="card glass">
        <div className="field">
          <label htmlFor="rate">السعر الجديد (ليرة لكل دولار)</label>
          <input id="rate" value={rate} onChange={(e) => { setRate(e.target.value); setPreview(null); setDone(false); }}
                 inputMode="numeric" dir="ltr" placeholder="13400" />
        </div>
        <Btn
          label="عاينِ الأثر"
          kind="btn--ghost"
          disabled={!Number(rate)}
          onClick={async () => setPreview(await api.post<FxPreview>('/fx/preview', { rate: Number(rate) }))}
        />
      </div>

      {preview && (
        <>
          <div className="card glass">
            <div className="row">
              <span className="muted">الانحراف</span>
              <span className="tnum" style={{ fontWeight: 800, color: sharp ? 'var(--clay)' : undefined }}>
                {preview.deviationPct > 0 ? '+' : ''}{preview.deviationPct}%
              </span>
            </div>
            <div className="row">
              <span className="muted">منتجات يتغيّر سعرها</span>
              <span className="tnum">{preview.changedCount} من {preview.totalCount}</span>
            </div>
            <div className="row">
              <span className="muted">طلبات محمية بالتثبيت</span>
              <span className="tnum">{preview.protectedOrders}</span>
            </div>
            {preview.top.map((t) => (
              <div className="row" key={t.sku}>
                <span className="muted">{t.name}</span>
                <span className="tnum">
                  {t.before.toLocaleString('en-US')} <span style={{ color: 'var(--jade)' }}>← {t.after.toLocaleString('en-US')}</span>
                </span>
              </div>
            ))}
          </div>

          {sharp && (
            <div className="err">
              انحراف حاد — راجع الكوبونات ذات المبالغ الثابتة وقواعد التسعير النشطة قبل الاعتماد.
            </div>
          )}

          <Btn
            label={sharp ? 'أؤكد الاعتماد رغم الانحراف' : 'اعتمد السعر الجديد'}
            onClick={async () => {
              await api.post('/admin/fx', { rate: Number(rate), validHours: 24 });
              setDone(true); setPreview(null); setRate(''); reload();
            }}
          />
        </>
      )}

      {done && <div className="ok">اعتُمد السعر. تنتشر أسعار الليرة خلال أقل من دقيقة بلا إعادة بناء.</div>}
    </>
  );
}

/* ————— واجهة المندوب ————— */
function Courier() {
  const [tasks, setTasks] = useState<CourierTask[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [pending, setPending] = useState<QueuedAction[]>(() => queued());

  const load = useCallback(async () => {
    if (!navigator.onLine) return;             // بلا شبكة تبقى القائمة كما هي
    try { setTasks(await api.get<CourierTask[]>('/courier/tasks')); }
    catch (e) { setErr(e instanceof ApiError ? e.messageAr : 'تعذّر التحميل'); }
  }, []);

  /* التفريغ يمرّ بالطبقة نفسها التي تحمل الرمز، ويحمل مفتاح التفرّد
     المولَّد وقت الإدراج لا وقت الإرسال — وإلا صار كل إعادة إرسال عمليةً جديدة. */
  const sync = useCallback(async () => {
    const r = await flush((a) =>
      fetch((import.meta.env.VITE_API_URL ?? '/api/v1') + a.path, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': a.idempotencyKey,
          ...(tokens.access ? { authorization: `Bearer ${tokens.access}` } : {}),
        },
        body: JSON.stringify(a.body),
      }));
    setPending(queued());
    if (r.sent) { setMsg(`أُرسل ${r.sent} إجراءً من الطابور`); await load(); }
    if (r.failed) setErr(`${r.failed} إجراءً رُفض — راجع الطابور أدناه`);
  }, [load]);

  useEffect(() => {
    purgeStale();                              // لا يبقى على الجهاز شيء بعد يوم
    void load();
    void sync();
    const up = () => { setOnline(true); void sync(); };
    const down = () => setOnline(false);
    const q = (e: Event) => setPending(queued());
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    window.addEventListener('courier:queue', q);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
      window.removeEventListener('courier:queue', q);
    };
  }, [load, sync]);

  /* كل إجراء يُسجَّل في الطابور أولاً ثم يُحاوَل إرساله.
     العكس — الإرسال أولاً والتسجيل عند الفشل — يخسر الإجراء
     إن مات التطبيق بين المحاولتين، وهو ما يحدث حين تنفد بطارية الجهاز. */
  const act = (orderNo: string, path: string, body: Record<string, unknown>, label: string) => {
    if (!clockOk()) {
      setErr(`ساعة الجهاز منحرفة ${Math.round(clockSkewMs() / 60000)} دقيقة — زامن الوقت قبل التسجيل`);
      return;
    }
    setErr(null);
    enqueue({ orderNo, path, body, label });
    setPending(queued());
    setMsg(navigator.onLine ? null : `${label} — محفوظ وسيُرسَل عند عودة الشبكة`);
    void sync();
  };

  const step = (no: string, to: string) =>
    act(no, `/courier/orders/${no}/status`, { to }, `${no}: ${STATUS_AR[to] ?? to}`);

  /* المطالبة تُرسَل فوراً لا عبر الطابور: مندوبان قد يطالبان بالطلب نفسه،
     والفوز يُحسم عند الخادم — فتأجيلها يعني ذهاب اثنين إلى عنوان واحد. */
  const claim = async (no: string) => {
    setErr(null);
    try {
      await api.post(`/courier/orders/${no}/claim`, {});
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.messageAr : 'تعذّرت المطالبة');
    }
  };

  /*
    أرقام الأجهزة تُدخَل قبل التحصيل.
    كان الخادم يختار من الرفّ بترتيب المعرّف أياً كان الجهاز الذي وُضع في
    يد الزبون — فتُفعَّل الكفالة على غير جهازه، ويُرفض مرتجعه لأن رقمه لا
    يطابق المسجَّل. والرقم يُقرأ من علبة الجهاز أو بطلب ‎*#06#‎ عليه.
  */
  const collect = (t: CourierTask, imeis: string[]) =>
    act(t.orderNo, `/courier/orders/${t.orderNo}/collect`,
      { amountSyp: t.cashDueSyp, imeis }, `تحصيل ${fmtSyp(t.cashDueSyp)} — ${t.orderNo}`);

  return (
    <>
      {/* مؤشر المزامنة حالة مستمرة لا إشعار عابر (الفصل 20 §20.8) */}
      <div className={`sysbar ${online ? '' : 'sysbar--offline'}`} role="status">
        {online
          ? pending.length
            ? `${pending.length} إجراءً في الطابور — جارٍ الإرسال`
            : 'مُزامَن — كل العمليات مرسَلة'
          : `بلا اتصال — ${pending.length} إجراءً محفوظ وسيُرسَل عند عودة الشبكة`}
      </div>

      {!clockOk() && (
        <div className="err">
          ساعة الجهاز منحرفة عن الخادم {Math.round(clockSkewMs() / 60000)} دقيقة.
          زامن الوقت من إعدادات الجهاز — الطابع الزمني الخاطئ يفسد التسوية بصمت.
        </div>
      )}

      {err && <div className="err">{err}</div>}
      {msg && <div className="ok">{msg}</div>}

      {pending.length > 0 && (
        <div className="card glass">
          <b style={{ fontSize: 'var(--step--1)' }}>طابور المزامنة</b>
          {pending.map((a) => (
            <div className="line" key={a.id}>
              <span className="mid">
                <b>{a.label}</b>
                <small className="muted">
                  {new Date(a.occurredAt).toLocaleTimeString('ar-SY-u-nu-latn', { hour: '2-digit', minute: '2-digit' })}
                  {a.attempts > 0 ? ` · ${a.attempts} محاولة` : ''}
                  {a.lastError ? ` · ${a.lastError}` : ''}
                </small>
              </span>
              {a.attempts >= 3 && (
                <button className="btn btn--danger" style={{ minHeight: 32, padding: '0 10px' }}
                  onClick={() => { drop(a.id); setPending(queued()); }}>
                  أسقِطه
                </button>
              )}
            </div>
          ))}
          {online && <Btn label="أرسل الآن" onClick={sync} />}
        </div>
      )}

      {!tasks.length && <p className="empty">لا مهام اليوم.</p>}

      {tasks.map((t) => (
        <div className="qrow glass" key={t.orderNo}>
          <div className="top">
            <div>
              <div className="no">{t.orderNo}</div>
              {t.mine ? (
                <>
                  <div className="muted">{t.customer}</div>
                  <div className="muted">{GOV_AR[t.governorate] ?? t.governorate} · {t.neighborhood}</div>
                  <div style={{ fontWeight: 700, fontSize: 'var(--step--1)' }}>المعلم: {t.landmark}</div>
                </>
              ) : (
                <>
                  <div className="muted">{GOV_AR[t.governorate] ?? t.governorate} · {t.city}</div>
                  <div className="hint">بيانات الزبون تظهر بعد أن تطالب بالطلب.</div>
                </>
              )}
            </div>
            <div style={{ textAlign: 'end' }}>
              <div className="muted">المستحق نقداً</div>
              <div className="tnum" style={{ fontSize: 'var(--step-1)', fontWeight: 800 }}>{fmtSyp(t.cashDueSyp)}</div>
              <span className="tag">{STATUS_AR[t.status] ?? t.status}</span>
            </div>
          </div>
          {t.mine ? (
            <div className="acts">
              <a className="btn btn--ghost" href={`tel:${t.phone}`}>اتصال</a>
              {t.status === 'PROCESSING' && <Btn label="استلمت الشحنة" onClick={async () => step(t.orderNo, 'SHIPPED')} />}
              {t.status === 'SHIPPED' && <Btn label="خرجت للتوصيل" onClick={async () => step(t.orderNo, 'OUT_FOR_DELIVERY')} />}
              {t.status === 'OUT_FOR_DELIVERY' && (
                <CollectRow task={t} onCollect={collect} onFail={() => step(t.orderNo, 'DELIVERY_FAILED')} />
              )}
            </div>
          ) : (
            <div className="acts">
              <Btn label="أنا آخذه" onClick={async () => claim(t.orderNo)} />
            </div>
          )}
        </div>
      ))}
    </>
  );
}


/* ————— التسويات النقدية ————— */
interface Settlement {
  id: string; date: string; collectorType: string;
  collector: { name: string | null; phone: string } | null;
  ordersCount: number; expectedSyp: number; collectedSyp: number;
  varianceSyp: number; commissionSyp: number; netDueSyp: number;
  state: string; note: string | null;
}
const SET_AR: Record<string, string> = {
  OPEN: 'مفتوحة', RECONCILED: 'مطابَقة', DISPUTED: 'فرق قائم', SETTLED: 'مُقفَلة',
};

function Settlements() {
  const [rows, setRows] = useState<Settlement[] | null>(null);
  const [rep, setRep] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    api.get<Settlement[]>('/admin/settlements').then(setRows).catch((e) =>
      setErr(e instanceof ApiError ? e.messageAr : 'تعذّر التحميل'));
    api.get('/admin/settlements/report').then(setRep).catch(() => {});
  }, []);
  useEffect(load, [load]);

  const act = async (id: string, what: 'reconcile' | 'settle') => {
    setErr(null);
    try { await api.post(`/admin/settlements/${id}/${what}`); load(); }
    catch (e) { setErr(e instanceof ApiError ? e.messageAr : 'تعذّر الإجراء'); }
  };

  return (
    <>
      {err && <div className="err">{err}</div>}
      {rep && (
        <div className="grid2">
          <div className="kpi glass"><small>المحصَّل (7 أيام)</small><b>{fmtSyp(rep.collectedSyp)}</b></div>
          <div className="kpi glass"><small>صافي المتجر</small><b>{fmtSyp(rep.netDueSyp)}</b></div>
          <div className="kpi glass"><small>عمولة المندوبين</small><b>{fmtSyp(rep.commissionSyp)}</b></div>
          <div className="kpi glass"><small>فروق مفتوحة</small><b>{rep.settlements.disputed}</b></div>
          <div className="kpi glass"><small>مسلَّم / فاشل</small><b>{rep.delivered} / {rep.failed}</b></div>
          <div className="kpi glass"><small>مسلَّم بلا تحصيل +48س</small><b>{rep.stalePendingPayments}</b></div>
        </div>
      )}

      <p className="warnbox">
        فرق التقريب ليس عجزاً في ذمّة المندوب: هو الفجوة بين الإيراد بالدولار
        والنقد المقرَّب لأقرب عشر ليرات. المطابقة تقيس ما قبضه مقابل ما كان يجب أن يقبضه.
      </p>

      {rows === null ? <p className="muted">جارٍ التحميل…</p>
        : !rows.length ? <div className="empty"><p>لا تسويات بعد.</p></div>
        : rows.map((r) => (
          <div className="qrow glass" key={r.id}>
            <div className="top">
              <div>
                <div className="no tnum">{r.date}</div>
                <div className="muted">{r.collector?.name ?? '—'} · <span dir="ltr">{r.collector?.phone}</span></div>
                <div className="muted">{r.ordersCount} طلباً</div>
              </div>
              <div style={{ textAlign: 'end' }}>
                <div className="tnum" style={{ fontWeight: 800 }}>{fmtSyp(r.collectedSyp)}</div>
                <div className="muted tnum">صافي {fmtSyp(r.netDueSyp)}</div>
                <span className={`tag ${r.state === 'DISPUTED' ? 'tag--clay' : r.state === 'SETTLED' ? 'tag--jade' : ''}`}>
                  {SET_AR[r.state] ?? r.state}
                </span>
              </div>
            </div>
            {r.varianceSyp !== 0 && (
              <div className="err" style={{ marginBlock: 8 }}>
                {r.note ?? `فرق ${r.varianceSyp.toLocaleString('en-US')} ل.س`}
              </div>
            )}
            <div className="acts">
              {r.state === 'OPEN' && <Btn label="طابِق" onClick={() => act(r.id, 'reconcile')} />}
              {r.state === 'DISPUTED' && <Btn label="أعد المطابقة" kind="btn--ghost" onClick={() => act(r.id, 'reconcile')} />}
              {r.state === 'RECONCILED' && <Btn label="أقفِل — وصل النقد" onClick={() => act(r.id, 'settle')} />}
            </div>
          </div>
        ))}
    </>
  );
}

/* ————— المرتجعات ————— */
interface ReturnRow {
  returnNo: string; orderNo: string; state: string; stateAr: string;
  reasonAr: string; customer: string; customerNote: string | null;
  dueSyp: number; imeiMatched: boolean | null; refundState: string | null;
  requestedAt: string;
}
const RET_NEXT: Record<string, Array<[string, string]>> = {
  REQUESTED: [['APPROVED', 'وافِق'], ['REJECTED', 'ارفض']],
  APPROVED: [['PICKUP_SCHEDULED', 'جدوِل الاستلام']],
  PICKUP_SCHEDULED: [['RECEIVED', 'وصل المتجر']],
  RECEIVED: [['INSPECTED', 'افحص']],
  INSPECTED: [['COMPLETED', 'أكمِل']],
};

function Returns() {
  const [rows, setRows] = useState<ReturnRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [imei, setImei] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    api.get<ReturnRow[]>('/admin/returns').then(setRows).catch((e) =>
      setErr(e instanceof ApiError ? e.messageAr : 'تعذّر التحميل'));
  }, []);
  useEffect(load, [load]);

  const move = async (r: ReturnRow, to: string) => {
    setErr(null); setMsg(null);
    try {
      const body: any = { to };
      if (to === 'REJECTED') {
        const reason = prompt('سبب الرفض — يُقال للعميل كما هو:');
        if (!reason) return;
        body.rejectReason = reason;
      }
      if (to === 'INSPECTED') body.imei = imei[r.returnNo] ?? '';
      await api.post(`/admin/returns/${r.returnNo}/transition`, body);
      setMsg(`${r.returnNo}: ${to}`); load();
    } catch (e) { setErr(e instanceof ApiError ? e.messageAr : 'تعذّر الإجراء'); }
  };

  const disburse = async (r: ReturnRow) => {
    setErr(null);
    try { await api.post(`/admin/returns/${r.returnNo}/disburse`, { note: 'نقداً من المعرض' }); setMsg('صُرف المبلغ'); load(); }
    catch (e) { setErr(e instanceof ApiError ? e.messageAr : 'تعذّر الصرف'); }
  };

  return (
    <>
      {err && <div className="err">{err}</div>}
      {msg && <div className="ok">{msg}</div>}
      <p className="warnbox">
        مطابقة IMEI شرط لا مجاملة: جهازٌ غير الذي بِيع قد يكون مسروقاً أو معطوباً
        أصلاً، وقبولُه يعني أن المتجر اشترى مشكلة شخص آخر نقداً.
      </p>

      {rows === null ? <p className="muted">جارٍ التحميل…</p>
        : !rows.length ? <div className="empty"><p>لا مرتجعات.</p></div>
        : rows.map((r) => (
          <div className="qrow glass" key={r.returnNo}>
            <div className="top">
              <div>
                <div className="no">{r.returnNo}</div>
                <div className="muted">{r.orderNo} · {r.customer}</div>
                <div className="muted">{r.reasonAr}{r.customerNote ? ` — ${r.customerNote}` : ''}</div>
              </div>
              <div style={{ textAlign: 'end' }}>
                <div className="tnum" style={{ fontWeight: 800 }}>{fmtSyp(r.dueSyp)}</div>
                <span className={`tag ${r.state === 'REJECTED' ? 'tag--clay' : r.state === 'COMPLETED' ? 'tag--jade' : ''}`}>
                  {r.stateAr}
                </span>
                {r.imeiMatched === true && <div className="muted">IMEI مطابق ✓</div>}
              </div>
            </div>

            {r.state === 'RECEIVED' && (
              <div className="field" style={{ marginBlock: 8 }}>
                <label htmlFor={`i-${r.returnNo}`}>IMEI الجهاز المُعاد</label>
                <input id={`i-${r.returnNo}`} dir="ltr" inputMode="numeric"
                  value={imei[r.returnNo] ?? ''}
                  onChange={(e) => setImei((m) => ({ ...m, [r.returnNo]: e.target.value }))} />
              </div>
            )}

            <div className="acts">
              {(RET_NEXT[r.state] ?? []).map(([to, label]) => (
                <Btn key={to} label={label} kind={to === 'REJECTED' ? 'btn--danger' : ''}
                  onClick={() => move(r, to)} />
              ))}
              {r.state === 'COMPLETED' && r.refundState === 'APPROVED' && (
                <Btn label="اصرف النقد" onClick={() => disburse(r)} />
              )}
              {r.refundState === 'DISBURSED' && <span className="tag tag--jade">صُرف</span>}
            </div>
          </div>
        ))}
    </>
  );
}

/* ————— الدعم ————— */
interface TicketRow {
  ticketNo: string; status: string; statusAr: string; priority: string;
  contactReason: string; subject: string | null; phone: string;
  orderNo: string | null; lastMessage: string; overdue: boolean;
}

function Tickets() {
  const [rows, setRows] = useState<TicketRow[] | null>(null);
  const [m, setM] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [reply, setReply] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    api.get<TicketRow[]>('/admin/tickets').then(setRows).catch((e) =>
      setErr(e instanceof ApiError ? e.messageAr : 'تعذّر التحميل'));
    api.get('/admin/tickets/metrics').then(setM).catch(() => {});
  }, []);
  useEffect(load, [load]);

  const send = async (t: TicketRow, internal: boolean) => {
    const body = reply[t.ticketNo]?.trim();
    if (!body) return;
    setErr(null);
    try {
      await api.post(`/admin/tickets/${t.ticketNo}/reply`, { body, internal });
      setReply((r) => ({ ...r, [t.ticketNo]: '' })); load();
    } catch (e) { setErr(e instanceof ApiError ? e.messageAr : 'تعذّر الإرسال'); }
  };

  const move = async (t: TicketRow, to: string) => {
    try { await api.post(`/admin/tickets/${t.ticketNo}/transition`, { to }); load(); }
    catch (e) { setErr(e instanceof ApiError ? e.messageAr : 'تعذّر الإجراء'); }
  };

  return (
    <>
      {err && <div className="err">{err}</div>}
      {m && (
        <div className="grid2">
          <div className="kpi glass"><small>مفتوحة</small><b>{m.open}</b></div>
          <div className="kpi glass"><small>تجاوزت المهلة</small><b>{m.slaBreached}</b></div>
          <div className="kpi glass"><small>وسيط أول رد</small><b>{m.frtMedianMinutes} د</b></div>
          <div className="kpi glass"><small>رضا العملاء</small><b>{m.csatAverage ?? '—'}</b></div>
        </div>
      )}
      {m?.topReasons?.length > 0 && (
        <p className="warnbox">
          أكثر أسباب التواصل: {m.topReasons.map((r: any) => `${r.reason} (${r.count})`).join(' · ')} —
          تكرار سبب واحد مشكلةُ منتج لا مشكلةُ وكيل.
        </p>
      )}

      {rows === null ? <p className="muted">جارٍ التحميل…</p>
        : !rows.length ? <div className="empty"><p>لا تذاكر مفتوحة.</p></div>
        : rows.map((t) => (
          <div className="qrow glass" key={t.ticketNo}>
            <div className="top">
              <div>
                <div className="no">{t.ticketNo}</div>
                <div className="muted">{t.subject ?? t.contactReason} · <span dir="ltr">{t.phone}</span></div>
                <div className="muted">{t.lastMessage}</div>
              </div>
              <div style={{ textAlign: 'end' }}>
                <span className={`tag ${t.priority === 'URGENT' || t.overdue ? 'tag--clay' : ''}`}>{t.statusAr}</span>
                {t.overdue && <div className="clock" data-urgent>تجاوزت مهلة أول رد</div>}
              </div>
            </div>
            <div className="field" style={{ marginBlock: 8 }}>
              <textarea rows={2} value={reply[t.ticketNo] ?? ''} placeholder="اكتب رداً أو ملاحظة داخلية"
                onChange={(e) => setReply((r) => ({ ...r, [t.ticketNo]: e.target.value }))} />
            </div>
            <div className="acts">
              <Btn label="رُدّ على العميل" onClick={() => send(t, false)} />
              <Btn label="ملاحظة داخلية" kind="btn--ghost" onClick={() => send(t, true)} />
              {t.status !== 'RESOLVED' && <Btn label="حُلَّت" kind="btn--ghost" onClick={() => move(t, 'RESOLVED')} />}
              {t.status !== 'ESCALATED' && <Btn label="صعِّد" kind="btn--danger" onClick={() => move(t, 'ESCALATED')} />}
            </div>
          </div>
        ))}
    </>
  );
}

/* ————— الكوبونات ————— */
interface CouponRow {
  code: string; type: string; value: number; maxDiscountUsdCents: number | null;
  minSubtotalUsdCents: number; usedCount: number; usageLimitTotal: number | null;
  startsAt: string; endsAt: string; isActive: boolean; live: boolean;
}
const CTYPE_AR: Record<string, string> = {
  PERCENTAGE: 'نسبة مئوية', FIXED_AMOUNT: 'مبلغ ثابت', FREE_SHIPPING: 'شحن مجاني',
};

function Coupons() {
  const [rows, setRows] = useState<CouponRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({ code: '', type: 'PERCENTAGE', value: '10', maxDiscountUsdCents: '', minSubtotalUsdCents: '0', days: '30' });

  const load = useCallback(() => {
    api.get<CouponRow[]>('/admin/coupons').then(setRows).catch((e) =>
      setErr(e instanceof ApiError ? e.messageAr : 'تعذّر التحميل'));
  }, []);
  useEffect(load, [load]);

  const create = async () => {
    setErr(null);
    try {
      await api.post('/admin/coupons', {
        code: f.code, type: f.type, value: Number(f.value),
        maxDiscountUsdCents: f.maxDiscountUsdCents ? Number(f.maxDiscountUsdCents) : null,
        minSubtotalUsdCents: Number(f.minSubtotalUsdCents),
        startsAt: new Date().toISOString(),
        endsAt: new Date(Date.now() + Number(f.days) * 86_400_000).toISOString(),
      });
      setF((x) => ({ ...x, code: '' })); load();
    } catch (e) { setErr(e instanceof ApiError ? e.messageAr : 'تعذّر الإنشاء'); }
  };

  return (
    <>
      {err && <div className="err">{err}</div>}
      <p className="warnbox">
        القيم كلها بالدولار (النسبة بالمئة، والمبالغ بالسنتات). خصمٌ محرَّر بالليرة
        يفقد معناه بعد أول قفزة صرف — «خصم 50 ألف» كان ربع الجهاز فصار عُشره.
      </p>

      <div className="card glass">
        <div className="grid2">
          <div className="field">
            <label htmlFor="cc">الرمز</label>
            <input id="cc" dir="ltr" value={f.code} placeholder="SHAM10"
              onChange={(e) => setF({ ...f, code: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="ct">النوع</label>
            <select id="ct" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
              {Object.entries(CTYPE_AR).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="cv">{f.type === 'PERCENTAGE' ? 'النسبة (1–100)' : 'المبلغ بالسنتات'}</label>
            <input id="cv" dir="ltr" inputMode="numeric" value={f.value}
              onChange={(e) => setF({ ...f, value: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="cm">سقف الخصم (سنت)</label>
            <input id="cm" dir="ltr" inputMode="numeric" value={f.maxDiscountUsdCents}
              onChange={(e) => setF({ ...f, maxDiscountUsdCents: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="cn">حد أدنى للسلة (سنت)</label>
            <input id="cn" dir="ltr" inputMode="numeric" value={f.minSubtotalUsdCents}
              onChange={(e) => setF({ ...f, minSubtotalUsdCents: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="cd">مدة الصلاحية (يوم)</label>
            <input id="cd" dir="ltr" inputMode="numeric" value={f.days}
              onChange={(e) => setF({ ...f, days: e.target.value })} />
          </div>
        </div>
        <Btn label="أنشئ الكوبون" disabled={!f.code} onClick={create} />
      </div>

      {rows === null ? <p className="muted">جارٍ التحميل…</p>
        : !rows.length ? <div className="empty"><p>لا كوبونات.</p></div>
        : rows.map((c) => (
          <div className="card glass" key={c.code}>
            <div className="line" style={{ alignItems: 'start' }}>
              <span className="mid">
                <b className="tnum">{c.code}</b>
                <small className="muted">
                  {CTYPE_AR[c.type]} · {c.type === 'PERCENTAGE' ? `${c.value}%` : `${(c.value / 100).toFixed(2)}$`}
                  {c.maxDiscountUsdCents ? ` · سقف ${(c.maxDiscountUsdCents / 100).toFixed(2)}$` : ''}
                  {c.minSubtotalUsdCents ? ` · حد أدنى ${(c.minSubtotalUsdCents / 100).toFixed(2)}$` : ''}
                </small>
                <small className="muted">
                  استُخدم {c.usedCount}{c.usageLimitTotal ? ` من ${c.usageLimitTotal}` : ''} ·
                  ينتهي {new Date(c.endsAt).toLocaleDateString('ar-SY-u-nu-latn')}
                </small>
              </span>
              <span className={`tag ${c.live ? 'tag--jade' : 'tag--clay'}`} style={{ flexShrink: 0 }}>
                {c.live ? 'ساري' : c.isActive ? 'خارج المدة' : 'موقوف'}
              </span>
            </div>
            <Btn label={c.isActive ? 'أوقِفه' : 'فعِّله'} kind="btn--ghost"
              onClick={async () => { await api.post(`/admin/coupons/${c.code}/toggle`, { isActive: !c.isActive }); load(); }} />
          </div>
        ))}
    </>
  );
}

/* ————— طابور الإشراف ————— */
function Moderation() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    api.get<any[]>('/admin/moderation/reviews').then(setRows).catch((e) =>
      setErr(e instanceof ApiError ? e.messageAr : 'تعذّر التحميل'));
  }, []);
  useEffect(load, [load]);

  const act = async (id: string, to: string) => {
    setErr(null);
    try {
      const body: any = { to };
      if (to === 'REJECTED') {
        const reason = prompt('سبب الرفض:');
        if (!reason) return;
        body.rejectReason = reason;
      }
      await api.post(`/admin/moderation/reviews/${id}`, body); load();
    } catch (e) { setErr(e instanceof ApiError ? e.messageAr : 'تعذّر الإجراء'); }
  };

  return (
    <>
      {err && <div className="err">{err}</div>}
      <p className="warnbox">
        الراية تُرفع آلياً ولا تَرفض: الرفض الآلي يقتل مراجعات صادقة غاضبة،
        والقرار يبقى لإنسان يقرأ.
      </p>
      {rows === null ? <p className="muted">جارٍ التحميل…</p>
        : !rows.length ? <div className="empty"><p>لا شيء في طابور الإشراف.</p></div>
        : rows.map((r) => (
          <div className="qrow glass" key={r.id}>
            <div className="top">
              <div>
                <div className="no">{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</div>
                <div className="muted">{r.product} · {r.author}</div>
                <div style={{ marginBlockStart: 6 }}>{r.title ? <b>{r.title} — </b> : null}{r.body}</div>
              </div>
              {r.flagged && <span className="tag tag--clay" style={{ flexShrink: 0 }}>مُرفَّعة</span>}
            </div>
            <div className="acts">
              <Btn label="انشرها" onClick={() => act(r.id, 'PUBLISHED')} />
              <Btn label="ارفضها" kind="btn--danger" onClick={() => act(r.id, 'REJECTED')} />
            </div>
          </div>
        ))}
    </>
  );
}




/* ————— المندوبون والمناطق ————— */
interface CourierRow {
  code: string; fullName: string; phone: string;
  status: string; statusAr: string; suspensionReason: string | null;
  vehicleType: string; vehiclePlate: string | null; employmentType: string;
  homeGovernorate: string; dailyCapacity: number; deliveredToday: number;
  cashCapUsdCents: number; depositUsdCents: number;
  guarantorName: string | null; guarantorPhone: string | null;
  active: boolean; zones: Array<{ code: string; name: any; priority: number }>;
}
interface ZoneRow {
  code: string; name: any; governorate: string; city: string;
  neighborhoods: string[]; zoneType: string;
  surchargeUsdCents: number; slaHours: number; codMaxUsdCents: number | null;
  defaultCourier: string | null;
  couriers: Array<{ code: string; name: string; priority: number }>;
  active: boolean;
}
const VEHICLE_AR: Record<string, string> = {
  MOTORCYCLE: 'دراجة', CAR: 'سيارة', VAN: 'فان', ON_FOOT: 'على الأقدام',
};
const ZONE_TYPE_AR: Record<string, string> = {
  URBAN_CORE: 'مركز المدينة', URBAN_OUTER: 'أطراف المدينة',
  SUBURBAN: 'ضواحٍ', REMOTE: 'نائية',
};
const CSTATUS_AR: Record<string, string> = {
  AVAILABLE: 'متاح', ON_ROUTE: 'في جولة', OFF_DUTY: 'خارج الوردية', SUSPENDED: 'موقوف',
};

function Delivery() {
  const [tab, setTab] = useState<'couriers' | 'zones'>('couriers');
  const [couriers, setCouriers] = useState<CourierRow[] | null>(null);
  const [zones, setZones] = useState<ZoneRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [newC, setNewC] = useState({ code: '', fullName: '', phone: '+963', vehicleType: 'MOTORCYCLE', guarantorName: '', guarantorPhone: '' });
  const [newZ, setNewZ] = useState({ code: '', nameAr: '', governorate: 'DAMASCUS', city: 'دمشق', zoneType: 'URBAN_CORE', neighborhoods: '' });
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    api.get<CourierRow[]>('/admin/delivery/couriers').then(setCouriers).catch((e) =>
      setErr(e instanceof ApiError ? e.messageAr : 'تعذّر التحميل'));
    api.get<ZoneRow[]>('/admin/delivery/zones').then(setZones).catch(() => {});
  }, []);
  useEffect(load, [load]);

  const setStatus = async (code: string, status: string) => {
    setErr(null); setMsg(null);
    try {
      const body: any = { status };
      if (status === 'SUSPENDED') {
        const reason = prompt('سبب الإيقاف — يُقرأ لاحقاً ليُعرف أيُرفع أم لا:');
        if (!reason) return;
        body.reason = reason;
      }
      await api.post(`/admin/delivery/couriers/${code}/status`, body);
      setMsg(`${code}: ${CSTATUS_AR[status]}`); load();
    } catch (e) { setErr(e instanceof ApiError ? e.messageAr : 'تعذّر التغيير'); }
  };

  return (
    <>
      {err && <div className="err">{err}</div>}
      {msg && <div className="ok">{msg}</div>}

      <div className="row" style={{ marginBlockEnd: 12 }}>
        <div className="tabs">
          {([['couriers', 'المندوبون'], ['zones', 'المناطق']] as const).map(([v, l]) => (
            <button key={v} aria-pressed={tab === v} onClick={() => { setTab(v); setAdding(false); }}>{l}</button>
          ))}
        </div>
        <button className="btn" style={{ width: 'auto', padding: '0 16px' }}
          onClick={() => setAdding((a) => !a)}>
          {adding ? 'إلغاء' : tab === 'couriers' ? '+ مندوب' : '+ منطقة'}
        </button>
      </div>

      {adding && tab === 'couriers' && (
        <div className="card glass">
          <div className="grid2">
            <div className="field">
              <label>الرمز</label>
              <input dir="ltr" value={newC.code} placeholder="DMS-03"
                onChange={(e) => setNewC({ ...newC, code: e.target.value.toUpperCase() })} />
            </div>
            <div className="field">
              <label>الاسم الثلاثي</label>
              <input value={newC.fullName} onChange={(e) => setNewC({ ...newC, fullName: e.target.value })} />
            </div>
            <div className="field">
              <label>رقم الجوال</label>
              <input dir="ltr" inputMode="tel" value={newC.phone}
                onChange={(e) => setNewC({ ...newC, phone: e.target.value })} />
            </div>
            <div className="field">
              <label>المركبة</label>
              <select value={newC.vehicleType} onChange={(e) => setNewC({ ...newC, vehicleType: e.target.value })}>
                {Object.entries(VEHICLE_AR).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
            <div className="field">
              <label>اسم الكفيل</label>
              <input value={newC.guarantorName} onChange={(e) => setNewC({ ...newC, guarantorName: e.target.value })} />
            </div>
            <div className="field">
              <label>جوال الكفيل</label>
              <input dir="ltr" inputMode="tel" value={newC.guarantorPhone}
                onChange={(e) => setNewC({ ...newC, guarantorPhone: e.target.value })} />
            </div>
          </div>
          <span className="hint">
            إنشاء المندوب يُنشئ له حساب دخول بدور COURIER — بلا حساب لا يفتح تطبيقه.
          </span>
          <Btn label="أنشئ المندوب" onClick={async () => {
            setErr(null);
            try {
              await api.post('/admin/delivery/couriers', newC);
              setNewC({ code: '', fullName: '', phone: '+963', vehicleType: 'MOTORCYCLE', guarantorName: '', guarantorPhone: '' });
              setAdding(false); load();
            } catch (e) { setErr(e instanceof ApiError ? e.messageAr : 'تعذّر الإنشاء'); }
          }} />
        </div>
      )}

      {adding && tab === 'zones' && (
        <div className="card glass">
          <div className="grid2">
            <div className="field">
              <label>الرمز</label>
              <input dir="ltr" value={newZ.code} placeholder="DMS-S1"
                onChange={(e) => setNewZ({ ...newZ, code: e.target.value.toUpperCase() })} />
            </div>
            <div className="field">
              <label>الاسم</label>
              <input value={newZ.nameAr} placeholder="دمشق — الجنوب"
                onChange={(e) => setNewZ({ ...newZ, nameAr: e.target.value })} />
            </div>
            <div className="field">
              <label>المحافظة</label>
              <select value={newZ.governorate} onChange={(e) => setNewZ({ ...newZ, governorate: e.target.value })}>
                {Object.entries(GOV_AR).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
            <div className="field">
              <label>نموذج المنطقة</label>
              <select value={newZ.zoneType} onChange={(e) => setNewZ({ ...newZ, zoneType: e.target.value })}>
                {Object.entries(ZONE_TYPE_AR).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
          </div>
          <div className="field">
            <label>الأحياء (يفصل بينها فاصلة)</label>
            <textarea rows={2} value={newZ.neighborhoods} placeholder="المزة، دمر، كفرسوسة"
              onChange={(e) => setNewZ({ ...newZ, neighborhoods: e.target.value })} />
            <span className="hint">
              المطابقة بالاسم المطبَّع: «المزّة» و«المزه» تُطابقان «المزة».
              أضف المرادفات الشائعة ليقلّ ما يسقط خارج التقسيم.
            </span>
          </div>
          <Btn label="أنشئ المنطقة" onClick={async () => {
            setErr(null);
            try {
              await api.post('/admin/delivery/zones', {
                code: newZ.code, name: { ar: newZ.nameAr },
                governorate: newZ.governorate, city: newZ.city, zoneType: newZ.zoneType,
                neighborhoods: newZ.neighborhoods.split(/[،,]/).map((n) => n.trim()).filter(Boolean),
              });
              setNewZ({ code: '', nameAr: '', governorate: 'DAMASCUS', city: 'دمشق', zoneType: 'URBAN_CORE', neighborhoods: '' });
              setAdding(false); load();
            } catch (e) { setErr(e instanceof ApiError ? e.messageAr : 'تعذّر الإنشاء'); }
          }} />
        </div>
      )}

      {tab === 'couriers' && (couriers === null ? <p className="muted">جارٍ التحميل…</p>
        : !couriers.length ? <div className="empty"><p>لا مندوبين بعد.</p></div>
        : couriers.map((c) => (
          <div className="qrow glass" key={c.code}>
            <div className="top">
              <div>
                <div className="no">{c.code} · {c.fullName}</div>
                <div className="muted"><span dir="ltr">{c.phone}</span> · {VEHICLE_AR[c.vehicleType] ?? c.vehicleType}</div>
                <div className="muted">
                  اليوم {c.deliveredToday} من {c.dailyCapacity} · سقف نقدي {(c.cashCapUsdCents / 100).toFixed(0)}$
                </div>
                {c.guarantorName && <div className="muted">كفيل: {c.guarantorName} · <span dir="ltr">{c.guarantorPhone}</span></div>}
                {c.zones.length > 0 && (
                  <div className="muted">
                    مناطقه: {c.zones.sort((a, b) => a.priority - b.priority).map((z) => z.code).join(' · ')}
                  </div>
                )}
              </div>
              <div style={{ textAlign: 'end' }}>
                <span className={`tag ${c.status === 'SUSPENDED' ? 'tag--clay' : c.status === 'AVAILABLE' ? 'tag--jade' : ''}`}>
                  {c.statusAr}
                </span>
                {c.deliveredToday >= c.dailyCapacity && <div className="clock" data-urgent>بلغ سعته</div>}
              </div>
            </div>
            {c.suspensionReason && <div className="err" style={{ marginBlock: 8 }}>{c.suspensionReason}</div>}
            <div className="acts">
              <a className="btn btn--ghost" href={`tel:${c.phone}`}>اتصال</a>
              {c.status !== 'AVAILABLE' && <Btn label="متاح" onClick={() => setStatus(c.code, 'AVAILABLE')} />}
              {c.status !== 'OFF_DUTY' && <Btn label="خارج الوردية" kind="btn--ghost" onClick={() => setStatus(c.code, 'OFF_DUTY')} />}
              {c.status !== 'SUSPENDED' && <Btn label="أوقفه" kind="btn--danger" onClick={() => setStatus(c.code, 'SUSPENDED')} />}
            </div>
          </div>
        )))}

      {tab === 'zones' && (zones === null ? <p className="muted">جارٍ التحميل…</p>
        : !zones.length ? <div className="empty"><p>لا مناطق بعد.</p></div>
        : zones.map((z) => (
          <div className="qrow glass" key={z.code}>
            <div className="top">
              <div>
                <div className="no">{z.code} · {z.name?.ar}</div>
                <div className="muted">{GOV_AR[z.governorate] ?? z.governorate} · {ZONE_TYPE_AR[z.zoneType]}</div>
                <div className="muted">{z.neighborhoods.join(' · ')}</div>
                <div className="muted">
                  مهلة {z.slaHours} ساعة
                  {z.surchargeUsdCents > 0 && ` · رسم إضافي ${(z.surchargeUsdCents / 100).toFixed(2)}$`}
                </div>
              </div>
              <div style={{ textAlign: 'end' }}>
                <span className={`tag ${z.active ? 'tag--jade' : 'tag--clay'}`}>
                  {z.active ? 'فعّالة' : 'موقوفة'}
                </span>
              </div>
            </div>
            <div className="acts">
              {z.couriers.map((c) => (
                <span key={c.code} className="tag">{c.code} ({c.priority})</span>
              ))}
              <Btn label="+ اربط مندوباً" kind="btn--ghost" onClick={async () => {
                const code = prompt(`رمز المندوب لربطه بـ${z.code}:`);
                if (!code) return;
                const pr = Number(prompt('الأولوية (الأصغر أولى):', '10') ?? 10);
                try { await api.post(`/admin/delivery/zones/${z.code}/couriers`, { courierCode: code.toUpperCase(), priority: pr }); load(); }
                catch (e) { setErr(e instanceof ApiError ? e.messageAr : 'تعذّر الربط'); }
              }} />
            </div>
          </div>
        )))}
    </>
  );
}

/* ————— إعدادات المتجر ————— */
const SETTING_AR: Record<string, { label: string; hint?: string; kind: 'number' | 'boolean' | 'array'; money?: boolean }> = {
  store_paused: { label: 'إيقاف المتجر', kind: 'boolean', hint: 'يوقف استقبال الطلبات فوراً — للأزمات لا للإجازات.' },
  demo_mode: { label: 'وضع البيانات التجريبية', kind: 'boolean', hint: 'يُظهر المنتجات التجريبية في المتجر. أطفئه قبل الافتتاح.' },
  cod_max_order_usd_cents: { label: 'سقف الطلب الواحد', kind: 'number', money: true, hint: 'ما فوقه يحتاج موافقة أو استلاماً من المعرض.' },
  open_orders_per_phone_max: { label: 'طلبات مفتوحة لكل رقم', kind: 'number' },
  free_shipping_above_usd_cents: { label: 'شحن مجاني فوق', kind: 'number', money: true },
  courier_commission_bp: { label: 'عمولة المندوب (نقطة أساس)', kind: 'number', hint: '500 = 5%.' },
  confirmation_window_hours: { label: 'نافذة تثبيت السعر (ساعة)', kind: 'number' },
  order_hold_hours: { label: 'الحجز الأوّلي (ساعة)', kind: 'number' },
  order_hold_ext_hours: { label: 'الحجز المُمدَّد (ساعة)', kind: 'number' },
  rare_stock_threshold: { label: 'حد الجهاز النادر', kind: 'number', hint: 'عند هذه الكمية أو أقل تُقصَّر مهلة الحجز.' },
  rare_hold_ext_hours: { label: 'حجز النادر المُمدَّد (ساعة)', kind: 'number' },
  cash_rounding_step_syp: { label: 'وحدة التقريب النقدي', kind: 'number' },
  served_governorates: { label: 'المحافظات المخدومة', kind: 'array' },
};

function Settings() {
  const [rows, setRows] = useState<Array<{ key: string; value: any }> | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    api.get<Array<{ key: string; value: any }>>('/admin/settings')
      .then((r) => { setRows(r); setDraft(Object.fromEntries(r.map((x) => [x.key, String(x.value)]))); })
      .catch((e) => setErr(e instanceof ApiError ? e.messageAr : 'تعذّر التحميل'));
  }, []);
  useEffect(load, [load]);

  const save = async (key: string, value: unknown) => {
    setErr(null); setMsg(null);
    try {
      await api.post('/admin/settings', { key, value });
      setMsg(`حُفظ: ${SETTING_AR[key]?.label ?? key}`);
      load();
    } catch (e) { setErr(e instanceof ApiError ? e.messageAr : 'تعذّر الحفظ'); }
  };

  if (rows === null) return <p className="muted">جارٍ التحميل…</p>;

  const paused = rows.find((r) => r.key === 'store_paused')?.value === true;

  return (
    <>
      {err && <div className="err">{err}</div>}
      {msg && <div className="ok">{msg}</div>}
      {paused && <div className="err">المتجر متوقف الآن — لا يستقبل أي طلب جديد.</div>}

      <p className="warnbox">
        كل تغيير هنا يُسجَّل في سجل التدقيق باسم من غيّره. المبالغ بسنتات
        الدولار لأن المرجع بالدولار — والليرة تُحسب من سعر الصرف.
      </p>

      {rows.map((r) => {
        const meta = SETTING_AR[r.key];
        if (!meta) return null;

        if (meta.kind === 'boolean') {
          const on = r.value === true;
          return (
            <div className="card glass" key={r.key}>
              <div className="line" style={{ alignItems: 'start' }}>
                <span className="mid">
                  <b>{meta.label}</b>
                  {meta.hint && <small className="muted">{meta.hint}</small>}
                </span>
                <button
                  className={`btn ${on ? 'btn--danger' : 'btn--ghost'}`}
                  style={{ width: 'auto', padding: '0 16px', flexShrink: 0 }}
                  onClick={() => save(r.key, !on)}
                >
                  {on ? 'مُفعَّل — أطفئه' : 'مُطفأ — فعّله'}
                </button>
              </div>
            </div>
          );
        }

        if (meta.kind === 'array') {
          const list: string[] = Array.isArray(r.value) ? r.value : [];
          return (
            <div className="card glass" key={r.key}>
              <b>{meta.label}</b>
              <div className="tabs" style={{ flexWrap: 'wrap', marginBlock: 8 }}>
                {Object.entries(GOV_AR).map(([code, label]) => {
                  const on = list.includes(code);
                  return (
                    <button key={code} aria-pressed={on}
                      onClick={() => save(r.key, on ? list.filter((g) => g !== code) : [...list, code])}>
                      {label}
                    </button>
                  );
                })}
              </div>
              <span className="hint">محافظة غير مختارة يُرفض الطلب إليها عند إتمام الشراء.</span>
            </div>
          );
        }

        const cur = draft[r.key] ?? String(r.value);
        const changed = cur !== String(r.value);
        return (
          <div className="card glass" key={r.key}>
            <div className="field">
              <label htmlFor={`s-${r.key}`}>{meta.label}</label>
              <input id={`s-${r.key}`} dir="ltr" inputMode="numeric" value={cur}
                onChange={(e) => setDraft((d) => ({ ...d, [r.key]: e.target.value }))} />
              {meta.money && <span className="hint">{(Number(cur) / 100).toFixed(2)} $</span>}
              {meta.hint && <span className="hint">{meta.hint}</span>}
            </div>
            {changed && (
              <div className="acts">
                <Btn label="احفظ" onClick={() => save(r.key, Number(cur))} />
                <button className="btn btn--ghost"
                  onClick={() => setDraft((d) => ({ ...d, [r.key]: String(r.value) }))}>
                  تراجع
                </button>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

/* ————— محرّر المنتج ————— */
interface EditorVariant {
  sku: string; priceUsdCents: string; compareAtPriceUsdCents: string; costPriceUsdCents: string;
  storageGb: string; ramGb: string; colorNameAr: string; colorCode: string;
  condition: string; deviceOrigin: string; warrantyType: string; warrantyMonths: string;
  dualSim: boolean; partCode: string; onHand?: number;
}
const emptyVariant = (): EditorVariant => ({
  sku: '', priceUsdCents: '', compareAtPriceUsdCents: '', costPriceUsdCents: '',
  storageGb: '', ramGb: '', colorNameAr: '', colorCode: '#000000',
  condition: 'NEW', deviceOrigin: 'GULF', warrantyType: 'STORE', warrantyMonths: '12',
  dualSim: true, partCode: '',
});

const CONDITION_AR: Record<string, string> = {
  NEW: 'جديد', OPEN_BOX: 'مفتوح العلبة', REFURBISHED: 'مجدَّد',
  USED_A: 'مستعمل — ممتاز', USED_B: 'مستعمل — جيد',
};
const ORIGIN_AR: Record<string, string> = {
  GULF: 'خليجي', EURO: 'أوروبي', US: 'أمريكي', ASIA: 'آسيوي', OTHER: 'غير ذلك',
};
const WARRANTY_AR: Record<string, string> = {
  STORE: 'كفالة المحل', AGENT: 'كفالة الوكيل', IMPORTER: 'كفالة المستورد', NONE: 'بلا كفالة',
};
const STATUS_PROD_AR: Record<string, string> = {
  DRAFT: 'مسوّدة', IN_REVIEW: 'قيد المراجعة', PUBLISHED: 'منشور', ARCHIVED: 'مسحوب',
};

function ProductEditor({ slug, onDone }: { slug: string | null; onDone: () => void }) {
  const [brands, setBrands] = useState<Array<{ slug: string; name: any }>>([]);
  const [cats, setCats] = useState<Array<{ slug: string; name: any; depth: number }>>([]);
  const [f, setF] = useState({
    slug: '', brandSlug: '', categorySlug: '', nameAr: '', nameEn: '',
    shortDescAr: '', descriptionAr: '', status: 'DRAFT',
  });
  const [variants, setVariants] = useState<EditorVariant[]>([emptyVariant()]);
  const [media, setMedia] = useState<Array<{ id: string; url: string }>>([]);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<any[]>('/admin/catalog/brands').then(setBrands).catch(() => {});
    api.get<any[]>('/admin/catalog/categories').then(setCats).catch(() => {});
  }, []);

  useEffect(() => {
    if (!slug) return;
    api.get<any>(`/admin/catalog/product/${slug}`).then((p) => {
      setF({
        slug: p.slug, brandSlug: p.brandSlug, categorySlug: p.categorySlug,
        nameAr: p.name?.ar ?? '', nameEn: p.name?.en ?? '',
        shortDescAr: p.shortDesc?.ar ?? '', descriptionAr: p.description?.ar ?? '',
        status: p.status,
      });
      setMedia(p.media ?? []);
      setVariants((p.variants ?? []).map((v: any) => ({
        sku: v.sku,
        priceUsdCents: String(v.priceUsdCents),
        compareAtPriceUsdCents: v.compareAtPriceUsdCents ? String(v.compareAtPriceUsdCents) : '',
        costPriceUsdCents: v.costPriceUsdCents ? String(v.costPriceUsdCents) : '',
        storageGb: v.storageGb != null ? String(v.storageGb) : '',
        ramGb: v.ramGb != null ? String(v.ramGb) : '',
        colorNameAr: v.colorName?.ar ?? '', colorCode: v.colorCode ?? '#000000',
        condition: v.condition, deviceOrigin: v.deviceOrigin,
        warrantyType: v.warrantyType, warrantyMonths: String(v.warrantyMonths),
        dualSim: v.dualSim, partCode: v.partCode ?? '', onHand: v.onHand,
      })));
    }).catch((e) => setErr(e instanceof ApiError ? e.messageAr : 'تعذّر التحميل'));
  }, [slug]);

  const setV = (i: number, k: keyof EditorVariant, val: any) =>
    setVariants((vs) => vs.map((v, n) => (n === i ? { ...v, [k]: val } : v)));

  /* الصورة تُقرأ في المتصفح وتُرسل داخل JSON: لا حاجة إلى multipart
     ولا إلى مكتبة رفع، والملف يمرّ بالمسار المصادَق عليه نفسه. */
  const upload = async (file: File) => {
    if (file.size > 3 * 1024 * 1024) { setErr('الصورة أكبر من ثلاثة ميغابايت — اضغطها أولاً'); return; }
    setErr(null); setBusy(true);
    try {
      const dataUrl = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.onerror = () => rej(new Error('read'));
        r.readAsDataURL(file);
      });
      const m = await api.post<{ id: string; url: string }>(
        `/admin/catalog/product/${f.slug}/media`, { dataUrl });
      setMedia((ms) => [...ms, m]);
    } catch (e) {
      setErr(e instanceof ApiError ? e.messageAr : 'تعذّر رفع الصورة');
    } finally { setBusy(false); }
  };

  const save = async () => {
    setErr(null); setMsg(null);
    const payload = {
      slug: f.slug, brandSlug: f.brandSlug, categorySlug: f.categorySlug,
      name: { ar: f.nameAr, ...(f.nameEn ? { en: f.nameEn } : {}) },
      shortDesc: f.shortDescAr ? { ar: f.shortDescAr } : null,
      description: f.descriptionAr ? { ar: f.descriptionAr } : null,
      status: f.status,
      variants: variants.map((v) => ({
        sku: v.sku.trim().toUpperCase(),
        priceUsdCents: Number(v.priceUsdCents),
        compareAtPriceUsdCents: v.compareAtPriceUsdCents ? Number(v.compareAtPriceUsdCents) : null,
        costPriceUsdCents: v.costPriceUsdCents ? Number(v.costPriceUsdCents) : null,
        storageGb: v.storageGb ? Number(v.storageGb) : null,
        ramGb: v.ramGb ? Number(v.ramGb) : null,
        colorName: v.colorNameAr ? { ar: v.colorNameAr } : null,
        colorCode: v.colorCode || null,
        condition: v.condition, deviceOrigin: v.deviceOrigin,
        warrantyType: v.warrantyType, warrantyMonths: Number(v.warrantyMonths || 0),
        dualSim: v.dualSim, partCode: v.partCode || null,
      })),
    };
    try {
      await api.post('/admin/catalog/product', payload);
      setMsg('حُفظ المنتج.');
      onDone();
    } catch (e) { setErr(e instanceof ApiError ? e.messageAr : 'تعذّر الحفظ'); }
  };

  return (
    <>
      {err && <div className="err">{err}</div>}
      {msg && <div className="ok">{msg}</div>}

      <div className="card glass">
        <div className="grid2">
          <div className="field">
            <label htmlFor="pn">الاسم بالعربية <span className="req">*</span></label>
            <input id="pn" value={f.nameAr} onChange={(e) => setF({ ...f, nameAr: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="pe">الاسم بالإنجليزية</label>
            <input id="pe" dir="ltr" value={f.nameEn} onChange={(e) => setF({ ...f, nameEn: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="ps">المُعرِّف في الرابط <span className="req">*</span></label>
            <input id="ps" dir="ltr" value={f.slug} placeholder="samsung-galaxy-a55"
              disabled={Boolean(slug)}
              onChange={(e) => setF({ ...f, slug: e.target.value })} />
            {slug && <span className="hint">لا يُغيَّر بعد النشر — الروابط القديمة تنكسر.</span>}
          </div>
          <div className="field">
            <label htmlFor="pst">الحالة</label>
            <select id="pst" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
              {Object.entries(STATUS_PROD_AR).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="pb">العلامة <span className="req">*</span></label>
            <select id="pb" value={f.brandSlug} onChange={(e) => setF({ ...f, brandSlug: e.target.value })}>
              <option value="">— اختر —</option>
              {brands.map((b) => <option key={b.slug} value={b.slug}>{b.name?.ar ?? b.slug}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="pc">الفئة <span className="req">*</span></label>
            <select id="pc" value={f.categorySlug} onChange={(e) => setF({ ...f, categorySlug: e.target.value })}>
              <option value="">— اختر —</option>
              {cats.map((c) => (
                <option key={c.slug} value={c.slug}>{'— '.repeat(c.depth)}{c.name?.ar ?? c.slug}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="pd">وصف مختصر</label>
          <input id="pd" value={f.shortDescAr} onChange={(e) => setF({ ...f, shortDescAr: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="pl">الوصف الكامل</label>
          <textarea id="pl" rows={4} value={f.descriptionAr}
            onChange={(e) => setF({ ...f, descriptionAr: e.target.value })} />
        </div>
      </div>

      {slug && (
        <div className="card glass">
          <b style={{ fontSize: 'var(--step--1)' }}>الصور</b>
          <div className="thumbs">
            {media.map((m) => (
              <div className="thumb" key={m.id}>
                <img src={m.url} alt="" loading="lazy" />
                <button aria-label="حذف" onClick={async () => {
                  await api.del(`/admin/catalog/media/${m.id}`).catch(() => {});
                  setMedia((ms) => ms.filter((x) => x.id !== m.id));
                }}>×</button>
              </div>
            ))}
          </div>
          <label className="btn btn--ghost" style={{ marginBlockStart: 10, cursor: 'pointer' }}>
            {busy ? 'جارٍ الرفع…' : 'أضف صورة'}
            <input type="file" accept="image/*" hidden
              onChange={(e) => { const fl = e.target.files?.[0]; if (fl) void upload(fl); e.currentTarget.value = ''; }} />
          </label>
          <span className="hint">JPEG أو PNG أو WebP، حتى ثلاثة ميغابايت. الأولى هي الرئيسية.</span>
        </div>
      )}

      <h2 style={{ fontSize: 'var(--step-0)', margin: '18px 0 8px' }}>المتغيّرات</h2>
      <p className="warnbox">
        الأسعار بسنتات الدولار (٢٣٠٠٠ = ٢٣٠٫٠٠$). المرجع بالدولار والعرض بالليرة
        يُحسب من سعر الصرف — فلا تُراجَع آلاف الأسعار بعد كل قفزة.
      </p>

      {variants.map((v, i) => (
        <div className="card glass" key={i}>
          <div className="grid2">
            <div className="field">
              <label>رمز التخزين SKU <span className="req">*</span></label>
              <input dir="ltr" value={v.sku} placeholder="SMA55-256-BLK-GULF"
                onChange={(e) => setV(i, 'sku', e.target.value)} />
            </div>
            <div className="field">
              <label>السعر (سنت) <span className="req">*</span></label>
              <input dir="ltr" inputMode="numeric" value={v.priceUsdCents}
                onChange={(e) => setV(i, 'priceUsdCents', e.target.value)} />
              {v.priceUsdCents && <span className="hint">{(Number(v.priceUsdCents) / 100).toFixed(2)} $</span>}
            </div>
            <div className="field">
              <label>السعر المشطوب (سنت)</label>
              <input dir="ltr" inputMode="numeric" value={v.compareAtPriceUsdCents}
                onChange={(e) => setV(i, 'compareAtPriceUsdCents', e.target.value)} />
            </div>
            <div className="field">
              <label>تكلفتك (سنت)</label>
              <input dir="ltr" inputMode="numeric" value={v.costPriceUsdCents}
                onChange={(e) => setV(i, 'costPriceUsdCents', e.target.value)} />
              <span className="hint">لا تظهر للزبون — تُستعمل في تقرير الربحية.</span>
            </div>
            <div className="field">
              <label>السعة (جيجا)</label>
              <input dir="ltr" inputMode="numeric" value={v.storageGb}
                onChange={(e) => setV(i, 'storageGb', e.target.value)} />
            </div>
            <div className="field">
              <label>الذاكرة (جيجا)</label>
              <input dir="ltr" inputMode="numeric" value={v.ramGb}
                onChange={(e) => setV(i, 'ramGb', e.target.value)} />
            </div>
            <div className="field">
              <label>اللون</label>
              <input value={v.colorNameAr} placeholder="أسود فحمي"
                onChange={(e) => setV(i, 'colorNameAr', e.target.value)} />
            </div>
            <div className="field">
              <label>رمز اللون</label>
              <input type="color" value={v.colorCode}
                onChange={(e) => setV(i, 'colorCode', e.target.value)} />
            </div>
            <div className="field">
              <label>الحالة</label>
              <select value={v.condition} onChange={(e) => setV(i, 'condition', e.target.value)}>
                {Object.entries(CONDITION_AR).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
            <div className="field">
              <label>المنشأ</label>
              <select value={v.deviceOrigin} onChange={(e) => setV(i, 'deviceOrigin', e.target.value)}>
                {Object.entries(ORIGIN_AR).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
            <div className="field">
              <label>نوع الكفالة</label>
              <select value={v.warrantyType} onChange={(e) => setV(i, 'warrantyType', e.target.value)}>
                {Object.entries(WARRANTY_AR).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
            <div className="field">
              <label>مدة الكفالة (شهر)</label>
              <input dir="ltr" inputMode="numeric" value={v.warrantyMonths}
                onChange={(e) => setV(i, 'warrantyMonths', e.target.value)} />
            </div>
            <div className="field">
              <label>رمز النسخة</label>
              <input dir="ltr" value={v.partCode} placeholder="ZA/A"
                onChange={(e) => setV(i, 'partCode', e.target.value)} />
              <span className="hint">يبحث به السوق السوري كثيراً.</span>
            </div>
            <div className="field">
              <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="checkbox" checked={v.dualSim} style={{ width: 'auto', minHeight: 'auto' }}
                  onChange={(e) => setV(i, 'dualSim', e.target.checked)} />
                شريحتان
              </label>
            </div>
          </div>
          <div className="row">
            {v.onHand !== undefined && <span className="muted">المخزون: {v.onHand}</span>}
            {variants.length > 1 && (
              <button className="btn btn--danger" style={{ minHeight: 34, padding: '0 12px', width: 'auto' }}
                onClick={() => setVariants((vs) => vs.filter((_, n) => n !== i))}>
                احذف المتغيّر
              </button>
            )}
          </div>
        </div>
      ))}

      <div className="acts">
        <button className="btn btn--ghost" onClick={() => setVariants((vs) => [...vs, emptyVariant()])}>
          أضف متغيّراً
        </button>
        <Btn label="احفظ المنتج" onClick={save} />
      </div>
    </>
  );
}

/* ————— الكتالوج: تحويل المنتجات التجريبية إلى حقيقية ————— */
interface AdminProduct {
  slug: string; name: { ar: string; en?: string }; status: string; isDemo: boolean;
  brand: { ar: string; en?: string };
  variants: Array<{ sku: string; priceUsdCents: number; onHand: number; reserved: number }>;
}

function Catalog() {
  const [rows, setRows] = useState<AdminProduct[] | null>(null);
  const [editing, setEditing] = useState<string | null | undefined>(undefined);
  const [filter, setFilter] = useState<'all' | 'demo' | 'real'>('real');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(() => {
    const q = filter === 'all' ? '' : `?demo=${filter === 'demo'}`;
    api.get<AdminProduct[]>(`/admin/catalog/products${q}`).then(setRows)
      .catch((e) => setErr(e instanceof ApiError ? e.messageAr : 'تعذّر تحميل الكتالوج'));
  }, [filter]);
  useEffect(() => { setRows(null); load(); }, [load]);

  const label = filter === 'demo' ? 'منتجاً تجريبياً' : filter === 'real' ? 'منتجاً حقيقياً' : 'منتجاً';

  // undefined = القائمة · null = منتج جديد · نص = تعديل منتج قائم
  if (editing !== undefined) {
    return (
      <>
        <button className="btn btn--ghost" style={{ marginBlockEnd: 12 }}
          onClick={() => { setEditing(undefined); load(); }}>
          ← عودة للقائمة
        </button>
        <ProductEditor slug={editing} onDone={() => { setEditing(undefined); load(); }} />
      </>
    );
  }

  return (
    <>
      <div className="row" style={{ marginBlockEnd: 12 }}>
        <div className="tabs">
          {([['real', 'حقيقية'], ['demo', 'تجريبية'], ['all', 'الكل']] as const).map(([v, l]) => (
            <button key={v} aria-pressed={filter === v} onClick={() => setFilter(v)}>{l}</button>
          ))}
        </div>
        <button className="btn" style={{ width: 'auto', padding: '0 16px' }}
          onClick={() => setEditing(null)}>
          + منتج جديد
        </button>
      </div>

      {err && <div className="err">{err}</div>}
      {msg && <div className="ok">{msg}</div>}

      <p className="warnbox">
        التحويل يصفّر المخزون الوهمي: المنتج يصير حقيقياً بكمية صفر، ولا يُباع
        حتى تستلم بضاعته فعلياً من المشتريات. هذا يمنع بيع ما لا تملكه.
      </p>

      {rows === null ? <p className="muted">جارٍ التحميل…</p>
        : rows.length === 0 ? <div className="empty"><p>لا منتجات في هذا التصنيف.</p></div>
        : (
          <>
            <p className="muted" style={{ marginBlockEnd: 8 }}>{rows.length} {label}</p>
            {rows.map((p) => {
              const onHand = p.variants.reduce((a, v) => a + v.onHand, 0);
              const held = p.variants.reduce((a, v) => a + v.reserved, 0);
              return (
                <div className="card glass" key={p.slug}>
                  <div className="line" style={{ alignItems: 'start' }}>
                    <span className="mid">
                      <b>{p.name.ar}</b>
                      <small className="muted">{p.brand.ar} · {p.variants.length} متغيّراً · مخزون {onHand}</small>
                    </span>
                    <span className={`tag ${p.isDemo ? 'tag--clay' : 'tag--jade'}`} style={{ flexShrink: 0 }}>
                      {p.isDemo ? 'تجريبي' : 'حقيقي'}
                    </span>
                  </div>

                  <div className="acts" style={{ marginBlockStart: 8 }}>
                    <button className="btn btn--ghost" style={{ width: 'auto', padding: '0 14px' }}
                      onClick={() => setEditing(p.slug)}>
                      عدّله
                    </button>
                  </div>

                  {p.isDemo && (
                    confirming === p.slug ? (
                      <div className="row" style={{ gap: 8, marginBlockStart: 10 }}>
                        <Btn
                          label={`أكّد — سيُصفَّر ${onHand}`}
                          onClick={async () => {
                            setErr(null); setMsg(null);
                            try {
                              const r = await api.post<{ demoStockCleared: number }>(
                                `/admin/catalog/products/${p.slug}/promote`, {},
                                { 'idempotency-key': idemKey() },
                              );
                              setMsg(`${p.name.ar}: صار حقيقياً — صُفِّر ${r.demoStockCleared} من المخزون الوهمي.`);
                              setConfirming(null); load();
                            } catch (e) {
                              setErr(e instanceof ApiError ? e.messageAr : 'تعذّر التحويل');
                              setConfirming(null);
                            }
                          }}
                        />
                        <button className="btn btn--ghost" onClick={() => setConfirming(null)}>تراجع</button>
                      </div>
                    ) : (
                      <button
                        className="btn"
                        style={{ marginBlockStart: 10 }}
                        disabled={held > 0}
                        onClick={() => { setErr(null); setMsg(null); setConfirming(p.slug); }}
                      >
                        {held > 0 ? `عليه ${held} حجزاً — لا يمكن التحويل` : 'حوّله إلى منتج حقيقي'}
                      </button>
                    )
                  )}
                </div>
              );
            })}
          </>
        )}
    </>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<'password' | 'otp'>('password');
  const [phone, setPhone] = useState('+963');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'phone' | 'code'>('phone');
  const [err, setErr] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const reset = () => { setErr(null); setHint(null); };

  return (
    <div className="page" style={{ maxWidth: 420, marginInline: 'auto', paddingBlockStart: 48 }}>
      <h1 style={{ fontSize: 'var(--step-2)', fontWeight: 800, letterSpacing: '-0.02em' }}>
        تالي شام — الإدارة
      </h1>

      {/* كلمة السرّ أولاً: الرمز يعتمد على مزوّد رسائل قد ينقطع،
          ولوحة التحكم يجب أن تُفتح حتى حين ينقطع */}
      <div className="tabs" style={{ marginBlockEnd: 12 }}>
        {([['password', 'كلمة السرّ'], ['otp', 'رمز واتساب']] as const).map(([v, l]) => (
          <button key={v} aria-pressed={mode === v}
            onClick={() => { setMode(v); reset(); setStage('phone'); }}>{l}</button>
        ))}
      </div>

      {err && <div className="err">{err}</div>}
      {hint && <div className="ok">{hint}</div>}

      <div className="card glass">
        <div className="field">
          <label htmlFor="ph">رقم الجوال</label>
          <input id="ph" value={phone} onChange={(e) => setPhone(e.target.value)}
            dir="ltr" inputMode="tel" autoComplete="username" />
        </div>

        {mode === 'password' ? (
          <>
            <div className="field">
              <label htmlFor="pw">كلمة السرّ</label>
              <input id="pw" type={show ? 'text' : 'password'} value={password}
                onChange={(e) => setPassword(e.target.value)} dir="ltr" autoComplete="current-password"
                onKeyDown={(e) => { if (e.key === 'Enter') (document.getElementById('go') as HTMLButtonElement)?.click(); }} />
              <label className="hint" style={{ display: 'flex', gap: 6, alignItems: 'center', marginBlockStart: 6 }}>
                <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)}
                  style={{ width: 'auto', minHeight: 'auto' }} />
                أظهر كلمة السرّ
              </label>
            </div>
            <Btn
              label="دخول"
              onClick={async () => {
                reset();
                try {
                  const r = await api.post<{ accessToken: string; refreshToken: string }>(
                    '/auth/password/login', { phone, password });
                  tokens.set(r.accessToken, r.refreshToken);
                  onDone();
                } catch (e) { setErr(e instanceof ApiError ? e.messageAr : 'تعذّر الدخول'); }
              }}
            />
          </>
        ) : stage === 'phone' ? (
          <Btn
            label="أرسل الرمز"
            onClick={async () => {
              reset();
              try {
                const r = await api.post<{ devCode?: string; expiresInSec: number }>(
                  '/auth/otp/request', { phone });
                setStage('code');
                setHint(r.devCode
                  ? `وضع التطوير — الرمز ${r.devCode}`
                  : `أُرسل الرمز، صالح ${Math.round(r.expiresInSec / 60)} دقائق.`);
              } catch (e) { setErr(e instanceof ApiError ? e.messageAr : 'تعذّر الإرسال'); }
            }}
          />
        ) : (
          <>
            <div className="field">
              <label htmlFor="cd">رمز التحقق</label>
              <input id="cd" value={code} onChange={(e) => setCode(e.target.value)}
                dir="ltr" inputMode="numeric" maxLength={6} autoComplete="one-time-code" />
            </div>
            <Btn
              label="دخول"
              onClick={async () => {
                reset();
                try {
                  const r = await api.post<{ accessToken: string; refreshToken: string }>(
                    '/auth/otp/verify', { phone, code });
                  tokens.set(r.accessToken, r.refreshToken);
                  onDone();
                } catch (e) { setErr(e instanceof ApiError ? e.messageAr : 'تعذّر الدخول'); }
              }}
            />
            <button className="btn btn--ghost" onClick={() => { setStage('phone'); setCode(''); }}>
              تغيير الرقم
            </button>
          </>
        )}
      </div>

      <p className="muted" style={{ fontSize: '0.72rem' }}>
        الدخول متاح لأدوار الإدارة والعمليات والمندوب فقط. حساب العميل لن يرى هذه اللوحة،
        ولا كلمة سرّ له أصلاً — الزبائن يدخلون برمز واتساب.
      </p>
    </div>
  );
}

/* ————— تغيير كلمة السرّ ————— */
function PasswordScreen() {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const match = next.length > 0 && next === again;

  return (
    <div style={{ maxWidth: 460 }}>
      {err && <div className="err">{err}</div>}
      {msg && <div className="ok">{msg}</div>}
      <p className="warnbox">
        تغيير كلمة السرّ يُبطل كل جلساتك على كل الأجهزة — وهذا مقصود:
        تغييرها إعلانٌ بأن القديمة لم تعد تُؤتمن.
      </p>
      <div className="card glass">
        <div className="field">
          <label htmlFor="p0">كلمة السرّ الحالية</label>
          <input id="p0" type="password" dir="ltr" value={cur} onChange={(e) => setCur(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="p1">الجديدة</label>
          <input id="p1" type="password" dir="ltr" value={next} onChange={(e) => setNext(e.target.value)} />
          <span className="hint">عشرة محارف على الأقل. الطول أهم من الرموز.</span>
        </div>
        <div className="field">
          <label htmlFor="p2">أعِد الجديدة</label>
          <input id="p2" type="password" dir="ltr" value={again} onChange={(e) => setAgain(e.target.value)} />
          {again.length > 0 && !match && <span className="hint" style={{ color: 'var(--clay)' }}>لا تتطابقان</span>}
        </div>
        <Btn
          label="غيّرها"
          disabled={!match || cur.length === 0}
          onClick={async () => {
            setErr(null); setMsg(null);
            try {
              await api.post('/auth/password/change', { currentPassword: cur, newPassword: next });
              setMsg('غُيّرت كلمة السرّ — ستُطالَب بالدخول من جديد.');
              setTimeout(() => { tokens.clear(); window.dispatchEvent(new Event('auth:expired')); }, 1500);
            } catch (e) { setErr(e instanceof ApiError ? e.messageAr : 'تعذّر التغيير'); }
          }}
        />
      </div>
    </div>
  );
}


/* ————— المشتريات والموردون (الفصل 16) ————— */
interface SupplierRow {
  code: string; name: string; contactName: string | null; contactPhone: string | null;
  country: string | null; leadTimeDays: number; isActive: boolean; poCount: number;
}
interface PoRow {
  poNo: string; supplier: { code: string; name: string }; state: string;
  goodsUsdCents: number; extraUsdCents: number; totalUsdCents: number; landedFactor: number;
  expectedAt: string | null; receivedAt: string | null;
  lines: Array<{ sku: string; name: string; qty: number; qtyReceived: number;
    unitCostUsdCents: number; landedUnitCostUsdCents: number }>;
}

const usd = (c: number) => `${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;

function Procurement() {
  const [tab, setTab] = useState<'pos' | 'suppliers' | 'alerts'>('pos');
  const [pos, setPos] = useState<PoRow[] | null>(null);
  const [sups, setSups] = useState<SupplierRow[] | null>(null);
  const [alerts, setAlerts] = useState<any[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newS, setNewS] = useState({ code: '', name: '', contactPhone: '', leadTimeDays: 14 });
  const [newPo, setNewPo] = useState({ supplierCode: '', sku: '', qty: 1, unitCostUsd: '', extraUsd: '' });

  const load = useCallback(() => {
    api.get<PoRow[]>('/admin/procurement/purchase-orders').then(setPos).catch((e) =>
      setErr(e instanceof ApiError ? e.messageAr : 'تعذّر التحميل'));
    api.get<SupplierRow[]>('/admin/procurement/suppliers').then(setSups).catch(() => {});
    api.get<any[]>('/admin/procurement/alerts').then(setAlerts).catch(() => {});
  }, []);
  useEffect(load, [load]);

  return (
    <>
      {err && <div className="err">{err}</div>}
      <p className="warnbox">
        التكلفة بالدولار لا بالليرة: الربح المحسوب بالليرة على بضاعة اشتُريت
        بالدولار ليس ربحاً بل أثرَ صرف، ومن يوزّعه يعجز عن إعادة الشراء.
      </p>

      <div className="tabs">
        {([['pos', 'أوامر الشراء'], ['suppliers', 'الموردون'], ['alerts', 'تنبيهات']] as const).map(([v, l]) => (
          <button key={v} aria-pressed={tab === v} onClick={() => { setTab(v); setAdding(false); }}>{l}</button>
        ))}
      </div>

      <button className="btn btn--ghost" type="button" onClick={() => setAdding(!adding)}>
        {adding ? 'إلغاء' : tab === 'suppliers' ? '+ مورد' : '+ أمر شراء'}
      </button>

      {adding && tab === 'suppliers' && (
        <div className="card glass">
          <div className="field"><label htmlFor="sc">الرمز</label>
            <input id="sc" dir="ltr" value={newS.code} onChange={(e) => setNewS({ ...newS, code: e.target.value })} /></div>
          <div className="field"><label htmlFor="sn">الاسم</label>
            <input id="sn" value={newS.name} onChange={(e) => setNewS({ ...newS, name: e.target.value })} /></div>
          <div className="field"><label htmlFor="sp">هاتف التواصل</label>
            <input id="sp" dir="ltr" value={newS.contactPhone} onChange={(e) => setNewS({ ...newS, contactPhone: e.target.value })} /></div>
          <div className="field"><label htmlFor="sl">مهلة التوريد (أيام)</label>
            <input id="sl" type="number" value={newS.leadTimeDays}
              onChange={(e) => setNewS({ ...newS, leadTimeDays: Number(e.target.value) })} /></div>
          <Btn label="أضف المورد" onClick={async () => {
            setErr(null);
            try { await api.post('/admin/procurement/suppliers', newS); setAdding(false); load(); }
            catch (e) { setErr(e instanceof ApiError ? e.messageAr : 'تعذّرت الإضافة'); }
          }} />
        </div>
      )}

      {adding && tab === 'pos' && (
        <div className="card glass">
          <div className="field"><label htmlFor="ps">المورد</label>
            <select id="ps" value={newPo.supplierCode} onChange={(e) => setNewPo({ ...newPo, supplierCode: e.target.value })}>
              <option value="">— اختر —</option>
              {(sups ?? []).filter((s) => s.isActive).map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
            </select></div>
          <div className="field"><label htmlFor="pk">رمز التخزين (SKU)</label>
            <input id="pk" dir="ltr" value={newPo.sku} onChange={(e) => setNewPo({ ...newPo, sku: e.target.value })} /></div>
          <div className="field"><label htmlFor="pq">الكمية</label>
            <input id="pq" type="number" value={newPo.qty} onChange={(e) => setNewPo({ ...newPo, qty: Number(e.target.value) })} /></div>
          <div className="field"><label htmlFor="pc">تكلفة الوحدة ($)</label>
            <input id="pc" type="number" dir="ltr" value={newPo.unitCostUsd}
              onChange={(e) => setNewPo({ ...newPo, unitCostUsd: e.target.value })} /></div>
          <div className="field"><label htmlFor="pe">شحن وجمارك ($)</label>
            <input id="pe" type="number" dir="ltr" value={newPo.extraUsd}
              onChange={(e) => setNewPo({ ...newPo, extraUsd: e.target.value })} />
            <span className="hint">تُوزَّع على الوحدات بالقيمة لا بالعدد</span></div>
          <Btn label="أصدِر الأمر" disabled={!newPo.supplierCode || !newPo.sku} onClick={async () => {
            setErr(null);
            try {
              await api.post('/admin/procurement/purchase-orders', {
                supplierCode: newPo.supplierCode,
                lines: [{ sku: newPo.sku, qty: newPo.qty, unitCostUsdCents: Math.round(Number(newPo.unitCostUsd) * 100) }],
                extraUsdCents: Math.round(Number(newPo.extraUsd || 0) * 100),
              });
              setAdding(false); load();
            } catch (e) { setErr(e instanceof ApiError ? e.messageAr : 'تعذّر الإصدار'); }
          }} />
        </div>
      )}

      {tab === 'pos' && (pos === null ? <p className="muted">جارٍ التحميل…</p>
        : !pos.length ? <div className="empty"><p>لا أوامر شراء بعد.</p></div>
        : pos.map((p) => (
          <div key={p.poNo} className="card glass">
            <div className="row">
              <b className="tnum">{p.poNo}</b>
              <span className="tag">{p.state}</span>
              <span className="muted">{p.supplier.name}</span>
            </div>
            <div className="grid2">
              <div><small className="muted">البضاعة</small><div className="tnum">{usd(p.goodsUsdCents)}</div></div>
              <div><small className="muted">التكاليف</small><div className="tnum">{usd(p.extraUsdCents)}</div></div>
              <div><small className="muted">الإجمالي</small><div className="tnum">{usd(p.totalUsdCents)}</div></div>
              <div><small className="muted">معامل التحميل</small><div className="tnum">{(p.landedFactor * 100).toFixed(2)}%</div></div>
            </div>
            {p.lines.map((l) => (
              <div key={l.sku} className="row" style={{ fontSize: 'var(--step--1)' }}>
                <span>{l.name}</span>
                <span className="tnum muted">{l.qtyReceived}/{l.qty} مستلَم</span>
                <span className="tnum">شاملة {usd(l.landedUnitCostUsdCents)}</span>
              </div>
            ))}
            {p.state !== 'RECEIVED' && p.state !== 'CANCELLED' && (
              <Receive poNo={p.poNo} lines={p.lines} onDone={load} />
            )}
          </div>
        )))}

      {tab === 'suppliers' && (sups === null ? <p className="muted">جارٍ التحميل…</p>
        : sups.map((s) => (
          <div key={s.code} className="card glass">
            <div className="row">
              <b>{s.name}</b><span className="tag">{s.code}</span>
              {!s.isActive && <span className="tag tag--clay">موقوف</span>}
            </div>
            <div className="muted" style={{ fontSize: 'var(--step--1)' }}>
              {s.contactPhone ?? '—'} · مهلة {s.leadTimeDays} يوماً · {s.poCount} أمر شراء
            </div>
            <div className="row">
              <Btn label={s.isActive ? 'أوقفه' : 'فعّله'} kind="btn--ghost" onClick={async () => {
                await api.patch(`/admin/procurement/suppliers/${s.code}`, { isActive: !s.isActive }); load();
              }} />
              <Btn label="بطاقة الأداء" kind="btn--ghost" onClick={async () => {
                const sc = await api.get<any>(`/admin/procurement/suppliers/${s.code}/scorecard`);
                alert(`${sc.name}\nالتزام بالمواعيد: ${sc.onTimePct ?? '—'}%\nنسبة التوريد: ${sc.fillRatePct ?? '—'}%\nالإنفاق: ${usd(sc.spendUsdCents)}${sc.note ? `\n${sc.note}` : ''}`);
              }} />
            </div>
          </div>
        )))}

      {tab === 'alerts' && (alerts === null ? <p className="muted">جارٍ التحميل…</p>
        : !alerts.length ? <div className="empty"><p>لا تنبيهات.</p></div>
        : alerts.map((a, i) => (
          <div key={i} className="card glass">
            <div className="row"><b>{a.ar}</b><span className="tag">{a.code}</span></div>
            <pre className="muted" style={{ fontSize: '0.7rem', overflowX: 'auto' }}>{JSON.stringify(a.detail, null, 1)}</pre>
          </div>
        )))}
    </>
  );
}

/** استلام البضاعة: أرقام IMEI سطراً لكل جهاز — والفحص بخوارزمية Luhn في الخادم */
function Receive(props: { poNo: string; lines: PoRow['lines']; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [sku, setSku] = useState(props.lines[0]?.sku ?? '');
  const [imeis, setImeis] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  if (!open) return <Btn label="استلام بضاعة" kind="btn--ghost" onClick={async () => setOpen(true)} />;
  return (
    <div className="card">
      {msg && <div className="err">{msg}</div>}
      <div className="field"><label htmlFor={`r-${props.poNo}`}>الصنف</label>
        <select id={`r-${props.poNo}`} value={sku} onChange={(e) => setSku(e.target.value)}>
          {props.lines.map((l) => <option key={l.sku} value={l.sku}>{l.name} ({l.qty - l.qtyReceived} متبقٍ)</option>)}
        </select></div>
      <div className="field"><label htmlFor={`i-${props.poNo}`}>أرقام IMEI — رقم في كل سطر</label>
        <textarea id={`i-${props.poNo}`} dir="ltr" rows={5} value={imeis}
          onChange={(e) => setImeis(e.target.value)} style={{ width: '100%', fontFamily: 'monospace' }} />
        <span className="hint">كل رقم يُفحص بخوارزمية Luhn، والمرفوض يُذكر بعينه</span></div>
      <div className="row">
        <Btn label="استلِم" onClick={async () => {
          setMsg(null);
          try {
            const r = await api.post<any>(`/admin/procurement/purchase-orders/${props.poNo}/receive`, {
              receipts: [{ sku, imeis: imeis.split('\n').map((s) => s.trim()).filter(Boolean) }],
            });
            const rej = r.results?.[0]?.rejected ?? [];
            setMsg(rej.length ? `استُلم ${r.results[0].received} · رُفض: ${rej.join('، ')}` : null);
            setImeis(''); props.onDone();
            if (!rej.length) setOpen(false);
          } catch (e) { setMsg(e instanceof ApiError ? e.messageAr : 'تعذّر الاستلام'); }
        }} />
        <Btn label="إغلاق" kind="btn--ghost" onClick={async () => setOpen(false)} />
      </div>
    </div>
  );
}

/* ————— التقارير المالية (الفصل 16 ومهام 19.2 الشهرية) ————— */
function Reports() {
  const [tab, setTab] = useState<'pnl' | 'dead' | 'aging' | 'commissions'>('pnl');
  const [pnl, setPnl] = useState<any>(null);
  const [dead, setDead] = useState<any>(null);
  const [aging, setAging] = useState<any>(null);
  const [comm, setComm] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const fail = (e: unknown) => setErr(e instanceof ApiError ? e.messageAr : 'تعذّر التحميل');
    if (tab === 'pnl' && !pnl) api.get('/admin/reports/pnl').then(setPnl).catch(fail);
    if (tab === 'dead' && !dead) api.get('/admin/reports/dead-stock').then(setDead).catch(fail);
    if (tab === 'aging' && !aging) api.get('/admin/reports/inventory-aging').then(setAging).catch(fail);
    if (tab === 'commissions' && !comm) api.get('/admin/commissions/run').then(setComm).catch(fail);
  }, [tab, pnl, dead, aging, comm]);

  return (
    <>
      {err && <div className="err">{err}</div>}
      <div className="tabs">
        {([['pnl', 'الأرباح والخسائر'], ['dead', 'مخزون راكد'],
           ['aging', 'تقادم المخزون'], ['commissions', 'العمولات']] as const).map(([v, l]) => (
          <button key={v} aria-pressed={tab === v} onClick={() => setTab(v)}>{l}</button>
        ))}
      </div>

      {tab === 'pnl' && (pnl === null ? <p className="muted">جارٍ التحميل…</p> : (
        <>
          <p className="warnbox">
            الإيراد من المسلَّم وحده: طلبٌ شُحن ولم يُسلَّم لم يصر بيعاً، واحتسابه
            إيراداً يجعل كل محاولة فاشلة ربحاً على الورق. والمرتجع يُخصم في شهر
            صرفه لا في شهر بيعه — النقد خرج حينها.
          </p>
          <div className="grid2">
            <div className="kpi glass"><small>الشهر</small><b className="tnum">{pnl.month}</b></div>
            <div className="kpi glass"><small>طلبات مسلَّمة</small><b className="tnum">{pnl.orders}</b></div>
            <div className="kpi glass"><small>الإيراد</small><b className="tnum">{usd(pnl.revenueUsdCents)}</b></div>
            <div className="kpi glass"><small>كلفة البضاعة</small><b className="tnum">{usd(pnl.cogsUsdCents)}</b></div>
            <div className="kpi glass"><small>هامش إجمالي</small><b className="tnum">{usd(pnl.grossMarginUsdCents)} ({pnl.grossMarginPct}%)</b></div>
            <div className="kpi glass"><small>مرتجعات مصروفة</small><b className="tnum">{usd(pnl.refundsUsdCents)}</b></div>
            <div className="kpi glass"><small>عمولة المندوبين</small><b className="tnum">{fmtSyp(pnl.courierCommissionSyp)}</b></div>
            <div className="kpi glass"><small>الصافي</small><b className="tnum">{usd(pnl.netUsdCents)}</b></div>
          </div>
        </>
      ))}

      {tab === 'dead' && (dead === null ? <p className="muted">جارٍ التحميل…</p> : (
        <>
          <div className="grid2">
            <div className="kpi glass"><small>أصناف راكدة ({dead.thresholdDays} يوماً)</small><b className="tnum">{dead.count}</b></div>
            <div className="kpi glass"><small>رأس مال محبوس</small><b className="tnum">{usd(dead.tiedCapitalUsdCents)}</b></div>
          </div>
          {!dead.items.length ? <div className="empty"><p>لا مخزون راكد.</p></div>
            : dead.items.map((i: any) => (
              <div key={i.sku} className="card glass">
                <div className="row"><b>{i.name}</b><span className="tag">{i.sku}</span></div>
                <div className="muted" style={{ fontSize: 'var(--step--1)' }}>
                  على الرفّ {i.onHand} · محبوس {usd(i.tiedCapitalUsdCents)}
                  {i.ageDays !== null && ` · عمره ${i.ageDays} يوماً`}
                  {i.lastSaleAt ? ` · آخر بيع ${new Date(i.lastSaleAt).toLocaleDateString('ar')}` : ' · لم يُبَع قط'}
                </div>
              </div>
            ))}
        </>
      ))}

      {tab === 'aging' && (aging === null ? <p className="muted">جارٍ التحميل…</p> : (
        <div className="card glass">
          <p className="muted" style={{ fontSize: 'var(--step--1)' }}>
            العمر من آخر استلام في دفتر الحركات — وحدة الجهاز لا تحمل تاريخ دخولها والدفتر يحمله.
          </p>
          {aging.buckets.map((b: any) => (
            <div key={b.label} className="row">
              <span style={{ minWidth: 110 }}>{b.label}</span>
              <span className="tnum">{b.units} وحدة</span>
              <span className="tnum muted">{usd(b.capitalUsdCents)}</span>
            </div>
          ))}
        </div>
      ))}

      {tab === 'commissions' && (comm === null ? <p className="muted">جارٍ التحميل…</p> : (
        <>
          <p className="warnbox">
            الاحتساب آلي والاعتماد يدوي — ولا صرف إلا عبر التسويات حيث فصل الواجبات.
          </p>
          <div className="grid2">
            <div className="kpi glass"><small>الشهر</small><b className="tnum">{comm.month}</b></div>
            <div className="kpi glass"><small>إجمالي العمولات</small><b className="tnum">{fmtSyp(comm.totalCommissionSyp)}</b></div>
          </div>
          {comm.rows.map((r: any) => (
            <div key={r.collectorId} className="card glass">
              <div className="row"><b>{r.name ?? r.collectorId}</b>{r.code && <span className="tag">{r.code}</span>}</div>
              <div className="muted" style={{ fontSize: 'var(--step--1)' }}>
                {r.daysWorked} يوم عمل · حصّل {fmtSyp(r.collectedSyp)} · عمولته {fmtSyp(r.commissionSyp)}
              </div>
            </div>
          ))}
        </>
      ))}
    </>
  );
}

/* ————— الجاهزية والمهام الدورية (الفصل 19 §19.5) ————— */
const CAT_AR: Record<string, string> = {
  TECH: 'تقني', CONTENT: 'محتوى', OPS: 'تشغيلي', LEGAL: 'قانوني', FINANCE: 'مالي',
};
const RSTATUS_AR: Record<string, string> = {
  PENDING: 'معلّق', PASSED: 'مُحقَّق', FAILED: 'فاشل', WAIVED: 'متجاوَز',
};

function Readiness() {
  const [checks, setChecks] = useState<any[] | null>(null);
  const [sum, setSum] = useState<any>(null);
  const [routines, setRoutines] = useState<any[] | null>(null);
  const [cadence, setCadence] = useState<'DAILY' | 'WEEKLY' | 'MONTHLY'>('DAILY');
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    api.get<any[]>('/admin/readiness/checks').then(setChecks).catch((e) =>
      setErr(e instanceof ApiError ? e.messageAr : 'تعذّر التحميل'));
    api.get('/admin/readiness/summary').then(setSum).catch(() => {});
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    api.get<any[]>(`/admin/ops/routines?cadence=${cadence}`).then(setRoutines).catch(() => {});
  }, [cadence]);

  const mark = async (code: string, status: string) => {
    setErr(null);
    let extra: Record<string, unknown> = {};
    if (status === 'WAIVED') {
      const reason = prompt('سبب التجاوز — بندٌ يُتجاوَز بلا سبب مكتوب مخفيٌّ لا محسوم:');
      if (!reason) return;
      extra = { waiverReason: reason };
    }
    if (status === 'PASSED') {
      const url = prompt('رابط الإثبات (تقرير أو لقطة أو عقد):');
      if (url) extra = { evidenceUrl: url };
    }
    try { await api.patch(`/admin/readiness/checks/${code}`, { status, ...extra }); load(); }
    catch (e) { setErr(e instanceof ApiError ? e.messageAr : 'تعذّر التأشير'); }
  };

  return (
    <>
      {err && <div className="err">{err}</div>}

      {sum && (
        <>
          <div className={sum.launch_ready ? 'ok' : 'warnbox'}>
            {sum.launch_ready
              ? '✓ كل البنود المانعة محسومة — الإطلاق مسموح.'
              : `الإطلاق ممنوع: ${sum.blocking_passed} من ${sum.blocking_total} بنداً مانعاً محسوم.`}
          </div>
          <div className="grid2">
            <div className="kpi glass"><small>بنود مانعة محسومة</small><b className="tnum">{sum.blocking_passed}/{sum.blocking_total}</b></div>
            <div className="kpi glass"><small>مجموع البنود</small><b className="tnum">{sum.total}</b></div>
          </div>
        </>
      )}

      {checks !== null && checks.length === 0 && (
        <div className="card glass">
          <p>لم تُبذَر بنود الجاهزية بعد — اثنان وثلاثون بنداً من الفصل 19.</p>
          <Btn label="ابذر البنود" onClick={async () => { await api.post('/admin/readiness/seed'); load(); }} />
        </div>
      )}

      {(checks ?? []).map((c) => (
        <div key={c.code} className="card glass">
          <div className="row">
            <span className="tag">{CAT_AR[c.category] ?? c.category}</span>
            <b style={{ flex: 1 }}>{c.title}</b>
            <span className={`tag ${c.status === 'PASSED' ? 'tag--jade' : c.status === 'FAILED' ? 'tag--clay' : ''}`}>
              {RSTATUS_AR[c.status]}
            </span>
          </div>
          <div className="muted" style={{ fontSize: '0.72rem' }}>
            {c.code} · مسؤوله: {c.ownerRole}{c.isBlocking ? ' · مانع للإطلاق' : ''}
            {c.waiverReason ? ` · سبب التجاوز: ${c.waiverReason}` : ''}
          </div>
          <div className="row">
            <Btn label="مُحقَّق" kind="btn--ghost" onClick={() => mark(c.code, 'PASSED')} />
            <Btn label="فاشل" kind="btn--ghost" onClick={() => mark(c.code, 'FAILED')} />
            <Btn label="تجاوز" kind="btn--ghost" onClick={() => mark(c.code, 'WAIVED')} />
          </div>
        </div>
      ))}

      <h2 style={{ fontSize: 'var(--step-0)', marginBlock: 16 }}>المهام الدورية</h2>
      <div className="tabs">
        {([['DAILY', 'يومية'], ['WEEKLY', 'أسبوعية'], ['MONTHLY', 'شهرية']] as const).map(([v, l]) => (
          <button key={v} aria-pressed={cadence === v} onClick={() => setCadence(v)}>{l}</button>
        ))}
      </div>
      {(routines ?? []).map((r) => (
        <div key={r.code} className="card glass">
          <div className="row">
            <b style={{ flex: 1, fontSize: 'var(--step--1)' }}>{r.code}</b>
            <span className="tnum muted">{r.periodKey}</span>
            {r.status
              ? <span className="tag tag--jade">{r.status === 'DONE' ? 'مُنجَزة' : r.status}</span>
              : <Btn label="سجّل الإنجاز" kind="btn--ghost" onClick={async () => {
                  await api.post(`/admin/ops/routines/${r.code}/runs`, { status: 'DONE' });
                  api.get<any[]>(`/admin/ops/routines?cadence=${cadence}`).then(setRoutines).catch(() => {});
                }} />}
          </div>
          {r.performedBy && <div className="muted" style={{ fontSize: '0.72rem' }}>نفّذها {r.performedBy}</div>}
        </div>
      ))}
    </>
  );
}

/* ————— المستخدمون والأدوار والجلسات (الفصل 9، ومراجعة 19.2 الشهرية) ————— */
const ROLE_AR: Record<string, string> = {
  CUSTOMER: 'زبون', SUPPORT: 'دعم', CATALOG_ADMIN: 'كتالوج',
  OPS_MANAGER: 'عمليات', WAREHOUSE: 'مستودع', COURIER: 'مندوب', ADMIN: 'مدير عام',
};

function Users() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [sessions, setSessions] = useState<any[] | null>(null);
  const [tab, setTab] = useState<'staff' | 'all' | 'sessions' | 'audit'>('staff');
  const [audit, setAudit] = useState<any[] | null>(null);
  const [q, setQ] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    const qs = new URLSearchParams();
    if (tab === 'staff') qs.set('staff', '1');
    if (q) qs.set('q', q);
    api.get<any[]>(`/admin/users?${qs}`).then(setRows).catch((e) =>
      setErr(e instanceof ApiError ? e.messageAr : 'تعذّر التحميل'));
  }, [tab, q]);
  useEffect(() => { if (tab === 'staff' || tab === 'all') load(); }, [tab, load]);
  useEffect(() => {
    if (tab === 'sessions') api.get<any[]>('/admin/users/sessions').then(setSessions).catch(() => {});
    if (tab === 'audit') api.get<any[]>('/admin/audit?limit=60').then(setAudit).catch(() => {});
  }, [tab]);

  return (
    <>
      {err && <div className="err">{err}</div>}
      <p className="warnbox">
        تغيير الدور يُسقط كل جلسات صاحبه فوراً — وإلا بقي يعمل بصلاحيةٍ سُحبت
        منه حتى ينتهي رمزه من تلقائه. وكل تغيير يُسجَّل في سجل التدقيق.
      </p>

      <div className="tabs">
        {([['staff', 'الموظّفون'], ['all', 'الكل'], ['sessions', 'الجلسات النشطة'], ['audit', 'سجل التدقيق']] as const)
          .map(([v, l]) => <button key={v} aria-pressed={tab === v} onClick={() => setTab(v)}>{l}</button>)}
      </div>

      {(tab === 'staff' || tab === 'all') && (
        <>
          <div className="field">
            <label htmlFor="uq">بحث برقم أو اسم</label>
            <input id="uq" value={q} onChange={(e) => setQ(e.target.value)} onBlur={load} />
          </div>
          {(rows ?? []).map((u) => (
            <div key={u.publicId} className="card glass">
              <div className="row">
                <b>{u.fullName ?? 'بلا اسم'}</b>
                <span className="tnum muted" dir="ltr">{u.phone}</span>
                <span className="tag">{ROLE_AR[u.role] ?? u.role}</span>
                {u.lockedUntil && new Date(u.lockedUntil) > new Date() && <span className="tag tag--clay">مقفل</span>}
              </div>
              <div className="muted" style={{ fontSize: '0.72rem' }}>
                {u.orders} طلباً · {u.activeSessions} جلسة نشطة{u.hasPassword ? ' · له كلمة سرّ' : ''}
              </div>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <select defaultValue={u.role} onChange={async (e) => {
                  const role = e.target.value;
                  if (role === u.role) return;
                  const reason = prompt(`سبب تغيير دور ${u.fullName ?? u.phone} إلى ${ROLE_AR[role]}:`) ?? '';
                  setErr(null);
                  try { await api.post(`/admin/users/${u.publicId}/role`, { role, reason }); load(); }
                  catch (er) { setErr(er instanceof ApiError ? er.messageAr : 'تعذّر التغيير'); load(); }
                }}>
                  {Object.entries(ROLE_AR).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                {u.lockedUntil && (
                  <Btn label="فكّ القفل" kind="btn--ghost" onClick={async () => {
                    await api.post(`/admin/users/${u.publicId}/unlock`); load();
                  }} />
                )}
                <Btn label="أسقط جلساته" kind="btn--ghost" onClick={async () => {
                  await api.post(`/admin/users/${u.publicId}/revoke-sessions`); load();
                }} />
              </div>
            </div>
          ))}
        </>
      )}

      {tab === 'sessions' && (sessions ?? []).map((s) => (
        <div key={s.id} className="card glass">
          <div className="row">
            <b>{s.name ?? s.publicId}</b><span className="tag">{ROLE_AR[s.role] ?? s.role}</span>
          </div>
          <div className="muted" style={{ fontSize: '0.72rem' }} dir="ltr">
            {s.userAgent ?? '—'} · {s.ip ?? '—'}
          </div>
          <div className="muted" style={{ fontSize: '0.72rem' }}>
            آخر نشاط: {new Date(s.lastSeenAt).toLocaleString('ar')}
          </div>
        </div>
      ))}

      {tab === 'audit' && (audit ?? []).map((a, i) => (
        <div key={i} className="card glass">
          <div className="row">
            <b style={{ fontSize: 'var(--step--1)' }}>{a.action}</b>
            <span className="muted">{a.actor ?? 'النظام'}</span>
            <span className="muted tnum">{new Date(a.at).toLocaleString('ar')}</span>
          </div>
          {a.entityType && <div className="muted" style={{ fontSize: '0.72rem' }}>{a.entityType}</div>}
        </div>
      ))}
    </>
  );
}

/* ————— مطالبات الكفالة (الفصل 15) ————— */
const CLAIM_AR: Record<string, string> = {
  OPENED: 'مفتوحة', RECEIVED: 'استُلم الجهاز', DIAGNOSING: 'قيد الفحص',
  DECISION: 'قرار', IN_REPAIR: 'قيد الإصلاح', TESTING: 'اختبار',
  READY: 'جاهزة للتسليم', CLOSED: 'مغلقة', REJECTED: 'مرفوضة',
};
const CLAIM_NEXT: Record<string, string[]> = {
  OPENED: ['RECEIVED', 'REJECTED'],
  RECEIVED: ['DIAGNOSING', 'REJECTED'],
  DIAGNOSING: ['DECISION', 'REJECTED'],
  DECISION: ['IN_REPAIR', 'REJECTED'],
  IN_REPAIR: ['TESTING'],
  TESTING: ['READY'],
  READY: ['CLOSED'],
};

function Warranty() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    api.get<any[]>('/admin/warranty-claims').then(setRows).catch((e) =>
      setErr(e instanceof ApiError ? e.messageAr : 'تعذّر التحميل'));
  }, []);
  useEffect(load, [load]);

  const move = async (claimNo: string, to: string) => {
    setErr(null);
    const body: Record<string, unknown> = { to };
    if (to === 'REJECTED') {
      const r = prompt('سبب الرفض — الرفض بلا سبب لا يُقبل:');
      if (!r) return;
      body.rejectReason = r;
    }
    if (to === 'DECISION') body.diagnosis = prompt('نتيجة الفحص:') ?? undefined;
    if (to === 'READY') body.resolution = prompt('ما جرى (إصلاح أم استبدال):') ?? undefined;
    try { await api.post(`/admin/warranty-claims/${claimNo}/transition`, body); load(); }
    catch (e) { setErr(e instanceof ApiError ? e.messageAr : 'تعذّر الانتقال'); }
  };

  return (
    <>
      {err && <div className="err">{err}</div>}
      <p className="warnbox">
        المحطات لا تُقفز: الجهاز لا يُصلَح قبل أن يُفحَص ولا يُسلَّم قبل أن يُختبَر.
        والحالة في جدول حقيقي لا مستنتَجة من آخر سطر في سجل التدقيق.
      </p>
      {rows === null ? <p className="muted">جارٍ التحميل…</p>
        : !rows.length ? <div className="empty"><p>لا مطالبات كفالة.</p></div>
        : rows.map((c) => (
          <div key={c.claimNo} className="card glass">
            <div className="row">
              <b className="tnum">{c.claimNo}</b>
              <span className="tag">{CLAIM_AR[c.state] ?? c.state}</span>
              <span className="muted tnum" dir="ltr">{c.imei ?? '—'}</span>
            </div>
            <div style={{ fontSize: 'var(--step--1)' }}>{c.description}</div>
            <div className="muted" style={{ fontSize: '0.72rem' }} dir="ltr">{c.phone}</div>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              {(CLAIM_NEXT[c.state] ?? []).map((to) => (
                <Btn key={to} label={CLAIM_AR[to] ?? to} kind="btn--ghost" onClick={() => move(c.claimNo, to)} />
              ))}
            </div>
          </div>
        ))}
    </>
  );
}

export default function App() {
  const { path, nav } = useRoute();
  const [fx, setFx] = useState<Fx | null>(null);
  const [tick, setTick] = useState(0);
  const [authed, setAuthed] = useState(() => Boolean(tokens.access));

  useEffect(() => {
    const onExpired = () => setAuthed(false);
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, []);

  const loadFx = useCallback(() => { api.get<Fx>('/fx/current').then(setFx).catch(() => {}); }, []);
  useEffect(() => { loadFx(); }, [loadFx, tick]);

  const tabs: Array<[string, string]> = [
    ['/', 'المؤشرات'], ['/orders', 'الطلبات'], ['/settlements', 'التسويات'],
    ['/returns', 'المرتجعات'], ['/tickets', 'الدعم'], ['/moderation', 'الإشراف'],
    ['/catalog', 'الكتالوج'], ['/coupons', 'الكوبونات'],
    ['/warranty', 'الكفالة'], ['/procurement', 'المشتريات'], ['/reports', 'التقارير'],
    ['/fx', 'سعر الصرف'], ['/delivery', 'التوصيل'], ['/courier', 'المندوب'],
    ['/users', 'المستخدمون'], ['/readiness', 'الجاهزية'],
    ['/settings', 'الإعدادات'], ['/password', 'كلمة السرّ'],
  ];

  if (!authed) return <Login onDone={() => { setAuthed(true); setTick((t) => t + 1); }} />;

  return (
    <>
      <FxBanner fx={fx} />
      <header className="hd glass">
        <h1>تالي شام — الإدارة</h1>
        <button
          className="btn btn--ghost sp"
          style={{ minHeight: 34, padding: '0 12px', fontSize: 'var(--step--1)' }}
          onClick={() => { tokens.clear(); setAuthed(false); }}
        >
          خروج
        </button>
      </header>

      <div className="page">
        <div className="tabs">
          {tabs.map(([to, label]) => (
            <button key={to} aria-pressed={path === to} onClick={() => nav(to)}>{label}</button>
          ))}
        </div>

        {path === '/orders' ? <OrdersQueue onChanged={() => setTick((t) => t + 1)} />
          : path === '/settlements' ? <Settlements />
          : path === '/returns' ? <Returns />
          : path === '/tickets' ? <Tickets />
          : path === '/moderation' ? <Moderation />
          : path === '/coupons' ? <Coupons />
          : path === '/delivery' ? <Delivery />
          : path === '/warranty' ? <Warranty />
          : path === '/procurement' ? <Procurement />
          : path === '/reports' ? <Reports />
          : path === '/users' ? <Users />
          : path === '/readiness' ? <Readiness />
          : path === '/settings' ? <Settings />
          : path === '/password' ? <PasswordScreen />
          : path === '/catalog' ? <Catalog />
          : path === '/fx' ? <FxScreen fx={fx} reload={() => setTick((t) => t + 1)} />
          : path === '/courier' ? <Courier />
          : <Dashboard />}
      </div>
    </>
  );
}
