/**
 * Die Fehlermeldungen des Servers — an EINER Stelle, in beiden Sprachen.
 *
 * ── Der Befund (Nachtrag 130) ───────────────────────────────────────────────
 *
 * Beide Oberflächen sind zweisprachig: Die Webapp hat 724 Übersetzungszeilen,
 * die Android-App 452 Texte. Der Server, der sie füttert, sprach nur Deutsch —
 * GEMESSEN: 125 Stellen schickten eine feste Zeichenkette, 80 verschiedene
 * Texte, davon 54 eindeutig deutsch. Und beide Clients zeigen sie unverändert
 * an:
 *
 *     Webapp   err.textContent = d.error || t('settings.error')
 *     App      _snackbar.value = r.data.error ?: text(R.string.…)
 *
 * Ein englischsprachiger Nutzer hatte damit eine vollständig englische
 * Oberfläche — bis etwas schiefging. Dann stand dort „Benutzername bereits
 * vergeben". In beiden Apps, gleichermassen.
 *
 * ── Warum die Sprache in der ANFRAGE steht und nicht am Konto ───────────────
 *
 * Der erste Entwurf war: Der Server schickt nur einen Schlüssel, und beide
 * Oberflächen übersetzen ihn selbst. Das hätte jeden dieser Texte DREIMAL
 * gebraucht — hier, in public/locales/*.js und in beiden strings.xml. 80 Texte
 * mal drei Orte mal zwei Sprachen: 480 Stellen, die auseinanderlaufen können.
 * Genau die Form, gegen die dieser Baum an einem Dutzend Stellen ankämpft.
 *
 * Deshalb andersherum: Der Client sagt in jeder Anfrage, welche Sprache er
 * gerade ZEIGT (`Accept-Language`), und bekommt den Text darin. Die Tabelle
 * steht einmal.
 *
 * Nicht die Spracheinstellung des KONTOS, obwohl der Server sie kennt: Die
 * Android-App lässt ihre Sprache unabhängig davon umstellen (per-App-Locale
 * seit Android 13), und ein Nutzer mit deutschem Konto auf einem englischen
 * Telefon bekäme sonst deutsche Fehler in einer englischen Oberfläche.
 *
 * ── `error` bleibt trotzdem ein Satz ────────────────────────────────────────
 *
 * Die Antwort trägt zusätzlich `code`. Wer will, kann darauf reagieren, statt
 * Text zu vergleichen — aber `error` bleibt ein fertiger Satz, weil eine
 * bereits installierte App-Version genau den anzeigt. Ein Schlüssel allein
 * hätte dort „benutzername_vergeben" auf den Bildschirm gebracht.
 *
 * ── Platzhalter ─────────────────────────────────────────────────────────────
 *
 * `{name}` wird aus dem `vars`-Objekt ersetzt. Bewusst benannt und nicht
 * nummeriert: Im Deutschen und im Englischen steht dasselbe Stück oft an
 * verschiedener Stelle im Satz.
 */

/** Die unterstützten Sprachen — dieselben zwei wie in beiden Oberflächen. */
export type Sprache = 'de' | 'en';

/**
 * Der Katalog.
 *
 * Zusammengeführt wurde dabei, was mehrfach dastand: „Kein Schreibrecht für
 * dieses Konto." stand an SECHS Stellen, „Keine Datei" an fünf, „Ungültiger
 * oder abgelaufener Token" an vier (einmal mit und einmal ohne Schlusspunkt),
 * und „Nur Admins" / „Nur für Admins" waren zwei Schreibweisen derselben
 * Absage. 80 Texte an 125 Stellen sind jetzt 76 Einträge.
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
  aktuelles_passwort_falsch:   { de: 'Aktuelles Passwort falsch', en: 'Current password is wrong' },
  alle_felder_erforderlich:    { de: 'Alle Felder erforderlich', en: 'All fields are required' },
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
  konto_bereits_verknuepft_eine_stufe: {
    de: 'Dieses Konto ist bereits mit einem Hauptkonto verknüpft. Konten lassen sich nur über eine Stufe verknüpfen.',
    en: 'This account is already linked to a main account. Accounts can only be linked one level deep.' },
  konto_hat_unterkonten:       {
    de: 'Dieses Konto hat bereits eigene Unterkonten. Konten lassen sich nur über eine Stufe verknüpfen.',
    en: 'This account already has sub-accounts of its own. Accounts can only be linked one level deep.' },
  einladender_ist_unterkonto:  {
    de: 'Das einladende Konto ist selbst ein Unterkonto. Konten lassen sich nur über eine Stufe verknüpfen.',
    en: 'The inviting account is itself a sub-account. Accounts can only be linked one level deep.' },
  waehrung_ungleich:           {
    de: 'Beide Konten müssen dieselbe Währung verwenden (Hauptkonto: {haupt}, dieses Konto: {unter}).',
    en: 'Both accounts must use the same currency (main account: {haupt}, this account: {unter}).' },
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
} as const;

export type FehlerCode = keyof typeof FEHLER;

/**
 * Welche Sprache will dieser Anfragende sehen?
 *
 * Aus `Accept-Language`, weil das der Client bei JEDER Anfrage mitschickt und
 * es die Sprache ist, die er GERADE zeigt. Kein Treffer → Deutsch, wie bisher.
 *
 * Bewusst kein Auswerten der Gewichtungen (`de;q=0.9, en;q=0.8`): Es gibt zwei
 * Sprachen, und beide Clients schicken genau eine. Ein vollständiger Parser
 * wäre Aufwand für einen Fall, den dieses Projekt nicht hat.
 */
export function antwortSprache(req: { headers?: Record<string, any> } | undefined): Sprache {
  const roh = String(req?.headers?.['accept-language'] || '').toLowerCase();
  return roh.startsWith('en') || roh.includes(',en') ? 'en' : 'de';
}

/**
 * Einen Fehler WERFEN, der seinen Grund als Code traegt.
 *
 * Fuer Helfer, die tief in einem Vorgang stecken und keine Antwort schreiben
 * (utils/household.ts, utils/setMove.ts): Sie werfen, die Route faengt, und
 * handleRouteError macht daraus die Antwort — in der Sprache des Anfragenden,
 * sofern es den Request kennt.
 *
 * Nur fuer Faelle, die der NUTZER lesen soll. Ein technischer Fehler (Treiber,
 * Netz) bleibt ein gewoehnlicher Error: handleRouteError ersetzt seine Meldung
 * bei 5xx in der Produktion ohnehin durch einen allgemeinen Satz.
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
