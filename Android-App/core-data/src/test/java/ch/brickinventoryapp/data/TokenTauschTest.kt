package ch.brickinventoryapp.data

import kotlinx.coroutines.test.advanceTimeBy
import ch.brickinventoryapp.vertrag.Fehlercode
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
 * Ablage hier benutzt dieselbe [TokenSchranke] wie der PreferencesManager.
 *
 * Gegenproben:
 *   A  in TokenTausch `speichere(neu)` hinter das `return` verlegt (nicht
 *      gespeichert) → rot „der neue Token ist gespeichert, bevor der Tausch endet“
 *   B  die Sperre entfernt (`sperre.withLock` → direkt) → rot „zwei Anfragen mit
 *      der Kopfzeile tauschen einmal“ (beide GETAUSCHT, also zweimal rotiert)
 *   C  bei einem transienten Fehler sofort SPAETER statt erneut → rot „eine
 *      verlorene Antwort wird mit dem alten Token wiederholt“
 *   D  den 401-Zweig entfernt → rot „gilt der alte nicht mehr, muss neu gekoppelt werden“
 * Gegenproben:
 *   E  in tauscheGesperrt() die Prüfung `stand() != vorher` vor der Wiederholung
 *      entfernt → rot „ein Serverwechsel waehrend der Wiederholung …“ (der alte
 *      Token ging noch dreimal hinaus)
 *   F  in TokenSchranke.ersetzeFalls() `|| jetzt() != vorher` entfernt → rot
 *      „Abmelden waehrend des Tauschs …“ und „… auch wenn derselbe Token zurueckkommt“
 *   G  dort `anfrageHerkunft != vorher.herkunft` entfernt → rot „ein Token von
 *      einer anderen Herkunft wird nicht gespeichert“
 *   H  in TokenSchranke.schreibe() `generation++` entfernt → rot „… auch wenn
 *      derselbe Token zurueckkommt“
 *   I  anmeldungUeberfaellig() mit `TOKEN_HOECHSTDAUER_TAGE * 24 * 60 * 1000`
 *      (Minuten statt Stunden) → rot „nach 180 Tagen ist die Anmeldung ueberfaellig …“
 * Gegenprobe:
 *   J  noetig() wieder ohne Herkunft und Generation (`stand().token.takeIf …`) →
 *      rot „schon getauscht heisst nicht: den Token einer anderen Sitzung nehmen“
 * Gegenprobe:
 *   K  faellig() tauscht mit runBlocking im Aufrufer statt im übergebenen Bereich →
 *      rot „faellig tauscht im Anwendungsbereich und kehrt sofort zurueck“
 * Gegenprobe (05.11.2026, gemessen mit kotlinc lokal; tausch-noetig-ohne-frist.patch):
 *   L  noetigWartend() wartet ohne withTimeoutOrNull auf den Tausch → rot „noetig
 *      wartet hoechstens die Frist, der Tausch laeuft weiter“ (keine Rückkehr nach der Frist)
 */
class TokenTauschTest {

    /** [hintergrund] nimmt faellig() auf; ohne Angabe ein Bereich, den niemand abarbeitet. */
    private class Welt(hintergrund: CoroutineScope = CoroutineScope(Job()), warten: Long = TokenTausch.NOETIG_WARTEN_MS) {
        var gespeichert = "alt"
        var herkunft: String? = HIER
        var antwortHerkunft: String? = HIER
        val schranke = TokenSchranke()
        val protokoll = mutableListOf<String>()
        var antworten: MutableList<Ergebnis<TokenRotation>> = mutableListOf()
        var bremse: CompletableDeferred<Unit>? = null
        /** Läuft in jedem Aufruf des Servers, nach der Bremse. */
        var beimRotieren: suspend () -> Unit = {}

        fun stand() = TokenStand(gespeichert, herkunft, schranke.generation)

        /** Wie PreferencesManager.clearSession() und saveServerUrl() mit anderem Server. */
        suspend fun abmelden() = schranke.schreibe { gespeichert = ""; herkunft = null }
        suspend fun anmelden(token: String, bei: String) = schranke.schreibe { gespeichert = token; herkunft = bei }

        val tausch = TokenTausch(
            stand = { stand() },
            ersetze = { vorher, neu, h ->
                schranke.ersetzeFalls(vorher, h, { stand() }) { protokoll += "speichere $neu"; gespeichert = neu; herkunft = h }
            },
            rotiere = { alt ->
                protokoll += "rotiere $alt"
                bremse?.await()
                beimRotieren()
                when (val r = antworten.removeFirstOrNull() ?: Ergebnis.Success(TokenRotation(success = true, token = "neu"))) {
                    is Ergebnis.Success -> Ergebnis.Success(GetauschterToken(r.data, antwortHerkunft))
                    is Ergebnis.Error -> r
                }
            },
            pausen = listOf(1, 1, 1),
            hintergrund = hintergrund,
            warten = warten,
        )
    }

    private val verloren: Ergebnis.Error = Ergebnis.Error.Netz()

    @Test
    fun `der neue Token ist gespeichert, bevor der Tausch endet`() = runTest {
        val w = Welt()
        assertEquals(Tauschergebnis.GETAUSCHT, w.tausch.tausche("alt"))
        assertEquals(listOf("rotiere alt", "speichere neu"), w.protokoll)
        assertEquals("neu", w.gespeichert)
        assertEquals(HIER, w.herkunft)
    }

