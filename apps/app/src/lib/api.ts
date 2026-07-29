const BASE = import.meta.env.VITE_API_URL ?? '/api/v1';

export class ApiError extends Error {
  constructor(public code: string, public messageAr: string, public details?: unknown) {
    super(messageAr);
  }
}

export const tokens = {
  get access() { return localStorage.getItem('access_token'); },
  get refresh() { return localStorage.getItem('refresh_token'); },
  set(access: string, refresh: string) {
    localStorage.setItem('access_token', access);
    localStorage.setItem('refresh_token', refresh);
    window.dispatchEvent(new Event('auth:changed'));
  },
  clear() {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    window.dispatchEvent(new Event('auth:changed'));
  },
};

/**
 * تجديد صامت بطلب واحد.
 * رمز الوصول يعيش خمس عشرة دقيقة والزبون قد يبقى ساعة يتصفّح،
 * فلو أخرجناه عند أول 401 لخسر سلّته. ولأن الصفحة قد تُطلق عدّة طلبات
 * معاً فتفشل كلها في اللحظة نفسها، يُحتفظ بوعد واحد يشترك فيه الجميع
 * بدل أن يُستهلك رمز التحديث مرات متوازية.
 */
let refreshing: Promise<boolean> | null = null;

function refreshOnce(): Promise<boolean> {
  const rt = tokens.refresh;
  if (!rt) return Promise.resolve(false);
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: rt }),
      });
      if (!res.ok) return false;
      const { data } = await res.json();
      tokens.set(data.accessToken, data.refreshToken);
      return true;
    } catch {
      return false;                       // انقطاع شبكة: لا تُسقط الجلسة
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

function once(path: string, init?: RequestInit): Promise<Response> {
  const access = tokens.access;
  return fetch(BASE + path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(access ? { authorization: `Bearer ${access}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  let res = await once(path, init);

  // مسارات /auth/* تُستثنى: فشلها هو الفشل نفسه لا انتهاء جلسة
  if (res.status === 401 && tokens.refresh && !path.startsWith('/auth/')) {
    if (await refreshOnce()) res = await once(path, init);
    else { tokens.clear(); window.dispatchEvent(new Event('auth:expired')); }
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = (body as any).error;
    throw new ApiError(e?.code ?? 'UNKNOWN', e?.message?.ar ?? 'حدث خطأ غير متوقع', e?.details);
  }
  return (body as any).data as T;
}

export const api = {
  get: <T>(p: string) => req<T>(p),
  post: <T>(p: string, body?: unknown, headers?: Record<string, string>) =>
    req<T>(p, { method: 'POST', body: JSON.stringify(body ?? {}), headers }),
  del: <T>(p: string) => req<T>(p, { method: 'DELETE' }),
};

export interface Me {
  publicId: string; phone: string; role: string;
  fullName: string | null; locale: string; displayCurrency: string;
}

export const auth = {
  isSignedIn: () => Boolean(tokens.access),
  requestOtp: (phone: string) =>
    api.post<{ sent: boolean; expiresInSec: number; devCode?: string }>('/auth/otp/request', { phone }),
  async verifyOtp(phone: string, code: string) {
    const d = await api.post<{ accessToken: string; refreshToken: string; user: Me }>(
      '/auth/otp/verify', { phone, code },
    );
    tokens.set(d.accessToken, d.refreshToken);
    return d.user;
  },
  me: () => api.get<Me>('/auth/me'),
  signOut: () => tokens.clear(),
};

/** مفتاح تفرّد لكل عملية حساسة — الضغط المكرر على شبكة متقطعة هو القاعدة */
export const idemKey = () => crypto.randomUUID();

export const fmtSyp = (n: number) => n.toLocaleString('en-US') + ' ل.س';
export const fmtUsd = (c: number) => (c / 100).toFixed(2) + ' $';

/**
 * أرقام لاتينية في التواريخ كما في الأسعار وأرقام الطلبات.
 * ar-SY وحدها تُخرج أرقاماً هندية، فيقرأ الزبون سطراً واحداً بخطَّي أرقام:
 * ٢٠٢٦/٧/٢٩ بجانب TS-2607-000005 — والعين تتعثّر قبل أن تفهم.
 */
const AR = 'ar-SY-u-nu-latn';
export const fmtDate = (d: string | Date) =>
  new Date(d).toLocaleDateString(AR, { year: 'numeric', month: 'numeric', day: 'numeric' });
export const fmtDateTime = (d: string | Date) =>
  new Date(d).toLocaleString(AR, {
    year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
