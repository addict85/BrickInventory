-- ── Fremdschlüssel auf users, wo sie fehlten ────────────────────────────────
--
-- Diese Tabellen entstanden in db/database.ts ohne REFERENCES users(id).
-- Wird ein Konto gelöscht, blieben ihre Zeilen stehen — bei den Erfassungen
-- samt Kaufpreisen. Erst die Waisen weg, dann die Schlüssel mit CASCADE.
--
-- parts_version_user bleibt OHNE Schlüssel: Die Zähltrigger auf parts und
-- sets schreiben dort auch beim kaskadierten Löschen eines Kontos hinein —
-- mit Schlüssel liesse sich ein Konto mit Bestand nicht mehr löschen.

DELETE FROM part_acquisitions    t WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = t.user_id);
DELETE FROM minifig_acquisitions t WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = t.user_id);
DELETE FROM csv_import_jobs      t WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = t.user_id);
DELETE FROM qr_login_tokens      t WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = t.user_id);
DELETE FROM parts_summary        t WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = t.user_id);
DELETE FROM parts_summary_state  t WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = t.user_id);

ALTER TABLE part_acquisitions    ADD CONSTRAINT part_acquisitions_user_fk    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE minifig_acquisitions ADD CONSTRAINT minifig_acquisitions_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE csv_import_jobs      ADD CONSTRAINT csv_import_jobs_user_fk      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE qr_login_tokens      ADD CONSTRAINT qr_login_tokens_user_fk      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE parts_summary        ADD CONSTRAINT parts_summary_user_fk        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE parts_summary_state  ADD CONSTRAINT parts_summary_state_user_fk  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- Das Löschen eines Kontos sucht in jeder Tabelle mit Schlüssel auf users
-- nach dem Konto; ohne Index ist das ein Tabellenscan.
CREATE INDEX IF NOT EXISTS idx_qr_login_user      ON qr_login_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_invite_main_user   ON account_link_invites (main_user_id);
CREATE INDEX IF NOT EXISTS idx_invite_used_by     ON account_link_invites (used_by);
