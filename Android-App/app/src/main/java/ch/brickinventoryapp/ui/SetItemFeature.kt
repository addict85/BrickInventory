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
