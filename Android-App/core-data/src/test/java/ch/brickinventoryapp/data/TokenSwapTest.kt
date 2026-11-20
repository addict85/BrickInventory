package ch.brickinventoryapp.data

import kotlinx.coroutines.test.advanceTimeBy
import ch.brickinventoryapp.model.fach.Fehlercode
import ch.brickinventoryapp.vertrag.TokenRotation
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
 * Der Tausch eines Tokens: speichern vor benutzen, nur einer zugleich, bei
 * verlorener Antwort ein zweiter Versuch mit dem ALTEN Token — und nichts
 * speichern, wenn inzwischen abgemeldet oder der Server gewechselt wurde. Die
 * Ablage hier benutzt dieselbe [TokenLimit] wie der PreferencesManager.
 *
 * Gegenproben:
 *   A  in TokenSwap `speichere(neu)` hinter das `return` verlegt (nicht
 *      gespeichert) → rot „der neue Token ist gespeichert, bevor der Tausch endet“
 *   B  die Sperre entfernt (`lock.withLock` → direkt) → rot „zwei Anfragen mit
 *      der Kopfzeile tauschen einmal“ (beide GETAUSCHT, also zweimal rotiert)
 *   C  bei einem transienten Fehler sofort LATER statt erneut → rot „eine
 *      verlorene Antwort wird mit dem alten Token wiederholt“
 *   D  den 401-Zweig entfernt → rot „gilt der alte nicht mehr, muss neu gekoppelt werden“
 * Gegenproben:
 *   E  in swapLocked() die Prüfung `stand() != vorher` vor der Wiederholung
 *      entfernt → rot „ein Serverwechsel waehrend der Wiederholung …“ (der alte
 *      Token ging noch dreimal hinaus)
 *   F  in TokenLimit.replaceIf() `|| jetzt() != vorher` entfernt → rot
 *      „Abmelden waehrend des Tauschs …“ und „… auch wenn derselbe Token zurueckkommt“
 *   G  dort `requestOrigin != vorher.herkunft` entfernt → rot „ein Token von
 *      einer anderen Herkunft wird nicht gespeichert“
 *   H  in TokenLimit.schreibe() `generation++` entfernt → rot „… auch wenn
 *      derselbe Token zurueckkommt“
 *   I  loginOverdue() mit `TOKEN_MAX_DURATION_DAYS * 24 * 60 * 1000`
 *      (Minuten statt Stunden) → rot „nach 180 Tagen ist die Anmeldung ueberfaellig …“
 * Gegenprobe:
 *   J  noetig() wieder ohne Herkunft und Generation (`stand().token.takeIf …`) →
 *      rot „schon getauscht heisst nicht: den Token einer anderen Sitzung nehmen“
 * Gegenprobe:
 *   K  faellig() tauscht mit runBlocking im Aufrufer statt im übergebenen Bereich →
 *      rot „faellig tauscht im Anwendungsbereich und kehrt sofort zurueck“
 * Gegenprobe (05.11.2026, gemessen mit kotlinc lokal; tausch-noetig-ohne-frist.patch):
 *   L  neededWaiting() wartet ohne withTimeoutOrNull auf den Tausch → rot „noetig
 *      wartet hoechstens die Frist, der Tausch laeuft weiter“ (keine Rückkehr nach der Frist)
 * Gegenprobe:
 *   M  in swapLocked() die Prüfung `bereit()` entfernt → rot „bei gesperrtem Geraet
 *      wird nicht getauscht …“; gegenproben/tausch-trotz-sperre.patch
 */
class TokenSwapTest {

    /** [hintergrund] nimmt faellig() auf; ohne Angabe ein Bereich, den niemand abarbeitet. */
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
        /** Läuft in jedem Aufruf des Servers, nach der Bremse. */
        var rotateOn: suspend () -> Unit = {}

        fun stand() = TokenStatus(gespeichert, herkunft, limit.generation)

