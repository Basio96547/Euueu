import { PrismaService } from '../common/prisma.service.js';
import { NotificationsService } from './notifications.service.js';
import { Errors } from '../common/errors.js';


/** مهل أول رد والحل بالدقائق ضمن ساعات العمل — الفصل 14 §14.7 */
const SLA: Record<string, { first: number; resolve: number }> = {
  URGENT: { first: 30, resolve: 4 * 60 },
  HIGH: { first: 120, resolve: 8 * 60 },
  NORMAL: { first: 4 * 60, resolve: 16 * 60 },
  LOW: { first: 8 * 60, resolve: 40 * 60 },
};

const STATUS_AR: Record<string, string> = {
  NEW: 'واردة', OPEN: 'قيد العمل', PENDING_CUSTOMER: 'بانتظار العميل',
  ESCALATED: 'مصعَّدة', RESOLVED: 'حُلَّت', CLOSED: 'مغلقة',
};

/** الحالات التي يتجمّد عندها عدّاد المهلة */
const FROZEN = new Set(['PENDING_CUSTOMER', 'RESOLVED', 'CLOSED']);

export class TicketsService {
  constructor(
    private prisma: PrismaService,
    private notify: NotificationsService,
  ) {}

  /**
   * إضافة دقائق عمل إلى لحظة.
   *
   * ساعات العمل: السبت–الخميس 10:00–20:00 بتوقيت دمشق.
   * التعهّد على مدار الساعة في بلد تنقطع فيه الكهرباء وعدٌ لا يُوفى،
   * ووعدٌ مكسور أسوأ من وعد متواضع مُحترَم. فالعدّاد يمشي في الدوام وحده.
   */
  private addBusinessMinutes(from: Date, minutes: number): Date {
    const OPEN_H = 10, CLOSE_H = 20;
    let left = minutes;
    // العمل بتوقيت دمشق ثم العودة إلى UTC عند الإخراج
    const cur = new Date(from.getTime() + 3 * 3_600_000);

    let guard = 0;
    while (left > 0 && guard++ < 2000) {
      const dow = cur.getUTCDay();               // 5 = الجمعة عطلة
      const h = cur.getUTCHours() + cur.getUTCMinutes() / 60;

      if (dow === 5 || h >= CLOSE_H) {
        cur.setUTCDate(cur.getUTCDate() + 1);
        cur.setUTCHours(OPEN_H, 0, 0, 0);
        continue;
      }
      if (h < OPEN_H) { cur.setUTCHours(OPEN_H, 0, 0, 0); continue; }

      const minsToClose = (CLOSE_H - h) * 60;
      const step = Math.min(left, minsToClose);
      cur.setTime(cur.getTime() + step * 60_000);
      left -= step;
    }
    return new Date(cur.getTime() - 3 * 3_600_000);
  }

  private async nextNo() {
    const now = new Date();
    const seq = (await this.prisma.supportTicket.count()) + 1;
    const yy = String(now.getUTCFullYear()).slice(2);
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    return `TK-${yy}${mm}-${String(seq).padStart(6, '0')}`;
  }

