/**
 * Die Fehlermeldungen des Servers — an EINER Stelle, in beiden Sprachen.
 * Ausführlich: docs/begruendungen/utils/fehlerTexte.ts.md#sprache
 */

/** Die unterstützten Sprachen — dieselben zwei wie in beiden Oberflächen. */
export type Sprache = 'de' | 'en';

/**
 * Der Katalog.
 * Ausführlich: docs/begruendungen/utils/fehlerTexte.ts.md#fehler
 */
export const FEHLER = {
  // ── Anmeldung und Konto ──────────────────────────────────────────────────
  nicht_angemeldet:            { de: 'Nicht angemeldet', en: 'Not signed in' },
  auth_fehler:                 { de: 'Auth-Fehler', en: 'Authentication error' },
  nur_admins:                  { de: 'Nur für Admins', en: 'Administrators only' },
  token_ungueltig:             { de: 'Ungültiger oder abgelaufener Token',
                                 en: 'Invalid or expired token' },
  token_id_fehlt:              { de: 'Token-ID fehlt', en: 'Token ID missing' },
  token_nicht_ausgestellt:     { de: 'Anmeldung fehlgeschlagen: Token konnte nicht ausgestellt werden.',
                                 en: 'Sign-in failed: the token could not be issued.' },
  konto_deaktiviert:           { de: 'Konto deaktiviert. Bitte Administrator kontaktieren.',
                                 en: 'Account deactivated. Please contact an administrator.' },
  email_nicht_bestaetigt:      { de: 'E-Mail-Adresse noch nicht bestätigt. Bitte prüfe dein Postfach.',
                                 en: 'Email address not confirmed yet. Please check your inbox.' },
  zu_viele_anfragen:           { de: 'Zu viele Anfragen — bitte in {minuten} Min. erneut versuchen',
                                 en: 'Too many attempts — please try again in {minuten} min' },
  zu_viele_fehlversuche:       { de: 'Zu viele Fehlversuche — bitte in {minuten} Min. erneut versuchen',
                                 en: 'Too many failed attempts — please try again in {minuten} min' },
  anmeldedaten_ungueltig:      { de: 'Ungültige Anmeldedaten', en: 'Invalid credentials' },
  name_oder_email_eingeben:    { de: 'Bitte Benutzername oder E-Mail-Adresse eingeben.',
                                 en: 'Please enter a username or an email address.' },

  // ── Registrierung und Passwort ───────────────────────────────────────────
  registrierung_deaktiviert:   { de: 'Registrierung ist deaktiviert.',
                                 en: 'Registration is disabled.' },
  registrierung_felder:        { de: 'Benutzername, E-Mail und Passwort sind erforderlich.',
                                 en: 'Username, email address and password are required.' },
  benutzername_passwort:       { de: 'Benutzername und Passwort erforderlich',
                                 en: 'Username and password are required' },
  benutzername_vergeben:       { de: 'Benutzername bereits vergeben',
                                 en: 'That username is already taken' },
  benutzername_oder_email_vergeben: { de: 'Benutzername oder E-Mail bereits vergeben.',
                                 en: 'That username or email address is already taken.' },
  email_vergeben:              { de: 'E-Mail bereits vergeben', en: 'That email address is already taken' },
  benutzername_ungueltig:      { de: 'Benutzername darf nur Buchstaben, Zahlen und _.- enthalten (3–32 Zeichen).',
                                 en: 'A username may contain only letters, digits and _.- (3–32 characters).' },
  email_ungueltig:             { de: 'Ungültige E-Mail-Adresse.', en: 'Invalid email address.' },
  email_erforderlich:          { de: 'E-Mail erforderlich.', en: 'Email address required.' },
  passwort_zu_kurz:            { de: 'Passwort muss mindestens 8 Zeichen lang sein.',
                                 en: 'The password must be at least 8 characters long.' },
  aktuelles_passwort_erforderlich: { de: 'Aktuelles Passwort erforderlich',
                                 en: 'Current password required' },
  passwort_ueber_change_password: { de: 'Das Passwort wird über „Passwort ändern" geändert.',
                                 en: 'Change the password via "Change password".' },
  fremde_herkunft:             { de: 'Diese Anfrage kam nicht von dieser Seite.',
                                 en: 'This request did not come from this site.' },
  import_unterbrochen:         { de: 'Der Import wurde unterbrochen — der Server wurde neu gestartet oder der Import hing. Bitte erneut starten.',
                                 en: 'The import was interrupted — the server restarted or the import stalled. Please start it again.' },
  aktuelles_passwort_falsch:   { de: 'Aktuelles Passwort falsch', en: 'Current password is wrong' },
  alle_felder_erforderlich:    { de: 'Alle Felder erforderlich', en: 'All fields are required' },
  passwort_reset_nicht_eingerichtet: {
    de: 'Passwort-Zurücksetzen per E-Mail ist auf diesem Server nicht eingerichtet (APP_BASE_URL fehlt). Bitte den Verwalter fragen.',
    en: 'Password reset by email is not set up on this server (APP_BASE_URL is missing). Please ask the administrator.' },
  token_passwort_erforderlich: { de: 'Token und Passwort erforderlich.',
                                 en: 'Token and password are required.' },
  eigenes_konto_passwort:      { de: 'Für das eigene Konto bitte „Passwort ändern" benutzen.',
                                 en: 'For your own account please use “Change password”.' },
  eigene_adminrolle:           { de: 'Eigene Admin-Rolle kann nicht entfernt werden',
                                 en: 'You cannot remove your own administrator role' },
  benutzer_nicht_gefunden:     { de: 'Benutzer nicht gefunden', en: 'User not found' },
  benutzer_nicht_gefunden_oder_eigenes: { de: 'Benutzer nicht gefunden oder eigener Account',
                                 en: 'User not found, or it is your own account' },

  // ── Haushalt: verknüpfte Konten ──────────────────────────────────────────
  kein_schreibrecht:           { de: 'Kein Schreibrecht für dieses Konto.',
                                 en: 'No write access to this account.' },
  kein_zugriff_konto:          { de: 'Kein Zugriff auf dieses Konto',
                                 en: 'No access to this account' },
  einladungscode_ungueltig:    { de: 'Ungültiger Einladungscode.', en: 'Invalid invitation code.' },
  einladungscode_abgelaufen:   { de: 'Ungültiger oder abgelaufener Einladungscode.',
                                 en: 'Invalid or expired invitation code.' },
  konto_mit_sich_selbst:       { de: 'Ein Konto kann sich nicht mit sich selbst verknüpfen.',
                                 en: 'An account cannot be linked to itself.' },
  konto_bereits_verknuepft:    { de: 'Dieses Konto ist bereits mit einem Hauptkonto verknüpft.',
                                 en: 'This account is already linked to a main account.' },
  // Die drei Absagen „nur eine Stufe" sind mit Nachtrag 173 entfallen —
  // Konten lassen sich jetzt über mehrere Stufen verknüpfen. Geblieben ist
  // die eine Grenze, die bleiben MUSS:
  verknuepfung_erzeugt_kreis:  {
    de: 'Dieses Konto ist bereits ein Unterkonto des einladenden Kontos — die Verknüpfung liefe im Kreis.',
    en: 'This account is already a sub-account of the inviting account — the link would form a cycle.' },
  waehrung_ungleich:           {
    de: 'Beide Konten müssen dieselbe Währung verwenden (Hauptkonto: {haupt}, dieses Konto: {unter}).',
    en: 'Both accounts must use the same currency (main account: {haupt}, this account: {unter}).' },
  // Die 60 steht hier AUSGESCHRIEBEN, weil fehlerWerfen() keine Platzhalter
  // füllt. Sie ist damit die zweite Stelle neben LAGERORT_MAX_ZEICHEN in
  // utils/lagerort.ts — test/lagerort.test.js hält beide zusammen, damit aus
  // „unvermeidbar“ nicht „auseinandergelaufen“ wird (dasselbe Vorgehen wie
  // bei PASSWORT_MIN_ZEICHEN).
  lagerort_zu_lang:            {
    de: 'Der Lagerort ist zu lang (höchstens 60 Zeichen).',
    en: 'Storage location is too long (at most 60 characters).' },
  lagerort_leer:               {
    de: 'Der Lagerort braucht einen Namen.',
    en: 'A storage location needs a name.' },
  lagerort_doppelt:            {
    de: 'Diesen Lagerort gibt es schon.',
    en: 'That storage location already exists.' },
  lagerort_unbekannt:          {
    de: 'Diesen Lagerort gibt es nicht (mehr).',
    en: 'That storage location does not exist (any more).' },
  // Absichtlich eine ABSAGE statt eines stillen Leerens: Wer einen Ort
  // loescht, in dem noch etwas liegt, wuerde sonst die Zuordnung von Sets
  // verlieren, die er gar nicht im Blick hatte. Die Oberflaeche nennt die
  // Anzahl und laesst ihn erst raeumen.
  lagerort_in_benutzung:       {
    de: 'In diesem Lagerort liegt noch etwas — erst umräumen, dann löschen.',
    en: 'Something is still stored there — move it out before deleting.' },
  alarm_richtung_ungueltig:    {
    de: 'Die Richtung muss „unter“ oder „über“ sein.',
    en: 'Direction must be “unter” or “ueber”.' },
  alarm_schwelle_ungueltig:    {
    de: 'Die Schwelle muss eine Zahl grösser als null sein.',
    en: 'The threshold must be a number greater than zero.' },
  alarm_zustand_ungueltig:     {
    de: 'Der Zustand muss „N“ (neu) oder „U“ (gebraucht) sein.',
    en: 'Condition must be “N” (new) or “U” (used).' },
  quelle_ziel_identisch:       { de: 'Quell- und Zielkonto sind identisch.',
                                 en: 'Source and target account are the same.' },
  kaufpreise_angeben:          { de: 'Bitte die zu verschiebenden Kaufpreise angeben (acquisition_ids).',
                                 en: 'Please name the purchases to move (acquisition_ids).' },

  // ── Sets, Teile, Minifiguren ─────────────────────────────────────────────
  set_nicht_gefunden:          { de: 'Set nicht gefunden', en: 'Set not found' },
  set_nicht_im_katalog:        { de: 'Set nicht im Katalog gefunden', en: 'Set not found in the catalogue' },
  set_number_erforderlich:     { de: 'set_number erforderlich', en: 'set_number is required' },
  parameter_set_fehlt:         { de: 'Parameter set fehlt', en: 'Parameter “set” is missing' },
  barcode_kein_set:            { de: 'Kein Set für "{barcode}" gefunden. Bitte Set-Nummer manuell eingeben.',
                                 en: 'No set found for “{barcode}”. Please enter the set number manually.' },
  teil_nicht_manuell:          { de: 'Teil nicht gefunden oder nicht manuell hinzugefügt',
                                 en: 'Part not found, or not added manually' },
  // Absichtlich eine ABSAGE statt der 0 aus V.colorId(): Beim Anlegen heisst
  // „keine Angabe" zu Recht 0, beim KORRIGIEREN einer Farbe wäre dieselbe
  // Umdeutung ein stilles Löschen der Farbe — und der Aufrufer bekäme
  // „success" zu sehen.
  farbe_erforderlich:          { de: 'color_id erforderlich (die neue Farbe)',
                                 en: 'color_id is required (the new colour)' },
  minifig_nicht_manuell:       { de: 'Minifigur nicht gefunden oder nicht manuell hinzugefügt',
                                 en: 'Minifigure not found, or not added manually' },
  keine_teile:                 { de: 'Keine Teile', en: 'No parts' },
  zustand_n_oder_u:            { de: 'N oder U erwartet', en: 'Expected N or U' },
  erfassung_felder:            { de: 'quantity, purchase_price oder condition erforderlich',
                                 en: 'quantity, purchase_price or condition is required' },
  kein_bricklink_preis:        { de: 'kein BrickLink-Preis gefunden', en: 'no BrickLink price found' },

  // ── Dateien, Import, Export ──────────────────────────────────────────────
  keine_datei:                 { de: 'Keine Datei', en: 'No file' },
  datei_nicht_verfuegbar:      { de: 'Datei nicht verfügbar', en: 'File not available' },
  json_ungueltig:              { de: 'Ungültige JSON-Datei', en: 'Invalid JSON file' },
  csv_parse_fehler:            { de: 'CSV Parse Fehler: {grund}', en: 'CSV parse error: {grund}' },
  kein_import_laeuft:          { de: 'Kein Import läuft', en: 'No import is running' },

  // ── PDF-Aufträge ─────────────────────────────────────────────────────────
  pdf_nicht_fertig:            { de: 'PDF noch nicht fertig', en: 'The PDF is not ready yet' },
  pdf_nicht_verfuegbar:        { de: 'PDF nicht mehr verfügbar', en: 'The PDF is no longer available' },
  pdf_auftrag_laeuft:          {
    de: 'Es {laufenVerb} bereits {anzahl} PDF-{auftragWort}. Bitte warten, bis er fertig ist.',
    en: 'There {laufenVerb} already {anzahl} PDF {auftragWort}. Please wait until it is done.' },
  job_id_ungueltig:            { de: 'Ungültige Job-ID', en: 'Invalid job ID' },
  job_nicht_gefunden:          { de: 'Job nicht gefunden oder abgelaufen',
                                 en: 'Job not found, or it has expired' },
  unbekannter_job:             { de: 'Unbekannter Job', en: 'Unknown job' },

  // ── Gutscheine (LEGO-Geschenkkarten im eigenen Profil) ───────────────────
  //
  // `gutschein_existiert` ist der einzige davon, den der Nutzer auch bei
  // richtiger Eingabe sieht: Die Tabelle laesst dieselbe Kartennummer je
  // Konto nur einmal zu. Der Text sagt deshalb WARUM und nicht nur DASS.
  nummer_ungueltig:            { de: 'Ungültige Gutscheinnummer (nur Ziffern, 4–25 Stellen)',
                                 en: 'Invalid voucher number (digits only, 4–25 characters)' },
  pin_ungueltig:               { de: 'Ungültiger PIN (nur Ziffern, 3–10 Stellen)',
                                 en: 'Invalid PIN (digits only, 3–10 characters)' },
  betrag_ungueltig:            { de: 'Ungültiger Betrag', en: 'Invalid amount' },
  waehrung_ungueltig:          { de: 'Ungültige Währung', en: 'Invalid currency' },
  gutschein_existiert:         { de: 'Diesen Gutschein gibt es bereits.',
                                 en: 'This voucher already exists.' },
  nur_pdf:                     { de: 'Nur PDF-Dateien', en: 'PDF files only' },

  // ── Einrichtung ──────────────────────────────────────────────────────────
  quelle_unbekannt:            { de: 'Unbekannte Quelle', en: 'Unknown source' },
  quelle_test_fehlgeschlagen:  { de: 'Verbindung fehlgeschlagen: {grund}', en: 'Connection failed: {grund}' },

  // ── Zweiter Faktor ───────────────────────────────────────────────────────
  zweiter_faktor_noetig:       { de: 'Bitte den Code aus der Authenticator-App eingeben.',
                                 en: 'Please enter the code from your authenticator app.' },
  zweiter_faktor_falsch:       { de: 'Der Code stimmt nicht oder wurde schon benutzt.',
                                 en: 'The code is wrong or has already been used.' },
  zweiter_faktor_schon_aktiv:  { de: 'Der zweite Faktor ist bereits eingerichtet.',
                                 en: 'Two-factor authentication is already set up.' },
  zweiter_faktor_nicht_aktiv:  { de: 'Der zweite Faktor ist nicht eingerichtet.',
                                 en: 'Two-factor authentication is not set up.' },

  // ── Papierkorb ───────────────────────────────────────────────────────────
  papierkorb_schon_vorhanden:  { de: 'Wurde inzwischen neu angelegt — erst den neuen Eintrag löschen, dann wiederherstellen.',
                                 en: 'Has been added again since — delete the new entry first, then restore.' },

  // ── Export und Import der Gutscheine (Marcos Liste, Stueck 3) ────────────
  //
  // `keine_gutscheine` ist kein Fehler des Nutzers, sondern eine Auskunft:
  // Wer auf „exportieren" klickt, ohne einen Gutschein zu haben, soll das
  // lesen und nicht ein leeres PDF bekommen.
  keine_gutscheine:            { de: 'Es sind keine Gutscheine erfasst.',
                                 en: 'No vouchers have been added.' },
  // Die Datei liess sich nicht als PDF oeffnen. Getrennt von
  // `gutschein_unvollstaendig`: Dort war es ein PDF, nur ohne die Werte —
  // zwei verschiedene Auskuenfte, und der Nutzer tut Verschiedenes.
  pdf_unlesbar:                { de: 'Die Datei liess sich nicht als PDF lesen.',
                                 en: 'The file could not be read as a PDF.' },
  // Ein PDF ohne erkennbaren Gutschein. Der Text sagt, was zu tun ist —
  // sonst sucht der Nutzer den Fehler bei sich.
  kein_gutschein_im_pdf:       { de: 'In diesem PDF war kein Gutschein zu erkennen. '
                                   + 'Bitte den Gutschein von Hand erfassen.',
                                 en: 'No voucher could be recognised in this PDF. '
                                   + 'Please add the voucher manually.' },

  // ── Guthaben-Abfrage bei LEGO ────────────────────────────────────────────
  //
  // Vier verschiedene Auskuenfte, und sie sind deshalb vier Codes: Der Nutzer
  // tut bei jeder etwas anderes — PIN nachtragen, kurz warten, lange warten,
  // oder es ist etwas kaputt und er kann nichts tun.
  guthaben_pin_fehlt:          { de: 'Für die Abfrage braucht es die PIN der Karte.',
                                 en: 'The card PIN is required for the balance query.' },
  // {sek} statt einer festen Zahl: Die Grenze steht in
  // utils/gutscheinGuthabenSchranke.ts, und zwei Zahlen fuer eine Regel laufen
  // auseinander.
  guthaben_abstand:            { de: 'Es wird höchstens eine Karte alle {sek} Sekunden '
                                   + 'abgefragt. Bitte noch {warten} Sekunden warten.',
                                 en: 'At most one card is queried every {sek} seconds. '
                                   + 'Please wait another {warten} seconds.' },
  // Der Bot-Schutz. Der Text sagt ZWEI Dinge: dass es nicht an der Karte
  // liegt, und wie lange die Abfrage ruht — sonst drueckt der Nutzer weiter.
  guthaben_botschutz:          { de: 'LEGO hat die Abfrage abgewiesen (Bot-Schutz). '
                                   + 'Die Abfrage ruht noch {min} Minuten.',
                                 en: 'LEGO rejected the query (bot protection). '
                                   + 'The query is paused for another {min} minutes.' },
  // {grund} ist der Text der Gegenseite — er laeuft vorher durch verdecke(),
  // damit Kartennummer und PIN darin nicht stehen koennen.
  guthaben_fehlgeschlagen:     { de: 'Das Guthaben liess sich nicht abfragen: {grund}',
                                 en: 'The balance could not be queried: {grund}' },
  // Das Ausgabeland kommt aus den Einstellungen. Steht dort etwas, das nicht
  // auf der Liste ist, wird NICHT gefragt: Aus dem Land wird eine Adresse
  // gebaut.
  guthaben_land_ungueltig:     { de: 'Das eingestellte Ausgabeland ist unbekannt. '
                                   + 'Bitte in den Einstellungen bei den Gutscheinen wählen.',
                                 en: 'The configured card country is unknown. '
                                   + 'Please choose one in the voucher settings.' },

  // ── BrickLink-Wanted-Liste (Marcos Liste, Stueck 4) ──────────────────────
  //
  // Vor dem Zerlegen gesagt, nicht danach: „0 Posten gelesen" kann auch eine
  // LEERE Liste bedeuten. Dass die Datei gar keine Wanted-Liste ist, ist eine
  // andere Auskunft, und der Nutzer tut etwas anderes damit.
  // Eine ABSAGE statt eines stillen „dann eben ohne Korrekturen": Wer in der
  // Vorschau Farben und Nummern geradegezogen hat und den Bestand danach ohne
  // sie bekommt, merkt es erst an den Karten — und hat die Arbeit zweimal.
  korrekturen_ungueltig:       { de: 'Die Korrekturen sind nicht lesbar (kein gültiges JSON-Array).',
                                 en: 'The corrections could not be read (not a valid JSON array).' },
  keine_wanted_liste:          { de: 'Das ist keine BrickLink-Wanted-Liste '
                                   + '(kein <INVENTORY> in der Datei).',
                                 en: 'This is not a BrickLink wanted list '
                                   + '(no <INVENTORY> in the file).' },
  id_ungueltig:                { de: 'Ungültige ID', en: 'Invalid ID' },

  // ── Betrieb und Verwaltung ───────────────────────────────────────────────
  nicht_gefunden:              { de: 'Nicht gefunden', en: 'Not found' },
  kaufpreis_nicht_gefunden:    { de: 'Kaufpreis nicht gefunden', en: 'Purchase not found' },
  datum_ungueltig:             { de: 'Ungültiges Datum', en: 'Invalid date' },
  erfassung_nicht_gefunden:    { de: 'Erfassung nicht gefunden', en: 'Entry not found' },
  datum_belegt:                { de: 'An diesem Datum existiert bereits ein Eintrag.',
                                 en: 'An entry already exists for that date.' },
  server_ausgelastet:          { de: 'Server ausgelastet', en: 'The server is busy' },
  zu_viele_verbindungen:       { de: 'Zu viele offene Verbindungen', en: 'Too many open connections' },
  zeitlimit:                   { de: 'Zeitlimit überschritten', en: 'Timed out' },
  wert_ungueltig:              { de: 'Ungültiger Wert', en: 'Invalid value' },
  uhrzeit_ungueltig:           { de: 'Ungültige Uhrzeit (HH:MM)', en: 'Invalid time (HH:MM)' },
  design_ungueltig:            { de: 'Ungültiges Design', en: 'Invalid theme' },
  tageslimit_bereich:          { de: 'Tageslimit muss zwischen 1 und 100000 liegen',
                                 en: 'The daily limit must be between 1 and 100000' },
  unbekannte_aufgabe:          { de: 'Unbekannte Aufgabe: {aufgabe}', en: 'Unknown task: {aufgabe}' },
  smtp_nicht_konfiguriert:     { de: 'SMTP nicht konfiguriert (Host oder Benutzername fehlt)',
                                 en: 'SMTP is not configured (host or username missing)' },
  keine_ziel_email:            { de: 'Keine Ziel-E-Mail-Adresse angegeben. Bitte eine E-Mail-Adresse eingeben.',
                                 en: 'No target email address given. Please enter one.' },
  url_ungueltig:               { de: 'Ungültige URL', en: 'Invalid URL' },
  url_fehlt_https:             { de: 'url fehlt oder ist kein https', en: 'url is missing or is not https' },
  host_nicht_erlaubt:          { de: 'Host nicht erlaubt: {host}', en: 'Host not allowed: {host}' },
  qr_ohne_basis_url:           { de: 'Der Server kennt seine eigene Adresse nicht: APP_BASE_URL ist nicht gesetzt. '
                                   + 'Ohne sie truege der QR-Code die Adresse aus der Browserzeile — und die App '
                                   + 'faende den Server ausserhalb des Heimnetzes nie wieder. Bitte APP_BASE_URL setzen.',
                                 en: 'The server does not know its own address: APP_BASE_URL is not set. Without it '
                                   + 'the QR code would carry the address from the browser bar, and the app would '
                                   + 'never find the server again outside the home network. Please set APP_BASE_URL.' },
} as const;

