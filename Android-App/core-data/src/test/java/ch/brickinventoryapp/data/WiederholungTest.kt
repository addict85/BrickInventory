package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.Netzlage.Wiederholung
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Die Wiederholungsregel der Abrufe: nur bei vorübergehenden Fehlern, mit
 * wachsender Pause, und ohne Netz gar nicht — dann zeigt die Ablage ihren Stand.
 *
 * Gegenproben (kotlinc und JUnit gegen Netzlage.Wiederholung):
 *   A  die Pause nicht verdoppelt → rot „ein vorübergehender Fehler wird mit
 *      wachsender Pause wiederholt“ ([1000, 1000, 1000, 1000])
 *   B  die Prüfung auf KEIN_NETZ entfernt → rot „ohne Netz wird nicht gewartet“
 *   C  die Prüfung `transient` entfernt → rot „eine Auskunft des Servers wird nicht
 *      wiederholt“
 */
class WiederholungTest {

    private val pausen = mutableListOf<Long>()
    private var lage = Netzlage.Art.WLAN

    private fun regel(versuche: Int = 5) = Wiederholung.fuerTest(versuche, { lage }) { pausen += it }

    private fun abrufe(vararg ergebnisse: Ergebnis<String>): Pair<MutableList<Ergebnis<String>>, suspend () -> Ergebnis<String>> {
        val rest = ergebnisse.toMutableList()
        val gerufen = mutableListOf<Ergebnis<String>>()
        return gerufen to { rest.removeAt(0).also { gerufen += it } }
    }

    @Test
    fun `ein voruebergehender Fehler wird mit wachsender Pause wiederholt`() = runBlocking {
        val netz = Ergebnis.Error.Netz()
        val (gerufen, abruf) = abrufe(netz, netz, netz, netz, Ergebnis.Success("da"))
        assertEquals(Ergebnis.Success("da"), regel().wiederhole(abruf))
        assertEquals(5, gerufen.size)
        assertEquals(listOf(1_000L, 2_000L, 4_000L, 8_000L), pausen)
    }

    @Test
    fun `nach dem letzten Versuch kommt der Fehler zurueck`() = runBlocking {
        val netz = Ergebnis.Error.Zeitueberschreitung
        val (gerufen, abruf) = abrufe(netz, netz, netz)
        assertEquals(netz, regel(versuche = 3).wiederhole(abruf))
        assertEquals(3, gerufen.size)
    }

    @Test
    fun `ohne Netz wird nicht gewartet`() = runBlocking {
        lage = Netzlage.Art.KEIN_NETZ
        val (gerufen, abruf) = abrufe(Ergebnis.Error.Netz(), Ergebnis.Success("nie"))
        assertEquals(Ergebnis.Error.Netz(), regel().wiederhole(abruf))
        assertEquals(1, gerufen.size)
        assertEquals(emptyList<Long>(), pausen)
    }

    @Test
    fun `eine Auskunft des Servers wird nicht wiederholt`() = runBlocking {
        val (gerufen, abruf) = abrufe(Ergebnis.Error.Server(404), Ergebnis.Success("nie"))
        assertEquals(Ergebnis.Error.Server(404), regel().wiederhole(abruf))
        assertEquals(1, gerufen.size)
    }

    @Test
    fun `hoechstens begrenzt die Versuche, nie unter einen`() = runBlocking {
        val netz = Ergebnis.Error.Netz()
        val (gerufen, abruf) = abrufe(netz, netz, netz)
        regel().hoechstens(2).wiederhole(abruf)
        assertEquals(2, gerufen.size)
        val (einmal, abruf2) = abrufe(netz)
        regel().hoechstens(0).wiederhole(abruf2)
        assertEquals(1, einmal.size)
    }
}
