package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.domain.ErrorCode
/**
 * Result of a server call — exactly two cases, so that every `when` is exhaustive
 * and a new variant breaks at every place that must handle it. Please
 * do not retrofit an `else` branch: it would silently swallow future cases.
 */
sealed class Outcome<out T> {
    /**
     * [state] is set when the data comes from the local store
     * (milliseconds since 1970, time of storing) — otherwise an old state would look
     * like a fresh one. [buffered]: the change lies in the outbox and goes out
     * as soon as the server is reachable; [data] is then a substitute, not a server response.
     */
    data class Success<T>(val data: T, val state: Long? = null, val buffered: Boolean = false) : Outcome<T>() {
        val stale: Boolean get() = state != null
    }
    /**
     * What went wrong, as a closed hierarchy instead of free fields: whoever branches by kind
     * writes an exhaustive `when`, and a new case breaks the
     * build there. The display (AppTexts.message()) forms the sentence, the data layer has
     * no Context and cannot translate.
     */
    sealed class Failure : Outcome<Nothing>() {
        /** The server's sentence to pass through, empty without one; it knows its cases better. */
        open val message: String get() = ""

        /** The server's error code: branching goes by it, the sentence changes with the language. */
        open val code: ErrorCode? get() = null

        /** Text of the cause, only for the log: library texts are English and no sentence to humans. */
        open val technical: String? get() = null

        /** The server was unreachable: a second attempt may succeed, the disk store may step in. */
        val transient: Boolean get() = when (this) {
            is Network, Timeout -> true
            Cancelled, is EmptyResponse, is Rejected, is Server, is Refusal, Plaintext, is Unknown -> false
        }

        /** Host not resolvable, connection refused or broken off on the way. */
        data class Network(override val technical: String? = null) : Failure()

        data object Timeout : Failure()

        /** Break in the middle of the event stream: whether the server already wrote is open — hence not temporary. */
        data object Cancelled : Failure()

        /** HTTP 2xx without body. */
        data class EmptyResponse(override val technical: String? = null) : Failure()

        /** HTTP 401: the token does not apply (any more). No network problem a retry fixes. */
        data class Rejected(override val message: String = "", override val code: ErrorCode? = null) : Failure()

        /** Every other HTTP error status, with the server's sentence and code if it sent any. */
        data class Server(
            val status: Int,
            override val message: String = "",
            override val code: ErrorCode? = null,
        ) : Failure()

        /**
         * HTTP 2xx with `success: false`: the server has answered and refused. As an error,
         * so that no caller has to check a success field that exists only in the wire format.
         */
        data class Refusal(override val message: String = "", override val code: ErrorCode? = null) : Failure()

        /** The server address is http; the app sends only via https (util/PlaintextRejected). */
        data object Plaintext : Failure()

        /** Every other exception, without closer classification. */
        data class Unknown(override val technical: String? = null) : Failure()
    }
}

/** Transform the data of a success; state and buffer stay, an error stays the same. */
internal inline fun <T, R> Outcome<T>.mapData(f: (T) -> R): Outcome<R> = when (this) {
    is Outcome.Success -> Outcome.Success(f(data), state, buffered)
    is Outcome.Failure -> this
}
