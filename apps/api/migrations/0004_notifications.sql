-- ═══════════════════════════════════════════════════════════════
-- صندوق الإشعارات داخل التطبيق
--
-- كان `IN_APP` مذكوراً في قنوات كل مستوى إشعار ولا يُسلَّم إلى أي مكان:
-- الموجّه يعالج واتساب وSMS فقط، فتُحصى القناة في «المخطَّط» ولا تصل.
--
-- وواتساب التجاري ممنوعٌ على سوريا، ولا مزوّد SMS مضبوطاً — والقناتان
-- تُرجعان `ok: true` وهما محاكاة تكتب في السجل. فكل إشعارات المتجر —
-- «طلبك تأكّد»، «المندوب في الطريق»، «رمز الدخول» — تخرج إلى سطرٍ في
-- سجلّ الـWorker ويُقال إنها وصلت. وهذا أسوأ من خطأ صريح: العطل صامت.
--
-- وهذا الجدول يجعل القناة الوحيدة التي لا تحتاج مزوّداً قناةً حقيقية:
-- الرسالة تُحفظ، والزبون يفتح التطبيق فيجدها في صندوقه.
--
-- وفيه فائدة ثانية: منع التكرار كان `Map` في ذاكرة العزلة، وعزلات
-- الـWorker كثيرة تُنشأ وتُهدَم بلا إشعار — فواحدةٌ لا تعرف ما أرسلته
-- أختها، والزبون يتلقّى الرسالة نفسها مرات. فصار السؤال على صفوفٍ في
-- القاعدة: هل خرج هذا النوع لهذا الرقم عن هذا الكيان في آخر يوم؟
--
-- الفهارس ثلاثة لأن الاستعلامات ثلاثة: صندوق الزائر برقمه، صندوق
-- الداخل بحسابه، وسؤال التكرار.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "notifications" (
    "id"          TEXT NOT NULL PRIMARY KEY,
    "user_id"     TEXT,
    "phone"       TEXT NOT NULL,
    "type"        TEXT NOT NULL,
    "level"       TEXT NOT NULL DEFAULT 'P2',
    "title"       TEXT NOT NULL,
    "body"        TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id"   TEXT,
    "href"        TEXT,
    "read_at"     DATETIME,
    "created_at"  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id")
        REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "notifications_phone_created_at_idx"    ON "notifications"("phone", "created_at");
CREATE INDEX "notifications_user_id_created_at_idx"  ON "notifications"("user_id", "created_at");
CREATE INDEX "notifications_phone_type_entity_idx"   ON "notifications"("phone", "type", "entity_id");
