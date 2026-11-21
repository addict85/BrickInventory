package ch.brickinventoryapp.model.ui

/**
 * The state of a fetch for the UI, one form for all screens instead of
 * one pair `laedt`/`fehler` each: loading, data and error exclude each other,
 * and a `when` over it must name every case.
 */
sealed interface Laden<out T> {
    data object Loads : Laden<Nothing>

    /** [stand]: time of the store if the data comes from it offline; null means fresh. */
    data class Daten<out T>(val wert: T, val stand: Long? = null) : Laden<T> {
        val offline: Boolean get() = stand != null
    }

    /** No data: [art] chooses icon and advice, [meldung] is the sentence for it. */
    data class Fehler(val art: Fehlerklasse, val meldung: Meldung) : Laden<Nothing>
}

val Laden<*>.laedt: Boolean get() = this is Laden.Loads

val Laden<*>.errorMessage: Meldung? get() = (this as? Laden.Fehler)?.meldung

val Laden<*>.errorKind: Fehlerklasse? get() = (this as? Laden.Fehler)?.art

/** The data, as long as there is any; while loading and after an error null. */
fun <T> Laden<T>.dataOrNull(): T? = (this as? Laden.Daten<T>)?.wert
