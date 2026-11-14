-- Zugangsdaten gehören allein ihrem Konto: Ein Hauptkonto darf Bestand und Käufe
-- seiner Unterkonten sehen, nie aber deren Passkeys, Codes oder Tokens; wer sie
-- liest oder anlegt, übernimmt das Unterkonto. Was über Konten hinweg arbeitet
-- (Anmeldung, Verwaltung, Aufräumen), läuft im Systemrahmen.

CREATE FUNCTION zeilenschutz_konto() RETURNS integer
  LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp
  AS $$ SELECT NULLIF(current_setting('app.konto', true), '')::integer $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['passkeys', 'webauthn_challenges', 'zweiter_faktor', 'zweiter_faktor_codes',
                           'api_tokens', 'api_tokens_verbraucht', 'qr_login_tokens', 'geraete_schluessel',
                           'geraete_nonces', 'schritt_challenges', 'schritt_freigaben'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS zeilenschutz ON %I', t);
    EXECUTE format('CREATE POLICY zeilenschutz ON %I
                      USING (user_id = (SELECT zeilenschutz_konto()))
                      WITH CHECK (user_id = (SELECT zeilenschutz_konto()))', t);
  END LOOP;
END $$;
