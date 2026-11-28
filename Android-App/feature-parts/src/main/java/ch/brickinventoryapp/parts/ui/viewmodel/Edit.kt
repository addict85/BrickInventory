package ch.brickinventoryapp.parts.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.outcome.Outcome
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.state.ui.viewmodel.Messages
import kotlinx.coroutines.launch

/**
 * The success message after entering, along with the origin of the purchase price: BrickLink
 * maps many parts to only one condition, and the server names in `price_from_condition`
 * which one the value comes from.
 */
internal fun entryMessage(messages: Messages, created: Boolean, number: String?, priceFromState: Condition?): String {
    val header = messages.text(if (created) R.string.vm_added else R.string.vm_updated, number)
    val hint = when (priceFromState) {
        Condition.NEW -> messages.text(R.string.price_from_other_condition_new)
        Condition.USED -> messages.text(R.string.price_from_other_condition_used)
        else -> null
    }
    return if (hint != null) "$header — $hint" else header
}

/**
 * The changing paths of parts and figures: call and report; the repository changes the
 * lists in the store. A failure without a sentence stays silent — then the
 * session layer has already reported it.
 */
internal fun ViewModel.applyChangeTo(
    messages: Messages, successSet: String, after: () -> Unit = {},
    perform: suspend () -> Outcome<Unit>,
) {
    viewModelScope.launch {
        when (val r = perform()) {
            is Outcome.Success -> {
                messages.show(successSet)
                after()
            }
            is Outcome.Failure -> messages.show(messages.messageForSnackbar(r))
        }
    }
}
