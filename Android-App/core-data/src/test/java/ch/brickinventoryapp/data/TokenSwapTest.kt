package ch.brickinventoryapp.data

import kotlinx.coroutines.test.advanceTimeBy
import ch.brickinventoryapp.model.domain.Fehlercode
import ch.brickinventoryapp.contract.TokenRotation
import ch.brickinventoryapp.data.repository.Ergebnis
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.test.StandardTestDispatcher
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
 *   A  in TokenSwap `speichere(neu)` moved behind the `return` (not
 *      saved) → red “the new token is saved before the swap ends”
 *   B  the lock removed (`lock.withLock` → direct) → red “two requests with
 *      the header swap once” (both GETAUSCHT, thus rotated twice)
 *   C  on a transient error LATER immediately instead of again → red “a
 *      lost response is retried with the old token”
 *   D  the 401 branch removed → red “if the old one is no longer valid, pairing must be redone”
 * Counter-checks:
 *   E  in swapLocked() the check `stand() != vorher` before the retry
 *      removed → red “a server switch during the retry …” (the old
 *      token still went out three times)
 *   F  in TokenLimit.replaceIf() `|| jetzt() != vorher` removed → red
 *      “sign-out during the swap …” and “… even if the same token comes back”
 *   G  there `requestOrigin != vorher.herkunft` removed → red “a token from
 *      a different origin is not saved”
 *   H  in TokenLimit.schreibe() `generation++` removed → red “… even if
 *      the same token comes back”
 *   I  loginOverdue() with `TOKEN_MAX_DURATION_DAYS * 24 * 60 * 1000`
 *      (minutes instead of hours) → red “after 180 days the sign-in is overdue …”
 * Counter-check:
 *   J  noetig() again without origin and generation (`stand().token.takeIf …`) →
 *      red “already swapped does not mean taking the token of another session”
 * Counter-check:
 *   K  faellig() swaps with runBlocking in the caller instead of in the passed scope →
 *      red “due swaps in the application scope and returns immediately”
 * Counter-check (05.11.2026, measured with kotlinc locally; tausch-noetig-ohne-frist.patch):
 *   L  neededWaiting() waits for the swap without withTimeoutOrNull → red “needed
 *      waits at most the deadline, the swap keeps running” (no return after the deadline)
 * Counter-check:
 *   M  in swapLocked() the check `bereit()` removed → red “with a locked device
 *      there is no swap …”; gegenproben/tausch-trotz-sperre.patch
 */
class TokenSwapTest {

    /** [hintergrund] takes up faellig(); without it a scope that nobody processes. */
    private class Welt(
        hintergrund: CoroutineScope = CoroutineScope(Job()),
        warten: Long = TokenSwap.NEEDED_WAIT_MS,
        bereit: () -> Boolean = { true },
    ) {
        var gespeichert = "alt"
        var herkunft: String? = HERE
        var responseOrigin: String? = HERE
        val limit = TokenLimit()
        val protokoll = mutableListOf<String>()
        var antworten: MutableList<Ergebnis<TokenRotation>> = mutableListOf()
        var brake: CompletableDeferred<Unit>? = null
        /** Runs in every call of the server, after the brake. */
        var rotateOn: suspend () -> Unit = {}

        fun stand() = TokenStatus(gespeichert, herkunft, limit.generation)

        /** Like PreferencesManager.clearSession() and saveServerUrl() with another server. */
        suspend fun abmelden() = limit.schreibe { gespeichert = ""; herkunft = null }
        suspend fun anmelden(token: String, bei: String) = limit.schreibe { gespeichert = token; herkunft = bei }

        val tausch = TokenSwap(
            stand = { stand() },
            ersetze = { vorher, neu, h ->
                limit.replaceIf(vorher, h, { stand() }) { protokoll += "speichere $neu"; gespeichert = neu; herkunft = h }
            },
            rotiere = { alt ->
                protokoll += "rotiere $alt"
                brake?.await()
                rotateOn()
                when (val r = antworten.removeFirstOrNull() ?: Ergebnis.Erfolg(TokenRotation(success = true, token = "neu"))) {
                    is Ergebnis.Erfolg -> Ergebnis.Erfolg(SwappedToken(r.data.token, responseOrigin))
                    is Ergebnis.Fehler -> r
                }
            },
            pausen = listOf(1, 1, 1),
            hintergrund = hintergrund,
            warten = warten,
            bereit = bereit,
        )
    }

