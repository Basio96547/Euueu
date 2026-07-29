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

### المعاينة المنشورة حالياً

| الواجهة | الرابط | تعمل؟ |
| --- | --- | --- |
| المتجر (Astro) | https://talisham.vigorous-nannyberry.workers.dev | نعم كاملاً — صفحاته ساكنة لا تحتاج خادماً |
| تطبيق الزبون | https://talisham-app.vigorous-nannyberry.workers.dev | الشكل فقط — السلة تحتاج الواجهة البرمجية |
| لوحة الإدارة | https://talisham-admin.vigorous-nannyberry.workers.dev | الشكل فقط — الدخول يحتاج الواجهة البرمجية |

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

</div>
