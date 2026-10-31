package ch.brickinventoryapp

import ch.brickinventoryapp.data.lokal.Abgleich
import ch.brickinventoryapp.data.lokal.Abgleichsereignis
import ch.brickinventoryapp.data.lokal.Abgleichsergebnis
import ch.brickinventoryapp.data.lokal.Bearbeitung
import ch.brickinventoryapp.data.lokal.Bearbeitungssender
import ch.brickinventoryapp.data.lokal.Offlineablage
import ch.brickinventoryapp.data.lokal.Sendeergebnis
import ch.brickinventoryapp.data.lokal.SpeicherAusgang
import ch.brickinventoryapp.data.lokal.SpeicherBestand
import ch.brickinventoryapp.data.lokal.einordnen
import ch.brickinventoryapp.data.repository.Fehlerart
import ch.brickinventoryapp.data.repository.Result
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Collections

/**
 * Der Ausgang wird der Reihe nach gesendet; ein Posten geht genau einmal raus.
 * Läuft gegen die Logik ([Abgleich], [Offlineablage]) mit Ablagen im Speicher
 * und einem Sender, der aufschreibt, was er bekommt.
 *
 * Gegenproben (30.10.2026, gemessen):
 *   A  in SpeicherAusgang.erster `minByOrNull` → `maxByOrNull` → rot u. a. „eine
 *      Ablehnung verwirft …“ (gesendet [3, 2, 1] statt [1, 2, 3])
 *   B  in Abgleich bei Spaeter `return` weggelassen (weiter mit dem nächsten) →
 *      rot „was später geht, hält alles dahinter auf“ (FERTIG statt SPAETER)
 *   C  in Abgleich die Sperre entfernt (`sperre.withLock` → `run`) → rot
 *      „zwei Läufe zugleich senden nichts doppelt“ (gesendet [1, 1, 2])
 *   D  in einordnen 401 aus der Ausnahmeliste genommen → rot „eine abgelaufene
 *      Sitzung verwirft nichts“
 *   E  in Abgleich.verwirf die Meldung weggelassen → rot „eine Ablehnung verwirft
 *      und meldet“
 */
class AusgangAbgleichTest {

    private fun menge(n: Int) = Bearbeitung.SetMenge("100$n-1", 1)

    private class Sender(val antwort: (Bearbeitung) -> Sendeergebnis = { Sendeergebnis.Angenommen }) : Bearbeitungssender {
        val gesendet: MutableList<Bearbeitung> = Collections.synchronizedList(mutableListOf())
        var bremse: CompletableDeferred<Unit>? = null
        override suspend fun sende(b: Bearbeitung): Sendeergebnis {
            gesendet += b
            bremse?.await()
            return antwort(b)
        }
    }

    private fun ablage() = Offlineablage(SpeicherBestand(), SpeicherAusgang(), { "konto-a" })

    private fun nummern(s: Sender) = s.gesendet.map { (it as Bearbeitung.SetMenge).setNumber.removePrefix("100").removeSuffix("-1").toInt() }

    @Test
    fun `sendet der Reihe nach und leert den Ausgang`() = runBlocking {
        val a = ablage()
        for (n in 1..3) a.puffere(menge(n))
        val s = Sender()
        assertEquals(Abgleichsergebnis.FERTIG, Abgleich(a, s).sende())
        assertEquals(listOf(1, 2, 3), nummern(s))
        assertEquals(0, a.ausgang.alle("konto-a").size)
    }

    @Test
    fun `was später geht, hält alles dahinter auf`() = runBlocking {
        val a = ablage()
        for (n in 1..3) a.puffere(menge(n))
        var netz = false
        val s = Sender { if (netz) Sendeergebnis.Angenommen else Sendeergebnis.Spaeter }
        assertEquals(Abgleichsergebnis.SPAETER, Abgleich(a, s).sende())
        assertEquals("Nach dem ersten „später“ darf nichts weiter raus", listOf(1), nummern(s))
        val vorn = a.ausgang.erster("konto-a")!!
        assertEquals("Der Versuch zählt", 1, vorn.versuche)
        netz = true
        assertEquals(Abgleichsergebnis.FERTIG, Abgleich(a, s).sende())
        assertEquals("Wiederholt wird derselbe Posten, dann die übrigen", listOf(1, 1, 2, 3), nummern(s))
    }

