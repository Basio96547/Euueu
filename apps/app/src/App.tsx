import { useEffect, useState } from 'react';
import { api, ApiError, auth, idemKey, fmtSyp, fmtUsd, fmtDate, fmtDateTime, type Me } from './lib/api.js';
import { useRoute, match } from './lib/router.js';

/* ————— أنواع الاستجابة ————— */
interface CartLine { sku: string; name: string; qty: number; unitPriceUsdCents: number; lineTotalUsdCents: number }
interface CartSummary {
  cartToken: string; lines: CartLine[]; shippingUsdCents: number;
  subtotalUsdCents: number; discountUsdCents: number;
  coupon: { code: string; discountUsdCents: number; freeShipping: boolean; invalidReason: string | null } | null;
  fx: { rate: number; health: string; validUntil: string };
  totals: { totalUsdCents: number; rawSyp: number; cashSyp: number; roundingDiffSyp: number };
}
interface OrderView {
  orderNo: string; status: string; paymentStatus: string;
  cashDueSyp: number; roundingDiffSyp: number; fxRate: number; fxStale: boolean;
  priceLockedUntil: string; confirmationAttempts: number; placedAt: string;
  address: { recipientName: string; governorate: string; city: string; neighborhood: string; landmark: string; phone: string };
  items: Array<{ name: string; qty: number; unitPriceUsdCents: number }>;
  history: Array<{ to: string; at: string; by: string }>;
}

const STATUS_AR: Record<string, string> = {
  PENDING_CONFIRMATION: 'بانتظار تأكيدك',
  PROCESSING: 'قيد التجهيز',
  SHIPPED: 'تم الشحن',
  OUT_FOR_DELIVERY: 'خرج للتوصيل',
  DELIVERED: 'تم التسليم',
  DELIVERY_FAILED: 'تعذّر التسليم',
  CANCELLED: 'ملغى',
};

const GOVERNORATES: Array<[string, string]> = [
  ['DAMASCUS', 'دمشق'], ['RIF_DIMASHQ', 'ريف دمشق'], ['ALEPPO', 'حلب'],
  ['HOMS', 'حمص'], ['HAMA', 'حماة'], ['LATAKIA', 'اللاذقية'], ['TARTUS', 'طرطوس'],
];

/* ————— زر يعرف حالته: الإقرار فوري، والعرض مثبَّت (الفصل 5 §5.14) ————— */
function ActionButton(props: {
  label: string; busyLabel?: string; onClick: () => Promise<void>;
  disabled?: boolean; className?: string;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={props.className ?? 'btn'}
      disabled={busy || props.disabled}
      data-busy={busy || undefined}
      style={{ minWidth: busy ? '9.5rem' : undefined }}
      onClick={async () => {
        if (busy) return;      // لا زر يقبل ضغطتين
        setBusy(true);
        try { await props.onClick(); } finally { setBusy(false); }
      }}
    >
      {busy ? (props.busyLabel ?? 'لحظة…') : props.label}
    </button>
  );
}

/*
  عدّاد السلة على شريط الموقع الساكن يُقرأ من `localStorage`. والخادم هو
  المرجع: كلّما رأينا ملخّصاً حقيقياً صحّحنا الرقم به، فينضبط ما رسمه
  الموقع تخميناً عند الإضافة.
*/
function syncBadge(c: CartSummary) {
  const n = c.lines.reduce((a, l) => a + (l.qty ?? 0), 0);
  try { localStorage.setItem('cart_count', String(n)); } catch { /* تخزين مغلق */ }
}

/* ————— السلة ————— */
function CartPage({ nav }: { nav: (to: string) => void }) {
  const [cart, setCart] = useState<CartSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        let token = localStorage.getItem('cart_token');
        if (!token) {
          const created = await api.post<{ cartToken: string }>('/carts');
          token = created.cartToken;
          localStorage.setItem('cart_token', token);
        }
        const summary = await api.get<CartSummary>(`/carts/${token}`);
        setCart(summary);
        syncBadge(summary);
      } catch (e) { setErr(e instanceof ApiError ? e.messageAr : 'تعذّر تحميل السلة'); }
    })();
  }, []);

  if (err) return <div className="page"><div className="err">{err}</div></div>;
  if (!cart) return <div className="page"><p className="muted">جارٍ التحميل…</p></div>;

  if (!cart.lines.length) {
    return (
      <div className="page">
        <div className="empty">
          <p>سلتك فارغة.</p>
          <p className="muted">تصفّح الجوالات والملحقات وأضف ما يناسبك.</p>
          <a className="btn" href="/" style={{ marginBlockStart: 16 }}>تصفّح المتجر</a>
        </div>
      </div>
    );
  }

  // تغيير الكمية يعيد الملخّص كاملاً من الخادم: المتاح والسعر والمستحق
  // تُحسب هناك، فلا تعرض الواجهة رقماً لم يُقرّه المخزون.
  const setQty = async (sku: string, qty: number) => {
    setErr(null);
    try {
      const updated = await api.post<CartSummary>(`/carts/${cart.cartToken}/items/${sku}`, { qty });
      setCart(updated);
      syncBadge(updated);
    } catch (e) {
      setErr(e instanceof ApiError ? e.messageAr : 'تعذّر تعديل السلة');
    }
  };

  return (
    <div className="page">
      {err && <div className="err">{err}</div>}
      <div className="card glass">
        {cart.lines.map((l) => (
          <div className="line" key={l.sku}>
            <span className="mid">
              <b>{l.name}</b>
              <small className="muted">{fmtUsd(l.unitPriceUsdCents)} للقطعة</small>
              <span className="qty" role="group" aria-label={`كمية ${l.name}`}>
                <button aria-label="إنقاص" onClick={() => setQty(l.sku, l.qty - 1)}>−</button>
                <span className="tnum" aria-live="polite">{l.qty}</span>
                <button aria-label="زيادة" onClick={() => setQty(l.sku, l.qty + 1)}>+</button>
                <button className="rm" onClick={() => setQty(l.sku, 0)}>إزالة</button>
              </span>
            </span>
            <span className="tnum" style={{ fontWeight: 700 }}>{fmtUsd(l.lineTotalUsdCents)}</span>
          </div>
        ))}
        {cart.discountUsdCents > 0 && (
          <div className="row">
            <span className="muted">خصم {cart.coupon?.code}</span>
            <span className="tnum" style={{ color: 'var(--jade)' }}>− {fmtUsd(cart.discountUsdCents)}</span>
          </div>
        )}
        <div className="row"><span className="muted">التوصيل</span><span className="tnum">{fmtUsd(cart.shippingUsdCents)}</span></div>
        <div className="tot"><span>المستحق نقداً</span><span className="tnum">{fmtSyp(cart.totals.cashSyp)}</span></div>
      </div>

      <CouponBox cart={cart} onChange={setCart} />

      <p className="warnbox">
        المبلغ يُحسب على المجموع ثم يُقرَّب لأقرب 1000 ليرة، وقد يختلف قليلاً عن جمع الأسعار المعروضة.
        سعر الصرف المعتمد {cart.fx.rate.toLocaleString('en-US')} ويُثبَّت على طلبك 48 ساعة.
      </p>

      <button className="btn" onClick={() => nav('/app/checkout')}>متابعة الطلب</button>
    </div>
  );
}

