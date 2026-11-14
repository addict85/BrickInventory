/** Die Fehlermeldungen an EINER Stelle, in beiden Sprachen: Die Route kennt
 * die Sprache des Anfragenden, der Dienst nicht. */

export type Sprache = 'de' | 'en';

// Jeder Text einmal, in beiden Sprachen.
export const FEHLER = {
  // ── Anmeldung und Konto ──────────────────────────────────────────────────
  nicht_angemeldet: { de: 'Nicht angemeldet', en: 'Not signed in' },
  auth_fehler: { de: 'Auth-Fehler', en: 'Authentication error' },
  nur_admins: { de: 'Nur für Admins', en: 'Administrators only' },
  tausch_laeuft: {
    de: 'Dieser Token wird gerade getauscht. Bitte in einer halben Minute erneut versuchen.',
    en: 'This token is being exchanged right now. Please try again in half a minute.',
  },
  token_ungueltig: { de: 'Ungültiger oder abgelaufener Token', en: 'Invalid or expired token' },
  token_id_fehlt: { de: 'Token-ID fehlt', en: 'Token ID missing' },
  token_rotation_noetig: {
    de: 'Dieser Zugang muss zuerst getauscht werden (POST /api/v1/auth/token-rotieren).',
    en: 'This access token must be rotated first (POST /api/v1/auth/token-rotieren).',
  },
  passkey_ungueltig: { de: 'Der Passkey wurde nicht angenommen.', en: 'The passkey was not accepted.' },
  passkey_ohne_domain: {
    de: 'Passkeys sind auf diesem Server nicht eingerichtet. Bitte mit Passwort anmelden.',
    en: 'Passkeys are not set up on this server. Please sign in with your password.',
  },
  unbegrenzt_nur_https: {
    de: '„Unbegrenzt“ gibt es nur, wenn der Server über HTTPS erreichbar ist (APP_BASE_URL mit https://).',
    en: '“Unlimited” is only available when the server is reached via HTTPS (APP_BASE_URL with https://).',
  },
  token_nicht_ausgestellt: {
    de: 'Anmeldung fehlgeschlagen: Token konnte nicht ausgestellt werden.',
    en: 'Sign-in failed: the token could not be issued.',
  },
  konto_deaktiviert: {
    de: 'Konto deaktiviert. Bitte Administrator kontaktieren.',
    en: 'Account deactivated. Please contact an administrator.',
  },
  email_nicht_bestaetigt: {
    de: 'E-Mail-Adresse noch nicht bestätigt. Bitte prüfe dein Postfach.',
    en: 'Email address not confirmed yet. Please check your inbox.',
  },
  zu_viele_anfragen: {
    de: 'Zu viele Anfragen — bitte in {minuten} Min. erneut versuchen',
    en: 'Too many attempts — please try again in {minuten} min',
  },
  zu_viele_fehlversuche: {
    de: 'Zu viele Fehlversuche — bitte in {minuten} Min. erneut versuchen',
    en: 'Too many failed attempts — please try again in {minuten} min',
  },
  anmeldedaten_ungueltig: { de: 'Ungültige Anmeldedaten', en: 'Invalid credentials' },
  name_oder_email_eingeben: {
    de: 'Bitte Benutzername oder E-Mail-Adresse eingeben.',
    en: 'Please enter a username or an email address.',
  },

  // ── Registrierung und Passwort ───────────────────────────────────────────
  registrierung_deaktiviert: { de: 'Registrierung ist deaktiviert.', en: 'Registration is disabled.' },
  registrierung_braucht_mail: {
    de: 'Die Registrierung braucht den E-Mail-Versand: Zuerst unter „E-Mail“ den Mailserver eintragen (und APP_BASE_URL setzen).',
    en: 'Registration needs e-mail delivery: first set up the mail server under “E-mail” (and set APP_BASE_URL).',
  },
  konto_nicht_wartend: {
    de: 'Dieses Konto wartet nicht auf Freischaltung.',
    en: 'This account is not waiting for approval.',
  },
  registrierung_felder: {
    de: 'Benutzername, E-Mail und Passwort sind erforderlich.',
    en: 'Username, email address and password are required.',
  },
  benutzername_passwort: { de: 'Benutzername und Passwort erforderlich', en: 'Username and password are required' },
  benutzername_vergeben: { de: 'Benutzername bereits vergeben', en: 'That username is already taken' },
  benutzername_oder_email_vergeben: {
    de: 'Benutzername oder E-Mail bereits vergeben.',
    en: 'That username or email address is already taken.',
  },
  email_vergeben: { de: 'E-Mail bereits vergeben', en: 'That email address is already taken' },
  benutzername_ungueltig: {
    de: 'Benutzername darf nur Buchstaben, Zahlen und _.- enthalten (3–32 Zeichen).',
    en: 'A username may contain only letters, digits and _.- (3–32 characters).',
  },
  email_ungueltig: { de: 'Ungültige E-Mail-Adresse.', en: 'Invalid email address.' },
  name_ungueltig: {
    de: 'Vor- und Nachname: höchstens 100 Zeichen, ohne Steuerzeichen und ohne Webadressen.',
    en: 'First and last name: at most 100 characters, without control characters or web addresses.',
  },
  geraetename_ungueltig: {
    de: 'Gerätename: höchstens 100 Zeichen, ohne Steuerzeichen, Anführungszeichen und Webadressen.',
    en: 'Device name: at most 100 characters, without control characters, quotes or web addresses.',
  },
  email_erforderlich: { de: 'E-Mail erforderlich.', en: 'Email address required.' },
  passwort_zu_kurz: {
    de: 'Passwort muss mindestens 12 Zeichen lang sein.',
    en: 'The password must be at least 12 characters long.',
  },
  passwort_zu_lang: {
    de: 'Das Passwort ist zu lang: höchstens 72 Byte (Umlaute und Sonderzeichen zählen doppelt).',
    en: 'The password is too long: at most 72 bytes (accented letters and symbols count double).',
  },
  passwort_zu_haeufig: {
    de: 'Dieses Passwort ist zu häufig oder aus Datenlecks bekannt. Bitte ein anderes wählen.',
    en: 'This password is too common or known from data breaches. Please choose another one.',
  },
  aktuelles_passwort_erforderlich: { de: 'Aktuelles Passwort erforderlich', en: 'Current password required' },
  passwort_ueber_change_password: {
    de: 'Das Passwort wird über „Passwort ändern" geändert.',
    en: 'Change the password via "Change password".',
  },
  fremde_herkunft: { de: 'Diese Anfrage kam nicht von dieser Seite.', en: 'This request did not come from this site.' },
  fremder_host: { de: 'Dieser Server antwortet nur unter {adresse}.', en: 'This server only answers at {adresse}.' },
  bestaetigungslink_ungueltig: {
    de: 'Der Bestätigungslink ist ungültig oder abgelaufen.',
    en: 'The confirmation link is invalid or has expired.',
  },
  app_zu_alt: {
    de: 'Diese App ist zu alt für den Server (nötig: Schnittstelle {min}) — bitte die App aktualisieren.',
    en: 'This app is too old for the server (needs interface {min}) — please update the app.',
  },
  nur_mit_sitzung: {
    de: 'Das geht nur aus einer angemeldeten Browser-Sitzung.',
    en: 'This is only possible from a signed-in browser session.',
  },
  nur_mit_app_token: {
    de: 'Das geht nur mit dem Zugang der App.',
    en: 'This is only possible with the app’s access token.',
  },
  geraeteschluessel_fehlt: {
    de: 'Dieser Schritt braucht die Gerätesperre, und dieser Zugang ist an keine gebunden. Bitte die App aktualisieren, eine Displaysperre einrichten und neu anmelden – oder den Schritt in der Webapp ausführen.',
    en: 'This step needs the device lock, and this access token is not bound to one. Please update the app, set up a screen lock and sign in again – or do this step in the web app.',
  },
  geraeteschluessel_ungueltig: {
    de: 'Der Geräteschlüssel ist ungültig (erwartet: EC P-256).',
    en: 'The device key is invalid (expected: EC P-256).',
  },
  geraeteschluessel_vorhanden: {
    de: 'Dieser Zugang ist schon an einen anderen Geräteschlüssel gebunden. Bitte neu anmelden.',
    en: 'This access token is already bound to another device key. Please sign in again.',
  },
  geraeteschluessel_frist: {
    de: 'Ein Geräteschlüssel lässt sich nur gleich nach der Anmeldung hinterlegen. Bitte neu anmelden.',
    en: 'A device key can only be registered right after signing in. Please sign in again.',
  },
  geraeteschluessel_attestation: {
    de: 'Der Server nimmt nur einen Geräteschlüssel aus der Sicherheitshardware dieser App an, und diesen konnte er nicht bestätigen. Bitte die App aktualisieren – oder den Schritt in der Webapp ausführen.',
    en: "The server only accepts a device key from this app's security hardware and could not verify this one. Please update the app – or do this step in the web app.",
  },
  schritt_freigabe_noetig: {
    de: 'Bitte diesen Schritt zuerst mit der Gerätesperre bestätigen.',
    en: 'Please confirm this step with the device lock first.',
  },
  schritt_signatur_ungueltig: {
    de: 'Die Bestätigung mit der Gerätesperre wurde nicht angenommen. Wurde ein Fingerabdruck neu eingerichtet, bitte neu anmelden.',
    en: 'The device-lock confirmation was not accepted. If a fingerprint was added recently, please sign in again.',
  },
  import_unterbrochen: {
    de: 'Der Import wurde unterbrochen — der Server wurde neu gestartet oder der Import hing. Bitte erneut starten.',
    en: 'The import was interrupted — the server restarted or the import stalled. Please start it again.',
  },
  import_zeile_unterbrochen: {
    de: 'Der Server wurde während dieses Sets neu gestartet — bitte die Menge prüfen.',
    en: 'The server restarted while importing this set — please check the quantity.',
  },
  aktuelles_passwort_falsch: { de: 'Aktuelles Passwort falsch', en: 'Current password is wrong' },
  passwort_wechsel_noetig: {
    de: 'Bitte zuerst das vorläufige Passwort ändern.',
    en: 'Please change the temporary password first.',
  },
  letzter_verwalter: {
    de: 'Das letzte Verwalterkonto kann sich nicht selbst löschen. Bitte zuerst ein anderes Konto zum Verwalter machen.',
    en: 'The last administrator account cannot delete itself. Please make another account an administrator first.',
  },
  verwalter_muss_bleiben: {
    de: 'Es muss mindestens ein aktiver Verwalter bleiben.',
    en: 'At least one active administrator must remain.',
  },
  zweiter_faktor_pflicht: {
    de: 'Verwalterkonten brauchen einen zweiten Faktor. Bitte zuerst einen Code-Generator einrichten.',
    en: 'Administrator accounts need a second factor. Please set up an authenticator app first.',
  },
  alle_felder_erforderlich: { de: 'Alle Felder erforderlich', en: 'All fields are required' },
  passwort_reset_nicht_eingerichtet: {
    de: 'Passwort-Zurücksetzen per E-Mail ist auf diesem Server nicht eingerichtet. Bitte wende dich an die Person, die ihn betreibt.',
    en: 'Password reset by email is not set up on this server. Please contact the person who runs it.',
  },
  token_passwort_erforderlich: { de: 'Token und Passwort erforderlich.', en: 'Token and password are required.' },
  eigenes_konto_passwort: {
    de: 'Für das eigene Konto bitte „Passwort ändern" benutzen.',
    en: 'For your own account please use “Change password”.',
  },
  eigene_adminrolle: {
    de: 'Eigene Admin-Rolle kann nicht entfernt werden',
    en: 'You cannot remove your own administrator role',
  },
  benutzer_nicht_gefunden: { de: 'Benutzer nicht gefunden', en: 'User not found' },
  eigenes_konto_deaktivieren: {
    de: 'Das eigene Konto lässt sich nicht deaktivieren.',
    en: 'You cannot deactivate your own account.',
  },
  bestaetigung_nicht_eingerichtet: {
    de: 'Bestätigungs-Mails sind auf diesem Server nicht eingerichtet (APP_BASE_URL fehlt). Bitte den Verwalter fragen.',
    en: 'Confirmation e-mails are not set up on this server (APP_BASE_URL is missing). Please ask the administrator.',
  },
  bestaetigung_gesendet: {
    de: 'Falls zu dieser Adresse ein unbestätigtes Konto gehört, ist ein neuer Link unterwegs.',
    en: 'If an unconfirmed account belongs to this address, a new link is on its way.',
  },
  eigener_zweiter_faktor: {
    de: 'Den eigenen zweiten Faktor unter Sicherheit mit Code abschalten.',
    en: 'Turn off your own second factor under Security, with a code.',
  },
  benutzer_nicht_gefunden_oder_eigenes: {
    de: 'Benutzer nicht gefunden oder eigener Account',
    en: 'User not found, or it is your own account',
  },

  // ── Haushalt: verknüpfte Konten ──────────────────────────────────────────
  kein_schreibrecht: { de: 'Kein Schreibrecht für dieses Konto.', en: 'No write access to this account.' },
  kein_zugriff_konto: { de: 'Kein Zugriff auf dieses Konto', en: 'No access to this account' },
  einladungscode_ungueltig: { de: 'Ungültiger Einladungscode.', en: 'Invalid invitation code.' },
  einladungen_zu_viele: {
    de: 'Es sind schon {n} Einladungen offen. Eine davon einlösen lassen oder bis zu 24 Stunden warten.',
    en: 'There are already {n} open invitations. Have one redeemed or wait up to 24 hours.',
  },
  einladungscode_abgelaufen: {
    de: 'Ungültiger oder abgelaufener Einladungscode.',
    en: 'Invalid or expired invitation code.',
  },
  konto_mit_sich_selbst: {
    de: 'Ein Konto kann sich nicht mit sich selbst verknüpfen.',
    en: 'An account cannot be linked to itself.',
  },
  konto_bereits_verknuepft: {
    de: 'Dieses Konto ist mit dem einladenden Konto bereits verknüpft.',
    en: 'This account is already linked to the inviting account.',
  },
  verknuepfung_erzeugt_kreis: {
    de: 'Das einladende Konto ist bereits ein Unterkonto dieses Kontos — gegenseitig lassen sich Konten nicht verknüpfen.',
    en: 'The inviting account is already a sub-account of this account — accounts cannot be linked both ways.',
  },
  konto_id_ungueltig: { de: 'Ungültige Konto-ID.', en: 'Invalid account ID.' },
  waehrung_ungleich: {
    de: 'Beide Konten müssen dieselbe Währung verwenden (Hauptkonto: {haupt}, dieses Konto: {unter}).',
    en: 'Both accounts must use the same currency (main account: {haupt}, this account: {unter}).',
  },
  // Die 60 steht ausgeschrieben, weil fachfehler() keine Platzhalter füllt;
  // test/lagerort-vorrat-db.test.js prüft die Grenze (60 erlaubt, 61 abgewiesen).
  lagerort_zu_lang: {
    de: 'Der Lagerort ist zu lang (höchstens 60 Zeichen).',
    en: 'Storage location is too long (at most 60 characters).',
  },
  lagerort_leer: {
    de: 'Der Lagerort braucht einen Namen.',
    en: 'A storage location needs a name.',
  },
  lagerort_doppelt: {
    de: 'Diesen Lagerort gibt es schon.',
    en: 'That storage location already exists.',
  },
  lagerort_unbekannt: {
    de: 'Diesen Lagerort gibt es nicht (mehr).',
    en: 'That storage location does not exist (any more).',
  },
  // Eine ABSAGE statt stillen Leerens: Sonst verlöre der Löschende Zuordnungen,
  // die er nicht im Blick hatte.
  lagerort_in_benutzung: {
    de: 'In diesem Lagerort liegt noch etwas — erst umräumen, dann löschen.',
    en: 'Something is still stored there — move it out before deleting.',
  },
  alarm_richtung_ungueltig: {
    de: 'Die Richtung muss „unter“ oder „über“ sein.',
    en: 'Direction must be “unter” or “ueber”.',
  },
  alarm_schwelle_ungueltig: {
    de: 'Die Schwelle muss eine Zahl grösser als null sein.',
    en: 'The threshold must be a number greater than zero.',
  },
  alarm_zustand_ungueltig: {
    de: 'Der Zustand muss „N“ (neu) oder „U“ (gebraucht) sein.',
    en: 'Condition must be “N” (new) or “U” (used).',
  },
  quelle_ziel_identisch: { de: 'Quell- und Zielkonto sind identisch.', en: 'Source and target account are the same.' },
  kaufpreise_angeben: {
    de: 'Bitte die zu verschiebenden Kaufpreise angeben (acquisition_ids).',
    en: 'Please name the purchases to move (acquisition_ids).',
  },

  // ── Sets, Teile, Minifiguren ─────────────────────────────────────────────
  set_nicht_gefunden: { de: 'Set nicht gefunden', en: 'Set not found' },
  setnummer_ungueltig: {
    de: 'Das ist keine Setnummer (Buchstaben und Ziffern, z. B. 10294).',
    en: 'That is not a set number (letters and digits, e.g. 10294).',
  },
  set_nicht_im_katalog: { de: 'Set nicht im Katalog gefunden', en: 'Set not found in the catalogue' },
  katalog_nicht_geladen: {
    de: 'Der Set-Katalog ist noch nicht geladen; Rebrickable war bisher nicht erreichbar oder der Schlüssel fehlt.',
    en: 'The set catalogue has not been loaded yet; Rebrickable was not reachable so far or the key is missing.',
  },
  set_number_erforderlich: { de: 'set_number erforderlich', en: 'set_number is required' },
  parameter_set_fehlt: { de: 'Parameter set fehlt', en: 'Parameter “set” is missing' },
  barcode_kein_set: {
    de: 'Kein Set für "{barcode}" gefunden. Bitte Setnummer manuell eingeben.',
    en: 'No set found for “{barcode}”. Please enter the set number manually.',
  },
  teil_nicht_manuell: {
    de: 'Teil nicht gefunden oder nicht manuell hinzugefügt',
    en: 'Part not found, or not added manually',
  },
  // Eine ABSAGE statt der 0 aus V.colorId(): Beim Korrigieren wäre das ein
  // stilles Löschen der Farbe mit „success".
  farbe_erforderlich: { de: 'color_id erforderlich (die neue Farbe)', en: 'color_id is required (the new colour)' },
  minifig_nicht_manuell: {
    de: 'Minifigur nicht gefunden oder nicht manuell hinzugefügt',
    en: 'Minifigure not found, or not added manually',
  },
  keine_teile: { de: 'Keine Teile', en: 'No parts' },
  zustand_n_oder_u: { de: 'N oder U erwartet', en: 'Expected N or U' },
  erfassung_felder: {
    de: 'quantity, purchase_price oder condition erforderlich',
    en: 'quantity, purchase_price or condition is required',
  },
  kein_bricklink_preis: { de: 'kein BrickLink-Preis gefunden', en: 'no BrickLink price found' },
  kein_bricklink_zugang: { de: 'Kein BrickLink-Zugang eingerichtet', en: 'No BrickLink access configured' },
  bricklink_tageslimit: { de: 'BrickLink-Tageslimit erreicht', en: 'BrickLink daily limit reached' },
  bricklink_zugang_fehlt: {
    de: 'BrickLink-API-Zugangsdaten nicht vollständig.',
    en: 'BrickLink API credentials are incomplete.',
  },

  // ── Dateien, Import, Export ──────────────────────────────────────────────
  keine_datei: { de: 'Keine Datei', en: 'No file' },
  datei_zu_gross: { de: 'Die Datei ist zu gross', en: 'The file is too large' },
  datei_typ_falsch: { de: 'Nur PDF, JPG oder PNG', en: 'PDF, JPG or PNG only' },
  upload_ungueltig: { de: 'Der Upload ist ungültig', en: 'The upload is invalid' },
  datei_inhalt_falsch: { de: 'Der Inhalt ist kein PDF, JPG oder PNG', en: 'The content is not a PDF, JPG or PNG' },
  upload_kontingent_voll: {
    de: 'Der Platz für eigene Anleitungen ({mb} MB) ist belegt — bitte erst alte löschen',
    en: 'The space for your own instructions ({mb} MB) is full — please delete old ones first',
  },
  datei_nicht_verfuegbar: { de: 'Datei nicht verfügbar', en: 'File not available' },
  json_ungueltig: { de: 'Ungültige JSON-Datei', en: 'Invalid JSON file' },
  anfrage_json_ungueltig: { de: 'Die Anfrage ist kein gültiges JSON', en: 'The request body is not valid JSON' },
  anfrage_zu_gross: { de: 'Die Anfrage ist zu gross', en: 'The request is too large' },
  anfrage_unlesbar: { de: 'Die Anfrage ist nicht lesbar', en: 'The request cannot be read' },
  anfrage_ungueltig: { de: 'Die Anfrage ist ungültig', en: 'The request is invalid' },
  anfrage_zu_langsam: { de: 'Die Anfrage kam zu langsam an', en: 'The request arrived too slowly' },
  interner_fehler: {
    de: 'Interner Fehler — Einzelheiten stehen im Protokoll.',
    en: 'Internal error — see the server log for details.',
  },
  csv_parse_fehler: { de: 'CSV Parse Fehler: {grund}', en: 'CSV parse error: {grund}' },
  csv_keine_datenzeilen: { de: 'Keine Datenzeilen in der Datei', en: 'The file has no data rows' },
  csv_keine_brauchbare_zeile: {
    de: 'Keine brauchbare Zeile gefunden — übersprungen: Zeile {zeilen}',
    en: 'No usable row found — skipped: row {zeilen}',
  },
  csv_uebersprungen: {
    de: '{anzahl} Zeile(n) übersprungen (Zeile {zeilen})',
    en: '{anzahl} row(s) skipped (row {zeilen})',
  },
  csv_menge_ungueltig: { de: 'Menge „{wert}“ ungültig', en: 'Quantity "{wert}" is invalid' },
  csv_keine_setnummer: { de: 'keine Setnummer', en: 'no set number' },
  import_zeitueberschreitung: { de: 'Zeitüberschreitung', en: 'Timed out' },
  import_kontingent: { de: 'Abruflimit erreicht', en: 'Rate limit reached' },
  feld_erforderlich: { de: '{feld} erforderlich', en: '{feld} is required' },
  feld_nummer_ungueltig: {
    de: '{feld} darf nur Buchstaben, Zahlen und . _ - / enthalten (max. 64 Zeichen)',
    en: '{feld} may only contain letters, digits and . _ - / (at most 64 characters)',
  },
  bild_url_zu_lang: { de: 'image_url ist zu lang', en: 'image_url is too long' },
  bild_url_ungueltig: { de: 'image_url ist keine gültige URL', en: 'image_url is not a valid URL' },
  bild_url_nicht_https: { de: 'image_url muss https sein', en: 'image_url must use https' },
  feld_negativ: { de: '{feld} darf nicht negativ sein', en: '{feld} must not be negative' },
  feld_zu_hoch: { de: '{feld} ist unplausibel hoch', en: '{feld} is implausibly high' },
  feld_kein_wahrheitswert: { de: '{feld} muss true oder false sein', en: '{feld} must be true or false' },
  kein_import_laeuft: { de: 'Kein Import läuft', en: 'No import is running' },

  // ── PDF-Aufträge ─────────────────────────────────────────────────────────
  pdf_nicht_fertig: { de: 'PDF noch nicht fertig', en: 'The PDF is not ready yet' },
  pdf_nicht_verfuegbar: { de: 'PDF nicht mehr verfügbar', en: 'The PDF is no longer available' },
  pdf_auftrag_laeuft: {
    de: 'Es {laufenVerb} bereits {anzahl} PDF-{auftragWort}. Bitte warten, bis er fertig ist.',
    en: 'There {laufenVerb} already {anzahl} PDF {auftragWort}. Please wait until it is done.',
  },
  job_id_ungueltig: { de: 'Ungültige Job-ID', en: 'Invalid job ID' },
  job_nicht_gefunden: { de: 'Job nicht gefunden oder abgelaufen', en: 'Job not found, or it has expired' },
  zugang_beendet: {
    de: 'Der Zugang wurde beendet (abgemeldet oder widerrufen).',
    en: 'Access has ended (signed out or revoked).',
  },
  unbekannter_job: { de: 'Unbekannter Job', en: 'Unknown job' },
  auftrag_nicht_aenderbar: {
    de: 'Diesen Auftrag gibt es nicht oder er ist schon beendet',
    en: 'This job does not exist or has already finished',
  },

  // ── Gutscheine ───────────────────────────────────────────────────────────
  // `gutschein_existiert` sieht der Nutzer auch bei richtiger Eingabe; der Text
  // sagt deshalb WARUM.
  nummer_ungueltig: {
    de: 'Ungültige Gutscheinnummer (nur Ziffern, 4–25 Stellen)',
    en: 'Invalid voucher number (digits only, 4–25 characters)',
  },
  pin_ungueltig: { de: 'Ungültiger PIN (nur Ziffern, 3–10 Stellen)', en: 'Invalid PIN (digits only, 3–10 characters)' },
  betrag_ungueltig: { de: 'Ungültiger Betrag', en: 'Invalid amount' },
  waehrung_ungueltig: { de: 'Ungültige Währung', en: 'Invalid currency' },
  waehrung_geteiltes_unterkonto: {
    de: 'Ein Unterkonto gehört auch zu einem anderen Haushalt mit anderer Währung. Erst die Verknüpfung lösen, dann die Währung ändern.',
    en: 'A sub-account also belongs to another household with a different currency. Unlink it first, then change the currency.',
  },
  waehrung_nur_hauptkonto: {
    de: 'Die Währung gilt für den ganzen Haushalt; ändern kann sie nur das Hauptkonto.',
    en: 'The currency applies to the whole household; only the main account can change it.',
  },
  gutschein_existiert: { de: 'Diesen Gutschein gibt es bereits.', en: 'This voucher already exists.' },
  nur_pdf: { de: 'Nur PDF-Dateien', en: 'PDF files only' },
  pdf_zu_viele_seiten: {
    de: 'Das PDF hat {seiten} Seiten, höchstens {max} sind möglich. Bitte in kleinere Dateien teilen.',
    en: 'The PDF has {seiten} pages; at most {max} are possible. Please split it into smaller files.',
  },
  upload_laeuft: {
    de: 'Für dieses Konto läuft schon ein Upload dieser Art — bitte warten, bis er fertig ist.',
    en: 'An upload of this kind is already running for this account — please wait until it has finished.',
  },

  // ── Einrichtung ──────────────────────────────────────────────────────────
  quelle_unbekannt: { de: 'Unbekannte Quelle', en: 'Unknown source' },
  quelle_test_fehlgeschlagen: { de: 'Verbindung fehlgeschlagen: {grund}', en: 'Connection failed: {grund}' },
  quelle_ohne_schluessel: {
    de: 'Für {quelle} ist noch kein Zugang gespeichert. Bitte eintragen und erneut prüfen.',
    en: 'No access for {quelle} is saved yet. Please enter it and check again.',
  },
  quelle_nicht_erreichbar: {
    de: '{quelle} ist nicht erreichbar. Bitte die Internetverbindung des Servers prüfen.',
    en: '{quelle} cannot be reached. Please check the server’s internet connection.',
  },
  quelle_abgelehnt: {
    de: '{quelle} hat den Zugang abgelehnt. Bitte die eingetragenen Werte prüfen.',
    en: '{quelle} rejected the access. Please check the values you entered.',
  },

  // ── Zweiter Faktor ───────────────────────────────────────────────────────
  zweiter_faktor_noetig: {
    de: 'Bitte den Code aus der Authenticator-App eingeben.',
    en: 'Please enter the code from your authenticator app.',
  },
  zweiter_faktor_falsch: {
    de: 'Der Code stimmt nicht oder wurde schon benutzt.',
    en: 'The code is wrong or has already been used.',
  },
  zweiter_faktor_gesperrt: {
    de: 'Zu viele falsche Codes für dieses Konto. Bis zu 24 Stunden geht die Anmeldung nur mit einem Wiederherstellungscode oder einem Passkey.',
    en: 'Too many wrong codes for this account. For up to 24 hours, sign-in only works with a recovery code or a passkey.',
  },
  zweiter_faktor_schon_aktiv: {
    de: 'Der zweite Faktor ist bereits eingerichtet.',
    en: 'Two-factor authentication is already set up.',
  },
  zweiter_faktor_nicht_aktiv: {
    de: 'Der zweite Faktor ist nicht eingerichtet.',
    en: 'Two-factor authentication is not set up.',
  },

  // ── Papierkorb ───────────────────────────────────────────────────────────
  papierkorb_schon_vorhanden: {
    de: 'Wurde inzwischen neu angelegt — erst den neuen Eintrag löschen, dann wiederherstellen.',
    en: 'Has been added again since — delete the new entry first, then restore.',
  },

  // `keine_gutscheine` ist eine Auskunft: lieber das lesen als ein leeres PDF.
  keine_gutscheine: { de: 'Es sind keine Gutscheine erfasst.', en: 'No vouchers have been added.' },
  pdf_freigabe_noetig: {
    de: 'Das PDF braucht eine frische Bestätigung mit dem Passwort.',
    en: 'The PDF needs a fresh confirmation with your password.',
  },
  // Getrennt von `gutschein_unvollstaendig`: Dort war es ein PDF ohne Werte —
  // der Nutzer tut jeweils Verschiedenes.
  pdf_unlesbar: { de: 'Die Datei liess sich nicht als PDF lesen.', en: 'The file could not be read as a PDF.' },
  // Der Text sagt, was zu tun ist — sonst sucht der Nutzer den Fehler bei sich.
  kein_gutschein_im_pdf: {
    de: 'In diesem PDF war kein Gutschein zu erkennen. ' + 'Bitte den Gutschein von Hand erfassen.',
    en: 'No voucher could be recognised in this PDF. ' + 'Please add the voucher manually.',
  },

  // ── Guthaben-Abfrage bei LEGO ────────────────────────────────────────────
  // Vier Codes, weil der Nutzer bei jedem etwas anderes tut.
  guthaben_pin_fehlt: {
    de: 'Für die Abfrage braucht es die PIN der Karte.',
    en: 'The card PIN is required for the balance query.',
  },
  // {sek} statt fester Zahl: Zwei Zahlen für eine Regel laufen auseinander.
  guthaben_abstand: {
    de: 'Es wird höchstens eine Karte alle {sek} Sekunden ' + 'abgefragt. Bitte noch {warten} Sekunden warten.',
    en: 'At most one card is queried every {sek} seconds. ' + 'Please wait another {warten} seconds.',
  },
  // Sagt, dass es nicht an der Karte liegt und wie lange die Abfrage ruht —
  // sonst drückt der Nutzer weiter.
  guthaben_botschutz: {
    de: 'LEGO hat die Abfrage abgewiesen (Bot-Schutz). ' + 'Die Abfrage ruht noch {min} Minuten.',
    en: 'LEGO rejected the query (bot protection). ' + 'The query is paused for another {min} minutes.',
  },
  // {grund} läuft vorher durch verdecke(): keine Kartennummer und PIN darin.
  guthaben_fehlgeschlagen: {
    de: 'Das Guthaben liess sich nicht abfragen: {grund}',
    en: 'The balance could not be queried: {grund}',
  },
  // Aus dem Land wird eine Adresse gebaut; was nicht auf der Liste steht, wird
  // nicht gefragt.
  guthaben_land_ungueltig: {
    de: 'Das eingestellte Ausgabeland ist unbekannt. ' + 'Bitte unter Menü → Gutscheine wählen.',
    en: 'The configured card country is unknown. ' + 'Please choose one under Menu → Vouchers.',
  },

  // ── BrickLink-Wanted-Liste ───────────────────────────────────────────────
  // „keine Wanted-Liste" ist eine andere Auskunft als „0 Posten". Unlesbare
  // Korrekturen sind eine ABSAGE: Wer sie gemacht hat, merkte ihr Fehlen sonst
  // erst an den Karten.
  korrekturen_ungueltig: {
    de: 'Die Korrekturen sind nicht lesbar (kein gültiges JSON-Array).',
    en: 'The corrections could not be read (not a valid JSON array).',
  },
  keine_wanted_liste: {
    de: 'Das ist keine BrickLink-Wanted-Liste ' + '(kein <INVENTORY> in der Datei).',
    en: 'This is not a BrickLink wanted list ' + '(no <INVENTORY> in the file).',
  },
  id_ungueltig: { de: 'Ungültige ID', en: 'Invalid ID' },
  eingabe_ungueltig: { de: 'Ungültige Eingabe im Feld „{feld}“', en: 'Invalid input in field “{feld}”' },
  feld_unbekannt: { de: 'Unbekanntes Feld „{feld}“', en: 'Unknown field “{feld}”' },

  // ── Betrieb und Verwaltung ───────────────────────────────────────────────
  nicht_gefunden: { de: 'Nicht gefunden', en: 'Not found' },
  kaufpreis_nicht_gefunden: { de: 'Kaufpreis nicht gefunden', en: 'Purchase not found' },
  datum_ungueltig: { de: 'Ungültiges Datum', en: 'Invalid date' },
  erfassung_nicht_gefunden: { de: 'Erfassung nicht gefunden', en: 'Entry not found' },
  datum_belegt: {
    de: 'An diesem Datum gibt es schon einen Eintrag mit demselben Zustand und Preis.',
    en: 'An entry with the same condition and price already exists for that date.',
  },
  server_ausgelastet: { de: 'Server ausgelastet', en: 'The server is busy' },
  datenbank_nicht_erreichbar: { de: 'Datenbank nicht erreichbar', en: 'Database unreachable' },
  import_abgebrochen: { de: 'Der Import wurde abgebrochen.', en: 'The import was cancelled.' },
  import_fehlgeschlagen: {
    de: 'Der Import ist gescheitert — Einzelheiten stehen im Protokoll.',
    en: 'The import failed — see the server log for details.',
  },
  import_laeuft_noch: {
    de: 'Der Import läuft im Hintergrund weiter; den Stand zeigt der Balken.',
    en: 'The import continues in the background; the progress bar shows its state.',
  },
  idempotenz_schluessel_ungueltig: {
    de: 'Idempotency-Key: 1 bis 100 Zeichen aus A–Z, a–z, 0–9, . _ : -',
    en: 'Idempotency-Key: 1 to 100 characters from A–Z, a–z, 0–9, . _ : -',
  },
  idempotenz_schluessel_anders: {
    de: 'Dieser Idempotency-Key gehört zu einer anderen Anfrage.',
    en: 'This Idempotency-Key belongs to a different request.',
  },
  idempotenz_laeuft: {
    de: 'Die Anfrage mit diesem Idempotency-Key läuft noch.',
    en: 'The request with this Idempotency-Key is still running.',
  },
  idempotenz_nicht_wiederholbar: {
    de: 'Diese Änderung wurde schon einmal gesendet; ihr Ergebnis wird aus Sicherheitsgründen nicht wiederholt. Bitte den Stand prüfen und sie bei Bedarf neu ausführen.',
    en: 'This change was already sent; for security its result is not repeated. Please check the current state and run it again if needed.',
  },
  zu_viele_verbindungen: { de: 'Zu viele offene Verbindungen', en: 'Too many open connections' },
  zeitlimit: { de: 'Zeitlimit überschritten', en: 'Timed out' },
  wert_ungueltig: { de: 'Ungültiger Wert', en: 'Invalid value' },
  schon_vorhanden: { de: 'Dieser Eintrag ist schon vorhanden.', en: 'This entry already exists.' },
  bezug_fehlt: {
    de: 'Der Eintrag, auf den sich das bezieht, fehlt oder wird noch gebraucht.',
    en: 'The entry this refers to is missing or still in use.',
  },
  uhrzeit_ungueltig: { de: 'Ungültige Uhrzeit (HH:MM)', en: 'Invalid time (HH:MM)' },
  design_ungueltig: { de: 'Ungültiges Design', en: 'Invalid theme' },
  tageslimit_bereich: {
    de: 'Tageslimit muss zwischen 1 und 100000 liegen',
    en: 'The daily limit must be between 1 and 100000',
  },
  unbekannte_aufgabe: { de: 'Unbekannte Aufgabe: {aufgabe}', en: 'Unknown task: {aufgabe}' },
  smtp_nicht_konfiguriert: {
    de: 'SMTP nicht konfiguriert (Host oder Benutzername fehlt)',
    en: 'SMTP is not configured (host or username missing)',
  },
  smtp_zertifikat: {
    de: 'Zertifikat des Mailservers nicht bestätigt ({grund}). Unter Menü → Einstellungen → E-Mail das Zertifikat (PEM) oder seinen SHA-256-Fingerabdruck eintragen.',
    en: 'Mail server certificate not confirmed ({grund}). Enter the certificate (PEM) or its SHA-256 fingerprint under Settings → Email.',
  },
  smtp_fehler: { de: 'SMTP-Verbindung fehlgeschlagen: {grund}', en: 'SMTP connection failed: {grund}' },
  keine_ziel_email: {
    de: 'Keine Ziel-E-Mail-Adresse angegeben. Bitte eine E-Mail-Adresse eingeben.',
    en: 'No target email address given. Please enter one.',
  },
  url_ungueltig: { de: 'Ungültige URL', en: 'Invalid URL' },
  url_fehlt_https: { de: 'url fehlt oder ist kein https', en: 'url is missing or is not https' },
  host_nicht_erlaubt: { de: 'Host nicht erlaubt: {host}', en: 'Host not allowed: {host}' },
  qr_ohne_basis_url: {
    de:
      'Der Server kennt seine eigene Adresse nicht: APP_BASE_URL ist nicht gesetzt. ' +
      'Ohne sie truege der QR-Code die Adresse aus der Browserzeile — und die App ' +
      'faende den Server ausserhalb des Heimnetzes nie wieder. Bitte APP_BASE_URL setzen.',
    en:
      'The server does not know its own address: APP_BASE_URL is not set. Without it ' +
      'the QR code would carry the address from the browser bar, and the app would ' +
      'never find the server again outside the home network. Please set APP_BASE_URL.',
  },
  qr_abgelehnt: {
    de: 'Die Kopplung wurde im Browser abgelehnt. Bitte einen neuen QR-Code erzeugen.',
    en: 'Pairing was declined in the browser. Please create a new QR code.',
  },
  qr_code_falsch: {
    de: 'Der Code stimmt nicht. Bitte den Code eingeben, den die App zeigt.',
    en: 'The code does not match. Please enter the code shown in the app.',
  },
  qr_nicht_wartend: {
    de: 'Kein Gerät wartet auf diese Kopplung, oder sie ist abgelaufen.',
    en: 'No device is waiting for this pairing, or it has expired.',
  },
} as const;

