-- Phase 1 of the German-to-English code migration (CLAUDE.md, decided round 30):
-- the database schema's German table and column names become English. Function,
-- trigger, policy and constraint names, and the GUC "app.konto", stay for now —
-- their bodies are plain text and need their own careful pass, not this rename.
-- Enum/check string values (e.g. 'passwort', 'teil') are stored data, not identifiers,
-- and are out of scope here.

ALTER TABLE api_aufrufe RENAME TO api_calls;
ALTER TABLE api_calls RENAME COLUMN tag TO day;
ALTER TABLE api_calls RENAME COLUMN konto TO account_id;
ALTER TABLE api_calls RENAME COLUMN anzahl TO count;

ALTER TABLE api_takt RENAME TO api_cadence;
ALTER TABLE api_cadence RENAME COLUMN naechster TO next_at;

ALTER TABLE api_tokens_verbraucht RENAME TO api_tokens_consumed;
ALTER TABLE api_tokens_consumed RENAME COLUMN familie TO token_family;
ALTER TABLE api_tokens_consumed RENAME COLUMN verbraucht_am TO consumed_at;

ALTER TABLE api_tokens RENAME COLUMN ip_bereich TO ip_range;
ALTER TABLE api_tokens RENAME COLUMN rotiert_am TO rotated_at;
ALTER TABLE api_tokens RENAME COLUMN vorgaenger TO previous_token;
ALTER TABLE api_tokens RENAME COLUMN ersetzt_durch TO replaced_by;

ALTER TABLE auftraege RENAME TO jobs;
ALTER TABLE jobs RENAME COLUMN art TO type;
ALTER TABLE jobs RENAME COLUMN nutzlast TO payload;
ALTER TABLE jobs RENAME COLUMN schluessel TO dedupe_key;
ALTER TABLE jobs RENAME COLUMN versuche TO attempts;
ALTER TABLE jobs RENAME COLUMN max_versuche TO max_attempts;
ALTER TABLE jobs RENAME COLUMN faellig_ab TO due_at;
ALTER TABLE jobs RENAME COLUMN belegt_von TO locked_by;
ALTER TABLE jobs RENAME COLUMN fehler TO error_message;
ALTER TABLE jobs RENAME COLUMN erstellt TO created_at;
ALTER TABLE jobs RENAME COLUMN aktualisiert TO updated_at;
ALTER TABLE jobs RENAME COLUMN frist_bis TO deadline_at;
ALTER TABLE jobs RENAME COLUMN gestartet TO started_at;
ALTER TABLE jobs RENAME COLUMN fortschritt TO progress;
ALTER TABLE jobs RENAME COLUMN ergebnis TO result;
ALTER TABLE jobs RENAME COLUMN wartet TO waiting;

ALTER TABLE auftrag_exklusiv RENAME TO job_exclusive_locks;
ALTER TABLE job_exclusive_locks RENAME COLUMN art TO type;

ALTER TABLE auftrag_pausen RENAME TO job_pauses;
ALTER TABLE job_pauses RENAME COLUMN art TO type;
ALTER TABLE job_pauses RENAME COLUMN bis TO until_at;
ALTER TABLE job_pauses RENAME COLUMN grund TO reason;
ALTER TABLE job_pauses RENAME COLUMN stufe TO level;

ALTER TABLE auftrags_arten RENAME TO job_types;
ALTER TABLE job_types RENAME COLUMN art TO type;

ALTER TABLE bl_zuordnung RENAME TO bl_mapping;
ALTER TABLE bl_mapping RENAME COLUMN art TO type;

ALTER TABLE bl_zuordnung_eigen RENAME TO bl_mapping_custom;
ALTER TABLE bl_mapping_custom RENAME COLUMN art TO type;

ALTER TABLE figur_eigen RENAME TO minifig_custom;

ALTER TABLE geraete_nonces RENAME TO device_nonces;
ALTER TABLE device_nonces RENAME COLUMN familie TO token_family;
ALTER TABLE device_nonces RENAME COLUMN aus_qr TO from_qr;
ALTER TABLE device_nonces RENAME COLUMN angelegt_am TO created_at;
ALTER TABLE device_nonces RENAME COLUMN ablauf TO expires_at;

