package ch.brickinventoryapp.parts.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.model.domain.Zustand
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.state.ui.viewmodel.Meldungen
import kotlinx.coroutines.launch

/**
 * The success message after entering, along with the origin of the purchase price: BrickLink
 * maps many parts to only one condition, and the server names in `price_from_condition`
 * which one the value comes from.
 */
internal fun entryMessage(meldungen: Meldungen, angelegt: Boolean, nummer: String?, priceFromState: Zustand?): String {
    val kopf = meldungen.text(if (angelegt) R.string.vm_added else R.string.vm_updated, nummer)
    val hinweis = when (priceFromState) {
        Zustand.NEU -> meldungen.text(R.string.price_from_other_condition_new)
        Zustand.GEBRAUCHT -> meldungen.text(R.string.price_from_other_condition_used)
        else -> null
    }
    return if (hinweis != null) "$kopf — $hinweis" else kopf
}

/**
 * The changing paths of parts and figures: call and report; the repository changes the
 * lists in the store. A failure without a sentence stays silent — then the
 * session layer has already reported it.
 */
internal fun ViewModel.aendere(
    meldungen: Meldungen, successSet: String, danach: () -> Unit = {},
    tun: suspend () -> Ergebnis<Unit>,
) {
    viewModelScope.launch {
        when (val r = tun()) {
            is Ergebnis.Erfolg -> {
                meldungen.zeige(successSet)
                danach()
            }
            is Ergebnis.Fehler -> meldungen.zeige(meldungen.meldungFuerSnackbar(r))
        }
    }
}
