/** The error messages in ONE place, in both languages: the route knows
 * the requester's language, the service does not. */

export type Language = 'de' | 'en';

// Every text once, in both languages.
export const ERRORS = {
  // ── Login and account ────────────────────────────────────────────────────
  not_signed_in: { de: 'Nicht angemeldet', en: 'Not signed in' },
  auth_error: { de: 'Auth-Fehler', en: 'Authentication error' },
  admins_only: { de: 'Nur für Administratoren', en: 'Administrators only' },
  token_swap_running: {
    de: 'Dieser Token wird gerade getauscht. Bitte in einer halben Minute erneut versuchen.',
    en: 'This token is being exchanged right now. Please try again in half a minute.',
  },
  token_invalid: { de: 'Ungültiger oder abgelaufener Token', en: 'Invalid or expired token' },
  token_id_missing: { de: 'Token-ID fehlt', en: 'Token ID missing' },
  token_rotation_required: {
    de: 'Dieser Zugang muss zuerst getauscht werden (POST /api/v1/auth/token-rotieren).',
    en: 'This access token must be rotated first (POST /api/v1/auth/token-rotieren).',
  },
  passkey_invalid: { de: 'Der Passkey wurde nicht angenommen.', en: 'The passkey was not accepted.' },
  cancel_link_invalid: {
    de: 'Der Link ist ungültig, schon benutzt, oder die Änderung ist schon wirksam.',
    en: 'The link is invalid, already used, or the change has already taken effect.',
  },
  approval_link_invalid: {
    de: 'Der Freigabelink ist ungültig, abgelaufen oder schon benutzt.',
    en: 'The approval link is invalid, expired or already used.',
  },
  passkey_without_domain: {
    de: 'Passkeys sind auf diesem Server nicht eingerichtet. Bitte mit Passwort anmelden.',
    en: 'Passkeys are not set up on this server. Please sign in with your password.',
  },
  unlimited_https_only: {
    de: '„Unbegrenzt“ gibt es nur, wenn der Server über HTTPS erreichbar ist (APP_BASE_URL mit https://).',
    en: '“Unlimited” is only available when the server is reached via HTTPS (APP_BASE_URL with https://).',
  },
  token_not_issued: {
    de: 'Anmeldung fehlgeschlagen: Token konnte nicht ausgestellt werden.',
    en: 'Sign-in failed: the token could not be issued.',
  },
  account_deactivated: {
    de: 'Konto deaktiviert. Bitte einen Administrator kontaktieren.',
    en: 'Account deactivated. Please contact an administrator.',
  },
  email_not_confirmed: {
    de: 'E-Mail-Adresse noch nicht bestätigt. Bitte prüfe dein Postfach.',
    en: 'Email address not confirmed yet. Please check your inbox.',
  },
  too_many_requests: {
    de: 'Zu viele Anfragen — bitte in {minutes} Min. erneut versuchen',
    en: 'Too many attempts — please try again in {minutes} min',
  },
  too_many_failed_attempts: {
    de: 'Zu viele Fehlversuche — bitte in {minutes} Min. erneut versuchen',
    en: 'Too many failed attempts — please try again in {minutes} min',
  },
  account_daily_limit: {
    de: 'Zu viele Fehlversuche für dieses Konto in 24 Stunden. Anmelden geht jetzt nur mit Passwort und Code des zweiten Faktors, mit Passkey, nach „Passwort vergessen“ oder über den Link „Anmeldung freigeben“, den das Konto per Mail bekommt.',
    en: 'Too many failed attempts for this account in 24 hours. Sign-in now works only with password and second-factor code, with a passkey, after “Forgot password” or via the “Allow this sign-in” link the account receives by email.',
  },
  credentials_invalid: { de: 'Ungültige Anmeldedaten', en: 'Invalid credentials' },
  enter_name_or_email: {
    de: 'Bitte Benutzername oder E-Mail-Adresse eingeben.',
    en: 'Please enter a username or an email address.',
  },

  // ── Registration and password ────────────────────────────────────────────
  registration_disabled: { de: 'Registrierung ist deaktiviert.', en: 'Registration is disabled.' },
  registration_needs_mail: {
    de: 'Die Registrierung braucht den E-Mail-Versand: Zuerst unter „E-Mail“ den Mailserver eintragen (und APP_BASE_URL setzen).',
    en: 'Registration needs e-mail delivery: first set up the mail server under “E-mail” (and set APP_BASE_URL).',
  },
  account_not_pending: {
    de: 'Dieses Konto wartet nicht auf Freischaltung.',
    en: 'This account is not waiting for approval.',
  },
  registration_fields: {
    de: 'Benutzername, E-Mail und Passwort sind erforderlich.',
    en: 'Username, email address and password are required.',
  },
  username_password: { de: 'Benutzername und Passwort erforderlich', en: 'Username and password are required' },
  username_taken: { de: 'Benutzername bereits vergeben', en: 'That username is already taken' },
  username_or_email_taken: {
    de: 'Benutzername oder E-Mail bereits vergeben.',
    en: 'That username or email address is already taken.',
  },
  email_taken: { de: 'E-Mail bereits vergeben', en: 'That email address is already taken' },
  username_invalid: {
    de: 'Benutzername darf nur Buchstaben, Zahlen und _.- enthalten (3–32 Zeichen).',
    en: 'A username may contain only letters, digits and _.- (3–32 characters).',
  },
  email_invalid: { de: 'Ungültige E-Mail-Adresse.', en: 'Invalid email address.' },
  name_invalid: {
    de: 'Vor- und Nachname: höchstens 100 Zeichen, ohne Steuerzeichen und ohne Webadressen.',
    en: 'First and last name: at most 100 characters, without control characters or web addresses.',
  },
  device_name_invalid: {
    de: 'Gerätename: höchstens 100 Zeichen, ohne Steuerzeichen, Anführungszeichen und Webadressen.',
    en: 'Device name: at most 100 characters, without control characters, quotes or web addresses.',
  },
  email_required: { de: 'E-Mail erforderlich.', en: 'Email address required.' },
  password_too_short: {
    de: 'Passwort muss mindestens 12 Zeichen lang sein.',
    en: 'The password must be at least 12 characters long.',
  },
  password_too_long: {
    de: 'Das Passwort ist zu lang: höchstens 1024 Zeichen.',
    en: 'The password is too long: at most 1024 characters.',
  },
  password_too_common: {
    de: 'Dieses Passwort ist zu häufig oder aus Datenlecks bekannt. Bitte ein anderes wählen.',
    en: 'This password is too common or known from data breaches. Please choose another one.',
  },
  current_password_required: { de: 'Aktuelles Passwort erforderlich', en: 'Current password required' },
  password_via_change_password: {
    de: 'Das Passwort wird über „Passwort ändern" geändert.',
    en: 'Change the password via "Change password".',
  },
  foreign_origin: { de: 'Diese Anfrage kam nicht von dieser Seite.', en: 'This request did not come from this site.' },
  foreign_host: { de: 'Dieser Server antwortet nur unter {address}.', en: 'This server only answers at {address}.' },
  confirmation_link_invalid: {
    de: 'Der Bestätigungslink ist ungültig oder abgelaufen.',
    en: 'The confirmation link is invalid or has expired.',
  },
  app_too_old: {
    de: 'Diese App ist zu alt für den Server (nötig: Schnittstelle {min}) — bitte die App aktualisieren.',
    en: 'This app is too old for the server (needs interface {min}) — please update the app.',
  },
  session_only: {
    de: 'Das geht nur aus einer angemeldeten Browser-Sitzung.',
    en: 'This is only possible from a signed-in browser session.',
  },
  app_token_only: {
    de: 'Das geht nur mit dem Zugang der App.',
    en: 'This is only possible with the app’s access token.',
  },
  device_key_missing: {
    de: 'Dieser Schritt braucht die Gerätesperre, und dieser Zugang ist an keine gebunden. Bitte die App aktualisieren, eine Displaysperre einrichten und neu anmelden – oder den Schritt in der Webapp ausführen.',
    en: 'This step needs the device lock, and this access token is not bound to one. Please update the app, set up a screen lock and sign in again – or do this step in the web app.',
  },
  device_key_invalid: {
    de: 'Der Geräteschlüssel ist ungültig (erwartet: EC P-256).',
    en: 'The device key is invalid (expected: EC P-256).',
  },
  device_key_exists: {
    de: 'Dieser Zugang ist schon an einen anderen Geräteschlüssel gebunden. Bitte neu anmelden.',
    en: 'This access token is already bound to another device key. Please sign in again.',
  },
  device_key_deadline: {
    de: 'Ein Geräteschlüssel lässt sich nur gleich nach der Anmeldung hinterlegen. Bitte neu anmelden.',
    en: 'A device key can only be registered right after signing in. Please sign in again.',
  },
  device_key_attestation: {
    de: 'Der Server nimmt nur einen Geräteschlüssel aus der Sicherheitshardware dieser App an, und diesen konnte er nicht bestätigen. Bitte die App aktualisieren – oder den Schritt in der Webapp ausführen.',
    en: "The server only accepts a device key from this app's security hardware and could not verify this one. Please update the app – or do this step in the web app.",
  },
  step_approval_required: {
    de: 'Bitte diesen Schritt zuerst mit der Gerätesperre bestätigen.',
    en: 'Please confirm this step with the device lock first.',
  },
  step_signature_invalid: {
    de: 'Die Bestätigung mit der Gerätesperre wurde nicht angenommen. Wurde ein Fingerabdruck neu eingerichtet, bitte neu anmelden.',
    en: 'The device-lock confirmation was not accepted. If a fingerprint was added recently, please sign in again.',
  },
  import_interrupted: {
    de: 'Der Import wurde unterbrochen — der Server wurde neu gestartet oder der Import hing. Bitte erneut starten.',
    en: 'The import was interrupted — the server restarted or the import stalled. Please start it again.',
  },
  import_row_interrupted: {
    de: 'Der Server wurde während dieses Sets neu gestartet — bitte die Menge prüfen.',
    en: 'The server restarted while importing this set — please check the quantity.',
  },
  current_password_wrong: { de: 'Aktuelles Passwort falsch', en: 'Current password is wrong' },
  password_change_required: {
    de: 'Bitte zuerst das vorläufige Passwort ändern.',
    en: 'Please change the temporary password first.',
  },
  last_admin: {
    de: 'Es muss mindestens ein aktiver Administrator bleiben. Bitte zuerst ein anderes Konto zum Administrator machen.',
    en: 'At least one active administrator must remain. Please make another account an administrator first.',
  },
  second_factor_mandatory: {
    de: 'Administratorkonten brauchen einen zweiten Faktor. Bitte zuerst einen Code-Generator einrichten.',
    en: 'Administrator accounts need a second factor. Please set up an authenticator app first.',
  },
  all_fields_required: { de: 'Alle Felder erforderlich', en: 'All fields are required' },
  password_reset_not_configured: {
    de: 'Passwort-Zurücksetzen per E-Mail ist auf diesem Server nicht eingerichtet. Bitte wende dich an die Person, die ihn betreibt.',
    en: 'Password reset by email is not set up on this server. Please contact the person who runs it.',
  },
  token_password_required: { de: 'Token und Passwort erforderlich.', en: 'Token and password are required.' },
  own_account_password: {
    de: 'Für das eigene Konto bitte „Passwort ändern" benutzen.',
    en: 'For your own account please use “Change password”.',
  },
  own_admin_role: {
    de: 'Eigene Administratorrolle kann nicht entfernt werden',
    en: 'You cannot remove your own administrator role',
  },
  user_not_found: { de: 'Benutzer nicht gefunden', en: 'User not found' },
  deactivate_own_account: {
    de: 'Das eigene Konto lässt sich nicht deaktivieren.',
    en: 'You cannot deactivate your own account.',
  },
  confirmation_not_configured: {
    de: 'Bestätigungs-Mails sind auf diesem Server nicht eingerichtet (APP_BASE_URL fehlt). Bitte den Administrator fragen.',
    en: 'Confirmation e-mails are not set up on this server (APP_BASE_URL is missing). Please ask the administrator.',
  },
  confirmation_sent: {
    de: 'Falls zu dieser Adresse ein unbestätigtes Konto gehört, ist ein neuer Link unterwegs.',
    en: 'If an unconfirmed account belongs to this address, a new link is on its way.',
  },
  own_second_factor: {
    de: 'Den eigenen zweiten Faktor unter Sicherheit mit Code abschalten.',
    en: 'Turn off your own second factor under Security, with a code.',
  },
  user_not_found_or_own: {
    de: 'Benutzer nicht gefunden oder eigener Account',
    en: 'User not found, or it is your own account',
  },

  // ── Household: linked accounts ───────────────────────────────────────────
  no_write_access: { de: 'Kein Schreibrecht für dieses Konto.', en: 'No write access to this account.' },
  no_account_access: { de: 'Kein Zugriff auf dieses Konto', en: 'No access to this account' },
  invite_code_invalid: { de: 'Ungültiger Einladungscode.', en: 'Invalid invitation code.' },
  too_many_invites: {
    de: 'Es sind schon {n} Einladungen offen. Eine davon einlösen lassen oder bis zu 24 Stunden warten.',
    en: 'There are already {n} open invitations. Have one redeemed or wait up to 24 hours.',
  },
  invite_code_expired: {
    de: 'Ungültiger oder abgelaufener Einladungscode.',
    en: 'Invalid or expired invitation code.',
  },
  account_with_itself: {
    de: 'Ein Konto kann sich nicht mit sich selbst verknüpfen.',
    en: 'An account cannot be linked to itself.',
  },
  account_already_linked: {
    de: 'Dieses Konto ist mit dem einladenden Konto bereits verknüpft.',
    en: 'This account is already linked to the inviting account.',
  },
  link_creates_cycle: {
    de: 'Das einladende Konto ist bereits ein Unterkonto dieses Kontos — gegenseitig lassen sich Konten nicht verknüpfen.',
    en: 'The inviting account is already a sub-account of this account — accounts cannot be linked both ways.',
  },
  account_id_invalid: { de: 'Ungültige Konto-ID.', en: 'Invalid account ID.' },
  currency_mismatch: {
    de: 'Beide Konten müssen dieselbe Währung verwenden (Hauptkonto: {main}, dieses Konto: {sub}).',
    en: 'Both accounts must use the same currency (main account: {main}, this account: {sub}).',
  },
  // The 60 is written out because fachfehler() fills no placeholders;
  // test/location-stock-db.test.js checks the limit (60 allowed, 61 rejected).
  storage_too_long: {
    de: 'Der Lagerort ist zu lang (höchstens 60 Zeichen).',
    en: 'Storage location is too long (at most 60 characters).',
  },
  storage_empty: {
    de: 'Der Lagerort braucht einen Namen.',
    en: 'A storage location needs a name.',
  },
  storage_duplicate: {
    de: 'Diesen Lagerort gibt es schon.',
    en: 'That storage location already exists.',
  },
  storage_unknown: {
    de: 'Diesen Lagerort gibt es nicht (mehr).',
    en: 'That storage location does not exist (any more).',
  },
  // A REFUSAL instead of silent clearing: otherwise the deleting user would lose assignments
  // they did not have in view.
  storage_in_use: {
    de: 'In diesem Lagerort liegt noch etwas — erst umräumen, dann löschen.',
    en: 'Something is still stored there — move it out before deleting.',
  },
  alert_direction_invalid: {
    de: 'Die Richtung muss „unter“ oder „über“ sein.',
    en: 'Direction must be “unter” or “ueber”.',
  },
  alert_threshold_invalid: {
    de: 'Die Schwelle muss eine Zahl grösser als null sein.',
    en: 'The threshold must be a number greater than zero.',
  },
  alert_condition_invalid: {
    de: 'Der Zustand muss „N“ (neu) oder „U“ (gebraucht) sein.',
    en: 'Condition must be “N” (new) or “U” (used).',
  },
  source_equals_target: { de: 'Quell- und Zielkonto sind identisch.', en: 'Source and target account are the same.' },
  purchase_prices_required: {
    de: 'Bitte die zu verschiebenden Kaufpreise angeben (acquisition_ids).',
    en: 'Please name the purchases to move (acquisition_ids).',
  },

  // ── Sets, parts, minifigures ─────────────────────────────────────────────
  set_not_found: { de: 'Set nicht gefunden', en: 'Set not found' },
  set_number_invalid: {
    de: 'Das ist keine Setnummer (Buchstaben und Ziffern, z. B. 10294).',
    en: 'That is not a set number (letters and digits, e.g. 10294).',
  },
  set_not_in_catalog: { de: 'Set nicht im Katalog gefunden', en: 'Set not found in the catalogue' },
  catalog_not_loaded: {
    de: 'Der Set-Katalog ist noch nicht geladen; Rebrickable war bisher nicht erreichbar oder der Schlüssel fehlt.',
    en: 'The set catalogue has not been loaded yet; Rebrickable was not reachable so far or the key is missing.',
  },
  set_number_required: { de: 'set_number erforderlich', en: 'set_number is required' },
  set_parameter_missing: { de: 'Parameter set fehlt', en: 'Parameter “set” is missing' },
  barcode_not_a_set: {
    de: 'Kein Set für "{barcode}" gefunden. Bitte Setnummer manuell eingeben.',
    en: 'No set found for “{barcode}”. Please enter the set number manually.',
  },
  part_not_manual: {
    de: 'Teil nicht gefunden oder nicht manuell hinzugefügt',
    en: 'Part not found, or not added manually',
  },
  // A REFUSAL instead of the 0 from V.colorId(): when correcting, that would be a
  // silent deletion of the color with "success".
  color_required: { de: 'color_id erforderlich (die neue Farbe)', en: 'color_id is required (the new colour)' },
  minifig_not_manual: {
    de: 'Minifigur nicht gefunden oder nicht manuell hinzugefügt',
    en: 'Minifigure not found, or not added manually',
  },
  no_parts: { de: 'Keine Teile', en: 'No parts' },
  condition_n_or_u: { de: 'N oder U erwartet', en: 'Expected N or U' },
  acquisition_fields: {
    de: 'quantity, purchase_price oder condition erforderlich',
    en: 'quantity, purchase_price or condition is required',
  },
  no_bricklink_price: { de: 'kein BrickLink-Preis gefunden', en: 'no BrickLink price found' },
  no_bricklink_access: { de: 'Kein BrickLink-Zugang eingerichtet', en: 'No BrickLink access configured' },
  bricklink_daily_limit: { de: 'BrickLink-Tageslimit erreicht', en: 'BrickLink daily limit reached' },
  bricklink_credentials_missing: {
    de: 'BrickLink-API-Zugangsdaten nicht vollständig.',
    en: 'BrickLink API credentials are incomplete.',
  },

  // ── Files, import, export ────────────────────────────────────────────────
  no_file: { de: 'Keine Datei', en: 'No file' },
  file_too_large: { de: 'Die Datei ist zu gross', en: 'The file is too large' },
  file_type_wrong: { de: 'Nur PDF, JPG oder PNG', en: 'PDF, JPG or PNG only' },
  upload_invalid: { de: 'Der Upload ist ungültig', en: 'The upload is invalid' },
  file_content_wrong: { de: 'Der Inhalt ist kein PDF, JPG oder PNG', en: 'The content is not a PDF, JPG or PNG' },
  upload_quota_full: {
    de: 'Der Platz für eigene Anleitungen ({mb} MB) ist belegt — bitte erst alte löschen',
    en: 'The space for your own instructions ({mb} MB) is full — please delete old ones first',
  },
  upload_total_full: {
    de: 'Der Speicherplatz für hochgeladene Dateien auf dem Server ({mb} MB für alle Konten) ist belegt — bitte den Administrator fragen',
    en: 'The server space for uploaded files ({mb} MB for all accounts) is full — please ask the administrator',
  },
  file_not_available: { de: 'Datei nicht verfügbar', en: 'File not available' },
  json_invalid: { de: 'Ungültige JSON-Datei', en: 'Invalid JSON file' },
  request_json_invalid: { de: 'Die Anfrage ist kein gültiges JSON', en: 'The request body is not valid JSON' },
  request_too_large: { de: 'Die Anfrage ist zu gross', en: 'The request is too large' },
  request_unreadable: { de: 'Die Anfrage ist nicht lesbar', en: 'The request cannot be read' },
  request_invalid: { de: 'Die Anfrage ist ungültig', en: 'The request is invalid' },
  request_too_slow: { de: 'Die Anfrage kam zu langsam an', en: 'The request arrived too slowly' },
  internal_error: {
    de: 'Interner Fehler — Einzelheiten stehen im Protokoll.',
    en: 'Internal error — see the server log for details.',
  },
  csv_parse_error: { de: 'CSV Parse Fehler: {reason}', en: 'CSV parse error: {reason}' },
  csv_no_data_rows: { de: 'Keine Datenzeilen in der Datei', en: 'The file has no data rows' },
  csv_no_usable_row: {
    de: 'Keine brauchbare Zeile gefunden — übersprungen: Zeile {rows}',
    en: 'No usable row found — skipped: row {rows}',
  },
  csv_skipped: {
    de: '{count} Zeile(n) übersprungen (Zeile {rows})',
    en: '{count} row(s) skipped (row {rows})',
  },
  csv_quantity_invalid: { de: 'Menge „{value}“ ungültig', en: 'Quantity "{value}" is invalid' },
  csv_no_set_number: { de: 'keine Setnummer', en: 'no set number' },
  import_timeout: { de: 'Zeitüberschreitung', en: 'Timed out' },
  import_quota: { de: 'Abruflimit erreicht', en: 'Rate limit reached' },
  field_required: { de: '{field} erforderlich', en: '{field} is required' },
  field_number_invalid: {
    de: '{field} darf nur Buchstaben, Zahlen und . _ - / enthalten (max. 64 Zeichen)',
    en: '{field} may only contain letters, digits and . _ - / (at most 64 characters)',
  },
  image_url_too_long: { de: 'image_url ist zu lang', en: 'image_url is too long' },
  image_url_invalid: { de: 'image_url ist keine gültige URL', en: 'image_url is not a valid URL' },
  image_url_not_https: { de: 'image_url muss https sein', en: 'image_url must use https' },
  field_negative: { de: '{field} darf nicht negativ sein', en: '{field} must not be negative' },
  field_too_high: { de: '{field} ist unplausibel hoch', en: '{field} is implausibly high' },
  field_not_boolean: { de: '{field} muss true oder false sein', en: '{field} must be true or false' },
  no_import_running: { de: 'Kein Import läuft', en: 'No import is running' },

  // ── PDF jobs ─────────────────────────────────────────────────────────────
  pdf_not_ready: { de: 'PDF noch nicht fertig', en: 'The PDF is not ready yet' },
  pdf_not_available: { de: 'PDF nicht mehr verfügbar', en: 'The PDF is no longer available' },
  pdf_job_running: {
    de: 'Es {runVerb} bereits {count} PDF-{jobWord}. Bitte warten, bis er fertig ist.',
    en: 'There {runVerb} already {count} PDF {jobWord}. Please wait until it is done.',
  },
  job_id_invalid: { de: 'Ungültige Job-ID', en: 'Invalid job ID' },
  job_not_found: { de: 'Job nicht gefunden oder abgelaufen', en: 'Job not found, or it has expired' },
  access_ended: {
    de: 'Der Zugang wurde beendet (abgemeldet oder widerrufen).',
    en: 'Access has ended (signed out or revoked).',
  },
  unknown_job: { de: 'Unbekannter Job', en: 'Unknown job' },
  job_not_changeable: {
    de: 'Diesen Auftrag gibt es nicht oder er ist schon beendet',
    en: 'This job does not exist or has already finished',
  },

  // ── Vouchers ─────────────────────────────────────────────────────────────
  // The user sees `gutschein_existiert` even with correct input; the text
  // therefore says WHY.
  number_invalid: {
    de: 'Ungültige Gutscheinnummer (nur Ziffern, 4–25 Stellen)',
    en: 'Invalid voucher number (digits only, 4–25 characters)',
  },
  pin_invalid: { de: 'Ungültiger PIN (nur Ziffern, 3–10 Stellen)', en: 'Invalid PIN (digits only, 3–10 characters)' },
  amount_invalid: { de: 'Ungültiger Betrag', en: 'Invalid amount' },
  currency_invalid: { de: 'Ungültige Währung', en: 'Invalid currency' },
  currency_shared_sub_account: {
    de: 'Ein Unterkonto gehört auch zu einem anderen Haushalt mit anderer Währung. Erst die Verknüpfung lösen, dann die Währung ändern.',
    en: 'A sub-account also belongs to another household with a different currency. Unlink it first, then change the currency.',
  },
  currency_main_account_only: {
    de: 'Die Währung gilt für den ganzen Haushalt; ändern kann sie nur das Hauptkonto.',
    en: 'The currency applies to the whole household; only the main account can change it.',
  },
  voucher_exists: { de: 'Diesen Gutschein gibt es bereits.', en: 'This voucher already exists.' },
  pdf_only: { de: 'Nur PDF-Dateien', en: 'PDF files only' },
  pdf_too_many_pages: {
    de: 'Das PDF hat {pages} Seiten, höchstens {max} sind möglich. Bitte in kleinere Dateien teilen.',
    en: 'The PDF has {pages} pages; at most {max} are possible. Please split it into smaller files.',
  },
  upload_running: {
    de: 'Für dieses Konto läuft schon ein Upload dieser Art — bitte warten, bis er fertig ist.',
    en: 'An upload of this kind is already running for this account — please wait until it has finished.',
  },

  // ── Setup ────────────────────────────────────────────────────────────────
  source_unknown: { de: 'Unbekannte Quelle', en: 'Unknown source' },
  source_test_failed: { de: 'Verbindung fehlgeschlagen: {reason}', en: 'Connection failed: {reason}' },
  source_without_key: {
    de: 'Für {source} ist noch kein Zugang gespeichert. Bitte eintragen und erneut prüfen.',
    en: 'No access for {source} is saved yet. Please enter it and check again.',
  },
  source_unreachable: {
    de: '{source} ist nicht erreichbar. Bitte die Internetverbindung des Servers prüfen.',
    en: '{source} cannot be reached. Please check the server’s internet connection.',
  },
  source_rejected: {
    de: '{source} hat den Zugang abgelehnt. Bitte die eingetragenen Werte prüfen.',
    en: '{source} rejected the access. Please check the values you entered.',
  },

  // ── Second factor ────────────────────────────────────────────────────────
  second_factor_required: {
    de: 'Bitte den Code aus der Authenticator-App eingeben.',
    en: 'Please enter the code from your authenticator app.',
  },
  second_factor_wrong: {
    de: 'Der Code stimmt nicht oder wurde schon benutzt.',
    en: 'The code is wrong or has already been used.',
  },
  second_factor_locked: {
    de: 'Zu viele falsche Codes für dieses Konto. Bis zu 24 Stunden geht die Anmeldung nur mit einem Wiederherstellungscode oder einem Passkey.',
    en: 'Too many wrong codes for this account. For up to 24 hours, sign-in only works with a recovery code or a passkey.',
  },
  second_factor_already_active: {
    de: 'Der zweite Faktor ist bereits eingerichtet.',
    en: 'Two-factor authentication is already set up.',
  },
  second_factor_not_active: {
    de: 'Der zweite Faktor ist nicht eingerichtet.',
    en: 'Two-factor authentication is not set up.',
  },

  // ── Trash ────────────────────────────────────────────────────────────────
  trash_already_exists: {
    de: 'Wurde inzwischen neu angelegt — erst den neuen Eintrag löschen, dann wiederherstellen.',
    en: 'Has been added again since — delete the new entry first, then restore.',
  },

  // `keine_gutscheine` is information: better to read that than an empty PDF.
  no_vouchers: { de: 'Es sind keine Gutscheine erfasst.', en: 'No vouchers have been added.' },
  pdf_grant_required: {
    de: 'Das PDF braucht eine frische Bestätigung mit dem Passwort.',
    en: 'The PDF needs a fresh confirmation with your password.',
  },
  // Separate from `gutschein_unvollstaendig`: there it was a PDF without values —
  // the user does something different in each case.
  pdf_unreadable: { de: 'Die Datei liess sich nicht als PDF lesen.', en: 'The file could not be read as a PDF.' },
  // The text says what to do — otherwise the user looks for the error on their side.
  no_voucher_in_pdf: {
    de: 'In diesem PDF war kein Gutschein zu erkennen. ' + 'Bitte den Gutschein von Hand erfassen.',
    en: 'No voucher could be recognised in this PDF. ' + 'Please add the voucher manually.',
  },

  // ── Balance lookup at LEGO ───────────────────────────────────────────────
  // Four codes, because the user does something different for each.
  balance_pin_missing: {
    de: 'Für die Abfrage braucht es die PIN der Karte.',
    en: 'The card PIN is required for the balance query.',
  },
  // {sek} instead of a fixed number: two numbers for one rule drift apart.
  balance_interval: {
    de: 'Es wird höchstens eine Karte alle {sek} Sekunden ' + 'abgefragt. Bitte noch {wait} Sekunden warten.',
    en: 'At most one card is queried every {sek} seconds. ' + 'Please wait another {wait} seconds.',
  },
  // Says that it is not the card's fault and how long the lookup rests —
  // otherwise the user keeps pressing.
  balance_bot_protection: {
    de: 'LEGO hat die Abfrage abgewiesen (Bot-Schutz). ' + 'Die Abfrage ruht noch {min} Minuten.',
    en: 'LEGO rejected the query (bot protection). ' + 'The query is paused for another {min} minutes.',
  },
  // {reason} passes through redact() beforehand: no card number and PIN in it.
  balance_failed: {
    de: 'Das Guthaben liess sich nicht abfragen: {reason}',
    en: 'The balance could not be queried: {reason}',
  },
  // An address is built from the country; whatever is not on the list is
  // not asked.
  balance_country_invalid: {
    de: 'Das eingestellte Ausgabeland ist unbekannt. ' + 'Bitte unter Menü → Gutscheine wählen.',
    en: 'The configured card country is unknown. ' + 'Please choose one under Menu → Vouchers.',
  },

  // ── BrickLink wanted list ────────────────────────────────────────────────
  // "no wanted list" is different information than "0 items". Unreadable
  // corrections are a REFUSAL: whoever made them would otherwise only notice their absence
  // on the cards.
  corrections_invalid: {
    de: 'Die Korrekturen sind nicht lesbar (kein gültiges JSON-Array).',
    en: 'The corrections could not be read (not a valid JSON array).',
  },
  no_wanted_list: {
    de: 'Das ist keine BrickLink-Wanted-Liste ' + '(kein <INVENTORY> in der Datei).',
    en: 'This is not a BrickLink wanted list ' + '(no <INVENTORY> in the file).',
  },
  id_invalid: { de: 'Ungültige ID', en: 'Invalid ID' },
  input_invalid: { de: 'Ungültige Eingabe im Feld „{field}“', en: 'Invalid input in field “{field}”' },
  field_unknown: { de: 'Unbekanntes Feld „{field}“', en: 'Unknown field “{field}”' },

  // ── Operation and administration ─────────────────────────────────────────
  not_found: { de: 'Nicht gefunden', en: 'Not found' },
  purchase_price_not_found: { de: 'Kaufpreis nicht gefunden', en: 'Purchase not found' },
  date_invalid: { de: 'Ungültiges Datum', en: 'Invalid date' },
  acquisition_not_found: { de: 'Erfassung nicht gefunden', en: 'Entry not found' },
  date_taken: {
    de: 'An diesem Datum gibt es schon einen Eintrag mit demselben Zustand und Preis.',
    en: 'An entry with the same condition and price already exists for that date.',
  },
  server_busy: { de: 'Server ausgelastet', en: 'The server is busy' },
  database_unreachable: { de: 'Datenbank nicht erreichbar', en: 'Database unreachable' },
  import_cancelled: { de: 'Der Import wurde abgebrochen.', en: 'The import was cancelled.' },
  import_failed: {
    de: 'Der Import ist gescheitert — Einzelheiten stehen im Protokoll.',
    en: 'The import failed — see the server log for details.',
  },
  import_still_running: {
    de: 'Der Import läuft im Hintergrund weiter; den Stand zeigt der Balken.',
    en: 'The import continues in the background; the progress bar shows its state.',
  },
  idempotency_key_invalid: {
    de: 'Idempotency-Key: 1 bis 100 Zeichen aus A–Z, a–z, 0–9, . _ : -',
    en: 'Idempotency-Key: 1 to 100 characters from A–Z, a–z, 0–9, . _ : -',
  },
  idempotency_key_mismatch: {
    de: 'Dieser Idempotency-Key gehört zu einer anderen Anfrage.',
    en: 'This Idempotency-Key belongs to a different request.',
  },
  idempotency_running: {
    de: 'Die Anfrage mit diesem Idempotency-Key läuft noch.',
    en: 'The request with this Idempotency-Key is still running.',
  },
  idempotency_not_repeatable: {
    de: 'Diese Änderung wurde schon einmal gesendet; ihr Ergebnis wird aus Sicherheitsgründen nicht wiederholt. Bitte den Stand prüfen und sie bei Bedarf neu ausführen.',
    en: 'This change was already sent; for security its result is not repeated. Please check the current state and run it again if needed.',
  },
  too_many_connections: { de: 'Zu viele offene Verbindungen', en: 'Too many open connections' },
  time_limit: { de: 'Zeitlimit überschritten', en: 'Timed out' },
  value_invalid: { de: 'Ungültiger Wert', en: 'Invalid value' },
  already_exists: { de: 'Dieser Eintrag ist schon vorhanden.', en: 'This entry already exists.' },
  reference_missing: {
    de: 'Der Eintrag, auf den sich das bezieht, fehlt oder wird noch gebraucht.',
    en: 'The entry this refers to is missing or still in use.',
  },
  time_invalid: { de: 'Ungültige Uhrzeit (HH:MM)', en: 'Invalid time (HH:MM)' },
  theme_invalid: { de: 'Ungültiges Design', en: 'Invalid theme' },
  daily_limit_area: {
    de: 'Tageslimit muss zwischen 1 und 100000 liegen',
    en: 'The daily limit must be between 1 and 100000',
  },
  unknown_task: { de: 'Unbekannte Aufgabe: {aufgabe}', en: 'Unknown task: {aufgabe}' },
  smtp_not_configured: {
    de: 'SMTP nicht konfiguriert (Host oder Benutzername fehlt)',
    en: 'SMTP is not configured (host or username missing)',
  },
  smtp_certificate: {
    de: 'Zertifikat des Mailservers nicht bestätigt ({reason}). Unter Menü → Einstellungen → E-Mail das Zertifikat (PEM) oder seinen SHA-256-Fingerabdruck eintragen.',
    en: 'Mail server certificate not confirmed ({reason}). Enter the certificate (PEM) or its SHA-256 fingerprint under Settings → Email.',
  },
  smtp_error: { de: 'SMTP-Verbindung fehlgeschlagen: {reason}', en: 'SMTP connection failed: {reason}' },
  no_target_email: {
    de: 'Keine Ziel-E-Mail-Adresse angegeben. Bitte eine E-Mail-Adresse eingeben.',
    en: 'No target email address given. Please enter one.',
  },
  url_invalid: { de: 'Ungültige URL', en: 'Invalid URL' },
  url_missing_https: { de: 'url fehlt oder ist kein https', en: 'url is missing or is not https' },
  host_not_allowed: { de: 'Host nicht erlaubt: {host}', en: 'Host not allowed: {host}' },
  qr_without_base_url: {
    de:
      'Der Server kennt seine eigene Adresse nicht: APP_BASE_URL ist nicht gesetzt. ' +
      'Ohne sie truege der QR-Code die Adresse aus der Browserzeile — und die App ' +
      'faende den Server ausserhalb des Heimnetzes nie wieder. Bitte APP_BASE_URL setzen.',
    en:
      'The server does not know its own address: APP_BASE_URL is not set. Without it ' +
      'the QR code would carry the address from the browser bar, and the app would ' +
      'never find the server again outside the home network. Please set APP_BASE_URL.',
  },
  qr_rejected: {
    de: 'Die Kopplung wurde im Browser abgelehnt. Bitte einen neuen QR-Code erzeugen.',
    en: 'Pairing was declined in the browser. Please create a new QR code.',
  },
  qr_code_wrong: {
    de: 'Der Code stimmt nicht. Bitte den Code eingeben, den die App zeigt.',
    en: 'The code does not match. Please enter the code shown in the app.',
  },
  qr_not_pending: {
    de: 'Kein Gerät wartet auf diese Kopplung, oder sie ist abgelaufen.',
    en: 'No device is waiting for this pairing, or it has expired.',
  },
} as const;

