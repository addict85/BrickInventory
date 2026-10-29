-- Die drei Schalter eines Kontos sind 0 oder 1 und nie leer. Ein NULL wird
-- so gesetzt, wie die Anmeldung es bisher las (utils/auth.ts,
-- assertLoginAllowed): gesperrt und unbestätigt ist nur, wer 0 trägt, und
-- Verwalter nur, wer etwas anderes trägt.
UPDATE users SET is_admin = 0       WHERE is_admin IS NULL;
UPDATE users SET is_active = 1      WHERE is_active IS NULL;
UPDATE users SET email_verified = 1 WHERE email_verified IS NULL;
ALTER TABLE users
  ALTER COLUMN is_admin SET DEFAULT 0,       ALTER COLUMN is_admin SET NOT NULL,
  ALTER COLUMN is_active SET DEFAULT 1,      ALTER COLUMN is_active SET NOT NULL,
  ALTER COLUMN email_verified SET DEFAULT 0, ALTER COLUMN email_verified SET NOT NULL;

ALTER TABLE users ADD CONSTRAINT users_is_admin_schalter       CHECK (is_admin IN (0, 1)) NOT VALID;
ALTER TABLE users ADD CONSTRAINT users_is_active_schalter      CHECK (is_active IN (0, 1)) NOT VALID;
ALTER TABLE users ADD CONSTRAINT users_email_verified_schalter CHECK (email_verified IN (0, 1)) NOT VALID;
DO $pruefen$
DECLARE k text;
BEGIN
  FOREACH k IN ARRAY ARRAY['users_is_admin_schalter', 'users_is_active_schalter', 'users_email_verified_schalter'] LOOP
    BEGIN
      EXECUTE format('ALTER TABLE users VALIDATE CONSTRAINT %I', k);
    EXCEPTION WHEN check_violation THEN
      RAISE WARNING '% bleibt ungeprüft: Altbestand verletzt ihn (%)', k, SQLERRM;
    END;
  END LOOP;
END $pruefen$;

-- Die Adresse ist eindeutig ohne Rücksicht auf Gross- und Kleinschreibung —
-- so prüft der Code schon (LOWER(email) in utils/konten.ts), aber die
-- Datenbank kannte nur die genaue Schreibweise. Gibt es im Altbestand zwei
-- Konten mit derselben Adresse in anderer Schreibweise, bleibt es beim alten
-- Schlüssel; die Warnung nennt die Adressen, aufzulösen ist das von Hand.
DO $email$
DECLARE doppelt text;
BEGIN
  SELECT string_agg(e, ', ') INTO doppelt FROM (
    SELECT lower(email) AS e FROM users WHERE email IS NOT NULL GROUP BY lower(email) HAVING COUNT(*) > 1) d;
  IF doppelt IS NULL THEN
    CREATE UNIQUE INDEX users_email_lower ON users (lower(email));
    ALTER TABLE users DROP CONSTRAINT users_email_key;
  ELSE
    RAISE WARNING 'users.email: Adressen mehrfach in anderer Schreibweise (%), users_email_lower nicht angelegt', doppelt;
  END IF;
END $email$;
