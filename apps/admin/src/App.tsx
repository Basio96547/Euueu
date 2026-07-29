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
  customer: string; phone: string; altPhone?: string;
  governorate: string; city: string; neighborhood: string; landmark: string; itemCount: number;
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

  const collect = (t: CourierTask) =>
    act(t.orderNo, `/courier/orders/${t.orderNo}/collect`,
      { amountSyp: t.cashDueSyp }, `تحصيل ${fmtSyp(t.cashDueSyp)} — ${t.orderNo}`);

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
              <div className="muted">{t.customer}</div>
              <div className="muted">{GOV_AR[t.governorate] ?? t.governorate} · {t.neighborhood}</div>
              <div style={{ fontWeight: 700, fontSize: 'var(--step--1)' }}>المعلم: {t.landmark}</div>
            </div>
            <div style={{ textAlign: 'end' }}>
              <div className="muted">المستحق نقداً</div>
              <div className="tnum" style={{ fontSize: 'var(--step-1)', fontWeight: 800 }}>{fmtSyp(t.cashDueSyp)}</div>
              <span className="tag">{STATUS_AR[t.status] ?? t.status}</span>
            </div>
          </div>
          <div className="acts">
            <a className="btn btn--ghost" href={`tel:${t.phone}`}>اتصال</a>
            {t.status === 'PROCESSING' && <Btn label="استلمت الشحنة" onClick={async () => step(t.orderNo, 'SHIPPED')} />}
            {t.status === 'SHIPPED' && <Btn label="خرجت للتوصيل" onClick={async () => step(t.orderNo, 'OUT_FOR_DELIVERY')} />}
            {t.status === 'OUT_FOR_DELIVERY' && (
              <>
                <Btn label={`حصّلت ${fmtSyp(t.cashDueSyp)}`} onClick={async () => collect(t)} />
                <Btn label="تعذّر التسليم" kind="btn--danger" onClick={async () => step(t.orderNo, 'DELIVERY_FAILED')} />
              </>
            )}
          </div>
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
        والنقد المقرَّب لأقرب ألف. المطابقة تقيس ما قبضه مقابل ما كان يجب أن يقبضه.
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

/* ————— الكتالوج: تحويل المنتجات التجريبية إلى حقيقية ————— */
interface AdminProduct {
  slug: string; name: { ar: string; en?: string }; status: string; isDemo: boolean;
  brand: { ar: string; en?: string };
  variants: Array<{ sku: string; priceUsdCents: number; onHand: number; reserved: number }>;
}

function Catalog() {
  const [rows, setRows] = useState<AdminProduct[] | null>(null);
  const [filter, setFilter] = useState<'all' | 'demo' | 'real'>('demo');
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

  return (
    <>
      <div className="tabs" style={{ marginBlockEnd: 12 }}>
        {([['demo', 'تجريبية'], ['real', 'حقيقية'], ['all', 'الكل']] as const).map(([v, l]) => (
          <button key={v} aria-pressed={filter === v} onClick={() => setFilter(v)}>{l}</button>
        ))}
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
    ['/fx', 'سعر الصرف'], ['/courier', 'المندوب'], ['/password', 'كلمة السرّ'],
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
          : path === '/password' ? <PasswordScreen />
          : path === '/catalog' ? <Catalog />
          : path === '/fx' ? <FxScreen fx={fx} reload={() => setTick((t) => t + 1)} />
          : path === '/courier' ? <Courier />
          : <Dashboard />}
      </div>
    </>
  );
}
