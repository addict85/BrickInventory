-- ════════════════════════════════════════════════════════════════════════════
-- KORREKTUR: Alle Sets eines Kontos auf den Lagerort „Estrich" setzen
--
-- Marcos Vorgabe: „Kannst mir ein Update Script schreiben, damit alle Sets als
-- Lagerort Estrich gesetzt haben?"
--
-- BITTE ZUERST DEN BEFUND LAUFEN LASSEN — dieses Skript ÜBERSCHREIBT
-- Zuordnungen, die vielleicht jemand bewusst gesetzt hat:
--
--   docker exec -i brickinventory-db \
--     psql -U brickinventory -d brickinventory < scripts/befund-lagerort-estrich.sql
--
-- Aufruf:
--   docker exec -i brickinventory-db \
--     psql -U brickinventory -d brickinventory -v konto=marco \
--     < scripts/korrektur-lagerort-estrich.sql
--
--   -v konto=<benutzername>   nur dieses Konto
--   -v konto=alle             JEDES Konto der Installation
--   -v ort=Keller             anderer Zielort (Vorgabe: Estrich)
--
-- ── Warum das Konto PFLICHT ist ─────────────────────────────────────────────
--
-- Ein Lagerort ist ein Regal in einer Wohnung (so begründet in Migration
-- 0020-lagerorte-verwaltet.sql: „Der Grossvater hat andere Regale als der
-- Enkel"). Ohne Angabe würde dieses Skript die Regale aller Haushaltsmitglieder
-- auf einen Schlag umschreiben — eine Wirkung, die niemand beabsichtigt, wenn
-- er „meine Sets" meint. Fehlt die Angabe, bricht das Skript ab; „alle" muss
-- man ausdrücklich hinschreiben.
--
-- ── Was es tut ──────────────────────────────────────────────────────────────
--  1. VORRAT: Der Zielort kommt in storage_locations des betroffenen Kontos,
--     falls er dort fehlt. Ohne diesen Schritt stünde er an jedem Set, fehlte
--     aber in der Auswahlliste — genau die Falle, die Migration 0020 im
--     Abschnitt „Die bereits benutzten Orte uebernehmen" beschreibt.
--  2. SETS: sets.storage := Zielort, für alle Sets des Kontos.
--
-- ── Was es NICHT tut ────────────────────────────────────────────────────────
-- Es fasst `parts` und `minifigs` nicht an. Marcos Vorgabe nennt die Sets, und
-- lose Teile liegen erfahrungsgemäss gerade nicht dort, wo die Schachteln
-- stehen. Wer sie mitnehmen will, ändert die beiden UPDATEs unten — bewusst,
-- nicht nebenbei.
--
-- ── Sicherheit ──────────────────────────────────────────────────────────────
-- Alles in EINER Transaktion. Existiert das genannte Konto nicht, bricht das
-- Skript mit einer Meldung ab und ändert nichts — sonst wäre „0 Zeilen
-- geändert" das Ergebnis eines Tippfehlers, und niemand würde es merken.
--
-- Zum Probelauf ohne Änderung: die letzte Zeile von COMMIT auf ROLLBACK
-- ändern. Die Zählungen werden trotzdem ausgegeben — man sieht also genau,
-- was passieren WÜRDE.
--
-- Vorher eine Sicherung, wenn die Installation wichtig ist:
--   docker exec brickinventory-db pg_dump -U brickinventory brickinventory \
--     > sicherung-$(date +%F).sql
-- ════════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
\timing off
\pset border 2

\if :{?ort}
\else
\set ort 'Estrich'
\endif

\if :{?konto}
\else
\echo ''
\echo 'FEHLER: Es fehlt -v konto=<benutzername> (oder -v konto=alle).'
\echo '        Begruendung im Kopf dieser Datei: Lagerorte gehoeren je Konto.'
\echo ''
-- Als SQL-Fehler und nicht als \quit: Mit ON_ERROR_STOP endet psql dann mit
-- einem Rueckgabewert ungleich null. Ein \quit beendet mit 0 — ein Aufrufer,
-- der das Skript in eine Kette haengt, hielte den Abbruch fuer Erfolg.
DO $$ BEGIN RAISE EXCEPTION 'Aufruf ohne -v konto=... abgebrochen'; END $$;
\endif

BEGIN;

-- ── Gibt es das Konto ueberhaupt? ──────────────────────────────────────────
--
-- „alle" ist ausdruecklich erlaubt und trifft jedes Konto. Ein Konto, das
-- tatsaechlich „alle" heisst, waere damit nicht einzeln ansprechbar — bei
-- einem Wartungsskript die kleinere Unsauberkeit als eine zweite Variable.
--
-- Die Pruefung laeuft ueber \gset und \if und NICHT in einem DO-Block:
-- Nachgemessen, nicht vermutet — psql ersetzt :'konto' innerhalb eines
-- Dollar-Zitats NICHT, der Block scheiterte mit
--
--     ERROR:  syntax error at or near ":"
--
-- Das ist genau die Sorte Fehler, die ein Wartungsskript beim ersten echten
-- Lauf trifft und nicht vorher. 'yes'/'no' statt true/false, weil \if die
-- Boolean-Ausgabe 't'/'f' von Postgres nicht annimmt.
SELECT CASE WHEN COUNT(*) > 0 THEN 'yes' ELSE 'no' END AS konto_da,
       COUNT(*)                                        AS konten
  FROM users
 WHERE lower(:'konto') = 'alle' OR lower(username) = lower(:'konto')
\gset

\if :konto_da
\echo 'Betroffene Konten:' :konten
\else
\echo ''
\echo 'FEHLER: Kein Konto gefunden. Nichts geaendert.'
\echo ''
DO $$ BEGIN RAISE EXCEPTION 'Konto nicht gefunden — nichts geaendert'; END $$;
\endif

\echo ''
\echo '== Vorher =============================================================='

SELECT u.username                                        AS konto,
       COUNT(*)                                          AS sets,
       COUNT(*) FILTER (WHERE l.name = :'ort')           AS im_zielort,
       COUNT(*) FILTER (WHERE s.storage_id IS NULL)      AS ohne_ort,
       COUNT(*) FILTER (WHERE s.storage_id IS NOT NULL
                          AND l.name <> :'ort')          AS anderer_ort
  FROM sets s
  JOIN users u ON u.id = s.user_id
  LEFT JOIN storage_locations l ON l.id = s.storage_id
 WHERE lower(:'konto') = 'alle' OR lower(u.username) = lower(:'konto')
 GROUP BY u.username
 ORDER BY u.username;

-- ── Schritt 1: Der Zielort kommt in den Vorrat ─────────────────────────────
--
-- ON CONFLICT auf den Index storage_locations_konto_name (user_id,
-- lower(name)): „Estrich" und „estrich" sind dasselbe Regal, und ein zweiter
-- Eintrag waere eine Falle in der Auswahlliste, keine Wahlmoeglichkeit.
INSERT INTO storage_locations (user_id, name)
SELECT u.id, :'ort'
  FROM users u
 WHERE lower(:'konto') = 'alle' OR lower(u.username) = lower(:'konto')
ON CONFLICT (user_id, lower(name)) DO NOTHING;

\echo ''
\echo '== Schritt 1: Vorrat ==================================================='
\echo '   Zeilen oben = neu angelegt. 0 heisst: war schon da.'

-- ── Steht der Ort jetzt wirklich bereit? ───────────────────────────────────
--
-- NACHGEMESSEN, nicht angenommen: Beim Gegenprobieren stand die Sequenz von
-- storage_locations hinter dem hoechsten vergebenen Schluessel (so entsteht es
-- bei einem Import mit ausdruecklichen IDs). Dann traf das INSERT den
-- PRIMAERSCHLUESSEL, nicht den Namensindex — und ein ON CONFLICT ohne Ziel
-- verschluckt beides. Das Skript meldete „INSERT 0 0 / UPDATE 0" und sah aus
-- wie „gab nichts zu tun".
--
-- Zwei Riegel dagegen, und der erste ist nachgemessen: Das ON CONFLICT oben
-- nennt jetzt sein Ziel, und derselbe Versuch endet damit laut —
--
--     ERROR:  duplicate key value violates unique constraint
--             "storage_locations_pkey"
--
-- mit Ruecknahme der Transaktion; die Sets blieben unveraendert. Die Pruefung
-- hier ist der zweite Riegel: Sie faengt den Fall, dass der Ort aus einem
-- ANDEREN Grund fehlt, bevor irgendetwas zugeordnet wird. Mit nachgezogener
-- Sequenz laeuft derselbe Aufruf durch (INSERT 0 1, UPDATE 2, COMMIT).
SELECT CASE WHEN COUNT(*) = 0 THEN 'yes' ELSE 'no' END AS vorrat_da,
       COUNT(*)                                        AS fehlt_bei
  FROM users u
 WHERE (lower(:'konto') = 'alle' OR lower(u.username) = lower(:'konto'))
   AND NOT EXISTS (SELECT 1 FROM storage_locations l
                    WHERE l.user_id = u.id AND lower(l.name) = lower(:'ort'))
\gset

\if :vorrat_da
\else
\echo ''
\echo 'FEHLER: Der Zielort fehlt im Vorrat von' :fehlt_bei 'Konto/Konten.'
\echo '        Pruefe die Sequenz: SELECT setval(''storage_locations_id_seq'','
\echo '        (SELECT MAX(id) FROM storage_locations));'
\echo ''
DO $$ BEGIN RAISE EXCEPTION 'Zielort nicht im Vorrat — nichts geaendert'; END $$;
\endif

-- ── Schritt 2: Die Sets ────────────────────────────────────────────────────
--
-- Seit Migration 0031 traegt die Zeile eine ID. Aufgeloest wird sie je ZEILE
-- ueber das KONTO des Besitzers: Derselbe Name kann in zwei Konten liegen, und
-- jedes hat seine eigene Zeile im Vorrat (ein Regal steht in EINER Wohnung).
-- Mit -v konto=alle trifft dieses Skript mehrere Konten, und jedes muss sein
-- eigenes Regal bekommen — eine vorher aufgeloeste ID waere fuer alle anderen
-- die falsche Wohnung.
--
-- `IS DISTINCT FROM` und nicht `<>`: Ein Set ohne Ort hat NULL, und
-- NULL <> <id> ergibt NULL, also nicht wahr — die Zeilen ohne Ort waeren
-- stillschweigend uebersprungen. Genau die sollen aber geaendert werden.
--
-- Die Einschraenkung ist kein Geschwindigkeitstrick: Sie haelt updated_at (wo
-- vorhanden) und die gemeldete Zahl ehrlich. „37 geaendert" soll heissen, dass
-- 37 Sets vorher anders standen.
UPDATE sets s
   SET storage_id = l.id
  FROM users u, storage_locations l
 WHERE u.id = s.user_id
   AND l.user_id = s.user_id
   AND lower(l.name) = lower(:'ort')
   AND (lower(:'konto') = 'alle' OR lower(u.username) = lower(:'konto'))
   AND s.storage_id IS DISTINCT FROM l.id;

\echo ''
\echo '== Schritt 2: Sets ====================================================='
\echo '   Zeilen oben = tatsaechlich geaendert (die anderen standen schon dort).'

\echo ''
\echo '== Nachher ============================================================='

SELECT u.username                                        AS konto,
       COUNT(*)                                          AS sets,
       COUNT(*) FILTER (WHERE l.name = :'ort')           AS im_zielort,
       COUNT(*) FILTER (WHERE s.storage_id IS NULL)      AS ohne_ort,
       COUNT(*) FILTER (WHERE s.storage_id IS NOT NULL
                          AND l.name <> :'ort')          AS anderer_ort
  FROM sets s
  JOIN users u ON u.id = s.user_id
  LEFT JOIN storage_locations l ON l.id = s.storage_id
 WHERE lower(:'konto') = 'alle' OR lower(u.username) = lower(:'konto')
 GROUP BY u.username
 ORDER BY u.username;

COMMIT;
