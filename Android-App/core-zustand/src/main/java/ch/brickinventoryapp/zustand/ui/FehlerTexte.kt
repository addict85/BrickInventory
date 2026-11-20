package ch.brickinventoryapp.zustand.ui

import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.model.ui.Fehlerklasse
import ch.brickinventoryapp.model.ui.Laden
import ch.brickinventoryapp.model.ui.Meldung
import ch.brickinventoryapp.model.ui.Vorgang
import ch.brickinventoryapp.data.repository.errorTextToCode

/**
 * Welche Textressource gehört zu welchem Fehler? Eine eigene, reine Funktion
 * statt einer Zeile in `meldung()`, damit die Zuordnung ohne `Context` und ohne
 * Android-Laufzeit prüfbar ist. `meldung()` holt den Satz und bevorzugt die
 * Servermeldung — das braucht einen Context, die Zuordnung nicht.
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
 * Die Klasse eines Ladefehlers für Symbol, Überschrift und Rat (Fehlerklasse). Ein
 * Status ab 500 zählt als Server, auch mit eigenem Satz; ein 4xx mit Satz ist eine
 * Auskunft des Servers (Eingabe, Recht), kein Ausfall.
 */
fun errorClass(f: Ergebnis.Fehler): Fehlerklasse = when (f) {
    is Ergebnis.Fehler.Abgewiesen -> Fehlerklasse.LOGIN
    is Ergebnis.Fehler.Netz, Ergebnis.Fehler.Zeitueberschreitung, Ergebnis.Fehler.Abgebrochen -> Fehlerklasse.OFFLINE
    is Ergebnis.Fehler.LeereAntwort -> Fehlerklasse.SERVER
    is Ergebnis.Fehler.Server -> if (f.status >= 500 || f.message.isBlank()) Fehlerklasse.SERVER else Fehlerklasse.UNBEKANNT
    is Ergebnis.Fehler.Absage, Ergebnis.Fehler.Klartext, is Ergebnis.Fehler.Unbekannt -> Fehlerklasse.UNBEKANNT
}

/**
 * Der Platzhalter des Satzes, oder null: Nur der Text zu [Ergebnis.Fehler.Server] trägt
 * einen (`%1$d` für den HTTP-Status). `getString()` wirft bei einem fehlenden Argument
 * nicht verlässlich, sondern liefert still einen falschen Text.
 */
fun errorTextArgument(f: Ergebnis.Fehler): Int? = (f as? Ergebnis.Fehler.Server)?.status

/**
 * Der Fehler als Meldung für den Zustand, ohne Context und ohne fertigen Satz: der Satz
 * des Servers, sonst der zu seinem Code, sonst der zur Art. Die technische Ursache gehört
 * ins Log, nicht in die Anzeige.
 */
fun errorMessage(f: Ergebnis.Fehler): Meldung {
    if (f.message.isNotBlank()) return Meldung.Text(f.message)
    errorTextToCode(f.code)?.let { return Meldung.Resource(it) }
    return Meldung.Resource(fehlerTextId(f), listOfNotNull(errorTextArgument(f)))
}

/** Ein gescheiterter Abruf für den Zustand: Art für Symbol und Rat, Meldung für den Satz. */
fun loadError(f: Ergebnis.Fehler): Laden.Fehler = Laden.Fehler(errorClass(f), errorMessage(f))

/** Eine gescheiterte Handlung für den Zustand; der Satz entsteht beim Zeichnen. */
fun gescheitert(f: Ergebnis.Fehler): Vorgang.Fehlgeschlagen = Vorgang.Fehlgeschlagen(errorMessage(f))

/** Ein Abruf als [Laden]; der Stand der Ablage geht mit, damit „offline“ sichtbar bleibt. */
fun <T> Ergebnis<T>.loadAs(): Laden<T> = when (this) {
    is Ergebnis.Erfolg -> Laden.Daten(data, stand)
    is Ergebnis.Fehler -> loadError(this)
}

/**
 * Die technische Ursache anhängen — aber nur, wo der Satz allein nichts sagt.
 */
internal fun withTechnicalCause(satz: String, f: Ergebnis.Fehler): String =
    if (f is Ergebnis.Fehler.Unbekannt && !f.technical.isNullOrBlank()) "$satz (${f.technical})"
    else satz
