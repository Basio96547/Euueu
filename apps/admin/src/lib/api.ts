const BASE = import.meta.env.VITE_API_URL ?? '/api/v1';

export class ApiError extends Error {
  constructor(public code: string, public messageAr: string, public details?: unknown) {
    super(messageAr);
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
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
