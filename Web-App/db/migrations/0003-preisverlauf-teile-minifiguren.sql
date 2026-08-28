-- ── Preisverlauf für Teile und Minifiguren ───────────────────────────────────
--
-- ── Ausgangslage ────────────────────────────────────────────────────────────
-- Für Sets gibt es price_history: eine Zeile je Abruf, Zustand und Währung.
-- Daraus zeichnet die Detailseite den Verlauf.
--
-- Für Teile und Minifiguren gab es das nicht. part_price_cache und
-- minifig_price_cache tragen jeweils ein UNIQUE über
-- (nummer, [farbe,] zustand, währung) und werden per ON CONFLICT DO UPDATE
-- überschrieben — gespeichert ist also immer nur der ZULETZT abgerufene Preis.
-- Eine Vergangenheit existiert nicht und lässt sich auch nicht nachträglich
-- herstellen.
--
-- ── Was diese Migration tut ─────────────────────────────────────────────────
-- Sie legt die beiden fehlenden Tabellen an und füllt sie mit dem EINEN
-- Datenpunkt vor, der vorhanden ist: dem aktuellen Cache-Stand samt seinem
-- fetched_at. Damit beginnt der Verlauf nicht bei null, sondern beim heutigen
-- Wert — genauso wurde seinerzeit price_history für Sets aus price_cache
-- vorbefüllt (siehe db/database.ts).
--
-- Ein brauchbares Diagramm entsteht trotzdem erst nach mehreren Abrufen: Zwei
-- Punkte braucht es mindestens, aussagekräftig wird es nach ein bis zwei
-- Wochen. Das ist keine Frage der Umsetzung.
--
-- Kein UNIQUE über (nummer, zustand, tag): price_history hat ebenfalls keines
-- und verlässt sich auf ON CONFLICT DO NOTHING beim Schreiben. Die Abfragen
-- fassen ohnehin per DISTINCT ON je Tag zusammen.

CREATE TABLE IF NOT EXISTS part_price_history (
  id            SERIAL PRIMARY KEY,
  part_number   TEXT NOT NULL,
  color_id      INTEGER NOT NULL DEFAULT 0,
  condition     TEXT NOT NULL DEFAULT 'U',
  currency_code TEXT NOT NULL DEFAULT 'EUR',
  avg_price     REAL,
  qty_avg_price REAL,
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_part_price_history_lookup
  ON part_price_history(part_number, color_id, currency_code, recorded_at);

CREATE TABLE IF NOT EXISTS minifig_price_history (
  id            SERIAL PRIMARY KEY,
  fig_number    TEXT NOT NULL,
  condition     TEXT NOT NULL DEFAULT 'U',
  currency_code TEXT NOT NULL DEFAULT 'EUR',
  avg_price     REAL,
  qty_avg_price REAL,
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_minifig_price_history_lookup
  ON minifig_price_history(fig_number, currency_code, recorded_at);

-- ── Startpunkt aus dem aktuellen Cache ──────────────────────────────────────
-- Nur Zeilen mit einem echten Preis: Ein Nullwert als erster Punkt sähe im
-- Diagramm aus wie ein Kurssturz.
INSERT INTO part_price_history
       (part_number, color_id, condition, currency_code, avg_price, qty_avg_price, recorded_at)
SELECT  part_number, color_id, condition, currency_code, avg_price, qty_avg_price, fetched_at
  FROM  part_price_cache
 WHERE  COALESCE(avg_price, 0) > 0 OR COALESCE(qty_avg_price, 0) > 0;

INSERT INTO minifig_price_history
       (fig_number, condition, currency_code, avg_price, qty_avg_price, recorded_at)
SELECT  fig_number, condition, currency_code, avg_price, qty_avg_price, fetched_at
  FROM  minifig_price_cache
 WHERE  COALESCE(avg_price, 0) > 0 OR COALESCE(qty_avg_price, 0) > 0;