export type FehlerCode = keyof typeof FEHLER;

/**
 * Welche Sprache will dieser Anfragende sehen?
 * Ausführlich: docs/begruendungen/utils/fehlerTexte.ts.md#antwortsprache
 */
export function antwortSprache(req: { headers?: Record<string, any> } | undefined): Sprache {
  const roh = String(req?.headers?.['accept-language'] || '').toLowerCase();
  return roh.startsWith('en') || roh.includes(',en') ? 'en' : 'de';
}

/**
 * Einen Fehler WERFEN, der seinen Grund als Code traegt.
 * Ausführlich: docs/begruendungen/utils/fehlerTexte.ts.md#fehlerwerfen
 */
export function fehlerWerfen(code: FehlerCode, status: number): never {
  // Die deutsche Fassung als `message`, damit ein Protokolleintrag lesbar
  // bleibt; die Antwort an den Client entsteht aus `code`.
  const e: any = new Error(fehlerText(code, 'de'));
  e.status = status;
  e.code = code;
  throw e;
}

/** Der Text zu einem Code, mit eingesetzten Platzhaltern. */
export function fehlerText(
  code: FehlerCode, sprache: Sprache = 'de', vars?: Record<string, string | number>,
): string {
  const eintrag = FEHLER[code];
  // Warum hier gefragt wird, ob es den Eintrag gibt
  // Eine Fehlermeldung ist das Letzte, was selbst noch abstuerzen darf. Der
  // Code wird deshalb notfalls im Klartext durchgereicht: unschoen, aber
  // lesbar — und er sagt dem Protokoll, welcher Eintrag fehlt.
  // Ausführlich: docs/begruendungen/utils/fehlerTexte.ts.md#fehlertext
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

/**
 * Die eine Art, einen Fehler zu beantworten.
 *
 * `error` ist ein fertiger Satz in der Sprache des Anfragenden; `code` steht
 * daneben, damit ein Client darauf reagieren kann, ohne Text zu vergleichen.
 */
export function sendeFehler(
  req: any, res: any, status: number, code: FehlerCode, vars?: Record<string, string | number>,
): void {
  res.status(status).json({
    success: false,
    error: fehlerText(code, antwortSprache(req), vars),
    code,
  });
}
