#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# منحُ دور الإدارة لرقم هاتف.
#
# تغييرُ البذرة لا يكفي: البذرة تُنفَّذ مرّةً على قاعدةٍ فارغة، والقاعدة
# الحيّة مبذورةٌ منذ زمن. فرقمُك الجديد لا يصير مديراً بتحرير الملفّ —
# يلزم أن يُكتب في القاعدة نفسها.
#
# والحساب يُنشأ إن لم يكن موجوداً: الدخول برمزٍ لا يحتاج تسجيلاً مسبقاً
# في هذا المتجر، لكن الدور يجب أن يسبق أوّل دخول وإلا دخل صاحبه زبوناً.
#
#   bash scripts/make-admin.sh +963958436703            → على الحيّة
#   bash scripts/make-admin.sh +963958436703 --local    → محلياً
#
# ثم تدخل من /admin برقمك: يُطلب رمزٌ، ويصلك على القناة المضبوطة.
# ═══════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")/.."

PHONE="${1:-}"
ENV_FLAG="--remote"
for a in "$@"; do [ "$a" = "--local" ] && ENV_FLAG="--local"; done

if [ -z "$PHONE" ]; then
  echo "الاستعمال: bash scripts/make-admin.sh +9639XXXXXXXX [--local]" >&2
  exit 1
fi

# الصيغة تُفرض هنا لا في القاعدة: رقمٌ بصيغةٍ أخرى يُنشئ حساباً ثانياً
# لصاحبه، فيدخل بأحدهما ويجد لوحته فارغة ولا يفهم لماذا.
if ! printf '%s' "$PHONE" | grep -qE '^\+9639[0-9]{8}$'; then
  echo "✘ الرقم يجب أن يكون بصيغة +9639XXXXXXXX — اثنتا عشرة خانة بعد +." >&2
  echo "  مثلاً 0958436703 تُكتب +963958436703." >&2
  exit 1
fi

q() { npx wrangler d1 execute talisham "$ENV_FLAG" --command "$1" --json 2>/dev/null; }

echo "▸ القاعدة $([ "$ENV_FLAG" = "--remote" ] && echo "الحيّة" || echo "المحلية") — الرقم ${PHONE}"

EXISTS=$(q "SELECT count(*) c FROM users WHERE phone_e164='${PHONE}'" \
  | grep -o '"c": *[0-9]*' | grep -o '[0-9]*' | head -1)

if [ "${EXISTS:-0}" -eq 0 ]; then
  echo "  لا حساب بهذا الرقم — يُنشأ."
  # المعرّف العام بالصيغة نفسها التي يولّدها الخادم، والدور من لحظة الإنشاء
  PID="U$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n' | head -c 10 | tr 'a-f' 'A-F')"
  q "INSERT INTO users (id, public_id, phone_e164, phone_verified_at, role, locale,
        display_currency, token_version, failed_logins, notify_prefs, created_at, updated_at)
     VALUES (lower(hex(randomblob(16))), '${PID}', '${PHONE}', CURRENT_TIMESTAMP, 'ADMIN', 'ar',
        'SYP', 0, 0, '{}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)" >/dev/null
else
  echo "  الحساب موجود — يُرقَّى."
  # رفعُ نسخة الرمز يُسقط الجلسات القائمة: من كان داخلاً بالدور القديم
  # يبقى بصلاحياته القديمة إلى انتهاء رمزه لولا ذلك.
  q "UPDATE users SET role='ADMIN', token_version=token_version+1,
        updated_at=CURRENT_TIMESTAMP WHERE phone_e164='${PHONE}'" >/dev/null
fi

ROLE=$(q "SELECT role FROM users WHERE phone_e164='${PHONE}'" \
  | grep -o '"role": *"[A-Z_]*"' | grep -o '[A-Z_]\{4,\}' | head -1)

if [ "$ROLE" = "ADMIN" ]; then
  echo "✓ ${PHONE} صار مديراً."
  echo "  ادخل من /admin بالرقم — يُطلب رمزٌ ويصلك على القناة المضبوطة."
else
  echo "✘ لم يُثبَت الدور (المقروء: ${ROLE:-لا شيء})." >&2
  exit 1
fi
