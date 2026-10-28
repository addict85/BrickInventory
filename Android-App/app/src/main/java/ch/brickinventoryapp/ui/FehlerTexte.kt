package ch.brickinventoryapp.ui

import ch.brickinventoryapp.R
import ch.brickinventoryapp.data.repository.Fehlerart

/**
 * Welche Textressource gehört zu welcher [Fehlerart]? Eine eigene, reine Funktion
 * statt einer Zeile in `meldung()`, damit die Zuordnung ohne `Context` und ohne
 * Android-Laufzeit prüfbar ist. `meldung()` holt den Satz und bevorzugt die
 * Servermeldung — das braucht einen Context, die Zuordnung nicht.
 *
 * Kein `else`-Zweig: Eine neue Fehlerart soll den Build hier brechen, nicht still
 * in einem Sammelfall landen — wie bei
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
 * Braucht der Text zu dieser Ursache einen Platzhalter? Nur [Fehlerart.SERVER]
 * trägt einen (`%1$d` für den HTTP-Code). Ohne die Unterscheidung müsste
 * `meldung()` raten — und `getString()` wirft bei einem fehlenden Argument nicht
 * verlässlich, sondern liefert still einen falschen Text.
 */
internal fun fehlerTextBrauchtCode(art: Fehlerart?): Boolean = art == Fehlerart.SERVER

/**
 * Die technische Ursache anhängen — aber nur, wo der Satz allein nichts sagt.
 *
 * Nur bei [Fehlerart.UNBEKANNT], dem Auffangzweig in RepoBasis für jede geworfene
 * Ausnahme. Ursachen mit eigenem, verständlichem Satz (kein Netz,
 * Zeitüberschreitung, Sitzung abgelaufen, Serverfehler mit Code) bekommen keinen
 * englischen Bibliothekstext — „Socket closed“ ist kein Satz an einen Menschen.
 * „Etwas ist schiefgelaufen“ benennt dagegen nichts; dort ist der Bibliothekstext
 * das Einzige, was etwas aussagt, und ohne ihn bliebe Nutzer wie Entwickler nur
 * Raten.
 */
internal fun mitTechnischerUrsache(satz: String, art: Fehlerart?, technisch: String?): String =
    if ((art == Fehlerart.UNBEKANNT || art == null) && !technisch.isNullOrBlank()) "$satz ($technisch)"
    else satz