  async open(b: {
    phone: string; contactReason: string; subject?: string; body: string;
    orderNo?: string; channel?: string; priority?: string; userPublicId?: string;
  }) {
    if (!/^\+9639[0-9]{8}$/.test(b.phone)) {
      throw Errors.badRequest('PHONE_INVALID', 'رقم الجوال بصيغة +9639XXXXXXXX', 'Invalid phone');
    }
    if (!b.body?.trim()) {
      throw Errors.badRequest('BODY_REQUIRED', 'اكتب وصف المشكلة', 'Message body required');
    }

    const [user, order] = await Promise.all([
      b.userPublicId
        ? this.prisma.user.findUnique({ where: { publicId: b.userPublicId } })
        : this.prisma.user.findUnique({ where: { phoneE164: b.phone } }),
      b.orderNo ? this.prisma.order.findUnique({ where: { orderNo: b.orderNo } }) : null,
    ]);

    const priority = (b.priority && SLA[b.priority] ? b.priority : 'NORMAL') as keyof typeof SLA;
    const now = new Date();

    const t = await this.prisma.supportTicket.create({
      data: {
        ticketNo: await this.nextNo(),
        userId: user?.id,
        phone: b.phone,
        orderId: order?.id,
        channel: (b.channel ?? 'WEB') as any,
        subject: b.subject,
        contactReason: b.contactReason,
        priority: priority as any,
        slaFirstResponseDueAt: this.addBusinessMinutes(now, SLA[priority]!.first),
        slaResolutionDueAt: this.addBusinessMinutes(now, SLA[priority]!.resolve),
        messages: {
          create: { authorType: 'CUSTOMER', authorId: user?.id, body: b.body.trim() },
        },
      },
    });

    await this.notify.send({
      type: 'ticket.opened', level: 'P2', to: b.phone, entityId: t.ticketNo,
      title: 'استلمنا رسالتك',
      body: `${t.ticketNo} — سنردّ خلال ${SLA[priority]!.first < 60 ? `${SLA[priority]!.first} دقيقة` : `${SLA[priority]!.first / 60} ساعات`} ضمن الدوام.`,
    });

    return { ticketNo: t.ticketNo, status: t.status, priority: t.priority };
  }

  async byNo(ticketNo: string, requesterPublicId?: string) {
    const t = await this.prisma.supportTicket.findUnique({
      where: { ticketNo },
      include: { messages: { orderBy: { createdAt: 'asc' } }, order: true, assignee: true, user: true },
    });
    if (!t) throw Errors.notFound('التذكرة');

    // العميل يرى تذكرته وحدها، والملاحظات الداخلية ليست له
    const isStaff = !requesterPublicId ? false : t.user?.publicId !== requesterPublicId;
    return {
      ticketNo: t.ticketNo, status: t.status, statusAr: STATUS_AR[t.status] ?? t.status,
      priority: t.priority, contactReason: t.contactReason, subject: t.subject,
      orderNo: t.order?.orderNo ?? null,
      assignee: t.assignee?.fullName ?? null,
      slaFirstResponseDueAt: t.slaFirstResponseDueAt,
      slaBreached: t.slaBreached,
      createdAt: t.createdAt, resolvedAt: t.resolvedAt,
      messages: t.messages
        .filter((m) => isStaff || !m.isInternalNote)
        .map((m) => ({
          authorType: m.authorType, body: m.body,
          isInternalNote: m.isInternalNote, createdAt: m.createdAt,
        })),
    };
  }

  /** تذاكري: بالهوية لا برقم يُخمَّن */
  async mine(userPublicId: string) {
    const user = await this.prisma.user.findUnique({ where: { publicId: userPublicId } });
    if (!user) throw Errors.notFound('المستخدم');
    const rows = await this.prisma.supportTicket.findMany({
      where: { OR: [{ userId: user.id }, { phone: user.phoneE164 }] },
      orderBy: { createdAt: 'desc' }, take: 30,
      include: { order: true },
    });
    return rows.map((t) => ({
      ticketNo: t.ticketNo, status: t.status, statusAr: STATUS_AR[t.status] ?? t.status,
      subject: t.subject, contactReason: t.contactReason,
      orderNo: t.order?.orderNo ?? null, createdAt: t.createdAt,
    }));
  }

