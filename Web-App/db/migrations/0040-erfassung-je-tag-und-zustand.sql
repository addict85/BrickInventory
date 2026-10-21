-- ── Eine Erfassung je Tag, Element, Benutzer UND ZUSTAND ───────────────────
--
-- ── Marcos Befund vom 21.10. ───────────────────────────────────────────────
--
--   „Beim Import der Liste dann darauf achten, dass wenn das Teil und Farbe
--    bereits existiert und nur der Zustand anders ist, einen neuen Preis
--    erzeugen mit einem anderen Zustand."
--
-- GEMESSEN vorher, eine Wanted-Liste mit zweimal 3001 in Rot — einmal 3 Stück
-- NEU zu 1.50, einmal 2 Stück GEBRAUCHT zu 0.50:
--
--   part_acquisitions: 1 Zeile — quantity 5, unit_price 1.10, condition 'U'
--
-- 1.10 ist der mengengewichtete Mischpreis, und der Zustand wurde 'U', weil im
-- Projekt „gebraucht gewinnt". Die drei neuen Teile zu 1.50 standen damit als
-- gebraucht zu 1.10 in der Finanzansicht.
--
-- ── Dies holt eine VERWORFENE Fassung zurück, mit offenen Augen ─────────────
--
-- Der Kopf von utils/acquisitions.ts sagte dazu:
--
--   „Eine frühere Fassung hatte den Zustand im Schlüssel, damit beide Käufe
--    getrennt bewertet werden können. Verworfen — die Datums-Endpunkte für
--    Sets, Teile und Minifiguren weisen einen zweiten Eintrag am selben Tag
--    ohnehin alle drei ab, ohne den Zustand anzusehen. Zwei Regeln, die sich
--    widersprechen, sind schlimmer als die weniger feine von beiden."
--
-- Der Grund war gut, und er gilt weiter: Eine Änderung NUR hier stellte genau
-- den Widerspruch wieder her, den derselbe Kopf als Altlast beschreibt („Der
-- Anlege-Pfad konnte einen Zustand herstellen, den der Bearbeiten-Pfad
-- ablehnt"). Deshalb ziehen findSameDayAcquisition() und die drei
-- Datums-Endpunkte im selben Schritt mit. Die feinere der beiden Regeln ist
-- jetzt die, die überall gilt.
--
-- ── Warum COALESCE(condition, 'N') ─────────────────────────────────────────
--
-- Die Spalte ist nullbar (Vorgabe 'N'). In einem UNIQUE-Index ist NULL nie
-- gleich NULL — eine Zeile ohne Zustand könnte beliebig oft danebenstehen, und
-- die Regel wäre für genau diese Zeilen abgeschaltet. COALESCE macht aus dem
-- fehlenden Wert das, was die Spalte ohnehin vorgibt, und was
-- recordAcquisitionForDay() aus einem leeren Zustand macht
-- (`['N','U'].includes(…) ? … : 'N'`).
--
-- ── Altbestand ─────────────────────────────────────────────────────────────
--
-- Es wird NICHTS zusammengefasst und NICHTS getrennt. Der neue Index ist
-- WEITER als der alte: Was ihm genügt, genügte auch dem alten nicht umgekehrt.
-- Jede bestehende Zeile bleibt also gültig, und bereits verschmolzene Käufe
-- bleiben verschmolzen — sie nachträglich aufzutrennen ginge nicht, die
-- Einzelpreise sind im Mischpreis nicht mehr enthalten.

-- ── Sets ────────────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS idx_set_acq_tag;
CREATE UNIQUE INDEX IF NOT EXISTS idx_set_acq_tag_zustand
  ON set_acquisitions (user_id, set_number,
                       ((created_at AT TIME ZONE 'UTC')::date),
                       (COALESCE(condition, 'N')));

-- ── Manuelle Teile ──────────────────────────────────────────────────────────
DROP INDEX IF EXISTS idx_part_acq_tag;
CREATE UNIQUE INDEX IF NOT EXISTS idx_part_acq_tag_zustand
  ON part_acquisitions (user_id, part_number, color_id,
                        ((created_at AT TIME ZONE 'UTC')::date),
                        (COALESCE(condition, 'N')));

-- ── Manuelle Minifiguren ────────────────────────────────────────────────────
DROP INDEX IF EXISTS idx_minifig_acq_tag;
CREATE UNIQUE INDEX IF NOT EXISTS idx_minifig_acq_tag_zustand
  ON minifig_acquisitions (user_id, fig_number,
                           ((created_at AT TIME ZONE 'UTC')::date),
                           (COALESCE(condition, 'N')));
