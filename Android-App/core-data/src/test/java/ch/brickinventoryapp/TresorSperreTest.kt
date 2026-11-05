package ch.brickinventoryapp

import ch.brickinventoryapp.util.TRESOR_ANLAUF_MS
import ch.brickinventoryapp.util.TRESOR_NACHLAUF_MS
import ch.brickinventoryapp.util.TokenVerschluesselung
import ch.brickinventoryapp.util.Tresorbefund
import ch.brickinventoryapp.util.liesToken
import ch.brickinventoryapp.util.oeffneMitNeuversuch
import ch.brickinventoryapp.util.tresorFehlerDauerhaft
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import android.security.keystore.KeyPermanentlyInvalidatedException
import java.security.InvalidKeyException
import java.security.KeyStoreException
import java.security.ProviderException
import java.security.UnrecoverableKeyException
import javax.crypto.AEADBadTagException
import javax.crypto.BadPaddingException

/**
 * Ein vorübergehender Keystore-Fehler meldet nicht ab (sec7, N7). Bisher ergab
 * jede Ausnahme beim Entschlüsseln „kein Token“, auch ein KeyStoreException beim
 * Hochfahren oder ein hängender StrongBox-Chip.
 *
 * Gegenproben (03.11.2026, kotlinc lokal gemessen):
 *   A  tresorFehlerDauerhaft() immer true (der alte Stand: jeder Fehler = weg) →
 *      rot „nur ein dauerhafter Fehler heisst Token weg“ und „ein vorübergehender
 *      Fehler wird einmal wiederholt“
 *   B  oeffneMitNeuversuch() mit `repeat(1)` → rot „… wird einmal wiederholt“
 *   C  liesToken() meldet bei Gesperrt sofort „“ (`melde(alt ?: ""); return`) →
 *      rot „ein gesperrter Keystore beim Start …“ und „… nachgemeldet“
 *   D  liesToken() hört nach dem Anlauf auf (`return` nach dem ersten „“) → rot
 *      „ein länger gesperrter Keystore meldet das Token nach“
 */
class TresorSperreTest {

    @Test
    fun `nur ein dauerhafter Fehler heisst Token weg`() {
        for (e in listOf(AEADBadTagException("tag"), BadPaddingException("x"),
                         KeyPermanentlyInvalidatedException("neu eingerichtet"),
                         UnrecoverableKeyException("x"), IllegalArgumentException("base64"))) {
            assertTrue("$e", tresorFehlerDauerhaft(e))
        }
        for (e in listOf(KeyStoreException("beim Hochfahren"), ProviderException("StrongBox"),
                         InvalidKeyException("Keystore nicht bereit"), IllegalStateException("x"),
                         RuntimeException("x"))) {
            assertFalse("$e", tresorFehlerDauerhaft(e))
        }
    }

    @Test
    fun `ein voruebergehender Fehler wird einmal wiederholt, ein dauerhafter nicht`() {
        var n = 0
        assertEquals(Tresorbefund.Lesbar("t"), oeffneMitNeuversuch {
            if (n++ == 0) throw KeyStoreException("kurz") else "t"
        })
        n = 0
        assertEquals(Tresorbefund.Gesperrt, oeffneMitNeuversuch { n++; throw ProviderException("haengt") })
        assertEquals(2, n)
        n = 0
        assertEquals(Tresorbefund.Weg, oeffneMitNeuversuch { n++; throw AEADBadTagException() })
        assertEquals("Kein zweiter Versuch bei einem falschen Schlüssel", 1, n)
        assertEquals(Tresorbefund.Weg, oeffneMitNeuversuch { null })
    }

    /** Liefert der Reihe nach [befunde], danach immer den letzten. */
    private class Folge(vararg befunde: Tresorbefund) : TokenVerschluesselung {
        private val rest = ArrayDeque(befunde.toList())
        override fun verschluessle(klartext: String) = klartext
        override fun entschluessle(gespeichert: String): String? = null
        override fun oeffne(gespeichert: String): Tresorbefund = if (rest.size > 1) rest.removeFirst() else rest.first()
    }

    private fun lies(tresor: TokenVerschluesselung, alt: String? = null): Pair<List<String>, List<Long>> {
        val gemeldet = mutableListOf<String>()
        val pausen = mutableListOf<Long>()
        runBlocking { liesToken(tresor, "geheim", alt, melde = { gemeldet += it }, warte = { pausen += it }) }
        return gemeldet to pausen
    }

    @Test
    fun `ein gesperrter Keystore beim Start wird abgewartet, ohne abzumelden`() {
        val (gemeldet, pausen) = lies(Folge(Tresorbefund.Gesperrt, Tresorbefund.Gesperrt, Tresorbefund.Lesbar("token")))
        assertEquals("Kein leeres Token vor dem echten", listOf("token"), gemeldet)
        assertEquals(TRESOR_ANLAUF_MS.take(2), pausen)
        assertTrue("Der Anlauf bleibt unter der Wartezeit des Wächters (5 s)", TRESOR_ANLAUF_MS.sum() < 5_000)
    }

    @Test
    fun `ein laenger gesperrter Keystore meldet das Token nach`() {
        val sperren = Array<Tresorbefund>(TRESOR_ANLAUF_MS.size + 3) { Tresorbefund.Gesperrt }
        val (gemeldet, pausen) = lies(Folge(*sperren, Tresorbefund.Lesbar("token")))
        assertEquals("Erst die Anmeldemaske, dann wieder angemeldet", listOf("", "token"), gemeldet)
        assertEquals(TRESOR_ANLAUF_MS + List(3) { TRESOR_NACHLAUF_MS }, pausen)
    }

    @Test
    fun `ein dauerhaft gesperrter Keystore gibt irgendwann auf, ein fehlender Schluessel sofort`() {
        val (gemeldet, pausen) = lies(Folge(Tresorbefund.Gesperrt))
        assertEquals(listOf(""), gemeldet)
        assertTrue("Höchstens zehn Minuten: ${pausen.sum()}", pausen.sum() <= 10 * 60_000L + TRESOR_ANLAUF_MS.sum())
        assertEquals(listOf("alt") to emptyList<Long>(), lies(Folge(Tresorbefund.Weg), alt = "alt"))
    }
}
