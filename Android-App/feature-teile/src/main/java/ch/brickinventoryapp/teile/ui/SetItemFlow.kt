package ch.brickinventoryapp.teile.ui

import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.model.fach.Postenart
import ch.brickinventoryapp.model.ui.Laden
import ch.brickinventoryapp.model.fach.UsageView
import ch.brickinventoryapp.zustand.ui.loadError
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * „In welchen Sets steckt das?“ für Teile- und Figuren-ViewModel: dieselbe Form, nur die
 * Abfrage unterscheidet sich. [afterHeader] bekommt die Besitzer, deren Lagerorte das Feld
 * vorschlagen soll.
 */
internal class SetItemFlow(
    private val scope: CoroutineScope,
    private val art: Postenart,
    private val abfrage: suspend (nummer: String, farbe: Int) -> Ergebnis<UsageView>,
    private val afterHeader: (besitzer: List<Int>) -> Unit,
) {
    private val _zustand = MutableStateFlow(SetItemUiState())
    val zustand: StateFlow<SetItemUiState> = _zustand.asStateFlow()

    fun oeffne(nummer: String, colorId: Int) {
        _zustand.value = SetItemUiState(art = art, nummer = nummer, colorId = colorId, abruf = Laden.Loads)
        scope.launch {
            val r = abfrage(nummer, colorId)
            // Inzwischen ein anderes geöffnet? Dann gehört die Antwort nicht mehr hierher.
            val jetzt = _zustand.value
            if (jetzt.art != art || jetzt.nummer != nummer || jetzt.colorId != colorId) return@launch
            when (r) {
                is Ergebnis.Erfolg -> {
                    _zustand.update { it.copy(abruf = Laden.Daten(Unit), kopf = r.data.kopf, sets = r.data.sets) }
                    // Die Vorschläge fürs Lagerortfeld gehören dem Besitzer, nicht dem Betrachter.
                    afterHeader(r.data.kopf?.ownerIds ?: emptyList())
                }
                is Ergebnis.Fehler -> _zustand.update { it.copy(abruf = loadError(r)) }
            }
        }
    }

    fun withLocation(ort: String?) = _zustand.update { z -> z.copy(kopf = z.kopf?.copy(storage = ort)) }

    fun schliesse() {
        _zustand.value = SetItemUiState()
    }
}
