<div dir="rtl">

# النشر على Cloudflare

## الحالة الحيّة

منشور ويعمل على **talisham.com**: الموقع (62 صفحة) والتطبيق واللوحة
والواجهة البرمجية وقاعدة D1 — كلها من Worker واحد.

| ما فُحص على النطاق الحيّ | النتيجة |
| --- | --- |
| `/api/v1/health` و`/ready` | 200 — والقاعدة تردّ |
| الكتالوج وسعر الصرف والبحث والحزم | 200 |
| `/app/cart` · `/app/checkout` · `/app/account` | 200 (كانت 404) |
| `/search/` · `/compare/` · `/blog/` · `/legal/*` · `/b/*` | 200 (لم تكن موجودة) |
| `/admin/` · `/sitemap.xml` · `/robots.txt` | 200 |
| تهيئة القاعدة | 51 جدولاً · 140 جملة مخطَّط · 118 بذرة · صفر أخطاء |
| مسار الكتابة (سلة ← إضافة ← حذف) | يعمل بالدفعات الذرّية |

### النشر يجري من جهازك لا من GitHub

حُذفت ملفات `.github` كلها: النشر والفحص والنسخ صارت نصوصاً تُشغَّل هنا.
الوسيط كان يضيف دقائق انتظار، ويُخفي الخطأ في سجلٍّ يُفتح من متصفّح،
ويُخضع النشر لفرعٍ افتراضي ولأسرارٍ تُضبط في مكانٍ ثالث.

| كان | صار |
| --- | --- |
| `deploy.yml` عند كل دفعة | `bash scripts/deploy.sh` |
| `ci.yml` + `maintenance.yml` | `bash scripts/check.sh` |
| `backup.yml` يومياً | `bash scripts/backup-cron.sh` في cron جهازك |

### المفتاح وصلاحياته

النشر يقرأ `CLOUDFLARE_API_TOKEN` من بيئتك:

```bash
export CLOUDFLARE_API_TOKEN=...
bash scripts/check.sh && bash scripts/deploy.sh
```

