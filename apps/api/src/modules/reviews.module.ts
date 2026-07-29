import { PrismaService } from '../common/prisma.service.js';
import { Errors } from '../common/errors.js';

/** لا مراجعة قبل ثلاثة أيام من التسليم — الفصل 14 §14.5 */
const COOLDOWN_DAYS = 3;

/**
 * كلمات ترفع الراية ولا ترفض تلقائياً.
 * الرفض الآلي يقتل مراجعات صادقة غاضبة، والراية تُبقي القرار لإنسان.
 */
const FLAG_TERMS = [
  'احتيال', 'نصب', 'حرامي', 'مسروق', 'كذاب',
  'واتساب', 'تلغرام', 'اتصل بي', 'رقمي',
];

export class ReviewsService {
  constructor(private prisma: PrismaService) {}

  private flag(text: string) {
    const t = text.toLowerCase();
    return FLAG_TERMS.some((w) => t.includes(w));
  }

  /**
   * كتابة مراجعة.
   * الشرط ليس «حساباً» بل «شراءً مسلَّماً»: order_item_id فريد في الجدول،
   * فلا يكتب أحد رأيين في القطعة نفسها ولا يكتب رأياً في جهاز لم يمسكه.
   */
  async create(userPublicId: string, b: { orderNo: string; sku: string; rating: number; title?: string; body?: string }) {
    if (!Number.isInteger(b.rating) || b.rating < 1 || b.rating > 5) {
      throw Errors.badRequest('RATING_INVALID', 'التقييم من نجمة إلى خمس', 'Rating must be 1..5');
    }

    const user = await this.prisma.user.findUnique({ where: { publicId: userPublicId } });
    if (!user) throw Errors.notFound('المستخدم');

    const order = await this.prisma.order.findUnique({
      where: { orderNo: b.orderNo },
      include: { items: { include: { variant: { include: { product: true } } } } },
    });
    if (!order) throw Errors.notFound('الطلب');
    if (order.userId !== user.id) {
      throw Errors.badRequest('NOT_YOUR_ORDER', 'هذا الطلب ليس لك', 'Not your order');
    }
    if (order.status !== 'DELIVERED') {
      throw Errors.badRequest('NOT_DELIVERED',
        'تُكتب المراجعة بعد التسليم', 'Review requires a delivered order');
    }

    const delivered = order.deliveredAt ?? order.collectedAt;
    const days = delivered ? (Date.now() - delivered.getTime()) / 86_400_000 : 0;
    if (days < COOLDOWN_DAYS) {
      throw Errors.badRequest('REVIEW_TOO_EARLY',
        `جرّب الجهاز ${COOLDOWN_DAYS} أيام ثم اكتب رأيك — بقي ${Math.ceil(COOLDOWN_DAYS - days)} يوماً`,
        'Review cooldown not elapsed');
    }

    const item = order.items.find((i) => i.variant.sku === b.sku);
    if (!item) throw Errors.badRequest('ITEM_NOT_IN_ORDER', 'هذا الصنف ليس في طلبك', 'Item not in order');

    const exists = await this.prisma.review.findUnique({ where: { orderItemId: item.id } });
    if (exists) {
      throw Errors.badRequest('REVIEW_EXISTS', 'كتبتَ مراجعتك لهذا الصنف', 'Already reviewed');
    }

    const text = `${b.title ?? ''} ${b.body ?? ''}`;
    const row = await this.prisma.review.create({
      data: {
        productId: item.variant.productId,
        userId: user.id,
        orderItemId: item.id,
        rating: b.rating,
        title: b.title,
        body: b.body,
        flagged: this.flag(text),
      },
    });

    return {
      id: row.id, status: row.status, flagged: row.flagged,
      note: 'مراجعتك في طابور الإشراف وتُنشر خلال يوم عمل.',
    };
  }

  /** المنشورة فقط، مع توزيع النجوم — يُقرأ من الموقع الساكن وقت البناء */
  async forProduct(slug: string) {
    const product = await this.prisma.product.findFirst({ where: { slug, deletedAt: null } });
    if (!product) throw Errors.notFound('المنتج');

    const rows = await this.prisma.review.findMany({
      where: { productId: product.id, status: 'PUBLISHED' },
      orderBy: { createdAt: 'desc' }, take: 50,
      include: { user: true },
    });

    const dist = [0, 0, 0, 0, 0];
    for (const r of rows) dist[r.rating - 1]!++;
    const avg = rows.length ? rows.reduce((a, r) => a + r.rating, 0) / rows.length : 0;

    return {
      count: rows.length,
      average: Math.round(avg * 10) / 10,
      distribution: { 1: dist[0], 2: dist[1], 3: dist[2], 4: dist[3], 5: dist[4] },
      items: rows.map((r) => ({
        rating: r.rating, title: r.title, body: r.body,
        // الاسم الأول وحده: مراجعة عامة لا تُفشي هوية من كتبها
        author: (r.user.fullName ?? 'زبون').split(' ')[0],
        createdAt: r.createdAt,
        merchantReply: r.merchantReply,
        merchantReplyAt: r.merchantReplyAt,
      })),
    };
  }