    private val verloren: Ergebnis.Fehler = Ergebnis.Fehler.Netz()

    @Test
    fun `with a locked device there is no swap, after unlocking there is`() = runTest {
        var gesperrt = true
        val w = Welt(bereit = { !gesperrt })
        assertEquals(Tauschergebnis.LATER, w.tausch.tausche("alt"))
        assertEquals("Der Server sah keinen Tausch", emptyList<String>(), w.protokoll)
        assertEquals("alt", w.gespeichert)
        gesperrt = false
        assertEquals(Tauschergebnis.GETAUSCHT, w.tausch.tausche("alt"))
        assertEquals("neu", w.gespeichert)
    }

    @Test
    fun `the new token is saved before the swap ends`() = runTest {
        val w = Welt()
        assertEquals(Tauschergebnis.GETAUSCHT, w.tausch.tausche("alt"))
        assertEquals(listOf("rotiere alt", "speichere neu"), w.protokoll)
        assertEquals("neu", w.gespeichert)
        assertEquals(HERE, w.herkunft)
    }

    @Test
    fun `two requests with the header swap once`() = runTest {
        val w = Welt().apply { brake = CompletableDeferred() }
        val a = async { w.tausch.tausche("alt") }
        val b = async { w.tausch.tausche("alt") }
        repeat(5) { yield() }
        w.brake!!.complete(Unit)
        assertEquals(setOf(Tauschergebnis.GETAUSCHT, Tauschergebnis.ALREADY_SWAPPED), setOf(a.await(), b.await()))
        assertEquals(listOf("rotiere alt", "speichere neu"), w.protokoll)
    }

    @Test
    fun `a lost response is retried with the old token`() = runTest {
        val w = Welt().apply { antworten = mutableListOf(verloren, verloren) }
        assertEquals(Tauschergebnis.GETAUSCHT, w.tausch.tausche("alt"))
        assertEquals(listOf("rotiere alt", "rotiere alt", "rotiere alt", "speichere neu"), w.protokoll)
    }

    @Test
    fun `if the old one is no longer valid, pairing must be redone`() = runTest {
        val w = Welt().apply { antworten = mutableListOf(verloren, Ergebnis.Fehler.Abgewiesen(code = Fehlercode.TOKEN_UNGUELTIG)) }
        assertEquals(Tauschergebnis.NEW_PAIR, w.tausch.tausche("alt"))
        assertEquals("alt", w.gespeichert)
    }

    @Test
    fun `if the server stays silent, the old token stays`() = runTest {
        val w = Welt().apply { antworten = MutableList(10) { verloren } }
        assertEquals(Tauschergebnis.LATER, w.tausch.tausche("alt"))
        assertEquals("alt", w.gespeichert)
        assertEquals(4, w.protokoll.count { it == "rotiere alt" })
    }

    @Test
    fun `a server switch during the retry aborts the swap`() = runTest {
        val w = Welt().apply { antworten = MutableList(10) { verloren } }
        w.rotateOn = { if (w.herkunft == HERE) w.abmelden() }
        assertEquals(Tauschergebnis.DISCARDED, w.tausch.tausche("alt"))
        assertEquals("Der alte Token ging nach dem Wechsel nochmals hinaus", listOf("rotiere alt"), w.protokoll)
        assertEquals("", w.gespeichert)
    }

    @Test
    fun `sign-out during the swap discards the new token`() = runTest {
        val w = Welt().apply { brake = CompletableDeferred() }
        val tausch = async { w.tausch.tausche("alt") }
        repeat(5) { yield() }
        w.abmelden()
        w.brake!!.complete(Unit)
        assertEquals(Tauschergebnis.DISCARDED, tausch.await())
        assertEquals("Nach dem Abmelden ist niemand angemeldet", "", w.gespeichert)
        assertFalse(w.protokoll.toString(), w.protokoll.any { it.startsWith("speichere") })
        assertEquals(null, w.tausch.noetig("alt", HERE, w.limit.generation))
    }

