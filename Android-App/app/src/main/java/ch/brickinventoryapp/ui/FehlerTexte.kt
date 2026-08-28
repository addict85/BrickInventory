package ch.brickinventoryapp.ui

import ch.brickinventoryapp.R
import ch.brickinventoryapp.data.repository.Fehlerart

/**
 * Welche Textressource gehört zu welcher [Fehlerart]?
 *
 * Bewusst eine EIGENE, reine Funktion und keine Zeile in `meldung()`
 * (Nachtrag 117): So braucht die Zuordnung keinen `Context` und ist damit ohne
 * Android-Laufzeit prüfbar. `meldung()` bleibt die Stelle, die den Satz
 * tatsächlich holt und die Servermeldung bevorzugt — das ist Verhalten, das
 * einen Context braucht; WELCHER Text zu welcher Ursache gehört, ist es nicht.
 *
 * Der Zuschnitt ist die eigentliche Lehre aus Punkt 1 der Durchsicht: Was
 * schwer prüfbar ist, ist meistens nicht zu kompliziert, sondern nur mit etwas
 * verwoben, das es nicht braucht.
 *
 * Kein `else`-Zweig: Eine neue Fehlerart soll den Build hier brechen, nicht
 * stillschweigend in einem Sammelfall landen — dieselbe Regel wie bei
 * [ch.brickinventoryapp.data.repository.Result].
 */
internal fun fehlerTextId(art: Fehlerart?): Int = when (art) {
    Fehlerart.NETZ               -> R.string.err_network
    Fehlerart.ZEIT               -> R.string.err_timeout
    Fehlerart.LEERE_ANTWORT      -> R.string.err_empty_response
    Fehlerart.SERVER             -> R.string.err_server
    Fehlerart.NICHT_ANGEMELDET   -> R.string.err_not_signed_in
    Fehlerart.VERBINDUNG_BEENDET -> R.string.err_connection_closed
    Fehlerart.SITZUNG_ABGELAUFEN -> R.string.err_session_expired
    Fehlerart.UNBEKANNT          -> R.string.err_unknown
    null                         -> R.string.err_unknown
}

/**
 * Braucht der Text zu dieser Ursache einen Platzhalter?
 *
 * Nur [Fehlerart.SERVER] trägt einen (`%1$d` für den HTTP-Code). Ohne diese
 * Unterscheidung müsste `meldung()` für jede Art raten, ob ein Argument
 * mitzugeben ist — und `getString()` mit einem überzähligen Argument wirft
 * nicht, sondern liefert stillschweigend denselben Text.
 */
internal fun fehlerTextBrauchtCode(art: Fehlerart?): Boolean = art == Fehlerart.SERVER
