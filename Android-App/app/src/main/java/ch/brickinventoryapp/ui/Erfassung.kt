package ch.brickinventoryapp.ui

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Die sichtbare Prüfung vor dem Erfassen eines Sets. Privater Fluss: Die
 * Anzeige muss an jedem Ausgang wieder verschwinden, und das lässt sich nur
 * prüfen, solange es genau zwei Wege gibt, sie zu setzen und zu räumen.
 */
internal class Erfassung {
    private val _state = MutableStateFlow(ErfassungUiState())
    val state: StateFlow<ErfassungUiState> = _state.asStateFlow()

    fun zeige(bezeichner: String, phase: Pruefphase) {
        _state.value = ErfassungUiState(pruefung = Pruefschritt(bezeichner, phase))
    }

    fun fertig() {
        _state.value = ErfassungUiState()
    }
}
