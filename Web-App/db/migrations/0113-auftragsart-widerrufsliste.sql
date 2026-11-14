-- Googles Widerrufsliste der Attestierungsschlüssel lädt der Job-Prozess als
-- geplanten Auftrag (src/konto/attestation/widerrufsliste.ts).
INSERT INTO auftrags_arten (art) VALUES ('widerrufsliste') ON CONFLICT DO NOTHING;
