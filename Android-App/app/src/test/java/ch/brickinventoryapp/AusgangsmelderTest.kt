package ch.brickinventoryapp

import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.data.lokal.Abgleichsereignis
import ch.brickinventoryapp.data.lokal.Bearbeitung
import ch.brickinventoryapp.data.lokal.Bestandsart
import ch.brickinventoryapp.data.lokal.Offlineablage
import ch.brickinventoryapp.data.lokal.SpeicherAusgang
import ch.brickinventoryapp.data.lokal.SpeicherBestand
import ch.brickinventoryapp.data.repository.Result
import ch.brickinventoryapp.ui.Aenderung
import ch.brickinventoryapp.ui.Ausgangsmelder
import ch.brickinventoryapp.ui.Bestandssignal
import ch.brickinventoryapp.ui.viewmodel.Texte
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
 * Gegenproben (30.10.2026, gemessen):
 *   A  in Ausgangsmelder.starte den Hinweis bei steigender Zahl entfernt → rot
 *      „offline Gespeichertes wird gemeldet“
 *   B  für MANUELLE_TEILE `null` statt Aenderung.Teile → rot „gesendet lädt die
 *      betroffenen Listen nach“
 *   C  `e.meldung` statt `e.meldung.ifBlank { … }` → rot „ohne Grund vom Server
 *      steht ein eigener Satz da“
 */
class AusgangsmelderTest {

    /** Schreibt Ressource und Argumente auf, damit sichtbar ist, WAS gemeldet wurde. */
    private object Aufschreiber : Texte {
        override fun text(id: Int, vararg args: Any?) = "t$id(${args.joinToString()})"
        override fun menge(id: Int, anzahl: Int, vararg args: Any?) = "m$id:$anzahl"
        override fun meldung(fehler: Result.Error) = "fehler"
        override fun angemeldet() = true
    }

    @Test
    fun `offline Gespeichertes wird gemeldet, gesendet lädt nach, abgelehnt sagt warum`() = runTest {
        val ablage = Offlineablage(SpeicherBestand(), SpeicherAusgang(), { "k" })
        val signal = Bestandssignal()
        val kanal = MeldungsKanal()
        val gesehen = mutableListOf<Aenderung>()
        backgroundScope.launch { signal.aenderungen.collect { gesehen += it } }
        val offene = Ausgangsmelder(ablage, signal, kanal, Aufschreiber).starte(backgroundScope)
        runCurrent()

        ablage.puffere(Bearbeitung.SetMenge("10001-1", 1))
        runCurrent()
        assertEquals(1, offene.value)
        assertEquals("offline Gespeichertes wird gemeldet", "m${R.plurals.offline_ausgang}:1", kanal.fluss.value)

        ablage.melde(Abgleichsereignis.Gesendet(setOf(Bestandsart.SETS, Bestandsart.MANUELLE_TEILE)))
        runCurrent()
        assertEquals("gesendet lädt die betroffenen Listen nach", setOf(Aenderung.Sets, Aenderung.Teile), gesehen.toSet())

        ablage.melde(Abgleichsereignis.Verworfen(Bearbeitung.SetMenge("10001-1", 1), "", 404))
        runCurrent()
        assertEquals("ohne Grund vom Server steht ein eigener Satz da",
            "t${R.string.offline_verworfen}(10001-1, t${R.string.offline_verworfen_ohne_grund}())", kanal.fluss.value)
    }
}
