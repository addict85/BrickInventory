-- Eine neue Adresse gilt erst, wenn ihr Inhaber den Link an sie geöffnet hat.
-- Bis dahin steht sie hier, belegt nichts, und die alte bleibt in email.
ALTER TABLE users ADD COLUMN email_neu text,
                  ADD COLUMN email_neu_token text,
                  ADD COLUMN email_neu_bis timestamp with time zone;

-- Eine unbestätigte Adresse ohne offene Registrierung stammt aus einer
-- Profiländerung, die sie sofort übernahm, und sperrte womöglich eine fremde.
-- Sie wird zur ausstehenden; ein noch gültiger Link gilt weiter. Ohne gültigen
-- Link bleibt email_neu_bis leer: Daran meldet der Start diese Konten.
UPDATE users
   SET email_neu = email,
       email_neu_token = CASE WHEN token_expires > NOW() THEN verification_token END,
       email_neu_bis = CASE WHEN token_expires > NOW() THEN token_expires END,
       email = NULL, verification_token = NULL, token_expires = NULL
 WHERE email IS NOT NULL AND NOT email_verified AND NOT registrierung_offen;
