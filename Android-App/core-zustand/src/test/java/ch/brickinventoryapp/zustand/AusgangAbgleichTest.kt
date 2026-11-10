package ch.brickinventoryapp.zustand

import ch.brickinventoryapp.data.lokal.Abgleich
import ch.brickinventoryapp.data.lokal.Abgleichsereignis
import ch.brickinventoryapp.data.lokal.Abgleichsergebnis
import ch.brickinventoryapp.offline.Bearbeitung
import ch.brickinventoryapp.data.lokal.Bearbeitungssender
import ch.brickinventoryapp.offline.Offlineablage
import ch.brickinventoryapp.data.lokal.Sendeergebnis
import ch.brickinventoryapp.offline.SpeicherAusgang
import ch.brickinventoryapp.offline.SpeicherBestand
import ch.brickinventoryapp.data.lokal.einordnen
import ch.brickinventoryapp.data.lokal.einordnenLoeschen
import ch.brickinventoryapp.data.repository.Ergebnis
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
 * Gegenproben:
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
 *   (F und G gemessen)
 *   F  in Abgleich.lauf `p.schluessel` → `java.util.UUID.randomUUID().toString()`
 *      → rot „Die Wiederholung trägt denselben Schlüssel“
 *   G  in einordnenLoeschen die 404-Ausnahme entfernt → rot „beim Löschen …“
 *   H  in Abgleich.lauf die Bereichsprüfung vor dem Senden entfernt → rot „ein
 *      Konto-Wechsel vor dem Senden …“ (gegenproben/ausgang-ohne-pruefung-vor-senden.patch)
 */
class AusgangAbgleichTest {

    private fun menge(n: Int) = Bearbeitung.SetMenge("100$n-1", 1)

    private class Sender(val antwort: (Bearbeitung) -> Sendeergebnis = { Sendeergebnis.Angenommen }) : Bearbeitungssender {
        val gesendet: MutableList<Bearbeitung> = Collections.synchronizedList(mutableListOf())
        val schluessel: MutableList<String> = Collections.synchronizedList(mutableListOf())
        var bremse: CompletableDeferred<Unit>? = null
        override suspend fun sende(b: Bearbeitung, schluessel: String): Sendeergebnis {
            gesendet += b
            this.schluessel += schluessel
            bremse?.await()
            return antwort(b)
        }
    }

    /** Ablage und Ausgang getrennt in der Hand: Der Test sieht im Ausgang nach, die Ablage zeigt ihn nicht. */
    private class Welt(bereich: suspend () -> String? = { "konto-a" }) {
        val ausgang = SpeicherAusgang()
        val ablage = Offlineablage(SpeicherBestand(), ausgang, bereich)
        fun abgleich(s: Sender) = Abgleich(ablage, ausgang, s)
    }

    private fun nummern(s: Sender) = s.gesendet.map { (it as Bearbeitung.SetMenge).setNumber.removePrefix("100").removeSuffix("-1").toInt() }

    @Test
    fun `sendet der Reihe nach und leert den Ausgang`() = runBlocking {
        val w = Welt()
        val a = w.ablage
        for (n in 1..3) a.puffere(menge(n))
        val s = Sender()
        assertEquals(Abgleichsergebnis.FERTIG, w.abgleich(s).sende())
        assertEquals(listOf(1, 2, 3), nummern(s))
        assertEquals(0, w.ausgang.alle("konto-a").size)
    }

    @Test
    fun `was später geht, hält alles dahinter auf`() = runBlocking {
        val w = Welt()
        val a = w.ablage
        for (n in 1..3) a.puffere(menge(n))
        var netz = false
        val s = Sender { if (netz) Sendeergebnis.Angenommen else Sendeergebnis.Spaeter }
        assertEquals(Abgleichsergebnis.SPAETER, w.abgleich(s).sende())
        assertEquals("Nach dem ersten „später“ darf nichts weiter raus", listOf(1), nummern(s))
        val vorn = w.ausgang.erster("konto-a")!!
        assertEquals("Der Versuch zählt", 1, vorn.versuche)
        netz = true
        assertEquals(Abgleichsergebnis.FERTIG, w.abgleich(s).sende())
        assertEquals("Wiederholt wird derselbe Posten, dann die übrigen", listOf(1, 1, 2, 3), nummern(s))
        assertEquals("Die Wiederholung trägt denselben Schlüssel, die übrigen je einen eigenen",
            listOf(true, false, false), s.schluessel.zipWithNext { x, y -> x == y })
    }

