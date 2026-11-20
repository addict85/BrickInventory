-- Erzeugt von scripts/schema-snapshot.js aus einer frischen Datenbank.
-- Nicht von Hand ändern und nicht einspielen: Das Schema entsteht aus
-- db/basis.sql und db/migrations/. Neu erzeugen mit
-- `npm run build && npm run schema:stand`.

CREATE EXTENSION pg_trgm;

CREATE TABLE account_link_invites (
  token_hash text NOT NULL,
  main_user_id integer NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL,
  used_at timestamp with time zone,
  used_by integer,
  CONSTRAINT account_link_invites_main_user_id_fkey FOREIGN KEY (main_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT account_link_invites_pkey PRIMARY KEY (token_hash),
  CONSTRAINT account_link_invites_used_by_fkey FOREIGN KEY (used_by) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_account_link_invites_main ON account_link_invites USING btree (main_user_id, expires_at);
CREATE INDEX idx_invite_used_by ON account_link_invites USING btree (used_by);
ALTER TABLE account_link_invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY zeilenschutz ON account_link_invites USING ((main_user_id = ( SELECT zeilenschutz_konto() AS zeilenschutz_konto))) WITH CHECK ((main_user_id = ( SELECT zeilenschutz_konto() AS zeilenschutz_konto)));

CREATE TABLE account_links (
  main_user_id integer NOT NULL,
  sub_user_id integer NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT account_links_main_user_id_fkey FOREIGN KEY (main_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT account_links_no_self CHECK ((main_user_id <> sub_user_id)),
  CONSTRAINT account_links_pkey PRIMARY KEY (main_user_id, sub_user_id),
  CONSTRAINT account_links_sub_user_id_fkey FOREIGN KEY (sub_user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_account_links_sub ON account_links USING btree (sub_user_id);
ALTER TABLE account_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY lesen ON account_links FOR SELECT USING (((( SELECT zeilenschutz_konto() AS zeilenschutz_konto) = main_user_id) OR (( SELECT zeilenschutz_konto() AS zeilenschutz_konto) = sub_user_id)));
CREATE POLICY loesen ON account_links FOR DELETE USING (((( SELECT zeilenschutz_konto() AS zeilenschutz_konto) = main_user_id) OR (( SELECT zeilenschutz_konto() AS zeilenschutz_konto) = sub_user_id)));

CREATE TABLE admin_log (
  id integer NOT NULL DEFAULT nextval('verwaltungsprotokoll_id_seq'::regclass),
  occurred_at timestamp with time zone NOT NULL DEFAULT now(),
  admin_id integer,
  target_id integer,
  target_name text,
  action text NOT NULL,
  details text,
  CONSTRAINT verwaltungsprotokoll_pkey PRIMARY KEY (id),
  CONSTRAINT verwaltungsprotokoll_verwalter_id_fkey FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_verwaltungsprotokoll_verwalter ON admin_log USING btree (admin_id);
CREATE INDEX idx_verwaltungsprotokoll_zeit ON admin_log USING btree (occurred_at DESC);

CREATE TABLE admin_takeovers (
  target_id integer NOT NULL,
  type text NOT NULL,
  initiated_by integer NOT NULL,
  password_hash text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  effective_at timestamp with time zone NOT NULL,
  cancel_hash text,
  CONSTRAINT verwalter_uebernahmen_art_check CHECK ((type = ANY (ARRAY['passwort'::text, 'zweiter_faktor'::text, 'deaktivieren'::text, 'rolle_entziehen'::text, 'loeschen'::text]))),
  CONSTRAINT verwalter_uebernahmen_check CHECK (((type = 'passwort'::text) = (password_hash IS NOT NULL))),
  CONSTRAINT verwalter_uebernahmen_durch_id_fkey FOREIGN KEY (initiated_by) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT verwalter_uebernahmen_pkey PRIMARY KEY (target_id, type),
  CONSTRAINT verwalter_uebernahmen_ziel_id_fkey FOREIGN KEY (target_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX idx_verwalter_uebernahmen_abbruch ON admin_takeovers USING btree (cancel_hash);
CREATE INDEX idx_verwalter_uebernahmen_durch ON admin_takeovers USING btree (initiated_by);
ALTER TABLE admin_takeovers ENABLE ROW LEVEL SECURITY;

CREATE TABLE api_cadence (
  api text NOT NULL,
  next_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT api_takt_pkey PRIMARY KEY (api)
);

CREATE TABLE api_calls (
  day date NOT NULL,
  api text NOT NULL,
  account_id integer NOT NULL DEFAULT 0,
  count integer NOT NULL DEFAULT 0,
  CONSTRAINT api_aufrufe_anzahl_check CHECK ((count >= 0)),
  CONSTRAINT api_aufrufe_api_check CHECK ((api = ANY (ARRAY['bricklink'::text, 'rebrickable'::text, 'brickset'::text]))),
  CONSTRAINT api_aufrufe_pkey PRIMARY KEY (day, api, account_id)
);

CREATE TABLE api_tokens (
  token text NOT NULL,
  user_id integer NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  last_used timestamp with time zone DEFAULT now(),
  expires_at timestamp with time zone,
  sliding boolean NOT NULL DEFAULT false,
  hard_expires_at timestamp with time zone,
  never_expires boolean NOT NULL DEFAULT false,
  label text,
  scope text NOT NULL DEFAULT 'app'::text,
  ip_range text,
  rotated_at timestamp with time zone NOT NULL DEFAULT now(),
  previous_token text,
  replaced_by text,
  CONSTRAINT api_tokens_pkey PRIMARY KEY (token),
  CONSTRAINT api_tokens_scope_check CHECK ((scope = ANY (ARRAY['app'::text, 'voll'::text]))),
  CONSTRAINT api_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_api_tokens_expires ON api_tokens USING btree (expires_at) WHERE (expires_at IS NOT NULL);
CREATE INDEX idx_api_tokens_hard ON api_tokens USING btree (hard_expires_at) WHERE (hard_expires_at IS NOT NULL);
CREATE INDEX idx_api_tokens_idle ON api_tokens USING btree (last_used) WHERE (expires_at IS NULL);
CREATE INDEX idx_api_tokens_user_created ON api_tokens USING btree (user_id, created_at DESC);
ALTER TABLE api_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY zeilenschutz ON api_tokens USING ((user_id = ( SELECT zeilenschutz_konto() AS zeilenschutz_konto))) WITH CHECK ((user_id = ( SELECT zeilenschutz_konto() AS zeilenschutz_konto)));

CREATE TABLE api_tokens_consumed (
  token text NOT NULL,
  user_id integer NOT NULL,
  token_family timestamp with time zone NOT NULL,
  consumed_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT api_tokens_verbraucht_pkey PRIMARY KEY (token),
  CONSTRAINT api_tokens_verbraucht_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_api_tokens_verbraucht_familie ON api_tokens_consumed USING btree (user_id, token_family);
ALTER TABLE api_tokens_consumed ENABLE ROW LEVEL SECURITY;
CREATE POLICY zeilenschutz ON api_tokens_consumed USING ((user_id = ( SELECT zeilenschutz_konto() AS zeilenschutz_konto))) WITH CHECK ((user_id = ( SELECT zeilenschutz_konto() AS zeilenschutz_konto)));

CREATE TABLE app_logs (
  id bigint NOT NULL DEFAULT nextval('app_logs_id_seq'::regclass),
  level character varying(10) NOT NULL DEFAULT 'info'::character varying,
  message text NOT NULL,
  logged_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT app_logs_pkey PRIMARY KEY (id)
);
CREATE INDEX idx_app_logs_logged_at ON app_logs USING btree (logged_at DESC);

CREATE TABLE bl_mapping (
  type text NOT NULL,
  rb_id text NOT NULL,
  bl_id text,
  fetched_at timestamp with time zone DEFAULT now(),
  CONSTRAINT bl_zuordnung_art CHECK ((type = ANY (ARRAY['part'::text, 'fig'::text, 'set'::text]))),
  CONSTRAINT bl_zuordnung_pkey PRIMARY KEY (type, rb_id)
);
CREATE INDEX idx_bl_zuordnung_bl ON bl_mapping USING btree (type, bl_id);
CREATE TRIGGER trg_teilekatalog_del AFTER DELETE ON bl_mapping REFERENCING OLD TABLE AS alt FOR EACH STATEMENT EXECUTE FUNCTION merke_teilekatalog_alt();
CREATE TRIGGER trg_teilekatalog_ins AFTER INSERT ON bl_mapping REFERENCING NEW TABLE AS neu FOR EACH STATEMENT EXECUTE FUNCTION merke_teilekatalog_neu();
CREATE TRIGGER trg_teilekatalog_upd AFTER UPDATE ON bl_mapping REFERENCING OLD TABLE AS alt NEW TABLE AS neu FOR EACH STATEMENT EXECUTE FUNCTION merke_teilekatalog_beide();

CREATE TABLE bl_mapping_custom (
  user_id integer NOT NULL,
  type text NOT NULL,
  rb_id text NOT NULL,
  bl_id text NOT NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT bl_zuordnung_eigen_art CHECK ((type = ANY (ARRAY['part'::text, 'fig'::text, 'set'::text]))),
  CONSTRAINT bl_zuordnung_eigen_pkey PRIMARY KEY (user_id, type, rb_id),
  CONSTRAINT bl_zuordnung_eigen_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_bl_zuordnung_eigen_bl ON bl_mapping_custom USING btree (user_id, type, bl_id);
CREATE TRIGGER trg_teilekatalog_del AFTER DELETE ON bl_mapping_custom REFERENCING OLD TABLE AS alt FOR EACH STATEMENT EXECUTE FUNCTION merke_teilekatalog_alt();
CREATE TRIGGER trg_teilekatalog_ins AFTER INSERT ON bl_mapping_custom REFERENCING NEW TABLE AS neu FOR EACH STATEMENT EXECUTE FUNCTION merke_teilekatalog_neu();
CREATE TRIGGER trg_teilekatalog_upd AFTER UPDATE ON bl_mapping_custom REFERENCING OLD TABLE AS alt NEW TABLE AS neu FOR EACH STATEMENT EXECUTE FUNCTION merke_teilekatalog_beide();
ALTER TABLE bl_mapping_custom ENABLE ROW LEVEL SECURITY;
CREATE POLICY zeilenschutz ON bl_mapping_custom USING ((user_id = ANY (( SELECT zeilenschutz_konten() AS zeilenschutz_konten)::integer[]))) WITH CHECK ((user_id = ANY (( SELECT zeilenschutz_konten() AS zeilenschutz_konten)::integer[])));

CREATE TABLE catalog_cache (
  set_number text NOT NULL,
  is_gear boolean NOT NULL DEFAULT false,
  bl_type text,
  fetched_at timestamp with time zone DEFAULT now(),
  CONSTRAINT catalog_cache_pkey PRIMARY KEY (set_number),
  CONSTRAINT catalog_cache_setnummer_mit_version CHECK ((set_number ~ '-[0-9]+$'::text))
);
CREATE TRIGGER catalog_cache_setnummer BEFORE INSERT OR UPDATE OF set_number ON catalog_cache FOR EACH ROW EXECUTE FUNCTION setnummer_normalisieren();

CREATE TABLE device_keys (
  user_id integer NOT NULL,
  token_family timestamp with time zone NOT NULL,
  public_key text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  attested boolean NOT NULL DEFAULT false,
  CONSTRAINT geraete_schluessel_pkey PRIMARY KEY (user_id, token_family),
  CONSTRAINT geraete_schluessel_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
ALTER TABLE device_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY zeilenschutz ON device_keys USING ((user_id = ( SELECT zeilenschutz_konto() AS zeilenschutz_konto))) WITH CHECK ((user_id = ( SELECT zeilenschutz_konto() AS zeilenschutz_konto)));

CREATE TABLE device_nonces (
  nonce text NOT NULL,
  user_id integer NOT NULL,
  token_family timestamp with time zone NOT NULL,
  from_qr boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL,
  CONSTRAINT geraete_nonces_pkey PRIMARY KEY (nonce),
  CONSTRAINT geraete_nonces_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_geraete_nonces_familie ON device_nonces USING btree (user_id, token_family);
ALTER TABLE device_nonces ENABLE ROW LEVEL SECURITY;
CREATE POLICY zeilenschutz ON device_nonces USING ((user_id = ( SELECT zeilenschutz_konto() AS zeilenschutz_konto))) WITH CHECK ((user_id = ( SELECT zeilenschutz_konto() AS zeilenschutz_konto)));

CREATE TABLE exchange_rates (
  day date NOT NULL,
  currency character(3) NOT NULL,
  per_eur numeric NOT NULL,
  CONSTRAINT wechselkurse_je_eur_check CHECK ((per_eur > (0)::numeric)),
  CONSTRAINT wechselkurse_pkey PRIMARY KEY (currency, day),
  CONSTRAINT wechselkurse_waehrung_check CHECK (((currency ~ '^[A-Z]{3}$'::text) AND (currency <> 'EUR'::bpchar)))
);

CREATE TABLE global_settings (
  key text NOT NULL,
  value text NOT NULL,
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT global_settings_pkey PRIMARY KEY (key)
);

CREATE TABLE household_former_links (
  main_user_id integer NOT NULL,
  sub_user_id integer NOT NULL,
  via_user_id integer,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT household_former_links_main_user_id_fkey FOREIGN KEY (main_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT household_former_links_pkey PRIMARY KEY (main_user_id, sub_user_id),
  CONSTRAINT household_former_links_sub_user_id_fkey FOREIGN KEY (sub_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT household_former_links_via_user_id_fkey FOREIGN KEY (via_user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_household_former_sub ON household_former_links USING btree (sub_user_id);
CREATE INDEX idx_household_former_via ON household_former_links USING btree (via_user_id);
ALTER TABLE household_former_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY loesen ON household_former_links FOR DELETE USING (((( SELECT zeilenschutz_konto() AS zeilenschutz_konto) = main_user_id) OR (( SELECT zeilenschutz_konto() AS zeilenschutz_konto) = sub_user_id)));
CREATE POLICY zeilenschutz ON household_former_links FOR SELECT USING (((( SELECT zeilenschutz_konto() AS zeilenschutz_konto) = main_user_id) OR (( SELECT zeilenschutz_konto() AS zeilenschutz_konto) = sub_user_id)));

CREATE TABLE idempotency (
  user_id integer NOT NULL,
  key text NOT NULL,
  request text NOT NULL,
  status integer,
  response text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  has_effect boolean NOT NULL DEFAULT false,
  CONSTRAINT idempotenz_pkey PRIMARY KEY (user_id, key),
  CONSTRAINT idempotenz_schluessel_check CHECK (((length(key) >= 1) AND (length(key) <= 100))),
  CONSTRAINT idempotenz_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_idempotenz_angelegt ON idempotency USING btree (created_at);
ALTER TABLE idempotency ENABLE ROW LEVEL SECURITY;
CREATE POLICY zeilenschutz ON idempotency USING ((user_id = ( SELECT zeilenschutz_konto() AS zeilenschutz_konto))) WITH CHECK ((user_id = ( SELECT zeilenschutz_konto() AS zeilenschutz_konto)));

CREATE TABLE image_misses (
  cache_key text NOT NULL,
  checked_at timestamp with time zone NOT NULL DEFAULT now(),
  reason text,
  CONSTRAINT image_misses_pkey PRIMARY KEY (cache_key)
);

CREATE TABLE image_wanted (
  url text NOT NULL,
  set_number text,
  requested_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT image_wanted_pkey PRIMARY KEY (url)
);
CREATE INDEX idx_image_wanted_alter ON image_wanted USING btree (requested_at);

CREATE TABLE import_status (
  user_id integer NOT NULL,
  status text NOT NULL DEFAULT 'running'::text,
  total integer NOT NULL DEFAULT 0,
  done integer NOT NULL DEFAULT 0,
  current text,
  results jsonb NOT NULL DEFAULT '[]'::jsonb,
  error text,
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  run_id text,
  CONSTRAINT csv_import_jobs_pkey PRIMARY KEY (user_id),
  CONSTRAINT csv_import_jobs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'done'::text, 'error'::text, 'cancelled'::text]))),
  CONSTRAINT csv_import_jobs_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
ALTER TABLE import_status ENABLE ROW LEVEL SECURITY;
CREATE POLICY zeilenschutz ON import_status USING ((user_id = ANY (( SELECT zeilenschutz_konten() AS zeilenschutz_konten)::integer[]))) WITH CHECK ((user_id = ANY (( SELECT zeilenschutz_konten() AS zeilenschutz_konten)::integer[])));

CREATE TABLE instructions (
  id integer NOT NULL DEFAULT nextval('instructions_id_seq'::regclass),
  user_id integer NOT NULL,
  set_number text NOT NULL,
  url text NOT NULL,
  description text,
  local_path text,
  downloaded_at timestamp with time zone DEFAULT now(),
  CONSTRAINT instructions_pkey PRIMARY KEY (id),
  CONSTRAINT instructions_set_fk FOREIGN KEY (user_id, set_number) REFERENCES sets(user_id, set_number) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT instructions_setnummer_mit_version CHECK ((set_number ~ '-[0-9]+$'::text)),
  CONSTRAINT instructions_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_instructions_user ON instructions USING btree (user_id, set_number);
CREATE TRIGGER instructions_setnummer BEFORE INSERT OR UPDATE OF set_number ON instructions FOR EACH ROW EXECUTE FUNCTION setnummer_normalisieren();
ALTER TABLE instructions ENABLE ROW LEVEL SECURITY;
CREATE POLICY zeilenschutz ON instructions USING ((user_id = ANY (( SELECT zeilenschutz_konten() AS zeilenschutz_konten)::integer[]))) WITH CHECK ((user_id = ANY (( SELECT zeilenschutz_konten() AS zeilenschutz_konten)::integer[])));

CREATE TABLE job_exclusive_locks (
  type text NOT NULL,
  CONSTRAINT auftrag_exklusiv_pkey PRIMARY KEY (type)
);

CREATE TABLE job_pauses (
  type text NOT NULL,
  until_at timestamp with time zone NOT NULL,
  reason text,
  level integer NOT NULL DEFAULT 0,
  CONSTRAINT auftrag_pausen_art_fkey FOREIGN KEY (type) REFERENCES job_types(type),
  CONSTRAINT auftrag_pausen_pkey PRIMARY KEY (type)
);

CREATE TABLE job_types (
  type text NOT NULL,
  CONSTRAINT auftrags_arten_pkey PRIMARY KEY (type)
);

CREATE TABLE jobs (
  id bigint NOT NULL DEFAULT nextval('auftraege_id_seq'::regclass),
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  user_id integer,
  dedupe_key text,
  status text NOT NULL DEFAULT 'offen'::text,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  due_at timestamp with time zone NOT NULL DEFAULT now(),
  locked_by text,
  error_message text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  deadline_at timestamp with time zone,
  started_at timestamp with time zone,
  progress jsonb,
  result jsonb,
  waiting boolean NOT NULL DEFAULT false,
  CONSTRAINT auftraege_art_fkey FOREIGN KEY (type) REFERENCES job_types(type),
  CONSTRAINT auftraege_max_versuche_check CHECK ((max_attempts > 0)),
  CONSTRAINT auftraege_pkey PRIMARY KEY (id),
  CONSTRAINT auftraege_status_check CHECK ((status = ANY (ARRAY['offen'::text, 'laeuft'::text, 'erledigt'::text, 'fehler'::text, 'abgebrochen'::text]))),
  CONSTRAINT auftraege_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_auftraege_art ON jobs USING btree (type, status);
CREATE INDEX idx_auftraege_frist ON jobs USING btree (deadline_at) WHERE (status = 'laeuft'::text);
CREATE INDEX idx_auftraege_offen_faellig ON jobs USING btree (due_at) WHERE (status = 'offen'::text);
CREATE UNIQUE INDEX idx_auftraege_schluessel ON jobs USING btree (dedupe_key) WHERE (status = 'offen'::text);
CREATE INDEX idx_auftraege_user ON jobs USING btree (user_id) WHERE (user_id IS NOT NULL);
CREATE TRIGGER auftrag_exklusiv BEFORE UPDATE OF status, locked_by ON jobs FOR EACH ROW WHEN (((new.status = 'laeuft'::text) AND (new.locked_by IS DISTINCT FROM old.locked_by))) EXECUTE FUNCTION auftrag_exklusiv_belegen();
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY zeilenschutz ON jobs USING ((user_id = ANY (( SELECT zeilenschutz_konten() AS zeilenschutz_konten)::integer[]))) WITH CHECK ((user_id = ANY (( SELECT zeilenschutz_konten() AS zeilenschutz_konten)::integer[])));

CREATE TABLE minifig_acquisitions (
  id integer NOT NULL DEFAULT nextval('minifig_acquisitions_id_seq'::regclass),
  user_id integer NOT NULL,
  fig_number text NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  unit_price numeric(12,4),
  condition text NOT NULL DEFAULT 'N'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  currency text NOT NULL,
  price_estimated boolean NOT NULL DEFAULT false,
  day date,
  CONSTRAINT minifig_acquisitions_currency_iso CHECK ((currency ~ '^[A-Z]{3}$'::text)),
  CONSTRAINT minifig_acquisitions_menge_positiv CHECK ((quantity > 0)),
  CONSTRAINT minifig_acquisitions_pkey PRIMARY KEY (id),
  CONSTRAINT minifig_acquisitions_unit_price_nicht_negativ CHECK ((unit_price >= (0)::numeric)),
  CONSTRAINT minifig_acquisitions_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT minifig_acquisitions_zustand CHECK ((condition = ANY (ARRAY['N'::text, 'U'::text])))
);
CREATE UNIQUE INDEX idx_minifig_acq_erfassungstag ON minifig_acquisitions USING btree (user_id, fig_number, COALESCE(day, ((created_at AT TIME ZONE 'UTC'::text))::date), condition, COALESCE(unit_price, ('-1'::integer)::numeric), price_estimated, currency);
CREATE TRIGGER minifig_acquisitions_tag BEFORE INSERT OR UPDATE ON minifig_acquisitions FOR EACH ROW EXECUTE FUNCTION erfassung_tag();
CREATE TRIGGER minifig_acquisitions_waehrung BEFORE INSERT OR UPDATE ON minifig_acquisitions FOR EACH ROW EXECUTE FUNCTION erfassung_waehrung();
ALTER TABLE minifig_acquisitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY zeilenschutz ON minifig_acquisitions USING ((user_id = ANY (( SELECT zeilenschutz_konten() AS zeilenschutz_konten)::integer[]))) WITH CHECK ((user_id = ANY (( SELECT zeilenschutz_konten() AS zeilenschutz_konten)::integer[])));

CREATE TABLE minifig_custom (
  user_id integer NOT NULL,
  fig_number text NOT NULL,
  fig_name text,
  image_url text,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT figur_eigen_pkey PRIMARY KEY (user_id, fig_number),
  CONSTRAINT figur_eigen_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
ALTER TABLE minifig_custom ENABLE ROW LEVEL SECURITY;
CREATE POLICY zeilenschutz ON minifig_custom USING ((user_id = ANY (( SELECT zeilenschutz_konten() AS zeilenschutz_konten)::integer[]))) WITH CHECK ((user_id = ANY (( SELECT zeilenschutz_konten() AS zeilenschutz_konten)::integer[])));

CREATE TABLE minifig_parts_cache (
  fig_number text NOT NULL,
  data text NOT NULL,
  fetched_at timestamp with time zone DEFAULT now(),
  CONSTRAINT minifig_parts_cache_pkey PRIMARY KEY (fig_number)
);

CREATE TABLE minifig_price_cache (
  id integer NOT NULL DEFAULT nextval('minifig_price_cache_id_seq'::regclass),
  fig_number text NOT NULL,
  condition text NOT NULL DEFAULT 'U'::text,
  currency_code text NOT NULL,
  avg_price numeric(12,4),
  qty_avg_price numeric(12,4),
  fetched_at timestamp with time zone DEFAULT now(),
  estimated boolean NOT NULL DEFAULT false,
  coverage numeric(4,3),
  CONSTRAINT minifig_price_cache_avg_price_nicht_negativ CHECK ((avg_price >= (0)::numeric)),
  CONSTRAINT minifig_price_cache_currency_code_iso CHECK ((currency_code ~ '^[A-Z]{3}$'::text)),
  CONSTRAINT minifig_price_cache_fig_number_condition_currency_code_key UNIQUE (fig_number, condition, currency_code),
  CONSTRAINT minifig_price_cache_pkey PRIMARY KEY (id),
  CONSTRAINT minifig_price_cache_qty_avg_price_nicht_negativ CHECK ((qty_avg_price >= (0)::numeric)),
  CONSTRAINT minifig_price_cache_zustand CHECK ((condition = ANY (ARRAY['N'::text, 'U'::text])))
);
CREATE INDEX idx_minifig_price_cache_lookup ON minifig_price_cache USING btree (fig_number, condition, currency_code, fetched_at DESC);

CREATE TABLE minifig_price_history (
  id integer NOT NULL DEFAULT nextval('minifig_price_history_id_seq'::regclass),
  fig_number text NOT NULL,
  condition text NOT NULL DEFAULT 'U'::text,
  currency_code text NOT NULL,
  avg_price numeric(12,4),
  qty_avg_price numeric(12,4),
  recorded_at timestamp with time zone NOT NULL DEFAULT now(),
  estimated boolean NOT NULL DEFAULT false,
  coverage numeric(4,3),
  CONSTRAINT minifig_price_history_avg_price_nicht_negativ CHECK ((avg_price >= (0)::numeric)),
  CONSTRAINT minifig_price_history_currency_code_iso CHECK ((currency_code ~ '^[A-Z]{3}$'::text)),
  CONSTRAINT minifig_price_history_pkey PRIMARY KEY (id),
  CONSTRAINT minifig_price_history_qty_avg_price_nicht_negativ CHECK ((qty_avg_price >= (0)::numeric)),
  CONSTRAINT minifig_price_history_zustand CHECK ((condition = ANY (ARRAY['N'::text, 'U'::text])))
);
CREATE INDEX idx_minifig_price_history_lookup ON minifig_price_history USING btree (fig_number, currency_code, recorded_at);
CREATE UNIQUE INDEX idx_minifig_price_history_tag ON minifig_price_history USING btree (fig_number, condition, currency_code, (((recorded_at AT TIME ZONE 'UTC'::text))::date));

CREATE TABLE minifigs (
  id integer NOT NULL DEFAULT nextval('minifigs_id_seq'::regclass),
  user_id integer NOT NULL,
  set_number text,
  fig_number text NOT NULL,
  source text DEFAULT 'set'::text,
  storage_id integer,
  CONSTRAINT minifigs_pkey PRIMARY KEY (id),
  CONSTRAINT minifigs_set_fk FOREIGN KEY (user_id, set_number) REFERENCES sets(user_id, set_number) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT minifigs_setnummer_mit_version CHECK ((set_number ~ '-[0-9]+$'::text)),
  CONSTRAINT minifigs_source_check CHECK ((source = ANY (ARRAY['set'::text, 'manual'::text]))),
  CONSTRAINT minifigs_storage_id_fkey FOREIGN KEY (user_id, storage_id) REFERENCES storage_locations(user_id, id) ON DELETE SET NULL (storage_id),
  CONSTRAINT minifigs_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX idx_minifigs_eindeutig ON minifigs USING btree (user_id, COALESCE(set_number, ''::text), fig_number);
CREATE INDEX idx_minifigs_set ON minifigs USING btree (user_id, set_number);
CREATE INDEX idx_minifigs_storage_id ON minifigs USING btree (user_id, storage_id) WHERE (storage_id IS NOT NULL);
CREATE INDEX idx_minifigs_storage_ref ON minifigs USING btree (storage_id) WHERE (storage_id IS NOT NULL);
CREATE TRIGGER minifigs_setnummer BEFORE INSERT OR UPDATE OF set_number ON minifigs FOR EACH ROW EXECUTE FUNCTION setnummer_normalisieren();
ALTER TABLE minifigs ENABLE ROW LEVEL SECURITY;
CREATE POLICY zeilenschutz ON minifigs USING ((user_id = ANY (( SELECT zeilenschutz_konten() AS zeilenschutz_konten)::integer[]))) WITH CHECK ((user_id = ANY (( SELECT zeilenschutz_konten() AS zeilenschutz_konten)::integer[])));

CREATE TABLE minifigs_catalog (
  fig_number text NOT NULL,
  fig_name text,
  image_url text,
  image_local text,
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT minifigs_catalog_pkey PRIMARY KEY (fig_number)
);
CREATE INDEX idx_minifigs_catalog_bild_stamm ON minifigs_catalog USING btree (bild_stamm(image_local)) WHERE (image_local IS NOT NULL);
CREATE INDEX idx_minifigs_catalog_name_trgm ON minifigs_catalog USING gin (lower(fig_name) gin_trgm_ops);

CREATE TABLE part_acquisitions (
  id integer NOT NULL DEFAULT nextval('part_acquisitions_id_seq'::regclass),
  user_id integer NOT NULL,
  part_number text NOT NULL,
  color_id integer NOT NULL DEFAULT 9999,
  quantity integer NOT NULL DEFAULT 1,
  unit_price numeric(12,4),
  condition text NOT NULL DEFAULT 'N'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  currency text NOT NULL,
  price_estimated boolean NOT NULL DEFAULT false,
  day date,
  CONSTRAINT part_acquisitions_currency_iso CHECK ((currency ~ '^[A-Z]{3}$'::text)),
  CONSTRAINT part_acquisitions_menge_positiv CHECK ((quantity > 0)),
  CONSTRAINT part_acquisitions_pkey PRIMARY KEY (id),
  CONSTRAINT part_acquisitions_unit_price_nicht_negativ CHECK ((unit_price >= (0)::numeric)),
  CONSTRAINT part_acquisitions_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT part_acquisitions_zustand CHECK ((condition = ANY (ARRAY['N'::text, 'U'::text])))
);
CREATE UNIQUE INDEX idx_part_acq_erfassungstag ON part_acquisitions USING btree (user_id, part_number, color_id, COALESCE(day, ((created_at AT TIME ZONE 'UTC'::text))::date), condition, COALESCE(unit_price, ('-1'::integer)::numeric), price_estimated, currency);
CREATE TRIGGER part_acquisitions_tag BEFORE INSERT OR UPDATE ON part_acquisitions FOR EACH ROW EXECUTE FUNCTION erfassung_tag();
CREATE TRIGGER part_acquisitions_waehrung BEFORE INSERT OR UPDATE ON part_acquisitions FOR EACH ROW EXECUTE FUNCTION erfassung_waehrung();
ALTER TABLE part_acquisitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY zeilenschutz ON part_acquisitions USING ((user_id = ANY (( SELECT zeilenschutz_konten() AS zeilenschutz_konten)::integer[]))) WITH CHECK ((user_id = ANY (( SELECT zeilenschutz_konten() AS zeilenschutz_konten)::integer[])));

CREATE TABLE part_catalog (
  part_number text NOT NULL,
  part_name text,
  category_name text,
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT part_catalog_pkey PRIMARY KEY (part_number)
);
CREATE INDEX idx_part_catalog_category ON part_catalog USING btree (category_name);
CREATE INDEX idx_part_catalog_name_trgm ON part_catalog USING gin (lower(part_name) gin_trgm_ops);
CREATE TRIGGER trg_teilekatalog_del AFTER DELETE ON part_catalog REFERENCING OLD TABLE AS alt FOR EACH STATEMENT EXECUTE FUNCTION merke_teilekatalog_alt();
CREATE TRIGGER trg_teilekatalog_ins AFTER INSERT ON part_catalog REFERENCING NEW TABLE AS neu FOR EACH STATEMENT EXECUTE FUNCTION merke_teilekatalog_neu();
CREATE TRIGGER trg_teilekatalog_upd AFTER UPDATE ON part_catalog REFERENCING OLD TABLE AS alt NEW TABLE AS neu FOR EACH STATEMENT EXECUTE FUNCTION merke_teilekatalog_beide();

CREATE TABLE part_color_catalog (
  part_number text NOT NULL,
  color_id integer NOT NULL,
  color_name text,
  color_hex text,
  image_url text,
  image_local text,
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT part_color_catalog_pkey PRIMARY KEY (part_number, color_id)
);
CREATE INDEX idx_part_color_catalog_bild_stamm ON part_color_catalog USING btree (bild_stamm(image_local)) WHERE (image_local IS NOT NULL);
CREATE TRIGGER trg_teilekatalog_del AFTER DELETE ON part_color_catalog REFERENCING OLD TABLE AS alt FOR EACH STATEMENT EXECUTE FUNCTION merke_teilekatalog_alt();
CREATE TRIGGER trg_teilekatalog_ins AFTER INSERT ON part_color_catalog REFERENCING NEW TABLE AS neu FOR EACH STATEMENT EXECUTE FUNCTION merke_teilekatalog_neu();
CREATE TRIGGER trg_teilekatalog_upd AFTER UPDATE ON part_color_catalog REFERENCING OLD TABLE AS alt NEW TABLE AS neu FOR EACH STATEMENT EXECUTE FUNCTION merke_teilekatalog_beide();

CREATE TABLE part_color_custom (
  user_id integer NOT NULL,
  part_number text NOT NULL,
  color_id integer NOT NULL,
  color_name text,
  color_hex text,
  image_url text,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT teil_farbe_eigen_pkey PRIMARY KEY (user_id, part_number, color_id),
  CONSTRAINT teil_farbe_eigen_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TRIGGER trg_teilekatalog_del AFTER DELETE ON part_color_custom REFERENCING OLD TABLE AS alt FOR EACH STATEMENT EXECUTE FUNCTION merke_teilekatalog_alt();
CREATE TRIGGER trg_teilekatalog_ins AFTER INSERT ON part_color_custom REFERENCING NEW TABLE AS neu FOR EACH STATEMENT EXECUTE FUNCTION merke_teilekatalog_neu();
CREATE TRIGGER trg_teilekatalog_upd AFTER UPDATE ON part_color_custom REFERENCING OLD TABLE AS alt NEW TABLE AS neu FOR EACH STATEMENT EXECUTE FUNCTION merke_teilekatalog_beide();
ALTER TABLE part_color_custom ENABLE ROW LEVEL SECURITY;
CREATE POLICY zeilenschutz ON part_color_custom USING ((user_id = ANY (( SELECT zeilenschutz_konten() AS zeilenschutz_konten)::integer[]))) WITH CHECK ((user_id = ANY (( SELECT zeilenschutz_konten() AS zeilenschutz_konten)::integer[])));

CREATE TABLE part_custom (
  user_id integer NOT NULL,
  part_number text NOT NULL,
  part_name text,
  category_name text,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT teil_eigen_pkey PRIMARY KEY (user_id, part_number),
  CONSTRAINT teil_eigen_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TRIGGER trg_teilekatalog_del AFTER DELETE ON part_custom REFERENCING OLD TABLE AS alt FOR EACH STATEMENT EXECUTE FUNCTION merke_teilekatalog_alt();
CREATE TRIGGER trg_teilekatalog_ins AFTER INSERT ON part_custom REFERENCING NEW TABLE AS neu FOR EACH STATEMENT EXECUTE FUNCTION merke_teilekatalog_neu();
CREATE TRIGGER trg_teilekatalog_upd AFTER UPDATE ON part_custom REFERENCING OLD TABLE AS alt NEW TABLE AS neu FOR EACH STATEMENT EXECUTE FUNCTION merke_teilekatalog_beide();
ALTER TABLE part_custom ENABLE ROW LEVEL SECURITY;
CREATE POLICY zeilenschutz ON part_custom USING ((user_id = ANY (( SELECT zeilenschutz_konten() AS zeilenschutz_konten)::integer[]))) WITH CHECK ((user_id = ANY (( SELECT zeilenschutz_konten() AS zeilenschutz_konten)::integer[])));

CREATE TABLE part_price_cache (
  id integer NOT NULL DEFAULT nextval('part_price_cache_id_seq'::regclass),
  part_number text NOT NULL,
  color_id integer NOT NULL DEFAULT 0,
  condition text NOT NULL DEFAULT 'U'::text,
  currency_code text NOT NULL,
  avg_price numeric(12,4),
  qty_avg_price numeric(12,4),
  fetched_at timestamp with time zone DEFAULT now(),
  CONSTRAINT part_price_cache_avg_price_nicht_negativ CHECK ((avg_price >= (0)::numeric)),
  CONSTRAINT part_price_cache_currency_code_iso CHECK ((currency_code ~ '^[A-Z]{3}$'::text)),
  CONSTRAINT part_price_cache_part_number_color_id_condition_currency_co_key UNIQUE (part_number, color_id, condition, currency_code),
  CONSTRAINT part_price_cache_pkey PRIMARY KEY (id),
  CONSTRAINT part_price_cache_qty_avg_price_nicht_negativ CHECK ((qty_avg_price >= (0)::numeric)),
  CONSTRAINT part_price_cache_zustand CHECK ((condition = ANY (ARRAY['N'::text, 'U'::text])))
);
CREATE INDEX idx_part_price_cache_lookup ON part_price_cache USING btree (part_number, color_id, condition, currency_code, fetched_at DESC);

CREATE TABLE part_price_history (
  id integer NOT NULL DEFAULT nextval('part_price_history_id_seq'::regclass),
  part_number text NOT NULL,
  color_id integer NOT NULL DEFAULT 0,
  condition text NOT NULL DEFAULT 'U'::text,
  currency_code text NOT NULL,
  avg_price numeric(12,4),
  qty_avg_price numeric(12,4),
  recorded_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT part_price_history_avg_price_nicht_negativ CHECK ((avg_price >= (0)::numeric)),
  CONSTRAINT part_price_history_currency_code_iso CHECK ((currency_code ~ '^[A-Z]{3}$'::text)),
  CONSTRAINT part_price_history_pkey PRIMARY KEY (id),
  CONSTRAINT part_price_history_qty_avg_price_nicht_negativ CHECK ((qty_avg_price >= (0)::numeric)),
  CONSTRAINT part_price_history_zustand CHECK ((condition = ANY (ARRAY['N'::text, 'U'::text])))
);
CREATE INDEX idx_part_price_history_lookup ON part_price_history USING btree (part_number, color_id, currency_code, recorded_at);
CREATE UNIQUE INDEX idx_part_price_history_tag ON part_price_history USING btree (part_number, color_id, condition, currency_code, (((recorded_at AT TIME ZONE 'UTC'::text))::date));

CREATE TABLE parts (
  id integer NOT NULL DEFAULT nextval('parts_id_seq'::regclass),
  user_id integer NOT NULL,
  set_number text,
  part_number text NOT NULL,
  color_id integer NOT NULL DEFAULT 9999,
  source text DEFAULT 'set'::text,
  storage_id integer,
  added_at timestamp with time zone DEFAULT now(),
  CONSTRAINT parts_pkey PRIMARY KEY (id),
  CONSTRAINT parts_set_fk FOREIGN KEY (user_id, set_number) REFERENCES sets(user_id, set_number) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT parts_setnummer_mit_version CHECK ((set_number ~ '-[0-9]+$'::text)),
  CONSTRAINT parts_source_check CHECK ((source = ANY (ARRAY['set'::text, 'manual'::text]))),
  CONSTRAINT parts_storage_id_fkey FOREIGN KEY (user_id, storage_id) REFERENCES storage_locations(user_id, id) ON DELETE SET NULL (storage_id),
  CONSTRAINT parts_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_parts_color_id ON parts USING btree (user_id, color_id);
CREATE UNIQUE INDEX idx_parts_eindeutig ON parts USING btree (user_id, COALESCE(set_number, ''::text), part_number, color_id);
CREATE INDEX idx_parts_gruppe ON parts USING btree (user_id, part_number, color_id);
CREATE INDEX idx_parts_number_trgm ON parts USING gin (lower(part_number) gin_trgm_ops);
CREATE INDEX idx_parts_set ON parts USING btree (user_id, set_number);
CREATE INDEX idx_parts_storage_id ON parts USING btree (user_id, storage_id) WHERE (storage_id IS NOT NULL);
CREATE INDEX idx_parts_storage_ref ON parts USING btree (storage_id) WHERE (storage_id IS NOT NULL);
CREATE TRIGGER parts_setnummer BEFORE INSERT OR UPDATE OF set_number ON parts FOR EACH ROW EXECUTE FUNCTION setnummer_normalisieren();
CREATE TRIGGER trg_bump_parts_version_del AFTER DELETE ON parts REFERENCING OLD TABLE AS alt FOR EACH STATEMENT EXECUTE FUNCTION bump_parts_version_del();
CREATE TRIGGER trg_bump_parts_version_ins AFTER INSERT ON parts REFERENCING NEW TABLE AS neu FOR EACH STATEMENT EXECUTE FUNCTION bump_parts_version_ins();
CREATE TRIGGER trg_bump_parts_version_upd AFTER UPDATE ON parts REFERENCING OLD TABLE AS alt NEW TABLE AS neu FOR EACH STATEMENT EXECUTE FUNCTION bump_parts_version_upd();
ALTER TABLE parts ENABLE ROW LEVEL SECURITY;
CREATE POLICY zeilenschutz ON parts USING ((user_id = ANY (( SELECT zeilenschutz_konten() AS zeilenschutz_konten)::integer[]))) WITH CHECK ((user_id = ANY (( SELECT zeilenschutz_konten() AS zeilenschutz_konten)::integer[])));

CREATE TABLE parts_catalog_pending (
  id bigint NOT NULL DEFAULT nextval('parts_katalog_offen_id_seq'::regclass),
  number text NOT NULL,
  CONSTRAINT parts_katalog_offen_pkey PRIMARY KEY (id)
);

CREATE TABLE parts_summary (
  user_id integer NOT NULL,
  part_key text NOT NULL,
  color_id integer NOT NULL,
  part_number text,
  bl_part_number text,
  part_name text,
  color_name text,
  color_hex text,
  category_name text,
  image_url text,
  image_local text,
  is_spare boolean NOT NULL DEFAULT false,
  total_quantity bigint DEFAULT 0,
  in_sets text,
  storage text,
  CONSTRAINT parts_summary_pkey PRIMARY KEY (user_id, part_key, color_id),
  CONSTRAINT parts_summary_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_parts_summary_cat ON parts_summary USING btree (user_id, category_name);
CREATE INDEX idx_parts_summary_color ON parts_summary USING btree (user_id, color_id);
CREATE INDEX idx_parts_summary_sort ON parts_summary USING btree (user_id, color_name, part_name);
CREATE INDEX idx_psum_blnumber_trgm ON parts_summary USING gin (bl_part_number gin_trgm_ops) WITH (fastupdate=off);
CREATE INDEX idx_psum_name_trgm ON parts_summary USING gin (part_name gin_trgm_ops) WITH (fastupdate=off);
CREATE INDEX idx_psum_number_trgm ON parts_summary USING gin (part_number gin_trgm_ops) WITH (fastupdate=off);
ALTER TABLE parts_summary ENABLE ROW LEVEL SECURITY;
CREATE POLICY zeilenschutz ON parts_summary USING ((user_id = ANY (( SELECT zeilenschutz_konten() AS zeilenschutz_konten)::integer[]))) WITH CHECK ((user_id = ANY (( SELECT zeilenschutz_konten() AS zeilenschutz_konten)::integer[])));

CREATE TABLE parts_summary_state (
  user_id integer NOT NULL,
  built_version bigint NOT NULL DEFAULT 0,
  built_at timestamp with time zone DEFAULT now(),
  CONSTRAINT parts_summary_state_pkey PRIMARY KEY (user_id),
  CONSTRAINT parts_summary_state_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
ALTER TABLE parts_summary_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY zeilenschutz ON parts_summary_state USING ((user_id = ANY (( SELECT zeilenschutz_konten() AS zeilenschutz_konten)::integer[]))) WITH CHECK ((user_id = ANY (( SELECT zeilenschutz_konten() AS zeilenschutz_konten)::integer[])));

CREATE TABLE parts_version_user (
  user_id integer NOT NULL,
  v bigint NOT NULL DEFAULT 0,
  CONSTRAINT parts_version_user_pkey PRIMARY KEY (user_id),
  CONSTRAINT parts_version_user_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
ALTER TABLE parts_version_user ENABLE ROW LEVEL SECURITY;
CREATE POLICY zeilenschutz ON parts_version_user USING ((user_id = ANY (( SELECT zeilenschutz_konten() AS zeilenschutz_konten)::integer[]))) WITH CHECK ((user_id = ANY (( SELECT zeilenschutz_konten() AS zeilenschutz_konten)::integer[])));

CREATE TABLE passkeys (
  id integer NOT NULL DEFAULT nextval('passkeys_id_seq'::regclass),
  user_id integer NOT NULL,
  credential_id text NOT NULL,
  public_key bytea NOT NULL,
  sign_count bigint NOT NULL DEFAULT 0,
  transports text,
  name text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  last_used timestamp with time zone,
  CONSTRAINT passkeys_credential_id_key UNIQUE (credential_id),
  CONSTRAINT passkeys_pkey PRIMARY KEY (id),
  CONSTRAINT passkeys_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_passkeys_konto ON passkeys USING btree (user_id);
ALTER TABLE passkeys ENABLE ROW LEVEL SECURITY;
CREATE POLICY zeilenschutz ON passkeys USING ((user_id = ( SELECT zeilenschutz_konto() AS zeilenschutz_konto))) WITH CHECK ((user_id = ( SELECT zeilenschutz_konto() AS zeilenschutz_konto)));

CREATE TABLE price_alerts (
  user_id integer NOT NULL,
  set_number text NOT NULL,
  condition text NOT NULL DEFAULT 'N'::text,
  direction text NOT NULL,
  threshold numeric(12,4) NOT NULL,
  currency_code text NOT NULL,
  triggered boolean NOT NULL DEFAULT false,
  last_triggered_at timestamp with time zone,
  last_price numeric(12,4),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT price_alerts_currency_code_iso CHECK ((currency_code ~ '^[A-Z]{3}$'::text)),
  CONSTRAINT price_alerts_pkey PRIMARY KEY (user_id, set_number, condition),
  CONSTRAINT price_alerts_richtung CHECK ((direction = ANY (ARRAY['unter'::text, 'ueber'::text]))),
  CONSTRAINT price_alerts_schwelle CHECK ((threshold > (0)::numeric)),
  CONSTRAINT price_alerts_setnummer_mit_version CHECK ((set_number ~ '-[0-9]+$'::text)),
  CONSTRAINT price_alerts_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT price_alerts_zustand CHECK ((condition = ANY (ARRAY['N'::text, 'U'::text])))
);
CREATE INDEX idx_price_alerts_set ON price_alerts USING btree (set_number, condition);
CREATE TRIGGER price_alerts_setnummer BEFORE INSERT OR UPDATE OF set_number ON price_alerts FOR EACH ROW EXECUTE FUNCTION setnummer_normalisieren();
ALTER TABLE price_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY zeilenschutz ON price_alerts USING ((user_id = ANY (( SELECT zeilenschutz_konten() AS zeilenschutz_konten)::integer[]))) WITH CHECK ((user_id = ANY (( SELECT zeilenschutz_konten() AS zeilenschutz_konten)::integer[])));

CREATE TABLE price_cache (
  id integer NOT NULL DEFAULT nextval('price_cache_id_seq'::regclass),
  set_number text NOT NULL,
  condition text NOT NULL DEFAULT 'N'::text,
  currency_code text NOT NULL,
  min_price numeric(12,4),
  avg_price numeric(12,4),
  max_price numeric(12,4),
  qty_avg_price numeric(12,4),
  total_quantity integer,
  fetched_at timestamp with time zone DEFAULT now(),
  CONSTRAINT price_cache_avg_price_nicht_negativ CHECK ((avg_price >= (0)::numeric)),
  CONSTRAINT price_cache_currency_code_iso CHECK ((currency_code ~ '^[A-Z]{3}$'::text)),
  CONSTRAINT price_cache_max_price_nicht_negativ CHECK ((max_price >= (0)::numeric)),
  CONSTRAINT price_cache_min_price_nicht_negativ CHECK ((min_price >= (0)::numeric)),
  CONSTRAINT price_cache_pkey PRIMARY KEY (id),
  CONSTRAINT price_cache_qty_avg_price_nicht_negativ CHECK ((qty_avg_price >= (0)::numeric)),
  CONSTRAINT price_cache_set_number_condition_currency_code_key UNIQUE (set_number, condition, currency_code),
  CONSTRAINT price_cache_zustand CHECK ((condition = ANY (ARRAY['N'::text, 'U'::text])))
);
CREATE INDEX idx_price_cache_lookup ON price_cache USING btree (set_number, condition, currency_code, fetched_at DESC);

CREATE TABLE price_history (
  id integer NOT NULL DEFAULT nextval('price_history_id_seq'::regclass),
  set_number text NOT NULL,
  condition text NOT NULL DEFAULT 'N'::text,
  currency_code text NOT NULL,
  avg_price numeric(12,4),
  qty_avg_price numeric(12,4),
  min_price numeric(12,4),
  max_price numeric(12,4),
  recorded_at timestamp with time zone DEFAULT now(),
  CONSTRAINT price_history_avg_price_nicht_negativ CHECK ((avg_price >= (0)::numeric)),
  CONSTRAINT price_history_currency_code_iso CHECK ((currency_code ~ '^[A-Z]{3}$'::text)),
  CONSTRAINT price_history_max_price_nicht_negativ CHECK ((max_price >= (0)::numeric)),
  CONSTRAINT price_history_min_price_nicht_negativ CHECK ((min_price >= (0)::numeric)),
  CONSTRAINT price_history_pkey PRIMARY KEY (id),
  CONSTRAINT price_history_qty_avg_price_nicht_negativ CHECK ((qty_avg_price >= (0)::numeric)),
  CONSTRAINT price_history_zustand CHECK ((condition = ANY (ARRAY['N'::text, 'U'::text])))
);
CREATE INDEX idx_price_history_set ON price_history USING btree (set_number, recorded_at);
CREATE UNIQUE INDEX idx_price_history_tag ON price_history USING btree (set_number, condition, currency_code, (((recorded_at AT TIME ZONE 'UTC'::text))::date));

CREATE TABLE qr_login_tokens (
  token text NOT NULL,
  user_id integer NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  used_at timestamp with time zone,
  token_days integer,
  id bigint NOT NULL,
  pickup_code text,
  code_hash text,
  device text,
  ip_range text,
  failed_attempts integer NOT NULL DEFAULT 0,
  confirmed_at timestamp with time zone,
  rejected_at timestamp with time zone,
  picked_up_at timestamp with time zone,
  CONSTRAINT qr_login_tokens_pkey PRIMARY KEY (token),
  CONSTRAINT qr_login_tokens_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX idx_qr_login_abholung ON qr_login_tokens USING btree (pickup_code) WHERE (pickup_code IS NOT NULL);
CREATE INDEX idx_qr_login_expires ON qr_login_tokens USING btree (expires_at);
CREATE UNIQUE INDEX idx_qr_login_id ON qr_login_tokens USING btree (id);
CREATE INDEX idx_qr_login_user ON qr_login_tokens USING btree (user_id);
ALTER TABLE qr_login_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY zeilenschutz ON qr_login_tokens USING ((user_id = ( SELECT zeilenschutz_konto() AS zeilenschutz_konto))) WITH CHECK ((user_id = ( SELECT zeilenschutz_konto() AS zeilenschutz_konto)));

CREATE TABLE rate_limit_attempts (
  key text NOT NULL,
  count integer NOT NULL DEFAULT 1,
  first_at timestamp with time zone NOT NULL DEFAULT now(),
  last_at timestamp with time zone,
  ongoing integer NOT NULL DEFAULT 0,
  ongoing_since timestamp with time zone,
  CONSTRAINT rate_limit_attempts_pkey PRIMARY KEY (key)
);
CREATE INDEX idx_rate_limit_first_at ON rate_limit_attempts USING btree (first_at);

CREATE TABLE rb_colors (
  id integer NOT NULL,
  name text,
  rgb text,
  is_trans boolean NOT NULL DEFAULT false,
  bl_color_id integer,
  CONSTRAINT rb_colors_pkey PRIMARY KEY (id)
);

CREATE TABLE rb_inventories (
  id integer NOT NULL,
  set_num text,
  version integer,
  CONSTRAINT rb_inventories_pkey PRIMARY KEY (id),
  CONSTRAINT rb_inventories_setnummer_mit_version CHECK ((set_num ~ '-[0-9]+$'::text))
);
CREATE INDEX idx_rb_inv_setnum ON rb_inventories USING btree (set_num);
CREATE TRIGGER rb_inventories_setnummer BEFORE INSERT OR UPDATE OF set_num ON rb_inventories FOR EACH ROW EXECUTE FUNCTION setnum_normalisieren();

CREATE TABLE rb_inventory_minifigs (
  id integer NOT NULL DEFAULT nextval('rb_inventory_minifigs_id_seq'::regclass),
  inventory_id integer NOT NULL,
  fig_num text NOT NULL,
  quantity integer,
  CONSTRAINT rb_inventory_minifigs_pkey PRIMARY KEY (id)
);
CREATE INDEX idx_rb_inv_minifigs_inv ON rb_inventory_minifigs USING btree (inventory_id);

CREATE TABLE rb_inventory_parts (
  id integer NOT NULL DEFAULT nextval('rb_inventory_parts_id_seq'::regclass),
  inventory_id integer NOT NULL,
  part_num text NOT NULL,
  color_id integer,
  quantity integer,
  is_spare boolean NOT NULL DEFAULT false,
  img_url text,
  CONSTRAINT rb_inventory_parts_pkey PRIMARY KEY (id)
);
CREATE INDEX idx_rb_inv_parts ON rb_inventory_parts USING btree (inventory_id);

CREATE TABLE rb_part_categories (
  id integer NOT NULL,
  name text,
  CONSTRAINT rb_part_categories_pkey PRIMARY KEY (id)
);

CREATE TABLE rb_parts (
  part_num text NOT NULL,
  name text,
  part_cat_id integer,
  part_img_url text,
  CONSTRAINT rb_parts_pkey PRIMARY KEY (part_num)
);

CREATE TABLE rb_sets (
  set_num text NOT NULL,
  name text,
  year integer,
  theme_id integer,
  num_parts integer,
  set_img_url text,
  source text NOT NULL DEFAULT 'csv'::text,
  CONSTRAINT rb_sets_herkunft CHECK ((source = ANY (ARRAY['csv'::text, 'api'::text]))),
  CONSTRAINT rb_sets_pkey PRIMARY KEY (set_num)
);
CREATE INDEX idx_rb_sets_name_trgm ON rb_sets USING gin (name gin_trgm_ops);
CREATE INDEX idx_rb_sets_setnum_trgm ON rb_sets USING gin (set_num gin_trgm_ops);
CREATE INDEX idx_rb_sets_theme_year ON rb_sets USING btree (theme_id, year);
CREATE INDEX idx_rb_sets_year ON rb_sets USING btree (year);

CREATE TABLE rb_themes (
  id integer NOT NULL,
  name text,
  parent_id integer,
  CONSTRAINT rb_themes_pkey PRIMARY KEY (id)
);

CREATE TABLE run_state (
  key text NOT NULL,
  value text NOT NULL DEFAULT ''::text,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT laufzustand_pkey PRIMARY KEY (key)
);

CREATE TABLE schema_migrations (
  name text NOT NULL,
  applied_at timestamp with time zone NOT NULL DEFAULT now(),
  pruefsumme text,
  CONSTRAINT schema_migrations_pkey PRIMARY KEY (name)
);

CREATE TABLE second_factor (
  user_id integer NOT NULL,
  secret text NOT NULL,
  active boolean NOT NULL DEFAULT false,
  last_step bigint NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT zweiter_faktor_pkey PRIMARY KEY (user_id),
  CONSTRAINT zweiter_faktor_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
ALTER TABLE second_factor ENABLE ROW LEVEL SECURITY;
CREATE POLICY zeilenschutz ON second_factor USING ((user_id = ( SELECT zeilenschutz_konto() AS zeilenschutz_konto))) WITH CHECK ((user_id = ( SELECT zeilenschutz_konto() AS zeilenschutz_konto)));

CREATE TABLE second_factor_codes (
  id integer NOT NULL DEFAULT nextval('zweiter_faktor_codes_id_seq'::regclass),
  user_id integer NOT NULL,
  code_hash text NOT NULL,
  consumed_at timestamp with time zone,
  old_valid_until timestamp with time zone,
  CONSTRAINT zweiter_faktor_codes_pkey PRIMARY KEY (id),
  CONSTRAINT zweiter_faktor_codes_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_zweiter_faktor_codes_konto ON second_factor_codes USING btree (user_id);
ALTER TABLE second_factor_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY zeilenschutz ON second_factor_codes USING ((user_id = ( SELECT zeilenschutz_konto() AS zeilenschutz_konto))) WITH CHECK ((user_id = ( SELECT zeilenschutz_konto() AS zeilenschutz_konto)));

CREATE TABLE set_acquisitions (
  id integer NOT NULL DEFAULT nextval('set_acquisitions_id_seq'::regclass),
  user_id integer NOT NULL,
  set_number text NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  purchase_price numeric(12,4),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  condition text NOT NULL DEFAULT 'N'::text,
  currency text NOT NULL,
  price_estimated boolean NOT NULL DEFAULT false,
  day date,
  CONSTRAINT set_acquisitions_bestand_fkey FOREIGN KEY (user_id, set_number) REFERENCES sets(user_id, set_number) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT set_acquisitions_currency_iso CHECK ((currency ~ '^[A-Z]{3}$'::text)),
  CONSTRAINT set_acquisitions_menge_positiv CHECK ((quantity > 0)),
  CONSTRAINT set_acquisitions_pkey PRIMARY KEY (id),
  CONSTRAINT set_acquisitions_purchase_price_nicht_negativ CHECK ((purchase_price >= (0)::numeric)),
  CONSTRAINT set_acquisitions_setnummer_mit_version CHECK ((set_number ~ '-[0-9]+$'::text)),
  CONSTRAINT set_acquisitions_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT set_acquisitions_zustand CHECK ((condition = ANY (ARRAY['N'::text, 'U'::text])))
);
CREATE UNIQUE INDEX idx_set_acq_erfassungstag ON set_acquisitions USING btree (user_id, set_number, COALESCE(day, ((created_at AT TIME ZONE 'UTC'::text))::date), condition, COALESCE(purchase_price, ('-1'::integer)::numeric), price_estimated, currency);
CREATE TRIGGER set_acquisitions_setnummer BEFORE INSERT OR UPDATE OF set_number ON set_acquisitions FOR EACH ROW EXECUTE FUNCTION setnummer_normalisieren();
CREATE TRIGGER set_acquisitions_tag BEFORE INSERT OR UPDATE ON set_acquisitions FOR EACH ROW EXECUTE FUNCTION erfassung_tag();
CREATE TRIGGER set_acquisitions_waehrung BEFORE INSERT OR UPDATE ON set_acquisitions FOR EACH ROW EXECUTE FUNCTION erfassung_waehrung();
CREATE TRIGGER trg_bump_parts_version_del AFTER DELETE ON set_acquisitions REFERENCING OLD TABLE AS alt FOR EACH STATEMENT EXECUTE FUNCTION bump_parts_version_del();
CREATE TRIGGER trg_bump_parts_version_ins AFTER INSERT ON set_acquisitions REFERENCING NEW TABLE AS neu FOR EACH STATEMENT EXECUTE FUNCTION bump_parts_version_ins();
CREATE TRIGGER trg_bump_parts_version_upd AFTER UPDATE ON set_acquisitions REFERENCING OLD TABLE AS alt NEW TABLE AS neu FOR EACH STATEMENT EXECUTE FUNCTION bump_parts_version_erfassung_upd();
ALTER TABLE set_acquisitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY zeilenschutz ON set_acquisitions USING ((user_id = ANY (( SELECT zeilenschutz_konten() AS zeilenschutz_konten)::integer[]))) WITH CHECK ((user_id = ANY (( SELECT zeilenschutz_konten() AS zeilenschutz_konten)::integer[])));

CREATE TABLE set_catalog (
  set_number text NOT NULL,
  minifigs integer,
  image_url text,
  image_local text,
  brickset_id integer,
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT set_catalog_pkey PRIMARY KEY (set_number),
  CONSTRAINT set_catalog_rb_sets_fkey FOREIGN KEY (set_number) REFERENCES rb_sets(set_num) ON DELETE CASCADE,
  CONSTRAINT set_catalog_setnummer_mit_version CHECK ((set_number ~ '-[0-9]+$'::text))
);
CREATE INDEX idx_set_catalog_bild_stamm ON set_catalog USING btree (bild_stamm(image_local)) WHERE (image_local IS NOT NULL);
CREATE TRIGGER set_catalog_setnummer BEFORE INSERT OR UPDATE OF set_number ON set_catalog FOR EACH ROW EXECUTE FUNCTION setnummer_normalisieren();

CREATE TABLE set_minifigs (
  set_number text NOT NULL,
  fig_number text NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT set_figuren_menge_positiv CHECK ((quantity > 0)),
  CONSTRAINT set_figuren_pkey PRIMARY KEY (set_number, fig_number),
  CONSTRAINT set_figuren_setnummer_mit_version CHECK ((set_number ~ '-[0-9]+$'::text))
);
CREATE INDEX idx_set_figuren_fig ON set_minifigs USING btree (fig_number);
CREATE TRIGGER set_figuren_setnummer BEFORE INSERT OR UPDATE OF set_number ON set_minifigs FOR EACH ROW EXECUTE FUNCTION setnummer_normalisieren();

CREATE TABLE set_parts (
  set_number text NOT NULL,
  part_number text NOT NULL,
  color_id integer NOT NULL,
  is_spare boolean NOT NULL DEFAULT false,
  quantity integer DEFAULT 1,
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT set_teile_pkey PRIMARY KEY (set_number, part_number, color_id),
  CONSTRAINT set_teile_setnummer_mit_version CHECK ((set_number ~ '-[0-9]+$'::text))
);
CREATE TRIGGER set_teile_setnummer BEFORE INSERT OR UPDATE OF set_number ON set_parts FOR EACH ROW EXECUTE FUNCTION setnummer_normalisieren();
CREATE TRIGGER trg_teilekatalog_del AFTER DELETE ON set_parts REFERENCING OLD TABLE AS alt FOR EACH STATEMENT EXECUTE FUNCTION merke_teilekatalog_alt();
CREATE TRIGGER trg_teilekatalog_ins AFTER INSERT ON set_parts REFERENCING NEW TABLE AS neu FOR EACH STATEMENT EXECUTE FUNCTION merke_teilekatalog_neu();
CREATE TRIGGER trg_teilekatalog_upd AFTER UPDATE ON set_parts REFERENCING OLD TABLE AS alt NEW TABLE AS neu FOR EACH STATEMENT EXECUTE FUNCTION merke_teilekatalog_beide();

CREATE TABLE sets (
  id integer NOT NULL DEFAULT nextval('sets_id_seq'::regclass),
  user_id integer NOT NULL,
  set_number text NOT NULL,
  added_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  storage_id integer,
  CONSTRAINT sets_pkey PRIMARY KEY (id),
  CONSTRAINT sets_setnummer_mit_version CHECK ((set_number ~ '-[0-9]+$'::text)),
  CONSTRAINT sets_storage_id_fkey FOREIGN KEY (user_id, storage_id) REFERENCES storage_locations(user_id, id) ON DELETE SET NULL (storage_id),
  CONSTRAINT sets_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT sets_user_id_set_number_key UNIQUE (user_id, set_number)
);
CREATE INDEX idx_sets_setnum ON sets USING btree (set_number);
CREATE INDEX idx_sets_storage_id ON sets USING btree (user_id, storage_id) WHERE (storage_id IS NOT NULL);
CREATE INDEX idx_sets_storage_ref ON sets USING btree (storage_id) WHERE (storage_id IS NOT NULL);
CREATE TRIGGER sets_setnummer BEFORE INSERT OR UPDATE OF set_number ON sets FOR EACH ROW EXECUTE FUNCTION setnummer_normalisieren();
CREATE TRIGGER trg_bump_parts_version_del AFTER DELETE ON sets REFERENCING OLD TABLE AS alt FOR EACH STATEMENT EXECUTE FUNCTION bump_parts_version_del();
CREATE TRIGGER trg_bump_parts_version_ins AFTER INSERT ON sets REFERENCING NEW TABLE AS neu FOR EACH STATEMENT EXECUTE FUNCTION bump_parts_version_ins();
CREATE TRIGGER trg_bump_parts_version_upd AFTER UPDATE ON sets REFERENCING OLD TABLE AS alt NEW TABLE AS neu FOR EACH STATEMENT EXECUTE FUNCTION bump_parts_version_upd();
ALTER TABLE sets ENABLE ROW LEVEL SECURITY;
CREATE POLICY zeilenschutz ON sets USING ((user_id = ANY (( SELECT zeilenschutz_konten() AS zeilenschutz_konten)::integer[]))) WITH CHECK ((user_id = ANY (( SELECT zeilenschutz_konten() AS zeilenschutz_konten)::integer[])));

CREATE TABLE shared_instructions (
  id integer NOT NULL DEFAULT nextval('shared_instructions_id_seq'::regclass),
  set_number text NOT NULL,
  url text NOT NULL,
  description text,
  local_path text,
  fetched_at timestamp with time zone DEFAULT now(),
  CONSTRAINT shared_instructions_pkey PRIMARY KEY (id),
  CONSTRAINT shared_instructions_set_number_url_key UNIQUE (set_number, url)
);

CREATE TABLE step_up_approvals (
  user_id integer NOT NULL,
  token_family timestamp with time zone NOT NULL,
  action text NOT NULL,
  until_at timestamp with time zone NOT NULL,
  max_until timestamp with time zone NOT NULL,
  CONSTRAINT schritt_freigaben_aktion_check CHECK ((action = ANY (ARRAY['gutschein'::text, 'verwaltung'::text, 'zweiter_faktor'::text]))),
  CONSTRAINT schritt_freigaben_pkey PRIMARY KEY (user_id, token_family, action),
  CONSTRAINT schritt_freigaben_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
ALTER TABLE step_up_approvals ENABLE ROW LEVEL SECURITY;
CREATE POLICY zeilenschutz ON step_up_approvals USING ((user_id = ( SELECT zeilenschutz_konto() AS zeilenschutz_konto))) WITH CHECK ((user_id = ( SELECT zeilenschutz_konto() AS zeilenschutz_konto)));

CREATE TABLE step_up_challenges (
  challenge text NOT NULL,
  user_id integer NOT NULL,
  token_family timestamp with time zone NOT NULL,
  action text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL,
  CONSTRAINT schritt_challenges_aktion_check CHECK ((action = ANY (ARRAY['gutschein'::text, 'verwaltung'::text, 'zweiter_faktor'::text]))),
  CONSTRAINT schritt_challenges_pkey PRIMARY KEY (challenge),
  CONSTRAINT schritt_challenges_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_schritt_challenges_familie ON step_up_challenges USING btree (user_id, token_family);
ALTER TABLE step_up_challenges ENABLE ROW LEVEL SECURITY;
CREATE POLICY zeilenschutz ON step_up_challenges USING ((user_id = ( SELECT zeilenschutz_konto() AS zeilenschutz_konto))) WITH CHECK ((user_id = ( SELECT zeilenschutz_konto() AS zeilenschutz_konto)));

CREATE TABLE storage_locations (
  id integer NOT NULL DEFAULT nextval('storage_locations_id_seq'::regclass),
  user_id integer NOT NULL,
  name text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT storage_locations_konto_id UNIQUE (user_id, id),
  CONSTRAINT storage_locations_pkey PRIMARY KEY (id),
  CONSTRAINT storage_locations_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX storage_locations_konto_name ON storage_locations USING btree (user_id, lower(name));
CREATE TRIGGER trg_bump_parts_version_upd AFTER UPDATE ON storage_locations REFERENCING OLD TABLE AS alt NEW TABLE AS neu FOR EACH STATEMENT EXECUTE FUNCTION bump_parts_version_lagerort_upd();
ALTER TABLE storage_locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY zeilenschutz ON storage_locations USING ((user_id = ANY (( SELECT zeilenschutz_konten() AS zeilenschutz_konten)::integer[]))) WITH CHECK ((user_id = ANY (( SELECT zeilenschutz_konten() AS zeilenschutz_konten)::integer[])));

CREATE TABLE subsets_cache (
  set_number text NOT NULL,
  data text NOT NULL,
  fetched_at timestamp with time zone DEFAULT now(),
  CONSTRAINT subsets_cache_pkey PRIMARY KEY (set_number)
);

CREATE TABLE trash (
  id integer NOT NULL DEFAULT nextval('papierkorb_id_seq'::regclass),
  user_id integer NOT NULL,
  type text NOT NULL,
  number text NOT NULL,
  color_id integer,
  label text,
  rows jsonb NOT NULL,
  deleted_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT papierkorb_art_check CHECK ((type = ANY (ARRAY['set'::text, 'teil'::text, 'figur'::text]))),
  CONSTRAINT papierkorb_pkey PRIMARY KEY (id),
  CONSTRAINT papierkorb_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_papierkorb_konto ON trash USING btree (user_id, deleted_at DESC);
ALTER TABLE trash ENABLE ROW LEVEL SECURITY;
CREATE POLICY zeilenschutz ON trash USING ((user_id = ANY (( SELECT zeilenschutz_konten() AS zeilenschutz_konten)::integer[]))) WITH CHECK ((user_id = ANY (( SELECT zeilenschutz_konten() AS zeilenschutz_konten)::integer[])));

CREATE TABLE user_sessions (
  sid character varying NOT NULL,
  sess json NOT NULL,
  expire timestamp with time zone NOT NULL,
  CONSTRAINT user_sessions_pkey PRIMARY KEY (sid)
);
CREATE INDEX idx_user_sessions_expire ON user_sessions USING btree (expire);

CREATE TABLE user_settings (
  user_id integer NOT NULL,
  key text NOT NULL,
  value text NOT NULL,
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT user_settings_pkey PRIMARY KEY (user_id, key),
  CONSTRAINT user_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY zeilenschutz ON user_settings USING ((user_id = ANY (( SELECT zeilenschutz_konten() AS zeilenschutz_konten)::integer[]))) WITH CHECK ((user_id = ANY (( SELECT zeilenschutz_konten() AS zeilenschutz_konten)::integer[])));

CREATE TABLE users (
  id integer NOT NULL DEFAULT nextval('users_id_seq'::regclass),
  username text NOT NULL,
  email text,
  first_name text,
  last_name text,
  password_hash text NOT NULL,
  is_admin boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  email_verified boolean NOT NULL DEFAULT false,
  verification_token text,
  token_expires timestamp with time zone,
  reset_token text,
  reset_token_expires timestamp with time zone,
  must_change_password boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  session_version integer NOT NULL DEFAULT 0,
  registration_pending boolean NOT NULL DEFAULT false,
  new_email text,
  new_email_token text,
  new_email_until timestamp with time zone,
  CONSTRAINT users_pkey PRIMARY KEY (id),
  CONSTRAINT users_username_key UNIQUE (username)
);
CREATE UNIQUE INDEX users_email_lower ON users USING btree (lower(email));
CREATE UNIQUE INDEX users_username_lower ON users USING btree (lower(username));
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY namen_aendern ON users FOR UPDATE USING ((id = ( SELECT zeilenschutz_konto() AS zeilenschutz_konto))) WITH CHECK ((id = ( SELECT zeilenschutz_konto() AS zeilenschutz_konto)));
CREATE POLICY zeilenschutz ON users FOR SELECT USING (((id = ( SELECT zeilenschutz_konto() AS zeilenschutz_konto)) OR (EXISTS ( SELECT 1
   FROM account_links l
  WHERE (((l.main_user_id = ( SELECT zeilenschutz_konto() AS zeilenschutz_konto)) AND (l.sub_user_id = users.id)) OR ((l.sub_user_id = ( SELECT zeilenschutz_konto() AS zeilenschutz_konto)) AND (l.main_user_id = users.id))))) OR (EXISTS ( SELECT 1
   FROM household_former_links f
  WHERE ((f.main_user_id = ( SELECT zeilenschutz_konto() AS zeilenschutz_konto)) AND ((users.id = f.sub_user_id) OR (users.id = f.via_user_id)))))));

CREATE TABLE voucher_balance_throttle (
  id smallint NOT NULL DEFAULT 1,
  last_checked_at timestamp with time zone,
  locked_until timestamp with time zone,
  CONSTRAINT gutschein_guthaben_schranke_id_check CHECK ((id = 1)),
  CONSTRAINT gutschein_guthaben_schranke_pkey PRIMARY KEY (id)
);

CREATE TABLE vouchers (
  id integer NOT NULL DEFAULT nextval('vouchers_id_seq'::regclass),
  user_id integer NOT NULL,
  number text NOT NULL,
  pin text,
  amount numeric(12,4) NOT NULL,
  currency text NOT NULL,
  pdf_path text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  balance_checked_at timestamp with time zone,
  number_search text,
  CONSTRAINT vouchers_amount_nicht_negativ CHECK ((amount >= (0)::numeric)),
  CONSTRAINT vouchers_currency_iso CHECK ((currency ~ '^[A-Z]{3}$'::text)),
  CONSTRAINT vouchers_nummer_verschluesselt CHECK (((number ~~ 'v2:%'::text) AND (number_search IS NOT NULL))) NOT VALID,
  CONSTRAINT vouchers_pkey PRIMARY KEY (id),
  CONSTRAINT vouchers_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT vouchers_user_id_nummer_suche_key UNIQUE (user_id, number_search)
);
CREATE TRIGGER vouchers_waehrung BEFORE INSERT OR UPDATE ON vouchers FOR EACH ROW EXECUTE FUNCTION erfassung_waehrung();
ALTER TABLE vouchers ENABLE ROW LEVEL SECURITY;
CREATE POLICY zeilenschutz ON vouchers USING ((user_id = ( SELECT zeilenschutz_konto() AS zeilenschutz_konto))) WITH CHECK ((user_id = ( SELECT zeilenschutz_konto() AS zeilenschutz_konto)));

CREATE TABLE wanted (
  id integer NOT NULL DEFAULT nextval('wanted_id_seq'::regclass),
  user_id integer NOT NULL,
  set_number text NOT NULL,
  condition text NOT NULL DEFAULT 'N'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT wanted_pkey PRIMARY KEY (id),
  CONSTRAINT wanted_setnummer_mit_version CHECK ((set_number ~ '-[0-9]+$'::text)),
  CONSTRAINT wanted_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT wanted_user_id_set_number_condition_key UNIQUE (user_id, set_number, condition),
  CONSTRAINT wanted_zustand CHECK ((condition = ANY (ARRAY['N'::text, 'U'::text])))
);
CREATE INDEX idx_wanted_user ON wanted USING btree (user_id, created_at DESC);
CREATE TRIGGER wanted_setnummer BEFORE INSERT OR UPDATE OF set_number ON wanted FOR EACH ROW EXECUTE FUNCTION setnummer_normalisieren();
ALTER TABLE wanted ENABLE ROW LEVEL SECURITY;
CREATE POLICY zeilenschutz ON wanted USING ((user_id = ANY (( SELECT zeilenschutz_konten() AS zeilenschutz_konten)::integer[]))) WITH CHECK ((user_id = ANY (( SELECT zeilenschutz_konten() AS zeilenschutz_konten)::integer[])));

CREATE TABLE webauthn_challenges (
  challenge text NOT NULL,
  user_id integer,
  purpose text NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  CONSTRAINT webauthn_challenges_pkey PRIMARY KEY (challenge),
  CONSTRAINT webauthn_challenges_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT webauthn_challenges_zweck_check CHECK ((purpose = ANY (ARRAY['registrieren'::text, 'anmelden'::text, 'zweiter_faktor'::text])))
);
CREATE INDEX idx_webauthn_challenges_frist ON webauthn_challenges USING btree (expires_at);
CREATE INDEX idx_webauthn_challenges_konto ON webauthn_challenges USING btree (user_id);
ALTER TABLE webauthn_challenges ENABLE ROW LEVEL SECURITY;
CREATE POLICY zeilenschutz ON webauthn_challenges USING ((user_id = ( SELECT zeilenschutz_konto() AS zeilenschutz_konto))) WITH CHECK ((user_id = ( SELECT zeilenschutz_konto() AS zeilenschutz_konto)));

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

CREATE OR REPLACE FUNCTION bild_stamm(pfad text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$ SELECT regexp_replace(regexp_replace(pfad, '^.*/', ''), '\.[^.]*$', '') $function$;

CREATE OR REPLACE FUNCTION bump_parts_version_del()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  INSERT INTO parts_version_user (user_id, v)
  SELECT DISTINCT user_id, 1 FROM alt WHERE user_id IS NOT NULL AND user_id IN (SELECT id FROM users)
  ON CONFLICT (user_id) DO UPDATE SET v = parts_version_user.v + 1;
  RETURN NULL;
END $function$;

CREATE OR REPLACE FUNCTION bump_parts_version_erfassung_upd()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  INSERT INTO parts_version_user (user_id, v)
  SELECT DISTINCT user_id, 1 FROM (
    SELECT a.user_id FROM alt a JOIN neu n ON n.id = a.id
     WHERE (a.quantity, a.user_id, a.set_number) IS DISTINCT FROM (n.quantity, n.user_id, n.set_number)
    UNION
    SELECT n.user_id FROM alt a JOIN neu n ON n.id = a.id
     WHERE (a.quantity, a.user_id, a.set_number) IS DISTINCT FROM (n.quantity, n.user_id, n.set_number)
  ) x WHERE user_id IN (SELECT id FROM users)
  ON CONFLICT (user_id) DO UPDATE SET v = parts_version_user.v + 1;
  RETURN NULL;
END $function$;

CREATE OR REPLACE FUNCTION bump_parts_version_ins()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  INSERT INTO parts_version_user (user_id, v)
  SELECT DISTINCT user_id, 1 FROM neu WHERE user_id IS NOT NULL AND user_id IN (SELECT id FROM users)
  ON CONFLICT (user_id) DO UPDATE SET v = parts_version_user.v + 1;
  RETURN NULL;
END $function$;

CREATE OR REPLACE FUNCTION bump_parts_version_lagerort_upd()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  INSERT INTO parts_version_user (user_id, v)
  SELECT DISTINCT n.user_id, 1 FROM alt a JOIN neu n ON n.id = a.id
   WHERE a.name IS DISTINCT FROM n.name AND n.user_id IN (SELECT id FROM users)
  ON CONFLICT (user_id) DO UPDATE SET v = parts_version_user.v + 1;
  RETURN NULL;
END $function$;

CREATE OR REPLACE FUNCTION bump_parts_version_upd()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  INSERT INTO parts_version_user (user_id, v)
  SELECT DISTINCT user_id, 1 FROM (
    SELECT user_id FROM alt UNION SELECT user_id FROM neu
  ) x WHERE user_id IS NOT NULL AND user_id IN (SELECT id FROM users)
  ON CONFLICT (user_id) DO UPDATE SET v = parts_version_user.v + 1;
  RETURN NULL;
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

CREATE OR REPLACE FUNCTION erfassung_waehrung()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.currency IS NULL THEN
    NEW.currency := konto_waehrung(NEW.user_id);
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION in_waehrung(betrag numeric, von text, nach text, t date)
 RETURNS numeric
 LANGUAGE sql
 STABLE
AS $function$
  SELECT CASE WHEN betrag IS NULL THEN NULL
              WHEN upper(von) = upper(nach) THEN betrag
              ELSE round(betrag / kurs_je_eur(von, t) * kurs_je_eur(nach, t), 4) END
$function$;

CREATE OR REPLACE FUNCTION konten_mit_set(sn text)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$ SELECT count(DISTINCT user_id)::integer FROM sets WHERE set_number = sn $function$;

CREATE OR REPLACE FUNCTION konto_aus_sicherungen_loeschen(uid integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  z record;
  n integer := 0;
  k integer;
BEGIN
  FOR z IN
    WITH fk AS (
      SELECT r.relname, a.attname FROM pg_constraint c
        JOIN pg_class r ON r.oid = c.conrelid
        JOIN pg_namespace ns ON ns.oid = r.relnamespace AND ns.nspname = 'public'
        JOIN pg_attribute a ON a.attrelid = r.oid AND a.attnum = ANY (c.conkey)
       WHERE c.contype = 'f' AND c.confrelid = 'users'::regclass)
    SELECT ns.nspname AS schema, c.relname AS tabelle, a.attname AS spalte
      FROM pg_namespace ns
      JOIN pg_class c ON c.relnamespace = ns.oid AND c.relkind = 'r'
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
     WHERE ns.nspname ~ '^vor_migration_[0-9]+$'
       AND (a.attname ~ '(^|_)user_id$' OR (c.relname = 'users' AND a.attname = 'id')
            OR (c.relname, a.attname) IN (SELECT relname, attname FROM fk))
       AND format_type(a.atttypid, a.atttypmod) IN ('integer', 'bigint')
  LOOP
    EXECUTE format('DELETE FROM %I.%I WHERE %I = $1', z.schema, z.tabelle, z.spalte) USING uid;
    GET DIAGNOSTICS k = ROW_COUNT;
    n := n + k;
  END LOOP;
  RETURN n;
END $function$;

CREATE OR REPLACE FUNCTION konto_waehrung(uid integer)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  SELECT COALESCE(
    (SELECT NULLIF(value, '') FROM user_settings WHERE user_id = uid AND key = 'currency'),
    (SELECT NULLIF(value, '') FROM global_settings WHERE key = 'currency'),
    'EUR')
$function$;

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

CREATE OR REPLACE FUNCTION set_nummer_mit_version(n text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$ SELECT CASE WHEN n IS NULL OR n ~ '-[0-9]+$' THEN n ELSE n || '-1' END $function$;

CREATE OR REPLACE FUNCTION setnum_normalisieren()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.set_num := set_nummer_mit_version(NEW.set_num);
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION setnummer_normalisieren()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.set_number := set_nummer_mit_version(NEW.set_number);
  RETURN NEW;
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
  DELETE FROM admin_log WHERE occurred_at < now() - interval '365 days';
  GET DIAGNOSTICS alt = ROW_COUNT;
  UPDATE admin_log p SET target_name = NULL
   WHERE target_name IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = p.target_id);
  GET DIAGNOSTICS namen = ROW_COUNT;
  RETURN alt + namen;
END $function$;

CREATE OR REPLACE FUNCTION zeilenschutz_konten()
 RETURNS integer[]
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  SELECT CASE WHEN k.id IS NULL THEN '{}'::integer[]
              ELSE k.id || ARRAY(SELECT l.sub_user_id FROM account_links l WHERE l.main_user_id = k.id) END
    FROM (SELECT NULLIF(current_setting('app.konto', true), '')::integer AS id) k
$function$;

CREATE OR REPLACE FUNCTION zeilenschutz_konto()
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$ SELECT NULLIF(current_setting('app.konto', true), '')::integer $function$;
