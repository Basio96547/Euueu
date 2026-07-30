import { PrismaService } from '../common/prisma.service.js';
import { Errors } from '../common/errors.js';

/**
 * إدارة المستخدمين والأدوار والجلسات — الفصل 9، ومهمة «مراجعة الصلاحيات
 * والجلسات الإدارية النشطة» الشهرية في 19.2.
 *
 * كان منح الدور من سطر الأوامر وحده. وهو حصنٌ جيد ضد التصعيد من الويب،
 * لكنه يجعل المراجعة الشهرية مستحيلة: لا شاشة تُظهر من يملك ماذا. فصار
 * المنح من اللوحة بشرطين: فاعلٌ مديرٌ عام، وسجلُّ تدقيق لكل تغيير.
 */

const ROLES = ['CUSTOMER', 'SUPPORT', 'CATALOG_ADMIN', 'OPS_MANAGER', 'WAREHOUSE', 'COURIER', 'ADMIN'] as const;
type Role = (typeof ROLES)[number];

/** الأرقام تُقنَّع لغير المدير العام: الاطلاع الكامل ليس حقاً بالوظيفة */
const maskPhone = (p: string) => p.replace(/^(\+9639\d{2})\d{4}(\d{2})$/, '$1••••$2');

export class UsersAdminService {
  constructor(private prisma: PrismaService) {}

