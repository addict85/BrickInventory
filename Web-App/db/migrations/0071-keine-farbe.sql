-- „Keine Farbe“ ist 9999 wie bei Rebrickable ([No Color/Any Color]); 0 ist
-- Schwarz. Bisher standen beide als 0 bzw. NULL da. Umgestellt wird nur, wo
-- die Zeile selbst beweist, dass keine Farbe gemeint war; eine 0 ohne solchen
-- Beweis bleibt Schwarz.

-- Zieht ein manuelles Teil eines Kontos von einer Farbe auf eine andere.
-- Gibt es das Ziel schon, gehen die Erfassungen dorthin (gleicher Tag,
-- Zustand, Preis und Währung werden addiert) und die alte Zeile entfällt.
CREATE FUNCTION pg_temp.farbe_umziehen(u integer, teil text, alt_zeile integer, alt_erf integer, neu integer)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE part_acquisitions z SET quantity = z.quantity + q.quantity
    FROM part_acquisitions q
   WHERE q.user_id = u AND q.part_number = teil AND q.color_id = alt_erf
     AND z.user_id = u AND z.part_number = teil AND z.color_id = neu
     AND COALESCE(z.tag, (z.created_at AT TIME ZONE 'UTC')::date) = COALESCE(q.tag, (q.created_at AT TIME ZONE 'UTC')::date)
     AND z.condition = q.condition AND COALESCE(z.unit_price, -1) = COALESCE(q.unit_price, -1)
     AND z.price_estimated = q.price_estimated AND z.currency = q.currency;
  DELETE FROM part_acquisitions q
   WHERE q.user_id = u AND q.part_number = teil AND q.color_id = alt_erf
     AND EXISTS (SELECT 1 FROM part_acquisitions z
                  WHERE z.user_id = u AND z.part_number = teil AND z.color_id = neu
                    AND COALESCE(z.tag, (z.created_at AT TIME ZONE 'UTC')::date) = COALESCE(q.tag, (q.created_at AT TIME ZONE 'UTC')::date)
                    AND z.condition = q.condition AND COALESCE(z.unit_price, -1) = COALESCE(q.unit_price, -1)
                    AND z.price_estimated = q.price_estimated AND z.currency = q.currency);
  UPDATE part_acquisitions SET color_id = neu
   WHERE user_id = u AND part_number = teil AND color_id = alt_erf;

  IF EXISTS (SELECT 1 FROM parts WHERE user_id = u AND part_number = teil AND set_number IS NULL AND color_id = neu) THEN
    UPDATE parts n SET storage_id = a.storage_id
      FROM parts a
     WHERE n.user_id = u AND n.part_number = teil AND n.set_number IS NULL AND n.color_id = neu
       AND a.user_id = u AND a.part_number = teil AND a.set_number IS NULL
       AND a.color_id IS NOT DISTINCT FROM alt_zeile AND n.storage_id IS NULL;
    DELETE FROM parts WHERE user_id = u AND part_number = teil AND set_number IS NULL
       AND color_id IS NOT DISTINCT FROM alt_zeile;
  ELSE
    UPDATE parts SET color_id = neu WHERE user_id = u AND part_number = teil AND set_number IS NULL
       AND color_id IS NOT DISTINCT FROM alt_zeile;
  END IF;
END $$;

-- Regel 1: Eine manuelle Zeile mit color_id NULL hatte nie eine Farbe; ihre
-- Erfassungen standen unter 0 (verbunden über COALESCE(color_id, 0)). Ein
-- schwarzes manuelles Teil daneben schliesst idx_parts_eindeutig aus.
SELECT pg_temp.farbe_umziehen(user_id, part_number, NULL, 0, 9999)
  FROM (SELECT DISTINCT user_id, part_number FROM parts WHERE color_id IS NULL AND set_number IS NULL) f;
-- Set-Zeilen ohne Farbe haben keine Erfassungen.
UPDATE parts SET color_id = 9999 WHERE color_id IS NULL;

