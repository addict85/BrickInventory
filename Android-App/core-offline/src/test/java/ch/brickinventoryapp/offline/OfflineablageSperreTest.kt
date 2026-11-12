package ch.brickinventoryapp.offline

import ch.brickinventoryapp.model.data.model.SetItem
import ch.brickinventoryapp.model.lokal.Bestandsart
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.joinAll
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Lesen, Ändern und Schreiben einer Liste laufen je (Bereich, Liste) unter einer
 * Sperre: Zwei Schreibvorgänge, die sich überholen, verlieren sonst einen. Der
 * Bestand hält das nächste Schreiben an, bis der Test es freigibt — so liegt der
 * zweite Vorgang genau im Fenster zwischen Lesen und Schreiben des ersten.
 *
 * Gegenproben (kotlinc und JUnit gegen Offlineablage.kt):
 *   A  in uebernimm() und puffere() die Sperre entfernt → rot „ein puffere während
 *      einer Serverantwort geht nicht verloren“ (Menge 1 statt 2)
 *   B  in wendeAn() die Sperre entfernt → rot „zwei gleichzeitige wendeAn zählen
 *      beide“ (Menge 2 statt 3)
 *   C  in Offlineablage `aktuell` aus `bereichQuelle` statt aus `bereichFluss` abgeleitet
 *      → rot „der beobachtete Bereich folgt der Sitzung, ohne dass jemand schreibt“
 */
class OfflineablageSperreTest {

    /** Hält das nächste Schreiben (Ersetzen oder Angleichen) an, sobald [halte] gerufen wurde. */
    private class HaltenderBestand(private val innen: LokalerBestand = SpeicherBestand()) : LokalerBestand by innen {
        private var tor: CompletableDeferred<Unit>? = null
        fun halte(): CompletableDeferred<Unit> = CompletableDeferred<Unit>().also { tor = it }

        override suspend fun ersetze(bereich: String, art: Bestandsart, zeilen: List<LokaleZeile>, stand: Long?) {
            tor?.let { t -> tor = null; t.await() }
            innen.ersetze(bereich, art, zeilen, stand)
        }

        override suspend fun gleicheAn(bereich: String, art: Bestandsart, zeilen: List<LokaleZeile>) {
            tor?.let { t -> tor = null; t.await() }
            innen.gleicheAn(bereich, art, zeilen)
        }
    }

    private val bestand = HaltenderBestand()
    private val ablage = Offlineablage(bestand, SpeicherAusgang(), { "a" })

    private suspend fun menge() = ablage.lies(Faecher.SETS)!!.liste.single().quantity

    @Test
    fun `ein puffere waehrend einer Serverantwort geht nicht verloren`() = runBlocking {
        ablage.uebernimm(Faecher.SETS, listOf(SetItem("10001-1", quantity = 1)))
        val tor = bestand.halte()
        // Der Server kennt die Änderung noch nicht: Seine Antwort hat den Ausgang
        // schon gelesen (leer) und wartet im Schreiben.
        val antwort = launch { ablage.uebernimm(Faecher.SETS, listOf(SetItem("10001-1", quantity = 1))) }
        yield()
        val offline = launch { ablage.puffere(Bearbeitung.SetMenge("10001-1", 1)) }
        repeat(3) { yield() }
        tor.complete(Unit)
        joinAll(antwort, offline)
        assertEquals("der wartende Schritt liegt über der Serverantwort", 2, menge())
    }

    @Test
    fun `zwei gleichzeitige wendeAn zaehlen beide`() = runBlocking {
        ablage.uebernimm(Faecher.SETS, listOf(SetItem("10001-1", quantity = 1)))
        val tor = bestand.halte()
        val erste = launch { ablage.wendeAn(Bearbeitung.SetMenge("10001-1", 1)) }
        yield()
        val zweite = launch { ablage.wendeAn(Bearbeitung.SetMenge("10001-1", 1)) }
        repeat(3) { yield() }
        tor.complete(Unit)
        joinAll(erste, zweite)
        assertEquals(3, menge())
    }

    @Test
    fun `der beobachtete Bereich folgt der Sitzung, ohne dass jemand schreibt`() = runBlocking {
        val sitzung = MutableStateFlow<String?>("a")
        // Die Punktabfrage bleibt bei „a“: Beobachtet wird allein der Fluss der Sitzung.
        val ablage = Offlineablage(SpeicherBestand(), SpeicherAusgang(), { "a" }, bereichFluss = sitzung)
        ablage.uebernimm(Faecher.SETS, listOf(SetItem("10001-1")))
        assertEquals(listOf("10001-1"), ablage.beobachte(Faecher.SETS).first().liste.map { it.setNumber })
        sitzung.value = null
        assertEquals("abgemeldet zeigt nichts", emptyList<String>(), ablage.beobachte(Faecher.SETS).first().liste.map { it.setNumber })
    }
}
