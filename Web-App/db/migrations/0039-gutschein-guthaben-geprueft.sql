-- 0039 — Wann das Guthaben eines Gutscheins zuletzt abgefragt wurde
--
-- ── Marcos Vorgabe ──────────────────────────────────────────────────────────
--
--   „Kannst du dies bei den Gutscheinen einbauen, damit dies auf Knopfdruck
--    abgefragt und gespeichert werden kann?"
--
-- („dies" = sein Prototyp, der das Guthaben einer Geschenkkarte ueber LEGOs
-- eigenen GraphQL-Endpunkt holt — denselben, den die Seite benutzt, wenn man
-- Nummer und PIN dort eintippt.)
--
-- ── Warum eine eigene Spalte und nicht updated_at ───────────────────────────
--
-- `vouchers.updated_at` gibt es schon, und es waere bequem. Es aendert sich
-- aber AUCH, wenn jemand den Betrag von Hand korrigiert, die Notiz aendert
-- oder das PDF nachlegt. Dann stuende dort „heute" und bedeutete „irgendetwas
-- wurde angefasst" — nicht „das Guthaben ist von heute".
--
-- Genau dieser Unterschied ist der Zweck der Spalte: „250 CHF" allein ist
-- keine Auskunft. „250 CHF, abgefragt am 15.10." ist eine. Und ein Gutschein,
-- dessen Guthaben nie abgefragt wurde, soll sich von einem unterscheiden, bei
-- dem die Abfrage 250 ergeben hat — NULL sagt das, ein Datum aus updated_at
-- nicht.
--
-- ── Was NICHT dazukommt ─────────────────────────────────────────────────────
--
-- Keine Spalte fuer das abgefragte Guthaben neben `amount`. Der abgefragte
-- Wert IST der Betrag — er wird in `amount` geschrieben, und damit zeigen
-- Liste, Summe und der PDF-Export (utils/gutscheinPdfSchreiben.ts) ohne jede
-- weitere Aenderung den heutigen Stand. Ein zweites Betragsfeld waere eine
-- zweite Wahrheit, und beim naechsten Export muesste jemand entscheiden,
-- welche gilt.
--
-- Auch keine Spalte fuer den letzten FEHLER: Ein gescheiterter Abruf ist eine
-- Auskunft an den Menschen, der gerade auf den Knopf gedrueckt hat, und die
-- steht in der Antwort. Sie zu speichern hiesse, sie spaeter irgendwo zeigen
-- zu muessen, und bis dahin altert sie.

ALTER TABLE IF EXISTS vouchers
  ADD COLUMN IF NOT EXISTS guthaben_geprueft_am TIMESTAMPTZ;

-- ── Und die Schranke vor der Abfrage ────────────────────────────────────────
--
-- Marcos Vorgaben:
--
--   „Bitte auch dafuer sorgen dass maximal 1 Request pro 30sek abgesetzt
--    werden kann." … „(ueber alle Benutzer)"
--
--   „Der Botschutz beibehalten, dass nicht mehr Aufrufe generiert werden wenn
--    ein Schutz greift."
--
-- „Ueber alle Benutzer" heisst: Der Zaehler darf nicht im Speicher EINES
-- Arbeitsprozesses liegen. Der Server laeuft im Cluster (WORKERS = max(2,
-- Kerne)); jeder Arbeiter haette seinen eigenen, und aus einem Aufruf je
-- 30 Sekunden wuerden N. Genau dieser Fehler ist in diesem Baum zweimal
-- gefunden worden (utils/loginLimiter.ts, utils/rateLimiter.ts).
--
-- ── Warum eine eigene TABELLE und nicht global_settings ─────────────────────
--
-- Der erste Entwurf legte die zwei Werte als Zeilen in `global_settings` ab —
-- wie `api_calls_*`. scripts/check-global-settings.js hat ihn zurueckgewiesen,
-- und beim Nachsehen zu Recht: Die Regel dort heisst „global_settings gehoert
-- ueber utils/settings.ts", und genau das geht hier NICHT — die Schranke
-- braucht `SELECT … FOR UPDATE` in derselben Transaktion, in der sie schreibt.
-- Ein Helfer mit eigener Verbindung gaebe gerade die Sperre auf, fuer die es
-- die Transaktion gibt.
--
-- Die eigene Tabelle ist nicht bloss der Ausweg, sondern das Bessere:
--   * Zwei TIMESTAMPTZ-Spalten statt zweier Texte, die jedes Lesen erst
--     zurueckwandeln muss.
--   * Nichts davon taucht in der Einstellungsseite oder im
--     Konfigurations-Export auf. Als global_settings-Zeilen haetten sie dort
--     ausgeschlossen werden muessen — eine Ausnahme mehr, die jemand pflegen
--     muss.
--
-- EINE Zeile, fest auf id = 1. Der CHECK macht die Einzigkeit zur Regel der
-- Datenbank statt zu einer Verabredung im Code: Eine zweite Zeile waere eine
-- zweite Schranke, und zwei Schranken sind keine.
CREATE TABLE IF NOT EXISTS gutschein_guthaben_schranke (
  id            SMALLINT    PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  -- Wann zuletzt eine Abfrage ABGESETZT wurde — auch eine gescheiterte.
  -- Gezaehlt werden Anfragen, nicht Erfolge: Sonst liesse sich die Grenze
  -- durch wiederholtes Scheitern beliebig oft umgehen.
  letzter_abruf TIMESTAMPTZ,
  -- Bis wann nach einem Bot-Schutz-Treffer gar nicht gefragt wird.
  sperre_bis    TIMESTAMPTZ
);

INSERT INTO gutschein_guthaben_schranke (id) VALUES (1)
  ON CONFLICT (id) DO NOTHING;
