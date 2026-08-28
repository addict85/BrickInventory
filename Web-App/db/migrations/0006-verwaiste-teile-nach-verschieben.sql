-- ── Verwaiste Teile, Minifiguren und Anleitungen zu ihren Sets zurückführen ──
--
-- ── Warum ───────────────────────────────────────────────────────────────────
-- Das Verschieben eines Sets in ein anderes Konto des Haushalts gibt es seit
-- hardened-102. Bis hardened-105 wanderte dabei NUR das Set samt seinen
-- Kaufpreisen — Teile, Minifiguren und Anleitungen blieben beim Absender.
--
-- Zurück blieben Zeilen, die auf ein Set zeigen, das ihr Konto nicht mehr
-- besitzt: in der Teileliste des Absenders sichtbar, aber ohne Herkunft, und
-- im Zielkonto fehlten sie ganz. Von selbst löst sich das nicht auf — die
-- Regel greift erst beim nächsten Verschieben.
--
-- ── Was passiert ────────────────────────────────────────────────────────────
-- Eine Zeile wird nur dann umgehängt, wenn ALLE drei Bedingungen gelten:
--   1. Ihr eigenes Konto besitzt das Set NICHT (mehr) — sie ist verwaist.
--   2. Genau EIN anderes Konto DESSELBEN Haushalts besitzt es.
--   3. Dieses Konto hat für dieses Set noch keine eigenen Zeilen dieser Art.
--
-- Bedingung 2 schliesst Zufallstreffer zwischen fremden Konten aus: Ohne den
-- Haushaltsbezug wäre „irgendwer besitzt dieses Set" ein Datenleck.
-- Bedingung 3 verhindert Dubletten — die Menge steckt in sets.quantity, nicht
-- in der Zahl der Zeilen; doppelte Zeilen zählte die Zusammenfassung zweimal.
--
-- Bei mehr als einem möglichen Ziel im Haushalt (beide Kinder besitzen das Set)
-- bleibt die Zeile bewusst liegen: Dann ist nicht entscheidbar, wem sie gehört,
-- und ein geratenes Ziel wäre schlimmer als ein Rest zum Nachsehen.
--
-- Manuell erfasste Teile und Minifiguren hängen an keinem Set (set_number ist
-- NULL) und sind hier ohnehin nicht betroffen.

-- ── Teile ───────────────────────────────────────────────────────────────────
WITH verwaist AS (
  SELECT p.id, p.user_id, p.set_number
    FROM parts p
   WHERE COALESCE(p.source, 'set') <> 'manual'
     AND p.set_number IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM sets s
                      WHERE s.user_id = p.user_id AND s.set_number = p.set_number)
),
haushalt AS (
  -- Alle Paare (Konto A, Konto B) desselben Haushalts, in beide Richtungen.
  SELECT main_user_id AS a, sub_user_id AS b FROM account_links
  UNION ALL
  SELECT sub_user_id  AS a, main_user_id AS b FROM account_links
  UNION ALL
  -- Geschwister: zwei Unterkonten desselben Hauptkontos.
  SELECT l1.sub_user_id, l2.sub_user_id
    FROM account_links l1 JOIN account_links l2
      ON l1.main_user_id = l2.main_user_id AND l1.sub_user_id <> l2.sub_user_id
),
ziel AS (
  SELECT v.id, MIN(s.user_id) AS neuer_besitzer, COUNT(DISTINCT s.user_id) AS kandidaten
    FROM verwaist v
    JOIN haushalt h ON h.a = v.user_id
    JOIN sets s     ON s.user_id = h.b AND s.set_number = v.set_number
   GROUP BY v.id
  HAVING COUNT(DISTINCT s.user_id) = 1
)
UPDATE parts p
   SET user_id = z.neuer_besitzer
  FROM ziel z
 WHERE p.id = z.id
   AND NOT EXISTS (SELECT 1 FROM parts q
                    WHERE q.user_id = z.neuer_besitzer
                      AND q.set_number = p.set_number
                      AND COALESCE(q.source,'set') <> 'manual');

-- ── Minifiguren ─────────────────────────────────────────────────────────────
WITH verwaist AS (
  SELECT m.id, m.user_id, m.set_number
    FROM minifigs m
   WHERE COALESCE(m.source, 'set') <> 'manual'
     AND m.set_number IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM sets s
                      WHERE s.user_id = m.user_id AND s.set_number = m.set_number)
),
haushalt AS (
  SELECT main_user_id AS a, sub_user_id AS b FROM account_links
  UNION ALL
  SELECT sub_user_id  AS a, main_user_id AS b FROM account_links
  UNION ALL
  SELECT l1.sub_user_id, l2.sub_user_id
    FROM account_links l1 JOIN account_links l2
      ON l1.main_user_id = l2.main_user_id AND l1.sub_user_id <> l2.sub_user_id
),
ziel AS (
  SELECT v.id, MIN(s.user_id) AS neuer_besitzer
    FROM verwaist v
    JOIN haushalt h ON h.a = v.user_id
    JOIN sets s     ON s.user_id = h.b AND s.set_number = v.set_number
   GROUP BY v.id
  HAVING COUNT(DISTINCT s.user_id) = 1
)
UPDATE minifigs m
   SET user_id = z.neuer_besitzer
  FROM ziel z
 WHERE m.id = z.id
   AND NOT EXISTS (SELECT 1 FROM minifigs q
                    WHERE q.user_id = z.neuer_besitzer
                      AND q.set_number = m.set_number
                      AND COALESCE(q.source,'set') <> 'manual');

-- ── Anleitungen ─────────────────────────────────────────────────────────────
WITH verwaist AS (
  SELECT i.id, i.user_id, i.set_number
    FROM instructions i
   WHERE NOT EXISTS (SELECT 1 FROM sets s
                      WHERE s.user_id = i.user_id AND s.set_number = i.set_number)
),
haushalt AS (
  SELECT main_user_id AS a, sub_user_id AS b FROM account_links
  UNION ALL
  SELECT sub_user_id  AS a, main_user_id AS b FROM account_links
  UNION ALL
  SELECT l1.sub_user_id, l2.sub_user_id
    FROM account_links l1 JOIN account_links l2
      ON l1.main_user_id = l2.main_user_id AND l1.sub_user_id <> l2.sub_user_id
),
ziel AS (
  SELECT v.id, MIN(s.user_id) AS neuer_besitzer
    FROM verwaist v
    JOIN haushalt h ON h.a = v.user_id
    JOIN sets s     ON s.user_id = h.b AND s.set_number = v.set_number
   GROUP BY v.id
  HAVING COUNT(DISTINCT s.user_id) = 1
)
UPDATE instructions i
   SET user_id = z.neuer_besitzer
  FROM ziel z
 WHERE i.id = z.id
   AND NOT EXISTS (SELECT 1 FROM instructions q
                    WHERE q.user_id = z.neuer_besitzer AND q.set_number = i.set_number
                      AND q.url = i.url);
