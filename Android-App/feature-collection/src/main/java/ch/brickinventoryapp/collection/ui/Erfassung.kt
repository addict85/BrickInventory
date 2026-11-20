package ch.brickinventoryapp.collection.ui

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Die sichtbare Prüfung vor dem Erfassen eines Sets. Privater Fluss: Die
 * Anzeige muss an jedem Ausgang wieder verschwinden, und das lässt sich nur
 * prüfen, solange es genau zwei Wege gibt, sie zu setzen und zu räumen.
 */
internal class Erfassung {
    private val _state = MutableStateFlow(EntryUiState())
    val state: StateFlow<EntryUiState> = _state.asStateFlow()

    fun zeige(identifier: String, phase: CheckPhase) {
        _state.value = EntryUiState(check = CheckStep(identifier, phase))
    }

    fun fertig() {
        _state.value = EntryUiState()
    }
}
