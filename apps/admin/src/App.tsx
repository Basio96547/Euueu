import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, idemKey, fmtSyp } from './lib/api.js';
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
  const online = navigator.onLine;

  const load = useCallback(async () => {
    try { setTasks(await api.get<CourierTask[]>('/courier/tasks')); }
    catch (e) { setErr(e instanceof ApiError ? e.messageAr : 'تعذّر التحميل'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const step = async (no: string, to: string) => {
    setErr(null);
    try { await api.post(`/courier/orders/${no}/status`, { to }); await load(); }
    catch (e) { setErr(e instanceof ApiError ? e.messageAr : 'تعذّر التحديث'); }
  };

  const collect = async (t: CourierTask) => {
    setErr(null); setMsg(null);
    try {
      await api.post(
        `/courier/orders/${t.orderNo}/collect`,
        { amountSyp: t.cashDueSyp, occurredAt: new Date().toISOString(), deviceId: 'demo-device' },
        { 'idempotency-key': idemKey() },   // إعادة الإرسال لا تحصّل مرتين
      );
      setMsg(`سُجِّل تحصيل ${fmtSyp(t.cashDueSyp)} للطلب ${t.orderNo}`);
      await load();
    } catch (e) { setErr(e instanceof ApiError ? e.messageAr : 'تعذّر تسجيل التحصيل'); }
  };

  return (
    <>
      {/* مؤشر المزامنة حالة مستمرة لا إشعار عابر (الفصل 20 §20.8) */}
      <div className={`sysbar ${online ? '' : 'sysbar--offline'}`} role="status">
        {online ? 'مُزامَن — كل العمليات مرسَلة' : 'بلا اتصال — العمليات محفوظة وستُرسَل عند عودة الشبكة'}
      </div>

      {err && <div className="err">{err}</div>}
      {msg && <div className="ok">{msg}</div>}
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
            {t.status === 'PROCESSING' && <Btn label="استلمت الشحنة" onClick={() => step(t.orderNo, 'SHIPPED')} />}
            {t.status === 'SHIPPED' && <Btn label="خرجت للتوصيل" onClick={() => step(t.orderNo, 'OUT_FOR_DELIVERY')} />}
            {t.status === 'OUT_FOR_DELIVERY' && (
              <>
                <Btn label={`حصّلت ${fmtSyp(t.cashDueSyp)}`} onClick={() => collect(t)} />
                <Btn label="تعذّر التسليم" kind="btn--danger" onClick={() => step(t.orderNo, 'DELIVERY_FAILED')} />
              </>
            )}
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

  const loadFx = useCallback(() => { api.get<Fx>('/fx/current').then(setFx).catch(() => {}); }, []);
  useEffect(() => { loadFx(); }, [loadFx, tick]);

  const tabs: Array<[string, string]> = [
    ['/', 'المؤشرات'], ['/orders', 'الطلبات'], ['/fx', 'سعر الصرف'], ['/courier', 'المندوب'],
  ];

  return (
    <>
      <FxBanner fx={fx} />
      <header className="hd glass">
        <h1>تالي شام — الإدارة</h1>
      </header>

      <div className="page">
        <div className="tabs">
          {tabs.map(([to, label]) => (
            <button key={to} aria-pressed={path === to} onClick={() => nav(to)}>{label}</button>
          ))}
        </div>

        {path === '/orders' ? <OrdersQueue onChanged={() => setTick((t) => t + 1)} />
          : path === '/fx' ? <FxScreen fx={fx} reload={() => setTick((t) => t + 1)} />
          : path === '/courier' ? <Courier />
          : <Dashboard />}
      </div>
    </>
  );
}
