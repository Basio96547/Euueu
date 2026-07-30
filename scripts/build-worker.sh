#!/usr/bin/env bash
# تجميع أصول الـWorker الواحد.
#
#   dist-worker/           ← الموقع الساكن (Astro)
#   dist-worker/app/       ← تطبيق السلة والحساب
#   dist-worker/admin/     ← لوحة التحكم
#   apps/api/dist/worker.js ← نص الـWorker نفسه
#
# ترتيب النسخ مقصود: الموقع أولاً ثم التطبيقان فوقه، فلا يطمس ملفٌ عام
# ملفاً خاصاً بتطبيق.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "▸ بناء الموقع الساكن…"
# الموقع يُبنى من القاعدة لا من ملف البذرة: بلا هذا لا يظهر منتجٌ يُدخله
# صاحب المتجر من اللوحة مهما فعل — الصفحات مجمَّدة على ما في المستودع.
# والفشل لا يُسقط البناء: `lib/catalog.ts` يعود إلى البذرة ويطبع سبب
# العودة، فنشرةٌ بكتالوج أمس خيرٌ من نشرةٍ لا تقع.
PUBLIC_SITE_URL="${PUBLIC_SITE_URL:-https://talisham.com}" \
PUBLIC_API_URL="${PUBLIC_API_URL:-https://talisham.com/api/v1}" \
  pnpm --filter @talisham/site run build

echo "▸ بناء تطبيق العميل…"
# أصلٌ واحد يعني مساراً نسبياً: لا نطاق ثانٍ ولا CORS ولا رمز عبر أصلين
VITE_API_URL="/api/v1" pnpm --filter @talisham/app run build

echo "▸ بناء لوحة التحكم…"
VITE_API_URL="/api/v1" pnpm --filter @talisham/admin run build

echo "▸ توليد عميل Prisma…"
pnpm --filter @talisham/api run generate

echo "▸ ترجمة الواجهة البرمجية…"
pnpm --filter @talisham/api run build

echo "▸ تجميع الأصول…"
rm -rf dist-worker
mkdir -p dist-worker
cp -r apps/site/dist/. dist-worker/
mkdir -p dist-worker/app dist-worker/admin
cp -r apps/app/dist/. dist-worker/app/
cp -r apps/admin/dist/. dist-worker/admin/

FILES=$(find dist-worker -type f | wc -l)
SIZE=$(du -sh dist-worker | cut -f1)
echo "✓ dist-worker: ${FILES} ملفاً · ${SIZE}"
echo "  النشر: npx wrangler deploy"
