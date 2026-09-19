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

CREATE TABLE IF NOT EXISTS storage_locations (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Eindeutig OHNE Ruecksicht auf Gross-/Kleinschreibung: „Regal A" und
-- „regal a" sind dasselbe Regal. Zwei Eintraege dafuer waeren eine Falle in
-- der Auswahlliste, nicht eine Wahlmoeglichkeit.
CREATE UNIQUE INDEX IF NOT EXISTS storage_locations_konto_name
  ON storage_locations (user_id, lower(name));

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