        /** Wie PreferencesManager.clearSession() und saveServerUrl() mit anderem Server. */
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
    fun `bei gesperrtem Geraet wird nicht getauscht, nach dem Entsperren schon`() = runTest {
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
    fun `der neue Token ist gespeichert, bevor der Tausch endet`() = runTest {
        val w = Welt()
        assertEquals(Tauschergebnis.GETAUSCHT, w.tausch.tausche("alt"))
        assertEquals(listOf("rotiere alt", "speichere neu"), w.protokoll)
        assertEquals("neu", w.gespeichert)
        assertEquals(HERE, w.herkunft)
    }

    @Test
    fun `zwei Anfragen mit der Kopfzeile tauschen einmal`() = runTest {
        val w = Welt().apply { brake = CompletableDeferred() }
        val a = async { w.tausch.tausche("alt") }
        val b = async { w.tausch.tausche("alt") }
        repeat(5) { yield() }
        w.brake!!.complete(Unit)
        assertEquals(setOf(Tauschergebnis.GETAUSCHT, Tauschergebnis.ALREADY_SWAPPED), setOf(a.await(), b.await()))
        assertEquals(listOf("rotiere alt", "speichere neu"), w.protokoll)
    }

    @Test
    fun `eine verlorene Antwort wird mit dem alten Token wiederholt`() = runTest {
        val w = Welt().apply { antworten = mutableListOf(verloren, verloren) }
        assertEquals(Tauschergebnis.GETAUSCHT, w.tausch.tausche("alt"))
        assertEquals(listOf("rotiere alt", "rotiere alt", "rotiere alt", "speichere neu"), w.protokoll)
    }

    @Test
    fun `gilt der alte nicht mehr, muss neu gekoppelt werden`() = runTest {
        val w = Welt().apply { antworten = mutableListOf(verloren, Ergebnis.Fehler.Abgewiesen(code = Fehlercode.TOKEN_UNGUELTIG)) }
        assertEquals(Tauschergebnis.NEW_PAIR, w.tausch.tausche("alt"))
        assertEquals("alt", w.gespeichert)
    }

    @Test
    fun `bleibt der Server stumm, bleibt der alte Token stehen`() = runTest {
        val w = Welt().apply { antworten = MutableList(10) { verloren } }
        assertEquals(Tauschergebnis.LATER, w.tausch.tausche("alt"))
        assertEquals("alt", w.gespeichert)
        assertEquals(4, w.protokoll.count { it == "rotiere alt" })
    }

    @Test
    fun `ein Serverwechsel waehrend der Wiederholung bricht den Tausch ab`() = runTest {
        val w = Welt().apply { antworten = MutableList(10) { verloren } }
        w.rotateOn = { if (w.herkunft == HERE) w.abmelden() }
        assertEquals(Tauschergebnis.DISCARDED, w.tausch.tausche("alt"))
        assertEquals("Der alte Token ging nach dem Wechsel nochmals hinaus", listOf("rotiere alt"), w.protokoll)
        assertEquals("", w.gespeichert)
    }

    @Test
    fun `Abmelden waehrend des Tauschs verwirft den neuen Token`() = runTest {
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
    fun `ein Tausch, der eine Abmeldung ueberdauert, speichert nicht, auch wenn derselbe Token zurueckkommt`() = runTest {
        val w = Welt()
        w.rotateOn = { w.abmelden(); w.anmelden("alt", HERE) }
        assertEquals(Tauschergebnis.DISCARDED, w.tausch.tausche("alt"))
        assertEquals("alt", w.gespeichert)
    }

    @Test
    fun `ein Token von einer anderen Herkunft wird nicht gespeichert`() = runTest {
        val w = Welt().apply { responseOrigin = "https://anders.example:443" }
        assertEquals(Tauschergebnis.DISCARDED, w.tausch.tausche("alt"))
        assertEquals("alt", w.gespeichert)
        w.responseOrigin = null
        assertEquals(Tauschergebnis.DISCARDED, w.tausch.tausche("alt"))
        assertEquals("alt", w.gespeichert)
    }

    /** Pruef6 M1: „Schon getauscht“ war auch „inzwischen beim neuen Server angemeldet“. */
    @Test
    fun `schon getauscht heisst nicht, den Token einer anderen Sitzung nehmen`() = runTest {
        val w = Welt()
        val g = w.limit.generation
        w.abmelden(); w.anmelden("vom-neuen", "https://neu.example:443")
        assertEquals("Andere Herkunft und Generation", null, w.tausch.noetig("alt", HERE, g))
        assertEquals("Andere Generation", null, w.tausch.noetig("alt", "https://neu.example:443", g))
        assertEquals("Andere Herkunft", null, w.tausch.noetig("alt", HERE, w.limit.generation))
        // Dieselbe Sitzung: Eine andere Anfrage hat eben getauscht, ihr Token gilt.
        assertEquals("vom-neuen", w.tausch.noetig("alt", "https://neu.example:443", w.limit.generation))
        assertFalse(w.protokoll.toString(), w.protokoll.any { it.startsWith("rotiere") })
    }

    /** Ein stummer Server hält den Netz-Thread nicht länger als die Frist; gespeichert wird trotzdem. */
    @OptIn(ExperimentalCoroutinesApi::class)
    @Test
    fun `noetig wartet hoechstens die Frist, der Tausch laeuft weiter`() = runTest {
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

    /** Mit dem Testtakt statt Warten: Der Tausch läuft erst, wenn der Bereich ihn abarbeitet. */
    @OptIn(ExperimentalCoroutinesApi::class)
    @Test
    fun `faellig tauscht im Anwendungsbereich und kehrt sofort zurueck`() = runTest {
        val w = Welt(CoroutineScope(StandardTestDispatcher(testScheduler))).apply { antworten = mutableListOf(verloren) }
        w.tausch.faellig("alt")
        assertEquals("faellig() hat im Aufrufer getauscht", emptyList<String>(), w.protokoll)
        advanceUntilIdle()
        assertEquals(listOf("rotiere alt", "rotiere alt", "speichere neu"), w.protokoll)
        assertEquals("neu", w.gespeichert)
    }

    @Test
    fun `nach 180 Tagen ist die Anmeldung ueberfaellig, vorher nicht`() {
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
