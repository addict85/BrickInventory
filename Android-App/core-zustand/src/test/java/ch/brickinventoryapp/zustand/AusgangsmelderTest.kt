package ch.brickinventoryapp.zustand

import ch.brickinventoryapp.model.ui.Meldung
import kotlinx.coroutines.ExperimentalCoroutinesApi
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.data.lokal.Abgleichsereignis
import ch.brickinventoryapp.data.lokal.Baseline
import ch.brickinventoryapp.data.lokal.Baseline.DiscardedChange
import ch.brickinventoryapp.model.lokal.StockKind
import ch.brickinventoryapp.zustand.ui.Ausgangsmelder
import ch.brickinventoryapp.testing.testBestandsabgleich
import ch.brickinventoryapp.testing.FakeApi
import ch.brickinventoryapp.testing.Testablage
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Der Ausgang ist sichtbar: Zahl und Hinweis, sobald etwas offline gespeichert
 * wurde; der Serverstand der betroffenen Listen in die Ablage, wenn gesendet
 * wurde; ein Satz mit Grund, wenn der Server ablehnte.
 *
 * Gegenproben:
 *   A  in Ausgangsmelder.starte den Hinweis bei steigender Zahl entfernt → rot
 *      „offline Gespeichertes wird gemeldet“
 *   B  für MANUELLE_TEILE `null` statt Liste.TEILE → rot „gesendet holt die
 *      betroffenen Listen in die Ablage“
 *   C  `e.meldung` statt `e.meldung.ifBlank { … }` → rot „ohne Grund vom Server
 *      steht ein eigener Satz da“
 *   D  `situation.planeLeftover()` beim Start weggelassen → rot „was vom letzten
 *      Mal wartet, wird beim Start eingeplant“
 *   E  in InitialObserver.starte die Prüfung `gestartet` entfernt → rot „ein zweiter
 *      Start folgt dem Ausgang nicht doppelt“ (2 statt 1)
 *   F  in reportDiscarded die Abfrage `v.unlesbar` gestrichen → rot „ein nach dem Update
 *      unlesbarer Posten wird als solcher gemeldet“ (nur in der CI messbar)
 *   (B, D und E lokal mit kotlinc gemessen)
 *   gegenproben/verworfen-sofort-quittiert.patch (reportDiscarded quittiert gleich nach
 *      zeige) → rot „ein Verworfenes bleibt, bis sein Hinweis weggeräumt ist“
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AusgangsmelderTest {

    /** Der Ausgang von aussen gesehen, ohne Ablage: Zahl, Ereignisse und Verworfenes setzt der Test. */
    private class Lage : Baseline {
        val zahl = MutableStateFlow(0)
        val gemeldet = MutableSharedFlow<Abgleichsereignis>(extraBufferCapacity = 4)
        val verworfen = MutableStateFlow<List<DiscardedChange>>(emptyList())
        var geplant = 0
        override fun offene() = zahl
        override val events = gemeldet
        override fun discarded() = verworfen
        override suspend fun acknowledge(v: DiscardedChange) { verworfen.value = verworfen.value - v }
        override suspend fun planeLeftover() { geplant++ }
    }

    @Test
    fun `offline Gespeichertes wird gemeldet, gesendet lädt nach, abgelehnt sagt warum`() = runTest {
        val situation = Lage()
        val fake = FakeApi()
        val kanal = MeldungsKanal()
        val melder = Ausgangsmelder(situation, testBestandsabgleich(fake.api, Testablage()), kanal)
        melder.starte(backgroundScope)
        runCurrent()
        assertEquals("was vom letzten Mal wartet, wird beim Start eingeplant", 1, situation.geplant)

        situation.zahl.value = 1
        runCurrent()
        assertEquals(1, melder.offene.value)
        assertEquals("offline Gespeichertes wird gemeldet", Meldung.Menge(R.plurals.offline_ausgang, 1), kanal.meldung.value)

        situation.gemeldet.emit(Abgleichsereignis.Sent(setOf(StockKind.SETS, StockKind.MANUELLE_TEILE)))
        runCurrent()
        assertEquals("gesendet holt die betroffenen Listen in die Ablage", listOf(1, 1, 0, 0),
            listOf("getSets", "getParts", "getMinifigs", "getMerkliste").map { fake.callsOf(it) })

        kanal.acknowledge()
        situation.verworfen.value = listOf(DiscardedChange("k1", "10001-1", "", 404))
        runCurrent()
        assertEquals("ohne Grund vom Server steht ein eigener Satz da",
            Meldung.Resource(R.string.offline_verworfen, listOf("10001-1", Meldung.Resource(R.string.offline_verworfen_ohne_grund))),
            kanal.meldung.value)
    }

    @Test
    fun `ein Verworfenes bleibt, bis sein Hinweis weggeraeumt ist, dann kommt das naechste`() = runTest {
        val situation = Lage()
        val kanal = MeldungsKanal()
        val erstes = DiscardedChange("k1", "10001-1", "gibt es nicht", 404)
        val zweites = DiscardedChange("k2", "10002-1", "gibt es auch nicht", 404)
        situation.verworfen.value = listOf(erstes, zweites)
        Ausgangsmelder(situation, testBestandsabgleich(FakeApi().api, Testablage()), kanal).starte(backgroundScope)
        runCurrent()
        assertEquals(Meldung.Resource(R.string.offline_verworfen, listOf("10001-1", "gibt es nicht")), kanal.meldung.value)
        assertEquals("noch nicht gesehen: bleibt in der Ablage", listOf(erstes, zweites), situation.verworfen.value)
        kanal.acknowledge()
        runCurrent()
        assertEquals(Meldung.Resource(R.string.offline_verworfen, listOf("10002-1", "gibt es auch nicht")), kanal.meldung.value)
        assertEquals(listOf(zweites), situation.verworfen.value)
    }

    @Test
    fun `ein nach dem Update unlesbarer Posten wird als solcher gemeldet`() = runTest {
        val situation = Lage()
        val kanal = MeldungsKanal()
        situation.verworfen.value = listOf(DiscardedChange("k1", "10001-1", "", null, unlesbar = true))
        Ausgangsmelder(situation, testBestandsabgleich(FakeApi().api, Testablage()), kanal).starte(backgroundScope)
        runCurrent()
        assertEquals("ein nach dem Update unlesbarer Posten wird als solcher gemeldet",
            Meldung.Resource(R.string.offline_verworfen, listOf("10001-1", Meldung.Resource(R.string.offline_verworfen_unlesbar))),
            kanal.meldung.value)
    }

    @Test
    fun `ein zweiter Start folgt dem Ausgang nicht doppelt`() = runTest {
        val situation = Lage()
        val kanal = MeldungsKanal()
        val melder = Ausgangsmelder(situation, testBestandsabgleich(FakeApi().api, Testablage()), kanal)
        melder.starte(backgroundScope)
        melder.starte(backgroundScope)
        runCurrent()
        assertEquals("ein zweiter Start folgt dem Ausgang nicht doppelt", 1, situation.geplant)
        assertEquals(1, situation.zahl.subscriptionCount.value)
    }
}
