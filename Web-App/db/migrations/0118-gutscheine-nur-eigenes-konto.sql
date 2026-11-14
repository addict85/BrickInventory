-- Gutscheine und Idempotenzeinträge nutzt die App nur für das Konto der Anfrage; ein
-- Hauptkonto braucht weder die Gutscheinnummern noch die gemerkten Antworten seiner
-- Unterkonten. Wie die Zugangsdaten (0114) also nur das eigene Konto.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['vouchers', 'idempotenz'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS zeilenschutz ON %I', t);
    EXECUTE format('CREATE POLICY zeilenschutz ON %I
                      USING (user_id = (SELECT zeilenschutz_konto()))
                      WITH CHECK (user_id = (SELECT zeilenschutz_konto()))', t);
  END LOOP;
END $$;
