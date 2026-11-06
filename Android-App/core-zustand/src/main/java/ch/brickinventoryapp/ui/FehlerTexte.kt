package ch.brickinventoryapp.ui

import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.data.repository.Fehlerart
import ch.brickinventoryapp.data.repository.Ergebnis

/**
 * Welche Textressource gehört zu welcher [Fehlerart]? Eine eigene, reine Funktion
 * statt einer Zeile in `meldung()`, damit die Zuordnung ohne `Context` und ohne
 * Android-Laufzeit prüfbar ist. `meldung()` holt den Satz und bevorzugt die
 * Servermeldung — das braucht einen Context, die Zuordnung nicht.
 * Ausführlich: docs/begruendungen/core-zustand/ui/FehlerTexte.kt.md#fehlertextid
 */
fun fehlerTextId(art: Fehlerart?): Int = when (art) {
    Fehlerart.NETZ               -> R.string.err_network
    Fehlerart.ZEIT               -> R.string.err_timeout
    Fehlerart.LEERE_ANTWORT      -> R.string.err_empty_response
    Fehlerart.SERVER             -> R.string.err_server
    Fehlerart.NICHT_ANGEMELDET   -> R.string.err_not_signed_in
    Fehlerart.VERBINDUNG_BEENDET -> R.string.err_connection_closed
    Fehlerart.SITZUNG_ABGELAUFEN -> R.string.err_session_expired
    Fehlerart.KLARTEXT           -> R.string.err_klartext
    Fehlerart.UNBEKANNT          -> R.string.err_unknown
    null                         -> R.string.err_unknown
}

/**
 * Die Klasse eines Ladefehlers für Symbol, Überschrift und Rat (Fehlerklasse). Ein 401
 * zählt als Anmeldung, auch wenn die Datenschicht keine Art kennt; ein HTTP-Code ab
 * 500 als Server, auch wenn der Server einen eigenen Satz mitschickt.
 */
fun fehlerklasse(f: Ergebnis.Error): Fehlerklasse = when {
    f.unauthorized || f.art == Fehlerart.NICHT_ANGEMELDET || f.art == Fehlerart.SITZUNG_ABGELAUFEN -> Fehlerklasse.ANMELDUNG
    f.art == Fehlerart.NETZ || f.art == Fehlerart.ZEIT || f.art == Fehlerart.VERBINDUNG_BEENDET -> Fehlerklasse.OFFLINE
    f.art == Fehlerart.SERVER || f.art == Fehlerart.LEERE_ANTWORT || (f.httpCode ?: 0) >= 500 -> Fehlerklasse.SERVER
    else -> Fehlerklasse.UNBEKANNT
}

/**
 * Braucht der Text zu dieser Ursache einen Platzhalter? Nur [Fehlerart.SERVER]
 * trägt einen (`%1$d` für den HTTP-Code). Ohne die Unterscheidung müsste
 * `meldung()` raten — und `getString()` wirft bei einem fehlenden Argument nicht
 * verlässlich, sondern liefert still einen falschen Text.
 */
fun fehlerTextBrauchtCode(art: Fehlerart?): Boolean = art == Fehlerart.SERVER

/**
 * Die technische Ursache anhängen — aber nur, wo der Satz allein nichts sagt.
 * Ausführlich: docs/begruendungen/core-zustand/ui/FehlerTexte.kt.md#mittechnischerursache
 */
internal fun mitTechnischerUrsache(satz: String, art: Fehlerart?, technisch: String?): String =
    if ((art == Fehlerart.UNBEKANNT || art == null) && !technisch.isNullOrBlank()) "$satz ($technisch)"
    else satz
