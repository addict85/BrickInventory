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
 * Die Rückfrage per Gerätesperre ist an den Keystore und den Server gebunden:
 * Weiter geht es nur mit einer Signatur, die zum öffentlichen Schlüssel passt, und
 * bei einem Server mit Schrittschutz erst, wenn er sie über seine Challenge annimmt.
 *
 * Der Keystore läuft nur auf dem Gerät; hier steht ein EC-Schlüsselpaar dafür, und
 * „nicht freigegeben“ ist eine Signatur, die nicht signieren kann oder fremd signiert.
 *
 * Gegenproben (09.11.2026 lokal mit kotlinc gemessen):
 *   A  Schrittfreigabe.unterschrift() nimmt jede vorhandene Signatur → rot „ein anderer
 *      Schluessel zaehlt nicht“; gegenproben/schrittschutz-ohne-signatur.patch
 *   B  Schrittablauf geht nach der Sperre weiter, ohne den Server zu fragen → rot
 *      „lehnt der Server die Signatur ab …“; gegenproben/schrittablauf-ohne-server.patch
 *   C  eine Absage des Servers fällt auf die Prüfung im Gerät zurück → rot „ohne
 *      Schluessel am Server …“; gegenproben/schrittablauf-absage-im-geraet.patch
 */
class SchrittfreigabeTest {

    private fun paar() = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()

    private val geraet = paar()
    private val freigabe = Schrittfreigabe({ geraet.public })

    private fun signatur(mit: PrivateKey) =
        Signature.getInstance(Schrittfreigabe.SIGNATURVERFAHREN).apply { initSign(mit) }

    /** Ein Server, der wie routes/api_v1/device.ts prüft: Signatur über genau seine Nachricht. */
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
        // Wie ein Keystore-Schlüssel vor der Freigabe: sign() wirft.
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
        // Der Server kennt einen anderen Schlüssel als das Gerät (neuer Fingerabdruck, fremdes Gerät).
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
