package ch.brickinventoryapp.data

import ch.brickinventoryapp.network.util.NetworkPolicy
import ch.brickinventoryapp.security.Tresorbefund

/**
 * What a later invalidation needs: the server the token belongs to, the token
 * only encrypted, this server's pin and the origin the token is
 * bound to. If [herkunft] does not match [serverUrl], the token goes nowhere (Entwerter).
 */
data class Entwertungsauftrag(
    val serverUrl: String,
    val tokenSecret: String,
    val pin: String? = null,
    val herkunft: String? = NetworkPolicy.herkunft(serverUrl),
)

/** What the worker reads from its input. */
internal sealed interface JobState {
    data class Da(val job: Entwertungsauftrag) : JobState

    /** The key only works after unlocking; waiting for it is no failed attempt. */
    data object Gesperrt : JobState

    /** Nothing readable: no target to which the token could be sent. */
    data object Unlesbar : JobState
}

/**
 * The job as one ciphertext under the details' key. WorkManager's database
 * is not encrypted; if the address stood in the input data, it would reveal
 * to anyone who reads the file where the account lies.
 */
internal class Auftragsablage(
    private val verschluessle: (wert: String, bindung: String) -> String?,
    private val oeffne: (geheim: String, bindung: String) -> Tresorbefund,
) {
    /** null: currently not encryptable (locked); then nothing is put into the queue. */
    fun ablegen(job: Entwertungsauftrag): String? = verschluessle(asText(job), BINDING)

    fun lies(geheim: String): JobState = when (val b = oeffne(geheim, BINDING)) {
        is Tresorbefund.Readable -> fromText(b.klartext)?.let { JobState.Da(it) } ?: JobState.Unlesbar
        Tresorbefund.Gesperrt -> JobState.Gesperrt
        Tresorbefund.Weg -> JobState.Unlesbar
    }

    private companion object {
        const val BINDING = "entwertungsauftrag"
        const val VERSION = "1"

        // Lines instead of JSON: address, Base64 and origin contain no line break,
        // and that way the form stays checkable without serialization. Empty means „no value“.
        fun asText(a: Entwertungsauftrag): String =
            listOf(VERSION, a.serverUrl, a.tokenSecret, a.pin.orEmpty(), a.herkunft.orEmpty()).joinToString("\n")

        fun fromText(text: String): Entwertungsauftrag? {
            val teile = text.split('\n')
            if (teile.size != 5 || teile[0] != VERSION || teile[1].isBlank() || teile[2].isBlank()) return null
            val pin = teile[3].ifEmpty { null }
            // Without origin as with jobs of older versions: the server's (default value).
            return if (teile[4].isEmpty()) Entwertungsauftrag(teile[1], teile[2], pin)
                else Entwertungsauftrag(teile[1], teile[2], pin, teile[4])
        }
    }
}
