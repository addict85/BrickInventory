package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.Netzlage.Wiederholung
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The retry rule of the fetches: only on temporary errors, with
 * growing pause, and without network not at all — then the store shows its state.
 *
 * Counter-checks (kotlinc and JUnit against Netzlage.Wiederholung):
 *   A  the pause not doubled → red “a temporary error is retried with
 *      growing pause” ([1000, 1000, 1000, 1000])
 *   B  the check for KEIN_NETZ removed → red “without network there is no waiting”
 *   C  the check `transient` removed → red “an answer of the server is not
 *      retried”
 */
class RetryTest {

    private val pausen = mutableListOf<Long>()
    private var situation = Netzlage.Art.WLAN

    private fun rule(versuche: Int = 5) = Wiederholung.forTest(versuche, { situation }) { pausen += it }

    private fun fetches(vararg results: Ergebnis<String>): Pair<MutableList<Ergebnis<String>>, suspend () -> Ergebnis<String>> {
        val rest = results.toMutableList()
        val called = mutableListOf<Ergebnis<String>>()
        return called to { rest.removeAt(0).also { called += it } }
    }

    @Test
    fun `a temporary error is retried with growing pause`() = runBlocking {
        val netz = Ergebnis.Fehler.Netz()
        val (called, abruf) = fetches(netz, netz, netz, netz, Ergebnis.Erfolg("da"))
        assertEquals(Ergebnis.Erfolg("da"), rule().wiederhole(abruf))
        assertEquals(5, called.size)
        assertEquals(listOf(1_000L, 2_000L, 4_000L, 8_000L), pausen)
    }

    @Test
    fun `after the last attempt the error comes back`() = runBlocking {
        val netz = Ergebnis.Fehler.Zeitueberschreitung
        val (called, abruf) = fetches(netz, netz, netz)
        assertEquals(netz, rule(versuche = 3).wiederhole(abruf))
        assertEquals(3, called.size)
    }

    @Test
    fun `without network there is no waiting`() = runBlocking {
        situation = Netzlage.Art.KEIN_NETZ
        val (called, abruf) = fetches(Ergebnis.Fehler.Netz(), Ergebnis.Erfolg("nie"))
        assertEquals(Ergebnis.Fehler.Netz(), rule().wiederhole(abruf))
        assertEquals(1, called.size)
        assertEquals(emptyList<Long>(), pausen)
    }

    @Test
    fun `an answer of the server is not retried`() = runBlocking {
        val (called, abruf) = fetches(Ergebnis.Fehler.Server(404), Ergebnis.Erfolg("nie"))
        assertEquals(Ergebnis.Fehler.Server(404), rule().wiederhole(abruf))
        assertEquals(1, called.size)
    }

    @Test
    fun `at most limits the attempts, never below one`() = runBlocking {
        val netz = Ergebnis.Fehler.Netz()
        val (called, abruf) = fetches(netz, netz, netz)
        rule().atMost(2).wiederhole(abruf)
        assertEquals(2, called.size)
        val (einmal, abruf2) = fetches(netz)
        rule().atMost(0).wiederhole(abruf2)
        assertEquals(1, einmal.size)
    }
}
