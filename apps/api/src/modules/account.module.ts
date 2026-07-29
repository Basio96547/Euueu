import { PrismaService } from '../common/prisma.service.js';
import { Errors } from '../common/errors.js';
import { FxService } from './fx.module.js';
import { roundCash } from '../common/money.js';

/**
 * الحساب: العناوين، والجلسات، وقائمة الرغبات، وتفضيلات الإشعار،
 * وطلب حذف الحساب (الفصلان 9 و14، وبند الجاهزية 25).
 *
 * ما كان ناقصاً هنا لم يكن ترفاً: عنوانٌ يُكتب في كل طلب من جديد يزيد
 * أخطاء التسليم، وجلسةٌ لا تُرى ولا تُسقَط تعني أن من ضاع هاتفه لا
 * حيلة له، وحذفُ حسابٍ لا سبيل إليه وعدٌ مكتوب في سياسة لا تُنفَّذ.
 */

const DELETION_GRACE_DAYS = 30;

export class AccountService {
  constructor(private prisma: PrismaService, private fx: FxService) {}

  private async userOf(publicId: string) {
    const u = await this.prisma.user.findUnique({ where: { publicId } });
    if (!u || u.deletedAt) throw Errors.notFound('المستخدم');
    return u;
  }

  /* ————————————————— العناوين ————————————————— */

