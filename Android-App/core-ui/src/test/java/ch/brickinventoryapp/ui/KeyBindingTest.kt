package ch.brickinventoryapp.ui

import ch.brickinventoryapp.model.step.KeyNonce
import ch.brickinventoryapp.model.step.StepAction
import ch.brickinventoryapp.model.step.StepResponse
import ch.brickinventoryapp.model.step.StepBinding
import ch.brickinventoryapp.ui.components.AttestableKey
import ch.brickinventoryapp.ui.components.KeyBinding
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
 *      des Servers wird zur Challenge …“; counter-checks/schluesselbindung-nonce-als-text.patch
 *   B  a chain of only the self-signed certificate sent anyway → red „ein Geraet
 *      ohne Attestation …“; counter-checks/schluesselbindung-ohne-attestation-gesendet.patch
 */
class KeyBindingTest {

    private val nonceBytes = ByteArray(32) { it.toByte() }
    private val nonce = Base64.getUrlEncoder().withoutPadding().encodeToString(nonceBytes)
    private val sheet = byteArrayOf(1, 1)
    private val between = byteArrayOf(2, 2)

    private class Server(var nonce: KeyNonce, var response: StepResponse = StepResponse.Free) : StepBinding {
        val chains = mutableListOf<List<ByteArray>>()
        override suspend fun challenge(action: StepAction) = StepResponse.NotBound
        override suspend fun release(challenge: String, signature: ByteArray) = StepResponse.Free
        override suspend fun keyNonce() = nonce
        override suspend fun depositChain(chain: List<ByteArray>): StepResponse {
            chains += chain
            return response
        }
    }

    private class Keystore(val chain: (ByteArray) -> List<ByteArray>) : AttestableKey {
        val challenges = mutableListOf<ByteArray>()
        override fun createWithAttestation(challenge: ByteArray): List<ByteArray> {
            challenges += challenge
            return chain(challenge)
        }
    }

    private fun bind(server: Server, keystore: Keystore) =
        runBlocking { KeyBinding(server, keystore, Dispatchers.Unconfined).bind() }

    @Test
    fun `the server's nonce becomes the challenge, the whole chain goes to the server`() {
        val server = Server(KeyNonce.Nonce(nonce))
        val keystore = Keystore { listOf(sheet, between) }
        assertEquals(KeyBinding.Outbox.Bound, bind(server, keystore))
        assertArrayEquals(nonceBytes, keystore.challenges.single())
        val sent = server.chains.single()
        assertEquals(2, sent.size)
        assertArrayEquals(sheet, sent[0])
        assertArrayEquals(between, sent[1])
    }

    @Test
    fun `a device without attestation gets a message and sends nothing`() {
        for (keystore in listOf(Keystore { error("Attestation nicht unterstützt") }, Keystore { listOf(sheet) })) {
            val server = Server(KeyNonce.Nonce(nonce))
            assertEquals(KeyBinding.Outbox.WithoutAttestation, bind(server, keystore))
            assertTrue(server.chains.isEmpty())
        }
    }

    @Test
    fun `a refusal of the server arrives with its sentence`() {
        val server = Server(KeyNonce.Nonce(nonce), StepResponse.Rejected("nicht bestätigt"))
        assertEquals(KeyBinding.Outbox.Rejected("nicht bestätigt"), bind(server, Keystore { listOf(sheet, between) }))
    }

    @Test
    fun `without a nonce no key is created`() {
        val keystore = Keystore { listOf(sheet, between) }
        for (rejection in listOf(KeyNonce.Rejected("Bitte neu anmelden."), KeyNonce.Rejected(null))) {
            val server = Server(rejection)
            assertEquals(KeyBinding.Outbox.Rejected(rejection.message), bind(server, keystore))
            assertTrue(server.chains.isEmpty())
        }
        assertTrue(keystore.challenges.isEmpty())
    }
}
