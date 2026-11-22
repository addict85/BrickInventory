package ch.brickinventoryapp.session

import ch.brickinventoryapp.data.Darstellungsablage
import ch.brickinventoryapp.data.Sitzungsablage
import ch.brickinventoryapp.model.domain.Waehrung
import ch.brickinventoryapp.model.coroutines.ApplicationScope
import ch.brickinventoryapp.model.ui.theme.Design
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Currency and theme of the account in ONE place, the store. The [Sitzung] derives
 * them from it and never mirrors anything back: two paths in both directions would let
 * an old value overwrite the new one.
 */
interface Kontowerte {
    val waehrung: StateFlow<Waehrung>
    val design: StateFlow<Design>
    fun setCurrency(w: Waehrung)
    fun setzeDesign(d: Design)
}

/** In memory: for tests and previews without a store. */
class StorageAccountValues(waehrung: Waehrung = Waehrung.EUR, design: Design = Design.DEFAULT) : Kontowerte {
    private val _currency = MutableStateFlow(waehrung)
    private val _design = MutableStateFlow(design)
    override val waehrung: StateFlow<Waehrung> = _currency.asStateFlow()
    override val design: StateFlow<Design> = _design.asStateFlow()
    override fun setCurrency(w: Waehrung) { _currency.value = w }
    override fun setzeDesign(d: Design) { _design.value = d }
}

/**
 * From the store (DataStore). The first theme value comes from the synchronous
 * mirror, because the first frame is rendered before the first DataStore value arrives.
 */
@Singleton
class StoreAccountValues @Inject constructor(
    private val ablage: Sitzungsablage,
    darstellung: Darstellungsablage,
    @param:ApplicationScope private val bereich: CoroutineScope,
) : Kontowerte {
    override val waehrung: StateFlow<Waehrung> = ablage.currency.stateIn(bereich, SharingStarted.Eagerly, Waehrung.EUR)
    override val design: StateFlow<Design> =
        ablage.appTheme.stateIn(bereich, SharingStarted.Eagerly, darstellung.rememberedDesign())

    override fun setCurrency(w: Waehrung) { bereich.launch { ablage.saveCurrency(w) } }
    override fun setzeDesign(d: Design) { bereich.launch { ablage.saveAppTheme(d) } }
}
