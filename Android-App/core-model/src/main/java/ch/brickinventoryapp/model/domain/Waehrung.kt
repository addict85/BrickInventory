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
value class Waehrung(val code: String) {
    /** Empty means: the server named none. */
    val bekannt: Boolean get() = code.isNotBlank()

    override fun toString(): String = code

    companion object {
        val EUR = Waehrung("EUR")
        val CHF = Waehrung("CHF")
        val KEINE = Waehrung("")

        /** The choice in the settings; the same as in the web app. */
        val SELECTABLE = listOf(CHF, EUR, Waehrung("USD"), Waehrung("GBP"))
    }
}
