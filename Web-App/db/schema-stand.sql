-- Erzeugt von scripts/schema-stand.js aus einer frischen Datenbank.
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

CREATE TABLE account_links (
  main_user_id integer NOT NULL,
  sub_user_id integer NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT account_links_main_user_id_fkey FOREIGN KEY (main_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT account_links_no_self CHECK ((main_user_id <> sub_user_id)),
  CONSTRAINT account_links_pkey PRIMARY KEY (main_user_id, sub_user_id),
  CONSTRAINT account_links_sub_user_id_fkey FOREIGN KEY (sub_user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_account_links_main ON account_links USING btree (main_user_id);
CREATE INDEX idx_account_links_sub ON account_links USING btree (sub_user_id);

CREATE TABLE api_aufrufe (
  tag date NOT NULL,
  api text NOT NULL,
  konto integer NOT NULL DEFAULT 0,
  anzahl integer NOT NULL DEFAULT 0,
  CONSTRAINT api_aufrufe_anzahl_check CHECK ((anzahl >= 0)),
  CONSTRAINT api_aufrufe_api_check CHECK ((api = ANY (ARRAY['bricklink'::text, 'rebrickable'::text, 'brickset'::text]))),
  CONSTRAINT api_aufrufe_pkey PRIMARY KEY (tag, api, konto)
);

CREATE TABLE api_takt (
  api text NOT NULL,
  naechster timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT api_takt_pkey PRIMARY KEY (api)
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
  CONSTRAINT api_tokens_pkey PRIMARY KEY (token),
  CONSTRAINT api_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_api_tokens_expires ON api_tokens USING btree (expires_at) WHERE (expires_at IS NOT NULL);
CREATE INDEX idx_api_tokens_hard ON api_tokens USING btree (hard_expires_at) WHERE (hard_expires_at IS NOT NULL);
CREATE INDEX idx_api_tokens_idle ON api_tokens USING btree (last_used) WHERE (expires_at IS NULL);
CREATE INDEX idx_api_tokens_user_created ON api_tokens USING btree (user_id, created_at DESC);

CREATE TABLE app_logs (
  id bigint NOT NULL DEFAULT nextval('app_logs_id_seq'::regclass),
  level character varying(10) NOT NULL DEFAULT 'info'::character varying,
  message text NOT NULL,
  logged_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT app_logs_pkey PRIMARY KEY (id)
);
CREATE INDEX idx_app_logs_logged_at ON app_logs USING btree (logged_at DESC);

CREATE TABLE bl_zuordnung (
  art text NOT NULL,
  rb_id text NOT NULL,
  bl_id text,
  fetched_at timestamp with time zone DEFAULT now(),
  CONSTRAINT bl_zuordnung_art CHECK ((art = ANY (ARRAY['part'::text, 'fig'::text, 'set'::text]))),
  CONSTRAINT bl_zuordnung_pkey PRIMARY KEY (art, rb_id)
);
CREATE INDEX idx_bl_zuordnung_bl ON bl_zuordnung USING btree (art, bl_id);
CREATE TRIGGER trg_bump_parts_katalog AFTER INSERT OR DELETE OR UPDATE ON bl_zuordnung FOR EACH STATEMENT EXECUTE FUNCTION bump_parts_katalog();

CREATE TABLE brickset_retry_queue (
  set_number text NOT NULL,
  retry_after date NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT brickset_retry_queue_pkey PRIMARY KEY (set_number)
);

CREATE TABLE catalog_cache (
  set_number text NOT NULL,
  name text,
  year integer,
  theme text,
  pieces integer,
  image_url text,
  is_gear integer DEFAULT 0,
  bl_type text,
  fetched_at timestamp with time zone DEFAULT now(),
  CONSTRAINT catalog_cache_pkey PRIMARY KEY (set_number)
);

CREATE TABLE csv_import_jobs (
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

CREATE TABLE global_settings (
  key text NOT NULL,
  value text NOT NULL,
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT global_settings_pkey PRIMARY KEY (key)
);

CREATE TABLE gutschein_guthaben_schranke (
  id smallint NOT NULL DEFAULT 1,
  letzter_abruf timestamp with time zone,
  sperre_bis timestamp with time zone,
  CONSTRAINT gutschein_guthaben_schranke_id_check CHECK ((id = 1)),
  CONSTRAINT gutschein_guthaben_schranke_pkey PRIMARY KEY (id)
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

CREATE TABLE instruction_queue (
  id integer NOT NULL DEFAULT nextval('instruction_queue_id_seq'::regclass),
  set_number text NOT NULL,
  status text DEFAULT 'pending'::text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT instruction_queue_pkey PRIMARY KEY (id),
  CONSTRAINT instruction_queue_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'done'::text, 'failed'::text])))
);
CREATE UNIQUE INDEX idx_instr_queue_set ON instruction_queue USING btree (set_number);

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
  CONSTRAINT instructions_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_instructions_user ON instructions USING btree (user_id, set_number);

CREATE TABLE laufzustand (
  schluessel text NOT NULL,
  wert text NOT NULL DEFAULT ''::text,
  aktualisiert timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT laufzustand_pkey PRIMARY KEY (schluessel)
);

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
  CONSTRAINT minifig_acquisitions_menge_positiv CHECK ((quantity > 0)),
  CONSTRAINT minifig_acquisitions_pkey PRIMARY KEY (id),
  CONSTRAINT minifig_acquisitions_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT minifig_acquisitions_zustand CHECK ((condition = ANY (ARRAY['N'::text, 'U'::text])))
);
CREATE INDEX idx_minifig_acq_gruppe ON minifig_acquisitions USING btree (user_id, fig_number);
CREATE UNIQUE INDEX idx_minifig_acq_tag_merkmale ON minifig_acquisitions USING btree (user_id, fig_number, (((created_at AT TIME ZONE 'UTC'::text))::date), condition, COALESCE(unit_price, ('-1'::integer)::numeric), price_estimated, currency);
CREATE TRIGGER minifig_acquisitions_waehrung BEFORE INSERT OR UPDATE ON minifig_acquisitions FOR EACH ROW EXECUTE FUNCTION erfassung_waehrung();

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
  currency_code text NOT NULL DEFAULT 'EUR'::text,
  avg_price numeric(12,4),
  qty_avg_price numeric(12,4),
  fetched_at timestamp with time zone DEFAULT now(),
  geschaetzt boolean NOT NULL DEFAULT false,
  abdeckung numeric(4,3),
  CONSTRAINT minifig_price_cache_fig_number_condition_currency_code_key UNIQUE (fig_number, condition, currency_code),
  CONSTRAINT minifig_price_cache_pkey PRIMARY KEY (id)
);
CREATE INDEX idx_minifig_price_cache_lookup ON minifig_price_cache USING btree (fig_number, condition, currency_code, fetched_at DESC);

