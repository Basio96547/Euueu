-- قيود لا يعبّر عنها Prisma — تُطبَّق يدوياً بعد كل ترحيل
-- المرجع: الفصل 3

-- ——— صيغة رقم الطلب ———
ALTER TABLE orders
  ADD CONSTRAINT orders_order_no_format
  CHECK (order_no ~ '^TS-[0-9]{4}-[0-9]{6}$');

-- ——— المبالغ غير سالبة، والمبلغ النقدي مقرَّب لأقرب 1000 ———
ALTER TABLE orders ADD CONSTRAINT orders_total_nonneg CHECK (total_usd_cents >= 0);
ALTER TABLE orders ADD CONSTRAINT orders_cash_rounded CHECK (total_syp % 1000 = 0);
ALTER TABLE orders ADD CONSTRAINT orders_tax_bp_range CHECK (tax_rate_bp BETWEEN 0 AND 10000);
ALTER TABLE orders ADD CONSTRAINT orders_confirm_attempts CHECK (confirmation_attempts <= 3);
ALTER TABLE orders ADD CONSTRAINT orders_collected_requires_time
  CHECK (payment_status <> 'COLLECTED' OR collected_at IS NOT NULL);

-- ——— أرقام الجوال السورية ———
ALTER TABLE users ADD CONSTRAINT users_phone_sy CHECK (phone_e164 ~ '^\+9639[0-9]{8}$');
ALTER TABLE addresses ADD CONSTRAINT addresses_phone_sy CHECK (phone ~ '^\+9639[0-9]{8}$');
ALTER TABLE addresses ADD CONSTRAINT addresses_landmark_len CHECK (length(landmark) >= 3);

-- ——— فروق السوق على مستوى المتغيّر ———
ALTER TABLE product_variants ADD CONSTRAINT variants_price_nonneg CHECK (price_usd_cents >= 0);
ALTER TABLE product_variants ADD CONSTRAINT variants_sim_exclusive CHECK (NOT (dual_sim AND esim_only));
ALTER TABLE product_variants ADD CONSTRAINT variants_part_code_format
  CHECK (part_code IS NULL OR part_code ~ '^[A-Z]{2}/A$');
-- صحة البطارية إلزامية لغير الجديد
ALTER TABLE product_variants ADD CONSTRAINT variants_battery_required
  CHECK (condition = 'NEW' OR battery_health_pct BETWEEN 1 AND 100);
ALTER TABLE product_variants ADD CONSTRAINT variants_warranty_months CHECK (warranty_months >= 0);

-- ——— سعر الصرف: التقادم ليس حالة مسموحة ———
ALTER TABLE fx_rates ADD CONSTRAINT fx_rate_positive CHECK (rate > 0);
ALTER TABLE fx_rates ADD CONSTRAINT fx_valid_window CHECK (valid_until > effective_from);

-- ——— المخزون: المتاح لا يكون سالباً ———
ALTER TABLE inventory_levels ADD CONSTRAINT inv_nonneg CHECK (on_hand >= 0 AND reserved >= 0);
ALTER TABLE inventory_levels ADD CONSTRAINT inv_reserved_le_onhand CHECK (reserved <= on_hand);

-- ===========================================================
-- المحفِّز الحاسم: تطابق وحدات الأجهزة مع عدّاد المخزون
-- مؤجَّل إلى نهاية المعاملة، فتفشل المعاملة كلها عند الانحراف.
-- الاعتماد على مهمة أسبوعية يعني اكتشاف البيع الزائد بعد أسبوع.
-- ===========================================================

CREATE OR REPLACE FUNCTION assert_units_match_levels() RETURNS TRIGGER AS $$
DECLARE
  v_variant UUID;
  v_wh      UUID;
  v_units   INT;
  v_onhand  INT;
BEGIN
  v_variant := COALESCE(NEW.variant_id, OLD.variant_id);
  v_wh      := COALESCE(NEW.warehouse_id, OLD.warehouse_id);

  SELECT count(*) INTO v_units
    FROM device_units
   WHERE variant_id = v_variant AND warehouse_id = v_wh AND state = 'IN_STOCK';

  SELECT on_hand INTO v_onhand
    FROM inventory_levels
   WHERE variant_id = v_variant AND warehouse_id = v_wh;

  -- الملحقات لا صفوف لها في device_units، فيُتجاهل الفحص عند غياب أي وحدة
  IF v_onhand IS NOT NULL AND v_units > 0 AND v_units <> v_onhand THEN
    RAISE EXCEPTION
      'انحراف مخزون: % وحدة بحالة IN_STOCK مقابل on_hand = % للمتغيّر %',
      v_units, v_onhand, v_variant;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_units_match_levels
  AFTER INSERT OR UPDATE OR DELETE ON device_units
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_units_match_levels();
