package ch.brickinventoryapp.ui

import ch.brickinventoryapp.model.step.Schluesselnonce
import ch.brickinventoryapp.model.step.Schrittaktion
import ch.brickinventoryapp.model.step.Schrittantwort
import ch.brickinventoryapp.model.step.Schrittbindung
import ch.brickinventoryapp.ui.components.AttestierbarerKey
import ch.brickinventoryapp.ui.components.Schluesselbindung
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Base64

/**
 * The device key's binding after sign-in, without a keystore: the
 * key is created with the server's nonce as an attestation challenge, the
 * whole chain goes to the server. A device without attestation gets its own
 * notice and sends nothing; without a nonce (even on a 404) no key is created.
 *
 * Counter-checks (Nov 11, 2026; locally with kotlinc against stubs, Robolectric decides CI):
 *   A  the nonce not decoded but inserted as UTF-8 bytes → red „die Nonce
 *      des Servers wird zur Challenge …“; gegenproben/schluesselbindung-nonce-als-text.patch
 *   B  a chain of only the self-signed certificate sent anyway → red „ein Geraet
 *      ohne Attestation …“; gegenproben/schluesselbindung-ohne-attestation-gesendet.patch
 */
class SchluesselbindungTest {

    private val nonceBytes = ByteArray(32) { it.toByte() }
    private val nonce = Base64.getUrlEncoder().withoutPadding().encodeToString(nonceBytes)
    private val blatt = byteArrayOf(1, 1)
    private val zwischen = byteArrayOf(2, 2)

    private class Server(var nonce: Schluesselnonce, var antwort: Schrittantwort = Schrittantwort.Free) : Schrittbindung {
        val chains = mutableListOf<List<ByteArray>>()
        override suspend fun challenge(aktion: Schrittaktion) = Schrittantwort.NotBound
        override suspend fun freigeben(challenge: String, signatur: ByteArray) = Schrittantwort.Free
        override suspend fun schluesselNonce() = nonce
        override suspend fun depositChain(kette: List<ByteArray>): Schrittantwort {
            chains += kette
            return antwort
        }
    }

    private class Keystore(val kette: (ByteArray) -> List<ByteArray>) : AttestierbarerKey {
        val challenges = mutableListOf<ByteArray>()
        override fun createWithAttestation(challenge: ByteArray): List<ByteArray> {
            challenges += challenge
            return kette(challenge)
        }
    }

    private fun bind(server: Server, keystore: Keystore) =
        runBlocking { Schluesselbindung(server, keystore, Dispatchers.Unconfined).bind() }

    @Test
    fun `the server's nonce becomes the challenge, the whole chain goes to the server`() {
        val server = Server(Schluesselnonce.Nonce(nonce))
        val keystore = Keystore { listOf(blatt, zwischen) }
        assertEquals(Schluesselbindung.Ausgang.Gebunden, bind(server, keystore))
        assertArrayEquals(nonceBytes, keystore.challenges.single())
        val gesendet = server.chains.single()
        assertEquals(2, gesendet.size)
        assertArrayEquals(blatt, gesendet[0])
        assertArrayEquals(zwischen, gesendet[1])
    }

    @Test
    fun `a device without attestation gets a message and sends nothing`() {
        for (keystore in listOf(Keystore { error("Attestation nicht unterstützt") }, Keystore { listOf(blatt) })) {
            val server = Server(Schluesselnonce.Nonce(nonce))
            assertEquals(Schluesselbindung.Ausgang.WithoutAttestation, bind(server, keystore))
            assertTrue(server.chains.isEmpty())
        }
    }

    @Test
    fun `a refusal of the server arrives with its sentence`() {
        val server = Server(Schluesselnonce.Nonce(nonce), Schrittantwort.Rejected("nicht bestätigt"))
        assertEquals(Schluesselbindung.Ausgang.Rejected("nicht bestätigt"), bind(server, Keystore { listOf(blatt, zwischen) }))
    }

    @Test
    fun `without a nonce no key is created`() {
        val keystore = Keystore { listOf(blatt, zwischen) }
        for (rejection in listOf(Schluesselnonce.Rejected("Bitte neu anmelden."), Schluesselnonce.Rejected(null))) {
            val server = Server(rejection)
            assertEquals(Schluesselbindung.Ausgang.Rejected(rejection.meldung), bind(server, keystore))
            assertTrue(server.chains.isEmpty())
        }
        assertTrue(keystore.challenges.isEmpty())
    }
}
