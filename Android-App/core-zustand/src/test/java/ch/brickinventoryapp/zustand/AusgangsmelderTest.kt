package ch.brickinventoryapp.zustand

import ch.brickinventoryapp.model.ui.Meldung
import kotlinx.coroutines.ExperimentalCoroutinesApi
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.data.lokal.Abgleichsereignis
import ch.brickinventoryapp.data.lokal.Ausgangslage
import ch.brickinventoryapp.model.lokal.Bestandsart
import ch.brickinventoryapp.zustand.ui.Ausgangsmelder
import ch.brickinventoryapp.testing.Bestandsabgleich
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
 *   D  `lage.planeLiegengebliebenes()` beim Start weggelassen → rot „was vom letzten
 *      Mal wartet, wird beim Start eingeplant“
 *   E  in AusgangsBeobachter.starte die Prüfung `gestartet` entfernt → rot „ein zweiter
 *      Start folgt dem Ausgang nicht doppelt“ (2 statt 1)
 *   (B, D und E lokal mit kotlinc gemessen)
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AusgangsmelderTest {

    /** Der Ausgang von aussen gesehen, ohne Ablage: Zahl und Ereignisse setzt der Test. */
    private class Lage : Ausgangslage {
        val zahl = MutableStateFlow(0)
        val gemeldet = MutableSharedFlow<Abgleichsereignis>(extraBufferCapacity = 4)
        var geplant = 0
        override fun offene() = zahl
        override val ereignisse = gemeldet
        override suspend fun planeLiegengebliebenes() { geplant++ }
    }

    @Test
    fun `offline Gespeichertes wird gemeldet, gesendet lädt nach, abgelehnt sagt warum`() = runTest {
        val lage = Lage()
        val fake = FakeApi()
        val kanal = MeldungsKanal()
        val melder = Ausgangsmelder(lage, Bestandsabgleich(fake.api, Testablage()), kanal)
        melder.starte(backgroundScope)
        runCurrent()
        assertEquals("was vom letzten Mal wartet, wird beim Start eingeplant", 1, lage.geplant)

        lage.zahl.value = 1
        runCurrent()
        assertEquals(1, melder.offene.value)
        assertEquals("offline Gespeichertes wird gemeldet", Meldung.Menge(R.plurals.offline_ausgang, 1), kanal.meldung.value)

        lage.gemeldet.emit(Abgleichsereignis.Gesendet(setOf(Bestandsart.SETS, Bestandsart.MANUELLE_TEILE)))
        runCurrent()
        assertEquals("gesendet holt die betroffenen Listen in die Ablage", listOf(1, 1, 0, 0),
            listOf("getSets", "getParts", "getMinifigs", "getMerkliste").map { fake.aufrufeVon(it) })

        kanal.quittiere()
        lage.gemeldet.emit(Abgleichsereignis.Verworfen("10001-1", "", 404))
        runCurrent()
        assertEquals("ohne Grund vom Server steht ein eigener Satz da",
            Meldung.Ressource(R.string.offline_verworfen, listOf("10001-1", Meldung.Ressource(R.string.offline_verworfen_ohne_grund))),
            kanal.meldung.value)
    }

    @Test
    fun `ein zweiter Start folgt dem Ausgang nicht doppelt`() = runTest {
        val lage = Lage()
        val kanal = MeldungsKanal()
        val melder = Ausgangsmelder(lage, Bestandsabgleich(FakeApi().api, Testablage()), kanal)
        melder.starte(backgroundScope)
        melder.starte(backgroundScope)
        runCurrent()
        assertEquals("ein zweiter Start folgt dem Ausgang nicht doppelt", 1, lage.geplant)
        assertEquals(1, lage.zahl.subscriptionCount.value)
    }
}
