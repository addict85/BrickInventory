package ch.brickinventoryapp.data

import ch.brickinventoryapp.contract.TokenRotation
import ch.brickinventoryapp.contract.testing.testTokenRotation
import ch.brickinventoryapp.data.repository.Outcome
import ch.brickinventoryapp.model.domain.ErrorCode
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.yield
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The swap of a token: save before using, only one at a time, on a
 * lost response a second attempt with the OLD token — and save nothing
 * if signed out meanwhile or the server was switched. The
 * store here uses the same [TokenLimit] as the PreferencesManager.
 *
 * Counter-checks:
 *   A  in TokenSwap `persist(newValue)` moved behind the `return` (not
 *      saved) → red “the new token is saved before the swap ends”
 *   B  the lock removed (`lock.withLock` → direct) → red “two requests with
 *      the header swap once” (both GETAUSCHT, thus rotated twice)
 *   C  on a transient error LATER immediately instead of again → red “a
 *      lost response is retried with the old token”
 *   D  the 401 branch removed → red “if the old one is no longer valid, pairing must be redone”
 * Counter-checks:
 *   E  in swapLocked() the check `state() != before` before the retry
 *      removed → red “a server switch during the retry …” (the old
 *      token still went out three times)
 *   F  in TokenLimit.replaceIf() `|| now() != before` removed → red
 *      “sign-out during the swap …” and “… even if the same token comes back”
 *   G  there `requestOrigin != before.origin` removed → red “a token from
 *      a different origin is not saved”
 *   H  in TokenLimit.write() `generation++` removed → red “… even if
 *      the same token comes back”
 *   I  loginOverdue() with `TOKEN_MAX_DURATION_DAYS * 24 * 60 * 1000`
 *      (minutes instead of hours) → red “after 90 days the sign-in is overdue …”
 * Counter-check:
 *   J  needed() again without origin and generation (`state().token.takeIf …`) →
 *      red “already swapped does not mean taking the token of another session”
 * Counter-check:
 *   N  loginDueSoon() without `!loginOverdue(…)` → red “in the last week the app asks …”
 * Counter-check:
 *   K  due() swaps with runBlocking in the caller instead of in the passed scope →
 *      red “due swaps in the application scope and returns immediately”
 * Counter-check (05.11.2026, measured with kotlinc locally; exchange-needed-without-deadline.patch):
 *   L  neededWaiting() waits for the swap without withTimeoutOrNull → red “needed
 *      waits at most the deadline, the swap keeps running” (no return after the deadline)
 * Counter-check:
 *   M  in swapLocked() the check `ready()` removed → red “with a locked device
 *      there is no swap …”; counter-checks/exchange-despite-lock.patch
 */
class TokenSwapTest {

    /** [background] takes up due(); without it a scope that nobody processes. */
    private class World(
        background: CoroutineScope = CoroutineScope(Job()),
        wait: Long = TokenSwap.NEEDED_WAIT_MS,
        ready: () -> Boolean = { true },
    ) {
        var saved = "alt"
        var origin: String? = HERE
        var responseOrigin: String? = HERE
        val limit = TokenLimit()
        val log = mutableListOf<String>()
        var responses: MutableList<Outcome<TokenRotation>> = mutableListOf()
        var brake: CompletableDeferred<Unit>? = null
        /** Runs in every call of the server, after the brake. */
        var rotateOn: suspend () -> Unit = {}

        fun state() = TokenStatus(saved, origin, limit.generation)

        /** Like PreferencesManager.clearSession() and saveServerUrl() with another server. */
        suspend fun logout() = limit.write { saved = ""; origin = null }
        suspend fun logIn(token: String, at: String) = limit.write { saved = token; origin = at }

        val swapping = TokenSwap(
            state = { state() },
            replace = { before, newValue, h ->
                limit.replaceIf(before, h, { state() }) { log += "speichere $newValue"; saved = newValue; origin = h }
            },
            rotate = { old ->
                log += "rotiere $old"
                brake?.await()
                rotateOn()
                when (val r = responses.removeFirstOrNull() ?: Outcome.Success(testTokenRotation(success = true, token = "neu"))) {
                    is Outcome.Success -> Outcome.Success(SwappedToken(r.data.token, responseOrigin))
                    is Outcome.Failure -> r
                }
            },
            pauses = listOf(1, 1, 1),
            background = background,
            wait = wait,
            ready = ready,
        )
    }

