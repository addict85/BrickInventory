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

/**
 * Die technische Ursache anhaengen — aber nur, wo der Satz allein nichts sagt.
 *
 * ── Woher das kommt ─────────────────────────────────────────────────────────
 *
 * Marcos Befund: „In der Android-App werden die Teile nicht angezeigt", dazu
 * die Meldung „Etwas ist schiefgelaufen". Das ist [Fehlerart.UNBEKANNT], der
 * Auffangzweig in RepoBasis fuer JEDE geworfene Ausnahme. Ihre Meldung wird
 * dort in `Result.Error(technisch = e.message)` gelegt — und NACHGEMESSEN von
 * niemandem gelesen: `grep -rn "\.technisch"` ueber den Hauptbaum ergab null
 * Treffer. Der Kommentar daneben sagt, sie stehe „jetzt im Log-Feld statt im
 * Satz"; das Feld gibt es, den Leser nicht.
 *
 * Die Folge war eine Fehlersuche ueber mehrere Runden, in der die App wusste,
 * was schiefging, und es niemandem sagte.
 *
 * ── Warum NUR bei UNBEKANNT ─────────────────────────────────────────────────
 *
 * Nachtrag 116 hat englischen Bibliothekstext bewusst aus den Meldungen
 * verbannt: „Socket closed" ist als Satz an einen Menschen nicht sinnvoll. Das
 * gilt weiter — fuer alle Ursachen, die einen eigenen, verstaendlichen Satz
 * haben (kein Netz, Zeitueberschreitung, Sitzung abgelaufen, Serverfehler mit
 * Code).
 *
 * „Etwas ist schiefgelaufen" ist kein solcher Satz. Er benennt nichts, und
 * ohne den technischen Zusatz bleibt dem Nutzer wie dem Entwickler nur Raten.
 * Hier ist der Bibliothekstext das Einzige, was ueberhaupt etwas aussagt.
 */
internal fun mitTechnischerUrsache(satz: String, art: Fehlerart?, technisch: String?): String =
    if ((art == Fehlerart.UNBEKANNT || art == null) && !technisch.isNullOrBlank()) "$satz ($technisch)"
    else satz
