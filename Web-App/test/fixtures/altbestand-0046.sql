-- Eine Datenbank, wie sie ein Server vor dem 28.10.2026 hinterliess: Stand
-- 0046, angelegt vor der Teile-Zusammenfassung, darum ohne parts_version_user
-- und deren Trigger. Aus ihr startet test/altbestand-aufruesten-db.test.js.
-- Erzeugt aus den echten Ständen e9ccd4b (Anlage), b04cc1d und 307ee28
-- (bis 0046), Konten und Protokoll entfernt, pg_dump --inserts.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;
SET default_tablespace = '';
SET default_table_access_method = heap;
CREATE TABLE public.account_link_invites (
    token_hash text NOT NULL,
    main_user_id integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    used_by integer
);
CREATE TABLE public.account_links (
    main_user_id integer NOT NULL,
    sub_user_id integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT account_links_no_self CHECK ((main_user_id <> sub_user_id))
);
CREATE TABLE public.api_tokens (
    token text NOT NULL,
    user_id integer NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    last_used timestamp with time zone DEFAULT now(),
    expires_at timestamp with time zone,
    sliding boolean DEFAULT false NOT NULL,
    hard_expires_at timestamp with time zone,
    never_expires boolean DEFAULT false NOT NULL,
    label text
);
CREATE TABLE public.app_logs (
    id bigint NOT NULL,
    level character varying(10) DEFAULT 'info'::character varying NOT NULL,
    message text NOT NULL,
    logged_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE SEQUENCE public.app_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.app_logs_id_seq OWNED BY public.app_logs.id;
CREATE TABLE public.bl_zuordnung (
    art text NOT NULL,
    rb_id text NOT NULL,
    bl_id text,
    fetched_at timestamp with time zone DEFAULT now(),
    CONSTRAINT bl_zuordnung_art CHECK ((art = ANY (ARRAY['part'::text, 'fig'::text, 'set'::text])))
);
CREATE TABLE public.brickset_retry_queue (
    set_number text NOT NULL,
    retry_after date NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    last_error text,
    created_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.catalog_cache (
    set_number text NOT NULL,
    name text,
    year integer,
    theme text,
    pieces integer,
    image_url text,
    is_gear integer DEFAULT 0,
    bl_type text,
    fetched_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.csv_import_jobs (
    user_id integer NOT NULL,
    status text DEFAULT 'running'::text NOT NULL,
    total integer DEFAULT 0 NOT NULL,
    done integer DEFAULT 0 NOT NULL,
    current text,
    results jsonb DEFAULT '[]'::jsonb NOT NULL,
    error text,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.global_settings (
    key text NOT NULL,
    value text NOT NULL,
    updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.gutschein_guthaben_schranke (
    id smallint DEFAULT 1 NOT NULL,
    letzter_abruf timestamp with time zone,
    sperre_bis timestamp with time zone,
    CONSTRAINT gutschein_guthaben_schranke_id_check CHECK ((id = 1))
);
CREATE TABLE public.household_former_links (
    main_user_id integer NOT NULL,
    sub_user_id integer NOT NULL,
    via_user_id integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.image_misses (
    cache_key text NOT NULL,
    checked_at timestamp with time zone DEFAULT now() NOT NULL,
    reason text
);
CREATE TABLE public.image_wanted (
    url text NOT NULL,
    set_number text,
    requested_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.instruction_queue (
    id integer NOT NULL,
    set_number text NOT NULL,
    status text DEFAULT 'pending'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);
CREATE SEQUENCE public.instruction_queue_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.instruction_queue_id_seq OWNED BY public.instruction_queue.id;
CREATE TABLE public.instructions (
    id integer NOT NULL,
    user_id integer NOT NULL,
    set_number text NOT NULL,
    url text NOT NULL,
    description text,
    local_path text,
    downloaded_at timestamp with time zone DEFAULT now()
);
CREATE SEQUENCE public.instructions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.instructions_id_seq OWNED BY public.instructions.id;
CREATE TABLE public.minifig_acquisitions (
    id integer NOT NULL,
    user_id integer NOT NULL,
    fig_number text NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    unit_price numeric(12,4),
    condition text DEFAULT 'N'::text,
    created_at timestamp with time zone DEFAULT now()
);
CREATE SEQUENCE public.minifig_acquisitions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.minifig_acquisitions_id_seq OWNED BY public.minifig_acquisitions.id;
CREATE TABLE public.minifig_parts_cache (
    fig_number text NOT NULL,
    data text NOT NULL,
    fetched_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.minifig_price_cache (
    id integer NOT NULL,
    fig_number text NOT NULL,
    condition text DEFAULT 'U'::text NOT NULL,
    currency_code text DEFAULT 'EUR'::text NOT NULL,
    avg_price numeric(12,4),
    qty_avg_price numeric(12,4),
    fetched_at timestamp with time zone DEFAULT now()
);
CREATE SEQUENCE public.minifig_price_cache_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.minifig_price_cache_id_seq OWNED BY public.minifig_price_cache.id;
CREATE TABLE public.minifig_price_history (
    id integer NOT NULL,
    fig_number text NOT NULL,
    condition text DEFAULT 'U'::text NOT NULL,
    currency_code text DEFAULT 'EUR'::text NOT NULL,
    avg_price numeric(12,4),
    qty_avg_price numeric(12,4),
    recorded_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE SEQUENCE public.minifig_price_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.minifig_price_history_id_seq OWNED BY public.minifig_price_history.id;
CREATE TABLE public.minifigs (
    id integer NOT NULL,
    user_id integer NOT NULL,
    set_number text,
    fig_number text NOT NULL,
    source text DEFAULT 'set'::text,
    storage_id integer
);
CREATE TABLE public.minifigs_catalog (
    fig_number text NOT NULL,
    fig_name text,
    image_url text,
    image_local text,
    updated_at timestamp with time zone DEFAULT now()
);
CREATE SEQUENCE public.minifigs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.minifigs_id_seq OWNED BY public.minifigs.id;
CREATE TABLE public.papierkorb (
    id integer NOT NULL,
    user_id integer NOT NULL,
    art text NOT NULL,
    nummer text NOT NULL,
    farbe_id integer,
    bezeichnung text,
    zeilen jsonb NOT NULL,
    geloescht_am timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT papierkorb_art_check CHECK ((art = ANY (ARRAY['set'::text, 'teil'::text, 'figur'::text])))
);
CREATE SEQUENCE public.papierkorb_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.papierkorb_id_seq OWNED BY public.papierkorb.id;
CREATE TABLE public.part_acquisitions (
    id integer NOT NULL,
    user_id integer NOT NULL,
    part_number text NOT NULL,
    color_id integer DEFAULT 0 NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    unit_price numeric(12,4),
    condition text DEFAULT 'N'::text,
    created_at timestamp with time zone DEFAULT now()
);
CREATE SEQUENCE public.part_acquisitions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.part_acquisitions_id_seq OWNED BY public.part_acquisitions.id;
CREATE TABLE public.part_catalog (
    part_number text NOT NULL,
    part_name text,
    category_name text,
    updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.part_color_catalog (
    part_number text NOT NULL,
    color_id integer NOT NULL,
    color_name text,
    color_hex text,
    image_url text,
    image_local text,
    updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.part_price_cache (
    id integer NOT NULL,
    part_number text NOT NULL,
    color_id integer DEFAULT 0 NOT NULL,
    condition text DEFAULT 'U'::text NOT NULL,
    currency_code text DEFAULT 'EUR'::text NOT NULL,
    avg_price numeric(12,4),
    qty_avg_price numeric(12,4),
    fetched_at timestamp with time zone DEFAULT now()
);
CREATE SEQUENCE public.part_price_cache_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.part_price_cache_id_seq OWNED BY public.part_price_cache.id;
CREATE TABLE public.part_price_history (
    id integer NOT NULL,
    part_number text NOT NULL,
    color_id integer DEFAULT 0 NOT NULL,
    condition text DEFAULT 'U'::text NOT NULL,
    currency_code text DEFAULT 'EUR'::text NOT NULL,
    avg_price numeric(12,4),
    qty_avg_price numeric(12,4),
    recorded_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE SEQUENCE public.part_price_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.part_price_history_id_seq OWNED BY public.part_price_history.id;
CREATE TABLE public.parts (
    id integer NOT NULL,
    user_id integer NOT NULL,
    set_number text,
    part_number text NOT NULL,
    color_id integer,
    source text DEFAULT 'set'::text,
    storage_id integer,
    added_at timestamp with time zone DEFAULT now()
);
CREATE SEQUENCE public.parts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.parts_id_seq OWNED BY public.parts.id;
CREATE TABLE public.parts_summary (
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
    storage text
);
CREATE TABLE public.parts_summary_state (
    user_id integer NOT NULL,
    built_version bigint DEFAULT 0 NOT NULL,
    built_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.price_alerts (
    user_id integer NOT NULL,
    set_number text NOT NULL,
    condition text DEFAULT 'N'::text NOT NULL,
    richtung text NOT NULL,
    schwelle numeric(12,4) NOT NULL,
    currency_code text NOT NULL,
    ausgeloest boolean DEFAULT false NOT NULL,
    zuletzt_am timestamp with time zone,
    zuletzt_preis numeric(12,4),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT price_alerts_richtung CHECK ((richtung = ANY (ARRAY['unter'::text, 'ueber'::text]))),
    CONSTRAINT price_alerts_schwelle CHECK ((schwelle > (0)::numeric))
);
CREATE TABLE public.price_cache (
    id integer NOT NULL,
    set_number text NOT NULL,
    condition text DEFAULT 'N'::text NOT NULL,
    currency_code text DEFAULT 'EUR'::text NOT NULL,
    min_price numeric(12,4),
    avg_price numeric(12,4),
    max_price numeric(12,4),
    qty_avg_price numeric(12,4),
    total_quantity integer,
    fetched_at timestamp with time zone DEFAULT now()
);
CREATE SEQUENCE public.price_cache_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.price_cache_id_seq OWNED BY public.price_cache.id;
CREATE TABLE public.price_history (
    id integer NOT NULL,
    set_number text NOT NULL,
    condition text DEFAULT 'N'::text NOT NULL,
    currency_code text DEFAULT 'EUR'::text NOT NULL,
    avg_price numeric(12,4),
    qty_avg_price numeric(12,4),
    min_price numeric(12,4),
    max_price numeric(12,4),
    recorded_at timestamp with time zone DEFAULT now()
);
CREATE SEQUENCE public.price_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.price_history_id_seq OWNED BY public.price_history.id;
CREATE TABLE public.price_market (
    set_number text NOT NULL,
    currency_code text NOT NULL,
    condition text DEFAULT 'new'::text NOT NULL,
    qty_avg_price numeric(12,4),
    min_price numeric(12,4),
    max_price numeric(12,4),
    updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.qr_login_tokens (
    token text NOT NULL,
    user_id integer NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    token_days integer
);
CREATE TABLE public.rate_limit_attempts (
    key text NOT NULL,
    count integer DEFAULT 1 NOT NULL,
    first_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.rb_colors (
    id integer NOT NULL,
    name text,
    rgb text,
    is_trans text,
    bl_color_id integer
);
CREATE TABLE public.rb_inventories (
    id integer NOT NULL,
    set_num text,
    version integer
);
CREATE TABLE public.rb_inventory_minifigs (
    id integer NOT NULL,
    inventory_id integer NOT NULL,
    fig_num text NOT NULL,
    quantity integer
);
CREATE SEQUENCE public.rb_inventory_minifigs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.rb_inventory_minifigs_id_seq OWNED BY public.rb_inventory_minifigs.id;
CREATE TABLE public.rb_inventory_parts (
    id integer NOT NULL,
    inventory_id integer NOT NULL,
    part_num text NOT NULL,
    color_id integer,
    quantity integer,
    is_spare text,
    img_url text
);
CREATE SEQUENCE public.rb_inventory_parts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.rb_inventory_parts_id_seq OWNED BY public.rb_inventory_parts.id;
CREATE TABLE public.rb_part_categories (
    id integer NOT NULL,
    name text
);
CREATE TABLE public.rb_parts (
    part_num text NOT NULL,
    name text,
    part_cat_id integer,
    part_img_url text
);
CREATE TABLE public.rb_sets (
    set_num text NOT NULL,
    name text,
    year integer,
    theme_id integer,
    num_parts integer,
    set_img_url text
);
CREATE TABLE public.rb_themes (
    id integer NOT NULL,
    name text,
    parent_id integer
);
CREATE TABLE public.schema_meta (
    id integer DEFAULT 1 NOT NULL,
    applied_version text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT schema_meta_single_row CHECK ((id = 1))
);
CREATE TABLE public.schema_migrations (
    id integer NOT NULL,
    name text NOT NULL,
    run_at timestamp with time zone DEFAULT now()
);
CREATE SEQUENCE public.schema_migrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.schema_migrations_id_seq OWNED BY public.schema_migrations.id;
CREATE TABLE public.set_acquisitions (
    id integer NOT NULL,
    user_id integer NOT NULL,
    set_number text NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    purchase_price numeric(12,4),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    condition text DEFAULT 'N'::text NOT NULL,
    CONSTRAINT set_acquisitions_menge_positiv CHECK ((quantity > 0)),
    CONSTRAINT set_acquisitions_zustand CHECK ((condition = ANY (ARRAY['N'::text, 'U'::text])))
);
CREATE SEQUENCE public.set_acquisitions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.set_acquisitions_id_seq OWNED BY public.set_acquisitions.id;
CREATE TABLE public.set_catalog (
    set_number text NOT NULL,
    name text,
    year integer,
    theme text,
    pieces integer,
    minifigs integer,
    image_url text,
    image_local text,
    brickset_id integer,
    updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.set_minifigs_catalog (
    set_number text NOT NULL,
    fig_number text NOT NULL,
    fig_name text,
    quantity integer DEFAULT 1,
    image_url text,
    image_local text,
    updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.set_parts_catalog (
    set_number text NOT NULL,
    part_number text NOT NULL,
    part_name text,
    color_id integer NOT NULL,
    color_name text,
    color_hex text,
    category_name text,
    image_url text,
    image_local text,
    is_spare integer DEFAULT 0,
    quantity integer DEFAULT 1,
    updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.sets (
    id integer NOT NULL,
    user_id integer NOT NULL,
    set_number text NOT NULL,
    added_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    storage_id integer
);
CREATE SEQUENCE public.sets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.sets_id_seq OWNED BY public.sets.id;
CREATE TABLE public.shared_instructions (
    id integer NOT NULL,
    set_number text NOT NULL,
    url text NOT NULL,
    description text,
    local_path text,
    fetched_at timestamp with time zone DEFAULT now()
);
CREATE SEQUENCE public.shared_instructions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.shared_instructions_id_seq OWNED BY public.shared_instructions.id;
CREATE TABLE public.storage_locations (
    id integer NOT NULL,
    user_id integer NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);
CREATE SEQUENCE public.storage_locations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.storage_locations_id_seq OWNED BY public.storage_locations.id;
CREATE TABLE public.subsets_cache (
    set_number text NOT NULL,
    data text NOT NULL,
    fetched_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.user_sessions (
    sid character varying NOT NULL,
    sess json NOT NULL,
    expire timestamp with time zone NOT NULL
);
CREATE TABLE public.user_settings (
    user_id integer NOT NULL,
    key text NOT NULL,
    value text NOT NULL,
    updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.users (
    id integer NOT NULL,
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
    created_at timestamp with time zone DEFAULT now()
);
CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;
CREATE TABLE public.vouchers (
    id integer NOT NULL,
    user_id integer NOT NULL,
    number text NOT NULL,
    pin text,
    amount numeric(12,2) NOT NULL,
    currency text DEFAULT 'CHF'::text NOT NULL,
    pdf_path text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    guthaben_geprueft_am timestamp with time zone
);
CREATE SEQUENCE public.vouchers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.vouchers_id_seq OWNED BY public.vouchers.id;
CREATE TABLE public.wanted (
    id integer NOT NULL,
    user_id integer NOT NULL,
    set_number text NOT NULL,
    condition text DEFAULT 'N'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE SEQUENCE public.wishlist_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.wishlist_id_seq OWNED BY public.wanted.id;
CREATE TABLE public.zweiter_faktor (
    user_id integer NOT NULL,
    geheimnis text NOT NULL,
    aktiv boolean DEFAULT false NOT NULL,
    letzter_schritt bigint DEFAULT 0 NOT NULL,
    eingerichtet_am timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.zweiter_faktor_codes (
    id integer NOT NULL,
    user_id integer NOT NULL,
    code_hash text NOT NULL,
    verbraucht_am timestamp with time zone
);
CREATE SEQUENCE public.zweiter_faktor_codes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.zweiter_faktor_codes_id_seq OWNED BY public.zweiter_faktor_codes.id;
ALTER TABLE ONLY public.app_logs ALTER COLUMN id SET DEFAULT nextval('public.app_logs_id_seq'::regclass);
ALTER TABLE ONLY public.instruction_queue ALTER COLUMN id SET DEFAULT nextval('public.instruction_queue_id_seq'::regclass);
ALTER TABLE ONLY public.instructions ALTER COLUMN id SET DEFAULT nextval('public.instructions_id_seq'::regclass);
ALTER TABLE ONLY public.minifig_acquisitions ALTER COLUMN id SET DEFAULT nextval('public.minifig_acquisitions_id_seq'::regclass);
ALTER TABLE ONLY public.minifig_price_cache ALTER COLUMN id SET DEFAULT nextval('public.minifig_price_cache_id_seq'::regclass);
ALTER TABLE ONLY public.minifig_price_history ALTER COLUMN id SET DEFAULT nextval('public.minifig_price_history_id_seq'::regclass);
ALTER TABLE ONLY public.minifigs ALTER COLUMN id SET DEFAULT nextval('public.minifigs_id_seq'::regclass);
ALTER TABLE ONLY public.papierkorb ALTER COLUMN id SET DEFAULT nextval('public.papierkorb_id_seq'::regclass);
ALTER TABLE ONLY public.part_acquisitions ALTER COLUMN id SET DEFAULT nextval('public.part_acquisitions_id_seq'::regclass);
ALTER TABLE ONLY public.part_price_cache ALTER COLUMN id SET DEFAULT nextval('public.part_price_cache_id_seq'::regclass);
ALTER TABLE ONLY public.part_price_history ALTER COLUMN id SET DEFAULT nextval('public.part_price_history_id_seq'::regclass);
ALTER TABLE ONLY public.parts ALTER COLUMN id SET DEFAULT nextval('public.parts_id_seq'::regclass);
ALTER TABLE ONLY public.price_cache ALTER COLUMN id SET DEFAULT nextval('public.price_cache_id_seq'::regclass);
ALTER TABLE ONLY public.price_history ALTER COLUMN id SET DEFAULT nextval('public.price_history_id_seq'::regclass);
ALTER TABLE ONLY public.rb_inventory_minifigs ALTER COLUMN id SET DEFAULT nextval('public.rb_inventory_minifigs_id_seq'::regclass);
ALTER TABLE ONLY public.rb_inventory_parts ALTER COLUMN id SET DEFAULT nextval('public.rb_inventory_parts_id_seq'::regclass);
ALTER TABLE ONLY public.schema_migrations ALTER COLUMN id SET DEFAULT nextval('public.schema_migrations_id_seq'::regclass);
ALTER TABLE ONLY public.set_acquisitions ALTER COLUMN id SET DEFAULT nextval('public.set_acquisitions_id_seq'::regclass);
ALTER TABLE ONLY public.sets ALTER COLUMN id SET DEFAULT nextval('public.sets_id_seq'::regclass);
ALTER TABLE ONLY public.shared_instructions ALTER COLUMN id SET DEFAULT nextval('public.shared_instructions_id_seq'::regclass);
ALTER TABLE ONLY public.storage_locations ALTER COLUMN id SET DEFAULT nextval('public.storage_locations_id_seq'::regclass);
ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);
ALTER TABLE ONLY public.vouchers ALTER COLUMN id SET DEFAULT nextval('public.vouchers_id_seq'::regclass);
ALTER TABLE ONLY public.wanted ALTER COLUMN id SET DEFAULT nextval('public.wishlist_id_seq'::regclass);
ALTER TABLE ONLY public.zweiter_faktor_codes ALTER COLUMN id SET DEFAULT nextval('public.zweiter_faktor_codes_id_seq'::regclass);
INSERT INTO public.global_settings VALUES ('bricklink_consumer_key', '', '2026-10-29 18:50:17.573859+00');
INSERT INTO public.global_settings VALUES ('bricklink_consumer_secret', '', '2026-10-29 18:50:17.573859+00');
INSERT INTO public.global_settings VALUES ('bricklink_token', '', '2026-10-29 18:50:17.573859+00');
INSERT INTO public.global_settings VALUES ('bricklink_token_secret', '', '2026-10-29 18:50:17.573859+00');
INSERT INTO public.global_settings VALUES ('brickset_api_key', '', '2026-10-29 18:50:17.573859+00');
INSERT INTO public.global_settings VALUES ('rebrickable_api_key', '', '2026-10-29 18:50:17.573859+00');
INSERT INTO public.global_settings VALUES ('price_job_interval_minutes', '60', '2026-10-29 18:50:17.573859+00');
INSERT INTO public.global_settings VALUES ('registration_enabled', '0', '2026-10-29 18:50:17.573859+00');
INSERT INTO public.global_settings VALUES ('price_cache_ttl', '24', '2026-10-29 18:50:17.573859+00');
INSERT INTO public.global_settings VALUES ('default_price_condition', 'N', '2026-10-29 18:50:17.573859+00');
INSERT INTO public.global_settings VALUES ('api_limit_rebrickable', '25000', '2026-10-29 18:50:17.573859+00');
INSERT INTO public.global_settings VALUES ('api_limit_bricklink', '4000', '2026-10-29 18:50:17.573859+00');
INSERT INTO public.global_settings VALUES ('api_limit_brickset', '100', '2026-10-29 18:50:17.573859+00');
INSERT INTO public.global_settings VALUES ('smtp_host', '', '2026-10-29 18:50:17.573859+00');
INSERT INTO public.global_settings VALUES ('smtp_port', '587', '2026-10-29 18:50:17.573859+00');
INSERT INTO public.global_settings VALUES ('smtp_user', '', '2026-10-29 18:50:17.573859+00');
INSERT INTO public.global_settings VALUES ('smtp_pass', '', '2026-10-29 18:50:17.573859+00');
INSERT INTO public.global_settings VALUES ('smtp_from', '', '2026-10-29 18:50:17.573859+00');
INSERT INTO public.global_settings VALUES ('smtp_secure', '0', '2026-10-29 18:50:17.573859+00');
INSERT INTO public.global_settings VALUES ('startup_status', '{"ready":false,"step":"Farben laden... (Download...)","progress":0,"total":8,"sub":null}', '2026-10-29 18:50:30.557749+00');
INSERT INTO public.global_settings VALUES ('job_monitor_csvImport', '{"label":"CSV-Import: Farben laden... (Download...)","status":"running","progress":0,"total":8,"sub":null,"lastRun":"2026-10-29T18:50:30.531Z"}', '2026-10-29 18:50:30.609375+00');
INSERT INTO public.gutschein_guthaben_schranke VALUES (1, NULL, NULL);
INSERT INTO public.schema_meta VALUES (1, '2026.10.11.1317', '2026-10-29 18:50:17.797512+00');
INSERT INTO public.schema_migrations VALUES (1, '0001-baseline.sql', '2026-10-29 18:50:17.804033+00');
INSERT INTO public.schema_migrations VALUES (2, '0003-preisverlauf-teile-minifiguren.sql', '2026-10-29 18:50:17.808638+00');
INSERT INTO public.schema_migrations VALUES (3, '0004-erfassung-pro-tag.sql', '2026-10-29 18:50:17.829071+00');
INSERT INTO public.schema_migrations VALUES (4, '0005-haushalt-kontoverknuepfung.sql', '2026-10-29 18:50:17.845104+00');
INSERT INTO public.schema_migrations VALUES (5, '0006-verwaiste-teile-nach-verschieben.sql', '2026-10-29 18:50:17.865922+00');
INSERT INTO public.schema_migrations VALUES (6, '0007-geld-als-numeric.sql', '2026-10-29 18:50:17.883486+00');
INSERT INTO public.schema_migrations VALUES (7, '0008-erfassung-pro-tag-index.sql', '2026-10-29 18:50:18.020171+00');
INSERT INTO public.schema_migrations VALUES (8, '0009-bild-tabellen.sql', '2026-10-29 18:50:18.034897+00');
INSERT INTO public.schema_migrations VALUES (9, '0010-image-wanted-index.sql', '2026-10-29 18:50:18.048738+00');
INSERT INTO public.schema_migrations VALUES (10, '0011-image-misses-grund.sql', '2026-10-29 18:50:18.053251+00');
INSERT INTO public.schema_migrations VALUES (11, '0012-ueberzaehlige-katalog-indizes.sql', '2026-10-29 18:50:18.055968+00');
INSERT INTO public.schema_migrations VALUES (12, '0013-tote-spalte-brickset-id.sql', '2026-10-29 18:50:18.0597+00');
INSERT INTO public.schema_migrations VALUES (13, '0014-img-proxy-nach-v1.sql', '2026-10-29 18:50:18.062557+00');
INSERT INTO public.schema_migrations VALUES (14, '0015-api-tokens-sliding.sql', '2026-10-29 18:50:18.068427+00');
INSERT INTO public.schema_migrations VALUES (15, '0016-token-laufzeit.sql', '2026-10-29 18:50:18.080321+00');
INSERT INTO public.schema_migrations VALUES (16, '0017-token-unbegrenzt.sql', '2026-10-29 18:50:18.08538+00');
INSERT INTO public.schema_migrations VALUES (17, '0018-lagerort.sql', '2026-10-29 18:50:18.088892+00');
INSERT INTO public.schema_migrations VALUES (18, '0019-preisalarm.sql', '2026-10-29 18:50:18.091975+00');
INSERT INTO public.schema_migrations VALUES (19, '0020-lagerorte-verwaltet.sql', '2026-10-29 18:50:18.102305+00');
INSERT INTO public.schema_migrations VALUES (20, '0021-wunschliste.sql', '2026-10-29 18:50:18.106013+00');
INSERT INTO public.schema_migrations VALUES (21, '0022-notiz-ausbauen.sql', '2026-10-29 18:50:18.119733+00');
INSERT INTO public.schema_migrations VALUES (22, '0023-merkliste.sql', '2026-10-29 18:50:18.123258+00');
INSERT INTO public.schema_migrations VALUES (23, '0024-lagerort-minifiguren.sql', '2026-10-29 18:50:18.126882+00');
INSERT INTO public.schema_migrations VALUES (24, '0025-parts-summary-lagerort.sql', '2026-10-29 18:50:18.129539+00');
INSERT INTO public.schema_migrations VALUES (25, '0026-gutscheine.sql', '2026-10-29 18:50:18.131861+00');
INSERT INTO public.schema_migrations VALUES (26, '0027-gutschein-notiz-entfallen.sql', '2026-10-29 18:50:18.145182+00');
INSERT INTO public.schema_migrations VALUES (27, '0029-trigramm-bestandssuche.sql', '2026-10-29 18:50:18.14837+00');
INSERT INTO public.schema_migrations VALUES (28, '0030-api-tokens-user-index.sql', '2026-10-29 18:50:18.155364+00');
INSERT INTO public.schema_migrations VALUES (29, '0031-lagerort-als-id.sql', '2026-10-29 18:50:18.161137+00');
INSERT INTO public.schema_migrations VALUES (30, '0032-kaufpreis-und-zustand-nur-in-erfassungen.sql', '2026-10-29 18:50:18.167021+00');
INSERT INTO public.schema_migrations VALUES (31, '0033-stammdaten-nur-im-katalog.sql', '2026-10-29 18:50:18.192717+00');
INSERT INTO public.schema_migrations VALUES (32, '0034-teile-und-minifiguren-stammdaten-im-katalog.sql', '2026-10-29 18:50:18.196446+00');
INSERT INTO public.schema_migrations VALUES (33, '0035-teilepreise-nur-in-erfassungen.sql', '2026-10-29 18:50:18.278071+00');
INSERT INTO public.schema_migrations VALUES (34, '0036-setmenge-aus-erfassungen.sql', '2026-10-29 18:50:18.295948+00');
INSERT INTO public.schema_migrations VALUES (35, '0037-bricklink-nummern-in-einer-zuordnung.sql', '2026-10-29 18:50:18.30561+00');
INSERT INTO public.schema_migrations VALUES (36, '0038-teilemengen-aus-katalog-und-erfassungen.sql', '2026-10-29 18:50:18.343047+00');
INSERT INTO public.schema_migrations VALUES (37, '0039-gutschein-guthaben-geprueft.sql', '2026-10-29 18:50:18.369325+00');
INSERT INTO public.schema_migrations VALUES (38, '0040-erfassung-je-tag-und-zustand.sql', '2026-10-29 18:50:30.455173+00');
INSERT INTO public.schema_migrations VALUES (39, '0041-papierkorb.sql', '2026-10-29 18:50:30.470595+00');
INSERT INTO public.schema_migrations VALUES (40, '0042-zweiter-faktor.sql', '2026-10-29 18:50:30.481626+00');
INSERT INTO public.schema_migrations VALUES (41, '0043-fremdschluessel-konto.sql', '2026-10-29 18:53:23.825051+00');
INSERT INTO public.schema_migrations VALUES (42, '0044-doppelter-einladungsindex.sql', '2026-10-29 18:53:23.837342+00');
INSERT INTO public.schema_migrations VALUES (43, '0045-erfassung-gehoert-zum-bestand.sql', '2026-10-29 18:53:23.840744+00');
INSERT INTO public.schema_migrations VALUES (44, '0046-haushalt-mehrere-eltern.sql', '2026-10-29 18:53:23.850178+00');
SELECT pg_catalog.setval('public.app_logs_id_seq', 67, true);
SELECT pg_catalog.setval('public.instruction_queue_id_seq', 1, false);
SELECT pg_catalog.setval('public.instructions_id_seq', 1, false);
SELECT pg_catalog.setval('public.minifig_acquisitions_id_seq', 1, false);
SELECT pg_catalog.setval('public.minifig_price_cache_id_seq', 1, false);
SELECT pg_catalog.setval('public.minifig_price_history_id_seq', 1, false);
SELECT pg_catalog.setval('public.minifigs_id_seq', 1, false);
SELECT pg_catalog.setval('public.papierkorb_id_seq', 1, false);
SELECT pg_catalog.setval('public.part_acquisitions_id_seq', 1, false);
SELECT pg_catalog.setval('public.part_price_cache_id_seq', 1, false);
SELECT pg_catalog.setval('public.part_price_history_id_seq', 1, false);
SELECT pg_catalog.setval('public.parts_id_seq', 1, false);
SELECT pg_catalog.setval('public.price_cache_id_seq', 1, false);
SELECT pg_catalog.setval('public.price_history_id_seq', 1, false);
SELECT pg_catalog.setval('public.rb_inventory_minifigs_id_seq', 1, false);
SELECT pg_catalog.setval('public.rb_inventory_parts_id_seq', 1, false);
SELECT pg_catalog.setval('public.schema_migrations_id_seq', 44, true);
SELECT pg_catalog.setval('public.set_acquisitions_id_seq', 1, false);
SELECT pg_catalog.setval('public.sets_id_seq', 1, false);
SELECT pg_catalog.setval('public.shared_instructions_id_seq', 1, false);
SELECT pg_catalog.setval('public.storage_locations_id_seq', 1, false);
SELECT pg_catalog.setval('public.users_id_seq', 1, true);
SELECT pg_catalog.setval('public.vouchers_id_seq', 1, false);
SELECT pg_catalog.setval('public.wishlist_id_seq', 1, false);
SELECT pg_catalog.setval('public.zweiter_faktor_codes_id_seq', 1, false);
ALTER TABLE ONLY public.account_link_invites
    ADD CONSTRAINT account_link_invites_pkey PRIMARY KEY (token_hash);
ALTER TABLE ONLY public.account_links
    ADD CONSTRAINT account_links_pkey PRIMARY KEY (main_user_id, sub_user_id);
ALTER TABLE ONLY public.api_tokens
    ADD CONSTRAINT api_tokens_pkey PRIMARY KEY (token);
ALTER TABLE ONLY public.app_logs
    ADD CONSTRAINT app_logs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.bl_zuordnung
    ADD CONSTRAINT bl_zuordnung_pkey PRIMARY KEY (art, rb_id);
ALTER TABLE ONLY public.brickset_retry_queue
    ADD CONSTRAINT brickset_retry_queue_pkey PRIMARY KEY (set_number);
ALTER TABLE ONLY public.catalog_cache
    ADD CONSTRAINT catalog_cache_pkey PRIMARY KEY (set_number);
ALTER TABLE ONLY public.csv_import_jobs
    ADD CONSTRAINT csv_import_jobs_pkey PRIMARY KEY (user_id);
ALTER TABLE ONLY public.global_settings
    ADD CONSTRAINT global_settings_pkey PRIMARY KEY (key);
ALTER TABLE ONLY public.gutschein_guthaben_schranke
    ADD CONSTRAINT gutschein_guthaben_schranke_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.household_former_links
    ADD CONSTRAINT household_former_links_pkey PRIMARY KEY (main_user_id, sub_user_id);
ALTER TABLE ONLY public.image_misses
    ADD CONSTRAINT image_misses_pkey PRIMARY KEY (cache_key);
ALTER TABLE ONLY public.image_wanted
    ADD CONSTRAINT image_wanted_pkey PRIMARY KEY (url);
ALTER TABLE ONLY public.instruction_queue
    ADD CONSTRAINT instruction_queue_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.instructions
    ADD CONSTRAINT instructions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.minifig_acquisitions
    ADD CONSTRAINT minifig_acquisitions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.minifig_parts_cache
    ADD CONSTRAINT minifig_parts_cache_pkey PRIMARY KEY (fig_number);
ALTER TABLE ONLY public.minifig_price_cache
    ADD CONSTRAINT minifig_price_cache_fig_number_condition_currency_code_key UNIQUE (fig_number, condition, currency_code);
ALTER TABLE ONLY public.minifig_price_cache
    ADD CONSTRAINT minifig_price_cache_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.minifig_price_history
    ADD CONSTRAINT minifig_price_history_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.minifigs_catalog
    ADD CONSTRAINT minifigs_catalog_pkey PRIMARY KEY (fig_number);
ALTER TABLE ONLY public.minifigs
    ADD CONSTRAINT minifigs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.papierkorb
    ADD CONSTRAINT papierkorb_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.part_acquisitions
    ADD CONSTRAINT part_acquisitions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.part_catalog
    ADD CONSTRAINT part_catalog_pkey PRIMARY KEY (part_number);
ALTER TABLE ONLY public.part_color_catalog
    ADD CONSTRAINT part_color_catalog_pkey PRIMARY KEY (part_number, color_id);
ALTER TABLE ONLY public.part_price_cache
    ADD CONSTRAINT part_price_cache_part_number_color_id_condition_currency_co_key UNIQUE (part_number, color_id, condition, currency_code);
ALTER TABLE ONLY public.part_price_cache
    ADD CONSTRAINT part_price_cache_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.part_price_history
    ADD CONSTRAINT part_price_history_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.parts
    ADD CONSTRAINT parts_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.parts_summary
    ADD CONSTRAINT parts_summary_pkey PRIMARY KEY (user_id, part_key, color_id);
ALTER TABLE ONLY public.parts_summary_state
    ADD CONSTRAINT parts_summary_state_pkey PRIMARY KEY (user_id);
ALTER TABLE ONLY public.price_alerts
    ADD CONSTRAINT price_alerts_pkey PRIMARY KEY (user_id, set_number, condition);
ALTER TABLE ONLY public.price_cache
    ADD CONSTRAINT price_cache_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.price_cache
    ADD CONSTRAINT price_cache_set_number_condition_currency_code_key UNIQUE (set_number, condition, currency_code);
ALTER TABLE ONLY public.price_history
    ADD CONSTRAINT price_history_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.price_market
    ADD CONSTRAINT price_market_pkey PRIMARY KEY (set_number, currency_code, condition);
ALTER TABLE ONLY public.qr_login_tokens
    ADD CONSTRAINT qr_login_tokens_pkey PRIMARY KEY (token);
ALTER TABLE ONLY public.rate_limit_attempts
    ADD CONSTRAINT rate_limit_attempts_pkey PRIMARY KEY (key);
ALTER TABLE ONLY public.rb_colors
    ADD CONSTRAINT rb_colors_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.rb_inventories
    ADD CONSTRAINT rb_inventories_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.rb_inventory_minifigs
    ADD CONSTRAINT rb_inventory_minifigs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.rb_inventory_parts
    ADD CONSTRAINT rb_inventory_parts_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.rb_part_categories
    ADD CONSTRAINT rb_part_categories_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.rb_parts
    ADD CONSTRAINT rb_parts_pkey PRIMARY KEY (part_num);
ALTER TABLE ONLY public.rb_sets
    ADD CONSTRAINT rb_sets_pkey PRIMARY KEY (set_num);
ALTER TABLE ONLY public.rb_themes
    ADD CONSTRAINT rb_themes_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.schema_meta
    ADD CONSTRAINT schema_meta_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_name_key UNIQUE (name);
ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.set_acquisitions
    ADD CONSTRAINT set_acquisitions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.set_catalog
    ADD CONSTRAINT set_catalog_pkey PRIMARY KEY (set_number);
ALTER TABLE ONLY public.set_minifigs_catalog
    ADD CONSTRAINT set_minifigs_catalog_pkey PRIMARY KEY (set_number, fig_number);
ALTER TABLE ONLY public.set_parts_catalog
    ADD CONSTRAINT set_parts_catalog_pkey PRIMARY KEY (set_number, part_number, color_id);
ALTER TABLE ONLY public.sets
    ADD CONSTRAINT sets_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.sets
    ADD CONSTRAINT sets_user_id_set_number_key UNIQUE (user_id, set_number);
ALTER TABLE ONLY public.shared_instructions
    ADD CONSTRAINT shared_instructions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.shared_instructions
    ADD CONSTRAINT shared_instructions_set_number_url_key UNIQUE (set_number, url);
ALTER TABLE ONLY public.storage_locations
    ADD CONSTRAINT storage_locations_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.subsets_cache
    ADD CONSTRAINT subsets_cache_pkey PRIMARY KEY (set_number);
ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT user_sessions_pkey PRIMARY KEY (sid);
ALTER TABLE ONLY public.user_settings
    ADD CONSTRAINT user_settings_pkey PRIMARY KEY (user_id, key);
ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);
ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);
ALTER TABLE ONLY public.vouchers
    ADD CONSTRAINT vouchers_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.vouchers
    ADD CONSTRAINT vouchers_user_id_number_key UNIQUE (user_id, number);
ALTER TABLE ONLY public.wanted
    ADD CONSTRAINT wishlist_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.wanted
    ADD CONSTRAINT wishlist_user_id_set_number_condition_key UNIQUE (user_id, set_number, condition);
ALTER TABLE ONLY public.zweiter_faktor_codes
    ADD CONSTRAINT zweiter_faktor_codes_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.zweiter_faktor
    ADD CONSTRAINT zweiter_faktor_pkey PRIMARY KEY (user_id);
CREATE INDEX idx_account_link_invites_main ON public.account_link_invites USING btree (main_user_id, expires_at);
CREATE INDEX idx_account_links_main ON public.account_links USING btree (main_user_id);
CREATE INDEX idx_account_links_sub ON public.account_links USING btree (sub_user_id);
CREATE INDEX idx_acq_user_set ON public.set_acquisitions USING btree (user_id, set_number);
CREATE INDEX idx_api_tokens_expires ON public.api_tokens USING btree (expires_at) WHERE (expires_at IS NOT NULL);
CREATE INDEX idx_api_tokens_hard ON public.api_tokens USING btree (hard_expires_at) WHERE (hard_expires_at IS NOT NULL);
CREATE INDEX idx_api_tokens_idle ON public.api_tokens USING btree (last_used) WHERE (expires_at IS NULL);
CREATE INDEX idx_api_tokens_user_created ON public.api_tokens USING btree (user_id, created_at DESC);
CREATE INDEX idx_app_logs_logged_at ON public.app_logs USING btree (logged_at DESC);
CREATE INDEX idx_bl_zuordnung_bl ON public.bl_zuordnung USING btree (art, bl_id);
CREATE INDEX idx_household_former_sub ON public.household_former_links USING btree (sub_user_id);
CREATE INDEX idx_household_former_via ON public.household_former_links USING btree (via_user_id);
CREATE INDEX idx_image_wanted_alter ON public.image_wanted USING btree (requested_at);
CREATE UNIQUE INDEX idx_instr_queue_set ON public.instruction_queue USING btree (set_number);
CREATE INDEX idx_instructions_user ON public.instructions USING btree (user_id, set_number);
CREATE INDEX idx_invite_used_by ON public.account_link_invites USING btree (used_by);
CREATE INDEX idx_minifig_acq_gruppe ON public.minifig_acquisitions USING btree (user_id, fig_number);
CREATE UNIQUE INDEX idx_minifig_acq_tag_zustand ON public.minifig_acquisitions USING btree (user_id, fig_number, (((created_at AT TIME ZONE 'UTC'::text))::date), COALESCE(condition, 'N'::text));
CREATE INDEX idx_minifig_price_cache_lookup ON public.minifig_price_cache USING btree (fig_number, condition, currency_code, fetched_at DESC);
CREATE INDEX idx_minifig_price_history_lookup ON public.minifig_price_history USING btree (fig_number, currency_code, recorded_at);
CREATE INDEX idx_minifigs_catalog_name_trgm ON public.minifigs_catalog USING gin (lower(fig_name) public.gin_trgm_ops);
CREATE UNIQUE INDEX idx_minifigs_eindeutig ON public.minifigs USING btree (user_id, COALESCE(set_number, ''::text), fig_number);
CREATE INDEX idx_minifigs_storage_id ON public.minifigs USING btree (user_id, storage_id) WHERE (storage_id IS NOT NULL);
CREATE INDEX idx_minifigs_storage_ref ON public.minifigs USING btree (storage_id) WHERE (storage_id IS NOT NULL);
CREATE INDEX idx_minifigs_user ON public.minifigs USING btree (user_id);
CREATE INDEX idx_papierkorb_konto ON public.papierkorb USING btree (user_id, geloescht_am DESC);
CREATE INDEX idx_part_acq_gruppe ON public.part_acquisitions USING btree (user_id, part_number, color_id);
CREATE UNIQUE INDEX idx_part_acq_tag_zustand ON public.part_acquisitions USING btree (user_id, part_number, color_id, (((created_at AT TIME ZONE 'UTC'::text))::date), COALESCE(condition, 'N'::text));
CREATE INDEX idx_part_catalog_category ON public.part_catalog USING btree (category_name);
CREATE INDEX idx_part_catalog_name_trgm ON public.part_catalog USING gin (lower(part_name) public.gin_trgm_ops);
CREATE INDEX idx_part_price_cache_lookup ON public.part_price_cache USING btree (part_number, color_id, condition, currency_code, fetched_at DESC);
CREATE INDEX idx_part_price_history_lookup ON public.part_price_history USING btree (part_number, color_id, currency_code, recorded_at);
CREATE INDEX idx_parts_color_id ON public.parts USING btree (user_id, color_id);
CREATE UNIQUE INDEX idx_parts_eindeutig ON public.parts USING btree (user_id, COALESCE(set_number, ''::text), part_number, COALESCE(color_id, 0));
CREATE INDEX idx_parts_gruppe ON public.parts USING btree (user_id, part_number, color_id);
CREATE INDEX idx_parts_number_trgm ON public.parts USING gin (lower(part_number) public.gin_trgm_ops);
CREATE INDEX idx_parts_set ON public.parts USING btree (user_id, set_number);
CREATE INDEX idx_parts_storage_id ON public.parts USING btree (user_id, storage_id) WHERE (storage_id IS NOT NULL);
CREATE INDEX idx_parts_storage_ref ON public.parts USING btree (storage_id) WHERE (storage_id IS NOT NULL);
CREATE INDEX idx_parts_summary_cat ON public.parts_summary USING btree (user_id, category_name);
CREATE INDEX idx_parts_summary_color ON public.parts_summary USING btree (user_id, color_id);
CREATE INDEX idx_parts_summary_sort ON public.parts_summary USING btree (user_id, color_name, part_name);
CREATE INDEX idx_parts_user ON public.parts USING btree (user_id);
CREATE INDEX idx_price_alerts_set ON public.price_alerts USING btree (set_number, condition);
CREATE INDEX idx_price_cache_lookup ON public.price_cache USING btree (set_number, condition, currency_code, fetched_at DESC);
CREATE INDEX idx_price_history_set ON public.price_history USING btree (set_number, recorded_at);
CREATE UNIQUE INDEX idx_price_history_tag ON public.price_history USING btree (set_number, condition, currency_code, (((recorded_at AT TIME ZONE 'UTC'::text))::date));
CREATE INDEX idx_psum_blnumber_trgm ON public.parts_summary USING gin (bl_part_number public.gin_trgm_ops);
CREATE INDEX idx_psum_name_trgm ON public.parts_summary USING gin (part_name public.gin_trgm_ops);
CREATE INDEX idx_psum_number_trgm ON public.parts_summary USING gin (part_number public.gin_trgm_ops);
CREATE INDEX idx_qr_login_expires ON public.qr_login_tokens USING btree (expires_at);
CREATE INDEX idx_qr_login_user ON public.qr_login_tokens USING btree (user_id);
CREATE INDEX idx_rate_limit_first_at ON public.rate_limit_attempts USING btree (first_at);
CREATE INDEX idx_rb_inv_minifigs_inv ON public.rb_inventory_minifigs USING btree (inventory_id);
CREATE INDEX idx_rb_inv_parts ON public.rb_inventory_parts USING btree (inventory_id);
CREATE INDEX idx_rb_inv_setnum ON public.rb_inventories USING btree (set_num);
CREATE INDEX idx_rb_sets_name_trgm ON public.rb_sets USING gin (name public.gin_trgm_ops);
CREATE INDEX idx_rb_sets_setnum_trgm ON public.rb_sets USING gin (set_num public.gin_trgm_ops);
CREATE INDEX idx_rb_sets_theme_year ON public.rb_sets USING btree (theme_id, year);
CREATE INDEX idx_rb_sets_year ON public.rb_sets USING btree (year);
CREATE UNIQUE INDEX idx_set_acq_tag_zustand ON public.set_acquisitions USING btree (user_id, set_number, (((created_at AT TIME ZONE 'UTC'::text))::date), COALESCE(condition, 'N'::text));
CREATE INDEX idx_set_minifigs_fig ON public.set_minifigs_catalog USING btree (fig_number);
CREATE INDEX idx_sets_setnum ON public.sets USING btree (set_number);
CREATE INDEX idx_sets_storage_id ON public.sets USING btree (user_id, storage_id) WHERE (storage_id IS NOT NULL);
CREATE INDEX idx_sets_storage_ref ON public.sets USING btree (storage_id) WHERE (storage_id IS NOT NULL);
CREATE INDEX idx_sets_user ON public.sets USING btree (user_id);
CREATE INDEX idx_shared_instructions_set ON public.shared_instructions USING btree (set_number);
CREATE INDEX idx_smc_set ON public.set_minifigs_catalog USING btree (set_number);
CREATE INDEX idx_spc_set ON public.set_parts_catalog USING btree (set_number);
CREATE INDEX idx_user_sessions_expire ON public.user_sessions USING btree (expire);
CREATE INDEX idx_vouchers_user ON public.vouchers USING btree (user_id);
CREATE INDEX idx_wanted_user ON public.wanted USING btree (user_id, created_at DESC);
CREATE INDEX idx_zweiter_faktor_codes_konto ON public.zweiter_faktor_codes USING btree (user_id);
CREATE UNIQUE INDEX storage_locations_konto_name ON public.storage_locations USING btree (user_id, lower(name));
CREATE UNIQUE INDEX users_email_unique ON public.users USING btree (email) WHERE (email IS NOT NULL);
ALTER TABLE ONLY public.account_link_invites
    ADD CONSTRAINT account_link_invites_main_user_id_fkey FOREIGN KEY (main_user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.account_link_invites
    ADD CONSTRAINT account_link_invites_used_by_fkey FOREIGN KEY (used_by) REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.account_links
    ADD CONSTRAINT account_links_main_user_id_fkey FOREIGN KEY (main_user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.account_links
    ADD CONSTRAINT account_links_sub_user_id_fkey FOREIGN KEY (sub_user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.api_tokens
    ADD CONSTRAINT api_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.csv_import_jobs
    ADD CONSTRAINT csv_import_jobs_user_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.household_former_links
    ADD CONSTRAINT household_former_links_main_user_id_fkey FOREIGN KEY (main_user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.household_former_links
    ADD CONSTRAINT household_former_links_sub_user_id_fkey FOREIGN KEY (sub_user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.household_former_links
    ADD CONSTRAINT household_former_links_via_user_id_fkey FOREIGN KEY (via_user_id) REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.instructions
    ADD CONSTRAINT instructions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.minifig_acquisitions
    ADD CONSTRAINT minifig_acquisitions_user_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.minifigs
    ADD CONSTRAINT minifigs_storage_id_fkey FOREIGN KEY (storage_id) REFERENCES public.storage_locations(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.minifigs
    ADD CONSTRAINT minifigs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.papierkorb
    ADD CONSTRAINT papierkorb_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.part_acquisitions
    ADD CONSTRAINT part_acquisitions_user_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.parts
    ADD CONSTRAINT parts_storage_id_fkey FOREIGN KEY (storage_id) REFERENCES public.storage_locations(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.parts_summary_state
    ADD CONSTRAINT parts_summary_state_user_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.parts_summary
    ADD CONSTRAINT parts_summary_user_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.parts
    ADD CONSTRAINT parts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.price_alerts
    ADD CONSTRAINT price_alerts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.qr_login_tokens
    ADD CONSTRAINT qr_login_tokens_user_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.set_acquisitions
    ADD CONSTRAINT set_acquisitions_bestand_fkey FOREIGN KEY (user_id, set_number) REFERENCES public.sets(user_id, set_number) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE ONLY public.set_acquisitions
    ADD CONSTRAINT set_acquisitions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.sets
    ADD CONSTRAINT sets_storage_id_fkey FOREIGN KEY (storage_id) REFERENCES public.storage_locations(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.sets
    ADD CONSTRAINT sets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.storage_locations
    ADD CONSTRAINT storage_locations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.user_settings
    ADD CONSTRAINT user_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.vouchers
    ADD CONSTRAINT vouchers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.wanted
    ADD CONSTRAINT wishlist_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.zweiter_faktor_codes
    ADD CONSTRAINT zweiter_faktor_codes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.zweiter_faktor
    ADD CONSTRAINT zweiter_faktor_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
