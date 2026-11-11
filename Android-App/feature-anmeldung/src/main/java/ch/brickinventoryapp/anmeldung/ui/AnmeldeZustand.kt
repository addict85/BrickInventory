package ch.brickinventoryapp.anmeldung.ui

/**
 * Welches der drei Formulare der Anmeldebildschirm zeigt — dieselben wie in der
 * Webapp (`showPanel`).
 */
enum class AnmeldeFormular { ANMELDEN, REGISTRIEREN, PASSWORT_VERGESSEN }

/**
 * Anmelden, Konto anlegen und „Passwort vergessen“ — eigener Zustand, weil nur der
 * Anmeldebildschirm ihn liest. Ob man angemeldet ist (`isLoggedIn`), bleibt in
 * AppUiState: Daran hängt, ob die App überhaupt etwas zeigt.
 */
internal data class AnmeldeUiState(
    /**
     * Welches Formular offen ist — wie `showPanel` in der Webapp. Kein eigener
     * Navigationseintrag: Sonst bedeutete der Zurück-Knopf des Geräts etwas anderes
     * als „Zurück zur Anmeldung“.
     */
    val formular: AnmeldeFormular = AnmeldeFormular.ANMELDEN,
    /**
     * Steht die Registrierung offen? `null` = noch nicht gefragt; bei `null` und bei
     * `false` fehlt der Link — ein Knopf, der an einem 403 scheitert, ist schlechter
     * als keiner.
     */
    val registrierungOffen: Boolean? = null,
    /**
     * Die Antwort auf Registrieren oder „Passwort vergessen“ — der Satz des Servers.
     * Er antwortet absichtlich immer gleich, damit niemand erfährt, wer ein Konto hat;
     * eine eigene Erfolgsmeldung verriete es.
     */
    val meldung: String? = null,
    val fehler: String? = null,
    val laeuft: Boolean = false,
    /** Der Server verlangt beim Anmelden den Code des zweiten Faktors. */
    val codeNoetig: Boolean = false,
    /** Er nimmt statt des Codes auch einen Passkey (`passkey: true` in der Antwort). */
    val passkeyStattCode: Boolean = false,
    /**
     * Mit Verwalterrechten anmelden (Token-Scope "voll"). Aus, bis man es
     * ankreuzt: Ein Telefon geht leichter verloren als ein Rechner, und die
     * Verwaltung braucht man dort selten.
     */
    val vollerZugriff: Boolean = false,
    /** Läuft die ANMELDUNG (nicht Registrieren oder „Passwort vergessen")? */
    val loginLaeuft: Boolean = false,
    /**
     * Fehler des Anmeldeformulars. Bleibt stehen, solange man das Passwort
     * korrigiert — flüchtige Meldungen gehen in den Meldungskanal.
     */
    val loginError: String? = null,
    /** Der Code, den man nach einem QR-Scan im Browser eintippt; null ohne laufende Kopplung. */
    val qrBestaetigung: String? = null,
)