    private val lost: Outcome.Failure = Outcome.Failure.Network()

    @Test
    fun `with a locked device there is no swap, after unlocking there is`() = runTest {
        var locked = true
        val w = World(ready = { !locked })
        assertEquals(ExchangeOutcome.LATER, w.swapping.swap("alt"))
        assertEquals("The server saw no switch", emptyList<String>(), w.log)
        assertEquals("alt", w.saved)
        locked = false
        assertEquals(ExchangeOutcome.EXCHANGED, w.swapping.swap("alt"))
        assertEquals("neu", w.saved)
    }

    @Test
    fun `the new token is saved before the swap ends`() = runTest {
        val w = World()
        assertEquals(ExchangeOutcome.EXCHANGED, w.swapping.swap("alt"))
        assertEquals(listOf("rotiere alt", "speichere neu"), w.log)
        assertEquals("neu", w.saved)
        assertEquals(HERE, w.origin)
    }

    @Test
    fun `two requests with the header swap once`() = runTest {
        val w = World().apply { brake = CompletableDeferred() }
        val a = async { w.swapping.swap("alt") }
        val b = async { w.swapping.swap("alt") }
        repeat(5) { yield() }
        w.brake!!.complete(Unit)
        assertEquals(setOf(ExchangeOutcome.EXCHANGED, ExchangeOutcome.ALREADY_SWAPPED), setOf(a.await(), b.await()))
        assertEquals(listOf("rotiere alt", "speichere neu"), w.log)
    }

    @Test
    fun `a lost response is retried with the old token`() = runTest {
        val w = World().apply { responses = mutableListOf(lost, lost) }
        assertEquals(ExchangeOutcome.EXCHANGED, w.swapping.swap("alt"))
        assertEquals(listOf("rotiere alt", "rotiere alt", "rotiere alt", "speichere neu"), w.log)
    }

    @Test
    fun `if the old one is no longer valid, pairing must be redone`() = runTest {
        val w = World().apply { responses = mutableListOf(lost, Outcome.Failure.Rejected(code = ErrorCode.TOKEN_INVALID)) }
        assertEquals(ExchangeOutcome.NEW_PAIR, w.swapping.swap("alt"))
        assertEquals("alt", w.saved)
    }

    @Test
    fun `if the server stays silent, the old token stays`() = runTest {
        val w = World().apply { responses = MutableList(10) { lost } }
        assertEquals(ExchangeOutcome.LATER, w.swapping.swap("alt"))
        assertEquals("alt", w.saved)
        assertEquals(4, w.log.count { it == "rotiere alt" })
    }

    @Test
    fun `a server switch during the retry aborts the swap`() = runTest {
        val w = World().apply { responses = MutableList(10) { lost } }
        w.rotateOn = { if (w.origin == HERE) w.logout() }
        assertEquals(ExchangeOutcome.DISCARDED, w.swapping.swap("alt"))
        assertEquals("The old token went out again after the switch", listOf("rotiere alt"), w.log)
        assertEquals("", w.saved)
    }

    @Test
    fun `sign-out during the swap discards the new token`() = runTest {
        val w = World().apply { brake = CompletableDeferred() }
        val swapping = async { w.swapping.swap("alt") }
        repeat(5) { yield() }
        w.logout()
        w.brake!!.complete(Unit)
        assertEquals(ExchangeOutcome.DISCARDED, swapping.await())
        assertEquals("After signing out nobody is signed in", "", w.saved)
        assertFalse(w.log.toString(), w.log.any { it.startsWith("speichere") })
        assertEquals(null, w.swapping.needed("alt", HERE, w.limit.generation))
    }

