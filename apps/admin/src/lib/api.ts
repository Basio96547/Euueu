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
  },
  clear() { localStorage.removeItem('access_token'); localStorage.removeItem('refresh_token'); },
};

/**
 * تجديد صامت بطلب واحد.
 * رمز الوصول يعيش خمس عشرة دقيقة، والموظّف يبقى في اللوحة نوبة كاملة —
 * فإخراجه كلّ ربع ساعة عقوبة لا أمان. ولأن اللوحة تُطلق عدّة طلبات معاً
 * فتفشل كلها في اللحظة نفسها، يُحتفظ بوعد واحد يشترك فيه الجميع
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
  if (res.status === 401 && !path.startsWith('/auth/')) {
    // انتهاء الجلسة يُخرج المستخدم بدل أن يترك اللوحة تعرض أخطاء غامضة
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
};

/** مفتاح تفرّد لكل عملية حساسة — الضغط المكرر على شبكة متقطعة هو القاعدة */
export const idemKey = () => crypto.randomUUID();

export const fmtSyp = (n: number) => n.toLocaleString('en-US') + ' ل.س';
export const fmtUsd = (c: number) => (c / 100).toFixed(2) + ' $';
