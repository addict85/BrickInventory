package ch.brickinventoryapp.uistate

import ch.brickinventoryapp.model.text.Message

/**
 * The state of a fetch for the UI, one form for all screens instead of
 * one pair `loading`/`error` each: loading, data and error exclude each other,
 * and a `when` over it must name every case.
 */
sealed interface Load<out T> {
    data object Loads : Load<Nothing>

    /** [state]: time of the store if the data comes from it offline; null means fresh. */
    data class Data<out T>(val value: T, val state: Long? = null) : Load<T> {
        val offline: Boolean get() = state != null
    }

    /** No data: [kind] chooses icon and advice, [message] is the sentence for it. */
    data class Failure(val kind: ErrorClass, val message: Message) : Load<Nothing>
}

val Load<*>.loading: Boolean get() = this is Load.Loads

val Load<*>.errorMessage: Message? get() = (this as? Load.Failure)?.message

val Load<*>.errorKind: ErrorClass? get() = (this as? Load.Failure)?.kind

/** The data, as long as there is any; while loading and after an error null. */
fun <T> Load<T>.dataOrNull(): T? = (this as? Load.Data<T>)?.value
