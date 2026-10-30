-- Eine Vorgabewährung statt dreier: Der Server liest die Währung eines
-- Kontos als Einstellung des Kontos, sonst der Installation, sonst EUR
-- (utils/settings.ts getSetting). Der Trigger der Erfassungen kannte nur das
-- Konto und EUR, die Gutscheine standen fest auf CHF. Beides folgt jetzt
-- derselben Regel; im Haushalt ist die Währung ohnehin für alle gleich
-- (setzeHaushaltswaehrung).
CREATE OR REPLACE FUNCTION konto_waehrung(uid integer) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT NULLIF(value, '') FROM user_settings WHERE user_id = uid AND key = 'currency'),
    (SELECT NULLIF(value, '') FROM global_settings WHERE key = 'currency'),
    'EUR')
$$;

CREATE OR REPLACE FUNCTION erfassung_waehrung() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.currency IS NULL THEN
    NEW.currency := konto_waehrung(NEW.user_id);
  END IF;
  RETURN NEW;
END $$;

ALTER TABLE vouchers ALTER COLUMN currency DROP DEFAULT;
CREATE TRIGGER vouchers_waehrung BEFORE INSERT OR UPDATE ON vouchers
  FOR EACH ROW EXECUTE FUNCTION erfassung_waehrung();

-- Preis-Caches und -Verläufe gehören keinem Konto; ihre Währung ist die der
-- Abfrage und steht in jedem Schreiber. Eine Vorgabe EUR würde einen
-- vergessenen Wert still als Euro ablegen.
ALTER TABLE price_cache          ALTER COLUMN currency_code DROP DEFAULT;
ALTER TABLE price_history        ALTER COLUMN currency_code DROP DEFAULT;
ALTER TABLE part_price_cache     ALTER COLUMN currency_code DROP DEFAULT;
ALTER TABLE part_price_history   ALTER COLUMN currency_code DROP DEFAULT;
ALTER TABLE minifig_price_cache  ALTER COLUMN currency_code DROP DEFAULT;
ALTER TABLE minifig_price_history ALTER COLUMN currency_code DROP DEFAULT;
