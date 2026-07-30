#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# النسخ الاحتياطي المجدوَل — على جهازك بدل GitHub.
#
# كان النسخ اليومي يجري في GitHub Actions. وحُذف مع بقية ملفاته، فبقيت
# القاعدة بلا نسخةٍ تلقائية — وهو أخطر ما في هذا النقل كلّه: قاعدة المتجر
# تحمل طلبات الزبائن وعناوينهم ومخزونه وتسوياته، وضياعها ليس عطلاً يُصلَح
# بل متجرٌ يبدأ من الصفر ولا يعرف من يدين له بماذا.
#
# فهذا النصّ يُجدوَل على جهازك ليأخذ مكانه. وهو غلافٌ حول `db-backup.sh`
# يصلح للجدولة: لا يسأل شيئاً، ويكتب ما جرى في سجلّ، ويصرخ عند الفشل.
#
# ── التركيب ──
#
# لينكس/ماك (crontab -e)، كلَّ يوم الرابعة فجراً بتوقيت دمشق:
#
#   0 4 * * *  cd /مسار/المشروع && CLOUDFLARE_API_TOKEN=... \
#              BACKUP_PASSPHRASE=... bash scripts/backup-cron.sh
#
# ويندوز (Task Scheduler): مهمّة يومية تُشغّل الأمر نفسه في WSL أو Git Bash.
#
# ⚠ احفظ `BACKUP_PASSPHRASE` خارج الجهاز أيضاً: بدونها لا تُفكّ النسخة
#   أبداً — والقرص الذي عليه النسخ هو نفسه القرص الذي قد يُعطب.
# ═══════════════════════════════════════════════════════════════
set -uo pipefail
cd "$(dirname "$0")/.."

LOG="backups/backup.log"
mkdir -p backups
say() { printf '%s  %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$1" | tee -a "$LOG"; }

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  say "✘ CLOUDFLARE_API_TOKEN غير مضبوط — لا نسخة اليوم."
  exit 1
fi

if [ -z "${BACKUP_PASSPHRASE:-}" ]; then
  say "✘ BACKUP_PASSPHRASE غير مضبوط — لن تُكتب نسخةٌ خام."
  exit 1
fi

say "▸ بدء النسخ…"
if OUT=$(REQUIRE_ENCRYPTION=1 bash scripts/db-backup.sh 2>&1); then
  say "✓ $(echo "$OUT" | grep '^✓' | head -1)"
else
  say "✘ فشل النسخ:"
  echo "$OUT" | sed 's/^/    /' | tee -a "$LOG"
  exit 1
fi

# التمرين أسبوعياً: نسخةٌ لم تُستعَد قطّ ملفٌّ يُطمئن صاحبه حتى اليوم الذي
# يحتاجه فيه. ويوم الأحد لأن الأسبوع السوري يبدأ به.
if [ "$(date -u +%u)" = "7" ]; then
  say "▸ تمرين الاستعادة الأسبوعي…"
  F=$(ls -1t backups/talisham-*.sql.gz.enc 2>/dev/null | head -1)
  if [ -z "$F" ]; then
    say "✘ لا نسخة لتُجرَّب."
    exit 1
  fi
  # في قاعدةٍ جانبية: الاستعادة فوق قاعدة التطوير تمحو عملَ اليوم
  TMPD=$(mktemp -d); trap 'rm -rf "$TMPD"' EXIT
  if OUT=$(WRANGLER_STATE_DIR="$TMPD" bash scripts/db-restore.sh "$F" --local 2>&1); then
    say "✓ $(echo "$OUT" | grep '^✓' | head -1)"
  else
    say "✘ فشل تمرين الاستعادة — النسخ يجري والاستعادة لا تعمل:"
    echo "$OUT" | sed 's/^/    /' | tee -a "$LOG"
    exit 1
  fi
fi

say "✓ تمّ."