ALTER TABLE geraete_schluessel RENAME TO device_keys;
ALTER TABLE device_keys RENAME COLUMN familie TO token_family;
ALTER TABLE device_keys RENAME COLUMN oeffentlich TO public_key;
ALTER TABLE device_keys RENAME COLUMN angelegt_am TO created_at;
ALTER TABLE device_keys RENAME COLUMN attestiert TO attested;

ALTER TABLE gutschein_guthaben_schranke RENAME TO voucher_balance_throttle;
ALTER TABLE voucher_balance_throttle RENAME COLUMN letzter_abruf TO last_checked_at;
ALTER TABLE voucher_balance_throttle RENAME COLUMN sperre_bis TO locked_until;

ALTER TABLE idempotenz RENAME TO idempotency;
ALTER TABLE idempotency RENAME COLUMN schluessel TO key;
ALTER TABLE idempotency RENAME COLUMN anfrage TO request;
ALTER TABLE idempotency RENAME COLUMN antwort TO response;
ALTER TABLE idempotency RENAME COLUMN angelegt TO created_at;
ALTER TABLE idempotency RENAME COLUMN wirkung TO has_effect;

ALTER TABLE import_stand RENAME TO import_status;

ALTER TABLE laufzustand RENAME TO run_state;
ALTER TABLE run_state RENAME COLUMN schluessel TO key;
ALTER TABLE run_state RENAME COLUMN wert TO value;
ALTER TABLE run_state RENAME COLUMN aktualisiert TO updated_at;

ALTER TABLE minifig_acquisitions RENAME COLUMN tag TO day;
ALTER TABLE part_acquisitions RENAME COLUMN tag TO day;
ALTER TABLE set_acquisitions RENAME COLUMN tag TO day;

ALTER TABLE minifig_price_cache RENAME COLUMN geschaetzt TO estimated;
ALTER TABLE minifig_price_cache RENAME COLUMN abdeckung TO coverage;
ALTER TABLE minifig_price_history RENAME COLUMN geschaetzt TO estimated;
ALTER TABLE minifig_price_history RENAME COLUMN abdeckung TO coverage;

ALTER TABLE papierkorb RENAME TO trash;
ALTER TABLE trash RENAME COLUMN art TO type;
ALTER TABLE trash RENAME COLUMN nummer TO number;
ALTER TABLE trash RENAME COLUMN farbe_id TO color_id;
ALTER TABLE trash RENAME COLUMN bezeichnung TO label;
ALTER TABLE trash RENAME COLUMN zeilen TO rows;
ALTER TABLE trash RENAME COLUMN geloescht_am TO deleted_at;

ALTER TABLE parts_katalog_offen RENAME TO parts_catalog_pending;
ALTER TABLE parts_catalog_pending RENAME COLUMN nummer TO number;

ALTER TABLE price_alerts RENAME COLUMN richtung TO direction;
ALTER TABLE price_alerts RENAME COLUMN schwelle TO threshold;
ALTER TABLE price_alerts RENAME COLUMN ausgeloest TO triggered;
ALTER TABLE price_alerts RENAME COLUMN zuletzt_am TO last_triggered_at;
ALTER TABLE price_alerts RENAME COLUMN zuletzt_preis TO last_price;

ALTER TABLE qr_login_tokens RENAME COLUMN abholung TO pickup_code;
ALTER TABLE qr_login_tokens RENAME COLUMN geraet TO device;
ALTER TABLE qr_login_tokens RENAME COLUMN ip_bereich TO ip_range;
ALTER TABLE qr_login_tokens RENAME COLUMN fehlversuche TO failed_attempts;
ALTER TABLE qr_login_tokens RENAME COLUMN bestaetigt_am TO confirmed_at;
ALTER TABLE qr_login_tokens RENAME COLUMN abgelehnt_am TO rejected_at;
ALTER TABLE qr_login_tokens RENAME COLUMN abgeholt_am TO picked_up_at;

ALTER TABLE rate_limit_attempts RENAME COLUMN laufend TO ongoing;
ALTER TABLE rate_limit_attempts RENAME COLUMN laufend_seit TO ongoing_since;

