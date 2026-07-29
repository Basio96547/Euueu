import {
  CanActivate, ExecutionContext, Injectable, Inject,
  SetMetadata, HttpStatus, applyDecorators, UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from './prisma.service.js';
import { ApiError } from './errors.js';
import { verify, type Claims } from './jwt.js';

export const ROLES_KEY = 'roles';
/** الصلاحيات باصطلاح مورد:فعل:نطاق — والأدوار تُترجم إليها في جدول واحد */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

export interface AuthedRequest extends Request {
  user?: Claims;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private reflector: Reflector,
    @Inject(PrismaService) private prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      ctx.getHandler(), ctx.getClass(),
    ]);
    if (!required || required.length === 0) return true;   // مسار عام

    const req = ctx.switchToHttp().getRequest();
    const header = String(req.headers['authorization'] ?? '');
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
      throw new ApiError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED',
        { ar: 'يلزم تسجيل الدخول', en: 'Authentication required' });
    }

    const claims = verify(token);
    if (!claims || claims.typ !== 'access') {
      throw new ApiError(HttpStatus.UNAUTHORIZED, 'TOKEN_INVALID',
        { ar: 'الجلسة غير صالحة أو منتهية', en: 'Invalid or expired session' });
    }

    // إبطال الجلسات: رفع tokenVersion يُسقط كل الرموز الصادرة سابقاً
    const user = await this.prisma.user.findUnique({ where: { publicId: claims.sub } });
    if (!user || user.deletedAt || user.tokenVersion !== claims.tv) {
      throw new ApiError(HttpStatus.UNAUTHORIZED, 'SESSION_REVOKED',
        { ar: 'أُبطلت الجلسة — سجّل الدخول من جديد', en: 'Session revoked' });
    }

    if (!required.includes(user.role)) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'FORBIDDEN',
        { ar: 'لا تملك صلاحية هذا الإجراء', en: 'Insufficient permissions' },
        { required, actual: user.role });
    }

    req.user = { ...claims, role: user.role };
    return true;
  }
}

/** يجمع الحارس والأدوار في مُزخرِف واحد حتى لا يُنسى أحدهما */
export const Protect = (...roles: string[]) =>
  applyDecorators(Roles(...roles), UseGuards(AuthGuard));

/**
 * مصادقة اختيارية: تملأ req.user إن جاء رمز صالح، ولا ترفض إن لم يأتِ.
 * يلزم للمسارات التي تعمل للضيف والزبون معاً — إنشاء الطلب مثلاً:
 * منع الضيف من الشراء خسارة بيع، وتجاهل هوية الداخل يُيتّم طلبه.
 */
@Injectable()
export class OptionalAuthGuard implements CanActivate {
  constructor(@Inject(PrismaService) private prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const header = String(req.headers['authorization'] ?? '');
    if (!header.startsWith('Bearer ')) return true;

    const claims = verify(header.slice(7));
    if (!claims || claims.typ !== 'access') return true;   // رمز تالف يُعامَل كضيف

    const user = await this.prisma.user.findUnique({ where: { publicId: claims.sub } });
    if (user && !user.deletedAt && user.tokenVersion === claims.tv) {
      req.user = { ...claims, role: user.role };
    }
    return true;
  }
}

export const MaybeAuth = () => UseGuards(OptionalAuthGuard);
