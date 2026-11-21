package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.repository.Ergebnis
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.transformLatest
import kotlinx.coroutines.launch
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import ch.brickinventoryapp.network.di.Rotationsanlass

/**
 * How a swap ended. DISCARDED: during the swap there was a sign-out, a new
 * sign-in or a server switch; the new token no longer belongs here.
 */
internal enum class Tauschergebnis { GETAUSCHT, ALREADY_SWAPPED, LATER, NEW_PAIR, DISCARDED }

/** What the swap sees of the store; [generation] counts sign-in, sign-out and server switch. */
data class TokenStatus(val token: String, val herkunft: String?, val generation: Long)

/**
 * The new token and the origin of the request that brought it (after rewriting and redirect).
 * Only these two values: the swap needs no more, and the wire format stays in core-data.
 */
data class SwappedToken(val token: String?, val herkunft: String?)

/**
 * Lock and generation for every write of the token. A swap can retry for up to
 * half a minute; if it saves blindly afterwards, the token
 * of the old account or server lands in the new session. That is why it only saves
 * if token, origin and generation are still the same — under the same
 * lock under which sign-in, sign-out and server switch write.
 */
internal class TokenLimit {
    private val lock = Mutex()
    @Volatile var generation: Long = 0
        private set

    /** For sign-in, sign-out, server switch: [newSession] ends running swaps. */
    suspend fun <T> schreibe(newSession: suspend () -> Boolean = { true }, block: suspend () -> T): T =
        lock.withLock {
            if (newSession()) generation++
            block()
        }

    /** Writes only if [jetzt] is still [vorher] and the token came from its origin. */
    suspend fun replaceIf(vorher: TokenStatus, requestOrigin: String?, jetzt: suspend () -> TokenStatus,
                             speichere: suspend () -> Unit): Boolean = lock.withLock {
        if (requestOrigin == null || requestOrigin != vorher.herkunft || jetzt() != vorher) return@withLock false
        speichere()
        true
    }

    /**
     * Mirrors a value of the disk into memory. The writes set memory
     * before the disk; a value that was already superseded on the way must not
     * turn it back. That is why it only applies if the disk still has it under the lock.
     */
    @OptIn(ExperimentalCoroutinesApi::class)
    suspend fun <P, R, T> mirror(
        strom: Flow<P>,
        jetzt: suspend () -> P,
        roh: (P) -> R,
        lies: suspend (R, suspend (T) -> Unit) -> Unit,
        setze: (T) -> Unit,
        gelesen: () -> Unit,
    ) {
        var erster = true
        strom.map(roh).distinctUntilChanged()
            .transformLatest { r -> lies(r) { emit(r to it) } }
            .collect { (r, wert) ->
                lock.withLock { if (roh(jetzt()) == r) setze(wert) }
                if (erster) { erster = false; gelesen() }
            }
    }
}

/**
 * Maximum duration of a sign-in, the same as the server's hard deadline
 * (APP_MAX_DURATION_DAYS in Web-App/src/account/tokenRequest.ts; the swap inherits it). The
 * check here is the second line: the app signs itself out and invalidates the
 * token instead of only noticing at the 401 that the chain has ended.
 */
internal const val TOKEN_MAX_DURATION_DAYS = 180L

internal fun loginOverdue(signedInAt: Long, jetzt: Long): Boolean =
    jetzt - signedInAt > TOKEN_MAX_DURATION_DAYS * 24 * 60 * 60 * 1000

/**
 * Swaps the token when the server requires it (header `X-Token-Rotation:
 * faellig` or 401 `token_rotation_noetig`). The new token is saved
 * BEFORE anyone uses it: if the app closed between response and saving,
 * only the old one would remain — and after the swap it only applies for 5 min.
 */
