package ch.brickinventoryapp.anmeldung.ui

/**
 * Der Aufruf an den Credential Manager. Er braucht eine Activity und die
 * Play-Dienste; das ViewModel braucht nur sein Ergebnis und bekommt die Abfrage
 * deshalb vom Bildschirm gereicht (im Test ein Fake).
 */
fun interface PasskeyAbfrage {
    /** [optionenJson]: die WebAuthn-Optionen des Servers, unverändert. */
    suspend fun hole(optionenJson: String): PasskeyErgebnis
}

sealed interface PasskeyErgebnis {
    /** Die Antwort des Authenticators als WebAuthn-JSON, für den Server. */
    data class Antwort(val json: String) : PasskeyErgebnis
    /** Dialog geschlossen: Das ist eine Entscheidung, kein Fehler. */
    data object Abgebrochen : PasskeyErgebnis
    data object KeinPasskey : PasskeyErgebnis
    data class Fehler(val grund: String?) : PasskeyErgebnis
}
