package ch.brickinventoryapp.model.util

/**
 * Texts from the resources in the app's language. An interface without Android, so that
 * state and ViewModels get texts without holding a Context themselves.
 */
interface Textquelle {
    fun text(id: Int, vararg args: Any?): String
    fun menge(id: Int, anzahl: Int, vararg args: Any?): String
}
