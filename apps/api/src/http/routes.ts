import type { Hono } from 'hono';
import type { Deps } from './app.js';
import { type Ctx, protect, maybeAuth, ANY_ROLE, STAFF } from './auth.mw.js';
import { send } from './json.js';
import { Errors } from '../common/errors.js';

/**
 * جدول المسارات — الفصل 4.
 *
 * كان موزّعاً على عشرين وحدة تحكّم، وهو هنا جدول واحد يُقرأ من أعلاه
 * إلى أسفله: المسار، ومن يملكه، وأي خدمة تنفّذه. المسارات نفسها بحرفها
 * حتى لا يشعر عميلٌ منشور بأن شيئاً تحته تبدّل.
 *
 * `ANY` = مسار عام، و`protect(...)` = أدوارٌ محدَّدة، و`maybeAuth` = يعمل
 * للضيف والزبون معاً.
 */
export function registerRoutes(app: Hono<Ctx>, d: Deps, env: Record<string, unknown>) {
  const P = '/api/v1';
  const staff = () => protect(d.prisma, ...STAFF);
  const any = () => protect(d.prisma, ...ANY_ROLE);
  const opsAdmin = () => protect(d.prisma, 'OPS_MANAGER', 'ADMIN');
  const supportOps = () => protect(d.prisma, 'SUPPORT', 'OPS_MANAGER', 'ADMIN');
  const moderators = () => protect(d.prisma, 'SUPPORT', 'CATALOG_ADMIN', 'OPS_MANAGER', 'ADMIN');
  const adminOnly = () => protect(d.prisma, 'ADMIN');
  const guest = () => maybeAuth(d.prisma);

  const sub = (c: any) => c.get('user')?.sub as string | undefined;
  const body = async (c: any) => {
    try { return (await c.req.json()) ?? {}; } catch { return {}; }
  };
  const ok = (c: any, data: unknown) => send(c, { data });

  /* ————————————————— الصحّة ————————————————— */

  app.get(`${P}/health`, (c) => ok(c, { status: 'ok', runtime: env.RUNTIME ?? 'node' }));
  app.get(`${P}/ready`, async (c) => {
    // «جاهز» تعني أن القاعدة تردّ فعلاً، لا أن العملية أقلعت
    await d.prisma.$queryRaw`SELECT 1`;
    return ok(c, { status: 'ready' });
  });

  /* ————————————————— المصادقة ————————————————— */

  app.post(`${P}/auth/otp/request`, async (c) => ok(c, await d.auth.request((await body(c)).phone)));
  app.post(`${P}/auth/otp/verify`, async (c) => {
    const b = await body(c);
    return ok(c, await d.auth.verifyCode(b.phone, b.code, sessionMeta(c)));
  });
  app.post(`${P}/auth/password/login`, async (c) => {
    const b = await body(c);
    return ok(c, await d.auth.loginWithPassword(b.phone, b.password, sessionMeta(c)));
  });
  app.post(`${P}/auth/password/change`, any(), async (c) => {
    const b = await body(c);
    return ok(c, await d.auth.changePassword(sub(c)!, b.currentPassword, b.newPassword));
  });
  app.post(`${P}/auth/refresh`, async (c) => ok(c, await d.auth.refresh((await body(c)).refreshToken)));
  app.get(`${P}/auth/me`, any(), async (c) => ok(c, await d.auth.me(sub(c)!)));
  app.post(`${P}/auth/sessions/revoke-all`, any(), async (c) => ok(c, await d.auth.revokeAll(sub(c)!)));

  /* ————————————————— الكتالوج والبحث وسعر الصرف ————————————————— */

  /* `data` كما كانت، و`meta.nextCursor` يقول إن ثمّة بقيّة — فلا يظنّ
     قارئٌ أن ما وصله هو كل الكتالوج. */
  app.get(`${P}/catalog/products`, async (c) => {
    const r = await d.catalog.list(
      c.req.query('category'), Number(c.req.query('limit') ?? 24), c.req.query('cursor'));
    return send(c, { data: r.rows, meta: { nextCursor: r.nextCursor } });
  });
  app.get(`${P}/catalog/products/:slug`, async (c) => ok(c, await d.catalog.bySlug(c.req.param('slug'))));

  app.get(`${P}/search`, async (c) => {
    const r = await d.search.search(c.req.query('q') ?? '', {
      origin: c.req.query('origin'),
      condition: c.req.query('condition'),
      maxUsd: c.req.query('maxUsd') ? Number(c.req.query('maxUsd')) : undefined,
    });
    return send(c, r);
  });
  app.get(`${P}/search/reindex`, staff(), async (c) => ok(c, await d.search.reindex()));

  app.get(`${P}/fx/current`, async (c) => ok(c, await d.fx.current()));
  app.post(`${P}/fx/preview`, staff(), async (c) => {
    const b = await body(c);
    return ok(c, await d.fx.preview(Number(b.rate)));
  });

  /* ————————————————— السلة ————————————————— */

  app.post(`${P}/carts`, async (c) => ok(c, { cartToken: (await d.cart.create()).token }));
  app.get(`${P}/carts/:token`, async (c) => ok(c, await d.cart.summary(c.req.param('token'))));
  app.post(`${P}/carts/:token/items`, async (c) => {
    const b = await body(c);
    return ok(c, await d.cart.addItem(c.req.param('token'), b.sku, b.qty ?? 1));
  });
  app.post(`${P}/carts/:token/items/:sku`, async (c) => {
    const b = await body(c);
    return ok(c, await d.cart.setItem(c.req.param('token'), c.req.param('sku'), b.qty));
  });
  app.delete(`${P}/carts/:token/items/:sku`, async (c) =>
    ok(c, await d.cart.removeItem(c.req.param('token'), c.req.param('sku'))));
  app.post(`${P}/carts/:token/coupons`, async (c) => {
    const b = await body(c);
    return ok(c, await d.cart.applyCoupon(c.req.param('token'), b.code, b.phone));
  });
  app.delete(`${P}/carts/:token/coupons`, async (c) =>
    ok(c, await d.cart.removeCoupon(c.req.param('token'))));
  app.post(`${P}/carts/:token/validate`, async (c) => ok(c, await d.cart.validate(c.req.param('token'))));

  /* ————————————————— الطلبات ————————————————— */

  app.post(`${P}/orders`, guest(), async (c) => {
    const b = await body(c);
    return ok(c, await d.orders.create(
      b.cartToken, b.address, c.req.header('idempotency-key'), sub(c),
    ));
  });
  app.get(`${P}/orders/mine`, any(), async (c) => ok(c, await d.orders.mine(sub(c)!)));
  /*
    كان مفتوحاً بلا مصادقة ويُعيد اسم المستلم وهاتفه وحيّه ومعلمه، ورقم
    الطلب متسلسل يُخمَّن. الآن يلزم إثباتُ صلة: صاحبُ الحساب يُعرَف برمزه،
    والضيف بآخر أربعة أرقام من هاتفه — وهو الإثبات نفسه الذي يستعمله
    مسار التتبّع أصلاً.
  */
  app.get(`${P}/orders/:orderNo`, guest(), async (c) =>
    ok(c, await d.orders.byNo(c.req.param('orderNo'), sub(c), c.req.query('tail'))));
  app.get(`${P}/orders/:orderNo/track/:tail`, async (c) =>
    ok(c, await d.orders.track(c.req.param('orderNo'), c.req.param('tail'))));

  /* ————————————————— الكوبونات والعروض ————————————————— */

  app.post(`${P}/coupons/preview`, async (c) => {
    const b = await body(c);
    return ok(c, await d.coupons.evaluate(b.code, {
      subtotalUsdCents: b.subtotalUsdCents,
      shippingUsdCents: b.shippingUsdCents ?? 0,
      phone: b.phone,
    }));
  });
  app.get(`${P}/bundles`, async (c) => ok(c, await d.coupons.listBundles()));

  /* ————————————————— المراجعات والأسئلة ————————————————— */

  app.get(`${P}/catalog/products/:slug/reviews`, async (c) =>
    ok(c, await d.reviews.forProduct(c.req.param('slug'))));
  app.get(`${P}/catalog/products/:slug/questions`, async (c) =>
    ok(c, await d.reviews.questions(c.req.param('slug'))));
  app.post(`${P}/catalog/products/:slug/questions`, any(), async (c) => {
    const b = await body(c);
    return ok(c, await d.reviews.ask(sub(c)!, c.req.param('slug'), b.body));
  });
  app.post(`${P}/reviews`, any(), async (c) => ok(c, await d.reviews.create(sub(c)!, await body(c))));
  app.post(`${P}/reviews/:id/report`, any(), async (c) => {
    const b = await body(c);
    return ok(c, await d.reviews.report(c.req.param('id'), sub(c), b.reason, b.note));
  });

  /* ————————————————— الكفالة ————————————————— */

  app.get(`${P}/warranties/verify`, async (c) => ok(c, await d.warranty.verify(c.req.query('imei') ?? '')));
  app.post(`${P}/warranties/activate/:orderNo`, staff(), async (c) =>
    ok(c, await d.warranty.activateForOrder(c.req.param('orderNo'))));
  /*
    الهوية من الرمز لا من معامل استعلام.
    كان `GET /me/warranty-claims?phone=` يقرأ الرقم مما يكتبه الطالب،
    فيُعيد وصف عطل كل زبون واسم جهازه لمن خمّن رقمه — وأرقام سوريا مدى
    محدود يُعدّ عدّاً. و`me` تعني «أنا»، وأنا يعرفها الرمز وحده.
  */
  app.post(`${P}/me/warranty-claims`, any(), async (c) => {
    const b = await body(c);
    return ok(c, await d.warranty.openClaimFor(sub(c)!, b.imei, b.description));
  });
  app.get(`${P}/me/warranty-claims`, any(), async (c) =>
    ok(c, await d.warranty.myClaimsFor(sub(c)!)));

  /* ————————————————— المرتجعات ————————————————— */

  app.post(`${P}/returns`, guest(), async (c) => {
    const b = await body(c);
    return ok(c, await d.returns.request({ ...b, userPublicId: sub(c) }));
  });
  app.get(`${P}/returns/:returnNo`, async (c) => ok(c, await d.returns.byNo(c.req.param('returnNo'))));

  /* ————————————————— الدعم ————————————————— */

  app.post(`${P}/support/tickets`, guest(), async (c) =>
    ok(c, await d.tickets.open({ ...(await body(c)), userPublicId: sub(c) })));
  app.get(`${P}/support/tickets/mine`, any(), async (c) => ok(c, await d.tickets.mine(sub(c)!)));
  app.get(`${P}/support/tickets/:ticketNo`, any(), async (c) =>
    ok(c, await d.tickets.byNo(c.req.param('ticketNo'), sub(c))));
  app.post(`${P}/support/tickets/:ticketNo/reply`, any(), async (c) => {
    const b = await body(c);
    return ok(c, await d.tickets.customerReply(c.req.param('ticketNo'), sub(c)!, b.body));
  });
  app.post(`${P}/support/tickets/:ticketNo/csat`, guest(), async (c) => {
    const b = await body(c);
    return ok(c, await d.tickets.csat(c.req.param('ticketNo'), b.score, b.comment));
  });

  /* ————————————————— التنبيهات وإشعارات المتصفح ————————————————— */

  app.post(`${P}/alerts/stock`, guest(), async (c) =>
    ok(c, await d.alerts.subscribeStock({ ...(await body(c)), userPublicId: sub(c) })));
  /* تنبيه السعر يحتاج حساباً، والردّ يقول ذلك بلغة الزبون بدل رمز
     مصادقة عام: من طلب تنبيهاً يُدعى للتسجيل لا يُطرَد. */
  app.post(`${P}/alerts/price`, guest(), async (c) => {
    if (!sub(c)) {
      throw Errors.badRequest('AUTH_REQUIRED',
        'تنبيه السعر يحتاج حساباً — سجّل دخولك برمز', 'Sign in required');
    }
    return ok(c, await d.alerts.subscribePrice(sub(c)!, await body(c)));
  });

  app.get(`${P}/push/key`, (c) => ok(c, d.push.publicKey()));
  app.post(`${P}/push/subscribe`, guest(), async (c) =>
    ok(c, await d.push.subscribe({ ...(await body(c)), userPublicId: sub(c) })));
  app.post(`${P}/push/unsubscribe`, async (c) =>
    ok(c, await d.push.unsubscribe((await body(c)).endpoint)));

  /* ————————————————— الحساب (جديد) ————————————————— */

  app.get(`${P}/me/addresses`, any(), async (c) => ok(c, await d.account.addresses(sub(c)!)));
  app.post(`${P}/me/addresses`, any(), async (c) =>
    ok(c, await d.account.addAddress(sub(c)!, await body(c))));
  app.post(`${P}/me/addresses/:id/default`, any(), async (c) =>
    ok(c, await d.account.setDefaultAddress(sub(c)!, c.req.param('id'))));
  app.delete(`${P}/me/addresses/:id`, any(), async (c) =>
    ok(c, await d.account.removeAddress(sub(c)!, c.req.param('id'))));

  app.get(`${P}/me/sessions`, any(), async (c) =>
    ok(c, await d.account.sessions(sub(c)!, c.get('user')?.sid)));
  app.delete(`${P}/me/sessions/:id`, any(), async (c) =>
    ok(c, await d.account.revokeSession(sub(c)!, c.req.param('id'))));

  app.get(`${P}/me/wishlist`, any(), async (c) => ok(c, await d.account.wishlist(sub(c)!)));
  app.post(`${P}/me/wishlist`, any(), async (c) =>
    ok(c, await d.account.addWish(sub(c)!, (await body(c)).sku)));
  app.delete(`${P}/me/wishlist/:sku`, any(), async (c) =>
    ok(c, await d.account.removeWish(sub(c)!, c.req.param('sku'))));

  app.get(`${P}/me/notification-prefs`, any(), async (c) => ok(c, await d.account.prefs(sub(c)!)));
  app.post(`${P}/me/notification-prefs`, any(), async (c) =>
    ok(c, await d.account.setPrefs(sub(c)!, await body(c))));

  app.get(`${P}/me/deletion`, any(), async (c) => ok(c, await d.account.deletionStatus(sub(c)!)));
  app.post(`${P}/me/deletion`, any(), async (c) =>
    ok(c, await d.account.requestDeletion(sub(c)!, (await body(c)).reason)));
  app.delete(`${P}/me/deletion`, any(), async (c) => ok(c, await d.account.cancelDeletion(sub(c)!)));

  /* ————————————————— لوحة الإدارة ————————————————— */

  app.get(`${P}/admin/orders`, opsAdmin(), async (c) => send(c, await d.admin.list(c.req.query('status'))));
  app.post(`${P}/admin/orders/:orderNo/confirm`, opsAdmin(), async (c) =>
    send(c, await d.admin.confirm(c.req.param('orderNo'), await body(c))));
  app.post(`${P}/admin/fx`, adminOnly(), async (c) => send(c, await d.admin.setFx(await body(c))));
  app.get(`${P}/admin/catalog/products`, opsAdmin(), async (c) =>
    send(c, await d.admin.products(c.req.query('demo'))));
  app.post(`${P}/admin/catalog/products/:slug/promote`, opsAdmin(), async (c) =>
    send(c, await d.admin.promote(c.req.param('slug'))));
  app.post(`${P}/admin/inventory/sweep`, opsAdmin(), async (c) => ok(c, await d.sweeper.sweep()));
  app.get(`${P}/admin/settings`, opsAdmin(), async (c) => send(c, await d.admin.settings()));
  app.post(`${P}/admin/settings`, adminOnly(), async (c) =>
    send(c, await d.admin.setSetting(await body(c), { user: { sub: sub(c)! } })));
  app.get(`${P}/admin/dashboard`, opsAdmin(), async (c) => send(c, await d.admin.dashboard()));

  /* الكتالوج الإداري */
  app.get(`${P}/admin/catalog/brands`, staff(), async (c) => ok(c, await d.products.brands()));
  app.get(`${P}/admin/catalog/categories`, staff(), async (c) => ok(c, await d.products.categories()));
  app.get(`${P}/admin/catalog/product/:slug`, staff(), async (c) =>
    ok(c, await d.products.one(c.req.param('slug'))));
  app.post(`${P}/admin/catalog/product`, staff(), async (c) =>
    ok(c, await d.products.upsert(await body(c), sub(c)!)));
  app.post(`${P}/admin/catalog/product/:slug/status`, staff(), async (c) => {
    const b = await body(c);
    return ok(c, await d.products.setStatus(c.req.param('slug'), b.status, sub(c)!));
  });
  app.delete(`${P}/admin/catalog/product/:slug`, staff(), async (c) =>
    ok(c, await d.products.softDelete(c.req.param('slug'), sub(c)!)));
  app.post(`${P}/admin/catalog/variant/:sku/price`, staff(), async (c) => {
    const b = await body(c);
    return ok(c, await d.products.setPrice(c.req.param('sku'), b.priceUsdCents, sub(c)!));
  });
  app.post(`${P}/admin/catalog/product/:slug/media`, staff(), async (c) =>
    ok(c, await d.products.addMedia(c.req.param('slug'), await body(c))));
  app.delete(`${P}/admin/catalog/media/:id`, staff(), async (c) =>
    ok(c, await d.products.removeMedia(c.req.param('id'))));
  app.post(`${P}/admin/catalog/product/:slug/media/order`, staff(), async (c) =>
    ok(c, await d.products.reorderMedia(c.req.param('slug'), (await body(c)).ids)));

  /* الكوبونات والعروض */
  app.get(`${P}/admin/coupons`, opsAdmin(), async (c) => ok(c, await d.coupons.list()));
  app.post(`${P}/admin/coupons`, adminOnly(), async (c) => ok(c, await d.coupons.upsert(await body(c))));
  app.post(`${P}/admin/coupons/:code/toggle`, adminOnly(), async (c) =>
    ok(c, await d.coupons.toggle(c.req.param('code'), (await body(c)).isActive)));
  app.get(`${P}/admin/bundles`, opsAdmin(), async (c) => ok(c, await d.coupons.listBundles()));
  app.post(`${P}/admin/bundles`, adminOnly(), async (c) =>
    ok(c, await d.coupons.upsertBundle(await body(c))));
  app.post(`${P}/admin/bundles/:code/toggle`, adminOnly(), async (c) =>
    ok(c, await d.coupons.toggleBundle(c.req.param('code'), (await body(c)).isActive)));
  app.get(`${P}/admin/quantity-breaks`, opsAdmin(), async (c) => ok(c, await d.coupons.listBreaks()));
  app.post(`${P}/admin/quantity-breaks`, adminOnly(), async (c) =>
    ok(c, await d.coupons.upsertBreak(await body(c))));
  app.delete(`${P}/admin/quantity-breaks/:id`, adminOnly(), async (c) =>
    ok(c, await d.coupons.deleteBreak(c.req.param('id'))));

  /* التسويات */
  app.get(`${P}/admin/settlements`, opsAdmin(), async (c) =>
    ok(c, await d.settlements.list(c.req.query('state'), c.req.query('date'))));
  app.get(`${P}/admin/settlements/report`, opsAdmin(), async (c) =>
    ok(c, await d.settlements.report(Number(c.req.query('days') ?? 7))));
  app.get(`${P}/admin/settlements/:id`, opsAdmin(), async (c) =>
    ok(c, await d.settlements.one(c.req.param('id'))));
  app.post(`${P}/admin/settlements/:id/reconcile`, opsAdmin(), async (c) =>
    ok(c, await d.settlements.reconcile(c.req.param('id'), sub(c)!)));
  app.post(`${P}/admin/settlements/:id/settle`, adminOnly(), async (c) =>
    ok(c, await d.settlements.settle(c.req.param('id'), sub(c)!)));

  /* المرتجعات */
  app.get(`${P}/admin/returns`, supportOps(), async (c) => ok(c, await d.returns.list(c.req.query('state'))));
  app.post(`${P}/admin/returns/:returnNo/transition`, supportOps(), async (c) => {
    const b = await body(c);
    return ok(c, await d.returns.transition(c.req.param('returnNo'), b.to, sub(c)!, b));
  });
  app.post(`${P}/admin/returns/:returnNo/disburse`, adminOnly(), async (c) =>
    ok(c, await d.returns.disburse(c.req.param('returnNo'), sub(c)!, (await body(c)).note)));

  /* التذاكر */
  app.get(`${P}/admin/tickets`, supportOps(), async (c) => ok(c, await d.tickets.list(c.req.query('status'))));
  app.get(`${P}/admin/tickets/metrics`, supportOps(), async (c) =>
    ok(c, await d.tickets.metrics(Number(c.req.query('days') ?? 30))));
  app.get(`${P}/admin/tickets/macros`, supportOps(), async (c) => ok(c, await d.tickets.macros()));
  app.post(`${P}/admin/tickets/:ticketNo/reply`, supportOps(), async (c) =>
    ok(c, await d.tickets.reply(c.req.param('ticketNo'), sub(c)!, await body(c))));
  app.post(`${P}/admin/tickets/:ticketNo/transition`, supportOps(), async (c) =>
    ok(c, await d.tickets.transition(c.req.param('ticketNo'), (await body(c)).to, sub(c)!)));

  /* الإشراف */
  app.get(`${P}/admin/moderation/reviews`, moderators(), async (c) =>
    ok(c, await d.reviews.queue(c.req.query('status') ?? 'PENDING')));
  app.post(`${P}/admin/moderation/reviews/:id`, moderators(), async (c) => {
    const b = await body(c);
    return ok(c, await d.reviews.moderate(c.req.param('id'), b.to, sub(c)!, b.rejectReason));
  });
  app.post(`${P}/admin/moderation/reviews/:id/reply`, moderators(), async (c) =>
    ok(c, await d.reviews.reply(c.req.param('id'), (await body(c)).body)));
  app.get(`${P}/admin/moderation/questions`, moderators(), async (c) =>
    ok(c, await d.reviews.questionQueue()));
  app.post(`${P}/admin/moderation/questions/:id/answer`, moderators(), async (c) => {
    const b = await body(c);
    return ok(c, await d.reviews.answer(c.req.param('id'), sub(c)!, b.body, b.publish ?? true));
  });

  /* الكفالة الإدارية */
  app.get(`${P}/admin/warranty-claims`, supportOps(), async (c) =>
    ok(c, await d.warranty.listClaims(c.req.query('state'))));
  app.post(`${P}/admin/warranty-claims/:claimNo/transition`, supportOps(), async (c) => {
    const b = await body(c);
    return ok(c, await d.warranty.transition(c.req.param('claimNo'), b.to, b));
  });

  /* التوصيل */
  app.get(`${P}/admin/delivery/couriers`, staff(), async (c) =>
    ok(c, await d.delivery.couriers(c.req.query('status'))));
  app.post(`${P}/admin/delivery/couriers`, staff(), async (c) =>
    ok(c, await d.delivery.upsertCourier(await body(c), sub(c)!)));
  app.post(`${P}/admin/delivery/couriers/:code/status`, staff(), async (c) => {
    const b = await body(c);
    return ok(c, await d.delivery.setCourierStatus(c.req.param('code'), b.status, b.reason, sub(c)!));
  });
  app.get(`${P}/admin/delivery/zones`, staff(), async (c) =>
    ok(c, await d.delivery.zones(c.req.query('governorate'))));
  app.post(`${P}/admin/delivery/zones`, staff(), async (c) =>
    ok(c, await d.delivery.upsertZone(await body(c), sub(c)!)));
  app.post(`${P}/admin/delivery/zones/:code/couriers`, staff(), async (c) => {
    const b = await body(c);
    return ok(c, await d.delivery.assignCourierToZone(c.req.param('code'), b.courierCode, b.priority ?? 5));
  });
  app.delete(`${P}/admin/delivery/zones/:code/couriers/:courierCode`, staff(), async (c) =>
    ok(c, await d.delivery.unassign(c.req.param('code'), c.req.param('courierCode'))));
  app.get(`${P}/admin/delivery/orders/:orderNo/suggest`, staff(), async (c) =>
    ok(c, await d.delivery.suggestCourier(c.req.param('orderNo'))));

  /* المشتريات والموردون */
  app.get(`${P}/admin/procurement/suppliers`, opsAdmin(), async (c) =>
    ok(c, await d.procurement.listSuppliers()));
  app.post(`${P}/admin/procurement/suppliers`, opsAdmin(), async (c) =>
    ok(c, await d.procurement.createSupplier(await body(c))));
  app.patch(`${P}/admin/procurement/suppliers/:code`, opsAdmin(), async (c) =>
    ok(c, await d.procurement.setSupplierActive(c.req.param('code'), (await body(c)).isActive)));
  app.get(`${P}/admin/procurement/suppliers/:code/scorecard`, opsAdmin(), async (c) =>
    ok(c, await d.procurement.supplierScorecard(c.req.param('code'))));
  app.get(`${P}/admin/procurement/purchase-orders`, opsAdmin(), async (c) =>
    ok(c, await d.procurement.listPos(c.req.query('state'))));
  app.post(`${P}/admin/procurement/purchase-orders`, opsAdmin(), async (c) => {
    const b = await body(c);
    return ok(c, await d.procurement.createPo(
      b.supplierCode, b.lines, b.extraUsdCents ?? 0, b.expectedAt, b.note,
    ));
  });
  app.post(`${P}/admin/procurement/purchase-orders/:poNo/receive`, opsAdmin(), async (c) =>
    ok(c, await d.procurement.receive(c.req.param('poNo'), (await body(c)).receipts)));
  app.post(`${P}/admin/procurement/purchase-orders/:poNo/cancel`, opsAdmin(), async (c) =>
    ok(c, await d.procurement.cancelPo(c.req.param('poNo'), (await body(c)).reason)));
  app.get(`${P}/admin/procurement/profitability`, opsAdmin(), async (c) =>
    ok(c, await d.procurement.profitability()));
  app.get(`${P}/admin/procurement/alerts`, opsAdmin(), async (c) => ok(c, await d.procurement.alerts()));

  /* التقارير */
  app.get(`${P}/admin/reports/pnl`, adminOnly(), async (c) => ok(c, await d.reports.pnl(c.req.query('month'))));
  app.get(`${P}/admin/reports/dead-stock`, opsAdmin(), async (c) =>
    ok(c, await d.reports.deadStock(Number(c.req.query('days') ?? 90))));
  app.get(`${P}/admin/reports/inventory-aging`, opsAdmin(), async (c) =>
    ok(c, await d.reports.inventoryAging()));
  app.get(`${P}/admin/couriers/:code/scorecard`, opsAdmin(), async (c) =>
    ok(c, await d.reports.courierScorecard(c.req.param('code'), Number(c.req.query('days') ?? 30))));
  app.get(`${P}/admin/commissions/run`, adminOnly(), async (c) =>
    ok(c, await d.reports.commissions(c.req.query('month'))));

  /* المستخدمون والأدوار */
  app.get(`${P}/admin/users`, adminOnly(), async (c) =>
    ok(c, await d.users.list(
      { role: c.req.query('role'), q: c.req.query('q'), staffOnly: c.req.query('staff') === '1' },
      c.get('user')!.role,
    )));
  app.get(`${P}/admin/users/sessions`, adminOnly(), async (c) => ok(c, await d.users.staffSessions()));
  app.post(`${P}/admin/users/:publicId/role`, adminOnly(), async (c) => {
    const b = await body(c);
    return ok(c, await d.users.setRole(c.req.param('publicId'), b.role, sub(c)!, b.reason));
  });
  app.post(`${P}/admin/users/:publicId/unlock`, adminOnly(), async (c) =>
    ok(c, await d.users.unlock(c.req.param('publicId'), sub(c)!)));
  app.post(`${P}/admin/users/:publicId/revoke-sessions`, adminOnly(), async (c) =>
    ok(c, await d.users.revokeAllSessions(c.req.param('publicId'), sub(c)!)));
  app.get(`${P}/admin/audit`, adminOnly(), async (c) =>
    ok(c, await d.users.auditTrail({
      entityType: c.req.query('entityType'),
      action: c.req.query('action'),
      limit: Number(c.req.query('limit') ?? 100),
    })));

  /* الجاهزية والمهام الدورية */
  app.get(`${P}/admin/readiness/checks`, opsAdmin(), async (c) =>
    ok(c, await d.readiness.list(c.req.query('category'))));
  app.patch(`${P}/admin/readiness/checks/:code`, opsAdmin(), async (c) =>
    ok(c, await d.readiness.update(c.req.param('code'), await body(c), sub(c))));
  app.get(`${P}/admin/readiness/summary`, opsAdmin(), async (c) => ok(c, await d.readiness.summary()));
  app.post(`${P}/admin/readiness/seed`, adminOnly(), async (c) => ok(c, await d.readiness.seed()));
  app.get(`${P}/admin/ops/routines`, opsAdmin(), async (c) =>
    ok(c, await d.readiness.routines(c.req.query('cadence'), c.req.query('period_key'))));
  app.post(`${P}/admin/ops/routines/:code/runs`, opsAdmin(), async (c) =>
    ok(c, await d.readiness.completeRoutine(c.req.param('code'), await body(c), sub(c))));

  /* ————————————————— واجهة المندوب ————————————————— */

  const courierRoles = () => protect(d.prisma, 'COURIER', 'OPS_MANAGER', 'ADMIN');
  app.get(`${P}/courier/tasks`, courierRoles(), async (c) => send(c, await d.courier.tasks(sub(c))));
  /* المطالبة بطلبٍ في منطقته: بها وحدها تنكشف بيانات الزبون له */
  app.post(`${P}/courier/orders/:orderNo/claim`, courierRoles(), async (c) =>
    send(c, await d.courier.claim(c.req.param('orderNo'), sub(c))));
  app.post(`${P}/courier/orders/:orderNo/status`, courierRoles(), async (c) =>
    send(c, await d.courier.status(c.req.param('orderNo'), await body(c), sub(c))));
  app.post(`${P}/courier/orders/:orderNo/collect`, courierRoles(), async (c) =>
    send(c, await d.courier.collect(
      c.req.param('orderNo'), await body(c), { user: { sub: sub(c)! } },
      c.req.header('idempotency-key'),
    )));
}

/** بصمة الجهاز للجلسة: تكفي لتمييز «هاتفي» عن «حاسوب المحل» في القائمة */
function sessionMeta(c: any) {
  return {
    userAgent: (c.req.header('user-agent') ?? '').slice(0, 200),
    ip: c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
  };
}
