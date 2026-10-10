-- ═══════════════════════════════════════════════════════════════════════════
-- Lagerorte werden VERWALTET, nicht mehr abgeleitet
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── Was sich gegenueber 0018 aendert, und warum ─────────────────────────────
--
-- 0018 hat den Lagerort als freien Text an `sets` und `parts` gehaengt, mit
-- der ausdruecklichen Begruendung: „Die Liste der Orte IST die Liste der
-- belegten Orte." Eine eigene Tabelle waere Ballast um eine Zeichenkette
-- herum gewesen.
--
-- Marcos Vorgabe kehrt das um:
--
--   „Der Lagerort soll ein Auswahlfeld mit einem Dropdown sein, bei dem man
--    auch gleich neue Auswahlwerte erfassen kann. Die Werte sollen pro User
--    verwaltet werden koennen und sollen in den Einstellungen bearbeitbar
--    sein."
--
-- Damit gewinnt die Tabelle genau das, was ihr vorher fehlte: einen Ort, an
-- dem ein Name geaendert oder entfernt werden kann, ohne dass man jedes Set
-- einzeln anfassen muss — und einen Ort, an dem ein Name schon existiert,
-- BEVOR etwas darin liegt. „Kiste 4 ist gekauft, aber noch leer" war mit der
-- abgeleiteten Liste nicht darstellbar.
--
-- Der freie Text in sets.storage / parts.storage BLEIBT. Er ist die
-- Zuordnung; diese Tabelle ist der Vorrat. Sie ueber eine Fremdschluessel-ID
-- zu verbinden haette jede bestehende Zeile umschreiben muessen und jede
-- Abfrage um einen JOIN erweitert — fuer einen Namen, der ohnehin eindeutig
-- ist.
--
-- ── Warum je Konto und nicht je Haushalt ────────────────────────────────────
--
-- Ein Lagerort ist ein Regal in einer Wohnung. Der Grossvater hat andere
-- Regale als der Enkel, auch wenn er dessen Sets sehen darf. Deshalb haengt
-- die Liste am KONTO — und deshalb sieht der Grossvater beim Set des Enkels
-- die Orte des Enkels, nicht seine eigenen (Marcos Festlegung).

-- ── Tabelle und Index stehen jetzt in db/schema.sql ────────────────────────
--
-- Sie standen hier, und das war richtig, solange nur die Auswahlliste daran
-- hing. Mit Migration 0031 verbindet jede Abfrage, die einen Lagerortnamen
-- ANZEIGT, diese Tabelle — und Pruefungen, die ihre Datenbank mit
-- initSchema() allein aufbauen (ohne Migrationen), bekamen dann „relation
-- storage_locations does not exist".
--
-- Umgezogen und nicht verdoppelt: Jede Tabelle wird an genau EINEM Ort
-- angelegt (test/schema-am-start.test.js). db/schema.sql laeuft bei JEDEM
-- Start und vor den Migrationen, diese Datei genau einmal — der Vorrat steht
-- also fuer bestehende Installationen genauso bereit wie vorher.
--
-- Was hier BLEIBT, ist die Uebernahme darunter: Sie ist der einmalige
-- Schritt, den schema.sql nicht ausdruecken kann.

-- ── Die bereits benutzten Orte uebernehmen ──────────────────────────────────
--
-- Ohne diesen Schritt waere die Auswahlliste nach der Migration LEER, waehrend
-- in den Sets weiter Orte stehen — die Oberflaeche zeigte dann einen Wert an,
-- den sie selbst nicht zur Wahl stellt.
--
-- UNION (nicht UNION ALL) fasst Sets und Teile zusammen. Stehen trotzdem zwei
-- Schreibweisen desselben Namens in den Daten, faengt sie ON CONFLICT ab —
-- die erste gewinnt.
INSERT INTO storage_locations (user_id, name)
SELECT user_id, btrim(storage) FROM sets
 WHERE storage IS NOT NULL AND btrim(storage) <> ''
UNION
SELECT user_id, btrim(storage) FROM parts
 WHERE storage IS NOT NULL AND btrim(storage) <> ''
ON CONFLICT DO NOTHING;
