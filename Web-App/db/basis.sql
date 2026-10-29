-- Schema einer NEUEN Installation: Abbild aller Migrationen, die es bei
-- seiner Erzeugung gab. db/database.ts spielt es in eine leere Datenbank,
-- danach laufen nur die jüngeren Migrationen. Nicht von Hand ändern —
-- neu erzeugen mit `npm run build && npm run schema:stand`.
--
-- PostgreSQL database dump
--

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

--
-- Name: bild_stamm(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.bild_stamm(pfad text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
    AS $_$ SELECT regexp_replace(regexp_replace(pfad, '^.*/', ''), '\.[^.]*$', '') $_$;

--
-- Name: bump_parts_katalog(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.bump_parts_katalog() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE parts_katalog_stand SET v = v + 1 WHERE id = 1;
  RETURN NULL;
END $$;

--
-- Name: bump_parts_version_del(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.bump_parts_version_del() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  INSERT INTO parts_version_user (user_id, v)
  SELECT DISTINCT user_id, 1 FROM alt WHERE user_id IS NOT NULL AND user_id IN (SELECT id FROM users)
  ON CONFLICT (user_id) DO UPDATE SET v = parts_version_user.v + 1;
  RETURN NULL;
END $$;

--
-- Name: bump_parts_version_erfassung_upd(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.bump_parts_version_erfassung_upd() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
END $$;

--
-- Name: bump_parts_version_ins(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.bump_parts_version_ins() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  INSERT INTO parts_version_user (user_id, v)
  SELECT DISTINCT user_id, 1 FROM neu WHERE user_id IS NOT NULL AND user_id IN (SELECT id FROM users)
  ON CONFLICT (user_id) DO UPDATE SET v = parts_version_user.v + 1;
  RETURN NULL;
END $$;

--
-- Name: bump_parts_version_lagerort_upd(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.bump_parts_version_lagerort_upd() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  INSERT INTO parts_version_user (user_id, v)
  SELECT DISTINCT n.user_id, 1 FROM alt a JOIN neu n ON n.id = a.id
   WHERE a.name IS DISTINCT FROM n.name AND n.user_id IN (SELECT id FROM users)
  ON CONFLICT (user_id) DO UPDATE SET v = parts_version_user.v + 1;
  RETURN NULL;
END $$;

--
-- Name: bump_parts_version_upd(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.bump_parts_version_upd() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  INSERT INTO parts_version_user (user_id, v)
  SELECT DISTINCT user_id, 1 FROM (
    SELECT user_id FROM alt UNION SELECT user_id FROM neu
  ) x WHERE user_id IS NOT NULL AND user_id IN (SELECT id FROM users)
  ON CONFLICT (user_id) DO UPDATE SET v = parts_version_user.v + 1;
  RETURN NULL;
END $$;

--
-- Name: erfassung_waehrung(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.erfassung_waehrung() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.currency IS NULL THEN
    NEW.currency := COALESCE(
      (SELECT value FROM user_settings WHERE user_id = NEW.user_id AND key = 'currency'), 'EUR');
  END IF;
  RETURN NEW;
END $$;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: account_link_invites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account_link_invites (
    token_hash text NOT NULL,
    main_user_id integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    used_by integer
);

--
-- Name: account_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account_links (
    main_user_id integer NOT NULL,
    sub_user_id integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT account_links_no_self CHECK ((main_user_id <> sub_user_id))
);

--
-- Name: api_aufrufe; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.api_aufrufe (
    tag date NOT NULL,
    api text NOT NULL,
    konto integer DEFAULT 0 NOT NULL,
    anzahl integer DEFAULT 0 NOT NULL,
    CONSTRAINT api_aufrufe_anzahl_check CHECK ((anzahl >= 0)),
    CONSTRAINT api_aufrufe_api_check CHECK ((api = ANY (ARRAY['bricklink'::text, 'rebrickable'::text, 'brickset'::text])))
);

--
-- Name: api_takt; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.api_takt (
    api text NOT NULL,
    naechster timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: api_tokens; Type: TABLE; Schema: public; Owner: -
--

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

--
-- Name: app_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_logs (
    id bigint NOT NULL,
    level character varying(10) DEFAULT 'info'::character varying NOT NULL,
    message text NOT NULL,
    logged_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: app_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.app_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: app_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.app_logs_id_seq OWNED BY public.app_logs.id;

--
-- Name: auftraege; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auftraege (
    id bigint NOT NULL,
    art text NOT NULL,
    nutzlast jsonb DEFAULT '{}'::jsonb NOT NULL,
    user_id integer,
    schluessel text,
    status text DEFAULT 'offen'::text NOT NULL,
    versuche integer DEFAULT 0 NOT NULL,
    max_versuche integer DEFAULT 5 NOT NULL,
    next_run_at timestamp with time zone DEFAULT now() NOT NULL,
    belegt_von text,
    fehler text,
    erstellt timestamp with time zone DEFAULT now() NOT NULL,
    aktualisiert timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT auftraege_max_versuche_check CHECK ((max_versuche > 0)),
    CONSTRAINT auftraege_status_check CHECK ((status = ANY (ARRAY['offen'::text, 'laeuft'::text, 'erledigt'::text, 'fehler'::text])))
);

--
-- Name: auftraege_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.auftraege_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: auftraege_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.auftraege_id_seq OWNED BY public.auftraege.id;

--
-- Name: bl_zuordnung; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bl_zuordnung (
    art text NOT NULL,
    rb_id text NOT NULL,
    bl_id text,
    fetched_at timestamp with time zone DEFAULT now(),
    CONSTRAINT bl_zuordnung_art CHECK ((art = ANY (ARRAY['part'::text, 'fig'::text, 'set'::text])))
);

--
-- Name: brickset_retry_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.brickset_retry_queue (
    set_number text NOT NULL,
    retry_after date NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    last_error text,
    created_at timestamp with time zone DEFAULT now()
);

--
-- Name: catalog_cache; Type: TABLE; Schema: public; Owner: -
--

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

--
-- Name: csv_import_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.csv_import_jobs (
    user_id integer NOT NULL,
    status text DEFAULT 'running'::text NOT NULL,
    total integer DEFAULT 0 NOT NULL,
    done integer DEFAULT 0 NOT NULL,
    current text,
    results jsonb DEFAULT '[]'::jsonb NOT NULL,
    error text,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    run_id text,
    CONSTRAINT csv_import_jobs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'done'::text, 'error'::text, 'cancelled'::text])))
);

--
-- Name: global_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.global_settings (
    key text NOT NULL,
    value text NOT NULL,
    updated_at timestamp with time zone DEFAULT now()
);

--
-- Name: gutschein_guthaben_schranke; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gutschein_guthaben_schranke (
    id smallint DEFAULT 1 NOT NULL,
    letzter_abruf timestamp with time zone,
    sperre_bis timestamp with time zone,
    CONSTRAINT gutschein_guthaben_schranke_id_check CHECK ((id = 1))
);

--
-- Name: household_former_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.household_former_links (
    main_user_id integer NOT NULL,
    sub_user_id integer NOT NULL,
    via_user_id integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: image_misses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.image_misses (
    cache_key text NOT NULL,
    checked_at timestamp with time zone DEFAULT now() NOT NULL,
    reason text
);

--
-- Name: image_wanted; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.image_wanted (
    url text NOT NULL,
    set_number text,
    requested_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: instruction_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.instruction_queue (
    id integer NOT NULL,
    set_number text NOT NULL,
    status text DEFAULT 'pending'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT instruction_queue_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'done'::text, 'failed'::text])))
);

--
-- Name: instruction_queue_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.instruction_queue_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: instruction_queue_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.instruction_queue_id_seq OWNED BY public.instruction_queue.id;

--
-- Name: instructions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.instructions (
    id integer NOT NULL,
    user_id integer NOT NULL,
    set_number text NOT NULL,
    url text NOT NULL,
    description text,
    local_path text,
    downloaded_at timestamp with time zone DEFAULT now()
);

--
-- Name: instructions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.instructions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: instructions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.instructions_id_seq OWNED BY public.instructions.id;

--
-- Name: laufzustand; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.laufzustand (
    schluessel text NOT NULL,
    wert text DEFAULT ''::text NOT NULL,
    aktualisiert timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: minifig_acquisitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.minifig_acquisitions (
    id integer NOT NULL,
    user_id integer NOT NULL,
    fig_number text NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    unit_price numeric(12,4),
    condition text DEFAULT 'N'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    currency text NOT NULL,
    price_estimated boolean DEFAULT false NOT NULL,
    CONSTRAINT minifig_acquisitions_currency_iso CHECK ((currency ~ '^[A-Z]{3}$'::text)),
    CONSTRAINT minifig_acquisitions_menge_positiv CHECK ((quantity > 0)),
    CONSTRAINT minifig_acquisitions_unit_price_nicht_negativ CHECK ((unit_price >= (0)::numeric)),
    CONSTRAINT minifig_acquisitions_zustand CHECK ((condition = ANY (ARRAY['N'::text, 'U'::text])))
);

--
-- Name: minifig_acquisitions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.minifig_acquisitions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: minifig_acquisitions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.minifig_acquisitions_id_seq OWNED BY public.minifig_acquisitions.id;

--
-- Name: minifig_parts_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.minifig_parts_cache (
    fig_number text NOT NULL,
    data text NOT NULL,
    fetched_at timestamp with time zone DEFAULT now()
);

--
-- Name: minifig_price_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.minifig_price_cache (
    id integer NOT NULL,
    fig_number text NOT NULL,
    condition text DEFAULT 'U'::text NOT NULL,
    currency_code text DEFAULT 'EUR'::text NOT NULL,
    avg_price numeric(12,4),
    qty_avg_price numeric(12,4),
    fetched_at timestamp with time zone DEFAULT now(),
    geschaetzt boolean DEFAULT false NOT NULL,
    abdeckung numeric(4,3),
    CONSTRAINT minifig_price_cache_avg_price_nicht_negativ CHECK ((avg_price >= (0)::numeric)),
    CONSTRAINT minifig_price_cache_currency_code_iso CHECK ((currency_code ~ '^[A-Z]{3}$'::text)),
    CONSTRAINT minifig_price_cache_qty_avg_price_nicht_negativ CHECK ((qty_avg_price >= (0)::numeric))
);

--
-- Name: minifig_price_cache_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.minifig_price_cache_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: minifig_price_cache_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.minifig_price_cache_id_seq OWNED BY public.minifig_price_cache.id;

--
-- Name: minifig_price_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.minifig_price_history (
    id integer NOT NULL,
    fig_number text NOT NULL,
    condition text DEFAULT 'U'::text NOT NULL,
    currency_code text DEFAULT 'EUR'::text NOT NULL,
    avg_price numeric(12,4),
    qty_avg_price numeric(12,4),
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    geschaetzt boolean DEFAULT false NOT NULL,
    abdeckung numeric(4,3),
    CONSTRAINT minifig_price_history_avg_price_nicht_negativ CHECK ((avg_price >= (0)::numeric)),
    CONSTRAINT minifig_price_history_currency_code_iso CHECK ((currency_code ~ '^[A-Z]{3}$'::text)),
    CONSTRAINT minifig_price_history_qty_avg_price_nicht_negativ CHECK ((qty_avg_price >= (0)::numeric))
);

--
-- Name: minifig_price_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.minifig_price_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: minifig_price_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.minifig_price_history_id_seq OWNED BY public.minifig_price_history.id;

--
-- Name: minifigs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.minifigs (
    id integer NOT NULL,
    user_id integer NOT NULL,
    set_number text,
    fig_number text NOT NULL,
    source text DEFAULT 'set'::text,
    storage_id integer,
    CONSTRAINT minifigs_source_check CHECK ((source = ANY (ARRAY['set'::text, 'manual'::text])))
);

--
-- Name: minifigs_catalog; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.minifigs_catalog (
    fig_number text NOT NULL,
    fig_name text,
    image_url text,
    image_local text,
    updated_at timestamp with time zone DEFAULT now(),
    name_von integer,
    bild_von integer
);

--
-- Name: minifigs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.minifigs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: minifigs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.minifigs_id_seq OWNED BY public.minifigs.id;

--
-- Name: papierkorb; Type: TABLE; Schema: public; Owner: -
--

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

--
-- Name: papierkorb_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.papierkorb_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: papierkorb_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.papierkorb_id_seq OWNED BY public.papierkorb.id;

--
-- Name: part_acquisitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.part_acquisitions (
    id integer NOT NULL,
    user_id integer NOT NULL,
    part_number text NOT NULL,
    color_id integer DEFAULT 0 NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    unit_price numeric(12,4),
    condition text DEFAULT 'N'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    currency text NOT NULL,
    price_estimated boolean DEFAULT false NOT NULL,
    CONSTRAINT part_acquisitions_currency_iso CHECK ((currency ~ '^[A-Z]{3}$'::text)),
    CONSTRAINT part_acquisitions_menge_positiv CHECK ((quantity > 0)),
    CONSTRAINT part_acquisitions_unit_price_nicht_negativ CHECK ((unit_price >= (0)::numeric)),
    CONSTRAINT part_acquisitions_zustand CHECK ((condition = ANY (ARRAY['N'::text, 'U'::text])))
);

--
-- Name: part_acquisitions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.part_acquisitions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: part_acquisitions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.part_acquisitions_id_seq OWNED BY public.part_acquisitions.id;

--
-- Name: part_catalog; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.part_catalog (
    part_number text NOT NULL,
    part_name text,
    category_name text,
    updated_at timestamp with time zone DEFAULT now(),
    name_von integer,
    kategorie_von integer
);

--
-- Name: part_color_catalog; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.part_color_catalog (
    part_number text NOT NULL,
    color_id integer NOT NULL,
    color_name text,
    color_hex text,
    image_url text,
    image_local text,
    updated_at timestamp with time zone DEFAULT now(),
    farbname_von integer,
    farbcode_von integer,
    bild_von integer
);

--
-- Name: part_price_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.part_price_cache (
    id integer NOT NULL,
    part_number text NOT NULL,
    color_id integer DEFAULT 0 NOT NULL,
    condition text DEFAULT 'U'::text NOT NULL,
    currency_code text DEFAULT 'EUR'::text NOT NULL,
    avg_price numeric(12,4),
    qty_avg_price numeric(12,4),
    fetched_at timestamp with time zone DEFAULT now(),
    CONSTRAINT part_price_cache_avg_price_nicht_negativ CHECK ((avg_price >= (0)::numeric)),
    CONSTRAINT part_price_cache_currency_code_iso CHECK ((currency_code ~ '^[A-Z]{3}$'::text)),
    CONSTRAINT part_price_cache_qty_avg_price_nicht_negativ CHECK ((qty_avg_price >= (0)::numeric))
);

--
-- Name: part_price_cache_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.part_price_cache_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: part_price_cache_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.part_price_cache_id_seq OWNED BY public.part_price_cache.id;

--
-- Name: part_price_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.part_price_history (
    id integer NOT NULL,
    part_number text NOT NULL,
    color_id integer DEFAULT 0 NOT NULL,
    condition text DEFAULT 'U'::text NOT NULL,
    currency_code text DEFAULT 'EUR'::text NOT NULL,
    avg_price numeric(12,4),
    qty_avg_price numeric(12,4),
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT part_price_history_avg_price_nicht_negativ CHECK ((avg_price >= (0)::numeric)),
    CONSTRAINT part_price_history_currency_code_iso CHECK ((currency_code ~ '^[A-Z]{3}$'::text)),
    CONSTRAINT part_price_history_qty_avg_price_nicht_negativ CHECK ((qty_avg_price >= (0)::numeric))
);

--
-- Name: part_price_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.part_price_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: part_price_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.part_price_history_id_seq OWNED BY public.part_price_history.id;

--
-- Name: parts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.parts (
    id integer NOT NULL,
    user_id integer NOT NULL,
    set_number text,
    part_number text NOT NULL,
    color_id integer,
    source text DEFAULT 'set'::text,
    storage_id integer,
    added_at timestamp with time zone DEFAULT now(),
    CONSTRAINT parts_source_check CHECK ((source = ANY (ARRAY['set'::text, 'manual'::text])))
);

--
-- Name: parts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.parts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: parts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.parts_id_seq OWNED BY public.parts.id;

--
-- Name: parts_katalog_stand; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.parts_katalog_stand (
    id integer DEFAULT 1 NOT NULL,
    v bigint DEFAULT 0 NOT NULL,
    CONSTRAINT parts_katalog_stand_id_check CHECK ((id = 1))
);

--
-- Name: parts_summary; Type: TABLE; Schema: public; Owner: -
--

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

--
-- Name: parts_summary_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.parts_summary_state (
    user_id integer NOT NULL,
    built_version bigint DEFAULT 0 NOT NULL,
    built_at timestamp with time zone DEFAULT now(),
    katalog_stand bigint DEFAULT '-1'::integer NOT NULL
);

--
-- Name: parts_version_user; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.parts_version_user (
    user_id integer NOT NULL,
    v bigint DEFAULT 0 NOT NULL
);

--
-- Name: pdf_auftraege; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pdf_auftraege (
    id text NOT NULL,
    user_id integer NOT NULL,
    status text NOT NULL,
    fehler text,
    fehlende_bilder integer,
    eta_sekunden integer,
    aktualisiert timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pdf_auftraege_status_check CHECK ((status = ANY (ARRAY['running'::text, 'done'::text, 'error'::text])))
);

--
-- Name: price_alerts; Type: TABLE; Schema: public; Owner: -
--

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
    CONSTRAINT price_alerts_currency_code_iso CHECK ((currency_code ~ '^[A-Z]{3}$'::text)),
    CONSTRAINT price_alerts_richtung CHECK ((richtung = ANY (ARRAY['unter'::text, 'ueber'::text]))),
    CONSTRAINT price_alerts_schwelle CHECK ((schwelle > (0)::numeric))
);

--
-- Name: price_cache; Type: TABLE; Schema: public; Owner: -
--

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
    fetched_at timestamp with time zone DEFAULT now(),
    CONSTRAINT price_cache_avg_price_nicht_negativ CHECK ((avg_price >= (0)::numeric)),
    CONSTRAINT price_cache_currency_code_iso CHECK ((currency_code ~ '^[A-Z]{3}$'::text)),
    CONSTRAINT price_cache_max_price_nicht_negativ CHECK ((max_price >= (0)::numeric)),
    CONSTRAINT price_cache_min_price_nicht_negativ CHECK ((min_price >= (0)::numeric)),
    CONSTRAINT price_cache_qty_avg_price_nicht_negativ CHECK ((qty_avg_price >= (0)::numeric))
);

--
-- Name: price_cache_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.price_cache_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: price_cache_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.price_cache_id_seq OWNED BY public.price_cache.id;

--
-- Name: price_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.price_history (
    id integer NOT NULL,
    set_number text NOT NULL,
    condition text DEFAULT 'N'::text NOT NULL,
    currency_code text DEFAULT 'EUR'::text NOT NULL,
    avg_price numeric(12,4),
    qty_avg_price numeric(12,4),
    min_price numeric(12,4),
    max_price numeric(12,4),
    recorded_at timestamp with time zone DEFAULT now(),
    CONSTRAINT price_history_avg_price_nicht_negativ CHECK ((avg_price >= (0)::numeric)),
    CONSTRAINT price_history_currency_code_iso CHECK ((currency_code ~ '^[A-Z]{3}$'::text)),
    CONSTRAINT price_history_max_price_nicht_negativ CHECK ((max_price >= (0)::numeric)),
    CONSTRAINT price_history_min_price_nicht_negativ CHECK ((min_price >= (0)::numeric)),
    CONSTRAINT price_history_qty_avg_price_nicht_negativ CHECK ((qty_avg_price >= (0)::numeric))
);

--
-- Name: price_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.price_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: price_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.price_history_id_seq OWNED BY public.price_history.id;

--
-- Name: qr_login_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.qr_login_tokens (
    token text NOT NULL,
    user_id integer NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    token_days integer
);

--
-- Name: rate_limit_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rate_limit_attempts (
    key text NOT NULL,
    count integer DEFAULT 1 NOT NULL,
    first_at timestamp with time zone DEFAULT now() NOT NULL,
    last_at timestamp with time zone,
    laufend integer DEFAULT 0 NOT NULL,
    laufend_seit timestamp with time zone
);

--
-- Name: rb_colors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rb_colors (
    id integer NOT NULL,
    name text,
    rgb text,
    is_trans text,
    bl_color_id integer
);

--
-- Name: rb_inventories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rb_inventories (
    id integer NOT NULL,
    set_num text,
    version integer
);

--
-- Name: rb_inventory_minifigs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rb_inventory_minifigs (
    id integer NOT NULL,
    inventory_id integer NOT NULL,
    fig_num text NOT NULL,
    quantity integer
);

--
-- Name: rb_inventory_minifigs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rb_inventory_minifigs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: rb_inventory_minifigs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rb_inventory_minifigs_id_seq OWNED BY public.rb_inventory_minifigs.id;

--
-- Name: rb_inventory_parts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rb_inventory_parts (
    id integer NOT NULL,
    inventory_id integer NOT NULL,
    part_num text NOT NULL,
    color_id integer,
    quantity integer,
    is_spare text,
    img_url text
);

--
-- Name: rb_inventory_parts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rb_inventory_parts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: rb_inventory_parts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rb_inventory_parts_id_seq OWNED BY public.rb_inventory_parts.id;

--
-- Name: rb_part_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rb_part_categories (
    id integer NOT NULL,
    name text
);

--
-- Name: rb_parts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rb_parts (
    part_num text NOT NULL,
    name text,
    part_cat_id integer,
    part_img_url text
);

--
-- Name: rb_sets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rb_sets (
    set_num text NOT NULL,
    name text,
    year integer,
    theme_id integer,
    num_parts integer,
    set_img_url text
);

--
-- Name: rb_themes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rb_themes (
    id integer NOT NULL,
    name text,
    parent_id integer
);

--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    name text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: set_acquisitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.set_acquisitions (
    id integer NOT NULL,
    user_id integer NOT NULL,
    set_number text NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    purchase_price numeric(12,4),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    condition text DEFAULT 'N'::text NOT NULL,
    currency text NOT NULL,
    price_estimated boolean DEFAULT false NOT NULL,
    CONSTRAINT set_acquisitions_currency_iso CHECK ((currency ~ '^[A-Z]{3}$'::text)),
    CONSTRAINT set_acquisitions_menge_positiv CHECK ((quantity > 0)),
    CONSTRAINT set_acquisitions_purchase_price_nicht_negativ CHECK ((purchase_price >= (0)::numeric)),
    CONSTRAINT set_acquisitions_zustand CHECK ((condition = ANY (ARRAY['N'::text, 'U'::text])))
);

--
-- Name: set_acquisitions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.set_acquisitions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: set_acquisitions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.set_acquisitions_id_seq OWNED BY public.set_acquisitions.id;

--
-- Name: set_catalog; Type: TABLE; Schema: public; Owner: -
--

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

--
-- Name: set_minifigs_catalog; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.set_minifigs_catalog (
    set_number text NOT NULL,
    fig_number text NOT NULL,
    fig_name text,
    quantity integer DEFAULT 1,
    image_url text,
    image_local text,
    updated_at timestamp with time zone DEFAULT now()
);

--
-- Name: set_teile; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.set_teile (
    set_number text NOT NULL,
    part_number text NOT NULL,
    color_id integer NOT NULL,
    is_spare integer DEFAULT 0,
    quantity integer DEFAULT 1,
    updated_at timestamp with time zone DEFAULT now()
);

--
-- Name: set_parts_catalog; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.set_parts_catalog AS
 SELECT t.set_number,
    t.part_number,
        CASE
            WHEN (pc.name_von IS NULL) THEN pc.part_name
            ELSE NULL::text
        END AS part_name,
    t.color_id,
        CASE
            WHEN (pcc.farbname_von IS NULL) THEN pcc.color_name
            ELSE NULL::text
        END AS color_name,
        CASE
            WHEN (pcc.farbcode_von IS NULL) THEN pcc.color_hex
            ELSE NULL::text
        END AS color_hex,
        CASE
            WHEN (pc.kategorie_von IS NULL) THEN pc.category_name
            ELSE NULL::text
        END AS category_name,
        CASE
            WHEN (pcc.bild_von IS NULL) THEN pcc.image_url
            ELSE NULL::text
        END AS image_url,
    pcc.image_local,
    t.is_spare,
    t.quantity,
    t.updated_at
   FROM ((public.set_teile t
     LEFT JOIN public.part_catalog pc ON ((pc.part_number = t.part_number)))
     LEFT JOIN public.part_color_catalog pcc ON (((pcc.part_number = t.part_number) AND (pcc.color_id = t.color_id))));

--
-- Name: sets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sets (
    id integer NOT NULL,
    user_id integer NOT NULL,
    set_number text NOT NULL,
    added_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    storage_id integer
);

--
-- Name: sets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: sets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sets_id_seq OWNED BY public.sets.id;

--
-- Name: shared_instructions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shared_instructions (
    id integer NOT NULL,
    set_number text NOT NULL,
    url text NOT NULL,
    description text,
    local_path text,
    fetched_at timestamp with time zone DEFAULT now()
);

--
-- Name: shared_instructions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.shared_instructions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: shared_instructions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.shared_instructions_id_seq OWNED BY public.shared_instructions.id;

--
-- Name: storage_locations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.storage_locations (
    id integer NOT NULL,
    user_id integer NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);

--
-- Name: storage_locations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.storage_locations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: storage_locations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.storage_locations_id_seq OWNED BY public.storage_locations.id;

--
-- Name: subsets_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subsets_cache (
    set_number text NOT NULL,
    data text NOT NULL,
    fetched_at timestamp with time zone DEFAULT now()
);

--
-- Name: user_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_sessions (
    sid character varying NOT NULL,
    sess json NOT NULL,
    expire timestamp with time zone NOT NULL
);

--
-- Name: user_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_settings (
    user_id integer NOT NULL,
    key text NOT NULL,
    value text NOT NULL,
    updated_at timestamp with time zone DEFAULT now()
);

--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id integer NOT NULL,
    username text NOT NULL,
    email text,
    first_name text,
    last_name text,
    password_hash text NOT NULL,
    is_admin integer DEFAULT 0 NOT NULL,
    is_active integer DEFAULT 1 NOT NULL,
    email_verified integer DEFAULT 0 NOT NULL,
    verification_token text,
    token_expires timestamp with time zone,
    reset_token text,
    reset_token_expires timestamp with time zone,
    must_change_password integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT users_email_verified_schalter CHECK ((email_verified = ANY (ARRAY[0, 1]))),
    CONSTRAINT users_is_active_schalter CHECK ((is_active = ANY (ARRAY[0, 1]))),
    CONSTRAINT users_is_admin_schalter CHECK ((is_admin = ANY (ARRAY[0, 1])))
);

--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;

--
-- Name: verwaltungsprotokoll; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.verwaltungsprotokoll (
    id integer NOT NULL,
    zeit timestamp with time zone DEFAULT now() NOT NULL,
    verwalter_id integer,
    ziel_id integer,
    ziel_name text,
    aktion text NOT NULL
);

--
-- Name: verwaltungsprotokoll_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.verwaltungsprotokoll_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: verwaltungsprotokoll_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.verwaltungsprotokoll_id_seq OWNED BY public.verwaltungsprotokoll.id;

--
-- Name: vouchers; Type: TABLE; Schema: public; Owner: -
--

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
    guthaben_geprueft_am timestamp with time zone,
    CONSTRAINT vouchers_amount_nicht_negativ CHECK ((amount >= (0)::numeric)),
    CONSTRAINT vouchers_currency_iso CHECK ((currency ~ '^[A-Z]{3}$'::text))
);

--
-- Name: vouchers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vouchers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: vouchers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vouchers_id_seq OWNED BY public.vouchers.id;

--
-- Name: wanted; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wanted (
    id integer NOT NULL,
    user_id integer NOT NULL,
    set_number text NOT NULL,
    condition text DEFAULT 'N'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: wishlist_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.wishlist_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: wishlist_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.wishlist_id_seq OWNED BY public.wanted.id;

--
-- Name: zweiter_faktor; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.zweiter_faktor (
    user_id integer NOT NULL,
    geheimnis text NOT NULL,
    aktiv boolean DEFAULT false NOT NULL,
    letzter_schritt bigint DEFAULT 0 NOT NULL,
    eingerichtet_am timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: zweiter_faktor_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.zweiter_faktor_codes (
    id integer NOT NULL,
    user_id integer NOT NULL,
    code_hash text NOT NULL,
    verbraucht_am timestamp with time zone
);

--
-- Name: zweiter_faktor_codes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.zweiter_faktor_codes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: zweiter_faktor_codes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.zweiter_faktor_codes_id_seq OWNED BY public.zweiter_faktor_codes.id;

--
-- Name: app_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_logs ALTER COLUMN id SET DEFAULT nextval('public.app_logs_id_seq'::regclass);

--
-- Name: auftraege id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auftraege ALTER COLUMN id SET DEFAULT nextval('public.auftraege_id_seq'::regclass);

--
-- Name: instruction_queue id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.instruction_queue ALTER COLUMN id SET DEFAULT nextval('public.instruction_queue_id_seq'::regclass);

--
-- Name: instructions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.instructions ALTER COLUMN id SET DEFAULT nextval('public.instructions_id_seq'::regclass);

--
-- Name: minifig_acquisitions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.minifig_acquisitions ALTER COLUMN id SET DEFAULT nextval('public.minifig_acquisitions_id_seq'::regclass);

--
-- Name: minifig_price_cache id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.minifig_price_cache ALTER COLUMN id SET DEFAULT nextval('public.minifig_price_cache_id_seq'::regclass);

--
-- Name: minifig_price_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.minifig_price_history ALTER COLUMN id SET DEFAULT nextval('public.minifig_price_history_id_seq'::regclass);

--
-- Name: minifigs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.minifigs ALTER COLUMN id SET DEFAULT nextval('public.minifigs_id_seq'::regclass);

--
-- Name: papierkorb id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.papierkorb ALTER COLUMN id SET DEFAULT nextval('public.papierkorb_id_seq'::regclass);

--
-- Name: part_acquisitions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.part_acquisitions ALTER COLUMN id SET DEFAULT nextval('public.part_acquisitions_id_seq'::regclass);

--
-- Name: part_price_cache id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.part_price_cache ALTER COLUMN id SET DEFAULT nextval('public.part_price_cache_id_seq'::regclass);

--
-- Name: part_price_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.part_price_history ALTER COLUMN id SET DEFAULT nextval('public.part_price_history_id_seq'::regclass);

--
-- Name: parts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parts ALTER COLUMN id SET DEFAULT nextval('public.parts_id_seq'::regclass);

--
-- Name: price_cache id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_cache ALTER COLUMN id SET DEFAULT nextval('public.price_cache_id_seq'::regclass);

--
-- Name: price_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_history ALTER COLUMN id SET DEFAULT nextval('public.price_history_id_seq'::regclass);

--
-- Name: rb_inventory_minifigs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rb_inventory_minifigs ALTER COLUMN id SET DEFAULT nextval('public.rb_inventory_minifigs_id_seq'::regclass);

--
-- Name: rb_inventory_parts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rb_inventory_parts ALTER COLUMN id SET DEFAULT nextval('public.rb_inventory_parts_id_seq'::regclass);

--
-- Name: set_acquisitions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.set_acquisitions ALTER COLUMN id SET DEFAULT nextval('public.set_acquisitions_id_seq'::regclass);

--
-- Name: sets id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sets ALTER COLUMN id SET DEFAULT nextval('public.sets_id_seq'::regclass);

--
-- Name: shared_instructions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shared_instructions ALTER COLUMN id SET DEFAULT nextval('public.shared_instructions_id_seq'::regclass);

--
-- Name: storage_locations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storage_locations ALTER COLUMN id SET DEFAULT nextval('public.storage_locations_id_seq'::regclass);

--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);

--
-- Name: verwaltungsprotokoll id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.verwaltungsprotokoll ALTER COLUMN id SET DEFAULT nextval('public.verwaltungsprotokoll_id_seq'::regclass);

--
-- Name: vouchers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vouchers ALTER COLUMN id SET DEFAULT nextval('public.vouchers_id_seq'::regclass);

--
-- Name: wanted id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wanted ALTER COLUMN id SET DEFAULT nextval('public.wishlist_id_seq'::regclass);

--
-- Name: zweiter_faktor_codes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zweiter_faktor_codes ALTER COLUMN id SET DEFAULT nextval('public.zweiter_faktor_codes_id_seq'::regclass);

--
-- Name: account_link_invites account_link_invites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_link_invites
    ADD CONSTRAINT account_link_invites_pkey PRIMARY KEY (token_hash);

--
-- Name: account_links account_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_links
    ADD CONSTRAINT account_links_pkey PRIMARY KEY (main_user_id, sub_user_id);

--
-- Name: api_aufrufe api_aufrufe_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_aufrufe
    ADD CONSTRAINT api_aufrufe_pkey PRIMARY KEY (tag, api, konto);

--
-- Name: api_takt api_takt_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_takt
    ADD CONSTRAINT api_takt_pkey PRIMARY KEY (api);

--
-- Name: api_tokens api_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_tokens
    ADD CONSTRAINT api_tokens_pkey PRIMARY KEY (token);

--
-- Name: app_logs app_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_logs
    ADD CONSTRAINT app_logs_pkey PRIMARY KEY (id);

--
-- Name: auftraege auftraege_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auftraege
    ADD CONSTRAINT auftraege_pkey PRIMARY KEY (id);

--
-- Name: bl_zuordnung bl_zuordnung_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bl_zuordnung
    ADD CONSTRAINT bl_zuordnung_pkey PRIMARY KEY (art, rb_id);

--
-- Name: brickset_retry_queue brickset_retry_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brickset_retry_queue
    ADD CONSTRAINT brickset_retry_queue_pkey PRIMARY KEY (set_number);

--
-- Name: catalog_cache catalog_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_cache
    ADD CONSTRAINT catalog_cache_pkey PRIMARY KEY (set_number);

--
-- Name: csv_import_jobs csv_import_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.csv_import_jobs
    ADD CONSTRAINT csv_import_jobs_pkey PRIMARY KEY (user_id);

--
-- Name: global_settings global_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.global_settings
    ADD CONSTRAINT global_settings_pkey PRIMARY KEY (key);

--
-- Name: gutschein_guthaben_schranke gutschein_guthaben_schranke_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gutschein_guthaben_schranke
    ADD CONSTRAINT gutschein_guthaben_schranke_pkey PRIMARY KEY (id);

--
-- Name: household_former_links household_former_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.household_former_links
    ADD CONSTRAINT household_former_links_pkey PRIMARY KEY (main_user_id, sub_user_id);

--
-- Name: image_misses image_misses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.image_misses
    ADD CONSTRAINT image_misses_pkey PRIMARY KEY (cache_key);

--
-- Name: image_wanted image_wanted_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.image_wanted
    ADD CONSTRAINT image_wanted_pkey PRIMARY KEY (url);

--
-- Name: instruction_queue instruction_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.instruction_queue
    ADD CONSTRAINT instruction_queue_pkey PRIMARY KEY (id);

--
-- Name: instructions instructions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.instructions
    ADD CONSTRAINT instructions_pkey PRIMARY KEY (id);

--
-- Name: laufzustand laufzustand_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.laufzustand
    ADD CONSTRAINT laufzustand_pkey PRIMARY KEY (schluessel);

--
-- Name: minifig_acquisitions minifig_acquisitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.minifig_acquisitions
    ADD CONSTRAINT minifig_acquisitions_pkey PRIMARY KEY (id);

--
-- Name: minifig_parts_cache minifig_parts_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.minifig_parts_cache
    ADD CONSTRAINT minifig_parts_cache_pkey PRIMARY KEY (fig_number);

--
-- Name: minifig_price_cache minifig_price_cache_fig_number_condition_currency_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.minifig_price_cache
    ADD CONSTRAINT minifig_price_cache_fig_number_condition_currency_code_key UNIQUE (fig_number, condition, currency_code);

--
-- Name: minifig_price_cache minifig_price_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.minifig_price_cache
    ADD CONSTRAINT minifig_price_cache_pkey PRIMARY KEY (id);

--
-- Name: minifig_price_history minifig_price_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.minifig_price_history
    ADD CONSTRAINT minifig_price_history_pkey PRIMARY KEY (id);

--
-- Name: minifigs_catalog minifigs_catalog_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.minifigs_catalog
    ADD CONSTRAINT minifigs_catalog_pkey PRIMARY KEY (fig_number);

--
-- Name: minifigs minifigs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.minifigs
    ADD CONSTRAINT minifigs_pkey PRIMARY KEY (id);

--
-- Name: papierkorb papierkorb_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.papierkorb
    ADD CONSTRAINT papierkorb_pkey PRIMARY KEY (id);

--
-- Name: part_acquisitions part_acquisitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.part_acquisitions
    ADD CONSTRAINT part_acquisitions_pkey PRIMARY KEY (id);

--
-- Name: part_catalog part_catalog_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.part_catalog
    ADD CONSTRAINT part_catalog_pkey PRIMARY KEY (part_number);

--
-- Name: part_color_catalog part_color_catalog_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.part_color_catalog
    ADD CONSTRAINT part_color_catalog_pkey PRIMARY KEY (part_number, color_id);

--
-- Name: part_price_cache part_price_cache_part_number_color_id_condition_currency_co_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.part_price_cache
    ADD CONSTRAINT part_price_cache_part_number_color_id_condition_currency_co_key UNIQUE (part_number, color_id, condition, currency_code);

--
-- Name: part_price_cache part_price_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.part_price_cache
    ADD CONSTRAINT part_price_cache_pkey PRIMARY KEY (id);

--
-- Name: part_price_history part_price_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.part_price_history
    ADD CONSTRAINT part_price_history_pkey PRIMARY KEY (id);

--
-- Name: parts_katalog_stand parts_katalog_stand_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parts_katalog_stand
    ADD CONSTRAINT parts_katalog_stand_pkey PRIMARY KEY (id);

--
-- Name: parts parts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parts
    ADD CONSTRAINT parts_pkey PRIMARY KEY (id);

--
-- Name: parts_summary parts_summary_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parts_summary
    ADD CONSTRAINT parts_summary_pkey PRIMARY KEY (user_id, part_key, color_id);

--
-- Name: parts_summary_state parts_summary_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parts_summary_state
    ADD CONSTRAINT parts_summary_state_pkey PRIMARY KEY (user_id);

--
-- Name: parts_version_user parts_version_user_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parts_version_user
    ADD CONSTRAINT parts_version_user_pkey PRIMARY KEY (user_id);

--
-- Name: pdf_auftraege pdf_auftraege_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pdf_auftraege
    ADD CONSTRAINT pdf_auftraege_pkey PRIMARY KEY (id);

--
-- Name: price_alerts price_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_alerts
    ADD CONSTRAINT price_alerts_pkey PRIMARY KEY (user_id, set_number, condition);

--
-- Name: price_cache price_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_cache
    ADD CONSTRAINT price_cache_pkey PRIMARY KEY (id);

--
-- Name: price_cache price_cache_set_number_condition_currency_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_cache
    ADD CONSTRAINT price_cache_set_number_condition_currency_code_key UNIQUE (set_number, condition, currency_code);

--
-- Name: price_history price_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_history
    ADD CONSTRAINT price_history_pkey PRIMARY KEY (id);

--
-- Name: qr_login_tokens qr_login_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_login_tokens
    ADD CONSTRAINT qr_login_tokens_pkey PRIMARY KEY (token);

--
-- Name: rate_limit_attempts rate_limit_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_limit_attempts
    ADD CONSTRAINT rate_limit_attempts_pkey PRIMARY KEY (key);

--
-- Name: rb_colors rb_colors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rb_colors
    ADD CONSTRAINT rb_colors_pkey PRIMARY KEY (id);

--
-- Name: rb_inventories rb_inventories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rb_inventories
    ADD CONSTRAINT rb_inventories_pkey PRIMARY KEY (id);

--
-- Name: rb_inventory_minifigs rb_inventory_minifigs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rb_inventory_minifigs
    ADD CONSTRAINT rb_inventory_minifigs_pkey PRIMARY KEY (id);

--
-- Name: rb_inventory_parts rb_inventory_parts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rb_inventory_parts
    ADD CONSTRAINT rb_inventory_parts_pkey PRIMARY KEY (id);

--
-- Name: rb_part_categories rb_part_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rb_part_categories
    ADD CONSTRAINT rb_part_categories_pkey PRIMARY KEY (id);

--
-- Name: rb_parts rb_parts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rb_parts
    ADD CONSTRAINT rb_parts_pkey PRIMARY KEY (part_num);

--
-- Name: rb_sets rb_sets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rb_sets
    ADD CONSTRAINT rb_sets_pkey PRIMARY KEY (set_num);

--
-- Name: rb_themes rb_themes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rb_themes
    ADD CONSTRAINT rb_themes_pkey PRIMARY KEY (id);

--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (name);

--
-- Name: set_acquisitions set_acquisitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.set_acquisitions
    ADD CONSTRAINT set_acquisitions_pkey PRIMARY KEY (id);

--
-- Name: set_catalog set_catalog_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.set_catalog
    ADD CONSTRAINT set_catalog_pkey PRIMARY KEY (set_number);

--
-- Name: set_minifigs_catalog set_minifigs_catalog_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.set_minifigs_catalog
    ADD CONSTRAINT set_minifigs_catalog_pkey PRIMARY KEY (set_number, fig_number);

--
-- Name: set_teile set_teile_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.set_teile
    ADD CONSTRAINT set_teile_pkey PRIMARY KEY (set_number, part_number, color_id);

--
-- Name: sets sets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sets
    ADD CONSTRAINT sets_pkey PRIMARY KEY (id);

--
-- Name: sets sets_user_id_set_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sets
    ADD CONSTRAINT sets_user_id_set_number_key UNIQUE (user_id, set_number);

--
-- Name: shared_instructions shared_instructions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shared_instructions
    ADD CONSTRAINT shared_instructions_pkey PRIMARY KEY (id);

--
-- Name: shared_instructions shared_instructions_set_number_url_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shared_instructions
    ADD CONSTRAINT shared_instructions_set_number_url_key UNIQUE (set_number, url);

--
-- Name: storage_locations storage_locations_konto_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storage_locations
    ADD CONSTRAINT storage_locations_konto_id UNIQUE (user_id, id);

--
-- Name: storage_locations storage_locations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storage_locations
    ADD CONSTRAINT storage_locations_pkey PRIMARY KEY (id);

--
-- Name: subsets_cache subsets_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subsets_cache
    ADD CONSTRAINT subsets_cache_pkey PRIMARY KEY (set_number);

--
-- Name: user_sessions user_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT user_sessions_pkey PRIMARY KEY (sid);

--
-- Name: user_settings user_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_settings
    ADD CONSTRAINT user_settings_pkey PRIMARY KEY (user_id, key);

--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

--
-- Name: users users_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);

--
-- Name: verwaltungsprotokoll verwaltungsprotokoll_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.verwaltungsprotokoll
    ADD CONSTRAINT verwaltungsprotokoll_pkey PRIMARY KEY (id);

--
-- Name: vouchers vouchers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vouchers
    ADD CONSTRAINT vouchers_pkey PRIMARY KEY (id);

--
-- Name: vouchers vouchers_user_id_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vouchers
    ADD CONSTRAINT vouchers_user_id_number_key UNIQUE (user_id, number);

--
-- Name: wanted wishlist_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wanted
    ADD CONSTRAINT wishlist_pkey PRIMARY KEY (id);

--
-- Name: wanted wishlist_user_id_set_number_condition_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wanted
    ADD CONSTRAINT wishlist_user_id_set_number_condition_key UNIQUE (user_id, set_number, condition);

--
-- Name: zweiter_faktor_codes zweiter_faktor_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zweiter_faktor_codes
    ADD CONSTRAINT zweiter_faktor_codes_pkey PRIMARY KEY (id);

--
-- Name: zweiter_faktor zweiter_faktor_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zweiter_faktor
    ADD CONSTRAINT zweiter_faktor_pkey PRIMARY KEY (user_id);

--
-- Name: idx_account_link_invites_main; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_account_link_invites_main ON public.account_link_invites USING btree (main_user_id, expires_at);

--
-- Name: idx_account_links_sub; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_account_links_sub ON public.account_links USING btree (sub_user_id);

--
-- Name: idx_api_tokens_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_api_tokens_expires ON public.api_tokens USING btree (expires_at) WHERE (expires_at IS NOT NULL);

--
-- Name: idx_api_tokens_hard; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_api_tokens_hard ON public.api_tokens USING btree (hard_expires_at) WHERE (hard_expires_at IS NOT NULL);

--
-- Name: idx_api_tokens_idle; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_api_tokens_idle ON public.api_tokens USING btree (last_used) WHERE (expires_at IS NULL);

--
-- Name: idx_api_tokens_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_api_tokens_user_created ON public.api_tokens USING btree (user_id, created_at DESC);

--
-- Name: idx_app_logs_logged_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_logs_logged_at ON public.app_logs USING btree (logged_at DESC);

--
-- Name: idx_auftraege_faellig; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auftraege_faellig ON public.auftraege USING btree (next_run_at) WHERE (status = ANY (ARRAY['offen'::text, 'laeuft'::text]));

--
-- Name: idx_auftraege_schluessel; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_auftraege_schluessel ON public.auftraege USING btree (schluessel) WHERE (status = 'offen'::text);

--
-- Name: idx_auftraege_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auftraege_user ON public.auftraege USING btree (user_id) WHERE (user_id IS NOT NULL);

--
-- Name: idx_bl_zuordnung_bl; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bl_zuordnung_bl ON public.bl_zuordnung USING btree (art, bl_id);

--
-- Name: idx_household_former_sub; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_household_former_sub ON public.household_former_links USING btree (sub_user_id);

--
-- Name: idx_household_former_via; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_household_former_via ON public.household_former_links USING btree (via_user_id);

--
-- Name: idx_image_wanted_alter; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_image_wanted_alter ON public.image_wanted USING btree (requested_at);

--
-- Name: idx_instr_queue_set; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_instr_queue_set ON public.instruction_queue USING btree (set_number);

--
-- Name: idx_instructions_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_instructions_user ON public.instructions USING btree (user_id, set_number);

--
-- Name: idx_invite_used_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invite_used_by ON public.account_link_invites USING btree (used_by);

--
-- Name: idx_minifig_acq_tag_merkmale; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_minifig_acq_tag_merkmale ON public.minifig_acquisitions USING btree (user_id, fig_number, (((created_at AT TIME ZONE 'UTC'::text))::date), condition, COALESCE(unit_price, ('-1'::integer)::numeric), price_estimated, currency);

--
-- Name: idx_minifig_price_cache_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_minifig_price_cache_lookup ON public.minifig_price_cache USING btree (fig_number, condition, currency_code, fetched_at DESC);

--
-- Name: idx_minifig_price_history_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_minifig_price_history_lookup ON public.minifig_price_history USING btree (fig_number, currency_code, recorded_at);

--
-- Name: idx_minifig_price_history_tag; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_minifig_price_history_tag ON public.minifig_price_history USING btree (fig_number, condition, currency_code, (((recorded_at AT TIME ZONE 'UTC'::text))::date));

--
-- Name: idx_minifigs_catalog_bild_stamm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_minifigs_catalog_bild_stamm ON public.minifigs_catalog USING btree (public.bild_stamm(image_local)) WHERE (image_local IS NOT NULL);

--
-- Name: idx_minifigs_catalog_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_minifigs_catalog_name_trgm ON public.minifigs_catalog USING gin (lower(fig_name) public.gin_trgm_ops);

--
-- Name: idx_minifigs_eindeutig; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_minifigs_eindeutig ON public.minifigs USING btree (user_id, COALESCE(set_number, ''::text), fig_number);

--
-- Name: idx_minifigs_set; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_minifigs_set ON public.minifigs USING btree (user_id, set_number);

--
-- Name: idx_minifigs_storage_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_minifigs_storage_id ON public.minifigs USING btree (user_id, storage_id) WHERE (storage_id IS NOT NULL);

--
-- Name: idx_minifigs_storage_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_minifigs_storage_ref ON public.minifigs USING btree (storage_id) WHERE (storage_id IS NOT NULL);

--
-- Name: idx_papierkorb_konto; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_papierkorb_konto ON public.papierkorb USING btree (user_id, geloescht_am DESC);

--
-- Name: idx_part_acq_tag_merkmale; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_part_acq_tag_merkmale ON public.part_acquisitions USING btree (user_id, part_number, color_id, (((created_at AT TIME ZONE 'UTC'::text))::date), condition, COALESCE(unit_price, ('-1'::integer)::numeric), price_estimated, currency);

--
-- Name: idx_part_catalog_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_part_catalog_category ON public.part_catalog USING btree (category_name);

--
-- Name: idx_part_catalog_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_part_catalog_name_trgm ON public.part_catalog USING gin (lower(part_name) public.gin_trgm_ops);

--
-- Name: idx_part_color_catalog_bild_stamm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_part_color_catalog_bild_stamm ON public.part_color_catalog USING btree (public.bild_stamm(image_local)) WHERE (image_local IS NOT NULL);

--
-- Name: idx_part_price_cache_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_part_price_cache_lookup ON public.part_price_cache USING btree (part_number, color_id, condition, currency_code, fetched_at DESC);

--
-- Name: idx_part_price_history_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_part_price_history_lookup ON public.part_price_history USING btree (part_number, color_id, currency_code, recorded_at);

--
-- Name: idx_part_price_history_tag; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_part_price_history_tag ON public.part_price_history USING btree (part_number, color_id, condition, currency_code, (((recorded_at AT TIME ZONE 'UTC'::text))::date));

--
-- Name: idx_parts_color_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_parts_color_id ON public.parts USING btree (user_id, color_id);

--
-- Name: idx_parts_eindeutig; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_parts_eindeutig ON public.parts USING btree (user_id, COALESCE(set_number, ''::text), part_number, COALESCE(color_id, 0));

--
-- Name: idx_parts_gruppe; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_parts_gruppe ON public.parts USING btree (user_id, part_number, color_id);

--
-- Name: idx_parts_number_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_parts_number_trgm ON public.parts USING gin (lower(part_number) public.gin_trgm_ops);

--
-- Name: idx_parts_set; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_parts_set ON public.parts USING btree (user_id, set_number);

--
-- Name: idx_parts_storage_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_parts_storage_id ON public.parts USING btree (user_id, storage_id) WHERE (storage_id IS NOT NULL);

--
-- Name: idx_parts_storage_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_parts_storage_ref ON public.parts USING btree (storage_id) WHERE (storage_id IS NOT NULL);

--
-- Name: idx_parts_summary_cat; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_parts_summary_cat ON public.parts_summary USING btree (user_id, category_name);

--
-- Name: idx_parts_summary_color; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_parts_summary_color ON public.parts_summary USING btree (user_id, color_id);

--
-- Name: idx_parts_summary_sort; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_parts_summary_sort ON public.parts_summary USING btree (user_id, color_name, part_name);

--
-- Name: idx_pdf_auftraege_laufend; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pdf_auftraege_laufend ON public.pdf_auftraege USING btree (user_id) WHERE (status = 'running'::text);

--
-- Name: idx_pdf_auftraege_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pdf_auftraege_user ON public.pdf_auftraege USING btree (user_id);

--
-- Name: idx_price_alerts_set; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_price_alerts_set ON public.price_alerts USING btree (set_number, condition);

--
-- Name: idx_price_cache_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_price_cache_lookup ON public.price_cache USING btree (set_number, condition, currency_code, fetched_at DESC);

--
-- Name: idx_price_history_set; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_price_history_set ON public.price_history USING btree (set_number, recorded_at);

--
-- Name: idx_price_history_tag; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_price_history_tag ON public.price_history USING btree (set_number, condition, currency_code, (((recorded_at AT TIME ZONE 'UTC'::text))::date));

--
-- Name: idx_psum_blnumber_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_psum_blnumber_trgm ON public.parts_summary USING gin (bl_part_number public.gin_trgm_ops) WITH (fastupdate=off);

--
-- Name: idx_psum_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_psum_name_trgm ON public.parts_summary USING gin (part_name public.gin_trgm_ops) WITH (fastupdate=off);

--
-- Name: idx_psum_number_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_psum_number_trgm ON public.parts_summary USING gin (part_number public.gin_trgm_ops) WITH (fastupdate=off);

--
-- Name: idx_qr_login_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qr_login_expires ON public.qr_login_tokens USING btree (expires_at);

--
-- Name: idx_qr_login_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qr_login_user ON public.qr_login_tokens USING btree (user_id);

--
-- Name: idx_rate_limit_first_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rate_limit_first_at ON public.rate_limit_attempts USING btree (first_at);

--
-- Name: idx_rb_inv_minifigs_inv; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rb_inv_minifigs_inv ON public.rb_inventory_minifigs USING btree (inventory_id);

--
-- Name: idx_rb_inv_parts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rb_inv_parts ON public.rb_inventory_parts USING btree (inventory_id);

--
-- Name: idx_rb_inv_setnum; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rb_inv_setnum ON public.rb_inventories USING btree (set_num);

--
-- Name: idx_rb_sets_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rb_sets_name_trgm ON public.rb_sets USING gin (name public.gin_trgm_ops);

--
-- Name: idx_rb_sets_setnum_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rb_sets_setnum_trgm ON public.rb_sets USING gin (set_num public.gin_trgm_ops);

--
-- Name: idx_rb_sets_theme_year; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rb_sets_theme_year ON public.rb_sets USING btree (theme_id, year);

--
-- Name: idx_rb_sets_year; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rb_sets_year ON public.rb_sets USING btree (year);

--
-- Name: idx_set_acq_tag_merkmale; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_set_acq_tag_merkmale ON public.set_acquisitions USING btree (user_id, set_number, (((created_at AT TIME ZONE 'UTC'::text))::date), condition, COALESCE(purchase_price, ('-1'::integer)::numeric), price_estimated, currency);

--
-- Name: idx_set_catalog_bild_stamm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_set_catalog_bild_stamm ON public.set_catalog USING btree (public.bild_stamm(image_local)) WHERE (image_local IS NOT NULL);

--
-- Name: idx_set_minifigs_catalog_bild_stamm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_set_minifigs_catalog_bild_stamm ON public.set_minifigs_catalog USING btree (public.bild_stamm(image_local)) WHERE (image_local IS NOT NULL);

--
-- Name: idx_set_minifigs_fig; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_set_minifigs_fig ON public.set_minifigs_catalog USING btree (fig_number);

--
-- Name: idx_sets_setnum; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sets_setnum ON public.sets USING btree (set_number);

--
-- Name: idx_sets_storage_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sets_storage_id ON public.sets USING btree (user_id, storage_id) WHERE (storage_id IS NOT NULL);

--
-- Name: idx_sets_storage_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sets_storage_ref ON public.sets USING btree (storage_id) WHERE (storage_id IS NOT NULL);

--
-- Name: idx_user_sessions_expire; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_sessions_expire ON public.user_sessions USING btree (expire);

--
-- Name: idx_verwaltungsprotokoll_verwalter; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_verwaltungsprotokoll_verwalter ON public.verwaltungsprotokoll USING btree (verwalter_id);

--
-- Name: idx_verwaltungsprotokoll_zeit; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_verwaltungsprotokoll_zeit ON public.verwaltungsprotokoll USING btree (zeit DESC);

--
-- Name: idx_wanted_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wanted_user ON public.wanted USING btree (user_id, created_at DESC);

--
-- Name: idx_zweiter_faktor_codes_konto; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_zweiter_faktor_codes_konto ON public.zweiter_faktor_codes USING btree (user_id);

--
-- Name: storage_locations_konto_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX storage_locations_konto_name ON public.storage_locations USING btree (user_id, lower(name));

--
-- Name: users_email_lower; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX users_email_lower ON public.users USING btree (lower(email));

--
-- Name: minifig_acquisitions minifig_acquisitions_waehrung; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER minifig_acquisitions_waehrung BEFORE INSERT OR UPDATE ON public.minifig_acquisitions FOR EACH ROW EXECUTE FUNCTION public.erfassung_waehrung();

--
-- Name: part_acquisitions part_acquisitions_waehrung; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER part_acquisitions_waehrung BEFORE INSERT OR UPDATE ON public.part_acquisitions FOR EACH ROW EXECUTE FUNCTION public.erfassung_waehrung();

--
-- Name: set_acquisitions set_acquisitions_waehrung; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_acquisitions_waehrung BEFORE INSERT OR UPDATE ON public.set_acquisitions FOR EACH ROW EXECUTE FUNCTION public.erfassung_waehrung();

--
-- Name: bl_zuordnung trg_bump_parts_katalog; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_bump_parts_katalog AFTER INSERT OR DELETE OR UPDATE ON public.bl_zuordnung FOR EACH STATEMENT EXECUTE FUNCTION public.bump_parts_katalog();

--
-- Name: part_catalog trg_bump_parts_katalog; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_bump_parts_katalog AFTER INSERT OR DELETE OR UPDATE ON public.part_catalog FOR EACH STATEMENT EXECUTE FUNCTION public.bump_parts_katalog();

--
-- Name: part_color_catalog trg_bump_parts_katalog; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_bump_parts_katalog AFTER INSERT OR DELETE OR UPDATE ON public.part_color_catalog FOR EACH STATEMENT EXECUTE FUNCTION public.bump_parts_katalog();

--
-- Name: set_teile trg_bump_parts_katalog; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_bump_parts_katalog AFTER INSERT OR DELETE OR UPDATE ON public.set_teile FOR EACH STATEMENT EXECUTE FUNCTION public.bump_parts_katalog();

--
-- Name: parts trg_bump_parts_version_del; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_bump_parts_version_del AFTER DELETE ON public.parts REFERENCING OLD TABLE AS alt FOR EACH STATEMENT EXECUTE FUNCTION public.bump_parts_version_del();

--
-- Name: set_acquisitions trg_bump_parts_version_del; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_bump_parts_version_del AFTER DELETE ON public.set_acquisitions REFERENCING OLD TABLE AS alt FOR EACH STATEMENT EXECUTE FUNCTION public.bump_parts_version_del();

--
-- Name: sets trg_bump_parts_version_del; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_bump_parts_version_del AFTER DELETE ON public.sets REFERENCING OLD TABLE AS alt FOR EACH STATEMENT EXECUTE FUNCTION public.bump_parts_version_del();

--
-- Name: parts trg_bump_parts_version_ins; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_bump_parts_version_ins AFTER INSERT ON public.parts REFERENCING NEW TABLE AS neu FOR EACH STATEMENT EXECUTE FUNCTION public.bump_parts_version_ins();

--
-- Name: set_acquisitions trg_bump_parts_version_ins; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_bump_parts_version_ins AFTER INSERT ON public.set_acquisitions REFERENCING NEW TABLE AS neu FOR EACH STATEMENT EXECUTE FUNCTION public.bump_parts_version_ins();

--
-- Name: sets trg_bump_parts_version_ins; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_bump_parts_version_ins AFTER INSERT ON public.sets REFERENCING NEW TABLE AS neu FOR EACH STATEMENT EXECUTE FUNCTION public.bump_parts_version_ins();

--
-- Name: parts trg_bump_parts_version_upd; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_bump_parts_version_upd AFTER UPDATE ON public.parts REFERENCING OLD TABLE AS alt NEW TABLE AS neu FOR EACH STATEMENT EXECUTE FUNCTION public.bump_parts_version_upd();

--
-- Name: set_acquisitions trg_bump_parts_version_upd; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_bump_parts_version_upd AFTER UPDATE ON public.set_acquisitions REFERENCING OLD TABLE AS alt NEW TABLE AS neu FOR EACH STATEMENT EXECUTE FUNCTION public.bump_parts_version_erfassung_upd();

--
-- Name: sets trg_bump_parts_version_upd; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_bump_parts_version_upd AFTER UPDATE ON public.sets REFERENCING OLD TABLE AS alt NEW TABLE AS neu FOR EACH STATEMENT EXECUTE FUNCTION public.bump_parts_version_upd();

--
-- Name: storage_locations trg_bump_parts_version_upd; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_bump_parts_version_upd AFTER UPDATE ON public.storage_locations REFERENCING OLD TABLE AS alt NEW TABLE AS neu FOR EACH STATEMENT EXECUTE FUNCTION public.bump_parts_version_lagerort_upd();

--
-- Name: account_link_invites account_link_invites_main_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_link_invites
    ADD CONSTRAINT account_link_invites_main_user_id_fkey FOREIGN KEY (main_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: account_link_invites account_link_invites_used_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_link_invites
    ADD CONSTRAINT account_link_invites_used_by_fkey FOREIGN KEY (used_by) REFERENCES public.users(id) ON DELETE SET NULL;

--
-- Name: account_links account_links_main_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_links
    ADD CONSTRAINT account_links_main_user_id_fkey FOREIGN KEY (main_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: account_links account_links_sub_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_links
    ADD CONSTRAINT account_links_sub_user_id_fkey FOREIGN KEY (sub_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: api_tokens api_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_tokens
    ADD CONSTRAINT api_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: auftraege auftraege_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auftraege
    ADD CONSTRAINT auftraege_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: csv_import_jobs csv_import_jobs_user_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.csv_import_jobs
    ADD CONSTRAINT csv_import_jobs_user_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: household_former_links household_former_links_main_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.household_former_links
    ADD CONSTRAINT household_former_links_main_user_id_fkey FOREIGN KEY (main_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: household_former_links household_former_links_sub_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.household_former_links
    ADD CONSTRAINT household_former_links_sub_user_id_fkey FOREIGN KEY (sub_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: household_former_links household_former_links_via_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.household_former_links
    ADD CONSTRAINT household_former_links_via_user_id_fkey FOREIGN KEY (via_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

--
-- Name: instructions instructions_set_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.instructions
    ADD CONSTRAINT instructions_set_fk FOREIGN KEY (user_id, set_number) REFERENCES public.sets(user_id, set_number) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

--
-- Name: instructions instructions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.instructions
    ADD CONSTRAINT instructions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: minifig_acquisitions minifig_acquisitions_user_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.minifig_acquisitions
    ADD CONSTRAINT minifig_acquisitions_user_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: minifigs minifigs_set_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.minifigs
    ADD CONSTRAINT minifigs_set_fk FOREIGN KEY (user_id, set_number) REFERENCES public.sets(user_id, set_number) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

--
-- Name: minifigs minifigs_storage_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.minifigs
    ADD CONSTRAINT minifigs_storage_id_fkey FOREIGN KEY (user_id, storage_id) REFERENCES public.storage_locations(user_id, id) ON DELETE SET NULL (storage_id);

--
-- Name: minifigs minifigs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.minifigs
    ADD CONSTRAINT minifigs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: papierkorb papierkorb_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.papierkorb
    ADD CONSTRAINT papierkorb_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: part_acquisitions part_acquisitions_user_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.part_acquisitions
    ADD CONSTRAINT part_acquisitions_user_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: parts parts_set_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parts
    ADD CONSTRAINT parts_set_fk FOREIGN KEY (user_id, set_number) REFERENCES public.sets(user_id, set_number) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

--
-- Name: parts parts_storage_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parts
    ADD CONSTRAINT parts_storage_id_fkey FOREIGN KEY (user_id, storage_id) REFERENCES public.storage_locations(user_id, id) ON DELETE SET NULL (storage_id);

--
-- Name: parts_summary_state parts_summary_state_user_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parts_summary_state
    ADD CONSTRAINT parts_summary_state_user_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: parts_summary parts_summary_user_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parts_summary
    ADD CONSTRAINT parts_summary_user_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: parts parts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parts
    ADD CONSTRAINT parts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: parts_version_user parts_version_user_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parts_version_user
    ADD CONSTRAINT parts_version_user_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: pdf_auftraege pdf_auftraege_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pdf_auftraege
    ADD CONSTRAINT pdf_auftraege_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: price_alerts price_alerts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_alerts
    ADD CONSTRAINT price_alerts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: qr_login_tokens qr_login_tokens_user_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_login_tokens
    ADD CONSTRAINT qr_login_tokens_user_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: set_acquisitions set_acquisitions_bestand_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.set_acquisitions
    ADD CONSTRAINT set_acquisitions_bestand_fkey FOREIGN KEY (user_id, set_number) REFERENCES public.sets(user_id, set_number) DEFERRABLE INITIALLY DEFERRED;

--
-- Name: set_acquisitions set_acquisitions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.set_acquisitions
    ADD CONSTRAINT set_acquisitions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: sets sets_storage_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sets
    ADD CONSTRAINT sets_storage_id_fkey FOREIGN KEY (user_id, storage_id) REFERENCES public.storage_locations(user_id, id) ON DELETE SET NULL (storage_id);

--
-- Name: sets sets_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sets
    ADD CONSTRAINT sets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: storage_locations storage_locations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storage_locations
    ADD CONSTRAINT storage_locations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: user_settings user_settings_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_settings
    ADD CONSTRAINT user_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: verwaltungsprotokoll verwaltungsprotokoll_verwalter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.verwaltungsprotokoll
    ADD CONSTRAINT verwaltungsprotokoll_verwalter_id_fkey FOREIGN KEY (verwalter_id) REFERENCES public.users(id) ON DELETE SET NULL;

--
-- Name: vouchers vouchers_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vouchers
    ADD CONSTRAINT vouchers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: wanted wishlist_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wanted
    ADD CONSTRAINT wishlist_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: zweiter_faktor_codes zweiter_faktor_codes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zweiter_faktor_codes
    ADD CONSTRAINT zweiter_faktor_codes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: zweiter_faktor zweiter_faktor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zweiter_faktor
    ADD CONSTRAINT zweiter_faktor_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- PostgreSQL database dump complete
--

--
-- PostgreSQL database dump
--

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: global_settings; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.global_settings (key, value, updated_at) VALUES ('bricklink_consumer_key', '', '2026-10-28 17:10:03.355398+00');
INSERT INTO public.global_settings (key, value, updated_at) VALUES ('bricklink_consumer_secret', '', '2026-10-28 17:10:03.355398+00');
INSERT INTO public.global_settings (key, value, updated_at) VALUES ('bricklink_token', '', '2026-10-28 17:10:03.355398+00');
INSERT INTO public.global_settings (key, value, updated_at) VALUES ('bricklink_token_secret', '', '2026-10-28 17:10:03.355398+00');
INSERT INTO public.global_settings (key, value, updated_at) VALUES ('brickset_api_key', '', '2026-10-28 17:10:03.355398+00');
INSERT INTO public.global_settings (key, value, updated_at) VALUES ('rebrickable_api_key', '', '2026-10-28 17:10:03.355398+00');
INSERT INTO public.global_settings (key, value, updated_at) VALUES ('price_job_interval_minutes', '60', '2026-10-28 17:10:03.355398+00');
INSERT INTO public.global_settings (key, value, updated_at) VALUES ('registration_enabled', '0', '2026-10-28 17:10:03.355398+00');
INSERT INTO public.global_settings (key, value, updated_at) VALUES ('price_cache_ttl', '24', '2026-10-28 17:10:03.355398+00');
INSERT INTO public.global_settings (key, value, updated_at) VALUES ('default_price_condition', 'N', '2026-10-28 17:10:03.355398+00');
INSERT INTO public.global_settings (key, value, updated_at) VALUES ('api_limit_rebrickable', '25000', '2026-10-28 17:10:03.355398+00');
INSERT INTO public.global_settings (key, value, updated_at) VALUES ('api_limit_bricklink', '4000', '2026-10-28 17:10:03.355398+00');
INSERT INTO public.global_settings (key, value, updated_at) VALUES ('api_limit_brickset', '100', '2026-10-28 17:10:03.355398+00');
INSERT INTO public.global_settings (key, value, updated_at) VALUES ('smtp_host', '', '2026-10-28 17:10:03.355398+00');
INSERT INTO public.global_settings (key, value, updated_at) VALUES ('smtp_port', '587', '2026-10-28 17:10:03.355398+00');
INSERT INTO public.global_settings (key, value, updated_at) VALUES ('smtp_user', '', '2026-10-28 17:10:03.355398+00');
INSERT INTO public.global_settings (key, value, updated_at) VALUES ('smtp_pass', '', '2026-10-28 17:10:03.355398+00');
INSERT INTO public.global_settings (key, value, updated_at) VALUES ('smtp_from', '', '2026-10-28 17:10:03.355398+00');
INSERT INTO public.global_settings (key, value, updated_at) VALUES ('smtp_secure', '0', '2026-10-28 17:10:03.355398+00');

--
-- Data for Name: gutschein_guthaben_schranke; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.gutschein_guthaben_schranke (id, letzter_abruf, sperre_bis) VALUES (1, NULL, NULL);

--
-- Data for Name: parts_katalog_stand; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.parts_katalog_stand (id, v) VALUES (1, 4);

--
-- Data for Name: schema_migrations; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0001-baseline.sql', '2026-10-28 17:10:03.530662+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0003-preisverlauf-teile-minifiguren.sql', '2026-10-28 17:10:03.532728+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0004-erfassung-pro-tag.sql', '2026-10-28 17:10:03.542751+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0005-haushalt-kontoverknuepfung.sql', '2026-10-28 17:10:03.546253+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0006-verwaiste-teile-nach-verschieben.sql', '2026-10-28 17:10:03.55458+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0007-geld-als-numeric.sql', '2026-10-28 17:10:03.559525+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0008-erfassung-pro-tag-index.sql', '2026-10-28 17:10:03.6154+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0009-bild-tabellen.sql', '2026-10-28 17:10:03.621685+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0010-image-wanted-index.sql', '2026-10-28 17:10:03.627249+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0011-image-misses-grund.sql', '2026-10-28 17:10:03.629838+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0012-ueberzaehlige-katalog-indizes.sql', '2026-10-28 17:10:03.6312+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0013-tote-spalte-brickset-id.sql', '2026-10-28 17:10:03.632393+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0014-img-proxy-nach-v1.sql', '2026-10-28 17:10:03.633667+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0015-api-tokens-sliding.sql', '2026-10-28 17:10:03.636581+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0016-token-laufzeit.sql', '2026-10-28 17:10:03.641695+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0017-token-unbegrenzt.sql', '2026-10-28 17:10:03.643872+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0018-lagerort.sql', '2026-10-28 17:10:03.645471+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0019-preisalarm.sql', '2026-10-28 17:10:03.646861+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0020-lagerorte-verwaltet.sql', '2026-10-28 17:10:03.651585+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0021-wunschliste.sql', '2026-10-28 17:10:03.6529+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0022-notiz-ausbauen.sql', '2026-10-28 17:10:03.658588+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0023-merkliste.sql', '2026-10-28 17:10:03.659849+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0024-lagerort-minifiguren.sql', '2026-10-28 17:10:03.661046+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0025-parts-summary-lagerort.sql', '2026-10-28 17:10:03.662087+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0026-gutscheine.sql', '2026-10-28 17:10:03.663468+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0027-gutschein-notiz-entfallen.sql', '2026-10-28 17:10:03.669053+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0029-trigramm-bestandssuche.sql', '2026-10-28 17:10:03.670303+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0030-api-tokens-user-index.sql', '2026-10-28 17:10:03.674249+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0031-lagerort-als-id.sql', '2026-10-28 17:10:03.676229+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0032-kaufpreis-und-zustand-nur-in-erfassungen.sql', '2026-10-28 17:10:03.680067+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0033-stammdaten-nur-im-katalog.sql', '2026-10-28 17:10:03.687499+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0034-teile-und-minifiguren-stammdaten-im-katalog.sql', '2026-10-28 17:10:03.689982+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0035-teilepreise-nur-in-erfassungen.sql', '2026-10-28 17:10:03.71532+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0036-setmenge-aus-erfassungen.sql', '2026-10-28 17:10:03.72587+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0037-bricklink-nummern-in-einer-zuordnung.sql', '2026-10-28 17:10:03.732095+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0038-teilemengen-aus-katalog-und-erfassungen.sql', '2026-10-28 17:10:03.751273+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0039-gutschein-guthaben-geprueft.sql', '2026-10-28 17:10:03.768929+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0040-erfassung-je-tag-und-zustand.sql', '2026-10-28 17:10:03.772136+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0041-papierkorb.sql', '2026-10-28 17:10:03.777873+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0042-zweiter-faktor.sql', '2026-10-28 17:10:03.783209+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0043-fremdschluessel-konto.sql', '2026-10-28 17:10:03.790898+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0044-doppelter-einladungsindex.sql', '2026-10-28 17:10:03.79799+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0045-erfassung-gehoert-zum-bestand.sql', '2026-10-28 17:10:03.79953+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0046-haushalt-mehrere-eltern.sql', '2026-10-28 17:10:03.804778+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0047-erfassung-waehrung-schaetzung.sql', '2026-10-28 17:10:03.810525+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0048-anmeldung-wartezeit.sql', '2026-10-28 17:10:03.821575+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0049-verwaltungsprotokoll.sql', '2026-10-28 17:10:03.8235+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0050-teilezaehler-nur-bestehende-konten.sql', '2026-10-28 17:10:03.829433+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0051-csv-import-lauf.sql', '2026-10-28 17:10:03.830635+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0052-teilezusammenfassung-stand.sql', '2026-10-28 17:10:03.83142+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0053-schema-buchfuehrung.sql', '2026-10-28 17:12:02.484389+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0054-gin-ohne-warteliste.sql', '2026-10-28 17:45:20.139706+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0055-api-takt.sql', '2026-10-28 17:50:28.999651+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0056-preisverlauf-je-tag.sql', '2026-10-28 17:50:29.005121+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0057-figurenpreis-geschaetzt.sql', '2026-10-28 17:50:29.010176+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0058-fremdschluessel-und-pruefungen.sql', '2026-10-28 17:59:06.918264+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0059-anmeldung-laufend.sql', '2026-10-28 20:00:29.834455+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0060-katalog-herkunft.sql', '2026-10-28 20:09:04.452918+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0061-api-aufrufe.sql', '2026-10-28 22:10:50.251504+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0062-set-teile-schlank.sql', '2026-10-28 22:55:20.74984+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0063-laufzustand.sql', '2026-10-28 23:05:08.525175+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0064-pdf-auftraege.sql', '2026-10-28 23:25:34.430147+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0065-geld-und-waehrung-pruefen.sql', '2026-10-28 23:27:03.174038+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0066-auftraege.sql', '2026-10-29 21:52:46.143176+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0067-bild-stamm.sql', '2026-10-29 21:59:16.007371+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0068-praefix-indizes.sql', '2026-10-29 21:59:58.856414+00');
INSERT INTO public.schema_migrations (name, applied_at) VALUES ('0069-konten-pruefen.sql', '2026-10-29 22:00:41.797626+00');

--
-- PostgreSQL database dump complete
--