    @Test
    fun `eine Ablehnung verwirft und meldet, der Rest geht weiter`() = runBlocking {
        val w = Welt()
        val a = w.ablage
        for (n in 1..3) a.puffere(menge(n))
        val s = Sender { b -> if ((b as Bearbeitung.SetMenge).setNumber == "1002-1") Sendeergebnis.Abgelehnt("gibt es nicht", 404) else Sendeergebnis.Angenommen }
        val abgleich = w.abgleich(s)
        val ereignisse = mutableListOf<Abgleichsereignis>()
        val sammler = launch { abgleich.ereignisse.collect { ereignisse += it } }
        yield()
        assertEquals(Abgleichsergebnis.FERTIG, abgleich.sende())
        yield()
        sammler.cancel()
        assertEquals(listOf(1, 2, 3), nummern(s))
        val verworfen = ereignisse.filterIsInstance<Abgleichsereignis.Verworfen>().single()
        assertEquals("1002-1", verworfen.ziel)
        assertEquals("gibt es nicht", verworfen.meldung)
        assertTrue("Die Liste wird neu geladen, damit die lokale Annahme verschwindet: $ereignisse",
            ereignisse.any { it is Abgleichsereignis.Gesendet })
        assertEquals(0, w.ausgang.alle("konto-a").size)
    }

    @Test
    fun `zwei Läufe zugleich senden nichts doppelt`() = runBlocking {
        val w = Welt()
        val a = w.ablage
        for (n in 1..2) a.puffere(menge(n))
        val s = Sender().apply { bremse = CompletableDeferred() }
        val abgleich = w.abgleich(s)
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
        assertEquals(Sendeergebnis.Spaeter, einordnen(Ergebnis.Error.Abgewiesen()))
        assertEquals(Sendeergebnis.Spaeter, einordnen(Ergebnis.Error.Server(429)))
        assertEquals(Sendeergebnis.Spaeter, einordnen(Ergebnis.Error.Server(503)))
        assertEquals(Sendeergebnis.Spaeter, einordnen(Ergebnis.Error.Netz()))
        assertEquals(Sendeergebnis.Abgelehnt("nein", 400), einordnen(Ergebnis.Error.Server(400, "nein")))
        assertEquals("2xx ohne Rumpf ist angekommen",
            Sendeergebnis.Angenommen, einordnen(Ergebnis.Error.LeereAntwort()))
    }

    @Test
    fun `beim Löschen ist „gibt es nicht mehr“ angekommen, anderes nicht`() {
        assertEquals(Sendeergebnis.Angenommen, einordnenLoeschen(Ergebnis.Error.Server(404, "weg")))
        assertEquals(Sendeergebnis.Abgelehnt("nein", 403), einordnenLoeschen(Ergebnis.Error.Server(403, "nein")))
        assertEquals(Sendeergebnis.Spaeter, einordnenLoeschen(Ergebnis.Error.Netz()))
        assertEquals("ausserhalb des Löschens bleibt 404 eine Ablehnung",
            Sendeergebnis.Abgelehnt("weg", 404), einordnen(Ergebnis.Error.Server(404, "weg")))
    }

    @Test
    fun `nach zu vielen Versuchen wird verworfen statt ewig zu warten`() = runBlocking {
        val w = Welt()
        val a = w.ablage
        a.puffere(menge(1))
        val s = Sender { Sendeergebnis.Spaeter }
        repeat(Abgleich.MAX_VERSUCHE - 1) { assertEquals(Abgleichsergebnis.SPAETER, w.abgleich(s).sende()) }
        assertEquals(Abgleichsergebnis.FERTIG, w.abgleich(s).sende())
        assertEquals(0, w.ausgang.alle("konto-a").size)
    }

    @Test
    fun `ein Konto-Wechsel vor dem Senden schickt keinen Posten mit dem neuen Konto`() = runBlocking {
        var konto = "konto-a"
        var wechsleNachAbfrage = false
        val w = Welt {
            konto.also { if (wechsleNachAbfrage) { konto = "konto-b"; wechsleNachAbfrage = false } }
        }
        val a = w.ablage
        for (n in 1..2) a.puffere(menge(n))
        // Der Lauf beginnt unter konto-a, vor dem ersten Senden gilt schon konto-b.
        wechsleNachAbfrage = true
        val s = Sender()
        assertEquals(Abgleichsergebnis.NICHT_ANGEMELDET, w.abgleich(s).sende())
        assertEquals("Kein Posten von konto-a geht mit dem Token von konto-b raus",
            emptyList<Bearbeitung>(), s.gesendet.toList())
        assertEquals(2, w.ausgang.alle("konto-a").size)
    }

    @Test
    fun `ohne Anmeldung wird nichts gesendet`() = runBlocking {
        val w = Welt { null }
        val a = w.ablage
        val s = Sender()
        assertEquals(false, a.puffere(menge(1)))
        assertEquals(Abgleichsergebnis.NICHT_ANGEMELDET, w.abgleich(s).sende())
        assertEquals(emptyList<Bearbeitung>(), s.gesendet.toList())
    }
}
