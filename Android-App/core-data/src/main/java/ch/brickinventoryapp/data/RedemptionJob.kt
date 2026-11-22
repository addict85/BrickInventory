package ch.brickinventoryapp.data

import ch.brickinventoryapp.network.util.NetworkPolicy
import ch.brickinventoryapp.security.VaultFinding

/**
 * What a later invalidation needs: the server the token belongs to, the token
 * only encrypted, this server's pin and the origin the token is
 * bound to. If [origin] does not match [serverUrl], the token goes nowhere (Entwerter).
 */
data class RedemptionJob(
    val serverUrl: String,
    val tokenSecret: String,
    val pin: String? = null,
    val origin: String? = NetworkPolicy.origin(serverUrl),
)

/** What the worker reads from its input. */
internal sealed interface JobState {
    data class Da(val job: RedemptionJob) : JobState

    /** The key only works after unlocking; waiting for it is no failed attempt. */
    data object LockedState : JobState

    /** Nothing readable: no target to which the token could be sent. */
    data object Unreadable : JobState
}

/**
 * The job as one ciphertext under the details' key. WorkManager's database
 * is not encrypted; if the address stood in the input data, it would reveal
 * to anyone who reads the file where the account lies.
 */
internal class JobStore(
    private val encrypt: (value: String, binding: String) -> String?,
    private val open: (secret: String, binding: String) -> VaultFinding,
) {
    /** null: currently not encryptable (locked); then nothing is put into the queue. */
    fun put(job: RedemptionJob): String? = encrypt(asText(job), BINDING)

    fun read(secret: String): JobState = when (val b = open(secret, BINDING)) {
        is VaultFinding.Readable -> fromText(b.plaintext)?.let { JobState.Da(it) } ?: JobState.Unreadable
        VaultFinding.LockedState -> JobState.LockedState
        VaultFinding.Gone -> JobState.Unreadable
    }

    private companion object {
        const val BINDING = "entwertungsauftrag"
        const val VERSION = "1"

        // Lines instead of JSON: address, Base64 and origin contain no line break,
        // and that way the form stays checkable without serialization. Empty means „no value“.
        fun asText(a: RedemptionJob): String =
            listOf(VERSION, a.serverUrl, a.tokenSecret, a.pin.orEmpty(), a.origin.orEmpty()).joinToString("\n")

        fun fromText(text: String): RedemptionJob? {
            val parts = text.split('\n')
            if (parts.size != 5 || parts[0] != VERSION || parts[1].isBlank() || parts[2].isBlank()) return null
            val pin = parts[3].ifEmpty { null }
            // Without origin as with jobs of older versions: the server's (default value).
            return if (parts[4].isEmpty()) RedemptionJob(parts[1], parts[2], pin)
                else RedemptionJob(parts[1], parts[2], pin, parts[4])
        }
    }
}
