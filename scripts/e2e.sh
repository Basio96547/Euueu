#!/bin/bash
#
# فحص من طرف إلى طرف على واجهة برمجية تعمل وقاعدة بيانات حقيقية.
# يكمّل اختبارات الوحدات (pnpm test) ولا يغني عنها: تلك تفحص الحساب،
# وهذا يفحص أن الأجزاء تتكلّم بعضها مع بعض عبر الشبكة والقاعدة.
#
#   الاستعمال: bash scripts/e2e.sh
#   يفترض واجهة على localhost:4000 وقاعدة talisham مبذورة.
#
# الفحص يهيّئ بضاعته بنفسه بأرقام IMEI فريدة لكل تشغيل، فيعطي
# النتيجة نفسها مهما تكرر — وفحصٌ يعتمد على ما خلّفه سابقه ليس فحصاً.
#
# العنوان قابل للضبط: الفحص نفسه يُشغَّل على Node محلياً وعلى الـWorker
#   API_BASE=http://127.0.0.1:8790/api/v1 bash scripts/e2e.sh
API=${API_BASE:-http://localhost:4000/api/v1}
# قراءة القاعدة للتأكّد من الأثر لا من الجواب: الواجهة قد تقول «تمّ»
# والدفتر لا يوافقها. D1 يُقرأ بأداته، محلياً افتراضاً و‎--remote‎ عند الحاجة.
D1_ENV=${D1_ENV:---local}
dbq() { npx wrangler d1 execute talisham "$D1_ENV" --command="$1" --json 2>/dev/null \
  | python3 -c "import json,sys
try:
    r=json.load(sys.stdin)[0]['results']
    print(' '.join(str(v) for row in r for v in row.values()))
except Exception:
    print('')"; }
SKU=SMA35-128-NVY-GULF
ok(){ printf '  \033[32m✓\033[0m %s\n' "$1"; }
no(){ printf '  \033[31m✗\033[0m %s — %s\n' "$1" "$2"; }
chk(){ if echo "$2" | grep -q "$3"; then ok "$1"; else no "$1" "$(echo "$2"|head -c 150)"; fi }

tok(){ local r c
  r=$(curl -s -X POST $API/auth/otp/request -H 'content-type: application/json' -d "{\"phone\":\"$1\"}")
  c=$(echo "$r"|grep -o '"devCode":"[0-9]*"'|cut -d'"' -f4)
  curl -s -X POST $API/auth/otp/verify -H 'content-type: application/json' -d "{\"phone\":\"$1\",\"code\":\"$c\"}"|grep -o '"accessToken":"[^"]*"'|cut -d'"' -f4; }

AT=$(tok "+963900000001"); AH="authorization: Bearer $AT"

# دور المندوب يُمنح من اللوحة لا من سطر الأوامر: الفحص كان يفترض أن
# أحداً منحه سابقاً، فيمرّ عند من فعل ويفشل على قاعدة نظيفة.
# ومنحُ الدور يرفع نسخة الرمز فيُسقط الجلسة — فيُعاد الدخول بعده.
CT=$(tok "+963955555555")
CPID=$(curl -s "$API/auth/me" -H "authorization: Bearer $CT"|grep -o '"publicId":"[^"]*"'|cut -d'"' -f4)
curl -s -X POST "$API/admin/users/$CPID/role" -H "$AH" -H 'content-type: application/json' \
  -d '{"role":"COURIER","reason":"تهيئة الفحص من طرف إلى طرف"}' > /dev/null
CT=$(tok "+963955555555"); CH="authorization: Bearer $CT"

# ومندوبٌ مسجَّل لا دورٌ وحده: التضييق يفشل مغلقاً، فحاملُ الدور بلا صفٍّ
# في جدول المندوبين لا يرى طلباً ولا يتصرّف فيه. وهذا ما يمنع أن يكفي
# منحُ الدور لرؤية كل زبائن المتجر.
# حسابٌ جديد لكل تشغيل: صفّ المندوب يبقى في القاعدة بين التشغيلات، فرقمٌ
# ثابت يجعل الفحص يمرّ أول مرة ويكذب بعدها.
NEWC="+96395$(printf '%07d' $((RANDOM * RANDOM % 10000000)))"
NCT=$(tok "$NEWC")
NCPID=$(curl -s "$API/auth/me" -H "authorization: Bearer $NCT"|grep -o '"publicId":"[^"]*"'|cut -d'"' -f4)
curl -s -X POST "$API/admin/users/$NCPID/role" -H "$AH" -H 'content-type: application/json' \
  -d '{"role":"COURIER","reason":"فحص التضييق"}' > /dev/null
NCT=$(tok "$NEWC")
chk "الدور وحده لا يكفي: مندوب بلا صفّ لا يرى شيئاً" "$(curl -s "$API/courier/tasks" -H "authorization: Bearer $NCT")" '"data":\[\]'
curl -s -X POST "$API/admin/delivery/couriers" -H "$AH" -H 'content-type: application/json' \
  -d '{"code":"DMS-99","fullName":"مندوب الفحص","phone":"+963955555555","homeGovernorate":"DAMASCUS"}' >/dev/null
CT=$(tok "+963955555555"); CH="authorization: Bearer $CT"

# منطقةٌ بفارق سعر: أجر التوصيل كان مئتَي سنت لكل عنوان في سوريا،
# وفارقُ المنطقة مضبوطٌ في القاعدة ولا يمسّ ما يدفعه الزبون. والفحص
# يثبت أنه يصل إلى السلة والطلب معاً — لا إلى أحدهما فيفترقا.
curl -s -X POST "$API/admin/delivery/zones" -H "$AH" -H 'content-type: application/json' \
  -d '{"code":"DMS-MEZZEH","name":{"ar":"المزة"},"governorate":"DAMASCUS","city":"دمشق",
       "neighborhoods":["المزة"],"zoneType":"URBAN_OUTER","surchargeUsdCents":50}' >/dev/null

# زبونٌ جديد لكل تشغيل: سقف الطلبات المفتوحة قاعدةٌ حقيقية لا عائق
# فحص، وإعادة استعمال رقمٍ واحد تجعل التشغيل الثالث يفشل بحقّ.
CUST="+96394$(printf '%07d' $((RANDOM * RANDOM % 10000000)))"
UT=$(tok "$CUST"); UH="authorization: Bearer $UT"

# الفحص يهيّئ مخزونه: تشغيلٌ متكرر يستهلك البضاعة، وفحصٌ يعتمد
# على ما خلّفه سابقه ليس فحصاً بل صدفة.
N=6
if true; then
  # التحويل إلى منتج حقيقي أولاً: المنتج التجريبي لا يَستلم بضاعة ولا
  # يُطلَب، وكان الفحص يفترض أن أحداً حوّله يدوياً قبله — فيمرّ عند من
  # فعل ذلك ويفشل على قاعدة نظيفة. الفحص يهيّئ شرطه بنفسه.
  curl -s -X POST "$API/admin/catalog/products/samsung-galaxy-a35/promote" -H "$AH" > /dev/null

  # المورد كيانٌ له صفّه: أمر الشراء يشير إليه برمزه لا باسم نصّي
  curl -s -X POST "$API/admin/procurement/suppliers" -H "$AH" -H 'content-type: application/json' \
    -d '{"code":"E2E","name":"مورد تهيئة الفحص","leadTimeDays":7}' > /dev/null
  PO=$(curl -s -X POST "$API/admin/procurement/purchase-orders" -H "$AH" -H 'content-type: application/json' \
    -d "{\"supplierCode\":\"E2E\",\"lines\":[{\"sku\":\"$SKU\",\"qty\":$N,\"unitCostUsdCents\":21000}],\"extraUsdCents\":0}")
  PN=$(echo "$PO"|grep -o '"poNo":"[^"]*"'|cut -d'"' -f4)
  IMEIS=$(python3 - "$N" "$RANDOM" <<'PYIN'
import sys
# أرقام IMEI صالحة بخوارزمية Luhn تُولَّد لتهيئة الفحص
def luhn(base):
    d=[int(c) for c in base]; s=0
    for i,x in enumerate(reversed(d)):
        if i%2==0: x*=2; x-=9 if x>9 else 0
        s+=x
    return base+str((10-s%10)%10)
# قاعدة متغيّرة لكل تشغيل: IMEI فريد عالمياً، وتكرارُه يرفضه الاستلام
n=int(sys.argv[1]); base=35693800000000 + int(sys.argv[2]) * 100
print(",".join('"%s"' % luhn(str(base + i).ljust(14, '0')[:14]) for i in range(n)))
PYIN
)
  curl -s -X POST "$API/admin/procurement/purchase-orders/$PN/receive" -H "$AH" -H 'content-type: application/json' \
    -d "{\"receipts\":[{\"sku\":\"$SKU\",\"imeis\":[$IMEIS],\"unitCostUsdCents\":21000}]}" >/dev/null
  echo "  (هُيِّئ المخزون: +$N)"
fi


# رقم جهازٍ متاح على الرفّ للصنف المستعمل في الفحص.
# التحصيل صار يلزمه رقم كل جهاز يُسلَّم: كان الخادم يختار من الرفّ بترتيب
# المعرّف أياً كان الجهاز الذي وُضع في يد الزبون، فتُفعَّل الكفالة على
# غير جهازه. والفحص يمرّ من حيث يمرّ المندوب.
onshelf() { dbq "select du.imei from device_units du join product_variants v on v.id=du.variant_id where v.sku='$SKU' and du.state='IN_STOCK' limit 1"; }

echo "══ الكوبونات ══"
R=$(curl -s -X POST $API/admin/coupons -H "$AH" -H 'content-type: application/json' \
 -d '{"code":"sham10","type":"PERCENTAGE","value":10,"maxDiscountUsdCents":2500,"minSubtotalUsdCents":8000,"usageLimitPerCustomer":1}')
chk "إنشاء كوبون" "$R" 'SHAM10'
chk "رمز غير صالح مرفوض" "$(curl -s -X POST $API/admin/coupons -H "$AH" -H 'content-type: application/json' -d '{"code":"a b","type":"PERCENTAGE","value":10}')" 'COUPON_CODE_INVALID'
chk "نسبة خارج المدى مرفوضة" "$(curl -s -X POST $API/admin/coupons -H "$AH" -H 'content-type: application/json' -d '{"code":"BAD1","type":"PERCENTAGE","value":150}')" 'COUPON_VALUE_INVALID'
chk "سقف الخصم مُطبَّق (10% من 500$=50$ ← سقف 25$)" "$(curl -s -X POST $API/coupons/preview -H 'content-type: application/json' -d '{"code":"SHAM10","subtotalUsdCents":50000}')" '"discountUsdCents":2500'
chk "حد أدنى غير مستوفٍ" "$(curl -s -X POST $API/coupons/preview -H 'content-type: application/json' -d '{"code":"SHAM10","subtotalUsdCents":5000}')" 'COUPON_MIN_SUBTOTAL'
chk "رمز مجهول" "$(curl -s -X POST $API/coupons/preview -H 'content-type: application/json' -d '{"code":"NOPE","subtotalUsdCents":50000}')" 'COUPON_INVALID'

echo "══ التنبيهات ══"
chk "تنبيه توفّر لمنتج متوفر مرفوض" "$(curl -s -X POST $API/alerts/stock -H 'content-type: application/json' -d "{\"sku\":\"$SKU\",\"phone\":\"$CUST\"}")" 'ALREADY_AVAILABLE'
chk "تنبيه سعر بلا حساب مرفوض" "$(curl -s -X POST $API/alerts/price -H 'content-type: application/json' -d "{\"sku\":\"$SKU\"}")" 'AUTH_REQUIRED'
chk "تنبيه سعر بحساب" "$(curl -s -X POST $API/alerts/price -H "$UH" -H 'content-type: application/json' -d "{\"sku\":\"$SKU\",\"thresholdBp\":300}")" 'subscribed'

echo "══ التذاكر ══"
T=$(curl -s -X POST $API/support/tickets -H "$UH" -H 'content-type: application/json' \
 -d "{\"phone\":\"$CUST\",\"contactReason\":\"WHERE_IS_MY_ORDER\",\"subject\":\"أين طلبي\",\"body\":\"مضى يومان ولم يصل\",\"priority\":\"HIGH\"}")
chk "فتح تذكرة" "$T" 'TK-'
TN=$(echo "$T"|grep -o 'TK-[0-9-]*')
chk "رقم غير سوري مرفوض" "$(curl -s -X POST $API/support/tickets -H 'content-type: application/json' -d '{"phone":"+966500000000","contactReason":"X","body":"y"}')" 'PHONE_INVALID'
chk "قائمة الوكيل" "$(curl -s "$API/admin/tickets" -H "$AH")" "$TN"
chk "ملاحظة داخلية" "$(curl -s -X POST "$API/admin/tickets/$TN/reply" -H "$AH" -H 'content-type: application/json' -d '{"body":"راجعت الشحنة","internal":true}')" '"internal":true'
chk "رد على العميل" "$(curl -s -X POST "$API/admin/tickets/$TN/reply" -H "$AH" -H 'content-type: application/json' -d '{"body":"طلبك خرج للتوصيل اليوم"}')" '"replied":true'
chk "العميل لا يرى الملاحظة الداخلية" "$(curl -s "$API/support/tickets/$TN" -H "$UH" | grep -c 'راجعت الشحنة')" '^0$'
chk "الحل" "$(curl -s -X POST "$API/admin/tickets/$TN/transition" -H "$AH" -H 'content-type: application/json' -d '{"to":"RESOLVED"}')" 'RESOLVED'
chk "تقييم الخدمة" "$(curl -s -X POST "$API/support/tickets/$TN/csat" -H 'content-type: application/json' -d '{"score":5}')" 'recorded'
chk "المؤشرات" "$(curl -s "$API/admin/tickets/metrics" -H "$AH")" 'frtMedianMinutes'
chk "تقييم خارج المدى مرفوض" "$(curl -s -X POST "$API/support/tickets/$TN/csat" -H 'content-type: application/json' -d '{"score":9}')" 'SCORE_INVALID'

echo "══ أجر التوصيل بمناطقه ══"
CZ=$(curl -s -X POST $API/carts|grep -o '"cartToken":"[^"]*"'|cut -d'"' -f4)
curl -s -X POST $API/carts/$CZ/items -H 'content-type: application/json' -d "{\"sku\":\"$SKU\",\"qty\":1}" >/dev/null
# بلا عنوان: الأساس وحده، ومعلَّمٌ تقديراً
chk "بلا عنوان: تقديرٌ بالأساس" "$(curl -s "$API/carts/$CZ")" '"shippingUsdCents":200'
# بحيٍّ مسجَّل: الأساس + فارق المنطقة، ولا تقدير
ZQ=$(curl -s "$API/carts/$CZ?governorate=DAMASCUS&neighborhood=%D8%A7%D9%84%D9%85%D8%B2%D8%A9")
chk "حيٌّ مسجَّل: الأساس + الفارق" "$ZQ" '"shippingUsdCents":250'
chk "المنطقة تُسمّى ولا تُقدَّر" "$ZQ" '"estimated":false'
# حيٌّ مجهول في المحافظة: أعلى تقديرٍ فيها لا صفر — التقدير الناقص وعدٌ لا يُوفى
chk "حيٌّ مجهول: أعلى تقدير للمحافظة" "$(curl -s "$API/carts/$CZ?governorate=DAMASCUS&neighborhood=zzz")" '"shippingUsdCents":250'

echo "══ الدورة الكاملة: طلب ← تسليم ← تسوية ← إرجاع ══"
C=$(curl -s -X POST $API/carts|grep -o '"cartToken":"[^"]*"'|cut -d'"' -f4)
curl -s -X POST $API/carts/$C/items -H 'content-type: application/json' -d "{\"sku\":\"$SKU\",\"qty\":1}" >/dev/null
O=$(curl -s -X POST $API/orders -H "$UH" -H 'content-type: application/json' -H "idempotency-key: t-$RANDOM" \
 -d "{\"cartToken\":\"$C\",\"address\":{\"recipientName\":\"سامر\",\"governorate\":\"DAMASCUS\",\"city\":\"دمشق\",\"neighborhood\":\"المزة\",\"landmark\":\"مقابل الصيدلية\",\"phone\":\"$CUST\"}}")
NO=$(echo "$O"|grep -o '"orderNo":"[^"]*"'|cut -d'"' -f4); DUE=$(echo "$O"|grep -o '"cashDueSyp":[0-9]*'|cut -d: -f2)
chk "إنشاء الطلب" "$O" 'TS-'
# والطلب يُسعَّر بما رأته السلة: الرقمان من دالة واحدة، فلا يفترقان
chk "الطلب يحمل فارق المنطقة نفسه" \
  "$(dbq "SELECT shipping_total_usd_cents FROM orders WHERE order_no='$NO'")" '^250$'
curl -s -X POST "$API/admin/orders/$NO/confirm" -H "$AH" -H 'content-type: application/json' -d '{"outcome":"CONFIRMED"}' >/dev/null
chk "التصرّف بطلبٍ غير مُسنَد مرفوض" "$(curl -s -X POST "$API/courier/orders/$NO/status" -H "$CH" -H 'content-type: application/json' -d '{"to":"SHIPPED"}')" 'NOT_YOUR_ORDER'
chk "المطالبة بطلبٍ في منطقته" "$(curl -s -X POST "$API/courier/orders/$NO/claim" -H "$CH")" '"assigned":true'
curl -s -X POST "$API/courier/orders/$NO/status" -H "$CH" -H 'content-type: application/json' -d '{"to":"SHIPPED"}' >/dev/null
curl -s -X POST "$API/courier/orders/$NO/status" -H "$CH" -H 'content-type: application/json' -d '{"to":"OUT_FOR_DELIVERY"}' >/dev/null

IM=$(onshelf)
chk "تحصيل بلا رقم جهاز مرفوض" "$(curl -s -X POST "$API/courier/orders/$NO/collect" -H "$CH" -H 'content-type: application/json' -H "idempotency-key: noimei-$RANDOM" -d "{\"amountSyp\":$DUE}")" 'IMEI_REQUIRED'
chk "رقم جهاز غير مسجَّل مرفوض" "$(curl -s -X POST "$API/courier/orders/$NO/collect" -H "$CH" -H 'content-type: application/json' -H "idempotency-key: badimei-$RANDOM" -d "{\"amountSyp\":$DUE,\"imeis\":[\"999999999999999\"]}")" 'IMEI_UNKNOWN'
chk "تحصيل أكثر من المستحق مرفوض" "$(curl -s -X POST "$API/courier/orders/$NO/collect" -H "$CH" -H 'content-type: application/json' -H "idempotency-key: over-$RANDOM" -d "{\"amountSyp\":$((DUE+1000)),\"imeis\":[\"$IM\"]}")" 'OVERCOLLECTION'
chk "تحصيل جزئي بلا سبب مرفوض" "$(curl -s -X POST "$API/courier/orders/$NO/collect" -H "$CH" -H 'content-type: application/json' -H "idempotency-key: part-$RANDOM" -d "{\"amountSyp\":$((DUE-500)),\"imeis\":[\"$IM\"]}")" 'PARTIAL_REASON_REQUIRED'
chk "التحصيل الكامل برقم الجهاز" "$(curl -s -X POST "$API/courier/orders/$NO/collect" -H "$CH" -H 'content-type: application/json' -H "idempotency-key: full-$RANDOM" -d "{\"amountSyp\":$DUE,\"imeis\":[\"$IM\"]}")" 'COLLECTED'
# الجهاز المسجَّل على السطر هو الذي أُدخل رقمه، لا أوّل ما في الرفّ
chk "الجهاز المسجَّل هو المُدخَل" "$(dbq "select du.imei from device_units du join order_items oi on oi.id=du.order_item_id join orders o on o.id=oi.order_id where o.order_no='$NO'")" "$IM"

echo "══ التسوية ══"
S=$(curl -s "$API/admin/settlements" -H "$AH")
chk "صف التسوية أُنشئ" "$S" '"collectedSyp"'
# صفٌّ مفتوح لا الأحدث مطلقاً: تشغيلٌ سابق قد يكون أقفل صف اليوم
SID=$(curl -s "$API/admin/settlements?state=OPEN" -H "$AH"|grep -o '"id":"[^"]*"'|head -1|cut -d'"' -f4)
echo "  المطابقة: $(curl -s "$API/admin/settlements/$SID" -H "$AH" | grep -o '"varianceSyp":[-0-9]*\|"netDueSyp":[0-9]*\|"commissionSyp":[0-9]*' | tr '\n' ' ')"
chk "المطابقة تنجح" "$(curl -s -X POST "$API/admin/settlements/$SID/reconcile" -H "$AH")" '"state":"RECONCILED"'
chk "المحصِّل لا يطابق تسويته" "$(curl -s -X POST "$API/admin/settlements/$SID/reconcile" -H "$CH")" 'FORBIDDEN\|SEGREGATION'
chk "الإقفال" "$(curl -s -X POST "$API/admin/settlements/$SID/settle" -H "$AH")" '"state":"SETTLED"'
chk "تقرير التحصيل" "$(curl -s "$API/admin/settlements/report" -H "$AH")" 'netDueSyp'

echo "══ الإرجاع ══"
chk "إرجاع بلا إثبات ملكية مرفوض" "$(curl -s -X POST $API/returns -H 'content-type: application/json' -d "{\"orderNo\":\"$NO\",\"reason\":\"CHANGED_MIND\"}")" 'NOT_YOUR_ORDER'
RQ=$(curl -s -X POST $API/returns -H "$UH" -H 'content-type: application/json' -d "{\"orderNo\":\"$NO\",\"reason\":\"NOT_AS_DESCRIBED\",\"note\":\"اللون مختلف\"}")
chk "فتح إرجاع" "$RQ" 'RT-'
RN=$(echo "$RQ"|grep -o 'RT-[0-9-]*')
chk "إرجاع ثانٍ مرفوض" "$(curl -s -X POST $API/returns -H "$UH" -H 'content-type: application/json' -d "{\"orderNo\":\"$NO\",\"reason\":\"CHANGED_MIND\"}")" 'RETURN_ALREADY_OPEN'
chk "قفزة حالة مرفوضة" "$(curl -s -X POST "$API/admin/returns/$RN/transition" -H "$AH" -H 'content-type: application/json' -d '{"to":"COMPLETED"}')" 'INVALID_TRANSITION'
chk "رفض بلا سبب مرفوض" "$(curl -s -X POST "$API/admin/returns/$RN/transition" -H "$AH" -H 'content-type: application/json' -d '{"to":"REJECTED"}')" 'REJECT_REASON_REQUIRED'
curl -s -X POST "$API/admin/returns/$RN/transition" -H "$AH" -H 'content-type: application/json' -d '{"to":"APPROVED"}' >/dev/null
curl -s -X POST "$API/admin/returns/$RN/transition" -H "$AH" -H 'content-type: application/json' -d '{"to":"PICKUP_SCHEDULED"}' >/dev/null
curl -s -X POST "$API/admin/returns/$RN/transition" -H "$AH" -H 'content-type: application/json' -d '{"to":"RECEIVED"}' >/dev/null
chk "IMEI غير مطابق يرفض الإرجاع" "$(curl -s -X POST "$API/admin/returns/$RN/transition" -H "$AH" -H 'content-type: application/json' -d '{"to":"INSPECTED","imei":"356938035643809"}')" 'IMEI_MISMATCH'

echo ""
echo "  المخزون بعد الرفض: on_hand=$(dbq "select on_hand from inventory_levels l join product_variants v on v.id=l.variant_id where v.sku='$SKU'")"

echo "══ إرجاع ناجح: IMEI مطابق ← إعادة للرفّ ← استرداد ══"
C2=$(curl -s -X POST $API/carts|grep -o '"cartToken":"[^"]*"'|cut -d'"' -f4)
curl -s -X POST $API/carts/$C2/items -H 'content-type: application/json' -d "{\"sku\":\"$SKU\",\"qty\":1}" >/dev/null
O2=$(curl -s -X POST $API/orders -H "$UH" -H 'content-type: application/json' -H "idempotency-key: t2-$RANDOM" \
 -d "{\"cartToken\":\"$C2\",\"address\":{\"recipientName\":\"سامر\",\"governorate\":\"DAMASCUS\",\"city\":\"دمشق\",\"neighborhood\":\"المزة\",\"landmark\":\"مقابل الصيدلية\",\"phone\":\"$CUST\"}}")
N2=$(echo "$O2"|grep -o '"orderNo":"[^"]*"'|cut -d'"' -f4); D2=$(echo "$O2"|grep -o '"cashDueSyp":[0-9]*'|cut -d: -f2)
curl -s -X POST "$API/admin/orders/$N2/confirm" -H "$AH" -H 'content-type: application/json' -d '{"outcome":"CONFIRMED"}' >/dev/null
curl -s -X POST "$API/courier/orders/$N2/claim" -H "$CH" >/dev/null
curl -s -X POST "$API/courier/orders/$N2/status" -H "$CH" -H 'content-type: application/json' -d '{"to":"SHIPPED"}' >/dev/null
curl -s -X POST "$API/courier/orders/$N2/status" -H "$CH" -H 'content-type: application/json' -d '{"to":"OUT_FOR_DELIVERY"}' >/dev/null
I2=$(onshelf)
curl -s -X POST "$API/courier/orders/$N2/collect" -H "$CH" -H 'content-type: application/json' -H "idempotency-key: f2-$RANDOM" -d "{\"amountSyp\":$D2,\"imeis\":[\"$I2\"]}" >/dev/null
BEFORE=$(dbq "select on_hand from inventory_levels l join product_variants v on v.id=l.variant_id where v.sku='$SKU'")
IMEI=$(dbq "select du.imei from device_units du join order_items oi on oi.id=du.order_item_id join orders o on o.id=oi.order_id where o.order_no='$N2'")
echo "  المخزون بعد البيع: $BEFORE · IMEI المُباع: $IMEI"
R2=$(curl -s -X POST $API/returns -H "$UH" -H 'content-type: application/json' -d "{\"orderNo\":\"$N2\",\"reason\":\"DEFECTIVE\",\"imei\":\"$IMEI\"}")
RN2=$(echo "$R2"|grep -o 'RT-[0-9-]*')
for st in APPROVED PICKUP_SCHEDULED RECEIVED; do
  curl -s -X POST "$API/admin/returns/$RN2/transition" -H "$AH" -H 'content-type: application/json' -d "{\"to\":\"$st\"}" >/dev/null; done
chk "الفحص بـIMEI مطابق" "$(curl -s -X POST "$API/admin/returns/$RN2/transition" -H "$AH" -H 'content-type: application/json' -d "{\"to\":\"INSPECTED\",\"imei\":\"$IMEI\",\"note\":\"العلبة كاملة\"}")" '"imeiMatched":true'
chk "الاكتمال" "$(curl -s -X POST "$API/admin/returns/$RN2/transition" -H "$AH" -H 'content-type: application/json' -d '{"to":"COMPLETED"}')" '"state":"COMPLETED"'
AFTER=$(dbq "select on_hand from inventory_levels l join product_variants v on v.id=l.variant_id where v.sku='$SKU'")
if [ "$AFTER" -eq $((BEFORE+1)) ]; then ok "الجهاز عاد للرفّ ($BEFORE ← $AFTER)"; else no "الرفّ" "$BEFORE ← $AFTER"; fi
chk "الوحدة عادت IN_STOCK" "$(dbq "select state from device_units where imei='$IMEI'")" 'IN_STOCK'
chk "أُنشئ استرداد" "$(curl -s "$API/returns/$RN2")" '"amountSyp"'
chk "الصرف قبل الاكتمال ممنوع لطلب آخر" "$(curl -s -X POST "$API/admin/returns/$RN/disburse" -H "$AH" -H 'content-type: application/json' -d '{}')" 'NOT_FOUND\|RETURN_NOT_COMPLETED'
chk "صرف النقد" "$(curl -s -X POST "$API/admin/returns/$RN2/disburse" -H "$AH" -H 'content-type: application/json' -d '{"note":"نقداً من المعرض"}')" 'DISBURSED'
chk "الصرف مرتين ممنوع" "$(curl -s -X POST "$API/admin/returns/$RN2/disburse" -H "$AH" -H 'content-type: application/json' -d '{}')" 'INVALID_TRANSITION'
chk "حالة الطلب صارت RETURNED" "$(dbq "select status, payment_status from orders where order_no='$N2'")" 'RETURNED REFUNDED'

echo "══ صندوق الإشعارات ══"
# القناة الوحيدة التي لا تحتاج مزوّداً: واتساب التجاري ممنوع على سوريا،
# ولا مزوّد SMS مضبوطاً، وكلاهما يُرجع ok وهو محاكاة. فإن لم يصل الإشعار
# إلى الصندوق لم يصل إلى أي مكان.
NB=$(curl -s "$API/me/notifications" -H "$UH")
chk "الصندوق يُقرأ" "$NB" '"items"'
chk "إشعار الطلب محفوظ" "$NB" 'استلمنا طلبك'
chk "وله وجهة تُنقر" "$NB" '"href":"/app/orders/'
NID=$(echo "$NB"|grep -o '"id":"[^"]*"'|head -1|cut -d'"' -f4)
chk "التعليم بالقراءة" "$(curl -s -X POST "$API/me/notifications/$NID/read" -H "$UH")" '"read":true'
chk "تعليم الكل" "$(curl -s -X POST "$API/me/notifications/read-all" -H "$UH")" '"read":'
chk "غير المقروء صار صفراً" "$(curl -s "$API/me/notifications" -H "$UH")" '"unread":0'
# صندوق غيري ليس صندوقي: التعليم مشروطٌ بالهوية لا بالمعرّف وحده
chk "لا أعلّم إشعار غيري" "$(curl -s -X POST "$API/me/notifications/$NID/read" -H "authorization: Bearer $CT")" '"read":false'
# ورمز الدخول لا يُحفظ: الصندوق لا يُقرأ إلا بعد الدخول، وحفظُه يترك سرّاً مكتوباً
chk "رمز الدخول لا يدخل الصندوق" "$(curl -s "$API/me/notifications" -H "$UH" | grep -c 'رمز الدخول')" '^0$'
# ومنعُ التكرار لا يمنع رمزاً ثانياً — وإلا لم يدخل أحدٌ مرتين في يوم
T2=$(tok "$CUST")
chk "رمز دخولٍ ثانٍ يصدر في اليوم نفسه" "$([ -n "$T2" ] && echo OK)" 'OK'

echo "══ سلامة الثوابت ══"
DRIFT=$(dbq "select count(*) from inventory_levels l where l.reserved <> coalesce((select sum(qty) from inventory_reservations r where r.variant_id=l.variant_id and r.warehouse_id=l.warehouse_id),0)")
[ "$DRIFT" = "0" ] && ok "لا انحراف في عدّاد الحجز" || no "انحراف الحجز" "$DRIFT"
MIS=$(dbq "select count(*) from inventory_levels l where (select count(*) from device_units d where d.variant_id=l.variant_id and d.warehouse_id=l.warehouse_id and d.state='IN_STOCK')>0 and (select count(*) from device_units d where d.variant_id=l.variant_id and d.warehouse_id=l.warehouse_id and d.state='IN_STOCK') <> l.on_hand")
[ "$MIS" = "0" ] && ok "الوحدات تطابق on_hand" || no "تطابق الوحدات" "$MIS"
