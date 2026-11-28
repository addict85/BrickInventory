package ch.brickinventoryapp.session.testing

import ch.brickinventoryapp.model.appearance.Design
import ch.brickinventoryapp.model.domain.CurrencyCode
import ch.brickinventoryapp.session.AccountValues
import ch.brickinventoryapp.session.Session
import ch.brickinventoryapp.session.SessionState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Currency and theme in memory instead of the DataStore. */
class InMemoryAccountValues(currency: CurrencyCode = CurrencyCode.EUR, design: Design = Design.DEFAULT) : AccountValues {
    private val _currency = MutableStateFlow(currency)
    private val _design = MutableStateFlow(design)
    override val currency: StateFlow<CurrencyCode> = _currency.asStateFlow()
    override val design: StateFlow<Design> = _design.asStateFlow()
    override fun setCurrency(w: CurrencyCode) { _currency.value = w }
    override fun setDesign(d: Design) { _design.value = d }
}

/**
 * A session without Hilt. Unconfined: a change of [values] is in the state before the
 * setter returns, so a test needs no clock tick to see it.
 */
fun testSession(
    values: AccountValues = InMemoryAccountValues(),
    scope: CoroutineScope = CoroutineScope(Dispatchers.Unconfined),
): Session = SessionState(values, scope)
