package ch.brickinventoryapp.ui

import kotlinx.coroutines.flow.update

/**
 * Sichtbare Prüfung vor dem Erfassen eines Sets.
 *
 * ── Warum es diese drei Funktionen gibt ─────────────────────────────────────
 * Die Anzeige wird an vier Stellen gesetzt (Barcode, Texterkennung, Galerie,
 * Katalog) und muss an JEDEM Ausgang wieder verschwinden — auch bei den
 * vorzeitigen `return@launch` und im Fehlerfall. Genau dort entsteht sonst der
 * Dauer-Dialog: Ein einziger übersehener Rückweg lässt ihn stehen, und die App
 * wirkt eingefroren.
 *
 * Deshalb sind es benannte Funktionen und kein `_erfassungState.update { … }`
 * an vierzehn Stellen: Der Wächter (SetPruefungAnzeigeTest) kann so prüfen,
 * dass jeder Aufruf von `zeigePruefung()` in einem `finally` landet — das ist
 * der einzige Rückweg, den man nicht vergessen kann.
 *
 * Was hier bewusst NICHT gemeldet wird, ist das Erfassen selbst. Marcos Regel:
 * „Erst das effektive Hinzufügen soll im Hintergrund passieren." Der Server
 * legt Metadaten und Bild an und schiebt Teile, Anleitungen und Preise selbst
 * in den Hintergrund — wer darauf wartet, wartet auf nichts.
 */
internal fun MainViewModel.zeigePruefung(bezeichner: String, phase: Pruefphase) {
    _erfassungState.update { it.copy(pruefung = Pruefschritt(bezeichner, phase)) }
}

/** Prüfung beendet — egal ob erfolgreich, erfolglos oder abgebrochen. */
internal fun MainViewModel.pruefungFertig() {
    _erfassungState.update { it.copy(pruefung = null) }
}

/**
 * Abbruch durch den Nutzer.
 *
 * Der Job wird abgebrochen UND die Anzeige sofort geräumt. Auf das `finally`
 * der Koroutine allein ist hier kein Verlass: Es läuft zwar auch beim
 * Abbrechen, aber erst wenn die Koroutine den Abbruch bemerkt — bei einer
 * hängenden Verbindung kann das dauern, und bis dahin stünde der Dialog weiter.
 * Der Nutzer soll den Scanner sofort wieder öffnen können.
 */
internal fun MainViewModel.brichPruefungAb() {
    erfassungsJob?.cancel()
    erfassungsJob = null
    pruefungFertig()
}
