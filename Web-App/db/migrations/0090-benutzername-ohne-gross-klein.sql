-- Die Anmeldung sucht den Namen ohne Rücksicht auf Gross- und Kleinschreibung;
-- „Marco" und „marco" wären zwei Konten hinter derselben Eingabe. Bestehende
-- Doppel löst diese Migration nicht still auf: Sie bricht mit den Namen ab,
-- der Verwalter benennt eines der Konten um (UPGRADE.md).
DO $name$
DECLARE doppelt text;
BEGIN
  SELECT string_agg(n, ', ') INTO doppelt FROM (
    SELECT string_agg(username, ' / ' ORDER BY id) AS n FROM users
     GROUP BY lower(username) HAVING COUNT(*) > 1) d;
  IF doppelt IS NOT NULL THEN
    RAISE EXCEPTION 'Benutzernamen unterscheiden sich nur in Gross-/Kleinschreibung: %. Eines je Paar umbenennen (UPDATE users SET username = ... WHERE id = ...), dann neu starten — siehe UPGRADE.md.', doppelt;
  END IF;
END $name$;

CREATE UNIQUE INDEX users_username_lower ON users (lower(username));
