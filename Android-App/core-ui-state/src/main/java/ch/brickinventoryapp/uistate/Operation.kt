package ch.brickinventoryapp.uistate

import ch.brickinventoryapp.model.text.Message

/**
 * An action of the user (save, send, export) in one form instead of a
 * pair `running`/`error`: it runs, is finished or failed with a reason, never
 * two of them at once. What delivers data is carried by [Load].
 */
sealed interface Operation {
    data object Done : Operation
    data object Running : Operation
    data class Failed(val message: Message) : Operation
}

val Operation.running: Boolean get() = this is Operation.Running

val Operation.errorMessage: Message? get() = (this as? Operation.Failed)?.message

/** Take away the reason when nobody shall see it any more; a running operation keeps running. */
fun Operation.withoutError(): Operation = if (this is Operation.Failed) Operation.Done else this

/** A finished operation: failed with a reason, without finished. */
fun ended(error: Message?): Operation = error?.let(Operation::Failed) ?: Operation.Done