    @Test
    fun `a swap that outlasts a sign-out does not save, even if the same token comes back`() = runTest {
        val w = Welt()
        w.rotateOn = { w.abmelden(); w.anmelden("alt", HERE) }
        assertEquals(Tauschergebnis.DISCARDED, w.tausch.tausche("alt"))
        assertEquals("alt", w.gespeichert)
    }

    @Test
    fun `a token from a different origin is not saved`() = runTest {
        val w = Welt().apply { responseOrigin = "https://anders.example:443" }
        assertEquals(Tauschergebnis.DISCARDED, w.tausch.tausche("alt"))
        assertEquals("alt", w.gespeichert)
        w.responseOrigin = null
        assertEquals(Tauschergebnis.DISCARDED, w.tausch.tausche("alt"))
        assertEquals("alt", w.gespeichert)
    }

    /** Review 6 M1: „already swapped“ was also „meanwhile signed in to the new server“. */
    @Test
    fun `already swapped does not mean taking the token of another session`() = runTest {
        val w = Welt()
        val g = w.limit.generation
        w.abmelden(); w.anmelden("vom-neuen", "https://neu.example:443")
        assertEquals("Andere Herkunft und Generation", null, w.tausch.noetig("alt", HERE, g))
        assertEquals("Andere Generation", null, w.tausch.noetig("alt", "https://neu.example:443", g))
        assertEquals("Andere Herkunft", null, w.tausch.noetig("alt", HERE, w.limit.generation))
        // The same session: another request has just swapped, its token counts.
        assertEquals("vom-neuen", w.tausch.noetig("alt", "https://neu.example:443", w.limit.generation))
        assertFalse(w.protokoll.toString(), w.protokoll.any { it.startsWith("rotiere") })
    }

    /** A silent server does not hold the network thread longer than the deadline; it is saved anyway. */
    @OptIn(ExperimentalCoroutinesApi::class)
    @Test
    fun `needed waits at most the deadline, the swap keeps running`() = runTest {
        val w = Welt(CoroutineScope(StandardTestDispatcher(testScheduler)), warten = 1_000).apply { brake = CompletableDeferred() }
        val waiting = async { w.tausch.neededWaiting("alt", HERE, w.limit.generation) }
        advanceTimeBy(999)
        assertFalse("Vor der Frist wartet noetig noch", waiting.isCompleted)
        advanceTimeBy(2)
        assertTrue("Nach der Frist kehrt noetig zurück", waiting.isCompleted)
        assertEquals(null, waiting.await())
        w.brake?.complete(Unit)
        advanceUntilIdle()
        assertEquals("Der Tausch lief im Anwendungsbereich weiter", "neu", w.gespeichert)
    }

    /** With the test clock instead of waiting: the swap runs only when the scope processes it. */
    @OptIn(ExperimentalCoroutinesApi::class)
    @Test
    fun `due swaps in the application scope and returns immediately`() = runTest {
        val w = Welt(CoroutineScope(StandardTestDispatcher(testScheduler))).apply { antworten = mutableListOf(verloren) }
        w.tausch.faellig("alt")
        assertEquals("faellig() hat im Aufrufer getauscht", emptyList<String>(), w.protokoll)
        advanceUntilIdle()
        assertEquals(listOf("rotiere alt", "rotiere alt", "speichere neu"), w.protokoll)
        assertEquals("neu", w.gespeichert)
    }

    @Test
    fun `after 180 days the sign-in is overdue, not before`() {
        val tag = 24L * 60 * 60 * 1000
        val am = 1_700_000_000_000L
        assertFalse(loginOverdue(am, am + 179 * tag))
        assertFalse(loginOverdue(am, am + 180 * tag))
        assertTrue(loginOverdue(am, am + 180 * tag + 1))
        assertFalse("Eine zurückgestellte Uhr meldet nicht ab", loginOverdue(am, am - tag))
    }

    private companion object {
        const val HERE = "https://brick.example:443"
    }
}
