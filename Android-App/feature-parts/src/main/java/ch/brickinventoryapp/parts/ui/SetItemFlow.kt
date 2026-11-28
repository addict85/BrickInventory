package ch.brickinventoryapp.parts.ui

import ch.brickinventoryapp.model.domain.ItemKind
import ch.brickinventoryapp.model.domain.UsageView
import ch.brickinventoryapp.model.outcome.Outcome
import ch.brickinventoryapp.state.ui.loadError
import ch.brickinventoryapp.uistate.Load
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
    private val kind: ItemKind,
    private val query: suspend (number: String, color: Int) -> Outcome<UsageView>,
    private val afterHeader: (owner: List<Int>) -> Unit,
) {
    private val _uiState = MutableStateFlow(SetItemUiState())
    val uiState: StateFlow<SetItemUiState> = _uiState.asStateFlow()

    fun open(number: String, colorId: Int) {
        _uiState.value = SetItemUiState(kind = kind, number = number, colorId = colorId, fetch = Load.Loads)
        scope.launch {
            val r = query(number, colorId)
            // A different one opened in the meantime? Then the answer no longer belongs here.
            val now = _uiState.value
            if (now.kind != kind || now.number != number || now.colorId != colorId) return@launch
            when (r) {
                is Outcome.Success -> {
                    _uiState.update { it.copy(fetch = Load.Data(Unit), header = r.data.header, sets = r.data.sets) }
                    // The suggestions for the storage location field belong to the owner, not the viewer.
                    afterHeader(r.data.header?.ownerIds ?: emptyList())
                }
                is Outcome.Failure -> _uiState.update { it.copy(fetch = loadError(r)) }
            }
        }
    }

    fun withLocation(location: String?) = _uiState.update { z -> z.copy(header = z.header?.copy(storage = location)) }

    fun shutDown() {
        _uiState.value = SetItemUiState()
    }
}
