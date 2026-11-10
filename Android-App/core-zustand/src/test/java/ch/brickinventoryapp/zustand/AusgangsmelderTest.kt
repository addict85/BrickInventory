package ch.brickinventoryapp.zustand

import kotlinx.coroutines.ExperimentalCoroutinesApi
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.data.lokal.Abgleichsereignis
import ch.brickinventoryapp.data.lokal.Ausgangslage
import ch.brickinventoryapp.model.lokal.Bestandsart
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.zustand.ui.Aenderung
import ch.brickinventoryapp.zustand.ui.Ausgangsmelder
import ch.brickinventoryapp.zustand.ui.Bestandssignal
import ch.brickinventoryapp.zustand.ui.viewmodel.Texte
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Der Ausgang ist sichtbar: Zahl und Hinweis, sobald etwas offline gespeichert
 * wurde; Nachladen, wenn gesendet wurde; ein Satz mit Grund, wenn der Server
 * ablehnte.
 *
 * Gegenproben:
 *   A  in Ausgangsmelder.starte den Hinweis bei steigender Zahl entfernt → rot
 *      „offline Gespeichertes wird gemeldet“
 *   B  für MANUELLE_TEILE `null` statt Aenderung.Teile → rot „gesendet lädt die
 *      betroffenen Listen nach“
 *   C  `e.meldung` statt `e.meldung.ifBlank { … }` → rot „ohne Grund vom Server
 *      steht ein eigener Satz da“
 *   D  `lage.planeLiegengebliebenes()` beim Start weggelassen → rot „was vom letzten
 *      Mal wartet, wird beim Start eingeplant“
 *   (B und D lokal mit kotlinc gemessen)
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AusgangsmelderTest {

    /** Schreibt Ressource und Argumente auf, damit sichtbar ist, WAS gemeldet wurde. */
    private object Aufschreiber : Texte {
        override fun text(id: Int, vararg args: Any?) = "t$id(${args.joinToString()})"
        override fun menge(id: Int, anzahl: Int, vararg args: Any?) = "m$id:$anzahl"
        override fun meldung(fehler: Ergebnis.Error) = "fehler"
        override fun angemeldet() = true
    }

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
        val signal = Bestandssignal()
        val kanal = MeldungsKanal()
        val gesehen = mutableListOf<Aenderung>()
        backgroundScope.launch { signal.aenderungen.collect { gesehen += it } }
        val offene = Ausgangsmelder(lage, signal, kanal, Aufschreiber).starte(backgroundScope)
        runCurrent()
        assertEquals("was vom letzten Mal wartet, wird beim Start eingeplant", 1, lage.geplant)

        lage.zahl.value = 1
        runCurrent()
        assertEquals(1, offene.value)
        assertEquals("offline Gespeichertes wird gemeldet", "m${R.plurals.offline_ausgang}:1", kanal.meldung.value)

        lage.gemeldet.emit(Abgleichsereignis.Gesendet(setOf(Bestandsart.SETS, Bestandsart.MANUELLE_TEILE)))
        runCurrent()
        assertEquals("gesendet lädt die betroffenen Listen nach", setOf(Aenderung.Sets, Aenderung.Teile), gesehen.toSet())

        kanal.quittiere()
        lage.gemeldet.emit(Abgleichsereignis.Verworfen("10001-1", "", 404))
        runCurrent()
        assertEquals("ohne Grund vom Server steht ein eigener Satz da",
            "t${R.string.offline_verworfen}(10001-1, t${R.string.offline_verworfen_ohne_grund}())", kanal.meldung.value)
    }
}
