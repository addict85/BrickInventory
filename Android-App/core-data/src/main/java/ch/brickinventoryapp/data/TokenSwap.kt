package ch.brickinventoryapp.data

import ch.brickinventoryapp.dataapi.account.SwappedToken
import ch.brickinventoryapp.model.outcome.Outcome
import ch.brickinventoryapp.network.di.RotationReason
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.transformLatest
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeoutOrNull

/**
 * How a swap ended. DISCARDED: during the swap there was a sign-out, a new
 * sign-in or a server switch; the new token no longer belongs here.
 */
internal enum class ExchangeOutcome { EXCHANGED, ALREADY_SWAPPED, LATER, NEW_PAIR, DISCARDED }

/** What the swap sees of the store; [generation] counts sign-in, sign-out and server switch. */
data class TokenStatus(val token: String, val origin: String?, val generation: Long)

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
    suspend fun <T> write(newSession: suspend () -> Boolean = { true }, block: suspend () -> T): T =
        lock.withLock {
            if (newSession()) generation++
            block()
        }

    /** Writes only if [now] is still [before] and the token came from its origin. */
    suspend fun replaceIf(before: TokenStatus, requestOrigin: String?, now: suspend () -> TokenStatus,
                             persist: suspend () -> Unit): Boolean = lock.withLock {
        if (requestOrigin == null || requestOrigin != before.origin || now() != before) return@withLock false
        persist()
        true
    }

    /**
     * Mirrors a value of the disk into memory. The writes set memory
     * before the disk; a value that was already superseded on the way must not
     * turn it back. That is why it only applies if the disk still has it under the lock.
     */
    @OptIn(ExperimentalCoroutinesApi::class)
    suspend fun <P, R, T> mirror(
        stream: Flow<P>,
        now: suspend () -> P,
        raw: (P) -> R,
        read: suspend (R, suspend (T) -> Unit) -> Unit,
        set: (T) -> Unit,
        onRead: () -> Unit,
    ) {
        var first = true
        stream.map(raw).distinctUntilChanged()
            .transformLatest { r -> read(r) { emit(r to it) } }
            .collect { (r, value) ->
                lock.withLock { if (raw(now()) == r) set(value) }
                if (first) { first = false; onRead() }
            }
    }
}

/**
 * Maximum duration of a sign-in, the server's default hard deadline for app tokens
 * (`Web-App/src/account/tokenRequest.ts`; the swap inherits it). The check here is the
 * second line: the app signs itself out and invalidates the token instead of only
 * noticing at the 401 that the chain has ended. A shorter server deadline still ends with that 401.
 */
internal const val TOKEN_MAX_DURATION_DAYS = 90L

/** This long before the end the app asks for a new sign-in, so it does not stop mid-use. */
internal const val LOGIN_WARNING_DAYS = 7L

private const val DAY_MS = 24L * 60 * 60 * 1000

internal fun loginOverdue(loggedInAt: Long, now: Long): Boolean =
    now - loggedInAt > TOKEN_MAX_DURATION_DAYS * DAY_MS

internal fun loginDueSoon(loggedInAt: Long, now: Long): Boolean =
    !loginOverdue(loggedInAt, now) && now - loggedInAt > (TOKEN_MAX_DURATION_DAYS - LOGIN_WARNING_DAYS) * DAY_MS

/**
 * Swaps the token when the server requires it (header `X-Token-Rotation:
 * faellig` or 401 `token_rotation_noetig`). The new token is saved
 * BEFORE anyone uses it: if the app closed between response and saving,
 * only the old one would remain — and after the swap it only applies for 5 min.
 */