ALTER TABLE rb_sets RENAME COLUMN herkunft TO source;

ALTER TABLE schritt_challenges RENAME TO step_up_challenges;
ALTER TABLE step_up_challenges RENAME COLUMN familie TO token_family;
ALTER TABLE step_up_challenges RENAME COLUMN aktion TO action;
ALTER TABLE step_up_challenges RENAME COLUMN angelegt_am TO created_at;
ALTER TABLE step_up_challenges RENAME COLUMN ablauf TO expires_at;

ALTER TABLE schritt_freigaben RENAME TO step_up_approvals;
ALTER TABLE step_up_approvals RENAME COLUMN familie TO token_family;
ALTER TABLE step_up_approvals RENAME COLUMN aktion TO action;
ALTER TABLE step_up_approvals RENAME COLUMN bis TO until_at;
ALTER TABLE step_up_approvals RENAME COLUMN hoechstens TO max_until;

ALTER TABLE set_figuren RENAME TO set_minifigs;
ALTER TABLE set_teile RENAME TO set_parts;

ALTER TABLE teil_eigen RENAME TO part_custom;
ALTER TABLE teil_farbe_eigen RENAME TO part_color_custom;

ALTER TABLE users RENAME COLUMN sitzungs_version TO session_version;
ALTER TABLE users RENAME COLUMN registrierung_offen TO registration_pending;
ALTER TABLE users RENAME COLUMN email_neu TO new_email;
ALTER TABLE users RENAME COLUMN email_neu_token TO new_email_token;
ALTER TABLE users RENAME COLUMN email_neu_bis TO new_email_until;

ALTER TABLE verwalter_uebernahmen RENAME TO admin_takeovers;
ALTER TABLE admin_takeovers RENAME COLUMN ziel_id TO target_id;
ALTER TABLE admin_takeovers RENAME COLUMN art TO type;
ALTER TABLE admin_takeovers RENAME COLUMN durch_id TO initiated_by;
ALTER TABLE admin_takeovers RENAME COLUMN passwort_hash TO password_hash;
ALTER TABLE admin_takeovers RENAME COLUMN angelegt_am TO created_at;
ALTER TABLE admin_takeovers RENAME COLUMN wirksam_ab TO effective_at;
ALTER TABLE admin_takeovers RENAME COLUMN abbruch_hash TO cancel_hash;

ALTER TABLE verwaltungsprotokoll RENAME TO admin_log;
ALTER TABLE admin_log RENAME COLUMN zeit TO occurred_at;
ALTER TABLE admin_log RENAME COLUMN verwalter_id TO admin_id;
ALTER TABLE admin_log RENAME COLUMN ziel_id TO target_id;
ALTER TABLE admin_log RENAME COLUMN ziel_name TO target_name;
ALTER TABLE admin_log RENAME COLUMN aktion TO action;
ALTER TABLE admin_log RENAME COLUMN einzelheiten TO details;

ALTER TABLE vouchers RENAME COLUMN guthaben_geprueft_am TO balance_checked_at;
ALTER TABLE vouchers RENAME COLUMN nummer_suche TO number_search;

ALTER TABLE webauthn_challenges RENAME COLUMN zweck TO purpose;

ALTER TABLE wechselkurse RENAME TO exchange_rates;
ALTER TABLE exchange_rates RENAME COLUMN tag TO day;
ALTER TABLE exchange_rates RENAME COLUMN waehrung TO currency;
ALTER TABLE exchange_rates RENAME COLUMN je_eur TO per_eur;

ALTER TABLE zweiter_faktor RENAME TO second_factor;
ALTER TABLE second_factor RENAME COLUMN geheimnis TO secret;
ALTER TABLE second_factor RENAME COLUMN aktiv TO active;
ALTER TABLE second_factor RENAME COLUMN letzter_schritt TO last_step;
ALTER TABLE second_factor RENAME COLUMN eingerichtet_am TO created_at;

ALTER TABLE zweiter_faktor_codes RENAME TO second_factor_codes;
ALTER TABLE second_factor_codes RENAME COLUMN verbraucht_am TO consumed_at;
ALTER TABLE second_factor_codes RENAME COLUMN alt_gilt_bis TO old_valid_until;

