package ch.brickinventoryapp.ui

import ch.brickinventoryapp.model.step.Schrittaktion
import ch.brickinventoryapp.model.step.Schrittantwort
import ch.brickinventoryapp.model.step.Schrittbindung
import ch.brickinventoryapp.ui.components.Schrittablauf
import ch.brickinventoryapp.ui.components.Schrittfreigabe
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
 *   A  Schrittfreigabe.unterschrift() accepts any existing signature → red „ein anderer
 *      Schluessel zaehlt nicht“; gegenproben/schrittschutz-ohne-signatur.patch
 *   B  step flow continues past the lock without asking the server → red
 *      „lehnt der Server die Signatur ab …“; gegenproben/schrittablauf-ohne-server.patch
 *   C  a server refusal falls back to the on-device check → red „ohne
 *      Schluessel am Server …“; gegenproben/schrittablauf-absage-im-geraet.patch
 */
class SchrittfreigabeTest {

    private fun paar() = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()

    private val geraet = paar()
    private val freigabe = Schrittfreigabe({ geraet.public })

    private fun signatur(mit: PrivateKey) =
        Signature.getInstance(Schrittfreigabe.SIGNATURVERFAHREN).apply { initSign(mit) }

    /** A server that checks like routes/api_v1/device.ts: signature over exactly its message. */
    private class Server(private val schluessel: PublicKey, var challenge: Schrittantwort) : Schrittbindung {
        val releases = mutableListOf<String>()
        override suspend fun challenge(aktion: Schrittaktion) = challenge
        override suspend fun freigeben(challenge: String, signatur: ByteArray): Schrittantwort {
            releases += challenge
            val c = this.challenge as Schrittantwort.Challenge
            val passt = Signature.getInstance(Schrittfreigabe.SIGNATURVERFAHREN).run {
                initVerify(schluessel); update(c.nachricht.toByteArray(Charsets.UTF_8)); verify(signatur)
            }
            return if (passt && challenge == c.challenge) Schrittantwort.Free else Schrittantwort.Rejected("abgelehnt")
        }
    }

    private val offen = Schrittantwort.Challenge("c1", "BrickInventory-Schritt/1\ngutschein\nc1")

    @Test
    fun `the signature authorized by the key counts`() {
        assertTrue(freigabe.gilt(signatur(geraet.private)))
    }

    @Test
    fun `a different key does not count`() {
        assertFalse(freigabe.gilt(signatur(paar().private)))
    }

    @Test
    fun `a signature without authorization does not count`() {
        // Like a keystore key before unlock: sign() throws.
        assertFalse(freigabe.gilt(Signature.getInstance(Schrittfreigabe.SIGNATURVERFAHREN)))
        assertFalse(freigabe.gilt(null))
    }

    @Test
    fun `with a challenge it continues only when the server accepts the signature`() = runBlocking {
        val server = Server(geraet.public, offen)
        val a = Schrittablauf(server, freigabe).confirm(Schrittaktion.GUTSCHEIN) { signatur(geraet.private) }
        assertEquals(Schrittablauf.Ausgang.Weiter, a)
        assertEquals(listOf("c1"), server.releases)
    }

    @Test
    fun `if the server rejects the signature, it does not continue`() = runBlocking {
        // The server knows a different key than the device (new fingerprint, foreign device).
        val server = Server(paar().public, offen)
        val a = Schrittablauf(server, Schrittfreigabe({ geraet.public })).confirm(Schrittaktion.GUTSCHEIN) { signatur(geraet.private) }
        assertEquals(Schrittablauf.Ausgang.Rejected("abgelehnt"), a)
    }

    @Test
    fun `a callback without CryptoObject does not let through and does not ask the server`() = runBlocking {
        val server = Server(geraet.public, offen)
        val a = Schrittablauf(server, freigabe).confirm(Schrittaktion.GUTSCHEIN) { null }
        assertEquals(Schrittablauf.Ausgang.Abgebrochen, a)
        assertEquals(emptyList<String>(), server.releases)
    }

    @Test
    fun `without a key at the server the app does not ask for the lock at all`() = runBlocking {
        val server = Server(geraet.public, Schrittantwort.Rejected("Bitte neu anmelden."))
        var gefragt = 0
        val a = Schrittablauf(server, freigabe).confirm(Schrittaktion.VERWALTUNG) { gefragt++; signatur(geraet.private) }
        assertEquals(Schrittablauf.Ausgang.Rejected("Bitte neu anmelden."), a)
        assertEquals(0, gefragt)
    }

    @Test
    fun `a step without an action at the server stays with the check on the device`() = runBlocking {
        val server = Server(geraet.public, Schrittantwort.NotBound)
        assertEquals(Schrittablauf.Ausgang.Weiter,
            Schrittablauf(server, freigabe).confirm(Schrittaktion.LOKAL) { signatur(geraet.private) })
        assertEquals(Schrittablauf.Ausgang.Abgebrochen,
            Schrittablauf(server, freigabe).confirm(Schrittaktion.LOKAL) { signatur(paar().private) })
        assertEquals(emptyList<String>(), server.releases)
    }
}