-- Regel 2: Die frühere Notliste bot „[No Color/Any Color]“ unter 0 an. Hat
-- das Konto diesen Namen selbst eingetragen (farbname_von), war es seine
-- Wahl. Fremde Namen beweisen nichts — der Katalog gilt für alle Konten.
SELECT pg_temp.farbe_umziehen(p.user_id, p.part_number, 0, 0, 9999)
  FROM parts p
  JOIN part_color_catalog c ON c.part_number = p.part_number AND c.color_id = 0
 WHERE p.set_number IS NULL AND p.source = 'manual' AND p.color_id = 0
   AND c.farbname_von = p.user_id AND c.color_name LIKE '[No Color%';

-- Regel 3: Die Notliste führte weitere Farben unter falschen IDs (13 hiess
-- dort Black, ist bei Rebrickable Pink). Hat das Konto Name UND Farbcode
-- eines Eintrags selbst eingetragen, meinte es diese Farbe; sie zieht auf die
-- Rebrickable-ID gleichen Namens — nur wenn rb_colors den Namen genau einmal
-- kennt und er nicht schon an der alten ID steht.
CREATE TEMP TABLE notliste (id integer, name text, hex text) ON COMMIT DROP;
INSERT INTO notliste VALUES
  (1,'White','F4F4F4'),(2,'Tan','DEC69C'),(3,'Yellow','F2CD37'),(4,'Red','C91A09'),
  (5,'Dark Red','720E0F'),(6,'Orange','FE8A18'),(7,'Blue','0055BF'),(8,'Dark Blue','003352'),
  (9,'Light Blue','68C3E2'),(10,'Green','237841'),(11,'Dark Green','184632'),(12,'Lime','BBE90B'),
  (13,'Black','05131D'),(14,'Dark Bluish Gray','595D60'),(15,'Light Bluish Gray','9BA19D'),
  (16,'Flat Silver','898788'),(17,'Brown','583927'),(18,'Dark Brown','352100'),
  (19,'Reddish Brown','82422A'),(20,'Sand Green','A0BCAC'),(21,'Dark Tan','958A73'),
  (22,'Medium Azure','36AEBF'),(23,'Magenta','FC97AC'),(24,'Dark Purple','3F3691'),
  (25,'Medium Lavender','AC78BA'),(26,'Coral','FF698F'),(27,'Nougat','D09168'),(28,'Gold','DBAC34');

SELECT pg_temp.farbe_umziehen(p.user_id, p.part_number, p.color_id, p.color_id, z.id)
  FROM parts p
  JOIN part_color_catalog c ON c.part_number = p.part_number AND c.color_id = p.color_id
  JOIN notliste n ON n.id = p.color_id AND n.name = c.color_name AND upper(n.hex) = upper(c.color_hex)
  JOIN rb_colors z ON z.name = n.name
 WHERE p.set_number IS NULL AND p.source = 'manual'
   AND c.farbname_von = p.user_id AND c.farbcode_von = p.user_id
   AND (SELECT count(*) FROM rb_colors w WHERE w.name = n.name) = 1
   AND NOT EXISTS (SELECT 1 FROM rb_colors a WHERE a.id = p.color_id AND a.name = n.name);

-- Ab jetzt gibt es kein NULL mehr; der Eindeutigkeitsindex braucht kein COALESCE.
ALTER TABLE parts ALTER COLUMN color_id SET DEFAULT 9999, ALTER COLUMN color_id SET NOT NULL;
ALTER TABLE part_acquisitions ALTER COLUMN color_id SET DEFAULT 9999;
-- Über einen Zwischennamen: Der Index behält seinen Namen (Fehlermeldungen
-- nennen ihn), angelegt wird er aber nur in 0038.
CREATE UNIQUE INDEX idx_parts_eindeutig_neu ON parts (user_id, COALESCE(set_number, ''), part_number, color_id);
DROP INDEX IF EXISTS idx_parts_eindeutig;
ALTER INDEX idx_parts_eindeutig_neu RENAME TO idx_parts_eindeutig;

-- Eine temporäre Funktion lebt bis zum Ende der Verbindung, nicht der Transaktion.
DROP FUNCTION pg_temp.farbe_umziehen(integer, text, integer, integer, integer);
