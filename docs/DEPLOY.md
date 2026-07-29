<div dir="rtl">

# النشر على Cloudflare

## معاينة فورية بلا تسجيل دخول

للنظر إلى الواجهة من الجوال دون ربط حساب:

```bash
pnpm --filter @talisham/site run build
cd apps/site && npx wrangler deploy --temporary
```

يُنشر على **حساب معاينة مؤقت من Cloudflare لا على حسابك** — فلا يظهر في لوحتك،
ولا يقبل نطاقاً خاصاً، ويزول بعد مدة. للمعاينة فقط، لا للإنتاج.

**والنطاق الفرعي يتغيّر مع كل حساب معاينة جديد** — لا تعتمد على رابط
حفظته أمس، بل أعد النشر واقرأ الرابط من مخرجات الأمر.

### المعاينة المنشورة حالياً

| الواجهة | الرابط | تعمل؟ |
| --- | --- | --- |
| المتجر (Astro) | https://talisham.young-quarter.workers.dev | نعم كاملاً — صفحاته ساكنة لا تحتاج خادماً |
| تطبيق الزبون | https://talisham-app.young-quarter.workers.dev | الشكل فقط — السلة تحتاج الواجهة البرمجية |
| لوحة الإدارة | https://talisham-admin.young-quarter.workers.dev | الشكل فقط — الدخول يحتاج الواجهة البرمجية |

التطبيقان يناديان `/api/v1` وليس خلفهما خادم بعد، فيظهران رسالة خطأ عند أول طلب.
هذا متوقَّع: راجع «ما لا يُنشر على Workers» أدناه.

## النشر على حسابك

## مرة واحدة

```bash
npx wrangler login          # يفتح المتصفح ويربط حسابك
```

ثم من جذر المستودع:

```bash
pnpm --filter @talisham/site run build
cd apps/site && npx wrangler deploy
```

يصدر رابط فوري بالشكل `https://talisham.<اسم-حسابك>.workers.dev`.

## النطاق الخاص

بعد إضافة `talisham.com` إلى حسابك في Cloudflare، أزل التعليق عن سطر `routes` في `apps/site/wrangler.jsonc`، ثم أعد النشر. والأمر نفسه لـ `admin.talisham.com` في `apps/admin/wrangler.jsonc`.

## النشر الآلي

ملف `.github/workflows/deploy.yml` ينشر التطبيقات الثلاثة عند كل دفع إلى `main`. يحتاج سرَّين في إعدادات المستودع على GitHub:

| السر | من أين |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | لوحة Cloudflare ← My Profile ← API Tokens ← Edit Cloudflare Workers |
| `CLOUDFLARE_ACCOUNT_ID` | يظهر في عنوان لوحة التحكم أو بالأمر `npx wrangler whoami` |

وفيه بوابة أداء تفشل البناء إن تجاوز JavaScript ستين كيلوبايت مضغوطاً — الميزانية تُفرض قبل النشر لا تُراجَع بعده.

## ما لا يُنشر على Workers

الواجهة البرمجية (`apps/api`) تعمل على NestJS وتحتاج PostgreSQL، فتُنشر في حاوية Docker على خادم أو خدمة حاويات، لا على Workers. راجع [الفصل 11](11-devops.md) لخيارات الاستضافة وخطة البديل.

## استضافة الواجهة البرمجية مجاناً — خادم Oracle Cloud Always Free

الخيار المجاني الوحيد الذي يشغّل `docker-compose.prod.yml` كما هو دون تعديل: خادم Oracle Cloud ضمن **Always Free** — وهو مجاني دائماً لا تجربة تنتهي، ويعطي حتى 4 أنوية Ampere A1 و24 جيجابايت ذاكرة، وهذا يكفي بسهولة لتشغيل Postgres وRedis وMeilisearch والواجهة البرمجية معاً على خادم واحد.

### 1. إنشاء الحساب والخادم

1. أنشئ حساباً على [cloud.oracle.com](https://cloud.oracle.com) (يطلب بطاقة للتحقق فقط، بلا فوترة على مستوى Always Free).
2. من القائمة: **Compute ← Instances ← Create Instance**.
3. الصورة: **Ubuntu 22.04**. الشكل (Shape): **VM.Standard.A1.Flex** ضمن Always Free، واضبط 4 OCPU و24GB RAM (الحد الأقصى المجاني).
4. عند إنشاء المفتاح، احفظ مفتاح SSH الخاص محلياً — هو الوسيلة الوحيدة للدخول.
5. بعد الإطلاق، من **Virtual Cloud Network ← Security Lists** (أو NSG) افتح المنافذ الواردة: `22` (SSH، مقصور على عنوانك إن أمكن)، `80` و`443` (الوصول العام للـAPI).

### 2. تجهيز الخادم

```bash
ssh -i مفتاحك.key ubuntu@<العنوان-العام>
sudo apt update && sudo apt install -y docker.io docker-compose-plugin git
sudo usermod -aG docker $USER && newgrp docker
```

### 3. سحب المستودع وضبط الأسرار

```bash
git clone https://github.com/basio96547/euueu.git talisham
cd talisham
cp .env.example .env
```

عدّل `.env` بقيم إنتاج حقيقية — لا تُبقِ أي قيمة تجريبية:

```bash
openssl rand -hex 32   # JWT_SECRET
openssl rand -hex 24   # POSTGRES_PASSWORD
npx web-push generate-vapid-keys  # أو أي مولّد ES256 آخر لـVAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY
```

واضبط `NODE_ENV=production` و`DEMO_MODE=false` و`PUBLIC_API_URL=https://api.talisham.com/api/v1`.

### 4. الإقلاع

```bash
docker compose -f infra/docker/docker-compose.prod.yml up -d --build
curl http://localhost:4000/api/v1/health   # يجب أن يعيد OK
```

### 5. الربط بالنطاق عبر Cloudflare (بلا شهادة تُدار يدوياً)

1. في لوحة Cloudflare DNS: أضف سجل `A` باسم `api` يشير إلى العنوان العام للخادم، **والسحابة البرتقالية مفعَّلة (Proxied)** — بهذا يمر كل الترافيك عبر Cloudflare ولا يظهر عنوان الخادم الحقيقي.
2. من **SSL/TLS ← Overview** اختر وضع **Full (strict)**.
3. من **SSL/TLS ← Origin Server** أنشئ **Origin Certificate** (صالحة 15 سنة)، وثبّتها على الخادم خلف Nginx أو Caddy بسيط يُعيد التوجيه إلى المنفذ 4000 محلياً — هذا يوفّر تجديد Let's Encrypt الدوري كاملاً.
4. تحقق: `curl https://api.talisham.com/api/v1/health`.

بهذا تكتمل الاستضافة المجانية: الواجهات الساكنة على Cloudflare Pages (القسم أعلاه)، والواجهة البرمجية على خادم Oracle المجاني خلف Cloudflare. الترقية لاحقاً (عند نمو الحمل فعلاً) هي مجرد الانتقال إلى VPS مدفوع أو خدمة حاويات مُدارة، دون تغيير في الكود لأن كل شيء يعمل داخل نفس صورة Docker.

</div>