export type ErrorCode = keyof typeof ERRORS;

// From Accept-Language; without a match German.
export function responseLanguage(req: { headers?: Record<string, unknown> } | undefined): Language {
  const raw = String(req?.headers?.['accept-language'] || '').toLowerCase();
  return raw.startsWith('en') || raw.includes(',en') ? 'en' : 'de';
}

/** What went wrong, in domain terms. Which HTTP status belongs to it is only known by
 * src/http/errorKind.ts: services also run in the job process and in scripts. */
export type ErrorKind =
  | 'invalid'
  | 'not_signed_in'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'too_large'
  | 'unsupported_type'
  | 'request_timeout'
  | 'gone'
  | 'unprocessable'
  | 'too_many'
  | 'storage_full'
  | 'internal'
  | 'upstream'
  | 'unavailable'
  | 'upstream_timeout'
  | 'misdirected'
  | 'upgrade_required';

/** Kind and code travel along; the sentence is only created in the response in the
 * requester's language. */
export class DomainError extends Error {
  /** `zusatz`: fields the response carries next to code and error (e.g. `wartenSek`). */
  constructor(
    readonly kind: ErrorKind,
    readonly code: ErrorCode,
    readonly vars?: Record<string, string | number>,
    readonly extra?: Record<string, unknown>,
  ) {
    super(errorText(code, 'de', vars));
    this.name = 'Fachfehler';
  }
}

