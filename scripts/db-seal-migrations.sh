#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# ختم سجلّ الترحيل لقاعدةٍ هُيِّئت بلا wrangler.
#
# القاعدة الحيّة هُيِّئت عبر `POST /api/v1/bootstrap` لأن مفتاح النشر كان
# بلا صلاحية D1. والمسار ينفّذ مخطَّط 0001 مباشرةً ولا يكتب شيئاً في
# `d1_migrations` — فالجداول موجودة والسجلّ فارغ.
#
# ونتيجته أن `d1 migrations apply` يبدأ من 0001 فيسقط فوراً بـ«table
# users already exists»، ويسقط معه كلُّ ترحيلٍ جديد بعده. أي أن المتجر
# لا يستطيع تغيير مخطَّطه إطلاقاً — وهو عطلٌ صامت: النشر يمرّ (الخطوة
# `continue-on-error`) والترحيل لا يجري، فتُنشَر شيفرةٌ تنتظر جدولاً لن
# يُخلَق.
#
# وهذا النصّ يكتب في السجلّ ما هو مطبَّقٌ فعلاً — ولا يثق بالادّعاء:
# لكل ترحيلٍ علامةٌ في المخطَّط تُفحص قبل ختمه. فما لا تظهر علامته لا
# يُختَم، ويُقال لماذا. وختمُ ترحيلٍ لم يُطبَّق أسوأ من ألّا يُختَم شيء:
# يُخفي النقص إلى الأبد.
#
#   bash scripts/db-seal-migrations.sh --local
#   bash scripts/db-seal-migrations.sh --remote
# ═══════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FLAG="--local"
for a in "$@"; do [ "$a" = "--remote" ] && ENV_FLAG="--remote"; done

q() { npx wrangler d1 execute talisham "$ENV_FLAG" --command "$1" --json 2>/dev/null; }
count() { q "$1" | grep -o '"c": *[0-9]*' | grep -o '[0-9]*' | head -1; }

# علامةُ كل ترحيل في المخطَّط: استعلامٌ يعيد 1 إن كان أثره موجوداً.
# الترحيل الذي لا علامة له لا يُختَم — والصمت هنا أأمن من التخمين.
probe() {
  case "$1" in
    0001_d1_init.sql)
      count "SELECT count(*) c FROM sqlite_master WHERE type='table' AND name='users'" ;;
    0002_new_pound.sql)
      # القيد القديم كان يرفض كل مبلغٍ بالليرة الجديدة: وجودُه يعني أن
      # الترحيل لم يجرِ. وغيابه هو الأثر.
      count "SELECT count(*) c FROM sqlite_master WHERE type='table' AND name='orders'
             AND sql NOT LIKE '%total_syp % 1000%'" ;;
    0003_order_courier.sql)
      count "SELECT count(*) c FROM pragma_table_info('orders') WHERE name='courier_id'" ;;
    0004_notifications.sql)
      count "SELECT count(*) c FROM sqlite_master WHERE type='table' AND name='notifications'" ;;
    *) echo "UNKNOWN" ;;
  esac
}

LEDGER=$(count "SELECT count(*) c FROM d1_migrations" || echo "")
if [ -z "$LEDGER" ]; then
  echo "✘ لا جدول d1_migrations — القاعدة غير مهيّأة أصلاً." >&2
  exit 1
fi
echo "▸ في السجلّ الآن: ${LEDGER} ترحيلاً"

SEALED=0
SKIPPED=0
for f in apps/api/migrations/*.sql; do
  name=$(basename "$f")

  have=$(count "SELECT count(*) c FROM d1_migrations WHERE name='${name}'")
  if [ "${have:-0}" -gt 0 ]; then
    echo "  ○ ${name} — مختوم سلفاً"
    continue
  fi

  mark=$(probe "$name")
  if [ "$mark" = "UNKNOWN" ]; then
    echo "  ✘ ${name} — لا علامة معرَّفة له في هذا النصّ." >&2
    echo "    أضِف علامته في probe() قبل ختمه — والختم بلا فحصٍ يُخفي النقص." >&2
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  if [ "${mark:-0}" -eq 0 ]; then
    echo "  ‣ ${name} — أثره غير موجود، فهو لم يُطبَّق. لا يُختَم."
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  npx wrangler d1 execute talisham "$ENV_FLAG" \
    --command "INSERT INTO d1_migrations (name, applied_at) VALUES ('${name}', CURRENT_TIMESTAMP)" \
    >/dev/null 2>&1
  echo "  ✓ ${name} — أثره موجود، خُتم"
  SEALED=$((SEALED + 1))
done

echo "✓ خُتم ${SEALED} · تُرك ${SKIPPED}"
if [ "$SKIPPED" -gt 0 ]; then
  echo "  ما تُرك يُطبَّق بـ: npx wrangler d1 migrations apply talisham ${ENV_FLAG}"
fi
