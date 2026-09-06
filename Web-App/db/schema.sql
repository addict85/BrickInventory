-- ── Das Grundschema (Nachtrag 128) ──────────────────────────────────────────
--
-- Diese 426 Zeilen standen bis Nachtrag 127 als Zeichenkette in
-- db/database.ts, mitten in initSchema(). Sie enthalten keine einzige
-- Einsetzung (`${...}`), sind also reines SQL — und als solches gehören sie in
-- eine .sql-Datei: diffbar, in jedem SQL-Werkzeug lesbar, greppbar nach
-- Tabellennamen, und ohne die Einrückungsebene eines TypeScript-Rumpfs.
--
-- Was hier NICHT hingehört und deshalb in initSchema() geblieben ist: alles
-- mit Bedingung. Die nachträglichen Spalten-Migrationen, das Anlegen des
-- ersten Verwalters, die pg_trgm-Behandlung (CREATE EXTENSION darf
-- fehlschlagen) und das Aufräumen alter Token brauchen Ablaufsteuerung.
--
-- ABGRENZUNG zu db/migrations/: Dort stehen Änderungen an einem BESTEHENDEN
-- Schema, hier steht der Ausgangszustand. Beim ersten Start läuft erst diese
-- Datei, danach die Migrationen. Sechs Tabellen (account_links,
-- account_link_invites, image_misses, image_wanted, part_price_history,
-- minifig_price_history) stehen bewusst NUR in Migrationen — siehe die
-- Begründung in db/migrations/0001-baseline.sql.