/* ————— إتمام الطلب: لا خطوة دفع إطلاقاً ————— */
function CheckoutPage({ nav }: { nav: (to: string) => void }) {
  const [form, setForm] = useState({
    recipientName: '', governorate: 'DAMASCUS', city: 'دمشق',
    neighborhood: '', street: '', landmark: '', details: '',
    phone: '+963', altPhone: '',
  });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  // الداخل لا يُعيد كتابة رقمه — وما كتبه بيده يبقى كما هو
  useEffect(() => {
    if (!auth.isSignedIn()) return;
    auth.me().then((u) => setForm((f) => ({
      ...f,
      phone: f.phone === '+963' ? u.phone : f.phone,
      recipientName: f.recipientName || u.fullName || '',
    }))).catch(() => {});
  }, []);

  const phoneOk = /^\+9639[0-9]{8}$/.test(form.phone);
  const ready = form.recipientName.length >= 3 && form.neighborhood.length >= 2
    && form.landmark.length >= 3 && phoneOk;

  return (
    <div className="page">
      <div className="steps">
        <span className="step" data-on /><span className="step" data-on /><span className="step" />
      </div>

      {err && <div className="err">{err}</div>}

      <div className="card glass">
        <div className="field">
          <label htmlFor="rn">اسم المستلم <span className="req">*</span></label>
          <input id="rn" value={form.recipientName} onChange={set('recipientName')} autoComplete="name" />
        </div>

        <div className="grid2">
          <div className="field">
            <label htmlFor="gov">المحافظة <span className="req">*</span></label>
            <select id="gov" value={form.governorate} onChange={set('governorate')}>
              {GOVERNORATES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="city">المدينة <span className="req">*</span></label>
            <input id="city" value={form.city} onChange={set('city')} />
          </div>
        </div>

        <div className="field">
          <label htmlFor="nb">الحي <span className="req">*</span></label>
          <input id="nb" value={form.neighborhood} onChange={set('neighborhood')} placeholder="المزة — فيلات غربية" />
        </div>

        <div className="field">
          <label htmlFor="st">الشارع</label>
          <input id="st" value={form.street} onChange={set('street')} />
        </div>

        <div className="field">
          <label htmlFor="lm">المعلم القريب <span className="req">*</span></label>
          <input id="lm" value={form.landmark} onChange={set('landmark')} placeholder="مقابل صيدلية النور" />
          <span className="hint">المندوب يصل بالمعلم لا بالشارع — لذلك هذا الحقل إلزامي.</span>
        </div>

        <div className="field">
          <label htmlFor="ph">رقم الجوال <span className="req">*</span></label>
          <input id="ph" value={form.phone} onChange={set('phone')} inputMode="tel" dir="ltr" />
          {!phoneOk && form.phone.length > 4 && (
            <span className="hint" style={{ color: 'var(--clay)' }}>
              يجب أن يبدأ بـ +9639 ويتكوّن من اثنتي عشرة خانة.
            </span>
          )}
        </div>

        <div className="field">
          <label htmlFor="alt">رقم بديل</label>
          <input id="alt" value={form.altPhone} onChange={set('altPhone')} inputMode="tel" dir="ltr" />
          <span className="hint">خط النجاة الثاني حين ينقطع التيار عن هاتفك.</span>
        </div>
      </div>

      <div className="ok">
        الدفع نقداً عند الاستلام — لا يُطلب منك أي دفع الآن، وتفحص الجهاز قبل أن تدفع.
      </div>

      <ActionButton
        label="أكّد الطلب"
        busyLabel="جارٍ الإنشاء…"
        disabled={!ready}
        onClick={async () => {
          setErr(null);
          try {
            const token = localStorage.getItem('cart_token');
            const order = await api.post<OrderView>(
              '/orders',
              { cartToken: token, address: { ...form, altPhone: form.altPhone || undefined } },
              { 'idempotency-key': idemKey() },
            );
            /* إثبات صلة الضيف بطلبه: آخر أربعة أرقام من هاتفه. يبقى في
               تخزين الجلسة وحدها — يزول بإغلاق التبويب ولا يُشارَك برابط. */
            rememberTail(order.orderNo, form.phone);
            nav(`/app/orders/${order.orderNo}`);
          } catch (e) {
            setErr(e instanceof ApiError ? e.messageAr : 'تعذّر إنشاء الطلب');
          }
        }}
      />
    </div>
  );
}

/*
  الطلب صار يلزمه إثبات صلة: صاحب الحساب يُعرَف برمزه، والضيف بآخر أربعة
  أرقام من هاتفه. وبدون ذلك كان الرقم المتسلسل وحده يكفي لقراءة اسم أي
  زبون وعنوانه.
*/
const tailKey = (no: string) => `order_tail_${no}`;

function rememberTail(orderNo: string, phone: string) {
  const d = (phone || '').replace(/\D/g, '');
  if (d.length < 4) return;
  try { sessionStorage.setItem(tailKey(orderNo), d.slice(-4)); } catch { /* تخزين مغلق */ }
}

function recallTail(orderNo: string): string | null {
  try { return sessionStorage.getItem(tailKey(orderNo)); } catch { return null; }
}

/* ————— تتبّع الطلب ————— */
function OrderPage({ orderNo }: { orderNo: string }) {
  const [o, setO] = useState<OrderView | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const tail = recallTail(orderNo);
    api.get<OrderView>(`/orders/${orderNo}${tail ? `?tail=${tail}` : ''}`).then(setO)
      .catch((e) => setErr(e instanceof ApiError
        ? (e.code === 'NOT_FOUND'
            ? 'تعذّر عرض هذا الطلب. إن كنت طلبته كضيف فتابعه من «تتبّع بلا حساب» برقم الطلب وهاتفك.'
            : e.messageAr)
        : 'تعذّر جلب الطلب'));
  }, [orderNo]);

  if (err) return <div className="page"><div className="err">{err}</div></div>;
  if (!o) return <div className="page"><p className="muted">جارٍ التحميل…</p></div>;

  const hoursLeft = Math.max(0, (new Date(o.priceLockedUntil).getTime() - Date.now()) / 3_600_000);

  return (
    <div className="page">
      <div className="card glass">
        <div className="row">
          <span className="tnum" style={{ fontWeight: 800 }}>{o.orderNo}</span>
          <span className="tag tag--jade">{STATUS_AR[o.status] ?? o.status}</span>
        </div>
        <div className="row">
          <span className="muted">المستحق نقداً</span>
          <span className="tnum" style={{ fontSize: 'var(--step-1)', fontWeight: 800 }}>{fmtSyp(o.cashDueSyp)}</span>
        </div>
        <div className="row"><span className="muted">طريقة الدفع</span><span>نقداً عند الاستلام</span></div>
        <div className="row"><span className="muted">سعر الصرف المثبَّت</span><span className="tnum">{o.fxRate.toLocaleString('en-US')}</span></div>
      </div>

      {o.status === 'PENDING_CONFIRMATION' && (
        <div className="warnbox">
          أرسلنا لك رسالة واتساب فيها زرّا «أؤكد» و«ألغِ». إن لم تردّ خلال ساعتين نتصل بك.
          السعر مثبَّت {hoursLeft.toFixed(1)} ساعة أخرى.
        </div>
      )}

      <div className="card glass">
        <b style={{ fontSize: 'var(--step--1)' }}>عنوان التسليم</b>
        <p className="muted" style={{ lineHeight: 1.7 }}>
          {o.address.city} · {o.address.neighborhood}<br />
          <span style={{ color: 'var(--clay)', fontWeight: 700 }}>المعلم:</span> {o.address.landmark}<br />
          <span dir="ltr">{o.address.phone}</span>
        </p>
      </div>

      <div className="card glass">
        {o.items.map((i, n) => (
          <div className="line" key={n}>
            <span className="mid"><b>{i.name}</b><small className="muted">{i.qty} قطعة</small></span>
            <span className="tnum">{fmtUsd(i.unitPriceUsdCents)}</span>
          </div>
        ))}
      </div>

      <div className="card glass">
        <b style={{ fontSize: 'var(--step--1)' }}>مسار الطلب</b>
        {o.history.map((h, n) => (
          <div className="row" key={n}>
            <span>{STATUS_AR[h.to] ?? h.to}</span>
            <span className="muted tnum">{fmtDateTime(h.at)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ————— تتبّع بلا حساب ————— */
function TrackPage() {
  const [no, setNo] = useState('');
  const [tail, setTail] = useState('');
  const [res, setRes] = useState<{ orderNo: string; status: string; cashDueSyp: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  return (
    <div className="page">
      <div className="card glass">
        <div className="field">
          <label htmlFor="no">رقم الطلب</label>
          <input id="no" value={no} onChange={(e) => setNo(e.target.value)} placeholder="TS-2607-000001" dir="ltr" />
        </div>
        <div className="field">
          <label htmlFor="tl">آخر أربعة أرقام من جوالك</label>
          <input id="tl" value={tail} onChange={(e) => setTail(e.target.value)} inputMode="numeric" maxLength={4} dir="ltr" />
        </div>
        <ActionButton
          label="تتبّع"
          onClick={async () => {
            setErr(null); setRes(null);
            try { setRes(await api.get(`/orders/${no}/track/${tail}`)); }
            catch { setErr('لم نجد طلباً بهذه البيانات.'); }
          }}
        />
      </div>
      {err && <div className="err">{err}</div>}
      {res && (
        <div className="ok">
          {res.orderNo} — {STATUS_AR[res.status] ?? res.status} · المستحق {fmtSyp(res.cashDueSyp)}
        </div>
      )}
    </div>
  );
}

/* ————— الحساب: دخول برمز، ثم الطلبات ————— */
interface MyOrder {
  orderNo: string; status: string; paymentStatus: string;
  cashDueSyp: number; itemCount: number; placedAt: string;
}

function SignInCard({ onDone }: { onDone: (me: Me) => void }) {
  const [stage, setStage] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('+963');
  const [code, setCode] = useState('');
  const [hint, setHint] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const phoneOk = /^\+9639[0-9]{8}$/.test(phone);

  return (
    <div className="card glass">
      <p className="muted" style={{ lineHeight: 1.7 }}>
        سجّل دخولك لتتابع طلباتك في مكان واحد. لا يلزمك حساب للشراء —
        الدفع عند الاستلام يعمل للضيف أيضاً.
      </p>

      {err && <div className="err">{err}</div>}
      {hint && <div className="ok">{hint}</div>}

      {stage === 'phone' ? (
        <>
          <div className="field">
            <label htmlFor="lp">رقم الجوال</label>
            <input id="lp" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" dir="ltr" />
            {!phoneOk && phone.length > 4 && (
              <span className="hint" style={{ color: 'var(--clay)' }}>
                يجب أن يبدأ بـ +9639 ويتكوّن من اثنتي عشرة خانة.
              </span>
            )}
          </div>
          <ActionButton
            label="أرسل الرمز"
            busyLabel="جارٍ الإرسال…"
            disabled={!phoneOk}
            onClick={async () => {
              setErr(null); setHint(null);
              try {
                const r = await auth.requestOtp(phone);
                setStage('code');
                // devCode يظهر في التطوير فقط — الخادم لا يُعيده في الإنتاج
                setHint(r.devCode ? `رمز التطوير: ${r.devCode}` : 'أرسلنا الرمز على واتساب، وإن تعذّر فرسالة نصية.');
              } catch (e) {
                setErr(e instanceof ApiError ? e.messageAr : 'تعذّر إرسال الرمز');
              }
            }}
          />
        </>
      ) : (
        <>
          <div className="field">
            <label htmlFor="lc">الرمز</label>
            <input id="lc" value={code} onChange={(e) => setCode(e.target.value)}
              inputMode="numeric" maxLength={6} dir="ltr" autoComplete="one-time-code" />
          </div>
          <ActionButton
            label="ادخل"
            busyLabel="جارٍ التحقق…"
            disabled={code.length < 4}
            onClick={async () => {
              setErr(null);
              try { onDone(await auth.verifyOtp(phone, code)); }
              catch (e) { setErr(e instanceof ApiError ? e.messageAr : 'تعذّر التحقق'); }
            }}
          />
          <button className="btn btn--ghost" style={{ marginBlockStart: 8 }}
            onClick={() => { setStage('phone'); setCode(''); setErr(null); setHint(null); }}>
            تغيير الرقم
          </button>
        </>
      )}
    </div>
  );
}


/* ————— أقسام الحساب: العناوين والرغبات والكفالات والتنبيهات والجلسات ————— */

const GOVS: Array<[string, string]> = [
  ['DAMASCUS', 'دمشق'], ['RIF_DIMASHQ', 'ريف دمشق'], ['ALEPPO', 'حلب'],
  ['HOMS', 'حمص'], ['HAMA', 'حماة'], ['LATAKIA', 'اللاذقية'], ['TARTUS', 'طرطوس'],
];

function Addresses() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({
    label: '', recipientName: '', governorate: 'DAMASCUS', city: '',
    neighborhood: '', street: '', landmark: '', phone: '+963',
  });

  const load = () => api.get<any[]>('/me/addresses').then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []);

  return (
    <section>
      <h2 style={{ fontSize: 'var(--step-0)', margin: '20px 0 8px' }}>عناويني</h2>
      {err && <div className="err">{err}</div>}

      {(rows ?? []).map((a) => (
        <div key={a.id} className="card glass">
          <div className="row">
            <b>{a.label || a.recipientName}</b>
            {a.isDefault && <span className="tag">الافتراضي</span>}
          </div>
          <div className="muted" style={{ fontSize: 'var(--step--1)', lineHeight: 1.7 }}>
            {GOVS.find(([v]) => v === a.governorate)?.[1] ?? a.governorate} · {a.city} · {a.neighborhood}
            {a.street ? ` · ${a.street}` : ''}<br />
            المعلم: {a.landmark}
          </div>
          <div className="row">
            {!a.isDefault && (
              <button className="btn btn--ghost" onClick={async () => {
                await api.post(`/me/addresses/${a.id}/default`); load();
              }}>اجعله الافتراضي</button>
            )}
            <button className="btn btn--ghost" onClick={async () => {
              await api.del(`/me/addresses/${a.id}`); load();
            }}>احذف</button>
          </div>
        </div>
      ))}

      {!adding
        ? <button className="btn btn--ghost" onClick={() => setAdding(true)}>+ عنوان جديد</button>
        : (
          <div className="card glass">
            <div className="field"><label htmlFor="al">التسمية (بيت، عمل…)</label>
              <input id="al" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} /></div>
            <div className="field"><label htmlFor="an">اسم المستلم</label>
              <input id="an" value={f.recipientName} onChange={(e) => setF({ ...f, recipientName: e.target.value })} /></div>
            <div className="field"><label htmlFor="ag">المحافظة</label>
              <select id="ag" value={f.governorate} onChange={(e) => setF({ ...f, governorate: e.target.value })}>
                {GOVS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select></div>
            <div className="field"><label htmlFor="ac">المدينة</label>
              <input id="ac" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></div>
            <div className="field"><label htmlFor="ah">الحي</label>
              <input id="ah" value={f.neighborhood} onChange={(e) => setF({ ...f, neighborhood: e.target.value })} /></div>
            <div className="field"><label htmlFor="as">الشارع</label>
              <input id="as" value={f.street} onChange={(e) => setF({ ...f, street: e.target.value })} /></div>
            <div className="field"><label htmlFor="am">المعلم القريب</label>
              <input id="am" value={f.landmark} onChange={(e) => setF({ ...f, landmark: e.target.value })} />
              <span className="hint">إلزامي — المندوب يصل به لا برقم البناء</span></div>
            <div className="field"><label htmlFor="ap">رقم الجوال</label>
              <input id="ap" dir="ltr" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
            <div className="row">
              <button className="btn" onClick={async () => {
                setErr(null);
                try { await api.post('/me/addresses', f); setAdding(false); load(); }
                catch (e) { setErr(e instanceof ApiError ? e.messageAr : 'تعذّر الحفظ'); }
              }}>احفظ</button>
              <button className="btn btn--ghost" onClick={() => setAdding(false)}>إلغاء</button>
            </div>
          </div>
        )}
    </section>
  );
}

function Wishlist() {
  const [rows, setRows] = useState<any[] | null>(null);
  const load = () => api.get<any[]>('/me/wishlist').then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []);

  if (rows === null) return null;
  return (
    <section>
      <h2 style={{ fontSize: 'var(--step-0)', margin: '20px 0 8px' }}>قائمة الرغبات</h2>
      {rows.length === 0
        ? <p className="muted">لا شيء محفوظ بعد.</p>
        : (
          <div className="card glass">
            {rows.map((w) => (
              <div key={w.sku} className="line">
                <span className="mid">
                  <b>{w.name}</b>
                  <small className="muted">
                    {w.available > 0 ? `متوفر (${w.available})` : 'نفد'} ·{' '}
                    {w.priceSyp ? fmtSyp(w.priceSyp) : `${(w.priceUsdCents / 100).toFixed(2)} $`}
                  </small>
                </span>
                <button className="btn btn--ghost" onClick={async () => {
                  await api.del(`/me/wishlist/${w.sku}`); load();
                }}>احذف</button>
              </div>
            ))}
          </div>
        )}
    </section>
  );
}

function Warranties({ phone }: { phone: string }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [imei, setImei] = useState('');
  const [desc, setDesc] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => api.get<any[]>(`/me/warranty-claims?phone=${encodeURIComponent(phone)}`)
    .then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, [phone]);

  return (
    <section>
      <h2 style={{ fontSize: 'var(--step-0)', margin: '20px 0 8px' }}>الكفالة والصيانة</h2>
      {msg && <div className="err">{msg}</div>}

      {(rows ?? []).map((c) => (
        <div key={c.claimNo} className="card glass">
          <div className="row">
            <b className="tnum">{c.claimNo}</b>
            <span className="tag">{CLAIM_STATE_AR[c.state] ?? c.state}</span>
          </div>
          <div style={{ fontSize: 'var(--step--1)' }}>{c.description}</div>
          {c.imei && <div className="muted tnum" dir="ltr" style={{ fontSize: '0.72rem' }}>{c.imei}</div>}
        </div>
      ))}

      <div className="card glass">
        <b>افتح مطالبة صيانة</b>
        <div className="field"><label htmlFor="wi">رقم IMEI</label>
          <input id="wi" dir="ltr" value={imei} onChange={(e) => setImei(e.target.value)} />
          <span className="hint">اطلب ‎*#06#‎ على الجهاز ليظهر الرقم</span></div>
        <div className="field"><label htmlFor="wd">وصف العطل</label>
          <textarea id="wd" rows={3} value={desc} onChange={(e) => setDesc(e.target.value)}
            style={{ width: '100%' }} /></div>
        <p className="muted" style={{ fontSize: '0.72rem' }}>
          خذ نسخة احتياطية قبل تسليم الجهاز: الصيانة قد تستلزم مسح الذاكرة.
        </p>
        <button className="btn" onClick={async () => {
          setMsg(null);
          try {
            await api.post('/me/warranty-claims', { imei: imei.trim(), description: desc, phone });
            setImei(''); setDesc(''); load();
          } catch (e) { setMsg(e instanceof ApiError ? e.messageAr : 'تعذّر فتح المطالبة'); }
        }}>افتح المطالبة</button>
      </div>
    </section>
  );
}

const CLAIM_STATE_AR: Record<string, string> = {
  OPENED: 'مفتوحة', RECEIVED: 'استُلم الجهاز', DIAGNOSING: 'قيد الفحص',
  DECISION: 'قرار', IN_REPAIR: 'قيد الإصلاح', TESTING: 'اختبار',
  READY: 'جاهز للتسليم', CLOSED: 'مغلقة', REJECTED: 'مرفوضة',
};

const PREF_AR: Record<string, string> = {
  orders: 'حالة الطلب', delivery: 'التوصيل والمندوب', promos: 'العروض والخصومات',
  priceAlerts: 'انخفاض السعر', stockAlerts: 'عودة التوفّر',
};

function Preferences() {
  const [prefs, setPrefs] = useState<Record<string, boolean> | null>(null);
  useEffect(() => { api.get<Record<string, boolean>>('/me/notification-prefs').then(setPrefs).catch(() => {}); }, []);
  if (!prefs) return null;

  return (
    <section>
      <h2 style={{ fontSize: 'var(--step-0)', margin: '20px 0 8px' }}>تفضيلات الإشعار</h2>
      <div className="card glass">
        {Object.entries(prefs).map(([k, v]) => (
          <label key={k} className="line" style={{ cursor: 'pointer' }}>
            <span className="mid">{PREF_AR[k] ?? k}</span>
            <input type="checkbox" checked={v} onChange={async (e) => {
              const next = { ...prefs, [k]: e.target.checked };
              setPrefs(next);
              await api.post('/me/notification-prefs', { [k]: e.target.checked }).catch(() => setPrefs(prefs));
            }} />
          </label>
        ))}
      </div>
    </section>
  );
}

function Sessions() {
  const [rows, setRows] = useState<any[] | null>(null);
  const load = () => api.get<any[]>('/me/sessions').then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []);
  if (rows === null) return null;

  return (
    <section>
      <h2 style={{ fontSize: 'var(--step-0)', margin: '20px 0 8px' }}>أجهزتي</h2>
      <p className="muted" style={{ fontSize: 'var(--step--1)', lineHeight: 1.7 }}>
        كل دخول جهازٌ في هذه القائمة. من ضاع هاتفه يُسقط ذلك الجهاز وحده
        بدل إخراج نفسه من كل أجهزته.
      </p>
      <div className="card glass">
        {rows.map((s) => (
          <div key={s.id} className="line">
            <span className="mid">
              <b style={{ fontSize: 'var(--step--1)' }}>{s.current ? 'هذا الجهاز' : 'جهاز آخر'}</b>
              <small className="muted" dir="ltr">{(s.userAgent ?? '').slice(0, 46) || '—'}</small>
            </span>
            {!s.current && (
              <button className="btn btn--ghost" onClick={async () => {
                await api.del(`/me/sessions/${s.id}`); load();
              }}>أسقطه</button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function DeleteAccount() {
  const [state, setState] = useState<any>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => api.get<any>('/me/deletion').then(setState).catch(() => {});
  useEffect(() => { load(); }, []);

  return (
    <section>
      <h2 style={{ fontSize: 'var(--step-0)', margin: '20px 0 8px' }}>حذف الحساب</h2>
      {msg && <div className="err">{msg}</div>}
      <div className="card glass">
        {state?.state === 'PENDING' ? (
          <>
            <p>طلب الحذف مسجَّل، ويُنفَّذ في {fmtDate(state.dueAt)}.</p>
            <button className="btn btn--ghost" onClick={async () => {
              await api.del('/me/deletion'); load();
            }}>ألغِ الطلب</button>
          </>
        ) : (
          <>
            <p className="muted" style={{ fontSize: 'var(--step--1)', lineHeight: 1.8 }}>
              تُحذف عناوينك ورغباتك وتنبيهاتك وجلساتك خلال ثلاثين يوماً. وتبقى سجلات
              الفواتير للمدة المحاسبية الإلزامية: فاتورةٌ صدرت لا تُمحى.
              وأي مطالبة كفالة سارية تبقى قائمة حتى تُغلق — حفظاً لحقّك أنت.
            </p>
            <button className="btn btn--ghost" onClick={async () => {
              if (!confirm('تأكيد طلب حذف الحساب؟')) return;
              setMsg(null);
              try { await api.post('/me/deletion', {}); load(); }
              catch (e) { setMsg(e instanceof ApiError ? e.messageAr : 'تعذّر الطلب'); }
            }}>اطلب حذف حسابي</button>
          </>
        )}
      </div>
    </section>
  );
}

function AccountPage({ nav }: { nav: (to: string) => void }) {
  const [me, setMe] = useState<Me | null>(null);
  const [orders, setOrders] = useState<MyOrder[] | null>(null);
  const [ready, setReady] = useState(false);

  const load = () => {
    api.get<MyOrder[]>('/orders/mine').then(setOrders).catch(() => setOrders([]));
  };

  useEffect(() => {
    if (!auth.isSignedIn()) { setReady(true); return; }
    auth.me()
      .then((u) => { setMe(u); load(); })
      .catch(() => auth.signOut())
      .finally(() => setReady(true));
    const out = () => { setMe(null); setOrders(null); };
    window.addEventListener('auth:expired', out);
    return () => window.removeEventListener('auth:expired', out);
  }, []);

  if (!ready) return <div className="page"><p className="muted">جارٍ التحميل…</p></div>;

  if (!me) {
    return (
      <div className="page">
        <SignInCard onDone={(u) => { setMe(u); load(); }} />
      </div>
    );
  }

  return (
    <div className="page">
      <div className="card glass">
        <div className="row">
          <span className="muted">الرقم</span>
          <span className="tnum" dir="ltr">{me.phone}</span>
        </div>
        {me.fullName && <div className="row"><span className="muted">الاسم</span><span>{me.fullName}</span></div>}
        <button className="btn btn--ghost" style={{ marginBlockStart: 12 }}
          onClick={() => { auth.signOut(); setMe(null); setOrders(null); }}>
          خروج
        </button>
      </div>

      <h2 style={{ fontSize: 'var(--step-0)', margin: '20px 0 8px' }}>طلباتي</h2>

      {orders === null ? <p className="muted">جارٍ التحميل…</p>
        : orders.length === 0 ? (
          <div className="empty">
            <p>لا طلبات بعد.</p>
            <p className="muted">طلباتك السابقة بالرقم نفسه تظهر هنا تلقائياً.</p>
            <a className="btn" href="/" style={{ marginBlockStart: 16 }}>تصفّح المتجر</a>
          </div>
        ) : (
          <div className="card glass">
            {orders.map((o) => (
              <button key={o.orderNo} className="line" style={{ width: '100%', textAlign: 'inherit', background: 'none', border: 0, font: 'inherit', color: 'inherit' }}
                onClick={() => nav(`/app/orders/${o.orderNo}`)}>
                <span className="mid">
                  <b className="tnum">{o.orderNo}</b>
                  <small className="muted">
                    {STATUS_AR[o.status] ?? o.status} · {o.itemCount} قطعة ·{' '}
                    {fmtDate(o.placedAt)}
                  </small>
                </span>
                <span className="tnum" style={{ fontWeight: 700 }}>{fmtSyp(o.cashDueSyp)}</span>
              </button>
            ))}
          </div>
        )}

      <Addresses />
      <Wishlist />
      <Warranties phone={me.phone} />
      <Preferences />
      <Sessions />
      <DeleteAccount />
    </div>
  );
}


/* ————— رمز الخصم ————— */
function CouponBox({ cart, onChange }: { cart: CartSummary; onChange: (c: CartSummary) => void }) {
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const applied = cart.coupon;

  if (applied && !applied.invalidReason) {
    return (
      <div className="ok" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <span>رمز {applied.code} مُطبَّق{applied.freeShipping ? ' — شحن مجاني' : ''}</span>
        <button
          className="btn btn--ghost"
          style={{ minHeight: 34, padding: '0 12px', width: 'auto' }}
          onClick={async () => {
            try { onChange(await api.del<CartSummary>(`/carts/${cart.cartToken}/coupons`)); }
            catch { /* الإزالة لا تُسقط السلة: يبقى المعروض كما هو */ }
          }}
        >
          إزالة
        </button>
      </div>
    );
  }

  return (
    <div className="card glass">
      {applied?.invalidReason && (
        <div className="err">رمز {applied.code} لم يعد صالحاً: {applied.invalidReason}</div>
      )}
      {err && <div className="err">{err}</div>}
      <div className="field">
        <label htmlFor="cp">رمز خصم</label>
        <input id="cp" dir="ltr" value={code} placeholder="SHAM10"
          onChange={(e) => { setCode(e.target.value); setErr(null); }} />
      </div>
      <ActionButton
        label="طبِّق الرمز"
        busyLabel="جارٍ التحقق…"
        className="btn btn--ghost"
        disabled={code.trim().length < 3}
        onClick={async () => {
          setErr(null);
          try { onChange(await api.post<CartSummary>(`/carts/${cart.cartToken}/coupons`, { code })); }
          catch (e) { setErr(e instanceof ApiError ? e.messageAr : 'تعذّر تطبيق الرمز'); }
        }}
      />
    </div>
  );
}

/* ————— طلب إرجاع ————— */
const RETURN_REASONS: Array<[string, string]> = [
  ['NOT_AS_DESCRIBED', 'غير مطابق للوصف'],
  ['DEFECTIVE', 'عيب في الجهاز'],
  ['WRONG_ITEM', 'وصلني صنف خاطئ'],
  ['CHANGED_MIND', 'عدلت عن الشراء'],
  ['DAMAGED_IN_TRANSIT', 'تضرَّر أثناء الشحن'],
];

function ReturnBox({ orderNo }: { orderNo: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('NOT_AS_DESCRIBED');
  const [note, setNote] = useState('');
  const [imei, setImei] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (done) {
    return (
      <div className="ok">
        استلمنا طلب الإرجاع {done}. أبقِ العلبة والملحقات كاملة — سنراجعه ونعلمك خلال يوم عمل.
      </div>
    );
  }

  if (!open) {
    return (
      <button className="btn btn--ghost" onClick={() => setOpen(true)}>
        أريد إرجاع الطلب
      </button>
    );
  }

  return (
    <div className="card glass">
      {err && <div className="err">{err}</div>}
      <p className="muted" style={{ lineHeight: 1.7 }}>
        الإرجاع خلال سبعة أيام من التسليم. يُشترط أن تكون العلبة والملحقات كاملة
        والجهاز بالحالة نفسها. رقم الجهاز يُطابَق مع الذي بعناه لك.
      </p>
      <div className="field">
        <label htmlFor="rr">سبب الإرجاع</label>
        <select id="rr" value={reason} onChange={(e) => setReason(e.target.value)}>
          {RETURN_REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="ri">رقم الجهاز IMEI</label>
        <input id="ri" dir="ltr" inputMode="numeric" value={imei} onChange={(e) => setImei(e.target.value)} />
        <span className="hint">اطلبه بالضغط على ‎*#06#‎ من لوحة الاتصال.</span>
      </div>
      <div className="field">
        <label htmlFor="rn">ملاحظتك</label>
        <textarea id="rn" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <ActionButton
        label="أرسل طلب الإرجاع"
        busyLabel="جارٍ الإرسال…"
        onClick={async () => {
          setErr(null);
          try {
            const r = await api.post<{ returnNo: string }>('/returns', { orderNo, reason, note, imei });
            setDone(r.returnNo);
          } catch (e) { setErr(e instanceof ApiError ? e.messageAr : 'تعذّر إرسال الطلب'); }
        }}
      />
    </div>
  );
}

/* ————— كتابة مراجعة ————— */
function ReviewBox({ orderNo, sku, name }: { orderNo: string; sku: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(5);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (done) return <div className="ok">شكراً — مراجعتك في طابور الإشراف وتُنشر خلال يوم عمل.</div>;
  if (!open) return <button className="btn btn--ghost" onClick={() => setOpen(true)}>قيّم {name}</button>;

  return (
    <div className="card glass">
      {err && <div className="err">{err}</div>}
      <div className="field">
        <label>تقييمك</label>
        <div className="stars" role="group" aria-label="التقييم">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" aria-pressed={rating >= n}
              aria-label={`${n} من 5`} onClick={() => setRating(n)}>
              {rating >= n ? '★' : '☆'}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <label htmlFor="vt">عنوان</label>
        <input id="vt" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="vb">رأيك بعد الاستعمال</label>
        <textarea id="vb" rows={4} value={body} onChange={(e) => setBody(e.target.value)}
          placeholder="البطارية، الكاميرا، الحرارة، الشبكة…" />
      </div>
      <ActionButton
        label="أرسل المراجعة"
        busyLabel="جارٍ الإرسال…"
        onClick={async () => {
          setErr(null);
          try { await api.post('/reviews', { orderNo, sku, rating, title, body }); setDone(true); }
          catch (e) { setErr(e instanceof ApiError ? e.messageAr : 'تعذّر إرسال المراجعة'); }
        }}
      />
    </div>
  );
}

/* ————— الدعم ————— */
interface MyTicket {
  ticketNo: string; status: string; statusAr: string;
  subject: string | null; contactReason: string; orderNo: string | null; createdAt: string;
}
const REASONS: Array<[string, string]> = [
  ['WHERE_IS_MY_ORDER', 'أين طلبي؟'],
  ['DEVICE_ISSUE', 'مشكلة في الجهاز'],
  ['WRONG_AMOUNT', 'خطأ في المبلغ المحصَّل'],
  ['CANCEL_ORDER', 'أريد إلغاء طلب'],
  ['WARRANTY', 'سؤال عن الكفالة'],
  ['OTHER', 'استفسار آخر'],
];

function SupportPage() {
  const [mine, setMine] = useState<MyTicket[] | null>(null);
  const [reason, setReason] = useState('WHERE_IS_MY_ORDER');
  const [orderNo, setOrderNo] = useState('');
  const [body, setBody] = useState('');
  const [phone, setPhone] = useState('+963');
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = () => {
    if (!auth.isSignedIn()) { setMine([]); return; }
    api.get<MyTicket[]>('/support/tickets/mine').then(setMine).catch(() => setMine([]));
  };
  useEffect(() => {
    load();
    if (auth.isSignedIn()) auth.me().then((u) => setPhone((p) => (p === '+963' ? u.phone : p))).catch(() => {});
  }, []);

  const phoneOk = /^\+9639[0-9]{8}$/.test(phone);

  return (
    <div className="page">
      {err && <div className="err">{err}</div>}
      {done && (
        <div className="ok">
          استلمنا رسالتك — رقم التذكرة {done}. سنردّ ضمن ساعات الدوام
          (السبت–الخميس ١٠ صباحاً – ٨ مساءً).
        </div>
      )}

      <div className="card glass">
        <div className="field">
          <label htmlFor="sr">سبب التواصل</label>
          <select id="sr" value={reason} onChange={(e) => setReason(e.target.value)}>
            {REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="so">رقم الطلب (اختياري)</label>
          <input id="so" dir="ltr" value={orderNo} placeholder="TS-2607-000001"
            onChange={(e) => setOrderNo(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="sp">رقم جوالك <span className="req">*</span></label>
          <input id="sp" dir="ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="sb">اشرح المشكلة <span className="req">*</span></label>
          <textarea id="sb" rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
        </div>
        <ActionButton
          label="أرسل"
          busyLabel="جارٍ الإرسال…"
          disabled={!phoneOk || body.trim().length < 5}
          onClick={async () => {
            setErr(null); setDone(null);
            try {
              const t = await api.post<{ ticketNo: string }>('/support/tickets', {
                phone, contactReason: reason, subject: REASONS.find(([v]) => v === reason)?.[1],
                body, orderNo: orderNo || undefined,
              });
              setDone(t.ticketNo); setBody(''); load();
            } catch (e) { setErr(e instanceof ApiError ? e.messageAr : 'تعذّر الإرسال'); }
          }}
        />
      </div>

      {mine && mine.length > 0 && (
        <>
          <h2 style={{ fontSize: 'var(--step-0)', margin: '20px 0 8px' }}>تذاكري</h2>
          <div className="card glass">
            {mine.map((t) => (
              <div className="line" key={t.ticketNo}>
                <span className="mid">
                  <b className="tnum">{t.ticketNo}</b>
                  <small className="muted">
                    {t.subject ?? t.contactReason} · {fmtDate(t.createdAt)}
                  </small>
                </span>
                <span className="tag">{t.statusAr}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function App() {
  const { path, nav } = useRoute();
  const order = match(path, '/app/orders/:orderNo');

  const title =
    order ? 'طلبك'
    : path.startsWith('/app/checkout') ? 'بيانات التسليم'
    : path.startsWith('/app/track') ? 'تتبّع طلب'
    : path.startsWith('/app/account') ? 'حسابي'
    : path.startsWith('/app/support') ? 'الدعم'
    : 'سلتي';

  return (
    <>
      <header className="hd glass">
        <a href="/" aria-label="المتجر" style={{ display: 'grid', placeItems: 'center' }}>
          <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
        </a>
        <h1>{title}</h1>
        <a className="muted sp" href={path.startsWith('/app/account') ? '/app/track' : '/app/account'}>
          {path.startsWith('/app/account') ? 'تتبّع بلا حساب' : 'حسابي'}
        </a>
      </header>

      {order ? <OrderPage orderNo={order.orderNo!} />
        : path.startsWith('/app/checkout') ? <CheckoutPage nav={nav} />
        : path.startsWith('/app/track') ? <TrackPage />
        : path.startsWith('/app/account') ? <AccountPage nav={nav} />
        : path.startsWith('/app/support') ? <SupportPage />
        : <CartPage nav={nav} />}
    </>
  );
}
