-- Versuche, die gerade geprüft werden. bcrypt braucht seine Zeit; ohne diese
-- Spalte lasen 50 gleichzeitige Fehlversuche alle denselben Zählerstand, und
-- 49 davon kamen bis zur Passwortprüfung durch statt 5.
ALTER TABLE rate_limit_attempts ADD COLUMN IF NOT EXISTS laufend      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE rate_limit_attempts ADD COLUMN IF NOT EXISTS laufend_seit TIMESTAMPTZ;
