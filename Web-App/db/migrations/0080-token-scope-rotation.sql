-- Tokens bekommen einen Geltungsbereich, eine Herkunft und eine Rotation.
--
-- scope: 'app' kann keine Verwalterrouten aufrufen, auch nicht für ein
-- Verwalterkonto; 'voll' darf, was das Konto darf. Bestehende Tokens behalten
-- ihr Verhalten ('voll'), neue bekommen ohne Angabe das kleinere Recht.
ALTER TABLE api_tokens ADD COLUMN scope TEXT NOT NULL DEFAULT 'voll'
  CONSTRAINT api_tokens_scope_check CHECK (scope IN ('app', 'voll'));
ALTER TABLE api_tokens ALTER COLUMN scope SET DEFAULT 'app';

-- Grober Adressbereich der letzten Nutzung (IPv4 /24, IPv6 /48) für die
-- Geräteliste: genug, um ein fremdes Netz zu erkennen, ohne Adressen zu sammeln.
ALTER TABLE api_tokens ADD COLUMN ip_bereich TEXT;

-- Rotation: Der Nachfolger kennt seinen Vorgänger, bis er zum ersten Mal
-- benutzt wird; dann ist der Vorgänger weg. Der Vorgänger kennt seinen
-- Nachfolger, damit ein wiederholter Tausch den unbenutzten ersetzt.
ALTER TABLE api_tokens ADD COLUMN rotiert_am TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE api_tokens ADD COLUMN vorgaenger TEXT;
ALTER TABLE api_tokens ADD COLUMN ersetzt_durch TEXT;

-- Kein bestehender Token bleibt ohne Ablauf: „unbegrenzt“ gibt es künftig nur
-- über HTTPS und mit Rotation, und die alten Zeilen haben beides nie gehabt.
-- Eine kürzere Frist bleibt, wie sie ist.
UPDATE api_tokens
   SET expires_at = LEAST(COALESCE(expires_at, 'infinity'::timestamptz), NOW() + INTERVAL '90 days'),
       sliding = CASE WHEN expires_at IS NULL OR never_expires THEN TRUE ELSE sliding END,
       never_expires = FALSE;