  async report(reviewId: string, userPublicId: string | undefined, reason: string, note?: string) {
    const ok = ['SPAM', 'OFFENSIVE', 'FAKE', 'WRONG_PRODUCT', 'PRIVACY'];
    if (!ok.includes(reason)) {
      throw Errors.badRequest('REASON_INVALID', `السبب من: ${ok.join('، ')}`, 'Invalid reason');
    }
    const user = userPublicId
      ? await this.prisma.user.findUnique({ where: { publicId: userPublicId } })
      : null;

    await this.prisma.reviewReport.upsert({
      where: { reviewId_reporterId: { reviewId, reporterId: user?.id ?? null } as any },
      update: { reason, note },
      create: { reviewId, reporterId: user?.id, reason, note },
    });

    // ثلاثة بلاغات تُخفي المراجعة مؤقتاً: الستر ريثما ينظر إنسان، لا حكم
    const count = await this.prisma.reviewReport.count({ where: { reviewId, status: 'OPEN' } });
    if (count >= 3) {
      await this.prisma.review.update({ where: { id: reviewId }, data: { status: 'HIDDEN', flagged: true } });
    }
    return { reported: true, hidden: count >= 3 };
  }

  /* ————— الإشراف ————— */

  async queue(status = 'PENDING') {
    const rows = await this.prisma.review.findMany({
      where: { status: status as any },
      orderBy: [{ flagged: 'desc' }, { createdAt: 'asc' }], take: 60,
      include: { user: true, product: true, reports: true },
    });
    return rows.map((r) => ({
      id: r.id, rating: r.rating, title: r.title, body: r.body,
      flagged: r.flagged, status: r.status,
      product: (r.product.name as any).ar,
      author: r.user.fullName ?? r.user.phoneE164,
      reports: r.reports.length,
      createdAt: r.createdAt,
    }));
  }

  async moderate(id: string, to: 'PUBLISHED' | 'REJECTED', actorPublicId: string, rejectReason?: string) {
    if (to === 'REJECTED' && !rejectReason) {
      throw Errors.badRequest('REJECT_REASON_REQUIRED', 'الرفض يحتاج سبباً', 'Reject reason required');
    }
    const actor = await this.prisma.user.findUnique({ where: { publicId: actorPublicId } });
    const row = await this.prisma.review.update({
      where: { id },
      data: { status: to, rejectReason, moderatedBy: actor?.id, moderatedAt: new Date() },
    });

    // متوسط التقييم يُعاد حسابه من المنشور وحده لا من كل ما كُتب
    await this.recount(row.productId);
    return { id: row.id, status: row.status };
  }

  private async recount(productId: string) {
    const agg = await this.prisma.review.aggregate({
      where: { productId, status: 'PUBLISHED' },
      _avg: { rating: true }, _count: true,
    });
    await this.prisma.product.update({
      where: { id: productId },
      data: {
        ratingAvg: agg._avg.rating ? Math.round(agg._avg.rating * 100) / 100 : null,
        ratingCount: agg._count,
      },
    });
  }

  async reply(id: string, body: string) {
    const row = await this.prisma.review.update({
      where: { id }, data: { merchantReply: body, merchantReplyAt: new Date() },
    });
    return { id: row.id, replied: true };
  }

  /* ————— أسئلة المنتج ————— */

  async ask(userPublicId: string, slug: string, body: string) {
    if (body.trim().length < 5) {
      throw Errors.badRequest('QUESTION_TOO_SHORT', 'اكتب سؤالاً أوضح', 'Question too short');
    }
    const [user, product] = await Promise.all([
      this.prisma.user.findUnique({ where: { publicId: userPublicId } }),
      this.prisma.product.findFirst({ where: { slug, deletedAt: null } }),
    ]);
    if (!user) throw Errors.notFound('المستخدم');
    if (!product) throw Errors.notFound('المنتج');

    const row = await this.prisma.productQuestion.create({
      data: { productId: product.id, userId: user.id, body: body.trim() },
    });
    return { id: row.id, status: row.status };
  }

  async questions(slug: string) {
    const product = await this.prisma.product.findFirst({ where: { slug, deletedAt: null } });
    if (!product) throw Errors.notFound('المنتج');
    const rows = await this.prisma.productQuestion.findMany({
      where: { productId: product.id, status: 'PUBLISHED' },
      orderBy: { helpfulCount: 'desc' }, take: 30,
    });
    return rows.map((q) => ({
      body: q.body, answer: q.answerBody, answerSource: q.answerSource,
      answeredAt: q.answeredAt,
    }));
  }

  async answer(id: string, actorPublicId: string, answerBody: string, publish = true) {
    const actor = await this.prisma.user.findUnique({ where: { publicId: actorPublicId } });
    const row = await this.prisma.productQuestion.update({
      where: { id },
      data: {
        answerBody, answerSource: 'STAFF', answeredBy: actor?.id, answeredAt: new Date(),
        status: publish ? 'PUBLISHED' : 'PENDING',
      },
    });
    return { id: row.id, status: row.status };
  }

  async questionQueue() {
    const rows = await this.prisma.productQuestion.findMany({
      where: { status: 'PENDING' }, orderBy: { createdAt: 'asc' }, take: 60,
      include: { product: true, user: true },
    });
    return rows.map((q) => ({
      id: q.id, body: q.body,
      product: (q.product.name as any).ar,
      author: q.user.fullName ?? q.user.phoneE164,
      createdAt: q.createdAt,
    }));
  }
}

