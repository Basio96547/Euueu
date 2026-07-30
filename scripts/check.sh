#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# الفحص الكامل قبل النشر — بلا GitHub Actions.
#
# كان هذا يجري في CI عند كل دفعة. وقد كان يُقرأ من متصفّح بعد دقائق
# انتظار، بينما هو نفسه يجري هنا في أقلّ من دقيقتين وأنت واقفٌ عليه.
#
# يفعل ما كان يفعله `ci.yml` و`maintenance.yml` معاً:
#   ١. فحص الأنواع
#   ٢. اختبارات الوحدة
#   ٣. البناء الكامل
#   ٤. الفحص من طرف إلى طرف على Worker حقيقي وقاعدة حقيقية
#   ٥. ثغرات الاعتماديات المعروفة
#
#   bash scripts/check.sh            → الفحص كله
#   bash scripts/check.sh --quick    → بلا الطرف-إلى-طرف (أسرع)
#
# يُرجع صفراً إن مرّ كلّه — فيصلح شرطاً قبل النشر:
#   bash scripts/check.sh && bash scripts/deploy.sh
# ═══════════════════════════════════════════════════════════════
set -uo pipefail
cd "$(dirname "$0")/.."

QUICK=0
for a in "$@"; do [ "$a" = "--quick" ] && QUICK=1; done

FAIL=0
step() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }
bad()  { printf '\033[31m✘ %s\033[0m\n' "$1" >&2; FAIL=$((FAIL + 1)); }

step "فحص الأنواع"
pnpm turbo run typecheck || bad "فحص الأنواع"

step "اختبارات الوحدة"
pnpm turbo run test || bad "اختبارات الوحدة"

step "البناء الكامل"
pnpm run build:worker || bad "البناء"

if [ "$QUICK" -eq 0 ]; then
  step "الفحص من طرف إلى طرف"
  # على Worker حقيقي لا على Node: الفرق ليس شكلياً — الحدّ والحقن
  # ورؤوس الأمان كلها في طبقة الـWorker، ولا تُفحص إن فُحص ما تحتها.
  PORT=8791
  npx wrangler dev --port "$PORT" --local > /tmp/talisham-dev.log 2>&1 &
  DEV_PID=$!
  trap 'kill "$DEV_PID" 2>/dev/null || true' EXIT

  for _ in $(seq 1 60); do
    curl -s -m 2 -o /dev/null "http://127.0.0.1:$PORT/api/v1/health" && break
    sleep 2
  done

  if ! curl -s -m 3 -o /dev/null "http://127.0.0.1:$PORT/api/v1/health"; then
    bad "تعذّر إقلاع الـWorker المحلي — آخر السجلّ:"
    tail -20 /tmp/talisham-dev.log >&2
  else
    OUT=$(API_BASE="http://127.0.0.1:$PORT/api/v1" bash scripts/e2e.sh 2>&1)
    echo "$OUT"
    # `grep -c` يطبع صفراً ويخرج بواحد حين لا يجد. فـ`|| echo 0` يُلحق
    # صفراً ثانياً بالمطبوع، فتصير القيمة سطرين ويفشل الاختبار العددي
    # على فحصٍ نظيف. `|| true` يبتلع رمز الخروج ويترك المطبوع كما هو.
    PASS=$(echo "$OUT" | grep -c '✓' || true)
    MISS=$(echo "$OUT" | grep -c '✗' || true)
    echo ""
    echo "  النتيجة: ${PASS} نجاحاً · ${MISS} إخفاقاً"
    [ "$MISS" -eq 0 ] || bad "الفحص من طرف إلى طرف: ${MISS} إخفاقاً"
  fi

  kill "$DEV_PID" 2>/dev/null || true
  trap - EXIT
fi

step "ثغرات الاعتماديات"
# لا تُسقط الفحص: ثغرةٌ في اعتمادٍ غير مستعمل ليست سبباً لمنع نشرة،
# لكنها تُقال ولا تُبتلع.
pnpm audit --audit-level high || echo "  (ملاحظات تدقيق — راجعها ولا تمنع النشر)"

echo ""
if [ "$FAIL" -eq 0 ]; then
  echo -e "\033[32m✓ مرّ الفحص كلّه.\033[0m  النشر: bash scripts/deploy.sh"
  exit 0
fi
echo -e "\033[31m✘ سقط ${FAIL} فحصاً — لا يُنشر.\033[0m" >&2
exit 1