    @Test
    fun `zwei Anfragen mit der Kopfzeile tauschen einmal`() = runTest {
        val w = Welt().apply { bremse = CompletableDeferred() }
        val a = async { w.tausch.tausche("alt") }
        val b = async { w.tausch.tausche("alt") }
        repeat(5) { yield() }
        w.bremse!!.complete(Unit)
        assertEquals(setOf(Tauschergebnis.GETAUSCHT, Tauschergebnis.SCHON_GETAUSCHT), setOf(a.await(), b.await()))
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
        val w = Welt().apply { antworten = mutableListOf(verloren, Ergebnis.Error.Abgewiesen(code = Fehlercode.TOKEN_UNGUELTIG)) }
        assertEquals(Tauschergebnis.NEU_KOPPELN, w.tausch.tausche("alt"))
        assertEquals("alt", w.gespeichert)
    }

    @Test
    fun `bleibt der Server stumm, bleibt der alte Token stehen`() = runTest {
        val w = Welt().apply { antworten = MutableList(10) { verloren } }
        assertEquals(Tauschergebnis.SPAETER, w.tausch.tausche("alt"))
        assertEquals("alt", w.gespeichert)
        assertEquals(4, w.protokoll.count { it == "rotiere alt" })
    }

    @Test
    fun `ein Serverwechsel waehrend der Wiederholung bricht den Tausch ab`() = runTest {
        val w = Welt().apply { antworten = MutableList(10) { verloren } }
        w.beimRotieren = { if (w.herkunft == HIER) w.abmelden() }
        assertEquals(Tauschergebnis.VERWORFEN, w.tausch.tausche("alt"))
        assertEquals("Der alte Token ging nach dem Wechsel nochmals hinaus", listOf("rotiere alt"), w.protokoll)
        assertEquals("", w.gespeichert)
    }

    @Test
    fun `Abmelden waehrend des Tauschs verwirft den neuen Token`() = runTest {
        val w = Welt().apply { bremse = CompletableDeferred() }
        val tausch = async { w.tausch.tausche("alt") }
        repeat(5) { yield() }
        w.abmelden()
        w.bremse!!.complete(Unit)
        assertEquals(Tauschergebnis.VERWORFEN, tausch.await())
        assertEquals("Nach dem Abmelden ist niemand angemeldet", "", w.gespeichert)
        assertFalse(w.protokoll.toString(), w.protokoll.any { it.startsWith("speichere") })
        assertEquals(null, w.tausch.noetig("alt", HIER, w.schranke.generation))
    }

    @Test
    fun `ein Tausch, der eine Abmeldung ueberdauert, speichert nicht, auch wenn derselbe Token zurueckkommt`() = runTest {
        val w = Welt()
        w.beimRotieren = { w.abmelden(); w.anmelden("alt", HIER) }
        assertEquals(Tauschergebnis.VERWORFEN, w.tausch.tausche("alt"))
        assertEquals("alt", w.gespeichert)
    }

    @Test
    fun `ein Token von einer anderen Herkunft wird nicht gespeichert`() = runTest {
        val w = Welt().apply { antwortHerkunft = "https://anders.example:443" }
        assertEquals(Tauschergebnis.VERWORFEN, w.tausch.tausche("alt"))
        assertEquals("alt", w.gespeichert)
        w.antwortHerkunft = null
        assertEquals(Tauschergebnis.VERWORFEN, w.tausch.tausche("alt"))
        assertEquals("alt", w.gespeichert)
    }

    /** Pruef6 M1: „Schon getauscht“ war auch „inzwischen beim neuen Server angemeldet“. */
    @Test
    fun `schon getauscht heisst nicht, den Token einer anderen Sitzung nehmen`() = runTest {
        val w = Welt()
        val g = w.schranke.generation
        w.abmelden(); w.anmelden("vom-neuen", "https://neu.example:443")
        assertEquals("Andere Herkunft und Generation", null, w.tausch.noetig("alt", HIER, g))
        assertEquals("Andere Generation", null, w.tausch.noetig("alt", "https://neu.example:443", g))
        assertEquals("Andere Herkunft", null, w.tausch.noetig("alt", HIER, w.schranke.generation))
        // Dieselbe Sitzung: Eine andere Anfrage hat eben getauscht, ihr Token gilt.
        assertEquals("vom-neuen", w.tausch.noetig("alt", "https://neu.example:443", w.schranke.generation))
        assertFalse(w.protokoll.toString(), w.protokoll.any { it.startsWith("rotiere") })
    }

    /** Ein stummer Server hält den Netz-Thread nicht länger als die Frist; gespeichert wird trotzdem. */
    @OptIn(ExperimentalCoroutinesApi::class)
    @Test
    fun `noetig wartet hoechstens die Frist, der Tausch laeuft weiter`() = runTest {
        val w = Welt(CoroutineScope(StandardTestDispatcher(testScheduler)), warten = 1_000).apply { bremse = CompletableDeferred() }
        val wartend = async { w.tausch.noetigWartend("alt", HIER, w.schranke.generation) }
        advanceTimeBy(999)
        assertFalse("Vor der Frist wartet noetig noch", wartend.isCompleted)
        advanceTimeBy(2)
        assertTrue("Nach der Frist kehrt noetig zurück", wartend.isCompleted)
        assertEquals(null, wartend.await())
        w.bremse?.complete(Unit)
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
        assertFalse(anmeldungUeberfaellig(am, am + 179 * tag))
        assertFalse(anmeldungUeberfaellig(am, am + 180 * tag))
        assertTrue(anmeldungUeberfaellig(am, am + 180 * tag + 1))
        assertFalse("Eine zurückgestellte Uhr meldet nicht ab", anmeldungUeberfaellig(am, am - tag))
    }

    private companion object {
        const val HIER = "https://brick.example:443"
    }
}
