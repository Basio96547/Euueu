#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# النشر المباشر إلى Cloudflare — بلا GitHub Actions.
#
# كان النشر يمرّ بـGitHub: تُدفع الشيفرة، فيُقلع سير عمل، فيبني وينشر.
# وهو وسيطٌ بلا حاجة ما دام صاحب المتجر يملك جهازاً: يضيف دقائق انتظار،
# ويُخفي الخطأ في سجلٍّ يُفتح من متصفّح، ويُخضع النشر لفرعٍ افتراضي
# ولأسرارٍ تُضبط في مكانٍ ثالث.
#
# وهذا النصّ يفعل ما كان يفعله كلّه، في المكان الذي تُكتب فيه الشيفرة:
#   ١. يبني الأصول ونصّ الـWorker
#   ٢. يختم سجلّ الترحيل ثم يُطبّق ما لم يُطبَّق
#   ٣. يفرض ميزانية الحزمة قبل النشر لا بعده
#   ٤. ينشر
#   ٥. يتحقّق أن الحيّ يردّ فعلاً — فالنشر الذي لا يُفحص ادّعاء
#
#   bash scripts/deploy.sh              → نشرة كاملة
#   bash scripts/deploy.sh --no-migrate → بلا مساس بالقاعدة
#   bash scripts/deploy.sh --dry-run    → يبني ويفحص ولا ينشر
#
# يلزمه `CLOUDFLARE_API_TOKEN` في البيئة، بصلاحيتَي Workers وD1.
# ═══════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")/.."

MIGRATE=1
DRY=0
for a in "$@"; do
  [ "$a" = "--no-migrate" ] && MIGRATE=0
  [ "$a" = "--dry-run" ] && DRY=1
done

step() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] && [ "$DRY" -eq 0 ]; then
  echo "✘ CLOUDFLARE_API_TOKEN غير مضبوط." >&2
  echo "" >&2
  echo "  أنشِئه من: Cloudflare ← My Profile ← API Tokens ← Create Token" >&2
  echo "  الصلاحيات اللازمة:" >&2
  echo "    • Account ← Workers Scripts       : Edit" >&2
  echo "    • Account ← Workers KV Storage    : Edit" >&2
  echo "    • Account ← D1                    : Edit" >&2
  echo "" >&2
  echo "  ثم:  export CLOUDFLARE_API_TOKEN=...  &&  bash scripts/deploy.sh" >&2
  exit 1
fi

# ═══ ١· البناء ═══
step "بناء الأصول ونصّ الـWorker"
PUBLIC_SITE_URL="${PUBLIC_SITE_URL:-https://talisham.com}" pnpm run build:worker

# ═══ ٢· ميزانية الحزمة ═══
# تُفرض قبل النشر لا بعده: بوابةٌ تُفتح بعد المرور ليست بوابة. والموقع
# الساكن ميزانيته ستون كيلوبايت مضغوطة — وهي سببُ أنه يُفتح على شبكةٍ
# سورية أصلاً.
step "ميزانية الحزمة"
JS=$(find dist-worker -maxdepth 2 -name '*.js' \
       -not -path 'dist-worker/app/*' -not -path 'dist-worker/admin/*' \
       -exec cat {} + 2>/dev/null | gzip -c | wc -c || echo 0)
echo "  JavaScript المضغوط في الموقع الساكن: ${JS} بايت / 61440"
if [ "$JS" -gt 61440 ]; then
  echo "✘ تجاوز ميزانية ستين كيلوبايت — لن يُنشر." >&2
  exit 1
fi

if [ "$DRY" -eq 1 ]; then
  echo ""
  echo "✓ البناء والفحص تمّا — ولم يُنشر شيء (--dry-run)."
  exit 0
fi

# ═══ ٣· الترحيل ═══
# الختم قبل التطبيق: القاعدة الحيّة هُيِّئت عبر /bootstrap لا بـwrangler،
# فجداولها موجودة وسجلّها فارغ — ولولا الختم لبدأ الترحيل من 0001 وسقط.
if [ "$MIGRATE" -eq 1 ]; then
  step "ختم سجلّ الترحيل"
  bash scripts/db-seal-migrations.sh --remote || {
    echo "✘ تعذّر ختم السجلّ — لا يُنشر على قاعدةٍ لا تُرحَّل." >&2
    echo "  (للنشر رغم ذلك: bash scripts/deploy.sh --no-migrate)" >&2
    exit 1
  }

  step "تطبيق الترحيلات"
  npx wrangler d1 migrations apply talisham --remote --yes
fi

# ═══ ٤· النشر ═══
step "النشر"
npx wrangler deploy

# ═══ ٥· التحقّق ═══
# النشرة التي لا تُفحص ادّعاء: wrangler يقول «Uploaded» وقد يكون الـWorker
# يسقط عند أول طلب — خطأُ إقلاعٍ لا يظهر إلا حين يُطلب منه شيء.
step "التحقّق من الحيّ"
SITE="${PUBLIC_SITE_URL:-https://talisham.com}"
FAIL=0
check() {
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 20 -L "$SITE$1" || echo 000)
  if echo "$2" | grep -qw "$code"; then
    printf '  \033[32m✓\033[0m %-40s %s\n' "$1" "$code"
  else
    printf '  \033[31m✗\033[0m %-40s %s (المتوقَّع %s)\n' "$1" "$code" "$2"
    FAIL=$((FAIL + 1))
  fi
}
check /api/v1/health              200
check /api/v1/catalog/products    200
check /api/v1/me/notifications    401      # يجب أن يُرفض بلا رمز — لا 404 ولا 500
check /                           200
check /app                        200
check /admin                      200

if [ "$FAIL" -gt 0 ]; then
  echo "" >&2
  echo "✘ نُشرت ولكن ${FAIL} مساراً لا يردّ كما يجب." >&2
  echo "  التراجع:  npx wrangler rollback" >&2
  exit 1
fi

echo ""
echo "✓ نُشرت وتعمل — ${SITE}"
