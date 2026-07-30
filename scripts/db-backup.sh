#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# نسخةٌ احتياطية من قاعدة D1.
#
# لم يكن في المشروع نسخةٌ واحدة. وقاعدة متجرٍ تحمل طلبات الزبائن
# وعناوينهم ومخزونه وتسوياته النقدية — وضياعها ليس عطلاً يُصلَح بل
# متجرٌ يبدأ من الصفر ولا يعرف من يدين له بماذا.
#
# والنسخة التي لم تُختبر استعادتها ليست نسخة: هي ملفٌّ يُطمئن صاحبه حتى
# اليوم الذي يحتاجه. لذلك `db-restore.sh` جزءٌ من هذا العمل لا ملحقٌ به،
# والفحص الأسبوعي يستعيد فعلاً في قاعدةٍ محلية.
#
#   bash scripts/db-backup.sh              → نسخة من القاعدة الحيّة
#   bash scripts/db-backup.sh --local      → من القاعدة المحلية
#
# المخرَج: backups/talisham-YYYY-MM-DD-HHMM.sql.gz
# ═══════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FLAG="--remote"
LABEL="الحيّة"
if [ "${1:-}" = "--local" ]; then ENV_FLAG="--local"; LABEL="المحلية"; fi

STAMP=$(date -u +%Y-%m-%d-%H%M)
OUT="backups/talisham-${STAMP}.sql"
mkdir -p backups

echo "▸ تصدير القاعدة ${LABEL}…"

# `d1 export` يُخرج المخطَّط والبيانات معاً. وفشله هنا لا يُتجاوَز:
# نسخةٌ فارغة أسوأ من غياب النسخة، لأنها تُوهم بوجودها.
if ! npx wrangler d1 export talisham "$ENV_FLAG" --output "$OUT" 2>/tmp/d1-export.err; then
  echo "✘ فشل التصدير:" >&2
  sed 's/^/  /' /tmp/d1-export.err >&2
  echo "" >&2
  echo "  السبب الغالب: مفتاح CLOUDFLARE_API_TOKEN بلا صلاحية D1." >&2
  echo "  أضِف D1: Edit من لوحة Cloudflare ← My Profile ← API Tokens." >&2
  exit 1
fi

BYTES=$(wc -c < "$OUT")
# ملفٌّ أصغر من عشرة كيلوبايت لا يحمل مخطَّط 51 جدولاً — فهو فشلٌ صامت
if [ "$BYTES" -lt 10240 ]; then
  echo "✘ الملف ${BYTES} بايت فقط — تصديرٌ ناقص لا نسخة. حُذف." >&2
  rm -f "$OUT"
  exit 1
fi

TABLES=$(grep -c '^CREATE TABLE' "$OUT" || echo 0)
gzip -9 "$OUT"
SIZE=$(du -h "${OUT}.gz" | cut -f1)

echo "✓ ${OUT}.gz — ${SIZE} · ${TABLES} جدولاً"
echo "  الاستعادة: bash scripts/db-restore.sh ${OUT}.gz --local"

# الاحتفاظ بأربع عشرة نسخة: أسبوعان يكفيان لاكتشاف فسادٍ صامت، وما فوقها
# يملأ القرص بلا أن يُقرأ.
ls -1t backups/talisham-*.sql.gz 2>/dev/null | tail -n +15 | while read -r old; do
  echo "  حُذفت نسخة قديمة: $(basename "$old")"
  rm -f "$old"
done
