-- Eine offene Registrierung legt ihre Adresse wie eine Profiländerung nur als
-- ausstehend ab: Vergeben wird sie erst mit der ersten Bestätigung. Ein
-- abgelaufener Link bleibt abgelaufen; der Aufräumlauf löscht die Zeile später.
UPDATE users
   SET email_neu = email, email_neu_token = verification_token, email_neu_bis = token_expires,
       email = NULL, verification_token = NULL, token_expires = NULL
 WHERE registrierung_offen AND NOT email_verified AND email IS NOT NULL;
