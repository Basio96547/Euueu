import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { ApiError } from '../common/errors.js';
import { HttpStatus } from '../common/http-status.js';
import { rateLimit } from '../common/rate-limit.js';
import { makePrisma, type PrismaService, type D1Binding } from '../common/prisma.service.js';
import type { Ctx } from './auth.mw.js';
import { registerRoutes } from './routes.js';
import { send } from './json.js';

import { FxService } from '../modules/fx.module.js';
import { CatalogService } from '../modules/catalog.module.js';
import { CartService } from '../modules/cart.module.js';
import { OrdersService } from '../modules/orders.module.js';
import { AuthService } from '../modules/auth.module.js';
import { NotificationsService } from '../modules/notifications.service.js';
import { SearchService } from '../modules/search.module.js';
import { WarrantyService } from '../modules/warranty.module.js';
import { ProcurementService } from '../modules/procurement.module.js';
import { SettlementsService } from '../modules/settlements.module.js';
import { ReturnsService } from '../modules/returns.module.js';
import { CouponsService } from '../modules/coupons.module.js';
import { ReviewsService } from '../modules/reviews.module.js';
import { TicketsService } from '../modules/tickets.module.js';
import { AlertsService } from '../modules/alerts.module.js';
import { ProductsAdminService } from '../modules/products.admin.js';
import type { R2Binding } from '../modules/storage.js';
import { PushService } from '../modules/push.module.js';
import { DeliveryService } from '../modules/delivery.module.js';
import { AdminService } from '../modules/admin.module.js';
import { CourierService } from '../modules/courier.module.js';
import { ReadinessService } from '../modules/readiness.module.js';
import { AccountService } from '../modules/account.module.js';
import { ReportsService } from '../modules/reports.module.js';
import { UsersAdminService } from '../modules/users.admin.js';
import { ReservationSweeper } from '../modules/reservations.sweeper.js';

/**
 * تجميع الخدمات وتوصيلها.
 *
 * كان هذا عمل حاقن التبعيات في Nest. وهو هنا دالّة واحدة صريحة: كل
 * خدمة تُبنى مرة، وتُمرَّر تبعياتها بالاسم. الصريح أطول بأسطر، وأوضح
 * حين يُقرأ، ولا يجرّ إطاراً كاملاً إلى حزمة تُقاس بالميغابايت.
 */
export interface Deps {
  prisma: PrismaService;
  fx: FxService;
  catalog: CatalogService;
  cart: CartService;
  orders: OrdersService;
  auth: AuthService;
  notify: NotificationsService;
  search: SearchService;
  warranty: WarrantyService;
  procurement: ProcurementService;
  settlements: SettlementsService;
  returns: ReturnsService;
  coupons: CouponsService;
  reviews: ReviewsService;
  tickets: TicketsService;
  alerts: AlertsService;
  products: ProductsAdminService;
  push: PushService;
  delivery: DeliveryService;
  admin: AdminService;
  courier: CourierService;
  readiness: ReadinessService;
  account: AccountService;
  reports: ReportsService;
  users: UsersAdminService;
  sweeper: ReservationSweeper;
}

export function buildDeps(db: D1Binding, media?: R2Binding): Deps {
  const prisma = makePrisma(db);
  const notify = new NotificationsService(prisma);
  const fx = new FxService(prisma);
  const catalog = new CatalogService(prisma);
  const coupons = new CouponsService(prisma);
  // التوصيل قبل السلة والطلبات: كلتاهما تسعّر الشحن بمناطقه
  const delivery = new DeliveryService(prisma, notify);
  const cart = new CartService(prisma, fx, coupons, delivery);
  const orders = new OrdersService(prisma, fx, cart, coupons, notify, delivery);
  const auth = new AuthService(prisma, notify);
  const search = new SearchService(prisma);
  const warranty = new WarrantyService(prisma, notify);
  const procurement = new ProcurementService(prisma);
  const settlements = new SettlementsService(prisma, notify);
  const returns = new ReturnsService(prisma, fx, notify);
  const reviews = new ReviewsService(prisma);
  const tickets = new TicketsService(prisma, notify);
  const push = new PushService(prisma);
  const alerts = new AlertsService(prisma, notify, fx);
  const products = new ProductsAdminService(prisma, media);
  const sweeper = new ReservationSweeper(prisma);
  const admin = new AdminService(prisma, orders, notify, sweeper);
  const courier = new CourierService(prisma, notify, settlements);
  const readiness = new ReadinessService(prisma);
  const account = new AccountService(prisma, fx);
  const reports = new ReportsService(prisma, fx);
  const users = new UsersAdminService(prisma);

  return {
    prisma, fx, catalog, cart, orders, auth, notify, search, warranty, procurement,
    settlements, returns, coupons, reviews, tickets, alerts, products, push, delivery,
    admin, courier, readiness, account, reports, users, sweeper,
  };
}

/**
 * التطبيق الواحد: يعمل داخل Cloudflare Worker وداخل Node بالشيفرة نفسها.
 * البادئة `api/v1` وصيغة الخطأ وترويسات CORS كما كانت حرفياً — العملاء
 * المنشورون لا يعرفون أن الطبقة تحتهم تبدّلت، وهذا هو المطلوب.
 */
export function createApp(deps: Deps, env: Record<string, unknown> = {}) {
  const app = new Hono<Ctx>();

  /*
    كان يعكس أيَّ أصلٍ طالب مع `credentials: true` — أي أن أيّ موقعٍ يزوره
    الزبون يستطيع مناداة كل مسارات المتجر برمزه. وهي صيغةٌ يرفضها
    المتصفح نفسه لو كانت `*`، فالانعكاس التفافٌ عليها لا حلٌّ لها.

    والحقيقة أن الموقع والتطبيقين والواجهة على أصلٍ واحد منذ توحيد
    الـWorker، فالـCORS غير محتاجٍ إليه أصلاً. يبقى لأدوات التطوير
    المحلية ولنطاق الموقع المعلن وحدهما.
  */
  const siteOrigin = typeof env.PUBLIC_SITE_URL === 'string'
    ? env.PUBLIC_SITE_URL.replace(/\/$/, '') : 'https://talisham.com';
  const allowed = new Set([
    siteOrigin,
    siteOrigin.replace('https://', 'https://www.'),
    'http://localhost:4321', 'http://127.0.0.1:4321',
    'http://localhost:8787', 'http://127.0.0.1:8787',
  ]);

  app.use('*', cors({
    origin: (o) => (o && allowed.has(o) ? o : siteOrigin),
    credentials: false,
    allowHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
    allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    exposeHeaders: ['RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset', 'Retry-After'],
  }));

  app.use('/api/v1/*', rateLimit(env));

  app.onError((err, c) => {
    if (err instanceof ApiError) return send(c, err.body(), err.status);

    /* خطأ غير متوقَّع: يُسجَّل كاملاً ويصل العميل مقتضباً — تفاصيل
       الداخل ليست من شأنه، ورسالةٌ مبهمة خيرٌ من تسريب أثر مكدّس. */
    console.error('[api] خطأ غير متوقَّع:', err);
    return send(c, {
      error: {
        code: 'INTERNAL',
        message: { ar: 'خطأ غير متوقَّع — حاول ثانية', en: 'Unexpected error' },
      },
    }, HttpStatus.INTERNAL_SERVER_ERROR);
  });

  app.notFound((c) => send(c, {
    error: { code: 'NOT_FOUND', message: { ar: 'المسار غير موجود', en: 'Route not found' } },
  }, HttpStatus.NOT_FOUND));

  registerRoutes(app, deps, env);
  return app;
}