internal class TokenSwap(
    private val state: suspend () -> TokenStatus,
    private val replace: suspend (before: TokenStatus, newValue: String, requestOrigin: String?) -> Boolean,
    private val rotate: suspend (oldToken: String) -> Outcome<SwappedToken>,
    private val clock: () -> Long = System::currentTimeMillis,
    private val pauses: List<Long> = listOf(2_000, 10_000, 30_000),
    /** For [due]: the application scope, so that the swap survives leaving a screen. */
    private val background: CoroutineScope,
    /** This is how long needed() holds a thread of the OkHttp dispatcher. */
    private val wait: Long = NEEDED_WAIT_MS,
    /**
     * May a swap happen now? Not with a locked device: only a key without an unlock
     * condition would accept the new token, and that no longer exists (UnlockVault).
     */
    private val ready: () -> Boolean = { true },
) : RotationReason {
    private val lock = Mutex()

    /** For the header: do not wait, the request itself succeeded. */
    override fun due(oldToken: String) {
        if (lock.isLocked) return
        background.launch { swap(oldToken) }
    }

    /**
     * For 401 `token_rotation_noetig`, on OkHttp's network thread: waiting is
     * right here, the request needs the new token. „Already swapped“ also means
     * „signed in elsewhere meanwhile“ — hence only a token of the same
     * origin and generation as the rejected request.
     */
    override fun needed(oldToken: String, origin: String?, generation: Long): String? = runBlocking {
        neededWaiting(oldToken, origin, generation)
    }

    /**
     * The network thread waits at most [wait]; the swap itself keeps running in the
     * application scope so that an already received token still gets saved.
     */
    suspend fun neededWaiting(oldToken: String, origin: String?, generation: Long): String? {
        val swapping = background.async { swap(oldToken) }
        return when (withTimeoutOrNull(wait) { swapping.await() }) {
            null -> null
            ExchangeOutcome.EXCHANGED, ExchangeOutcome.ALREADY_SWAPPED -> state()
                .takeIf { origin != null && it.origin == origin && it.generation == generation }
                ?.token?.takeIf { it != oldToken && it.isNotBlank() }
            ExchangeOutcome.LATER, ExchangeOutcome.NEW_PAIR, ExchangeOutcome.DISCARDED -> null
        }
    }

    suspend fun swap(oldToken: String): ExchangeOutcome = lock.withLock { swapLocked(oldToken) }

    private suspend fun swapLocked(oldToken: String): ExchangeOutcome {
        val before = state()
        if (before.token != oldToken) return ExchangeOutcome.ALREADY_SWAPPED
        if (!ready()) return ExchangeOutcome.LATER
        val begin = clock()
        for (attempt in 0..pauses.size) {
            // Signed out or different server: the old token does not go out once more.
            if (attempt > 0 && state() != before) return ExchangeOutcome.DISCARDED
            when (val r = rotate(oldToken)) {
                is Outcome.Success -> return succeeded(before, r.data)
                is Outcome.Failure -> {
                    // 401: the old token no longer applies (overlap over, revoked).
                    if (r is Outcome.Failure.Rejected) return ExchangeOutcome.NEW_PAIR
                    if (!r.transient) return ExchangeOutcome.LATER
                    val pause = pauses.getOrNull(attempt) ?: break
                    if (clock() - begin + pause > OVERLAP_MS) break
                    delay(pause)
                }
            }
        }
        return ExchangeOutcome.LATER
    }

    /** A response without a new token is no swap; if the state no longer fits, it is discarded. */
    private suspend fun succeeded(before: TokenStatus, response: SwappedToken): ExchangeOutcome {
        val newValue = response.token?.takeIf { it.isNotBlank() } ?: return ExchangeOutcome.LATER
        return if (replace(before, newValue, response.origin)) ExchangeOutcome.EXCHANGED else ExchangeOutcome.DISCARDED
    }

    companion object {
        /** This is how long the old token keeps applying after a swap (ueberlappung_sek: 300). */
        const val OVERLAP_MS = 300_000L

        /** Shorter than the api client's read timeout (60 s), longer than a successful swap. */
        const val NEEDED_WAIT_MS = 20_000L
    }
}
