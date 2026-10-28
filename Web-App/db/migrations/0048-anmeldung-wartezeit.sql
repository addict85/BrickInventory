-- Zeitpunkt des letzten Fehlversuchs: Die Anmeldesperre je Konto wartet seit
-- dieser Fassung exponentiell ab dem letzten Fehlversuch, statt nach 20
-- Versuchen für 15 Minuten fest zu sperren.
ALTER TABLE rate_limit_attempts ADD COLUMN IF NOT EXISTS last_at TIMESTAMPTZ;
