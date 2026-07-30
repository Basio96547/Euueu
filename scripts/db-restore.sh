#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# استعادة قاعدة D1 من نسخة احتياطية.
#
# النسخة التي لم تُختبر استعادتها ليست نسخة. وهذا النصّ ليس ملحقاً
# بـ`db-backup.sh` بل نصفه الثاني: بلا استعادةٍ مُجرَّبة، النسخة ملفٌّ
# يُطمئن صاحبه حتى اليوم الذي يحتاجه فيه — وعندها يكتشف أنها ناقصة أو
# بصيغةٍ لا تُقرأ أو أن أحداً لم يجرّب.
#
#   bash scripts/db-restore.sh backups/talisham-2026-07-30-0600.sql.gz --local
#   bash scripts/db-restore.sh <ملف> --remote --yes-i-mean-it
#
# الاستعادة على الحيّة تحتاج علامةً صريحة طويلة: من يكتبها يعرف أنه
# يمحو قاعدةً تعمل. والخطأ هنا لا يُتراجَع عنه.
# ═══════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")/.."

FILE="${1:-}"
ENV_FLAG="--local"
CONFIRMED=0
for a in "$@"; do
  [ "$a" = "--remote" ] && ENV_FLAG="--remote"
  [ "$a" = "--yes-i-mean-it" ] && CONFIRMED=1
done

if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "الاستعمال: bash scripts/db-restore.sh <نسخة.sql.gz> [--local|--remote --yes-i-mean-it]" >&2
  echo "" >&2
  echo "النسخ المتاحة:" >&2
  ls -1t backups/talisham-*.sql.gz 2>/dev/null | head -14 | sed 's/^/  /' >&2 || echo "  (لا نسخ)" >&2
  exit 1
fi

if [ "$ENV_FLAG" = "--remote" ] && [ "$CONFIRMED" -eq 0 ]; then
  echo "✘ الاستعادة على القاعدة الحيّة تمحو ما فيها ولا تُتراجَع." >&2
  echo "  أضِف --yes-i-mean-it إن كنت تقصد ذلك فعلاً." >&2
  exit 1
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
gunzip -c "$FILE" > "$TMP/raw.sql"

# التصدير يُداخل الإنشاء بالإدخال، وهو ترتيبٌ لا يُستعاد. تُعاد الجُمل إلى
# أربع مراحل قبل التنفيذ — والتفصيل في lib/reorder-dump.py.
python3 "$(dirname "$0")/lib/reorder-dump.py" < "$TMP/raw.sql" > "$TMP/dump.sql"

TABLES=$(grep -c '^CREATE TABLE' "$TMP/dump.sql" || echo 0)
echo "▸ النسخة: $(basename "$FILE") — ${TABLES} جدولاً"

# الملفّ يُفحص قبل أن يُنفَّذ: نسخةٌ ناقصة تمحو قاعدةً سليمة وتضع مكانها
# نصفَ قاعدة، وهو أسوأ من ألّا تُستعاد أصلاً.
if [ "$TABLES" -lt 40 ]; then
  echo "✘ ${TABLES} جدولاً فقط — النسخة ناقصة. لن تُستعاد." >&2
  exit 1
fi

echo "▸ الاستعادة إلى القاعدة $([ "$ENV_FLAG" = "--remote" ] && echo "الحيّة" || echo "المحلية")…"
# التنفيذ يطبع نتيجةَ كل جملة — ألفَ كتلةِ JSON لا تُقرأ وتُخفي الخطأ بينها.
# فيُبتلع المخرَج ويُطبع كاملاً إن فشل فقط.
if ! npx wrangler d1 execute talisham "$ENV_FLAG" --file "$TMP/dump.sql" --yes > "$TMP/exec.log" 2>&1; then
  echo "✘ فشلت الاستعادة:" >&2
  grep -iE 'error|✘' "$TMP/exec.log" | head -20 | sed 's/^/  /' >&2
  exit 1
fi

echo "▸ التحقّق…"
q() { npx wrangler d1 execute talisham "$ENV_FLAG" --command "$1" --json 2>/dev/null \
      | grep -o '"c": *[0-9]*' | grep -o '[0-9]*' | head -1; }

COUNT=$(q "SELECT count(*) c FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
[ "${COUNT:-0}" -ge 40 ] || { echo "✘ ${COUNT:-0} جدولاً فقط — راجع قبل الاعتماد عليها" >&2; exit 1; }

# الجداول وحدها لا تكفي: نسخةٌ فيها اثنان وخمسون جدولاً فارغاً تجتاز فحص
# العدد وهي لا تحمل شيئاً. فيُسأل عن الصفوف نفسها.
EXPECT=$(grep -c '^INSERT' "$TMP/dump.sql" || echo 0)
ORDERS=$(q "SELECT count(*) c FROM orders")
PRODUCTS=$(q "SELECT count(*) c FROM products")

echo "✓ استُعيدت — ${COUNT} جدولاً · ${EXPECT} إدخالاً · ${ORDERS:-0} طلباً · ${PRODUCTS:-0} منتجاً"

if [ "$EXPECT" -gt 0 ] && [ "$(( ${ORDERS:-0} + ${PRODUCTS:-0} ))" -eq 0 ]; then
  echo "✘ النسخة فيها إدخالات لكن القاعدة خلَت منها — استعادةٌ صامتةُ الفشل." >&2
  exit 1
fi