  async list(opts: { role?: string; q?: string; staffOnly?: boolean }, viewerRole: string) {
    const rows = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        ...(opts.role ? { role: opts.role as any } : {}),
        ...(opts.staffOnly ? { role: { not: 'CUSTOMER' } } : {}),
        ...(opts.q
          ? {
              OR: [
                { phoneE164: { contains: opts.q } },
                /* SQLite: `LIKE` غير حسّاس لحالة الأحرف اللاتينية أصلاً،
                   والعربية بلا حالة — فلا حاجة إلى `mode` ولا وجود له. */
                { fullName: { contains: opts.q } },
              ],
            }
          : {}),
      },
      orderBy: [{ role: 'asc' }, { createdAt: 'desc' }],
      take: 100,
      include: {
        _count: { select: { orders: true, sessions: true } },
      },
    });

    const full = viewerRole === 'ADMIN';
    return rows.map((u) => ({
      publicId: u.publicId,
      phone: full ? u.phoneE164 : maskPhone(u.phoneE164),
      fullName: u.fullName,
      role: u.role,
      hasPassword: Boolean(u.passwordHash),
      lockedUntil: u.lockedUntil,
      failedLogins: u.failedLogins,
      orders: u._count.orders,
      activeSessions: u._count.sessions,
      createdAt: u.createdAt,
    }));
  }

  /** الجلسات الإدارية النشطة — مادة المراجعة الشهرية */
  async staffSessions() {
    const rows = await this.prisma.session.findMany({
      where: { revokedAt: null, user: { role: { not: 'CUSTOMER' }, deletedAt: null } },
      orderBy: { lastSeenAt: 'desc' },
      take: 100,
      include: { user: true },
    });
    return rows.map((s) => ({
      id: s.id,
      publicId: s.user.publicId,
      name: s.user.fullName,
      role: s.user.role,
      userAgent: s.userAgent,
      ip: s.ip,
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
    }));
  }

  /**
   * تغيير الدور.
   * رفع `tokenVersion` شرطٌ لا تحسين: من هُبط دوره يجب أن تسقط رموزه
   * الصادرة بالدور القديم فوراً، وإلا بقي يعمل بصلاحيةٍ سُحبت منه إلى
   * أن ينتهي الرمز من تلقاء نفسه.
   */
  async setRole(publicId: string, role: string, actorPublicId: string, reason?: string) {
    if (!ROLES.includes(role as Role)) {
      throw Errors.badRequest('ROLE_UNKNOWN', `دور غير معروف: ${role}`, 'Unknown role');
    }
    const [target, actor] = await Promise.all([
      this.prisma.user.findUnique({ where: { publicId } }),
      this.prisma.user.findUnique({ where: { publicId: actorPublicId } }),
    ]);
    if (!target || target.deletedAt) throw Errors.notFound('المستخدم');
    if (!actor) throw Errors.notFound('الفاعل');

    if (target.id === actor.id && target.role === 'ADMIN' && role !== 'ADMIN') {
      /* منع المدير العام من إسقاط نفسه: آخر مديرٍ ينزع صلاحيته يقفل
         اللوحة على الجميع، ولا سبيل للعودة إلا من سطر الأوامر. */
      throw Errors.badRequest('CANNOT_DEMOTE_SELF',
        'لا تُسقط صلاحيتك بنفسك — كلّف مديراً آخر بذلك', 'Cannot demote yourself');
    }
    if (target.role === 'ADMIN' && role !== 'ADMIN') {
      const admins = await this.prisma.user.count({ where: { role: 'ADMIN', deletedAt: null } });
      if (admins <= 1) {
        throw Errors.badRequest('LAST_ADMIN',
          'هذا آخر مدير عام — عيّن غيره قبل إنزال دوره', 'Cannot demote the last admin');
      }
    }

    const updated = await this.prisma.user.update({
      where: { id: target.id },
      data: { role: role as any, tokenVersion: { increment: 1 } },
    });
    await this.prisma.session.updateMany({
      where: { userId: target.id, revokedAt: null }, data: { revokedAt: new Date() },
    });
    await this.prisma.auditLog.create({
      data: {
        actorId: actor.id, action: 'user.set_role', entityType: 'users', entityId: target.id,
        diff: { from: target.role, to: role, reason: reason ?? null },
      },
    });
    return { publicId, role: updated.role, sessionsRevoked: true };
  }

  /** فكّ القفل بعد المحاولات الفاشلة — يقع كثيراً بحسن نية */
  async unlock(publicId: string, actorPublicId: string) {
    const [target, actor] = await Promise.all([
      this.prisma.user.findUnique({ where: { publicId } }),
      this.prisma.user.findUnique({ where: { publicId: actorPublicId } }),
    ]);
    if (!target) throw Errors.notFound('المستخدم');
    await this.prisma.user.update({
      where: { id: target.id }, data: { failedLogins: 0, lockedUntil: null },
    });
    await this.prisma.auditLog.create({
      data: { actorId: actor?.id, action: 'user.unlock', entityType: 'users', entityId: target.id, diff: {} },
    });
    return { publicId, locked: false };
  }

  /** إسقاط كل جلسات مستخدم — للهاتف الضائع وللموظّف المنتهية علاقته */
  async revokeAllSessions(publicId: string, actorPublicId: string) {
    const [target, actor] = await Promise.all([
      this.prisma.user.findUnique({ where: { publicId } }),
      this.prisma.user.findUnique({ where: { publicId: actorPublicId } }),
    ]);
    if (!target) throw Errors.notFound('المستخدم');
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: target.id }, data: { tokenVersion: { increment: 1 } } }),
      this.prisma.session.updateMany({
        where: { userId: target.id, revokedAt: null }, data: { revokedAt: new Date() },
      }),
    ]);
    await this.prisma.auditLog.create({
      data: {
        actorId: actor?.id, action: 'user.revoke_sessions',
        entityType: 'users', entityId: target.id, diff: {},
      },
    });
    return { publicId, revoked: true };
  }

  /** سجل التدقيق: من فعل ماذا ومتى — أساس المراجعة الشهرية */
  async auditTrail(opts: { entityType?: string; action?: string; limit?: number }) {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        ...(opts.entityType ? { entityType: opts.entityType } : {}),
        ...(opts.action ? { action: { contains: opts.action } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(opts.limit ?? 100, 200),
    });

    const actorIds = [...new Set(rows.map((r) => r.actorId).filter(Boolean))] as string[];
    const actors = await this.prisma.user.findMany({ where: { id: { in: actorIds } } });
    const byId = new Map(actors.map((a) => [a.id, a]));

    return rows.map((r) => ({
      at: r.createdAt,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      actor: r.actorId ? (byId.get(r.actorId)?.fullName ?? byId.get(r.actorId)?.phoneE164 ?? null) : null,
      diff: r.diff,
    }));
  }
}
