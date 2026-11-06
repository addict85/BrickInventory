-- Eine Registrierung, deren Adresse nie bestätigt wurde, belegt Name und Adresse
-- auf Dauer. Die Marke trennt sie von Konten, die nur eine neue Adresse noch
-- nicht bestätigt haben; der Aufräumlauf löscht nach einer Frist nur markierte.
ALTER TABLE users ADD COLUMN registrierung_offen boolean NOT NULL DEFAULT false;

-- Bestehende offene Registrierungen: nie bestätigt, ohne Verwalterrecht und
-- ohne Bestand, Gutschein oder Zugang. Alles andere bleibt unangetastet.
UPDATE users u SET registrierung_offen = true
 WHERE NOT u.email_verified AND NOT u.is_admin
   AND u.email IS NOT NULL AND u.verification_token IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sets s WHERE s.user_id = u.id)
   AND NOT EXISTS (SELECT 1 FROM parts p WHERE p.user_id = u.id)
   AND NOT EXISTS (SELECT 1 FROM minifigs m WHERE m.user_id = u.id)
   AND NOT EXISTS (SELECT 1 FROM vouchers v WHERE v.user_id = u.id)
   AND NOT EXISTS (SELECT 1 FROM api_tokens t WHERE t.user_id = u.id);
