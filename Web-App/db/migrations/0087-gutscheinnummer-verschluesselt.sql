-- Die Gutscheinnummer liegt ab jetzt verschlüsselt (Präfix v1:) wie die PIN:
-- Bei vielen Anbietern löst die Nummer allein den Gutschein ein. Den Schlüssel
-- kennt nur die App; sie schlüsselt den Altbestand vor der ersten Anfrage um
-- (startup/datenbank.ts). Doppelte erkennt der HMAC in nummer_suche.
ALTER TABLE vouchers ADD COLUMN nummer_suche text;
ALTER TABLE vouchers DROP CONSTRAINT vouchers_user_id_number_key;
ALTER TABLE vouchers ADD CONSTRAINT vouchers_user_id_nummer_suche_key UNIQUE (user_id, nummer_suche);
-- NOT VALID: Der Altbestand ist hier noch Klartext; jede neue und jede
-- geänderte Zeile muss schon verschlüsselt sein.
ALTER TABLE vouchers ADD CONSTRAINT vouchers_nummer_verschluesselt
  CHECK (number LIKE 'v1:%' AND nummer_suche IS NOT NULL) NOT VALID;