  async addresses(publicId: string) {
    const u = await this.userOf(publicId);
    const rows = await this.prisma.address.findMany({
      where: { userId: u.id, deletedAt: null },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map((a) => ({
      id: a.id, label: a.label, recipientName: a.recipientName,
      governorate: a.governorate, city: a.city, neighborhood: a.neighborhood,
      street: a.street, landmark: a.landmark, details: a.details,
      phone: a.phone, altPhone: a.altPhone, isDefault: a.isDefault,
    }));
  }

  async addAddress(publicId: string, b: {
    label?: string; recipientName: string; governorate: string; city: string;
    neighborhood: string; street?: string; landmark: string; details?: string;
    phone: string; altPhone?: string; isDefault?: boolean;
  }) {
    const u = await this.userOf(publicId);

    /* المعلم القريب إلزامي: العناوين الرسمية غير موثوقة عملياً، والمندوب
       يصل بالمعلم لا برقم البناء. قبولُه فارغاً يُنتج توصيلة فاشلة. */
    if (!b.landmark?.trim()) {
      throw Errors.badRequest('LANDMARK_REQUIRED',
        'المعلم القريب إلزامي — المندوب يصل به لا برقم البناء', 'Landmark is required');
    }
    if (!/^\+9639[0-9]{8}$/.test(b.phone ?? '')) {
      throw Errors.badRequest('PHONE_INVALID', 'رقم الجوال بصيغة +9639XXXXXXXX', 'Invalid phone');
    }
    if (!b.recipientName?.trim() || !b.city?.trim() || !b.neighborhood?.trim()) {
      throw Errors.badRequest('ADDRESS_INCOMPLETE',
        'الاسم والمدينة والحي مطلوبة', 'Recipient, city and neighborhood are required');
    }

    const count = await this.prisma.address.count({ where: { userId: u.id, deletedAt: null } });
    const makeDefault = b.isDefault || count === 0;

    const created = await this.prisma.$transaction(async (tx) => {
      if (makeDefault) {
        await tx.address.updateMany({ where: { userId: u.id }, data: { isDefault: false } });
      }
      return tx.address.create({
        data: {
          userId: u.id, label: b.label, recipientName: b.recipientName.trim(),
          governorate: b.governorate as any, city: b.city.trim(), neighborhood: b.neighborhood.trim(),
          street: b.street, landmark: b.landmark.trim(), details: b.details,
          phone: b.phone, altPhone: b.altPhone, isDefault: makeDefault,
        },
      });
    });
    return { id: created.id, isDefault: created.isDefault };
  }

  async setDefaultAddress(publicId: string, id: string) {
    const u = await this.userOf(publicId);
    const a = await this.prisma.address.findFirst({ where: { id, userId: u.id, deletedAt: null } });
    if (!a) throw Errors.notFound('العنوان');
    await this.prisma.$transaction([
      this.prisma.address.updateMany({ where: { userId: u.id }, data: { isDefault: false } }),
      this.prisma.address.update({ where: { id }, data: { isDefault: true } }),
    ]);
    return { id, isDefault: true };
  }

  /** حذف ناعم: الطلبات القديمة تشير إلى العنوان، ومحوُه يفقدها وجهتها */
  async removeAddress(publicId: string, id: string) {
    const u = await this.userOf(publicId);
    const a = await this.prisma.address.findFirst({ where: { id, userId: u.id, deletedAt: null } });
    if (!a) throw Errors.notFound('العنوان');
    await this.prisma.address.update({ where: { id }, data: { deletedAt: new Date(), isDefault: false } });
    return { id, removed: true };
  }

  /* ————————————————— الجلسات ————————————————— */

  async sessions(publicId: string, currentSid?: string) {
    const u = await this.userOf(publicId);
    const rows = await this.prisma.session.findMany({
      where: { userId: u.id, revokedAt: null },
      orderBy: { lastSeenAt: 'desc' },
      take: 50,
    });
    return rows.map((s) => ({
      id: s.id,
      current: s.id === currentSid,
      userAgent: s.userAgent,
      ip: s.ip,
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
    }));
  }

  async revokeSession(publicId: string, id: string) {
    const u = await this.userOf(publicId);
    const s = await this.prisma.session.findFirst({ where: { id, userId: u.id } });
    if (!s) throw Errors.notFound('الجلسة');
    if (s.revokedAt) return { id, revoked: true };
    await this.prisma.session.update({ where: { id }, data: { revokedAt: new Date() } });
    return { id, revoked: true };
  }

  /* ————————————————— قائمة الرغبات ————————————————— */

  async wishlist(publicId: string) {
    const u = await this.userOf(publicId);
    const [rows, fx] = await Promise.all([
      this.prisma.wishlistItem.findMany({
        where: { userId: u.id },
        orderBy: { createdAt: 'desc' },
        include: { variant: { include: { product: true, levels: true } } },
      }),
      this.fx.current().catch(() => null),
    ]);
    return rows.map((w) => {
      const usd = Number(w.variant.priceUsdCents);
      const available = w.variant.levels.reduce((a, l) => a + (l.onHand - l.reserved), 0);
      return {
        sku: w.variant.sku,
        slug: w.variant.product.slug,
        name: (w.variant.product.name as any).ar,
        priceUsdCents: usd,
        priceSyp: fx ? roundCash((usd * fx.rate) / 100) : null,
        available,
        addedAt: w.createdAt,
      };
    });
  }

  async addWish(publicId: string, sku: string) {
    const [u, v] = await Promise.all([
      this.userOf(publicId),
      this.prisma.productVariant.findUnique({ where: { sku } }),
    ]);
    if (!v) throw Errors.notFound(`المتغيّر ${sku}`);
    await this.prisma.wishlistItem.upsert({
      where: { userId_variantId: { userId: u.id, variantId: v.id } },
      update: {},
      create: { userId: u.id, variantId: v.id },
    });
    return { sku, saved: true };
  }

  async removeWish(publicId: string, sku: string) {
    const [u, v] = await Promise.all([
      this.userOf(publicId),
      this.prisma.productVariant.findUnique({ where: { sku } }),
    ]);
    if (!v) throw Errors.notFound(`المتغيّر ${sku}`);
    await this.prisma.wishlistItem.deleteMany({ where: { userId: u.id, variantId: v.id } });
    return { sku, saved: false };
  }

  /* ————————————————— تفضيلات الإشعار ————————————————— */

  private static readonly PREF_KEYS = ['orders', 'delivery', 'promos', 'priceAlerts', 'stockAlerts'];

  async prefs(publicId: string) {
    const u = await this.userOf(publicId);
    const stored = (u.notifyPrefs ?? {}) as Record<string, boolean>;
    const out: Record<string, boolean> = {};
    for (const k of AccountService.PREF_KEYS) {
      /* الافتراضي مفتوحٌ لما يخصّ الطلب ومغلقٌ للترويج: رسائل التسليم
         خدمةٌ طلبها الزبون بشرائه، والعروض دعوةٌ يقبلها بنفسه. */
      out[k] = stored[k] ?? (k !== 'promos');
    }
    return out;
  }

  async setPrefs(publicId: string, b: Record<string, unknown>) {
    const u = await this.userOf(publicId);
    const cur = await this.prefs(publicId);
    for (const [k, v] of Object.entries(b)) {
      if (!AccountService.PREF_KEYS.includes(k)) {
        throw Errors.badRequest('PREF_UNKNOWN', `تفضيل غير معروف: ${k}`, 'Unknown preference');
      }
      cur[k] = Boolean(v);
    }
    await this.prisma.user.update({ where: { id: u.id }, data: { notifyPrefs: cur } });
    return cur;
  }

  /* ————————————————— حذف الحساب ————————————————— */

  /**
   * الحذف مؤجَّل ثلاثين يوماً كما تقول سياسة الخصوصية، ولا يُنفَّذ على
   * حسابٍ عليه طلبٌ جارٍ أو مطالبةُ كفالة مفتوحة: إسقاط حساب صاحب جهاز
   * تحت الصيانة يُسقط حقّه هو لا التزامنا نحن.
   */
  async requestDeletion(publicId: string, reason?: string) {
    const u = await this.userOf(publicId);

    const open = await this.prisma.order.count({
      where: {
        userId: u.id,
        status: { in: ['PENDING_CONFIRMATION', 'PROCESSING', 'SHIPPED', 'OUT_FOR_DELIVERY', 'RETURN_REQUESTED'] },
      },
    });
    if (open > 0) {
      throw Errors.badRequest('OPEN_ORDERS',
        `لديك ${open} طلباً جارياً — يُغلق الطلب أولاً ثم يُحذف الحساب`,
        'Close open orders before deletion', { openOrders: open });
    }

    const claims = await this.prisma.warrantyClaim.count({
      where: { phone: u.phoneE164, state: { notIn: ['CLOSED', 'REJECTED'] } },
    });
    if (claims > 0) {
      throw Errors.badRequest('OPEN_WARRANTY_CLAIMS',
        `لديك ${claims} مطالبة كفالة مفتوحة — إغلاقها أولاً حفظاً لحقّك`,
        'Close open warranty claims first', { openClaims: claims });
    }

    const existing = await this.prisma.accountDeletionRequest.findFirst({
      where: { userId: u.id, state: 'PENDING' },
    });
    if (existing) {
      return { state: 'PENDING', dueAt: existing.dueAt, note: 'طلب الحذف مسجَّل مسبقاً' };
    }

    const dueAt = new Date(Date.now() + DELETION_GRACE_DAYS * 86_400_000);
    const req = await this.prisma.accountDeletionRequest.create({
      data: { userId: u.id, reason, dueAt },
    });
    await this.prisma.auditLog.create({
      data: {
        actorId: u.id, action: 'account.deletion_requested',
        entityType: 'users', entityId: u.id, diff: { dueAt: dueAt.toISOString() },
      },
    });
    return {
      state: req.state,
      dueAt: req.dueAt,
      note: `يُنفَّذ الحذف بعد ${DELETION_GRACE_DAYS} يوماً. تُحذف عناوينك ورغباتك وتنبيهاتك وجلساتك، وتبقى سجلات الفواتير للمدة المحاسبية الإلزامية.`,
    };
  }

  async cancelDeletion(publicId: string) {
    const u = await this.userOf(publicId);
    const req = await this.prisma.accountDeletionRequest.findFirst({
      where: { userId: u.id, state: 'PENDING' },
    });
    if (!req) throw Errors.notFound('طلب الحذف');
    await this.prisma.accountDeletionRequest.update({
      where: { id: req.id }, data: { state: 'CANCELLED', completedAt: new Date() },
    });
    return { state: 'CANCELLED' };
  }

  async deletionStatus(publicId: string) {
    const u = await this.userOf(publicId);
    const req = await this.prisma.accountDeletionRequest.findFirst({
      where: { userId: u.id, state: 'PENDING' },
    });
    return req ? { state: req.state, requestedAt: req.requestedAt, dueAt: req.dueAt } : { state: null };
  }

  /**
   * تنفيذ ما استحقّ — يُستدعى من المهمة المجدوَلة.
   * ما يُحذف: العناوين والرغبات والتنبيهات والجلسات والتفضيلات، ويُجهَّل
   * الاسم والرقم. وما يبقى: صفّ المستخدم مربوطاً بطلباته، لأن فاتورةً
   * صدرت لا تُمحى، وطلباً بلا صاحبٍ يكسر التسويات المحاسبية.
   */
  async runDueDeletions(now = new Date()) {
    const due = await this.prisma.accountDeletionRequest.findMany({
      where: { state: 'PENDING', dueAt: { lte: now } },
      include: { user: true },
      take: 50,
    });

    let done = 0;
    for (const req of due) {
      const u = req.user;
      await this.prisma.$transaction(async (tx) => {
        await tx.address.updateMany({ where: { userId: u.id }, data: { deletedAt: now } });
        await tx.wishlistItem.deleteMany({ where: { userId: u.id } });
        await tx.priceAlert.deleteMany({ where: { userId: u.id } });
        await tx.stockAlert.deleteMany({ where: { userId: u.id } });
        await tx.pushSubscription.deleteMany({ where: { userId: u.id } });
        await tx.session.updateMany({ where: { userId: u.id }, data: { revokedAt: now } });
        await tx.user.update({
          where: { id: u.id },
          data: {
            fullName: null,
            phoneE164: `+000${u.id.slice(0, 9).replace(/\D/g, '0').padEnd(9, '0')}`,
            passwordHash: null,
            notifyPrefs: {},
            deletedAt: now,
            tokenVersion: { increment: 1 },
          },
        });
        await tx.accountDeletionRequest.update({
          where: { id: req.id }, data: { state: 'COMPLETED', completedAt: now },
        });
        await tx.auditLog.create({
          data: {
            action: 'account.deleted', entityType: 'users', entityId: u.id,
            diff: { requestedAt: req.requestedAt.toISOString(), executedAt: now.toISOString() },
          },
        });
      });
      done++;
    }
    return { deleted: done };
  }
}