  async list(status?: string) {
    const rows = await this.prisma.supportTicket.findMany({
      where: status ? { status: status as any } : { status: { notIn: ['CLOSED'] } },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }], take: 60,
      include: { order: true, assignee: true, messages: { take: 1, orderBy: { createdAt: 'desc' } } },
    });
    const now = Date.now();
    return rows.map((t) => ({
      ticketNo: t.ticketNo, status: t.status, statusAr: STATUS_AR[t.status] ?? t.status,
      priority: t.priority, contactReason: t.contactReason, subject: t.subject,
      phone: t.phone, orderNo: t.order?.orderNo ?? null,
      assignee: t.assignee?.fullName ?? null,
      lastMessage: t.messages[0]?.body?.slice(0, 90) ?? '',
      // «متأخرة» تُحسب على المهلة المخزَّنة لا على عمر التذكرة الخام
      overdue: Boolean(
        !t.firstResponseAt && t.slaFirstResponseDueAt && t.slaFirstResponseDueAt.getTime() < now,
      ),
      createdAt: t.createdAt,
    }));
  }

  /** رد الوكيل: أول رد يوقف عداد المهلة ويُرسَل للعميل */
  async reply(ticketNo: string, actorPublicId: string, b: { body: string; internal?: boolean; macroCode?: string }) {
    const t = await this.prisma.supportTicket.findUnique({ where: { ticketNo } });
    if (!t) throw Errors.notFound('التذكرة');
    if (t.status === 'CLOSED') {
      throw Errors.invalidTransition('CLOSED', 'OPEN');
    }
    const actor = await this.prisma.user.findUnique({ where: { publicId: actorPublicId } });

    let body = b.body;
    let macroId: string | undefined;
    if (b.macroCode) {
      const m = await this.prisma.ticketMacro.findUnique({ where: { code: b.macroCode } });
      if (m) {
        macroId = m.id;
        body = (m.body as any).ar ?? body;
        await this.prisma.ticketMacro.update({ where: { id: m.id }, data: { usageCount: { increment: 1 } } });
      }
    }

    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.ticketMessage.create({
        data: {
          ticketId: t.id, authorType: 'AGENT', authorId: actor?.id,
          body, isInternalNote: Boolean(b.internal), macroId,
          deliveryChannel: b.internal ? null : t.channel,
        },
      }),
      this.prisma.supportTicket.update({
        where: { id: t.id },
        data: {
          // الملاحظة الداخلية ليست رداً: لا توقف عداد العميل
          ...(b.internal ? {} : {
            firstResponseAt: t.firstResponseAt ?? now,
            status: t.status === 'NEW' ? 'OPEN' : t.status,
            slaBreached: t.slaBreached || Boolean(
              !t.firstResponseAt && t.slaFirstResponseDueAt && t.slaFirstResponseDueAt < now,
            ),
          }),
          ...(actor && !t.assigneeId ? { assigneeId: actor.id } : {}),
        },
      }),
    ]);

    if (!b.internal) {
      await this.notify.send({
        type: 'ticket.replied', level: 'P2', to: t.phone, entityId: ticketNo,
        title: `رد على ${ticketNo}`, body,
      });
    }
    return { ticketNo, replied: true, internal: Boolean(b.internal) };
  }

  /** رد العميل يعيد فتح تذكرته المجمَّدة */
  async customerReply(ticketNo: string, userPublicId: string, body: string) {
    const t = await this.prisma.supportTicket.findUnique({ where: { ticketNo }, include: { user: true } });
    if (!t) throw Errors.notFound('التذكرة');
    const user = await this.prisma.user.findUnique({ where: { publicId: userPublicId } });
    if (!user || (t.userId !== user.id && t.phone !== user.phoneE164)) {
      throw Errors.badRequest('NOT_YOUR_TICKET', 'هذه التذكرة ليست لك', 'Not your ticket');
    }
    await this.prisma.$transaction([
      this.prisma.ticketMessage.create({
        data: { ticketId: t.id, authorType: 'CUSTOMER', authorId: user.id, body },
      }),
      this.prisma.supportTicket.update({
        where: { id: t.id },
        data: { status: FROZEN.has(t.status) && t.status !== 'CLOSED' ? 'OPEN' : t.status },
      }),
    ]);
    return { ticketNo, sent: true };
  }

  async transition(ticketNo: string, to: string, actorPublicId: string) {
    const t = await this.prisma.supportTicket.findUnique({ where: { ticketNo } });
    if (!t) throw Errors.notFound('التذكرة');
    if (!STATUS_AR[to]) throw Errors.badRequest('STATUS_INVALID', 'حالة غير معروفة', 'Unknown status');
    const actor = await this.prisma.user.findUnique({ where: { publicId: actorPublicId } });
    const now = new Date();

    const row = await this.prisma.supportTicket.update({
      where: { id: t.id },
      data: {
        status: to as any,
        ...(to === 'RESOLVED' ? { resolvedAt: now } : {}),
        ...(to === 'CLOSED' ? { closedAt: now } : {}),
        ...(to === 'ESCALATED' && actor ? { assigneeId: actor.id } : {}),
      },
    });

    if (to === 'RESOLVED') {
      await this.notify.send({
        type: 'ticket.resolved', level: 'P2', to: t.phone, entityId: ticketNo,
        title: 'حُلَّت مشكلتك؟',
        body: `${ticketNo} — أغلقنا التذكرة. لو بقي شيء ردّ على هذه الرسالة وتُفتح من جديد.`,
      });
    }
    return { ticketNo, status: row.status, statusAr: STATUS_AR[row.status] };
  }

  async csat(ticketNo: string, score: number, comment?: string) {
    if (!Number.isInteger(score) || score < 1 || score > 5) {
      throw Errors.badRequest('SCORE_INVALID', 'التقييم من 1 إلى 5', 'Score must be 1..5');
    }
    await this.prisma.supportTicket.update({
      where: { ticketNo }, data: { csatScore: score, csatComment: comment },
    });
    return { ticketNo, recorded: true };
  }

  /** مؤشرات الدعم — الفصل 14 §14.9 */
  async metrics(days = 30) {
    const since = new Date(Date.now() - days * 86_400_000);
    const rows = await this.prisma.supportTicket.findMany({
      where: { createdAt: { gte: since } },
      select: {
        status: true, priority: true, contactReason: true, createdAt: true,
        firstResponseAt: true, resolvedAt: true, slaBreached: true, csatScore: true,
      },
    });

    const frts = rows
      .filter((t) => t.firstResponseAt)
      .map((t) => (t.firstResponseAt!.getTime() - t.createdAt.getTime()) / 60_000)
      .sort((a, b) => a - b);
    const median = frts.length ? frts[Math.floor(frts.length / 2)]! : 0;

    const csats = rows.filter((t) => t.csatScore).map((t) => t.csatScore!);
    const reasons: Record<string, number> = {};
    for (const t of rows) reasons[t.contactReason] = (reasons[t.contactReason] ?? 0) + 1;

    const delivered = await this.prisma.order.count({
      where: { status: 'DELIVERED', deliveredAt: { gte: since } },
    });

    return {
      days,
      total: rows.length,
      open: rows.filter((t) => !['RESOLVED', 'CLOSED'].includes(t.status)).length,
      slaBreached: rows.filter((t) => t.slaBreached).length,
      frtMedianMinutes: Math.round(median),
      csatAverage: csats.length ? Math.round((csats.reduce((a, b) => a + b, 0) / csats.length) * 10) / 10 : null,
      // تذاكر لكل 100 طلب مسلَّم: المؤشر الذي يقول إن المشكلة في المنتج لا في الوكلاء
      contactRate: delivered ? Math.round((rows.length / delivered) * 1000) / 10 : null,
      topReasons: Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 5)
        .map(([reason, count]) => ({ reason, count })),
    };
  }

  async macros() {
    const rows = await this.prisma.ticketMacro.findMany({ where: { isActive: true }, orderBy: { usageCount: 'desc' } });
    return rows.map((m) => ({
      code: m.code, title: (m.title as any).ar, body: (m.body as any).ar,
      variables: m.variables, usageCount: m.usageCount,
    }));
  }
}