internal class TokenSwap(
    private val stand: suspend () -> TokenStatus,
    private val ersetze: suspend (vorher: TokenStatus, neu: String, requestOrigin: String?) -> Boolean,
    private val rotiere: suspend (alterToken: String) -> Ergebnis<SwappedToken>,
    private val clock: () -> Long = System::currentTimeMillis,
    private val pausen: List<Long> = listOf(2_000, 10_000, 30_000),
    /** For [faellig]: the application scope, so that the swap survives leaving a screen. */
    private val hintergrund: CoroutineScope,
    /** This is how long noetig() holds a thread of the OkHttp dispatcher. */
    private val warten: Long = NEEDED_WAIT_MS,
    /**
     * May a swap happen now? Not with a locked device: only a key without an unlock
     * condition would accept the new token, and that no longer exists (EntsperrVault).
     */
    private val bereit: () -> Boolean = { true },
) : Rotationsanlass {
    private val lock = Mutex()

    /** For the header: do not wait, the request itself succeeded. */
    override fun faellig(alterToken: String) {
        if (lock.isLocked) return
        hintergrund.launch { tausche(alterToken) }
    }

    /**
     * For 401 `token_rotation_noetig`, on OkHttp's network thread: waiting is
     * right here, the request needs the new token. „Already swapped“ also means
     * „signed in elsewhere meanwhile“ — hence only a token of the same
     * origin and generation as the rejected request.
     */
    override fun noetig(alterToken: String, herkunft: String?, generation: Long): String? = runBlocking {
        neededWaiting(alterToken, herkunft, generation)
    }

    /**
     * The network thread waits at most [warten]; the swap itself keeps running in the
     * application scope so that an already received token still gets saved.
     */
    suspend fun neededWaiting(alterToken: String, herkunft: String?, generation: Long): String? {
        val tausch = hintergrund.async { tausche(alterToken) }
        return when (withTimeoutOrNull(warten) { tausch.await() }) {
            null -> null
            Tauschergebnis.GETAUSCHT, Tauschergebnis.ALREADY_SWAPPED -> stand()
                .takeIf { herkunft != null && it.herkunft == herkunft && it.generation == generation }
                ?.token?.takeIf { it != alterToken && it.isNotBlank() }
            Tauschergebnis.LATER, Tauschergebnis.NEW_PAIR, Tauschergebnis.DISCARDED -> null
        }
    }

    suspend fun tausche(alterToken: String): Tauschergebnis = lock.withLock { swapLocked(alterToken) }

    private suspend fun swapLocked(alterToken: String): Tauschergebnis {
        val vorher = stand()
        if (vorher.token != alterToken) return Tauschergebnis.ALREADY_SWAPPED
        if (!bereit()) return Tauschergebnis.LATER
        val beginn = clock()
        for (attempt in 0..pausen.size) {
            // Signed out or different server: the old token does not go out once more.
            if (attempt > 0 && stand() != vorher) return Tauschergebnis.DISCARDED
            when (val r = rotiere(alterToken)) {
                is Ergebnis.Erfolg -> return succeeded(vorher, r.data)
                is Ergebnis.Fehler -> {
                    // 401: the old token no longer applies (overlap over, revoked).
                    if (r is Ergebnis.Fehler.Abgewiesen) return Tauschergebnis.NEW_PAIR
                    if (!r.transient) return Tauschergebnis.LATER
                    val pause = pausen.getOrNull(attempt) ?: break
                    if (clock() - beginn + pause > OVERLAP_MS) break
                    delay(pause)
                }
            }
        }
        return Tauschergebnis.LATER
    }

    /** A response without a new token is no swap; if the state no longer fits, it is discarded. */
    private suspend fun succeeded(vorher: TokenStatus, antwort: SwappedToken): Tauschergebnis {
        val neu = antwort.token?.takeIf { it.isNotBlank() } ?: return Tauschergebnis.LATER
        return if (ersetze(vorher, neu, antwort.herkunft)) Tauschergebnis.GETAUSCHT else Tauschergebnis.DISCARDED
    }

    companion object {
        /** This is how long the old token keeps applying after a swap (ueberlappung_sek: 300). */
        const val OVERLAP_MS = 300_000L

        /** Shorter than the api client's read timeout (60 s), longer than a successful swap. */
        const val NEEDED_WAIT_MS = 20_000L
    }
}
