-- Die Warteschlange des Bild-Jobs wird alle 20 Sekunden nach den ÄLTESTEN
-- Einträgen durchsucht:
--
--   SELECT url FROM image_wanted ORDER BY requested_at ASC LIMIT 10
--
-- Solange dort ein paar Dutzend Zeilen standen, war das gleichgültig. Mit dem
-- Knopf „Katalogbilder holen" stehen rund 25 000 darin, und ohne Index bedeutet
-- jeder Lauf einen vollständigen Durchgang samt Sortierung — auf schwacher
-- Hardware dreimal je Minute.
CREATE INDEX IF NOT EXISTS idx_image_wanted_alter ON image_wanted (requested_at);