    @Test
    fun `a swap that outlasts a sign-out does not save, even if the same token comes back`() = runTest {
        val w = World()
        w.rotateOn = { w.logout(); w.logIn("alt", HERE) }
        assertEquals(ExchangeOutcome.DISCARDED, w.swapping.swap("alt"))
        assertEquals("alt", w.saved)
    }

    @Test
    fun `a token from a different origin is not saved`() = runTest {
        val w = World().apply { responseOrigin = "https://anders.example:443" }
        assertEquals(ExchangeOutcome.DISCARDED, w.swapping.swap("alt"))
        assertEquals("alt", w.saved)
        w.responseOrigin = null
        assertEquals(ExchangeOutcome.DISCARDED, w.swapping.swap("alt"))
        assertEquals("alt", w.saved)
    }

    /** Review 6 M1: „already swapped“ was also „meanwhile signed in to the new server“. */
    @Test
    fun `already swapped does not mean taking the token of another session`() = runTest {
        val w = World()
        val g = w.limit.generation
        w.logout(); w.logIn("vom-neuen", "https://neu.example:443")
        assertEquals("Different origin and generation", null, w.swapping.needed("alt", HERE, g))
        assertEquals("Different generation", null, w.swapping.needed("alt", "https://neu.example:443", g))
        assertEquals("Different origin", null, w.swapping.needed("alt", HERE, w.limit.generation))
        // The same session: another request has just swapped, its token counts.
        assertEquals("vom-neuen", w.swapping.needed("alt", "https://neu.example:443", w.limit.generation))
        assertFalse(w.log.toString(), w.log.any { it.startsWith("rotiere") })
    }

    /** A silent server does not hold the network thread longer than the deadline; it is saved anyway. */
    @OptIn(ExperimentalCoroutinesApi::class)
    @Test
    fun `needed waits at most the deadline, the swap keeps running`() = runTest {
        val w = World(CoroutineScope(StandardTestDispatcher(testScheduler)), wait = 1_000).apply { brake = CompletableDeferred() }
        val waiting = async { w.swapping.neededWaiting("alt", HERE, w.limit.generation) }
        advanceTimeBy(999)
        assertFalse("Before the deadline, needed still waits", waiting.isCompleted)
        advanceTimeBy(2)
        assertTrue("After the deadline, needed returns", waiting.isCompleted)
        assertEquals(null, waiting.await())
        w.brake?.complete(Unit)
        advanceUntilIdle()
        assertEquals("The switch continued in the application scope", "neu", w.saved)
    }

    /** With the test clock instead of waiting: the swap runs only when the scope processes it. */
    @OptIn(ExperimentalCoroutinesApi::class)
    @Test
    fun `due swaps in the application scope and returns immediately`() = runTest {
        val w = World(CoroutineScope(StandardTestDispatcher(testScheduler))).apply { responses = mutableListOf(lost) }
        w.swapping.due("alt")
        assertEquals("due() switched in the caller", emptyList<String>(), w.log)
        advanceUntilIdle()
        assertEquals(listOf("rotiere alt", "rotiere alt", "speichere neu"), w.log)
        assertEquals("neu", w.saved)
    }

    @Test
    fun `after 90 days the sign-in is overdue, not before`() {
        val tag = 24L * 60 * 60 * 1000
        val at = 1_700_000_000_000L
        assertFalse(loginOverdue(at, at + 89 * tag))
        assertFalse(loginOverdue(at, at + 90 * tag))
        assertTrue(loginOverdue(at, at + 90 * tag + 1))
        assertFalse("A clock set back does not sign out", loginOverdue(at, at - tag))
    }

    @Test
    fun `in the last week the app asks for a new sign-in, not earlier and not after the end`() {
        val tag = 24L * 60 * 60 * 1000
        val at = 1_700_000_000_000L
        assertFalse(loginDueSoon(at, at + 83 * tag))
        assertTrue(loginDueSoon(at, at + 83 * tag + 1))
        assertTrue(loginDueSoon(at, at + 90 * tag))
        assertFalse("Expired is no longer a hint but signing out", loginDueSoon(at, at + 90 * tag + 1))
    }

    private companion object {
        const val HERE = "https://brick.example:443"
    }
}