export type FehlerCode = keyof typeof FEHLER;

// Aus Accept-Language; ohne Treffer Deutsch.
export function antwortSprache(req: { headers?: Record<string, unknown> } | undefined): Sprache {
  const roh = String(req?.headers?.['accept-language'] || '').toLowerCase();
  return roh.startsWith('en') || roh.includes(',en') ? 'en' : 'de';
}

/** Was schiefging, fachlich gesagt. Welcher HTTP-Status dazu gehört, weiss nur
 * src/http/fehlerArt.ts: Dienste laufen auch im Job-Prozess und in Skripten. */
export type FehlerArt =
  | 'ungueltig'
  | 'nicht_angemeldet'
  | 'verboten'
  | 'nicht_gefunden'
  | 'konflikt'
  | 'zu_gross'
  | 'falscher_typ'
  | 'zu_viele'
  | 'intern'
  | 'fremddienst'
  | 'nicht_verfuegbar'
  | 'zeitueberschreitung';

/** Art und Code reisen mit, der Satz entsteht erst in der Antwort in der
 * Sprache des Anfragenden. */
export class Fachfehler extends Error {
  constructor(
    readonly art: FehlerArt,
    readonly code: FehlerCode,
    readonly vars?: Record<string, string | number>,
  ) {
    super(fehlerText(code, 'de', vars));
    this.name = 'Fachfehler';
  }
}

