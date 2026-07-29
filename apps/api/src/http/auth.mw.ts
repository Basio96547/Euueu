import type { MiddlewareHandler } from 'hono';
import { HttpStatus } from '../common/http-status.js';
import { ApiError } from '../common/errors.js';
import { verify, type Claims } from '../common/jwt.js';
import type { PrismaService } from '../common/prisma.service.js';

/**
 * الحراسة — الفصل 9.
 *
 * المنطق حرفياً كما كان في حارس Nest: رمزٌ صالح، ونسخةُ رمز مطابقة
 * (رفعها يُبطل كل الجلسات)، وجلسةٌ غير مُبطَلة، ودورٌ ضمن المسموح.
 * ما تغيّر هو الغلاف لا القاعدة.
 */

export interface Ctx {
  Variables: { user?: Claims & { role: string } };
  Bindings: Record<string, unknown>;
}

async function resolve(prisma: PrismaService, token: string | null, strict: boolean) {
  if (!token) {
    if (!strict) return null;
    throw new ApiError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED',
      { ar: 'يلزم تسجيل الدخول', en: 'Authentication required' });
  }

  const claims = verify(token);
  if (!claims || claims.typ !== 'access') {
    if (!strict) return null;   // رمز تالف يُعامَل كضيف على المسارات المفتوحة
    throw new ApiError(HttpStatus.UNAUTHORIZED, 'TOKEN_INVALID',
      { ar: 'الجلسة غير صالحة أو منتهية', en: 'Invalid or expired session' });
  }

  const user = await prisma.user.findUnique({ where: { publicId: claims.sub } });
  if (!user || user.deletedAt || user.tokenVersion !== claims.tv) {
    if (!strict) return null;
    throw new ApiError(HttpStatus.UNAUTHORIZED, 'SESSION_REVOKED',
      { ar: 'أُبطلت الجلسة — سجّل الدخول من جديد', en: 'Session revoked' });
  }

  /* إبطال جلسة بعينها: من ضاع هاتفه يريد إسقاط ذلك الجهاز وحده،
     لا إخراج نفسه من كل أجهزته. الرمز يحمل معرّف جلسته. */
  if (claims.sid) {
    const session = await prisma.session.findUnique({ where: { id: claims.sid } });
    if (!session || session.revokedAt) {
      if (!strict) return null;
      throw new ApiError(HttpStatus.UNAUTHORIZED, 'SESSION_REVOKED',
        { ar: 'أُبطلت هذه الجلسة — سجّل الدخول من جديد', en: 'Session revoked' });
    }
  }

  return { ...claims, role: user.role } as Claims & { role: string };
}

const bearer = (h: string | undefined) =>
  h && h.startsWith('Bearer ') ? h.slice(7) : null;

/** يرفض من لا يملك أحد الأدوار المذكورة */
export const protect = (prisma: PrismaService, ...roles: string[]): MiddlewareHandler<Ctx> =>
  async (c, next) => {
    const claims = await resolve(prisma, bearer(c.req.header('authorization')), true);
    if (!roles.includes(claims!.role)) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'FORBIDDEN',
        { ar: 'لا تملك صلاحية هذا الإجراء', en: 'Insufficient permissions' },
        { required: roles, actual: claims!.role });
    }
    c.set('user', claims!);
    await next();
  };

/**
 * مصادقة اختيارية: تملأ المستخدم إن جاء رمز صالح ولا ترفض إن لم يأتِ.
 * تلزم للمسارات التي تعمل للضيف والزبون معاً — إنشاء الطلب مثلاً:
 * منع الضيف من الشراء خسارة بيع، وتجاهل هوية الداخل يُيتّم طلبه.
 */
export const maybeAuth = (prisma: PrismaService): MiddlewareHandler<Ctx> =>
  async (c, next) => {
    const claims = await resolve(prisma, bearer(c.req.header('authorization')), false);
    if (claims) c.set('user', claims);
    await next();
  };

export const ANY_ROLE = [
  'CUSTOMER', 'SUPPORT', 'CATALOG_ADMIN', 'OPS_MANAGER', 'WAREHOUSE', 'COURIER', 'ADMIN',
] as const;

export const STAFF = ['CATALOG_ADMIN', 'OPS_MANAGER', 'ADMIN'] as const;
