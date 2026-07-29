import { HttpException, HttpStatus } from '@nestjs/common';

type Msg = { ar: string; en: string };

/** صيغة الخطأ الموحّدة (الفصل 4 §4.4) */
export class ApiError extends HttpException {
  constructor(status: HttpStatus, code: string, message: Msg, details?: unknown) {
    super({ error: { code, message, details } }, status);
  }
}

export const Errors = {
  notFound: (what: string) =>
    new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', { ar: `${what} غير موجود`, en: `${what} not found` }),
  demoNotOrderable: () =>
    new ApiError(HttpStatus.CONFLICT, 'DEMO_PRODUCT_NOT_ORDERABLE', {
      ar: 'هذا منتج تجريبي ولا يقبل الطلب', en: 'Demo product is not orderable',
    }),
  outOfStock: (variantId: string, available: number) =>
    new ApiError(HttpStatus.CONFLICT, 'OUT_OF_STOCK', {
      ar: 'الكمية المطلوبة غير متوفرة', en: 'Requested quantity unavailable',
    }, { variantId, available }),
  priceChanged: (d: unknown) =>
    new ApiError(HttpStatus.CONFLICT, 'PRICE_CHANGED', {
      ar: 'تغيّر السعر — يلزم تأكيدك', en: 'Price changed — consent required',
    }, d),
  fxStaleHalt: () =>
    new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'FX_STALE_HALT', {
      ar: 'تحديث الأسعار جارٍ — الطلبات متوقفة مؤقتاً', en: 'Pricing update in progress — orders paused',
    }),
  codLimit: (maxUsdCents: number) =>
    new ApiError(HttpStatus.CONFLICT, 'COD_LIMIT_EXCEEDED', {
      ar: 'قيمة الطلب تتجاوز سقف الدفع عند الاستلام', en: 'Order exceeds cash-on-delivery limit',
    }, { maxUsdCents }),
  invalidTransition: (from: string, to: string) =>
    new ApiError(HttpStatus.CONFLICT, 'INVALID_TRANSITION', {
      ar: `انتقال غير مسموح من ${from} إلى ${to}`, en: `Invalid transition ${from} → ${to}`,
    }),
  stockDrift: (detail: string) =>
    new ApiError(HttpStatus.CONFLICT, 'STOCK_INVARIANT_VIOLATION', {
      ar: 'انحراف في المخزون — رُفضت العملية كاملة', en: 'Stock invariant violated — operation rejected',
    }, { detail }),
  badRequest: (code: string, ar: string, en: string) =>
    new ApiError(HttpStatus.BAD_REQUEST, code, { ar, en }),
};
