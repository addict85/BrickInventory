package ch.brickinventoryapp.parts.ui

import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.model.domain.Postenart
import ch.brickinventoryapp.model.ui.Laden
import ch.brickinventoryapp.model.domain.UsageView
import ch.brickinventoryapp.state.ui.loadError
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * "Which sets is this in?" for the parts and figures ViewModel: the same shape, only the
 * query differs. [afterHeader] gets the owners whose storage locations the field
 * should suggest.
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
            // A different one opened in the meantime? Then the answer no longer belongs here.
            val jetzt = _zustand.value
            if (jetzt.art != art || jetzt.nummer != nummer || jetzt.colorId != colorId) return@launch
            when (r) {
                is Ergebnis.Erfolg -> {
                    _zustand.update { it.copy(abruf = Laden.Daten(Unit), kopf = r.data.kopf, sets = r.data.sets) }
                    // The suggestions for the storage location field belong to the owner, not the viewer.
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