CREATE TABLE minifig_price_history (
  id integer NOT NULL DEFAULT nextval('minifig_price_history_id_seq'::regclass),
  fig_number text NOT NULL,
  condition text NOT NULL DEFAULT 'U'::text,
  currency_code text NOT NULL DEFAULT 'EUR'::text,
  avg_price numeric(12,4),
  qty_avg_price numeric(12,4),
  recorded_at timestamp with time zone NOT NULL DEFAULT now(),
  geschaetzt boolean NOT NULL DEFAULT false,
  abdeckung numeric(4,3),
  CONSTRAINT minifig_price_history_pkey PRIMARY KEY (id)
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
  CONSTRAINT minifigs_source_check CHECK ((source = ANY (ARRAY['set'::text, 'manual'::text]))),
  CONSTRAINT minifigs_storage_id_fkey FOREIGN KEY (user_id, storage_id) REFERENCES storage_locations(user_id, id) ON DELETE SET NULL (storage_id),
  CONSTRAINT minifigs_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX idx_minifigs_eindeutig ON minifigs USING btree (user_id, COALESCE(set_number, ''::text), fig_number);
CREATE INDEX idx_minifigs_storage_id ON minifigs USING btree (user_id, storage_id) WHERE (storage_id IS NOT NULL);
CREATE INDEX idx_minifigs_storage_ref ON minifigs USING btree (storage_id) WHERE (storage_id IS NOT NULL);
CREATE INDEX idx_minifigs_user ON minifigs USING btree (user_id);

CREATE TABLE minifigs_catalog (
  fig_number text NOT NULL,
  fig_name text,
  image_url text,
  image_local text,
  updated_at timestamp with time zone DEFAULT now(),
  name_von integer,
  bild_von integer,
  CONSTRAINT minifigs_catalog_pkey PRIMARY KEY (fig_number)
);
CREATE INDEX idx_minifigs_catalog_name_trgm ON minifigs_catalog USING gin (lower(fig_name) gin_trgm_ops);

CREATE TABLE papierkorb (
  id integer NOT NULL DEFAULT nextval('papierkorb_id_seq'::regclass),
  user_id integer NOT NULL,
  art text NOT NULL,
  nummer text NOT NULL,
  farbe_id integer,
  bezeichnung text,
  zeilen jsonb NOT NULL,
  geloescht_am timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT papierkorb_art_check CHECK ((art = ANY (ARRAY['set'::text, 'teil'::text, 'figur'::text]))),
  CONSTRAINT papierkorb_pkey PRIMARY KEY (id),
  CONSTRAINT papierkorb_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_papierkorb_konto ON papierkorb USING btree (user_id, geloescht_am DESC);

CREATE TABLE part_acquisitions (
  id integer NOT NULL DEFAULT nextval('part_acquisitions_id_seq'::regclass),
  user_id integer NOT NULL,
  part_number text NOT NULL,
  color_id integer NOT NULL DEFAULT 0,
  quantity integer NOT NULL DEFAULT 1,
  unit_price numeric(12,4),
  condition text NOT NULL DEFAULT 'N'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  currency text NOT NULL,
  price_estimated boolean NOT NULL DEFAULT false,
  CONSTRAINT part_acquisitions_menge_positiv CHECK ((quantity > 0)),
  CONSTRAINT part_acquisitions_pkey PRIMARY KEY (id),
  CONSTRAINT part_acquisitions_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT part_acquisitions_zustand CHECK ((condition = ANY (ARRAY['N'::text, 'U'::text])))
);
CREATE INDEX idx_part_acq_gruppe ON part_acquisitions USING btree (user_id, part_number, color_id);
CREATE UNIQUE INDEX idx_part_acq_tag_merkmale ON part_acquisitions USING btree (user_id, part_number, color_id, (((created_at AT TIME ZONE 'UTC'::text))::date), condition, COALESCE(unit_price, ('-1'::integer)::numeric), price_estimated, currency);
CREATE TRIGGER part_acquisitions_waehrung BEFORE INSERT OR UPDATE ON part_acquisitions FOR EACH ROW EXECUTE FUNCTION erfassung_waehrung();

CREATE TABLE part_catalog (
  part_number text NOT NULL,
  part_name text,
  category_name text,
  updated_at timestamp with time zone DEFAULT now(),
  name_von integer,
  kategorie_von integer,
  CONSTRAINT part_catalog_pkey PRIMARY KEY (part_number)
);
CREATE INDEX idx_part_catalog_category ON part_catalog USING btree (category_name);
CREATE INDEX idx_part_catalog_name_trgm ON part_catalog USING gin (lower(part_name) gin_trgm_ops);
CREATE TRIGGER trg_bump_parts_katalog AFTER INSERT OR DELETE OR UPDATE ON part_catalog FOR EACH STATEMENT EXECUTE FUNCTION bump_parts_katalog();

CREATE TABLE part_color_catalog (
  part_number text NOT NULL,
  color_id integer NOT NULL,
  color_name text,
  color_hex text,
  image_url text,
  image_local text,
  updated_at timestamp with time zone DEFAULT now(),
  farbname_von integer,
  farbcode_von integer,
  bild_von integer,
  CONSTRAINT part_color_catalog_pkey PRIMARY KEY (part_number, color_id)
);
CREATE TRIGGER trg_bump_parts_katalog AFTER INSERT OR DELETE OR UPDATE ON part_color_catalog FOR EACH STATEMENT EXECUTE FUNCTION bump_parts_katalog();

CREATE TABLE part_price_cache (
  id integer NOT NULL DEFAULT nextval('part_price_cache_id_seq'::regclass),
  part_number text NOT NULL,
  color_id integer NOT NULL DEFAULT 0,
  condition text NOT NULL DEFAULT 'U'::text,
  currency_code text NOT NULL DEFAULT 'EUR'::text,
  avg_price numeric(12,4),
  qty_avg_price numeric(12,4),
  fetched_at timestamp with time zone DEFAULT now(),
  CONSTRAINT part_price_cache_part_number_color_id_condition_currency_co_key UNIQUE (part_number, color_id, condition, currency_code),
  CONSTRAINT part_price_cache_pkey PRIMARY KEY (id)
);
CREATE INDEX idx_part_price_cache_lookup ON part_price_cache USING btree (part_number, color_id, condition, currency_code, fetched_at DESC);

CREATE TABLE part_price_history (
  id integer NOT NULL DEFAULT nextval('part_price_history_id_seq'::regclass),
  part_number text NOT NULL,
  color_id integer NOT NULL DEFAULT 0,
  condition text NOT NULL DEFAULT 'U'::text,
  currency_code text NOT NULL DEFAULT 'EUR'::text,
  avg_price numeric(12,4),
  qty_avg_price numeric(12,4),
  recorded_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT part_price_history_pkey PRIMARY KEY (id)
);
CREATE INDEX idx_part_price_history_lookup ON part_price_history USING btree (part_number, color_id, currency_code, recorded_at);
CREATE UNIQUE INDEX idx_part_price_history_tag ON part_price_history USING btree (part_number, color_id, condition, currency_code, (((recorded_at AT TIME ZONE 'UTC'::text))::date));

CREATE TABLE parts (
  id integer NOT NULL DEFAULT nextval('parts_id_seq'::regclass),
  user_id integer NOT NULL,
  set_number text,
  part_number text NOT NULL,
  color_id integer,
  source text DEFAULT 'set'::text,
  storage_id integer,
  added_at timestamp with time zone DEFAULT now(),
  CONSTRAINT parts_pkey PRIMARY KEY (id),
  CONSTRAINT parts_set_fk FOREIGN KEY (user_id, set_number) REFERENCES sets(user_id, set_number) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT parts_source_check CHECK ((source = ANY (ARRAY['set'::text, 'manual'::text]))),
  CONSTRAINT parts_storage_id_fkey FOREIGN KEY (user_id, storage_id) REFERENCES storage_locations(user_id, id) ON DELETE SET NULL (storage_id),
  CONSTRAINT parts_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_parts_color_id ON parts USING btree (user_id, color_id);
CREATE UNIQUE INDEX idx_parts_eindeutig ON parts USING btree (user_id, COALESCE(set_number, ''::text), part_number, COALESCE(color_id, 0));
CREATE INDEX idx_parts_gruppe ON parts USING btree (user_id, part_number, color_id);
CREATE INDEX idx_parts_number_trgm ON parts USING gin (lower(part_number) gin_trgm_ops);
CREATE INDEX idx_parts_set ON parts USING btree (user_id, set_number);
CREATE INDEX idx_parts_storage_id ON parts USING btree (user_id, storage_id) WHERE (storage_id IS NOT NULL);
CREATE INDEX idx_parts_storage_ref ON parts USING btree (storage_id) WHERE (storage_id IS NOT NULL);
CREATE INDEX idx_parts_user ON parts USING btree (user_id);
CREATE TRIGGER trg_bump_parts_version_del AFTER DELETE ON parts REFERENCING OLD TABLE AS alt FOR EACH STATEMENT EXECUTE FUNCTION bump_parts_version_del();
CREATE TRIGGER trg_bump_parts_version_ins AFTER INSERT ON parts REFERENCING NEW TABLE AS neu FOR EACH STATEMENT EXECUTE FUNCTION bump_parts_version_ins();
CREATE TRIGGER trg_bump_parts_version_upd AFTER UPDATE ON parts REFERENCING OLD TABLE AS alt NEW TABLE AS neu FOR EACH STATEMENT EXECUTE FUNCTION bump_parts_version_upd();

CREATE TABLE parts_katalog_stand (
  id integer NOT NULL DEFAULT 1,
  v bigint NOT NULL DEFAULT 0,
  CONSTRAINT parts_katalog_stand_id_check CHECK ((id = 1)),
  CONSTRAINT parts_katalog_stand_pkey PRIMARY KEY (id)
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
  is_spare integer DEFAULT 0,
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

CREATE TABLE parts_summary_state (
  user_id integer NOT NULL,
  built_version bigint NOT NULL DEFAULT 0,
  built_at timestamp with time zone DEFAULT now(),
  katalog_stand bigint NOT NULL DEFAULT '-1'::integer,
  CONSTRAINT parts_summary_state_pkey PRIMARY KEY (user_id),
  CONSTRAINT parts_summary_state_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE parts_version_user (
  user_id integer NOT NULL,
  v bigint NOT NULL DEFAULT 0,
  CONSTRAINT parts_version_user_pkey PRIMARY KEY (user_id),
  CONSTRAINT parts_version_user_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE price_alerts (
  user_id integer NOT NULL,
  set_number text NOT NULL,
  condition text NOT NULL DEFAULT 'N'::text,
  richtung text NOT NULL,
  schwelle numeric(12,4) NOT NULL,
  currency_code text NOT NULL,
  ausgeloest boolean NOT NULL DEFAULT false,
  zuletzt_am timestamp with time zone,
  zuletzt_preis numeric(12,4),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT price_alerts_pkey PRIMARY KEY (user_id, set_number, condition),
  CONSTRAINT price_alerts_richtung CHECK ((richtung = ANY (ARRAY['unter'::text, 'ueber'::text]))),
  CONSTRAINT price_alerts_schwelle CHECK ((schwelle > (0)::numeric)),
  CONSTRAINT price_alerts_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_price_alerts_set ON price_alerts USING btree (set_number, condition);

CREATE TABLE price_cache (
  id integer NOT NULL DEFAULT nextval('price_cache_id_seq'::regclass),
  set_number text NOT NULL,
  condition text NOT NULL DEFAULT 'N'::text,
  currency_code text NOT NULL DEFAULT 'EUR'::text,
  min_price numeric(12,4),
  avg_price numeric(12,4),
  max_price numeric(12,4),
  qty_avg_price numeric(12,4),
  total_quantity integer,
  fetched_at timestamp with time zone DEFAULT now(),
  CONSTRAINT price_cache_pkey PRIMARY KEY (id),
  CONSTRAINT price_cache_set_number_condition_currency_code_key UNIQUE (set_number, condition, currency_code)
);
CREATE INDEX idx_price_cache_lookup ON price_cache USING btree (set_number, condition, currency_code, fetched_at DESC);

CREATE TABLE price_history (
  id integer NOT NULL DEFAULT nextval('price_history_id_seq'::regclass),
  set_number text NOT NULL,
  condition text NOT NULL DEFAULT 'N'::text,
  currency_code text NOT NULL DEFAULT 'EUR'::text,
  avg_price numeric(12,4),
  qty_avg_price numeric(12,4),
  min_price numeric(12,4),
  max_price numeric(12,4),
  recorded_at timestamp with time zone DEFAULT now(),
  CONSTRAINT price_history_pkey PRIMARY KEY (id)
);
CREATE INDEX idx_price_history_set ON price_history USING btree (set_number, recorded_at);
CREATE UNIQUE INDEX idx_price_history_tag ON price_history USING btree (set_number, condition, currency_code, (((recorded_at AT TIME ZONE 'UTC'::text))::date));

CREATE TABLE qr_login_tokens (
  token text NOT NULL,
  user_id integer NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  used_at timestamp with time zone,
  token_days integer,
  CONSTRAINT qr_login_tokens_pkey PRIMARY KEY (token),
  CONSTRAINT qr_login_tokens_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_qr_login_expires ON qr_login_tokens USING btree (expires_at);
CREATE INDEX idx_qr_login_user ON qr_login_tokens USING btree (user_id);

CREATE TABLE rate_limit_attempts (
  key text NOT NULL,
  count integer NOT NULL DEFAULT 1,
  first_at timestamp with time zone NOT NULL DEFAULT now(),
  last_at timestamp with time zone,
  laufend integer NOT NULL DEFAULT 0,
  laufend_seit timestamp with time zone,
  CONSTRAINT rate_limit_attempts_pkey PRIMARY KEY (key)
);
CREATE INDEX idx_rate_limit_first_at ON rate_limit_attempts USING btree (first_at);

CREATE TABLE rb_colors (
  id integer NOT NULL,
  name text,
  rgb text,
  is_trans text,
  bl_color_id integer,
  CONSTRAINT rb_colors_pkey PRIMARY KEY (id)
);

CREATE TABLE rb_inventories (
  id integer NOT NULL,
  set_num text,
  version integer,
  CONSTRAINT rb_inventories_pkey PRIMARY KEY (id)
);
CREATE INDEX idx_rb_inv_setnum ON rb_inventories USING btree (set_num);

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
  is_spare text,
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

CREATE TABLE schema_migrations (
  name text NOT NULL,
  applied_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT schema_migrations_pkey PRIMARY KEY (name)
);

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
  CONSTRAINT set_acquisitions_bestand_fkey FOREIGN KEY (user_id, set_number) REFERENCES sets(user_id, set_number) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT set_acquisitions_menge_positiv CHECK ((quantity > 0)),
  CONSTRAINT set_acquisitions_pkey PRIMARY KEY (id),
  CONSTRAINT set_acquisitions_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT set_acquisitions_zustand CHECK ((condition = ANY (ARRAY['N'::text, 'U'::text])))
);
CREATE INDEX idx_acq_user_set ON set_acquisitions USING btree (user_id, set_number);
CREATE UNIQUE INDEX idx_set_acq_tag_merkmale ON set_acquisitions USING btree (user_id, set_number, (((created_at AT TIME ZONE 'UTC'::text))::date), condition, COALESCE(purchase_price, ('-1'::integer)::numeric), price_estimated, currency);
CREATE TRIGGER set_acquisitions_waehrung BEFORE INSERT OR UPDATE ON set_acquisitions FOR EACH ROW EXECUTE FUNCTION erfassung_waehrung();
CREATE TRIGGER trg_bump_parts_version_del AFTER DELETE ON set_acquisitions REFERENCING OLD TABLE AS alt FOR EACH STATEMENT EXECUTE FUNCTION bump_parts_version_del();
CREATE TRIGGER trg_bump_parts_version_ins AFTER INSERT ON set_acquisitions REFERENCING NEW TABLE AS neu FOR EACH STATEMENT EXECUTE FUNCTION bump_parts_version_ins();
CREATE TRIGGER trg_bump_parts_version_upd AFTER UPDATE ON set_acquisitions REFERENCING OLD TABLE AS alt NEW TABLE AS neu FOR EACH STATEMENT EXECUTE FUNCTION bump_parts_version_erfassung_upd();

CREATE TABLE set_catalog (
  set_number text NOT NULL,
  name text,
  year integer,
  theme text,
  pieces integer,
  minifigs integer,
  image_url text,
  image_local text,
  brickset_id integer,
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT set_catalog_pkey PRIMARY KEY (set_number)
);

CREATE TABLE set_minifigs_catalog (
  set_number text NOT NULL,
  fig_number text NOT NULL,
  fig_name text,
  quantity integer DEFAULT 1,
  image_url text,
  image_local text,
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT set_minifigs_catalog_pkey PRIMARY KEY (set_number, fig_number)
);
CREATE INDEX idx_set_minifigs_fig ON set_minifigs_catalog USING btree (fig_number);
CREATE INDEX idx_smc_set ON set_minifigs_catalog USING btree (set_number);

CREATE TABLE set_teile (
  set_number text NOT NULL,
  part_number text NOT NULL,
  color_id integer NOT NULL,
  is_spare integer DEFAULT 0,
  quantity integer DEFAULT 1,
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT set_teile_pkey PRIMARY KEY (set_number, part_number, color_id)
);
CREATE INDEX idx_set_teile_set ON set_teile USING btree (set_number);
CREATE TRIGGER trg_bump_parts_katalog AFTER INSERT OR DELETE OR UPDATE ON set_teile FOR EACH STATEMENT EXECUTE FUNCTION bump_parts_katalog();

CREATE TABLE sets (
  id integer NOT NULL DEFAULT nextval('sets_id_seq'::regclass),
  user_id integer NOT NULL,
  set_number text NOT NULL,
  added_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  storage_id integer,
  CONSTRAINT sets_pkey PRIMARY KEY (id),
  CONSTRAINT sets_storage_id_fkey FOREIGN KEY (user_id, storage_id) REFERENCES storage_locations(user_id, id) ON DELETE SET NULL (storage_id),
  CONSTRAINT sets_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT sets_user_id_set_number_key UNIQUE (user_id, set_number)
);
CREATE INDEX idx_sets_setnum ON sets USING btree (set_number);
CREATE INDEX idx_sets_storage_id ON sets USING btree (user_id, storage_id) WHERE (storage_id IS NOT NULL);
CREATE INDEX idx_sets_storage_ref ON sets USING btree (storage_id) WHERE (storage_id IS NOT NULL);
CREATE INDEX idx_sets_user ON sets USING btree (user_id);
CREATE TRIGGER trg_bump_parts_version_del AFTER DELETE ON sets REFERENCING OLD TABLE AS alt FOR EACH STATEMENT EXECUTE FUNCTION bump_parts_version_del();
CREATE TRIGGER trg_bump_parts_version_ins AFTER INSERT ON sets REFERENCING NEW TABLE AS neu FOR EACH STATEMENT EXECUTE FUNCTION bump_parts_version_ins();
CREATE TRIGGER trg_bump_parts_version_upd AFTER UPDATE ON sets REFERENCING OLD TABLE AS alt NEW TABLE AS neu FOR EACH STATEMENT EXECUTE FUNCTION bump_parts_version_upd();

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
CREATE INDEX idx_shared_instructions_set ON shared_instructions USING btree (set_number);

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

CREATE TABLE subsets_cache (
  set_number text NOT NULL,
  data text NOT NULL,
  fetched_at timestamp with time zone DEFAULT now(),
  CONSTRAINT subsets_cache_pkey PRIMARY KEY (set_number)
);

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

CREATE TABLE users (
  id integer NOT NULL DEFAULT nextval('users_id_seq'::regclass),
  username text NOT NULL,
  email text,
  first_name text,
  last_name text,
  password_hash text NOT NULL,
  is_admin integer DEFAULT 0,
  is_active integer DEFAULT 1,
  email_verified integer DEFAULT 0,
  verification_token text,
  token_expires timestamp with time zone,
  reset_token text,
  reset_token_expires timestamp with time zone,
  must_change_password integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT users_email_key UNIQUE (email),
  CONSTRAINT users_pkey PRIMARY KEY (id),
  CONSTRAINT users_username_key UNIQUE (username)
);
CREATE UNIQUE INDEX users_email_unique ON users USING btree (email) WHERE (email IS NOT NULL);

CREATE TABLE verwaltungsprotokoll (
  id integer NOT NULL DEFAULT nextval('verwaltungsprotokoll_id_seq'::regclass),
  zeit timestamp with time zone NOT NULL DEFAULT now(),
  verwalter_id integer,
  ziel_id integer,
  ziel_name text,
  aktion text NOT NULL,
  CONSTRAINT verwaltungsprotokoll_pkey PRIMARY KEY (id),
  CONSTRAINT verwaltungsprotokoll_verwalter_id_fkey FOREIGN KEY (verwalter_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_verwaltungsprotokoll_verwalter ON verwaltungsprotokoll USING btree (verwalter_id);
CREATE INDEX idx_verwaltungsprotokoll_zeit ON verwaltungsprotokoll USING btree (zeit DESC);

CREATE TABLE vouchers (
  id integer NOT NULL DEFAULT nextval('vouchers_id_seq'::regclass),
  user_id integer NOT NULL,
  number text NOT NULL,
  pin text,
  amount numeric(12,2) NOT NULL,
  currency text NOT NULL DEFAULT 'CHF'::text,
  pdf_path text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  guthaben_geprueft_am timestamp with time zone,
  CONSTRAINT vouchers_pkey PRIMARY KEY (id),
  CONSTRAINT vouchers_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT vouchers_user_id_number_key UNIQUE (user_id, number)
);
CREATE INDEX idx_vouchers_user ON vouchers USING btree (user_id);

CREATE TABLE wanted (
  id integer NOT NULL DEFAULT nextval('wishlist_id_seq'::regclass),
  user_id integer NOT NULL,
  set_number text NOT NULL,
  condition text NOT NULL DEFAULT 'N'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT wishlist_pkey PRIMARY KEY (id),
  CONSTRAINT wishlist_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT wishlist_user_id_set_number_condition_key UNIQUE (user_id, set_number, condition)
);
CREATE INDEX idx_wanted_user ON wanted USING btree (user_id, created_at DESC);

CREATE TABLE zweiter_faktor (
  user_id integer NOT NULL,
  geheimnis text NOT NULL,
  aktiv boolean NOT NULL DEFAULT false,
  letzter_schritt bigint NOT NULL DEFAULT 0,
  eingerichtet_am timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT zweiter_faktor_pkey PRIMARY KEY (user_id),
  CONSTRAINT zweiter_faktor_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE zweiter_faktor_codes (
  id integer NOT NULL DEFAULT nextval('zweiter_faktor_codes_id_seq'::regclass),
  user_id integer NOT NULL,
  code_hash text NOT NULL,
  verbraucht_am timestamp with time zone,
  CONSTRAINT zweiter_faktor_codes_pkey PRIMARY KEY (id),
  CONSTRAINT zweiter_faktor_codes_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_zweiter_faktor_codes_konto ON zweiter_faktor_codes USING btree (user_id);

CREATE OR REPLACE FUNCTION bump_parts_katalog()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE parts_katalog_stand SET v = v + 1 WHERE id = 1;
  RETURN NULL;
END $function$;

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

CREATE OR REPLACE FUNCTION erfassung_waehrung()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.currency IS NULL THEN
    NEW.currency := COALESCE(
      (SELECT value FROM user_settings WHERE user_id = NEW.user_id AND key = 'currency'), 'EUR');
  END IF;
  RETURN NEW;
END $function$;
