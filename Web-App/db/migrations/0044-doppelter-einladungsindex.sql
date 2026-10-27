-- idx_invite_main_user (0043) war doppelt: idx_account_link_invites_main
-- führt main_user_id schon an erster Stelle und trägt damit auch das
-- kaskadierte Löschen. Aufgefallen im neuen Schema-Abbild db/schema-stand.sql.
DROP INDEX IF EXISTS idx_invite_main_user;
