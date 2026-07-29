import { useEffect, useState } from 'react';
import { api, ApiError, idemKey, fmtSyp, fmtUsd } from './lib/api.js';
import { useRoute, match } from './lib/router.js';

/* ————— أنواع الاستجابة ————— */
interface CartLine { sku: string; name: string; qty: number; unitPriceUsdCents: number; lineTotalUsdCents: number }
interface CartSummary {
  cartToken: string; lines: CartLine[]; shippingUsdCents: number;
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
        setCart(await api.get<CartSummary>(`/carts/${token}`));
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

  return (
    <div className="page">
      <div className="card glass">
        {cart.lines.map((l) => (
          <div className="line" key={l.sku}>
            <span className="mid">
              <b>{l.name}</b>
              <small className="muted">{l.qty} × {fmtUsd(l.unitPriceUsdCents)}</small>
            </span>
            <span className="tnum" style={{ fontWeight: 700 }}>{fmtUsd(l.lineTotalUsdCents)}</span>
          </div>
        ))}
        <div className="row"><span className="muted">التوصيل</span><span className="tnum">{fmtUsd(cart.shippingUsdCents)}</span></div>
        <div className="tot"><span>المستحق نقداً</span><span className="tnum">{fmtSyp(cart.totals.cashSyp)}</span></div>
      </div>

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
            nav(`/app/orders/${order.orderNo}`);
          } catch (e) {
            setErr(e instanceof ApiError ? e.messageAr : 'تعذّر إنشاء الطلب');
          }
        }}
      />
    </div>
  );
}

/* ————— تتبّع الطلب ————— */
function OrderPage({ orderNo }: { orderNo: string }) {
  const [o, setO] = useState<OrderView | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.get<OrderView>(`/orders/${orderNo}`).then(setO)
      .catch((e) => setErr(e instanceof ApiError ? e.messageAr : 'تعذّر جلب الطلب'));
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
            <span className="muted tnum">{new Date(h.at).toLocaleString('ar-SY')}</span>
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

export default function App() {
  const { path, nav } = useRoute();
  const order = match(path, '/app/orders/:orderNo');

  const title =
    order ? 'طلبك'
    : path.startsWith('/app/checkout') ? 'بيانات التسليم'
    : path.startsWith('/app/track') ? 'تتبّع طلب'
    : 'سلتي';

  return (
    <>
      <header className="hd glass">
        <a href="/" aria-label="المتجر" style={{ display: 'grid', placeItems: 'center' }}>
          <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
        </a>
        <h1>{title}</h1>
        <a className="muted sp" href="/app/track">تتبّع بلا حساب</a>
      </header>

      {order ? <OrderPage orderNo={order.orderNo!} />
        : path.startsWith('/app/checkout') ? <CheckoutPage nav={nav} />
        : path.startsWith('/app/track') ? <TrackPage />
        : <CartPage nav={nav} />}
    </>
  );
}
