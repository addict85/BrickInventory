package ch.brickinventoryapp.teile.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.zustand.ui.viewmodel.Meldungen
import kotlinx.coroutines.launch

/**
 * Die Erfolgsmeldung nach dem Erfassen, samt Herkunft des Kaufpreises: BrickLink führt
 * zu vielen Teilen nur einen Zustand, der Server nennt in `price_from_condition`, aus
 * welchem der Wert stammt.
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
 * Die ändernden Wege von Teilen und Figuren: rufen und melden; die Listen ändert das
 * Repository in der Ablage. Ein Fehlschlag ohne Satz bleibt still — dann hat ihn die
 * Sitzungsschicht schon gemeldet.
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
