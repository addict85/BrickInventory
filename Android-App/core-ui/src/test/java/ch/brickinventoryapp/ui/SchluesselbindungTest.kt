package ch.brickinventoryapp.ui

import ch.brickinventoryapp.model.schritt.Schluesselnonce
import ch.brickinventoryapp.model.schritt.Schrittaktion
import ch.brickinventoryapp.model.schritt.Schrittantwort
import ch.brickinventoryapp.model.schritt.Schrittbindung
import ch.brickinventoryapp.ui.components.AttestierbarerSchluessel
import ch.brickinventoryapp.ui.components.Schluesselbindung
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Base64

/**
 * Die Bindung des Geräteschlüssels nach der Anmeldung, ohne Keystore: Der
 * Schlüssel entsteht mit der Nonce des Servers als Attestation-Challenge, die
 * ganze Kette geht zum Server. Ein Gerät ohne Attestation bekommt eine eigene
 * Meldung und schickt nichts; ohne Nonce (auch bei 404) entsteht kein Schlüssel.
 *
 * Gegenproben (11.11.2026; lokal mit kotlinc gegen Attrappen, Robolectric entscheidet die CI):
 *   A  die Nonce nicht dekodiert, sondern als UTF-8-Bytes eingesetzt → rot „die Nonce
 *      des Servers wird zur Challenge …“; gegenproben/schluesselbindung-nonce-als-text.patch
 *   B  eine Kette aus nur dem selbstsignierten Zertifikat doch gesendet → rot „ein Geraet
 *      ohne Attestation …“; gegenproben/schluesselbindung-ohne-attestation-gesendet.patch
 */
class SchluesselbindungTest {

    private val nonceBytes = ByteArray(32) { it.toByte() }
    private val nonce = Base64.getUrlEncoder().withoutPadding().encodeToString(nonceBytes)
    private val blatt = byteArrayOf(1, 1)
    private val zwischen = byteArrayOf(2, 2)

    private class Server(var nonce: Schluesselnonce, var antwort: Schrittantwort = Schrittantwort.Frei) : Schrittbindung {
        val ketten = mutableListOf<List<ByteArray>>()
        override suspend fun challenge(aktion: Schrittaktion) = Schrittantwort.NichtGebunden
        override suspend fun freigeben(challenge: String, signatur: ByteArray) = Schrittantwort.Frei
        override suspend fun schluesselNonce() = nonce
        override suspend fun hinterlegeKette(kette: List<ByteArray>): Schrittantwort {
            ketten += kette
            return antwort
        }
    }

    private class Keystore(val kette: (ByteArray) -> List<ByteArray>) : AttestierbarerSchluessel {
        val challenges = mutableListOf<ByteArray>()
        override fun erzeugeMitAttestation(challenge: ByteArray): List<ByteArray> {
            challenges += challenge
            return kette(challenge)
        }
    }

    private fun binde(server: Server, keystore: Keystore) =
        runBlocking { Schluesselbindung(server, keystore, Dispatchers.Unconfined).binde() }

    @Test
    fun `die Nonce des Servers wird zur Challenge, die ganze Kette geht zum Server`() {
        val server = Server(Schluesselnonce.Nonce(nonce))
        val keystore = Keystore { listOf(blatt, zwischen) }
        assertEquals(Schluesselbindung.Ausgang.Gebunden, binde(server, keystore))
        assertArrayEquals(nonceBytes, keystore.challenges.single())
        val gesendet = server.ketten.single()
        assertEquals(2, gesendet.size)
        assertArrayEquals(blatt, gesendet[0])
        assertArrayEquals(zwischen, gesendet[1])
    }

    @Test
    fun `ein Geraet ohne Attestation bekommt eine Meldung und schickt nichts`() {
        for (keystore in listOf(Keystore { error("Attestation nicht unterstützt") }, Keystore { listOf(blatt) })) {
            val server = Server(Schluesselnonce.Nonce(nonce))
            assertEquals(Schluesselbindung.Ausgang.OhneAttestation, binde(server, keystore))
            assertTrue(server.ketten.isEmpty())
        }
    }

    @Test
    fun `eine Absage des Servers kommt mit ihrem Satz an`() {
        val server = Server(Schluesselnonce.Nonce(nonce), Schrittantwort.Abgelehnt("nicht bestätigt"))
        assertEquals(Schluesselbindung.Ausgang.Abgelehnt("nicht bestätigt"), binde(server, Keystore { listOf(blatt, zwischen) }))
    }

    @Test
    fun `ohne Nonce entsteht kein Schluessel`() {
        val keystore = Keystore { listOf(blatt, zwischen) }
        for (absage in listOf(Schluesselnonce.Abgelehnt("Bitte neu anmelden."), Schluesselnonce.Abgelehnt(null))) {
            val server = Server(absage)
            assertEquals(Schluesselbindung.Ausgang.Abgelehnt(absage.meldung), binde(server, keystore))
            assertTrue(server.ketten.isEmpty())
        }
        assertTrue(keystore.challenges.isEmpty())
    }
}
