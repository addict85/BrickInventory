-- The remaining stored values of API v2 in English: announced admin actions, alert directions,
-- passkey challenge purposes, price corrections of waiting wanted-list imports, admin log actions
-- and the setting key of the voucher country. API v1 shows the former values through its mapping
-- (src/contract/v1Names.ts). The tables are locked so that no old process writes a German value
-- in between; afterwards the checks reject them.
LOCK TABLE admin_takeovers, price_alerts, webauthn_challenges, jobs, admin_log, global_settings IN ACCESS EXCLUSIVE MODE;

ALTER TABLE admin_takeovers DROP CONSTRAINT admin_takeovers_type_check;
ALTER TABLE admin_takeovers DROP CONSTRAINT admin_takeovers_check;
UPDATE admin_takeovers SET type = CASE type
  WHEN 'passwort' THEN 'password' WHEN 'zweiter_faktor' THEN 'second_factor' WHEN 'deaktivieren' THEN 'deactivate'
  WHEN 'rolle_entziehen' THEN 'revoke_role' WHEN 'loeschen' THEN 'delete' ELSE type END;
ALTER TABLE admin_takeovers ADD CONSTRAINT admin_takeovers_type_check
  CHECK (type IN ('password', 'second_factor', 'deactivate', 'revoke_role', 'delete'));
ALTER TABLE admin_takeovers ADD CONSTRAINT admin_takeovers_check CHECK ((type = 'password') = (password_hash IS NOT NULL));

ALTER TABLE price_alerts DROP CONSTRAINT price_alerts_direction;
UPDATE price_alerts SET direction = CASE direction WHEN 'unter' THEN 'below' WHEN 'ueber' THEN 'above' ELSE direction END;
ALTER TABLE price_alerts ADD CONSTRAINT price_alerts_direction CHECK (direction IN ('below', 'above'));

ALTER TABLE webauthn_challenges DROP CONSTRAINT webauthn_challenges_purpose_check;
UPDATE webauthn_challenges SET purpose = CASE purpose
  WHEN 'registrieren' THEN 'register' WHEN 'anmelden' THEN 'login' WHEN 'zweiter_faktor' THEN 'second_factor' ELSE purpose END;
ALTER TABLE webauthn_challenges ADD CONSTRAINT webauthn_challenges_purpose_check
  CHECK (purpose IN ('register', 'login', 'second_factor'));

UPDATE jobs SET payload = jsonb_set(payload, '{eingabe,corrections}', (
  SELECT jsonb_agg(CASE WHEN c ? 'kaufpreis' THEN (c - 'kaufpreis') || jsonb_build_object('purchase_price', c->'kaufpreis') ELSE c END)
    FROM jsonb_array_elements(payload->'eingabe'->'corrections') c))
 WHERE type = 'csv_import' AND status IN ('pending', 'running') AND payload->>'source' = 'wanted_xml'
   AND jsonb_typeof(payload->'eingabe'->'corrections') = 'array' AND jsonb_array_length(payload->'eingabe'->'corrections') > 0;

UPDATE admin_log SET action = CASE action
  WHEN 'konto_angelegt' THEN 'account_created' WHEN 'passwort_gesetzt' THEN 'password_set'
  WHEN 'zweiter_faktor_entfernt' THEN 'second_factor_removed' WHEN 'verwalter_ernannt' THEN 'admin_appointed'
  WHEN 'verwalter_entzogen' THEN 'admin_revoked' WHEN 'konto_geloescht' THEN 'account_deleted'
  WHEN 'konto_deaktiviert' THEN 'account_deactivated' WHEN 'konto_reaktiviert' THEN 'account_reactivated'
  WHEN 'konto_freigeschaltet' THEN 'account_unlocked' WHEN 'einstellungen_geaendert' THEN 'settings_changed'
  WHEN 'gutschein_klartext' THEN 'voucher_plaintext' WHEN 'gutschein_pdf' THEN 'voucher_pdf'
  WHEN 'gutschein_export' THEN 'voucher_export' WHEN 'uebernahme_angekuendigt' THEN 'takeover_announced'
  WHEN 'uebernahme_abgebrochen' THEN 'takeover_cancelled' ELSE action END;

UPDATE global_settings SET key = 'voucher_country'
 WHERE key = 'gutschein_land' AND NOT EXISTS (SELECT 1 FROM global_settings WHERE key = 'voucher_country');
DELETE FROM global_settings WHERE key = 'gutschein_land';
