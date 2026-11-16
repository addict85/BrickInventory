-- Wiederherstellungscodes von vor dem 01.11.2026 (50 Bit, ungesalzenes SHA-256) galten
-- unbegrenzt. Ab diesem Update gelten sie noch 90 Tage. Welche der vorhandenen Codes alter Art
-- sind, verrät der Hash nicht: Alle offenen bekommen die Frist, sie wirkt aber nur auf dem Weg für
-- alte Codes (src/faktoren/zweiterFaktor.ts). Neu erzeugte Codes tragen keine. Wiederholbar.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.zweiter_faktor_codes'::regclass
                  AND attname = 'alt_gilt_bis' AND NOT attisdropped) THEN
    ALTER TABLE zweiter_faktor_codes ADD COLUMN alt_gilt_bis timestamptz;
    UPDATE zweiter_faktor_codes SET alt_gilt_bis = now() + interval '90 days' WHERE verbraucht_am IS NULL;
  END IF;
END $$;
