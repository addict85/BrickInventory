package ch.brickinventoryapp.state.ui

import ch.brickinventoryapp.data.repository.errorTextToCode
import ch.brickinventoryapp.model.outcome.Outcome
import ch.brickinventoryapp.model.text.Message
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.uistate.ErrorClass
import ch.brickinventoryapp.uistate.Load
import ch.brickinventoryapp.uistate.Operation

/**
 * Which text resource belongs to which error? A dedicated, pure function
 * instead of a line in `message()`, so the mapping is testable without `Context` and without
 * the Android runtime. `message()` fetches the string and prefers the
 * server message — that needs a context, the mapping doesn't.
 */
fun errorTextId(f: Outcome.Failure): Int = when (f) {
    is Outcome.Failure.Network, Outcome.Failure.Cancelled -> R.string.err_network
    Outcome.Failure.Timeout -> R.string.err_timeout
    is Outcome.Failure.EmptyResponse -> R.string.err_empty_response
    is Outcome.Failure.Server -> R.string.err_server
    is Outcome.Failure.Refusal -> R.string.err_cancelled
    is Outcome.Failure.Rejected -> R.string.err_session_expired
    Outcome.Failure.Plaintext -> R.string.err_plaintext
    is Outcome.Failure.Unknown -> R.string.err_unknown
}

/**
 * The class of a loading error for icon, heading and advice (error class). A
 * status of 500 or above counts as server, even with its own message; a 4xx with a message is
 * information from the server (input, right), not a failure.
 */
fun errorClass(f: Outcome.Failure): ErrorClass = when (f) {
    is Outcome.Failure.Rejected -> ErrorClass.LOGIN
    is Outcome.Failure.Network, Outcome.Failure.Timeout, Outcome.Failure.Cancelled -> ErrorClass.OFFLINE
    is Outcome.Failure.EmptyResponse -> ErrorClass.SERVER
    is Outcome.Failure.Server -> if (f.status >= 500 || f.message.isBlank()) ErrorClass.SERVER else ErrorClass.UNKNOWN
    is Outcome.Failure.Refusal, Outcome.Failure.Plaintext, is Outcome.Failure.Unknown -> ErrorClass.UNKNOWN
}

/**
 * The string's placeholder, or null: only the text for [Outcome.Failure.Server] carries
 * one (`%1$d` for the HTTP status). `getString()` doesn't reliably throw on a missing
 * argument, but silently returns a wrong text.
 */
fun errorTextArgument(f: Outcome.Failure): Int? = (f as? Outcome.Failure.Server)?.status

/**
 * The error as a message for the state, without a context and without a finished string: the server's
 * own message, otherwise the one for its code, otherwise the one for its kind. The technical cause belongs
 * in the log, not in the display.
 */
fun errorMessage(f: Outcome.Failure): Message {
    if (f.message.isNotBlank()) return Message.Text(f.message)
    errorTextToCode(f.code)?.let { return Message.Resource(it) }
    return Message.Resource(errorTextId(f), listOfNotNull(errorTextArgument(f)))
}

/** A failed fetch for the state: kind for icon and advice, message for the string. */
fun loadError(f: Outcome.Failure): Load.Failure = Load.Failure(errorClass(f), errorMessage(f))

/** A failed action for the state; the string is produced while drawing. */
fun failed(f: Outcome.Failure): Operation.Failed = Operation.Failed(errorMessage(f))

/** A fetch as [Load]; the store's state goes along, so „offline“ stays visible. */
fun <T> Outcome<T>.loadAs(): Load<T> = when (this) {
    is Outcome.Success -> Load.Data(data, state)
    is Outcome.Failure -> loadError(this)
}

/** Only whether a side fetch worked, for a `…Fetch` field next to the data it fills. */
fun Outcome<*>.fetched(): Load<Unit> = when (this) {
    is Outcome.Success -> Load.Data(Unit, state)
    is Outcome.Failure -> loadError(this)
}

/**
 * Append the technical cause — but only where the string alone says nothing.
 */
internal fun withTechnicalCause(sentence: String, f: Outcome.Failure): String =
    if (f is Outcome.Failure.Unknown && !f.technical.isNullOrBlank()) "$sentence (${f.technical})"
    else sentence