يُنشأ من [لوحة Cloudflare ← API Tokens](https://dash.cloudflare.com/profile/api-tokens):

| الصلاحية | ما تفتحه | بدونها |
| --- | --- | --- |
| **Workers Scripts: Edit** | النشر نفسه | لا نشر إطلاقاً |
| **Workers KV Storage: Edit** | سرّ التوقيع المولَّد، والحدّ، والتخزين المؤقت | الـWorker يعمل بذاكرة العزلة — وهي تُهدَم بلا إشعار |
| **D1: Edit** | الترحيل والنسخ الاحتياطي | لا تغيير في بنية القاعدة، ولا نسخة |
| **R2: Edit** | صور المنتجات | رفع الصور يردّ `MEDIA_BUCKET_MISSING` |

وبعد **R2: Edit**: أزل التعليق عن `r2_buckets` في `wrangler.jsonc`.
وبعد **D1: Edit**: احذف مسار `/api/v1/bootstrap` — الأداة أولى بذلك العمل.

### النسخ الاحتياطي

لا يجري تلقائياً بعد حذف `.github`. جدوِله على جهازك:

```cron
0 4 * * *  cd /مسار/المشروع && CLOUDFLARE_API_TOKEN=... \
           BACKUP_PASSPHRASE=... bash scripts/backup-cron.sh
```

⚠ `BACKUP_PASSPHRASE` تُحفظ خارج الجهاز أيضاً: بدونها لا تُفكّ النسخة
أبداً، والقرص الذي عليه النسخ هو نفسه القرص الذي قد يُعطب.

## البنية: Worker واحد لكل شيء

كانت أربعة تطبيقات في أربعة أماكن، ونتيجتها أن `/app/cart` و`/search` ترجعان
404 على النطاق الحيّ لأن تطبيق السلة Worker منفصل بلا مسار على النطاق، وأن
`api.talisham.com` لا خادم خلفه أصلاً. الآن Worker واحد يخدم الأربعة:

| المسار | ما يُخدَم | المصدر |
| --- | --- | --- |
| `/api/v1/*` | الواجهة البرمجية (Hono + Prisma) | `apps/api/src/worker.ts` |
| `/app/*` | تطبيق السلة والحساب | `apps/app` |
| `/admin/*` | لوحة التحكم | `apps/admin` |
| ما عداه | الموقع الساكن (62 صفحة) | `apps/site` |

وأصلٌ واحد يعني: بلا CORS، وبلا نطاق ثانٍ، وبلا رمز دخول يعبر أصلين.

```bash
bash scripts/check.sh     # الأنواع والوحدة والبناء والطرف-إلى-طرف
bash scripts/deploy.sh    # البناء والترحيل والنشر والتحقّق من الحيّ
```

## قاعدة البيانات: D1

القاعدة **ربطٌ لا رابط اتصال**: لا منفذ مفتوح على الإنترنت، ولا جدار ناري
يُضبط، ولا كلمة سرّ تُدوَّر. الربط في `wrangler.jsonc`:

```jsonc
"d1_databases": [
  { "binding": "DB", "database_name": "talisham",
    "database_id": "…", "migrations_dir": "apps/api/migrations" }
]
```

### الترحيل والبذر

```bash
# محلياً
pnpm run db:migrate:local
pnpm run db:seed

# على الإنتاج — يجري داخل scripts/deploy.sh قبل النشر
bash scripts/db-seal-migrations.sh --remote
npx wrangler d1 migrations apply talisham --remote
```

الترحيل **قبل** النشر لا بعده: نصٌّ جديد يقرأ عموداً لم يُنشأ بعدُ يفشل عند
أول طلب، وترتيب خطوات `scripts/deploy.sh` يمنع تلك النافذة.

والختم قبل الترحيل: القاعدة الحيّة هُيِّئت عبر `/bootstrap` لا بـwrangler،
فجداولها موجودة وسجلّ `d1_migrations` فارغ — ولولا الختم لبدأ الترحيل من
`0001` وسقط بـ«table users already exists»، ومعه كلّ ترحيلٍ بعده.

### تعديل المخطَّط

```bash
# 1) عدّل prisma/schema.prisma
# 2) ولّد الترحيل واحقن فيه القيود والمحفِّزات
cd apps/api && pnpm run migration:new
# 3) سمِّ الناتج برقمه التالي: migrations/0002_<وصف>.sql
#    (wrangler يقرأ ملفات مسطّحة مرقّمة، لا مجلدات Prisma)
```

الحقن خطوة صريحة لأن SQLite لا يقبل إضافة `CHECK` إلى جدول قائم: القيد
يجب أن يولد مع الجدول. والمصدر `prisma/enums.json` وقائمة القيود المكتوبة
في `prisma/apply-constraints.mjs`.

### ما يجب معرفته عن SQLite هنا

| الفرق | ما فُعل | أين |
| --- | --- | --- |
| لا معاملات تفاعلية | كل الكتابات دفعات ذرّية، والحَكَم قيود القاعدة | `src/common/batch.ts` |
| لا محفِّزات مؤجَّلة | الفحص عند تحديث `version` في `inventory_levels`، والترتيب جزء من العقد | `prisma/sql/constraints.sql` |
| لا أنواع معدودة | 62 قيد `CHECK` مولَّد من الأنواع | `prisma/apply-constraints.mjs` |
| `GLOB` الطويل مرفوض | فحص بنيوي بـ`substr` وصنفٍ منفيّ واحد | نفسه |

## الأسرار

| السرّ | لماذا | بدونه |
| --- | --- | --- |
| `JWT_SECRET` | توقيع الجلسات | مفتاح تطوير معروف — لا يُترك في الإنتاج |
| `WHATSAPP_PROVIDER_TOKEN` + `WHATSAPP_PHONE_ID` | رسائل واتساب الفعلية | الرسائل تُكتب في السجل بدل إرسالها |
| `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` | إشعارات المتصفح | زر التفعيل يعمل ولا يصل شيء |

القاعدة والتخزين والمخزن المؤقت **روابط لا أسرار**: `DB` و`MEDIA` و`KV`
معرَّفة في `wrangler.jsonc`، ولا مفتاح يُدار لأيٍّ منها.

```bash
npx wrangler secret put WHATSAPP_PROVIDER_TOKEN
```

## المهام المجدوَلة

لا مؤقّتات داخل Worker، فما كان `setInterval` صار Cron كل دقيقة
(`triggers.crons` في `wrangler.jsonc`):

| المهمة | الدورية | لماذا تهمّ |
| --- | --- | --- |
| كنس الحجوزات المنتهية | كل دقيقة | بلاها تحبس كل سلّة مهجورة بضاعتها فيقول المتجر «نفدت» ورفّه ممتلئ |
| تنبيهات التوفّر والسعر | كل خمس دقائق | رسالة واحدة لكل اشتراك ثم يُغلق |
| تنفيذ طلبات حذف الحساب المستحقّة | يومياً | مهلة الثلاثين يوماً المعلنة في سياسة الخصوصية |

## النطاقات

مضبوطة في `wrangler.jsonc` كنطاقات مخصّصة على الـWorker نفسه:
`talisham.com` و`www.talisham.com` و`api.talisham.com`.

`api.talisham.com` يبقى مقبولاً للتوافق مع أي عميل قديم، والعملاء المبنيّون
الآن ينادون `/api/v1` على الأصل نفسه.

## التطوير محلياً

```bash
# الموقع وحده — يعمل من بذرة الكتالوج بلا قاعدة بيانات
pnpm --filter @talisham/site dev

# كل شيء كما يعمل في الإنتاج
pnpm run build:worker
pnpm run db:migrate:local && pnpm run db:seed
pnpm run worker:dev
```

للـWorker محلياً أنشئ `.dev.vars` (مُستبعَد من Git):

```
JWT_SECRET=dev_only
NODE_ENV=development
RATE_LIMIT_FACTOR=100
```

ولا رابط قاعدة فيه: `wrangler dev --local` يهيّئ D1 محلية من الترحيلات نفسها.

`RATE_LIMIT_FACTOR` يرفع سقف الحدود في التطوير وحده — ويُتجاهَل في الإنتاج
مهما ضُبط، فالقاعدة هناك ليست محلّ تفاوض.

## الفحص من طرف إلى طرف على الـWorker

```bash
API_BASE=http://127.0.0.1:8787/api/v1 pnpm run test:e2e
```

الفحص يهيّئ شرطه بنفسه: يحوّل المنتج التجريبي، ويمنح دور المندوب، ويستعمل
زبوناً جديداً لكل تشغيل — فالنتيجة واحدة مهما تكرّر.

## ما لا يُنشر على Workers

| المكوّن | البديل |
| --- | --- |
| Meilisearch | حُذف — البحث يقرأ الكتالوج مباشرة، وأُثبت في الفحص أنه يعطي النتائج نفسها في كل استعلام |
| الصور على القرص المحلي | حاوية R2 مربوطة، وتُخدَم من `/media/*` على الأصل نفسه |
| Redis | Cloudflare KV |
| خادم Node | لا وجود له: منفَّذ واحد لِما يُختبَر ولِما يُنشَر |

</div>
