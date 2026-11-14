package ch.brickinventoryapp.zustand.ui

import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.model.ui.Fehlerklasse
import ch.brickinventoryapp.model.ui.Meldung
import ch.brickinventoryapp.data.repository.fehlerTextZuCode

/**
 * Welche Textressource gehört zu welchem Fehler? Eine eigene, reine Funktion
 * statt einer Zeile in `meldung()`, damit die Zuordnung ohne `Context` und ohne
 * Android-Laufzeit prüfbar ist. `meldung()` holt den Satz und bevorzugt die
 * Servermeldung — das braucht einen Context, die Zuordnung nicht.
 */
fun fehlerTextId(f: Ergebnis.Error): Int = when (f) {
    is Ergebnis.Error.Netz, Ergebnis.Error.Abgebrochen -> R.string.err_network
    Ergebnis.Error.Zeitueberschreitung -> R.string.err_timeout
    is Ergebnis.Error.LeereAntwort -> R.string.err_empty_response
    is Ergebnis.Error.Server -> R.string.err_server
    is Ergebnis.Error.Abgewiesen -> R.string.err_session_expired
    Ergebnis.Error.Klartext -> R.string.err_klartext
    is Ergebnis.Error.Unbekannt -> R.string.err_unknown
}

/**
 * Die Klasse eines Ladefehlers für Symbol, Überschrift und Rat (Fehlerklasse). Ein
 * Status ab 500 zählt als Server, auch mit eigenem Satz; ein 4xx mit Satz ist eine
 * Auskunft des Servers (Eingabe, Recht), kein Ausfall.
 */
fun fehlerklasse(f: Ergebnis.Error): Fehlerklasse = when (f) {
    is Ergebnis.Error.Abgewiesen -> Fehlerklasse.ANMELDUNG
    is Ergebnis.Error.Netz, Ergebnis.Error.Zeitueberschreitung, Ergebnis.Error.Abgebrochen -> Fehlerklasse.OFFLINE
    is Ergebnis.Error.LeereAntwort -> Fehlerklasse.SERVER
    is Ergebnis.Error.Server -> if (f.status >= 500 || f.message.isBlank()) Fehlerklasse.SERVER else Fehlerklasse.UNBEKANNT
    Ergebnis.Error.Klartext, is Ergebnis.Error.Unbekannt -> Fehlerklasse.UNBEKANNT
}

/**
 * Der Platzhalter des Satzes, oder null: Nur der Text zu [Ergebnis.Error.Server] trägt
 * einen (`%1$d` für den HTTP-Status). `getString()` wirft bei einem fehlenden Argument
 * nicht verlässlich, sondern liefert still einen falschen Text.
 */
fun fehlerTextArgument(f: Ergebnis.Error): Int? = (f as? Ergebnis.Error.Server)?.status

/**
 * Der Fehler als Meldung für den Zustand, ohne Context und ohne fertigen Satz: der Satz
 * des Servers, sonst der zu seinem Code, sonst der zur Art. Die technische Ursache gehört
 * ins Log, nicht in die Anzeige.
 */
fun fehlerMeldung(f: Ergebnis.Error): Meldung {
    if (f.message.isNotBlank()) return Meldung.Text(f.message)
    fehlerTextZuCode(f.code)?.let { return Meldung.Ressource(it) }
    return Meldung.Ressource(fehlerTextId(f), listOfNotNull(fehlerTextArgument(f)))
}

/**
 * Die technische Ursache anhängen — aber nur, wo der Satz allein nichts sagt.
 */
internal fun mitTechnischerUrsache(satz: String, f: Ergebnis.Error): String =
    if (f is Ergebnis.Error.Unbekannt && !f.technisch.isNullOrBlank()) "$satz (${f.technisch})"
    else satz
