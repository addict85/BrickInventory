package ch.brickinventoryapp.collection.ui

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * The visible check before entering a set. A private flow: the
 * display must disappear again at every exit, and that can only be
 * checked as long as there are exactly two paths to set and clear it.
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