/** Ein eigener Satz ohne Code: handleRouteError zeigt ihn, den Text einer
 * Bibliothek dagegen nicht. */
export class Meldung extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'Meldung';
  }
}

/** Zwei gleichzeitige Anlagen (23505) sind eine Nutzereingabe, kein
 * Serverfehler; alles andere geht unverändert weiter. */
export function alsDoppelt(code: FehlerCode): (e: unknown) => never {
  return (e: unknown) => {
    if ((e as { code?: unknown } | null)?.code === '23505') throw new Fachfehler('konflikt', code);
    throw e;
  };
}

/** Wie alsDoppelt, aber mit einem Ergebnis statt einer Absage: Ein gleichzeitiger
 * Gewinner ist dort ein Ausgang des Ablaufs, kein Fehler. */
export function doppeltAls<T>(wert: T): (e: unknown) => T {
  return (e: unknown) => {
    if ((e as { code?: unknown } | null)?.code === '23505') return wert;
    throw e;
  };
}

/** Bricht den Dienst mit einem Grund ab, den die Route dem Anfragenden nennt. */
export function fachfehler(art: FehlerArt, code: FehlerCode, vars?: Record<string, string | number>): never {
  throw new Fachfehler(art, code, vars);
}

/** Für Rückrufe wie multers fileFilter, die einen Fehler übergeben statt ihn zu werfen. */
export function dateiFehler(art: FehlerArt, code: FehlerCode, vars?: Record<string, string | number>): Error {
  return new Fachfehler(art, code, vars);
}

export function fehlerText(code: FehlerCode, sprache: Sprache = 'de', vars?: Record<string, string | number>): string {
  const eintrag = FEHLER[code];
  // Eine Fehlermeldung darf selbst nicht abstürzen: Ein fehlender Eintrag geht
  // als Code im Klartext durch und nennt dem Protokoll, was fehlt.
  if (!eintrag) {
    console.error(`[fehlerTexte] Unbekannter Fehlercode: ${String(code)}`);
    return String(code);
  }
  let text: string = eintrag[sprache] || eintrag.de;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) text = text.split(`{${k}}`).join(String(v));
  }
  return text;
}
