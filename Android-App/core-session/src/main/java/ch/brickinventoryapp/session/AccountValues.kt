package ch.brickinventoryapp.session

import ch.brickinventoryapp.data.AppearanceStore
import ch.brickinventoryapp.data.SessionStore
import ch.brickinventoryapp.model.coroutines.ApplicationScope
import ch.brickinventoryapp.model.domain.CurrencyCode
import ch.brickinventoryapp.model.ui.theme.Design
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Currency and theme of the account in ONE place, the store. The [Session] derives
 * them from it and never mirrors anything back: two paths in both directions would let
 * an old value overwrite the new one.
 */
interface AccountValues {
    val currency: StateFlow<CurrencyCode>
    val design: StateFlow<Design>
    fun setCurrency(w: CurrencyCode)
    fun setDesign(d: Design)
}

/**
 * From the store (DataStore). The first theme value comes from the synchronous
 * mirror, because the first frame is rendered before the first DataStore value arrives.
 */
@Singleton
class StoreAccountValues @Inject constructor(
    private val store: SessionStore,
    appearance: AppearanceStore,
    @param:ApplicationScope private val area: CoroutineScope,
) : AccountValues {
    override val currency: StateFlow<CurrencyCode> = store.currency.stateIn(area, SharingStarted.Eagerly, CurrencyCode.EUR)
    override val design: StateFlow<Design> =
        store.appTheme.stateIn(area, SharingStarted.Eagerly, appearance.rememberedDesign())

    override fun setCurrency(w: CurrencyCode) { area.launch { store.saveCurrency(w) } }
    override fun setDesign(d: Design) { area.launch { store.saveAppTheme(d) } }
}
