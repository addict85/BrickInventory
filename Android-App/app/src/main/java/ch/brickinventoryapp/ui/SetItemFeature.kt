package ch.brickinventoryapp.ui

import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.data.repository.Result
import ch.brickinventoryapp.data.ScopeFilter
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * Detail-Dialog fuer ein Teil / eine Figur AUS EINEM SET.
 *
 * ── Marcos Wunsch ──────────────────────────────────────────────────────────
 * „Auch die automatisch erfassten Teile und Minifiguren sollen einen
 * Detail-Dialog inkl. Zoom haben. Der Marktpreis kann weggelassen werden, die
 * Anzahl soll nicht geaendert werden koennen. Dafuer soll angezeigt werden,
 * welche Sets dieses Teil und Minifigur verwenden."
 *
 * Bis hierher war die Kachel eines Teils aus einem Set TOT: kein Bild in
 * voller Groesse, keine Angabe, aus welchem Set es stammt. Manuell erfasste
 * Teile hatten laengst einen Dialog (ManualItemDetailScreen).
 *
 * ── Warum EINE Funktion fuer Teile und Figuren ─────────────────────────────
 * Der Server beantwortet beide Faelle mit derselben Funktion
 * (verwendendeSets in utils/handlers/shared.ts) und liefert dieselbe Form.
 * Zwei Funktionen hier waeren zwei Stellen fuer dieselbe Regel — und genau
 * daran ist in diesem Projekt schon mehrfach etwas auseinandergelaufen.
 *
 * Feature-Modul des MainViewModel, wie BarcodeFeature und die uebrigen:
 * Bildschirme greifen nicht selbst ans Repository (siehe
 * BildschirmHoltDatenNichtSelbstTest).
 */

/**
 * @param art "part" oder "fig"
 * @param colorId Farbe des Teils; bei Figuren ohne Bedeutung (0)
 */
internal fun MainViewModel.oeffneSetItem(art: String, nummer: String, colorId: Int = 0) {
    // Zuerst den Dialog OEFFNEN und dann laden — nicht umgekehrt. Sonst
    // passiert nach dem Tippen sekundenlang nichts sichtbares, und wer die
    // Kachel ein zweites Mal antippt, loest eine zweite Abfrage aus.
    _setItemState.value = SetItemUiState(
        art = art, nummer = nummer, colorId = colorId, laedt = true)
    viewModelScope.launch {
        // Blickfeld wie ueberall sonst: Im Haushalt gehoert auch das Set des
        // Geschwisterkontos dazu, sonst sagte der Dialog etwas anderes als die
        // Liste, aus der man kommt.
        val blick = scopeFor(
            if (art == "fig") ScopeFilter.View.MINIFIGS else ScopeFilter.View.PARTS)
        val r = if (art == "fig") repo.teile.getSetsMitFigur(nummer, blick)
                else              repo.teile.getSetsMitTeil(nummer, colorId, blick)
        // Zwischenzeitlich geschlossen oder ein anderes Teil geoeffnet? Dann
        // gehoert diese Antwort nicht mehr hierher. Ohne die Pruefung
        // ueberschriebe eine langsame erste Abfrage die schnelle zweite.
        val jetzt = _setItemState.value
        if (jetzt.art != art || jetzt.nummer != nummer || jetzt.colorId != colorId) return@launch
        when (r) {
            is Result.Success -> _setItemState.update {
                it.copy(laedt = false, kopf = r.data.item, sets = r.data.sets,
                        fehler = if (r.data.success) null else r.data.error)
            }
            is Result.Error -> _setItemState.update {
                it.copy(laedt = false, fehler = meldung(r))
            }
        }
    }
}

internal fun MainViewModel.schliesseSetItem() {
    _setItemState.value = SetItemUiState()
}

/**
 * Lagerort eines Teils setzen.
 *
 * ── Warum der Zustand danach von Hand nachgezogen wird ──────────────────────
 *
 * Der Dialog liest `kopf.storage` aus `_setItemState`. Ohne das Nachziehen
 * zeigte er nach dem Speichern weiter den alten Ort — der Server hat ihn zwar,
 * aber niemand fragt danach. Den ganzen Dialog neu zu laden waere der zweite
 * Weg: eine Abfrage mehr fuer eine Zahl, die schon in der Antwort steht.
 *
 * Der Server liefert den NORMALISIERTEN Ort zurueck (getrimmt, leer wird
 * null). Genau der wird uebernommen, nicht der getippte Text — sonst zeigte
 * der Dialog „ Kiste 3 " mit Leerzeichen, waehrend in der Datenbank „Kiste 3"
 * steht, und beim naechsten Oeffnen spraenge der Wert.
 */
internal fun MainViewModel.setzeTeilLagerort(nummer: String, farbe: Int, ort: String) {
    // Entprellt und im viewModelScope — dieselbe Mechanik und derselbe Grund
    // wie beim Set (setzeSetLagerort) und beim Preisalarm: Wer tippt, die
    // Tastatur schliesst und zurueckgeht, soll die Eingabe nicht verlieren;
    // und „Kiste 3" soll nicht fuenf halbe Orte im Vorrat hinterlassen.
    //
    // DERSELBE Auftrag wie beim Set: Es ist immer nur ein Lagerortfeld
    // sichtbar — entweder das des Sets oder das des Teils. Zwei Auftraege
    // waeren zwei Wege fuer dieselbe Sache.
    lagerJob?.cancel()
    lagerJob = viewModelScope.launch {
        kotlinx.coroutines.delay(ch.brickinventoryapp.alarm.Alarmeingabe.RUHE_MS)
        when (val r = repo.teile.setPartStorage(nummer, farbe, ort)) {
            is Result.Success -> {
                if (!r.data.success) { _snackbar.emit(r.data.error ?: ""); return@launch }
                _setItemState.update { z ->
                    z.copy(kopf = z.kopf?.copy(storage = r.data.storage))
                }
                // Die Teileliste im Hintergrund traegt den Ort ebenfalls.
                loadParts()
            }
            is Result.Error -> _snackbar.emit(meldung(r))
        }
    }
}
