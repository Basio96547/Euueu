import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';

const SECRET = process.env.JWT_SECRET ?? 'dev_only_change_me';
const b64u = (b: Buffer | string) =>
  Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

export interface Claims {
  sub: string;          // معرّف المستخدم العام
  role: string;
  tv: number;           // نسخة الرمز — رفعها يُبطل كل الجلسات فوراً
  jti: string;
  exp: number;
  typ: 'access' | 'refresh';
}

function sign(payload: Claims) {
  const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify(payload));
  const mac = b64u(createHmac('sha256', SECRET).update(`${head}.${body}`).digest());
  return `${head}.${body}.${mac}`;
}

export function issue(sub: string, role: string, tv: number) {
  const now = Math.floor(Date.now() / 1000);
  return {
    accessToken: sign({ sub, role, tv, jti: randomUUID(), exp: now + 15 * 60, typ: 'access' }),
    refreshToken: sign({ sub, role, tv, jti: randomUUID(), exp: now + 30 * 86400, typ: 'refresh' }),
    expiresIn: 15 * 60,
  };
}

export function verify(token: string): Claims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [head, body, mac] = parts as [string, string, string];
  const expected = createHmac('sha256', SECRET).update(`${head}.${body}`).digest();
  const got = unb64u(mac);
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
  try {
    const claims = JSON.parse(unb64u(body).toString()) as Claims;
    if (claims.exp < Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch { return null; }
}
