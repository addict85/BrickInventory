-- Den Zeilenschutz hebt nur noch eine Rolle mit BYPASSRLS auf (die Systemrolle
-- aus postgres/app-rolle.sh), keine Einstellung der Sitzung: set_config() kann
-- jede Rolle aufrufen, auch eine eingeschleuste Abfrage der Laufzeitrolle.
-- Neu geschützt: Aufträge (ohne Konto nur für die Systemrolle) und die Zugangsdaten.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sets', 'set_acquisitions', 'parts', 'part_acquisitions', 'minifigs',
                           'minifig_acquisitions', 'wanted', 'price_alerts', 'storage_locations', 'instructions',
                           'papierkorb', 'vouchers', 'user_settings', 'parts_summary', 'parts_summary_state',
                           'parts_version_user', 'import_stand', 'bl_zuordnung_eigen', 'figur_eigen', 'teil_eigen',
                           'teil_farbe_eigen', 'idempotenz', 'auftraege', 'passkeys', 'webauthn_challenges',
                           'zweiter_faktor', 'zweiter_faktor_codes', 'api_tokens', 'api_tokens_verbraucht',
                           'qr_login_tokens', 'geraete_schluessel', 'geraete_nonces', 'schritt_challenges',
                           'schritt_freigaben'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS zeilenschutz ON %I', t);
    EXECUTE format('CREATE POLICY zeilenschutz ON %I
                      USING (user_id = ANY ((SELECT zeilenschutz_konten())::integer[]))
                      WITH CHECK (user_id = ANY ((SELECT zeilenschutz_konten())::integer[]))', t);
  END LOOP;
END $$;

DROP FUNCTION zeilenschutz_system();
