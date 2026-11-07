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

/** Was ein SSE-Strom liefert; alles ausser [Daten] ist das letzte Element des Flusses. */
internal sealed interface SseEreignis<out T> {
    data class Daten<T>(val wert: T) : SseEreignis<T>

    /** Die Nutzlast liess sich nicht lesen; [technisch] gehört ins Log, nicht auf den Schirm. */
    data class Unlesbar(val technisch: String?) : SseEreignis<Nothing>

    /** Der Server hat den Strom geschlossen. */
    data object Beendet : SseEreignis<Nothing>

    /** [code] ist der HTTP-Status, falls es eine Antwort gab; [rumpf] ihre ersten 4 KB. */
    data class Gescheitert(val code: Int?, val rumpf: String?, val technisch: String?) : SseEreignis<Nothing>
}

/**
 * Eine SSE-Verbindung als kalter Fluss; die Verbindung steht, solange jemand sammelt.
 * [lies] wandelt die Nutzlast je Ereignis. Eine, die sich nicht lesen lässt, beendet den
 * Strom als [SseEreignis.Unlesbar], statt zu verschwinden: Der Aufrufer wartet sonst auf
 * ein Abschlussereignis, das nie ankommt.
 */
internal fun <T> sseStrom(
    client: OkHttpClient,
    anfrage: Request,
    lies: (String) -> T,
): Flow<SseEreignis<T>> = callbackFlow {
    val hoerer = object : EventSourceListener() {
        override fun onEvent(eventSource: EventSource, id: String?, type: String?, data: String) {
            if (data.isBlank()) return
            // Nur Lesefehler (SerializationException ist eine IllegalArgumentException);
            // alles andere ist ein Fehler im Code und soll auffallen.
            val wert = try {
                lies(data)
            } catch (e: IllegalArgumentException) {
                trySend(SseEreignis.Unlesbar(e.message))
                close()
                return
            }
            trySend(SseEreignis.Daten(wert))
        }

        override fun onClosed(eventSource: EventSource) {
            trySend(SseEreignis.Beendet)
            close()
        }

        override fun onFailure(eventSource: EventSource, t: Throwable?, response: Response?) {
            // Der Rumpf muss hier gelesen werden: Nach der Rückkehr ist die Antwort zu.
            val rumpf = response?.let { runCatching { it.peekBody(4096).string() }.getOrNull() }
            trySend(SseEreignis.Gescheitert(response?.code, rumpf, t?.message))
            close()
        }
    }
    val quelle = EventSources.createFactory(client).newEventSource(anfrage, hoerer)
    awaitClose { quelle.cancel() }
}
