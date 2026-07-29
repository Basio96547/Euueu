/** أنواع مشتركة بين الواجهة والخلفية — المرجع: الفصلان 3 و4 */

/* ————— المال ————— */
/** المبالغ تُخزَّن وتُنقل أعداداً صحيحة بسنتات الدولار. الليرة طبقة عرض. */
export type UsdCents = number;
/** الليرة السورية بلا كسور، ومقرَّبة لأقرب 1000 حين تكون مبلغاً نقدياً مستحقاً. */
export type Syp = number;

export interface FxRate {
  rate: number;            // ليرة لكل دولار
  effectiveFrom: string;   // ISO
  validUntil: string;      // ISO — التقادم ليس حالة مسموحة (الفصل 3)
  safetyMarginBp: number;  // نقاط أساس تُطبَّق في فترة السماح
}

export type FxHealth = 'FRESH' | 'EXPIRING' | 'STALE_MARGIN' | 'STALE_HALT';

/* ————— الكتالوج ————— */
export type DeviceOrigin = 'GULF' | 'EURO' | 'US' | 'ASIA' | 'OTHER';
export type ProductCondition = 'NEW' | 'OPEN_BOX' | 'REFURBISHED' | 'USED_A' | 'USED_B';
export type WarrantyType = 'STORE' | 'AGENT' | 'IMPORTER' | 'NONE';
export type NetworkGen = '2G' | '3G' | '4G' | '5G';

export interface Variant {
  id: string;
  publicId: string;
  sku: string;
  colorCode: string | null;
  colorName: Localized | null;
  storageGb: number | null;
  ramGb: number | null;
  networkGen: NetworkGen | null;
  dualSim: boolean;
  esimOnly: boolean;
  partCode: string | null;          // ZA/A · LL/A · AA/A
  condition: ProductCondition;
  batteryHealthPct: number | null;  // إلزامي لغير الجديد
  deviceOrigin: DeviceOrigin;
  warrantyType: WarrantyType;
  warrantyMonths: number;
  priceUsdCents: UsdCents;
  compareAtPriceUsdCents: UsdCents | null;
  available: number;                // on_hand - reserved
}

export interface Localized { ar: string; en?: string }

export interface Product {
  id: string;
  publicId: string;
  slug: string;
  name: Localized;
  shortDesc: Localized | null;
  brand: { slug: string; name: Localized };
  categorySlug: string;
  spec: Record<string, string | number | null>;
  variants: Variant[];
  isDemo: boolean;
}

/* ————— الطلب ————— */
export type OrderStatus =
  | 'PENDING_CONFIRMATION' | 'PROCESSING' | 'SHIPPED'
  | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'DELIVERY_FAILED'
  | 'RETURNED_TO_ORIGIN' | 'RETURN_REQUESTED' | 'RETURNED' | 'CANCELLED';

export type PaymentMethod = 'COD';
export type PaymentStatus = 'PENDING' | 'COLLECTED' | 'PARTIAL' | 'REFUNDED';
export type ShippingMethod = 'COURIER_INTRACITY' | 'INTERCITY_OFFICE' | 'POST';

export type Governorate =
  | 'DAMASCUS' | 'RIF_DIMASHQ' | 'ALEPPO' | 'HOMS' | 'HAMA' | 'LATAKIA' | 'TARTUS'
  | 'IDLIB' | 'DEIR_EZZOR' | 'HASAKAH' | 'RAQQA' | 'DARAA' | 'SUWAYDA' | 'QUNEITRA';

export interface Address {
  recipientName: string;
  governorate: Governorate;
  city: string;
  neighborhood: string;
  street?: string;
  landmark: string;      // إلزامي — المندوب يصل به لا بالشارع
  details?: string;
  phone: string;         // +9639XXXXXXXX
  altPhone?: string;
  geoLat?: number;
  geoLng?: number;
}

/* ————— الإشعارات (الفصل 20) ————— */
export type NotificationLevel = 'P0' | 'P1' | 'P2' | 'P3';
export type NotificationChannel = 'IN_APP' | 'WHATSAPP' | 'SMS' | 'WEB_PUSH' | 'EMAIL';

export interface NotificationEvent {
  type: string;
  level: NotificationLevel;
  channels: NotificationChannel[];
  dedupeKey: string;
  mutable: boolean;   // هل يستطيع المستخدم إيقافه — التشغيلي لا يُطفأ
}

/* ————— صيغة الاستجابة الموحّدة (الفصل 4) ————— */
export interface ApiOk<T> { data: T; meta?: Record<string, unknown> }
export interface ApiErr {
  error: { code: string; message: { ar: string; en: string }; details?: unknown };
}
