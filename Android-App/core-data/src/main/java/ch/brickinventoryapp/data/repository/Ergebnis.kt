package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.domain.Fehlercode
/**
 * Result of a server call — exactly two cases, so that every `when` is exhaustive
 * and a new variant breaks at every place that must handle it. Please
 * do not retrofit an `else` branch: it would silently swallow future cases.
 */
sealed class Ergebnis<out T> {
    /**
     * [stand] is set when the data comes from the local store
     * (milliseconds since 1970, time of storing) — otherwise an old state would look
     * like a fresh one. [gepuffert]: the change lies in the outbox and goes out
     * as soon as the server is reachable; [data] is then a substitute, not a server response.
     */
    data class Erfolg<T>(val data: T, val stand: Long? = null, val gepuffert: Boolean = false) : Ergebnis<T>() {
        val veraltet: Boolean get() = stand != null
    }
    /**
     * What went wrong, as a closed hierarchy instead of free fields: whoever branches by kind
     * writes an exhaustive `when`, and a new case breaks the
     * build there. The display (AppTexte.meldung()) forms the sentence, the data layer has
     * no Context and cannot translate.
     */
    sealed class Fehler : Ergebnis<Nothing>() {
        /** The server's sentence to pass through, empty without one; it knows its cases better. */
        open val message: String get() = ""

        /** The server's error code: branching goes by it, the sentence changes with the language. */
        open val code: Fehlercode? get() = null

        /** Text of the cause, only for the log: library texts are English and no sentence to humans. */
        open val technical: String? get() = null

        /** The server was unreachable: a second attempt may succeed, the disk store may step in. */
        val transient: Boolean get() = when (this) {
            is Netz, Zeitueberschreitung -> true
            Abgebrochen, is LeereAntwort, is Abgewiesen, is Server, is Absage, Klartext, is Unbekannt -> false
        }

        /** Host not resolvable, connection refused or broken off on the way. */
        data class Netz(override val technical: String? = null) : Fehler()

        data object Zeitueberschreitung : Fehler()

        /** Break in the middle of the event stream: whether the server already wrote is open — hence not temporary. */
        data object Abgebrochen : Fehler()

        /** HTTP 2xx without body. */
        data class LeereAntwort(override val technical: String? = null) : Fehler()

        /** HTTP 401: the token does not apply (any more). No network problem a retry fixes. */
        data class Abgewiesen(override val message: String = "", override val code: Fehlercode? = null) : Fehler()

        /** Every other HTTP error status, with the server's sentence and code if it sent any. */
        data class Server(
            val status: Int,
            override val message: String = "",
            override val code: Fehlercode? = null,
        ) : Fehler()

        /**
         * HTTP 2xx with `success: false`: the server has answered and refused. As an error,
         * so that no caller has to check a success field that exists only in the wire format.
         */
        data class Absage(override val message: String = "", override val code: Fehlercode? = null) : Fehler()

        /** The server address is http; the app sends only via https (util/PlaintextRejected). */
        data object Klartext : Fehler()

        /** Every other exception, without closer classification. */
        data class Unbekannt(override val technical: String? = null) : Fehler()
    }
}

/** Transform the data of a success; state and buffer stay, an error stays the same. */
internal inline fun <T, R> Ergebnis<T>.shown(f: (T) -> R): Ergebnis<R> = when (this) {
    is Ergebnis.Erfolg -> Ergebnis.Erfolg(f(data), stand, gepuffert)
    is Ergebnis.Fehler -> this
}