    @Test
    fun `eine Ablehnung verwirft und meldet, der Rest geht weiter`() = runBlocking {
        val a = ablage()
        for (n in 1..3) a.puffere(menge(n))
        val ereignisse = mutableListOf<Abgleichsereignis>()
        val sammler = launch { a.ereignisse.collect { ereignisse += it } }
        yield()
        val s = Sender { b -> if ((b as Bearbeitung.SetMenge).setNumber == "1002-1") Sendeergebnis.Abgelehnt("gibt es nicht", 404) else Sendeergebnis.Angenommen }
        assertEquals(Abgleichsergebnis.FERTIG, Abgleich(a, s).sende())
        yield()
        sammler.cancel()
        assertEquals(listOf(1, 2, 3), nummern(s))
        val verworfen = ereignisse.filterIsInstance<Abgleichsereignis.Verworfen>().single()
        assertEquals("1002-1", verworfen.bearbeitung.ziel)
        assertEquals("gibt es nicht", verworfen.meldung)
        assertTrue("Die Liste wird neu geladen, damit die lokale Annahme verschwindet: $ereignisse",
            ereignisse.any { it is Abgleichsereignis.Gesendet })
        assertEquals(0, a.ausgang.alle("konto-a").size)
    }

    @Test
    fun `zwei Läufe zugleich senden nichts doppelt`() = runBlocking {
        val a = ablage()
        for (n in 1..2) a.puffere(menge(n))
        val s = Sender().apply { bremse = CompletableDeferred() }
        val abgleich = Abgleich(a, s)
        val erster = async { abgleich.sende() }
        val zweiter = async { abgleich.sende() }
        // Beide Läufe sind gestartet, der erste hängt im Senden des ersten Postens.
        repeat(5) { yield() }
        s.bremse!!.complete(Unit)
        erster.await(); zweiter.await()
        assertEquals("Jeder Posten genau einmal", listOf(1, 2), nummern(s))
    }

    @Test
    fun `eine abgelaufene Sitzung verwirft nichts`() {
        assertEquals(Sendeergebnis.Spaeter, einordnen(Result.Error("", unauthorized = true, httpCode = 401)))
        assertEquals(Sendeergebnis.Spaeter, einordnen(Result.Error("", httpCode = 429)))
        assertEquals(Sendeergebnis.Spaeter, einordnen(Result.Error("", httpCode = 503)))
        assertEquals(Sendeergebnis.Spaeter, einordnen(Result.Error("", transient = true, art = Fehlerart.NETZ)))
        assertEquals(Sendeergebnis.Abgelehnt("nein", 400), einordnen(Result.Error("nein", httpCode = 400)))
        assertEquals("2xx ohne Rumpf ist angekommen",
            Sendeergebnis.Angenommen, einordnen(Result.Error("", art = Fehlerart.LEERE_ANTWORT)))
    }

    @Test
    fun `nach zu vielen Versuchen wird verworfen statt ewig zu warten`() = runBlocking {
        val a = ablage()
        a.puffere(menge(1))
        val s = Sender { Sendeergebnis.Spaeter }
        repeat(Abgleich.MAX_VERSUCHE - 1) { assertEquals(Abgleichsergebnis.SPAETER, Abgleich(a, s).sende()) }
        assertEquals(Abgleichsergebnis.FERTIG, Abgleich(a, s).sende())
        assertEquals(0, a.ausgang.alle("konto-a").size)
    }

    @Test
    fun `ohne Anmeldung wird nichts gesendet`() = runBlocking {
        val a = Offlineablage(SpeicherBestand(), SpeicherAusgang(), { null })
        val s = Sender()
        assertEquals(false, a.puffere(menge(1)))
        assertEquals(Abgleichsergebnis.NICHT_ANGEMELDET, Abgleich(a, s).sende())
        assertEquals(emptyList<Bearbeitung>(), s.gesendet.toList())
    }
}