-- Function BODIES are opaque text, not catalog-bound like views or policies, so a
-- table/column rename above does not update them: each one referencing a renamed
-- name is replaced here with the same name and new identifiers inside.

CREATE OR REPLACE FUNCTION auftrag_exklusiv_belegen()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM job_exclusive_locks e WHERE e.type = NEW.type) THEN RETURN NEW; END IF;
  -- Another row is holding this type right now: don't wait, just skip it.
  IF NOT pg_try_advisory_xact_lock(59, hashtext(NEW.type)) THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM jobs l
              WHERE l.type = NEW.type AND l.status = 'laeuft' AND l.deadline_at >= NOW() AND l.id <> NEW.id) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION erfassung_tag()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.day IS NULL)
     OR (TG_OP = 'UPDATE' AND NEW.created_at IS DISTINCT FROM OLD.created_at
         AND NEW.day IS NOT DISTINCT FROM OLD.day) THEN
    NEW.day := (NEW.created_at AT TIME ZONE
                COALESCE((SELECT NULLIF(value, '') FROM global_settings WHERE key = 'erfassung_zeitzone'), 'UTC'))::date;
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION kurs_je_eur(w text, t date)
 RETURNS numeric
 LANGUAGE sql
 STABLE
AS $function$
  SELECT CASE WHEN upper(w) = 'EUR' THEN 1::numeric
              ELSE (SELECT k.per_eur FROM exchange_rates k
                     WHERE k.currency = upper(w) AND k.day <= t
                     ORDER BY k.day DESC LIMIT 1) END
$function$;

CREATE OR REPLACE FUNCTION merke_teilekatalog_alt()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_TABLE_NAME IN ('bl_mapping', 'bl_mapping_custom') THEN
    INSERT INTO parts_catalog_pending (number)
    SELECT DISTINCT x FROM alt, LATERAL (VALUES (alt.rb_id), (alt.bl_id)) v(x)
     WHERE alt.type = 'part' AND x IS NOT NULL;
  ELSE
    INSERT INTO parts_catalog_pending (number) SELECT DISTINCT part_number FROM alt;
  END IF;
  RETURN NULL;
END $function$;

CREATE OR REPLACE FUNCTION merke_teilekatalog_beide()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_TABLE_NAME IN ('bl_mapping', 'bl_mapping_custom') THEN
    INSERT INTO parts_catalog_pending (number)
    SELECT DISTINCT x FROM (SELECT type, rb_id, bl_id FROM alt UNION ALL SELECT type, rb_id, bl_id FROM neu) z,
           LATERAL (VALUES (z.rb_id), (z.bl_id)) v(x)
     WHERE z.type = 'part' AND x IS NOT NULL;
  ELSE
    INSERT INTO parts_catalog_pending (number)
    SELECT DISTINCT part_number FROM (SELECT part_number FROM alt UNION ALL SELECT part_number FROM neu) z;
  END IF;
  RETURN NULL;
END $function$;

CREATE OR REPLACE FUNCTION merke_teilekatalog_neu()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_TABLE_NAME IN ('bl_mapping', 'bl_mapping_custom') THEN
    INSERT INTO parts_catalog_pending (number)
    SELECT DISTINCT x FROM neu, LATERAL (VALUES (neu.rb_id), (neu.bl_id)) v(x)
     WHERE neu.type = 'part' AND x IS NOT NULL;
  ELSE
    INSERT INTO parts_catalog_pending (number) SELECT DISTINCT part_number FROM neu;
  END IF;
  RETURN NULL;
END $function$;

CREATE OR REPLACE FUNCTION verwaltungsprotokoll_aufraeumen()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  alt integer;
  namen integer;
BEGIN
  DELETE FROM public.admin_log WHERE occurred_at < now() - interval '365 days';
  GET DIAGNOSTICS alt = ROW_COUNT;
  UPDATE public.admin_log p SET target_name = NULL
   WHERE target_name IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = p.target_id);
  GET DIAGNOSTICS namen = ROW_COUNT;
  RETURN alt + namen;
END $function$;
