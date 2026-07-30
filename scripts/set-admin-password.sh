#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# ضبط كلمة سرّ حساب الإدارة.
#
# كان هذا مساراً في الواجهة: `POST /api/v1/bootstrap/admin-password`،
# بلا رمز ولا مصادقة، وحارسُه الوحيد أن الحقل ما زال فارغاً. وذلك سباقٌ
# لا إذن — البذرة تُنشئ حساب الإدارة بلا كلمة سرّ، ورقمُه مكتوبٌ في
# المستودع وفي ملف المتغيّرات النموذجي. فمن سبق صاحبَ المتجر إليه ضبط
# كلمة سرّ لنفسه ودخل اللوحة: كل اسم زبونٍ ورقمه وعنوانه، ومنحُ الأدوار،
# وسعر الصرف، وصرفُ المبالغ المستردّة.
#
# والصواب أن يمرّ هذا بمفتاح Cloudflare: من يملكه يملك القاعدة أصلاً،
# فهو الحدّ الصحيح للثقة — لا حقلٌ فارغ في صفّ.
#
#   bash scripts/set-admin-password.sh +963900000001
#   bash scripts/set-admin-password.sh +963900000001 --local
#
# كلمة السرّ تُقرأ من الطرفية ولا تُمرَّر في سطر الأوامر: ما يُكتب في
# السطر يبقى في تاريخ الصدفة وفي قائمة العمليات.
# ═══════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")/.."

PHONE="${1:-}"
ENV_FLAG="--remote"
for a in "$@"; do [ "$a" = "--local" ] && ENV_FLAG="--local"; done

if [ -z "$PHONE" ] || [[ ! "$PHONE" =~ ^\+9639[0-9]{8}$ ]]; then
  echo "الاستعمال: bash scripts/set-admin-password.sh +9639XXXXXXXX [--local]" >&2
  exit 1
fi

if [ "$ENV_FLAG" = "--remote" ] && [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "✘ CLOUDFLARE_API_TOKEN غير مضبوط — وهو الإذن الذي يقوم مقام المصادقة هنا." >&2
  exit 1
fi

q() { npx wrangler d1 execute talisham "$ENV_FLAG" --command "$1" --json 2>/dev/null; }

ROLE=$(q "SELECT role FROM users WHERE phone_e164='${PHONE}'" \
  | grep -o '"role": *"[^"]*"' | cut -d'"' -f4 | head -1)

if [ -z "$ROLE" ]; then
  echo "✘ لا حساب بهذا الرقم." >&2
  exit 1
fi
if [ "$ROLE" != "ADMIN" ]; then
  echo "✘ دور الحساب ${ROLE} لا ADMIN — كلمة السرّ للموظّفين، والزبون يدخل برمز." >&2
  exit 1
fi

# القراءة صامتة: كلمة سرّ تُطبع على الشاشة تبقى في سجلّ الطرفية
printf 'كلمة السرّ الجديدة: ' >&2
read -rs PW; echo >&2
printf 'أعِدها للتأكيد:      ' >&2
read -rs PW2; echo >&2
[ "$PW" = "$PW2" ] || { echo "✘ لا تتطابقان." >&2; exit 1; }
[ "${#PW}" -ge 12 ] || { echo "✘ اثنا عشر محرفاً على الأقل." >&2; exit 1; }

# التجزئة بصيغة `common/password.ts` حرفاً بحرف: المعاملات مكتوبة داخل
# التجزئة نفسها لأن التحقّق يقرؤها منها، وتطبيعُ NFKC لأن العربية تُكتب
# بأشكالٍ متعدّدة للمحرف الواحد — فبلا تطبيعٍ تُرفض الكلمة الصحيحة.
# والملح عشوائي لكل كلمة: بلا ملح تُكشف كلمتان متطابقتان بمجرد النظر.
HASH=$(PW="$PW" node -e '
const { scryptSync, randomBytes } = require("node:crypto");
const N = 16384, r = 8, p = 1, KEYLEN = 64;
const salt = randomBytes(16);
const key = scryptSync(process.env.PW.normalize("NFKC"), salt, KEYLEN,
  { N, r, p, maxmem: 64 * 1024 * 1024 });
process.stdout.write(`scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${key.toString("base64")}`);
')

# رفعُ نسخة الرمز يُسقط كل جلسةٍ قائمة: تغييرُ كلمة السرّ إعلانُ أن
# القديمة لم تعد تُؤتمن، ومن كان داخلاً بها يُخرَج.
q "UPDATE users SET password_hash='${HASH}', token_version=token_version+1,
   failed_logins=0, locked_until=NULL WHERE phone_e164='${PHONE}'" >/dev/null

echo "✓ ضُبطت كلمة السرّ لـ${PHONE}، وأُسقطت الجلسات القائمة."
echo "  الدخول: /admin ← بالرقم وكلمة السرّ."
