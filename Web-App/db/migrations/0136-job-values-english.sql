-- Stored values of API v2 in English: job status, job kinds, the step-up actions and the keys
-- inside jobs.payload/progress/result. API v1 shows the former values through its mapping
-- (src/contract/v1Names.ts, contract/management.ts).
--
-- Running jobs: the tables are locked for the whole transaction, so no worker claims, finishes
-- or reports progress while the values change; a job that was 'laeuft' is 'running' afterwards
-- with the same locked_by and deadline. A process still on the old code writes German values,
-- which the new checks reject (fails closed); its jobs are taken over after their deadline.
LOCK TABLE jobs, job_pauses, job_exclusive_locks, job_types, step_up_approvals, step_up_challenges
  IN ACCESS EXCLUSIVE MODE;

CREATE FUNCTION pg_temp.english_keys(j jsonb, m jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE jsonb_typeof(j)
    WHEN 'object' THEN COALESCE(
      (SELECT jsonb_object_agg(COALESCE(m ->> e.key, e.key), pg_temp.english_keys(e.value, m))
         FROM jsonb_each(j) e), '{}'::jsonb)
    WHEN 'array' THEN COALESCE(
      (SELECT jsonb_agg(pg_temp.english_keys(e.value, m) ORDER BY e.ord)
         FROM jsonb_array_elements(j) WITH ORDINALITY e(value, ord)), '[]'::jsonb)
    ELSE j END
$$;

CREATE TEMP TABLE kind_map (old text PRIMARY KEY, new text NOT NULL) ON COMMIT DROP;
INSERT INTO kind_map VALUES
  ('bilder', 'images'), ('anleitung', 'instructions'), ('bilder_neu_laden', 'images_reload'),
  ('bild_nachlauf', 'image_followup'), ('widerrufsliste', 'revocation_list'),
  ('wechselkurse', 'exchange_rates'), ('preise', 'prices'), ('bildbedarf', 'image_demand'),
  ('nachlauf', 'followup'), ('aufraeumen', 'cleanup'), ('aufraeumen_taeglich', 'cleanup_daily'),
  ('nacharbeit', 'rework'), ('katalog_nachzug', 'catalog_followup'), ('konto_dateien', 'account_files'),
  ('preise_nachladen', 'price_refresh');

-- Job kinds: new rows first, then the references, then the old rows (foreign keys).
INSERT INTO job_types (type) SELECT k.new FROM kind_map k JOIN job_types t ON t.type = k.old
  ON CONFLICT DO NOTHING;
UPDATE jobs j SET type = k.new FROM kind_map k WHERE j.type = k.old;
UPDATE job_pauses p SET type = k.new FROM kind_map k WHERE p.type = k.old;
UPDATE job_exclusive_locks l SET type = k.new FROM kind_map k WHERE l.type = k.old
  AND NOT EXISTS (SELECT 1 FROM job_exclusive_locks x WHERE x.type = k.new);
DELETE FROM job_exclusive_locks l USING kind_map k WHERE l.type = k.old;
DELETE FROM job_types t USING kind_map k WHERE t.type = k.old;
-- Dedupe keys start with the kind (`images:75192-1`, `plan:prices`).
UPDATE jobs j SET dedupe_key = regexp_replace(j.dedupe_key, '^(plan:)?' || k.old || '(:|$)', '\1' || k.new || '\2')
  FROM kind_map k WHERE j.dedupe_key ~ ('^(plan:)?' || k.old || '(:|$)');

-- Job status.
ALTER TABLE jobs DROP CONSTRAINT jobs_status_check;
DROP TRIGGER job_exclusive ON jobs;
DROP INDEX idx_jobs_deadline;
DROP INDEX idx_jobs_key;
DROP INDEX idx_jobs_open_due;
UPDATE jobs SET status = CASE status
  WHEN 'offen' THEN 'pending' WHEN 'laeuft' THEN 'running' WHEN 'erledigt' THEN 'done'
  WHEN 'fehler' THEN 'error' WHEN 'abgebrochen' THEN 'cancelled' ELSE status END;
ALTER TABLE jobs ALTER COLUMN status SET DEFAULT 'pending';
ALTER TABLE jobs ADD CONSTRAINT jobs_status_check
  CHECK (status IN ('pending', 'running', 'done', 'error', 'cancelled'));
CREATE INDEX idx_jobs_deadline ON jobs (deadline_at) WHERE status = 'running';
CREATE UNIQUE INDEX idx_jobs_key ON jobs (dedupe_key) WHERE status = 'pending';
CREATE INDEX idx_jobs_open_due ON jobs (due_at) WHERE status = 'pending';

CREATE OR REPLACE FUNCTION job_exclusive_claim() RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM job_exclusive_locks e WHERE e.type = NEW.type) THEN RETURN NEW; END IF;
  -- Another row is holding this type right now: don't wait, just skip it.
  IF NOT pg_try_advisory_xact_lock(59, hashtext(NEW.type)) THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM jobs l
              WHERE l.type = NEW.type AND l.status = 'running' AND l.deadline_at >= NOW() AND l.id <> NEW.id) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END $function$;
