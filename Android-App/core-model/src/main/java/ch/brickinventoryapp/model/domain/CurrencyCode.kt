package ch.brickinventoryapp.model.domain

import kotlinx.serialization.Serializable

/**
 * A currency as ISO code. On the wire a mere text (value class), so that
 * nothing changes in the contract; in code an own type, so that no set name or
 * amount accidentally passes as a currency. The code is only checked by the display: an
 * unknown one it shows as text before the amount instead of discarding the response.
 */
@Serializable
@JvmInline
value class CurrencyCode(val code: String) {
    /** Empty means: the server named none. */
    val known: Boolean get() = code.isNotBlank()

    override fun toString(): String = code

    companion object {
        val EUR = CurrencyCode("EUR")
        val CHF = CurrencyCode("CHF")
        val NONE = CurrencyCode("")

        /** The choice in the settings; the same as in the web app. */
        val SELECTABLE = listOf(CHF, EUR, CurrencyCode("USD"), CurrencyCode("GBP"))
    }
}
