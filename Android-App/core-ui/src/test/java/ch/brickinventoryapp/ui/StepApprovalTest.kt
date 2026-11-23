package ch.brickinventoryapp.ui

import ch.brickinventoryapp.model.step.StepAction
import ch.brickinventoryapp.model.step.StepBinding
import ch.brickinventoryapp.model.step.StepResponse
import ch.brickinventoryapp.ui.components.StepApproval
import ch.brickinventoryapp.ui.components.StepFlow
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.security.KeyPairGenerator
import java.security.PrivateKey
import java.security.PublicKey
import java.security.Signature
import java.security.spec.ECGenParameterSpec

/**
 * The device-lock prompt is bound to the keystore and the server:
 * it only proceeds with a signature matching the public key, and
 * with a server that has step protection only once it accepts it via its challenge.
 *
 * The keystore only runs on the device; here stands an EC key pair for that, and
 * „nicht freigegeben“ is a signature that cannot sign or signs with someone else's key.
 *
 * Counter-checks (measured locally with kotlinc on Nov 9, 2026):
 *   A  Schrittfreigabe.unterschrift() accepts any existing signature → red „ein anderer Schluessel zaehlt nicht“
 * ; counter-checks/schrittschutz-ohne-signatur.patch
 *   B  step flow continues past the lock without asking the server → red
 *      „lehnt der Server die Signatur ab …“; counter-checks/schrittablauf-ohne-server.patch
 *   C  a server refusal falls back to the on-device check → red „ohne Schluessel am Server …“
 * ; counter-checks/schrittablauf-absage-im-geraet.patch
 */
class StepApprovalTest {

    private fun pair() = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()

    private val device = pair()
    private val approval = StepApproval({ device.public })

    private fun signature(with: PrivateKey) =
        Signature.getInstance(StepApproval.SIGNATURE_SCHEME).apply { initSign(with) }

    /** A server that checks like `routes/api/device.ts`: signature over exactly its message. */
    private class Server(private val key: PublicKey, var challenge: StepResponse) : StepBinding {
        val releases = mutableListOf<String>()
        override suspend fun challenge(action: StepAction) = challenge
        override suspend fun release(challenge: String, signature: ByteArray): StepResponse {
            releases += challenge
            val c = this.challenge as StepResponse.Challenge
            val matches = Signature.getInstance(StepApproval.SIGNATURE_SCHEME).run {
                initVerify(key); update(c.message.toByteArray(Charsets.UTF_8)); verify(signature)
            }
            return if (matches && challenge == c.challenge) StepResponse.Free else StepResponse.Rejected("abgelehnt")
        }
    }

    private val open = StepResponse.Challenge("c1", "BrickInventory-Schritt/1\ngutschein\nc1")

    @Test
    fun `the signature authorized by the key counts`() {
        assertTrue(approval.applies(signature(device.private)))
    }

    @Test
    fun `a different key does not count`() {
        assertFalse(approval.applies(signature(pair().private)))
    }

    @Test
    fun `a signature without authorization does not count`() {
        // Like a keystore key before unlock: sign() throws.
        assertFalse(approval.applies(Signature.getInstance(StepApproval.SIGNATURE_SCHEME)))
        assertFalse(approval.applies(null))
    }

    @Test
    fun `with a challenge it continues only when the server accepts the signature`() = runBlocking {
        val server = Server(device.public, open)
        val a = StepFlow(server, approval).confirm(StepAction.VOUCHER) { signature(device.private) }
        assertEquals(StepFlow.Outbox.Next, a)
        assertEquals(listOf("c1"), server.releases)
    }

    @Test
    fun `if the server rejects the signature, it does not continue`() = runBlocking {
        // The server knows a different key than the device (new fingerprint, foreign device).
        val server = Server(pair().public, open)
        val a = StepFlow(server, StepApproval({ device.public })).confirm(StepAction.VOUCHER) { signature(device.private) }
        assertEquals(StepFlow.Outbox.Rejected("abgelehnt"), a)
    }

    @Test
    fun `a callback without CryptoObject does not let through and does not ask the server`() = runBlocking {
        val server = Server(device.public, open)
        val a = StepFlow(server, approval).confirm(StepAction.VOUCHER) { null }
        assertEquals(StepFlow.Outbox.Cancelled, a)
        assertEquals(emptyList<String>(), server.releases)
    }

    @Test
    fun `without a key at the server the app does not ask for the lock at all`() = runBlocking {
        val server = Server(device.public, StepResponse.Rejected("Bitte neu anmelden."))
        var asked = 0
        val a = StepFlow(server, approval).confirm(StepAction.ADMIN) { asked++; signature(device.private) }
        assertEquals(StepFlow.Outbox.Rejected("Bitte neu anmelden."), a)
        assertEquals(0, asked)
    }

    @Test
    fun `a step without an action at the server stays with the check on the device`() = runBlocking {
        val server = Server(device.public, StepResponse.NotBound)
        assertEquals(StepFlow.Outbox.Next,
            StepFlow(server, approval).confirm(StepAction.LOCAL) { signature(device.private) })
        assertEquals(StepFlow.Outbox.Cancelled,
            StepFlow(server, approval).confirm(StepAction.LOCAL) { signature(pair().private) })
        assertEquals(emptyList<String>(), server.releases)
    }
}
