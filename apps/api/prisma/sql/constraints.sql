-- قيود ومحفِّزات لا يعبّر عنها Prisma — بلهجة SQLite (Cloudflare D1)
-- المرجع: الفصل 3
--
-- SQLite لا يقبل إضافة CHECK إلى جدول قائم (`ALTER TABLE ... ADD CONSTRAINT`
-- غير مدعوم)، فالقيود تُكتب داخل `CREATE TABLE` في ملف الترحيل نفسه — انظر
-- سكربت `prisma/apply-constraints.mjs` الذي يحقنها في الترحيل المولَّد.
-- هذا الملف مرجعٌ لنصّها ومصدرها.
--
-- ما تغيّر عن نسخة PostgreSQL وما لم يتغيّر:
--   • `~` (تعبير نمطي) لا وجود له في SQLite ⇒ فحص بنيوي بـ`substr` وصنفٍ
--     منفيّ واحد. والأنماط الطويلة بأصناف متعدّدة يرفضها D1 نفسه.
--   • المحفِّز المؤجَّل إلى نهاية المعاملة لا مقابل له ⇒ نُقل الفحص إلى
--     تحديث `version` في `inventory_levels`، وهي الخطوة التي تختم بها كل
--     عملية مخزون. التفصيل في تعليق المحفِّز أدناه.
--   • الأنواع المعدودة: صارت نصوصاً، وقيمها محروسة بـ CHECK مولَّدة من
--     `prisma/enums.json` — القيمة الخاطئة ترفضها القاعدة كما كانت.

-- ——— صيغة رقم الطلب: TS-YYMM-NNNNNN ———
-- النمط الكامل بأصنافه العشرة يرفضه D1: «LIKE or GLOB pattern too complex».
-- فالفحص بنيوي مكافئ: طولٌ ثابت، وفاصلان في موضعيهما، وصنفٌ واحد منفيّ
-- يقول «لا حرف غير رقمي في هذا المقطع».
-- CHECK (length(order_no) = 14 AND substr(order_no,1,3) = 'TS-'
--        AND substr(order_no,8,1) = '-'
--        AND substr(order_no,4,4) NOT GLOB '*[^0-9]*'
--        AND substr(order_no,9,6) NOT GLOB '*[^0-9]*')

-- ——— المبالغ غير سالبة، والمبلغ النقدي مقرَّب لأقرب 1000 ———
-- CHECK (total_usd_cents >= 0)
-- CHECK (total_syp % 10 = 0)   -- عشرة لا ألف: الليرة الجديدة
-- CHECK (tax_rate_bp BETWEEN 0 AND 10000)
-- CHECK (confirmation_attempts <= 3)
-- CHECK (payment_status <> 'COLLECTED' OR collected_at IS NOT NULL)

-- ——— أرقام الجوال السورية ———
-- CHECK (length(phone_e164) = 13 AND substr(phone_e164,1,5) = '+9639'
--        AND substr(phone_e164,6) NOT GLOB '*[^0-9]*')
-- CHECK (length(landmark) >= 3)

-- ——— فروق السوق على مستوى المتغيّر ———
-- CHECK (price_usd_cents >= 0)
-- CHECK (NOT (dual_sim AND esim_only))
-- CHECK (part_code IS NULL OR (length(part_code) = 4
--        AND substr(part_code,3,2) = '/A'
--        AND substr(part_code,1,2) NOT GLOB '*[^A-Z]*'))
-- CHECK (condition = 'NEW' OR (battery_health_pct BETWEEN 1 AND 100))
-- CHECK (warranty_months >= 0)

-- ——— سعر الصرف: التقادم ليس حالة مسموحة ———
-- CHECK (rate > 0)
-- CHECK (valid_until > effective_from)

-- ——— المخزون: المتاح لا يكون سالباً ———
-- CHECK (on_hand >= 0 AND reserved >= 0)
-- CHECK (reserved <= on_hand)

-- ===========================================================
-- المحفِّز الحاسم: تطابق وحدات الأجهزة مع عدّاد المخزون
--
-- في PostgreSQL كان محفِّزاً مؤجَّلاً إلى نهاية المعاملة، فلا تُزعجه
-- الحالات الوسطى: تُختم عشر وحدات SOLD واحدةً واحدةً ثم يُنقص العدّاد،
-- ولا يقارن أحدٌ بينهما إلا بعد أن يستقرّ الطرفان.
--
-- SQLite لا يعرف التأجيل: كل محفِّز فوري ولكل صف. فمحفِّزٌ على
-- `device_units` كان سيرفض أول وحدة تُختم قبل أن يُنقص العدّاد — أي
-- يرفض العملية الصحيحة نفسها.
--
-- فنُقل الفحص إلى حيث تنتهي كل عملية مخزون فعلاً: تحديث `version` في
-- `inventory_levels`. كل مسار يمسّ المخزون يختم بهذا التحديث، فيقع
-- الفحص مرة واحدة بعد استقرار الطرفين — وهو المعنى نفسه الذي كان
-- التأجيل يحقّقه. وترتيب الكتابة في الشيفرة صار جزءاً من العقد:
-- تُختم الوحدات أولاً، ثم يُضبط العدّاد أخيراً.
--
-- الملحقات لا صفوف لها في device_units، فيُتجاهل الفحص عند غياب أي وحدة.
-- ===========================================================

CREATE TRIGGER IF NOT EXISTS trg_units_match_levels
AFTER UPDATE OF version ON inventory_levels
WHEN (
  SELECT count(*) FROM device_units du
   WHERE du.variant_id = NEW.variant_id
     AND du.warehouse_id = NEW.warehouse_id
     AND du.state = 'IN_STOCK'
) > 0
AND NEW.on_hand <> (
  SELECT count(*) FROM device_units du
   WHERE du.variant_id = NEW.variant_id
     AND du.warehouse_id = NEW.warehouse_id
     AND du.state = 'IN_STOCK'
)
BEGIN
  SELECT RAISE(ABORT, 'انحراف مخزون: عدد الوحدات بحالة IN_STOCK لا يطابق on_hand');
END;

-- ===========================================================
-- حارس المتاح: المحجوز لا يتجاوز الموجود
-- قيد CHECK يحرس الصف عند الإدراج، والمحفِّز يحرس التحديثات التي
-- تُنقص on_hand تحت المحجوز.
-- ===========================================================

CREATE TRIGGER IF NOT EXISTS trg_reserved_le_onhand
AFTER UPDATE ON inventory_levels
WHEN NEW.reserved > NEW.on_hand
BEGIN
  SELECT RAISE(ABORT, 'انحراف مخزون: المحجوز يتجاوز الموجود على الرفّ');
END;
