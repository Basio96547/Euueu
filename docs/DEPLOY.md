<div dir="rtl">

# النشر على Cloudflare

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
