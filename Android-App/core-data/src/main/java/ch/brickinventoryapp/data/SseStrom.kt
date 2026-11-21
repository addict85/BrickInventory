package ch.brickinventoryapp.data

import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources

/** What an SSE stream delivers; everything except [Daten] is the last element of the flow. */
internal sealed interface SseEvent<out T> {
    data class Daten<T>(val wert: T) : SseEvent<T>

    /** The payload could not be read; [technical] belongs in the log, not on the screen. */
    data class Unlesbar(val technical: String?) : SseEvent<Nothing>

    /** The server has closed the stream. */
    data object Ended : SseEvent<Nothing>

    /**
     * [code] is the HTTP status if there was a response; [rumpf] its first 4 KB.
     * [noConnection]: the request never reached the server (host unknown, connection refused).
     */
    data class Gescheitert(
        val code: Int?,
        val rumpf: String?,
        val technical: String?,
        val noConnection: Boolean = false,
    ) : SseEvent<Nothing>
}

/**
 * An SSE connection as a cold flow; the connection stands as long as someone collects.
 * [lies] converts the payload per event. One that cannot be read ends the
 * stream as [SseEvent.Unlesbar] instead of disappearing: the caller would otherwise wait for
 * a completion event that never arrives.
 */
internal fun <T> sseStream(
    client: OkHttpClient,
    anfrage: Request,
    lies: (String) -> T,
): Flow<SseEvent<T>> = callbackFlow {
    val listener = object : EventSourceListener() {
        override fun onEvent(eventSource: EventSource, id: String?, type: String?, data: String) {
            if (data.isBlank()) return
            // Only read errors (SerializationException is an IllegalArgumentException);
            // everything else is an error in the code and should stand out.
            val wert = try {
                lies(data)
            } catch (e: IllegalArgumentException) {
                trySend(SseEvent.Unlesbar(e.message))
                close()
                return
            }
            trySend(SseEvent.Daten(wert))
        }

        override fun onClosed(eventSource: EventSource) {
            trySend(SseEvent.Ended)
            close()
        }

        override fun onFailure(eventSource: EventSource, t: Throwable?, response: Response?) {
            // The body must be read here: after returning the response is closed.
            val rumpf = response?.let { runCatching { it.peekBody(4096).string() }.getOrNull() }
            val neverArrived = t is java.net.UnknownHostException || t is java.net.ConnectException
            trySend(SseEvent.Gescheitert(response?.code, rumpf, t?.message, neverArrived))
            close()
        }
    }
    val quelle = EventSources.createFactory(client).newEventSource(anfrage, listener)
    awaitClose { quelle.cancel() }
}