CREATE TABLE IF NOT EXISTS users (
  id                  SERIAL PRIMARY KEY,
  username            TEXT NOT NULL UNIQUE,
  email               TEXT UNIQUE,
  first_name          TEXT,
  last_name           TEXT,
  password_hash       TEXT NOT NULL,
  is_admin            INTEGER DEFAULT 0,
  is_active           INTEGER DEFAULT 1,
  email_verified      INTEGER DEFAULT 0,
  verification_token  TEXT,
  token_expires       TIMESTAMPTZ,
  reset_token         TEXT,
  reset_token_expires TIMESTAMPTZ,
  must_change_password INTEGER DEFAULT 0,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sets (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL,
  set_number  TEXT NOT NULL,
  name        TEXT,
  year        INTEGER,
  theme       TEXT,
  pieces      INTEGER,
  minifigs    INTEGER,
  quantity    INTEGER DEFAULT 1,
  image_url   TEXT,
  image_local TEXT,
  brickset_id INTEGER,
  added_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  purchase_price NUMERIC(12,4),
  UNIQUE(user_id, set_number),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS instructions (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL,
  set_number    TEXT NOT NULL,
  url           TEXT NOT NULL,
  description   TEXT,
  local_path    TEXT,
  downloaded_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS shared_instructions (
  id          SERIAL PRIMARY KEY,
  set_number  TEXT NOT NULL,
  url         TEXT NOT NULL,
  description TEXT,
  local_path  TEXT,
  fetched_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(set_number, url)
);

CREATE TABLE IF NOT EXISTS app_logs (
  id         BIGSERIAL PRIMARY KEY,
  level      VARCHAR(10)  NOT NULL DEFAULT 'info',
  message    TEXT         NOT NULL,
  logged_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_app_logs_logged_at ON app_logs (logged_at DESC);

-- Session store table (created here to avoid race condition with connect-pg-simple createTableIfMissing)
CREATE TABLE IF NOT EXISTS user_sessions (
  sid    VARCHAR      NOT NULL COLLATE "default",
  sess   JSON         NOT NULL,
  expire TIMESTAMPTZ  NOT NULL,
  CONSTRAINT user_sessions_pkey PRIMARY KEY (sid) NOT DEFERRABLE INITIALLY IMMEDIATE
);
CREATE INDEX IF NOT EXISTS IDX_user_sessions_expire ON user_sessions (expire);

CREATE TABLE IF NOT EXISTS instruction_queue (
  id         SERIAL PRIMARY KEY,
  set_number TEXT NOT NULL,
  status     TEXT DEFAULT 'pending',  -- pending, done, failed
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_instr_queue_set ON instruction_queue(set_number);

-- Sets that couldn't be enriched from Brickset due to daily quota — retried next day
CREATE TABLE IF NOT EXISTS brickset_retry_queue (
  set_number  TEXT PRIMARY KEY,
  retry_after DATE NOT NULL,
  attempts    INT  NOT NULL DEFAULT 0,
  last_error  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE brickset_retry_queue ADD COLUMN IF NOT EXISTS attempts   INT  NOT NULL DEFAULT 0;
ALTER TABLE brickset_retry_queue ADD COLUMN IF NOT EXISTS last_error TEXT;

-- Rebrickable CSV cache tables
CREATE TABLE IF NOT EXISTS rb_parts (
  part_num     TEXT PRIMARY KEY,
  name         TEXT,
  part_cat_id  INTEGER,
  part_img_url TEXT
);
CREATE TABLE IF NOT EXISTS rb_colors (
  id       INTEGER PRIMARY KEY,
  name     TEXT,
  rgb      TEXT,
  is_trans TEXT
);
-- Rebrickable-Kategorien (id -> Name); via CSV-Sync befüllt (part_categories.csv,
-- siehe jobs/rebrickableCsvSync.js), damit im Kategorie-Filter Namen statt der
-- internen part_cat_id-Zahlen erscheinen.
CREATE TABLE IF NOT EXISTS rb_part_categories (
  id   INTEGER PRIMARY KEY,
  name TEXT
);
-- Muss NACH dem CREATE stehen, sonst schlägt die Init auf einer frischen
-- Datenbank fehl ("relation rb_colors does not exist").
ALTER TABLE rb_colors ADD COLUMN IF NOT EXISTS bl_color_id INTEGER;
CREATE TABLE IF NOT EXISTS rb_sets (
  set_num     TEXT PRIMARY KEY,
  name        TEXT,
  year        INTEGER,
  theme_id    INTEGER,
  num_parts   INTEGER,
  set_img_url TEXT
);
-- Indizes für die Katalogsuche.
--
-- rb_sets hatte bisher KEINEN einzigen Index ausser dem Primärschlüssel,
-- bei rund 25'000 Zeilen. Die Katalogabfrage filtert auf theme_id/year und
-- sucht mit ILIKE '%q%' über set_num und name — und zwar zweimal je
-- Anfrage (einmal COUNT, einmal die Liste). Beim Tippen im Suchfeld sind
-- das zwei vollständige Tabellenscans pro Tastendruck.
--
-- Ein B-Tree hilft bei ILIKE mit führendem Platzhalter nicht (er kann nur
-- Präfixe). Dafür ist pg_trgm da: Der GIN-Index über Trigramme beantwortet
-- auch '%mitte%'-Muster. Die Erweiterung ist Teil der Standarddistribution
-- (postgres:16-alpine bringt sie mit); scheitert CREATE EXTENSION mangels
-- Rechten, laufen die Abfragen unverändert weiter — nur eben ohne Index.
CREATE INDEX IF NOT EXISTS idx_rb_sets_theme_year ON rb_sets(theme_id, year);
CREATE INDEX IF NOT EXISTS idx_rb_sets_year       ON rb_sets(year);
CREATE TABLE IF NOT EXISTS rb_inventories (
  id      INTEGER PRIMARY KEY,
  set_num TEXT,
  version INTEGER
);
CREATE TABLE IF NOT EXISTS rb_inventory_parts (
  id           SERIAL PRIMARY KEY,
  inventory_id INTEGER NOT NULL,
  part_num     TEXT NOT NULL,
  color_id     INTEGER,
  quantity     INTEGER,
  is_spare     TEXT,
  img_url      TEXT
);
CREATE INDEX IF NOT EXISTS idx_rb_inv_parts ON rb_inventory_parts(inventory_id);
CREATE TABLE IF NOT EXISTS rb_bl_mapping (
  part_num    TEXT PRIMARY KEY,
  bl_part_num TEXT,
  fetched_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Katalog-Erweiterung: Themen und Minifiguren je Inventar ──────────────
--
-- Diese beiden Tabellen standen bis jetzt AUSSCHLIESSLICH in
-- jobs/rebrickableCsvSync.ts, in einer Funktion ensureSchema(), die der
-- Katalog-Abgleich beim Start aufrief. Damit gab es sie auf einer frischen
-- Installation erst, wenn dieser Abgleich durchgelaufen war.
--
-- Das ist ein echtes Zeitfenster und kein theoretisches: Der Abgleich läuft
-- nur im primären Arbeitsprozess, die übrigen nehmen Anfragen schon an,
-- sobald das Schema steht. Eine Abfrage auf rb_themes in dieser Spanne
-- bekommt keinen leeren Treffer, sondern "relation does not exist".
--
-- Dieselbe Begründung wie ein paar Zeilen weiter oben bei rb_colors: Das
-- Schema gehört an EINE Stelle, und diese hier ist es.
CREATE TABLE IF NOT EXISTS rb_themes (
  id        INTEGER PRIMARY KEY,
  name      TEXT,
  parent_id INTEGER
);
CREATE TABLE IF NOT EXISTS rb_inventory_minifigs (
  id           SERIAL PRIMARY KEY,
  inventory_id INTEGER NOT NULL,
  fig_num      TEXT NOT NULL,
  quantity     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_rb_inv_minifigs_inv ON rb_inventory_minifigs(inventory_id);

-- ── Shared catalog tables (user-independent) ─────────────────────────────
CREATE TABLE IF NOT EXISTS set_catalog (
  set_number  TEXT PRIMARY KEY,
  name        TEXT,
  year        INTEGER,
  theme       TEXT,
  pieces      INTEGER,
  minifigs    INTEGER,
  image_url   TEXT,
  image_local TEXT,
  brickset_id INTEGER,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS set_parts_catalog (
  set_number    TEXT NOT NULL,
  part_number   TEXT NOT NULL,
  bl_part_number TEXT,
  part_name     TEXT,
  color_id      INTEGER,
  color_name    TEXT,
  color_hex     TEXT,
  category_name TEXT,
  image_url     TEXT,
  image_local   TEXT,
  is_spare      INTEGER DEFAULT 0,
  quantity      INTEGER DEFAULT 1,
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (set_number, part_number, color_id)
);
CREATE INDEX IF NOT EXISTS idx_spc_set ON set_parts_catalog(set_number);


CREATE TABLE IF NOT EXISTS set_minifigs_catalog (
  set_number  TEXT NOT NULL,
  fig_number  TEXT NOT NULL,
  fig_name    TEXT,
  quantity    INTEGER DEFAULT 1,
  image_url   TEXT,
  image_local TEXT,
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (set_number, fig_number)
);
CREATE INDEX IF NOT EXISTS idx_smc_set ON set_minifigs_catalog(set_number);

CREATE TABLE IF NOT EXISTS price_market (
  set_number    TEXT NOT NULL,
  currency_code TEXT NOT NULL,
  condition     TEXT NOT NULL DEFAULT 'new',
  qty_avg_price NUMERIC(12,4),
  min_price     NUMERIC(12,4),
  max_price     NUMERIC(12,4),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (set_number, currency_code, condition)
);
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS parts (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL,
  set_number    TEXT,
  part_number   TEXT NOT NULL,
  part_name     TEXT,
  color_id      INTEGER,
  color_name    TEXT,
  color_hex     TEXT,
  category_name TEXT,
  quantity      INTEGER DEFAULT 1,
  image_url     TEXT,
  image_local   TEXT,
  is_spare      INTEGER DEFAULT 0,
  source          TEXT DEFAULT 'set',
  unit_price      NUMERIC(12,4),
  purchase_price  NUMERIC(12,4),
  note            TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

ALTER TABLE parts ADD COLUMN IF NOT EXISTS bl_part_number TEXT;
CREATE INDEX IF NOT EXISTS idx_parts_user  ON parts(user_id);
CREATE INDEX IF NOT EXISTS idx_parts_color ON parts(user_id, color_name);
CREATE INDEX IF NOT EXISTS idx_parts_set   ON parts(user_id, set_number);

CREATE TABLE IF NOT EXISTS subsets_cache (
  set_number TEXT PRIMARY KEY,
  data       TEXT NOT NULL,
  fetched_at TIMESTAMPTZ DEFAULT NOW()
);
-- Global, shared cache of a minifig's constituent parts (Rebrickable),
-- used to estimate a minifig's market price from its individual parts'
-- BrickLink prices when no direct BrickLink minifig number is known.
CREATE TABLE IF NOT EXISTS minifig_parts_cache (
  fig_number TEXT PRIMARY KEY,
  data       TEXT NOT NULL,
  fetched_at TIMESTAMPTZ DEFAULT NOW()
);
-- Clear stale cache entries (safe now that table exists)
DELETE FROM subsets_cache WHERE fetched_at < NOW() - INTERVAL '1 day' OR data NOT LIKE '%external_ids%';

-- Kaufpreis-Historie: eine Zeile pro Erfassung (auch beim erneuten
-- Hinzufügen desselben Sets). sets.purchase_price spiegelt den Preis der
-- LETZTEN Erfassung; Finanz-Summen rechnen über diese Tabelle.
CREATE TABLE IF NOT EXISTS set_acquisitions (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER NOT NULL,
  set_number     TEXT NOT NULL,
  quantity       INTEGER DEFAULT 1,
  purchase_price NUMERIC(12,4),
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_acq_user_set ON set_acquisitions(user_id, set_number);

CREATE TABLE IF NOT EXISTS catalog_cache (
  set_number TEXT PRIMARY KEY,
  name       TEXT,
  year       INTEGER,
  theme      TEXT,
  pieces     INTEGER,
  image_url  TEXT,
  is_gear    INTEGER DEFAULT 0,
  bl_type    TEXT,
  fetched_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS minifigs (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL,
  set_number    TEXT,
  fig_number    TEXT NOT NULL,
  fig_name      TEXT,
  quantity      INTEGER DEFAULT 1,
  image_url     TEXT,
  source          TEXT DEFAULT 'set',
  unit_price      NUMERIC(12,4),
  purchase_price  NUMERIC(12,4),
  note            TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_minifigs_user ON minifigs(user_id);
ALTER TABLE minifigs ADD COLUMN IF NOT EXISTS bl_fig_number TEXT;
ALTER TABLE minifigs ADD COLUMN IF NOT EXISTS image_local TEXT;

CREATE TABLE IF NOT EXISTS minifig_price_cache (
  id            SERIAL PRIMARY KEY,
  fig_number    TEXT NOT NULL,
  condition     TEXT NOT NULL DEFAULT 'U',
  currency_code TEXT NOT NULL DEFAULT 'EUR',
  avg_price     NUMERIC(12,4),
  qty_avg_price NUMERIC(12,4),
  fetched_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(fig_number, condition, currency_code)
);

CREATE TABLE IF NOT EXISTS part_price_cache (
  id            SERIAL PRIMARY KEY,
  part_number   TEXT NOT NULL,
  color_id      INTEGER NOT NULL DEFAULT 0,
  condition     TEXT NOT NULL DEFAULT 'U',
  currency_code TEXT NOT NULL DEFAULT 'EUR',
  avg_price     NUMERIC(12,4),
  qty_avg_price NUMERIC(12,4),
  fetched_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(part_number, color_id, condition, currency_code)
);

CREATE TABLE IF NOT EXISTS price_history (
  id            SERIAL PRIMARY KEY,
  set_number    TEXT NOT NULL,
  condition     TEXT NOT NULL DEFAULT 'N',
  currency_code TEXT NOT NULL DEFAULT 'EUR',
  avg_price     NUMERIC(12,4),
  qty_avg_price NUMERIC(12,4),
  min_price     NUMERIC(12,4),
  max_price     NUMERIC(12,4),
  recorded_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_price_history_set ON price_history(set_number, recorded_at);

-- Meistgenutzte Query der App: SELECT ... FROM sets WHERE user_id = $1.
-- UNIQUE(user_id, set_number) deckt das zwar theoretisch ab, ein
-- expliziter Index dokumentiert die Absicht und bleibt bei Schema-
-- Änderungen stabil. Die Cache-Tabellen hatten bisher NUR den SERIAL-PK —
-- jeder Preis-Lookup war ein Seq-Scan auf einer wachsenden Tabelle.
CREATE INDEX IF NOT EXISTS idx_sets_user ON sets(user_id);
CREATE INDEX IF NOT EXISTS idx_instructions_user ON instructions(user_id, set_number);
CREATE INDEX IF NOT EXISTS idx_shared_instructions_set ON shared_instructions(set_number);
CREATE TABLE IF NOT EXISTS price_cache (
  id            SERIAL PRIMARY KEY,
  set_number    TEXT NOT NULL,
  condition     TEXT NOT NULL DEFAULT 'N',
  currency_code TEXT NOT NULL DEFAULT 'EUR',
  min_price     NUMERIC(12,4),
  avg_price     NUMERIC(12,4),
  max_price     NUMERIC(12,4),
  qty_avg_price NUMERIC(12,4),
  total_quantity INTEGER,
  fetched_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(set_number, condition, currency_code)
);
CREATE INDEX IF NOT EXISTS idx_price_cache_lookup
  ON price_cache(set_number, condition, currency_code, fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_part_price_cache_lookup
  ON part_price_cache(part_number, color_id, condition, currency_code, fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_minifig_price_cache_lookup
  ON minifig_price_cache(fig_number, condition, currency_code, fetched_at DESC);
-- Backfill price_history from price_cache (safe now both tables exist)
INSERT INTO price_history (set_number, condition, currency_code, avg_price, qty_avg_price, min_price, max_price, recorded_at)
SELECT pc.set_number, pc.condition, pc.currency_code, pc.avg_price, pc.qty_avg_price, pc.min_price, pc.max_price, pc.fetched_at
FROM price_cache pc
WHERE (pc.avg_price > 0 OR pc.qty_avg_price > 0)
  AND NOT EXISTS (
    SELECT 1 FROM price_history ph
    WHERE ph.set_number = pc.set_number
      AND ph.condition = pc.condition
      AND ph.currency_code = pc.currency_code
      AND ABS(EXTRACT(EPOCH FROM (ph.recorded_at - pc.fetched_at))) < 3600
  )
ON CONFLICT DO NOTHING;

-- rate_counters ist ENTFALLEN.
--
-- Die Tabelle wurde bei jeder Initialisierung angelegt, aber von keiner
-- einzigen Abfrage benutzt: Die Login- und IP-Kontingente liegen in
-- rate_limit_attempts (siehe weiter unten und utils/loginLimiter.ts).
-- Übrig war ein Entwurf aus einer früheren Fassung — samt eines Tests, der
-- noch gegen die alten Spaltennamen prüfte und dadurch rot war.
--
-- Bewusst KEIN DROP: Auf bestehenden Installationen bleibt die (leere)
-- Tabelle stehen. Sie kostet nichts, und ein Löschbefehl im Startpfad ist
-- ein Risiko ohne Gegenwert.

CREATE TABLE IF NOT EXISTS global_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id    INTEGER NOT NULL,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY(user_id, key),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  id     SERIAL PRIMARY KEY,
  name   TEXT NOT NULL UNIQUE,
  run_at TIMESTAMPTZ DEFAULT NOW()
);

-- sliding: Gleitet das Ablaufdatum bei Benutzung mit?
--
-- Der Token der App und der des Browsers haben verschiedene Laufzeitregeln.
-- Bis hierher war der Unterschied daran zu erkennen, ob expires_at NULL ist:
-- App = kein Ablauf, Browser = sieben Tage. Der App-Token verfiel trotzdem
-- irgendwann — aber nur, weil ein stuendlicher Aufraeumjob ihn nach 90 Tagen
-- ohne Nutzung LOESCHTE. Durchgesetzt wurde die Frist also von einem
-- Hintergrundjob, nicht von der Pruefung im Anfrageweg.
--
-- Jetzt traegt auch der App-Token ein echtes Ablaufdatum, das bei jeder
-- Benutzung nachrueckt (siehe _touchLastUsed in utils/auth.ts). Damit
-- entscheidet die WHERE-Klausel in validateToken() — und die laeuft bei jeder
-- Anfrage, egal ob ein Job lebt. Dieses Feld sagt, welcher der beiden
-- Token-Sorten eine Zeile angehoert.
CREATE TABLE IF NOT EXISTS api_tokens (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_used  TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  sliding    BOOLEAN NOT NULL DEFAULT FALSE,
  label      TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