/** Two concurrent creations (23505) are a user input, not a
 * server error; everything else propagates unchanged. */
export function asDuplicate(code: ErrorCode): (e: unknown) => never {
  return (e: unknown) => {
    if ((e as { code?: unknown } | null)?.code === '23505') throw new DomainError('conflict', code);
    throw e;
  };
}

/** Like asDuplicate, but with a result instead of a refusal: a concurrent
 * winner is an outcome of the flow there, not an error. */
export function duplicateAs<T>(value: T): (e: unknown) => T {
  return (e: unknown) => {
    if ((e as { code?: unknown } | null)?.code === '23505') return value;
    throw e;
  };
}

/** Aborts the service with a reason the route names to the requester. */
export function failDomain(kind: ErrorKind, code: ErrorCode, vars?: Record<string, string | number>): never {
  throw new DomainError(kind, code, vars);
}

/** A read path found nothing: 404 with the code that says what is missing. */
export function notFound(code: ErrorCode = 'not_found', vars?: Record<string, string | number>): never {
  throw new DomainError('not_found', code, vars);
}

/** For callbacks like multer's fileFilter that pass an error instead of throwing it. */
export function fileError(kind: ErrorKind, code: ErrorCode, vars?: Record<string, string | number>): Error {
  return new DomainError(kind, code, vars);
}

export function errorText(code: ErrorCode, language: Language = 'de', vars?: Record<string, string | number>): string {
  const entry = ERRORS[code];
  // An error message must not crash itself: a missing entry passes through
  // as a code in plaintext and tells the log what is missing.
  if (!entry) {
    console.error(`[fehlerTexte] Unbekannter Fehlercode: ${String(code)}`);
    return String(code);
  }
  let text: string = entry[language] || entry.de;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) text = text.split(`{${k}}`).join(String(v));
  }
  return text;
}
