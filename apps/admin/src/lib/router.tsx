import { useEffect, useState } from 'react';

/**
 * موجّه صغير على History API.
 * يُستبدل بـ TanStack Router عند توسّع المسارات وظهور حاجة إلى
 * تحميل مسبق ومسارات متداخلة — وهو ما لا يبرّر تكلفته الآن.
 */
/**
 * البادئة: اللوحة تُخدَم من ‎/admin‎ على النطاق الرئيسي ومن الجذر على
 * ‎admin.talisham.com‎. المسارات في الشيفرة تبقى «‎/orders‎» في الحالتين،
 * والبادئة تُضاف وتُنزع هنا — فلا تتكرّر في كل زرّ.
 */
const BASE = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');

const strip = (p: string) => {
  if (BASE && p.startsWith(BASE)) return p.slice(BASE.length) || '/';
  return p || '/';
};

export function useRoute() {
  const [path, setPath] = useState(() => strip(window.location.pathname));
  useEffect(() => {
    const on = () => setPath(strip(window.location.pathname));
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  const nav = (to: string) => {
    window.history.pushState({}, '', `${BASE}${to === '/' ? '/' : to}`);
    setPath(to);
  };
  return { path, nav };
}

export function match(path: string, pattern: string): Record<string, string> | null {
  const p = path.replace(/\/+$/, '') || '/';
  const a = p.split('/').filter(Boolean);
  const b = pattern.split('/').filter(Boolean);
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < b.length; i++) {
    const seg = b[i]!;
    if (seg.startsWith(':')) params[seg.slice(1)] = decodeURIComponent(a[i]!);
    else if (seg !== a[i]) return null;
  }
  return params;
}
