package ch.brickinventoryapp.anmeldung.ui

/**
 * Der Aufruf an den Credential Manager. Er braucht eine Activity und die
 * Play-Dienste; das ViewModel braucht nur sein Ergebnis und bekommt die Abfrage
 * deshalb vom Bildschirm gereicht (im Test ein Fake).
 */
internal fun interface PasskeyQuery {
    /** [optionsJson]: die WebAuthn-Optionen des Servers, unverändert. */
    suspend fun fetch(optionsJson: String): PasskeyResult
}

internal sealed interface PasskeyResult {
    /** Die Antwort des Authenticators als WebAuthn-JSON, für den Server. */
    data class Antwort(val json: String) : PasskeyResult
    /** Dialog geschlossen: Das ist eine Entscheidung, kein Fehler. */
    data object Abgebrochen : PasskeyResult
    data object NoPasskey : PasskeyResult
    data class Fehler(val grund: String?) : PasskeyResult
}
