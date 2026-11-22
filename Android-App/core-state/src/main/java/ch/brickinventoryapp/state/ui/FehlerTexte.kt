package ch.brickinventoryapp.state.ui

import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.model.ui.Fehlerklasse
import ch.brickinventoryapp.model.ui.Laden
import ch.brickinventoryapp.model.ui.Meldung
import ch.brickinventoryapp.model.ui.Vorgang
import ch.brickinventoryapp.data.repository.errorTextToCode

/**
 * Which text resource belongs to which error? A dedicated, pure function
 * instead of a line in `meldung()`, so the mapping is testable without `Context` and without
 * the Android runtime. `meldung()` fetches the string and prefers the
 * server message — that needs a context, the mapping doesn't.
 */
fun fehlerTextId(f: Ergebnis.Fehler): Int = when (f) {
    is Ergebnis.Fehler.Netz, Ergebnis.Fehler.Abgebrochen -> R.string.err_network
    Ergebnis.Fehler.Zeitueberschreitung -> R.string.err_timeout
    is Ergebnis.Fehler.LeereAntwort -> R.string.err_empty_response
    is Ergebnis.Fehler.Server -> R.string.err_server
    is Ergebnis.Fehler.Absage -> R.string.err_abgesagt
    is Ergebnis.Fehler.Abgewiesen -> R.string.err_session_expired
    Ergebnis.Fehler.Klartext -> R.string.err_klartext
    is Ergebnis.Fehler.Unbekannt -> R.string.err_unknown
}

/**
 * The class of a loading error for icon, heading and advice (error class). A
 * status of 500 or above counts as server, even with its own message; a 4xx with a message is
 * information from the server (input, right), not a failure.
 */
fun errorClass(f: Ergebnis.Fehler): Fehlerklasse = when (f) {
    is Ergebnis.Fehler.Abgewiesen -> Fehlerklasse.LOGIN
    is Ergebnis.Fehler.Netz, Ergebnis.Fehler.Zeitueberschreitung, Ergebnis.Fehler.Abgebrochen -> Fehlerklasse.OFFLINE
    is Ergebnis.Fehler.LeereAntwort -> Fehlerklasse.SERVER
    is Ergebnis.Fehler.Server -> if (f.status >= 500 || f.message.isBlank()) Fehlerklasse.SERVER else Fehlerklasse.UNBEKANNT
    is Ergebnis.Fehler.Absage, Ergebnis.Fehler.Klartext, is Ergebnis.Fehler.Unbekannt -> Fehlerklasse.UNBEKANNT
}

/**
 * The string's placeholder, or null: only the text for [Ergebnis.Fehler.Server] carries
 * one (`%1$d` for the HTTP status). `getString()` doesn't reliably throw on a missing
 * argument, but silently returns a wrong text.
 */
fun errorTextArgument(f: Ergebnis.Fehler): Int? = (f as? Ergebnis.Fehler.Server)?.status

/**
 * The error as a message for the state, without a context and without a finished string: the server's
 * own message, otherwise the one for its code, otherwise the one for its kind. The technical cause belongs
 * in the log, not in the display.
 */
fun errorMessage(f: Ergebnis.Fehler): Meldung {
    if (f.message.isNotBlank()) return Meldung.Text(f.message)
    errorTextToCode(f.code)?.let { return Meldung.Resource(it) }
    return Meldung.Resource(fehlerTextId(f), listOfNotNull(errorTextArgument(f)))
}

/** A failed fetch for the state: kind for icon and advice, message for the string. */
fun loadError(f: Ergebnis.Fehler): Laden.Fehler = Laden.Fehler(errorClass(f), errorMessage(f))

/** A failed action for the state; the string is produced while drawing. */
fun gescheitert(f: Ergebnis.Fehler): Vorgang.Fehlgeschlagen = Vorgang.Fehlgeschlagen(errorMessage(f))

/** A fetch as [Laden]; the store's state goes along, so „offline“ stays visible. */
fun <T> Ergebnis<T>.loadAs(): Laden<T> = when (this) {
    is Ergebnis.Erfolg -> Laden.Daten(data, stand)
    is Ergebnis.Fehler -> loadError(this)
}

/**
 * Append the technical cause — but only where the string alone says nothing.
 */
internal fun withTechnicalCause(satz: String, f: Ergebnis.Fehler): String =
    if (f is Ergebnis.Fehler.Unbekannt && !f.technical.isNullOrBlank()) "$satz (${f.technical})"
    else satz
