-- users_email_key (UNIQUE) deckt users_email_unique schon ab: NULL ist in
-- PostgreSQL nie doppelt, der Teilindex prüfte dasselbe ein zweites Mal.
DROP INDEX IF EXISTS users_email_unique;

-- Währung als ISO-Code, Beträge nie negativ. NOT VALID prüft jede neue oder
-- geänderte Zeile; den Altbestand prüft der Block darunter nur, wo er
-- sauber ist — ein Update soll nicht an einer alten Zeile scheitern.

ALTER TABLE minifig_acquisitions ADD CONSTRAINT minifig_acquisitions_currency_iso CHECK (currency ~ '^[A-Z]{3}$') NOT VALID;
ALTER TABLE part_acquisitions ADD CONSTRAINT part_acquisitions_currency_iso CHECK (currency ~ '^[A-Z]{3}$') NOT VALID;
ALTER TABLE set_acquisitions ADD CONSTRAINT set_acquisitions_currency_iso CHECK (currency ~ '^[A-Z]{3}$') NOT VALID;
ALTER TABLE vouchers ADD CONSTRAINT vouchers_currency_iso CHECK (currency ~ '^[A-Z]{3}$') NOT VALID;
ALTER TABLE minifig_price_cache ADD CONSTRAINT minifig_price_cache_currency_code_iso CHECK (currency_code ~ '^[A-Z]{3}$') NOT VALID;
ALTER TABLE minifig_price_history ADD CONSTRAINT minifig_price_history_currency_code_iso CHECK (currency_code ~ '^[A-Z]{3}$') NOT VALID;
ALTER TABLE part_price_cache ADD CONSTRAINT part_price_cache_currency_code_iso CHECK (currency_code ~ '^[A-Z]{3}$') NOT VALID;
ALTER TABLE part_price_history ADD CONSTRAINT part_price_history_currency_code_iso CHECK (currency_code ~ '^[A-Z]{3}$') NOT VALID;
ALTER TABLE price_alerts ADD CONSTRAINT price_alerts_currency_code_iso CHECK (currency_code ~ '^[A-Z]{3}$') NOT VALID;
ALTER TABLE price_cache ADD CONSTRAINT price_cache_currency_code_iso CHECK (currency_code ~ '^[A-Z]{3}$') NOT VALID;
ALTER TABLE price_history ADD CONSTRAINT price_history_currency_code_iso CHECK (currency_code ~ '^[A-Z]{3}$') NOT VALID;
ALTER TABLE minifig_acquisitions ADD CONSTRAINT minifig_acquisitions_unit_price_nicht_negativ CHECK (unit_price >= 0) NOT VALID;
ALTER TABLE part_acquisitions ADD CONSTRAINT part_acquisitions_unit_price_nicht_negativ CHECK (unit_price >= 0) NOT VALID;
ALTER TABLE set_acquisitions ADD CONSTRAINT set_acquisitions_purchase_price_nicht_negativ CHECK (purchase_price >= 0) NOT VALID;
ALTER TABLE vouchers ADD CONSTRAINT vouchers_amount_nicht_negativ CHECK (amount >= 0) NOT VALID;
ALTER TABLE minifig_price_cache ADD CONSTRAINT minifig_price_cache_avg_price_nicht_negativ CHECK (avg_price >= 0) NOT VALID;
ALTER TABLE minifig_price_cache ADD CONSTRAINT minifig_price_cache_qty_avg_price_nicht_negativ CHECK (qty_avg_price >= 0) NOT VALID;
ALTER TABLE minifig_price_history ADD CONSTRAINT minifig_price_history_avg_price_nicht_negativ CHECK (avg_price >= 0) NOT VALID;
ALTER TABLE minifig_price_history ADD CONSTRAINT minifig_price_history_qty_avg_price_nicht_negativ CHECK (qty_avg_price >= 0) NOT VALID;
ALTER TABLE part_price_cache ADD CONSTRAINT part_price_cache_avg_price_nicht_negativ CHECK (avg_price >= 0) NOT VALID;
ALTER TABLE part_price_cache ADD CONSTRAINT part_price_cache_qty_avg_price_nicht_negativ CHECK (qty_avg_price >= 0) NOT VALID;
ALTER TABLE part_price_history ADD CONSTRAINT part_price_history_avg_price_nicht_negativ CHECK (avg_price >= 0) NOT VALID;
ALTER TABLE part_price_history ADD CONSTRAINT part_price_history_qty_avg_price_nicht_negativ CHECK (qty_avg_price >= 0) NOT VALID;
ALTER TABLE price_cache ADD CONSTRAINT price_cache_avg_price_nicht_negativ CHECK (avg_price >= 0) NOT VALID;
ALTER TABLE price_cache ADD CONSTRAINT price_cache_qty_avg_price_nicht_negativ CHECK (qty_avg_price >= 0) NOT VALID;
ALTER TABLE price_cache ADD CONSTRAINT price_cache_min_price_nicht_negativ CHECK (min_price >= 0) NOT VALID;
ALTER TABLE price_cache ADD CONSTRAINT price_cache_max_price_nicht_negativ CHECK (max_price >= 0) NOT VALID;
ALTER TABLE price_history ADD CONSTRAINT price_history_avg_price_nicht_negativ CHECK (avg_price >= 0) NOT VALID;
ALTER TABLE price_history ADD CONSTRAINT price_history_qty_avg_price_nicht_negativ CHECK (qty_avg_price >= 0) NOT VALID;
ALTER TABLE price_history ADD CONSTRAINT price_history_min_price_nicht_negativ CHECK (min_price >= 0) NOT VALID;
ALTER TABLE price_history ADD CONSTRAINT price_history_max_price_nicht_negativ CHECK (max_price >= 0) NOT VALID;

DO $$
DECLARE k RECORD;
BEGIN
  FOR k IN SELECT conrelid::regclass AS tab, conname FROM pg_constraint
            WHERE NOT convalidated AND (conname LIKE '%\_iso' OR conname LIKE '%\_nicht\_negativ') LOOP
    BEGIN
      EXECUTE format('ALTER TABLE %s VALIDATE CONSTRAINT %I', k.tab, k.conname);
    EXCEPTION WHEN check_violation THEN
      RAISE NOTICE 'Altbestand verletzt %: neue Zeilen werden geprüft, alte bleiben', k.conname;
    END;
  END LOOP;
END $$;