CREATE TRIGGER job_exclusive BEFORE UPDATE OF status, locked_by ON jobs FOR EACH ROW
  WHEN (NEW.status = 'running' AND NEW.locked_by IS DISTINCT FROM OLD.locked_by)
  EXECUTE FUNCTION job_exclusive_claim();

-- Keys inside payload, progress and result, as the code reads them now.
UPDATE jobs SET payload = pg_temp.english_keys(payload, m.map),
                progress = pg_temp.english_keys(progress, m.map),
                result = pg_temp.english_keys(result, m.map)

  FROM (SELECT '{
    "preis_konto": "account_price", "ohne_kurs": "without_rate", "degradiert": "degraded", "orte": "locations",
    "vorgabe": "preset", "figuren": "minifigs", "ort": "location", "teile": "parts",
    "eintraege": "entries", "anzahl": "count", "endgueltig_am": "purge_at", "entfernt": "removed",
    "papierkorb": "trash", "eigenes": "own", "fehler": "error", "pfad": "path",
    "erledigt": "done", "konfiguriert": "configured", "schritte": "steps", "pflicht": "required",
    "vorhanden": "existing", "zert_sha256": "cert_sha256", "gueltig_bis": "valid_until", "basis_url": "base_url",
    "offen": "open", "passwort_aendern": "change_password", "quellen": "sources", "gutschein_land": "voucher_country",
    "smtp_uebergangen": "smtp_skipped", "quelle": "source", "nummer": "number", "zeile": "row",
    "menge": "quantity", "katalog_offen": "catalog_pending", "waehrung_angepasst": "currency_adjusted", "waehrung_datei": "file_currency",
    "waehrung_konto": "account_currency", "waehrung_hinweis": "currency_note", "pnl_prozent": "pnl_percent", "kaufpreise_umgerechnet": "converted_purchase_prices",
    "ausstehend": "pending", "wert_gesamt": "value_total", "kaufpreis_original": "original_purchase_price", "kaufpreis_waehrung": "purchase_currency",
    "preise_ausstehend": "prices_pending", "kaufpreise_fremde_waehrung": "foreign_currency_purchases", "positionen": "positions", "positionen_bewertet": "positions_valued",
    "positionen_ohne_marktpreis": "positions_without_market_price", "positionen_ohne_kaufpreis": "positions_without_purchase_price", "basis_einstand": "baseline_cost", "basis_marktwert": "baseline_market_value",
    "basis_guv_betrag": "baseline_pnl_amount", "ohne_marktpreis_einstand": "cost_without_market_price", "ohne_kaufpreis_marktwert": "market_value_without_purchase_price", "pnl_betrag": "pnl_amount",
    "baseline_pnl_prozent": "baseline_pnl_percent", "kachel_preis": "tile_price", "kachel_pnl_pct": "tile_pnl_pct", "kachel_quelle": "tile_source",
    "ttl_stunden": "cache_ttl_hours", "bl_unbekannt": "bl_unknown", "preis_ausstehend": "price_pending", "messpunkte": "data_points",
    "oeffentlich": "public_key", "kette": "chain", "nachricht": "message", "aktion": "action",
    "signatur": "signature", "hat_pdf": "has_pdf", "guthaben_geprueft_am": "balance_checked_at", "mehrere": "multiple",
    "gelesen": "parsed", "angezeigt": "displayed", "waehrung_geaendert": "currency_changed", "grund": "reason",
    "wartenSek": "waitSeconds", "gueltig_sek": "valid_seconds", "blickfeld": "view", "tiefe": "depth",
    "faktor_code": "factor_code", "preisvergleich_url": "price_comparison_url", "passwort_vergessen": "forgot_password", "mail_versand": "mail_delivery",
    "aktiv": "active", "codes_uebrig": "codes_left", "alte_codes_bis": "old_codes_until", "zweiterFaktorPflicht": "secondFactorRequired",
    "rotation_faellig": "rotation_due", "aktuell": "current", "zweiter_faktor": "second_factor", "keks_fehlt": "cookie_missing",
    "ohne_token": "without_token", "wartet": "waiting", "abholung": "pickup", "vorschau": "preview",
    "schluessel_nonce": "key_nonce", "stand": "state", "geraet": "device", "passkeys_widerrufen": "passkeys_revoked",
    "geheimnis": "secret", "alt_gueltig_bis": "old_valid_until", "ueberlappung_sek": "overlap_seconds", "wartet_auf_bestaetigung": "awaiting_confirmation",
    "angekuendigt": "announced", "kopplung": "pairing", "gueltigkeit": "validity", "verfuegbar": "available",
    "optionen": "options", "antwort": "response", "zweck": "purpose", "mit_token": "with_token",
    "zugaenge": "accesses", "merkposten": "item", "marktpreis": "market_price", "waehrung": "currency",
    "war_neu": "was_new", "verschoben": "moved", "zusammengefuehrt": "merged", "neuer_inhaber": "new_owner",
    "geloescht": "deleted", "angelegt": "created", "aufgestockt": "topped_up", "posten": "items",
    "art": "kind", "ausgang": "outcome", "blFarbe": "blColor", "rbFarbe": "rbColor",
    "farbName": "colorName", "farbHex": "colorHex", "sicherheit": "confidence", "zustand": "condition",
    "maxPreis": "maxPrice", "nameGeraten": "nameGuessed", "bild": "image", "grundCode": "reasonCode",
    "fremdeArten": "foreignTypes", "ohneNummer": "withoutNumber", "stufen": "levels", "farbeOffen": "colorPending",
    "standardZustand": "defaultCondition", "abgebrochen": "aborted", "korrekturen": "corrections", "angewandt": "applied",
    "abgewiesen": "rejected", "gefragt": "asked", "gefunden": "found", "filterWirkungslos": "filterIneffective",
    "schreiben": "write", "strom": "stream", "im_katalog": "in_catalog", "letzter_kauf": "last_purchase",
    "kaufpreis_geschaetzt": "purchase_price_estimated", "besitzt": "owns", "unsicher": "uncertain", "ergaenzung": "supplement",
    "entfallen": "dropped", "gestartet": "started", "vorhanden_nummern": "existing_numbers", "pruefen": "check",
    "auftrag_id": "job_id", "ordnung": "order", "zusammengelegt": "combined", "vereint": "united",
    "bestand": "holding", "gesamt": "total", "lose": "loose", "beendet_am": "finished_at",
    "sprache": "language", "sub_teile": "sub_parts", "werte": "values", "vor": "ago",
    "proxy_hinweis": "proxy_hint", "minuten": "minutes", "auftraege": "jobs", "geplant": "scheduled",
    "zusammenfassung": "summary", "pausen": "pauses", "bildbedarf": "image_demand", "job_prozess": "job_process",
    "lebenszeichen": "heartbeat", "alter_sekunden": "age_seconds", "laeuft": "running", "verworfen": "discarded",
    "dauer_minuten": "duration_minutes", "alle_erneut": "all_again", "hinweise": "hints", "datenbank": "database",
    "anzahl_konten": "account_count", "katalog_bild": "catalog_image", "lokal": "local", "geaendert": "changed",
    "gecacht": "cached", "adresse": "address", "merker": "marker", "seit": "since",
    "hinweis": "hint", "feld": "field"
  }'::jsonb AS map) m;

-- Step-up actions of the device key.
ALTER TABLE step_up_approvals DROP CONSTRAINT step_up_approvals_action_check;
ALTER TABLE step_up_challenges DROP CONSTRAINT step_up_challenges_action_check;
UPDATE step_up_approvals SET action = CASE action
  WHEN 'gutschein' THEN 'voucher' WHEN 'verwaltung' THEN 'admin' WHEN 'zweiter_faktor' THEN 'second_factor' ELSE action END;
UPDATE step_up_challenges SET action = CASE action
  WHEN 'gutschein' THEN 'voucher' WHEN 'verwaltung' THEN 'admin' WHEN 'zweiter_faktor' THEN 'second_factor' ELSE action END;
ALTER TABLE step_up_approvals ADD CONSTRAINT step_up_approvals_action_check
  CHECK (action IN ('voucher', 'admin', 'second_factor'));
ALTER TABLE step_up_challenges ADD CONSTRAINT step_up_challenges_action_check
  CHECK (action IN ('voucher', 'admin', 'second_factor'));

DROP FUNCTION pg_temp.english_keys(jsonb, jsonb);
