package ch.brickinventoryapp.ui

import ch.brickinventoryapp.model.schritt.Schrittaktion
import ch.brickinventoryapp.model.schritt.Schrittantwort
import ch.brickinventoryapp.model.schritt.Schrittbindung
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

    /** Ein Server, der wie routes/api_v1/geraet.ts prüft: Signatur über genau seine Nachricht. */
    private class Server(private val schluessel: PublicKey, var challenge: Schrittantwort) : Schrittbindung {
        val freigaben = mutableListOf<String>()
        override suspend fun challenge(aktion: Schrittaktion) = challenge
        override suspend fun freigeben(challenge: String, signatur: ByteArray): Schrittantwort {
            freigaben += challenge
            val c = this.challenge as Schrittantwort.Challenge
            val passt = Signature.getInstance(Schrittfreigabe.SIGNATURVERFAHREN).run {
                initVerify(schluessel); update(c.nachricht.toByteArray(Charsets.UTF_8)); verify(signatur)
            }
            return if (passt && challenge == c.challenge) Schrittantwort.Frei else Schrittantwort.Abgelehnt("abgelehnt")
        }
        override suspend fun hinterlege(oeffentlich: ByteArray) = true
    }

    private val offen = Schrittantwort.Challenge("c1", "BrickInventory-Schritt/1\ngutschein\nc1")

    @Test
    fun `die vom Schluessel freigegebene Signatur zaehlt`() {
        assertTrue(freigabe.gilt(signatur(geraet.private)))
    }

    @Test
    fun `ein anderer Schluessel zaehlt nicht`() {
        assertFalse(freigabe.gilt(signatur(paar().private)))
    }

    @Test
    fun `eine Signatur ohne Freigabe zaehlt nicht`() {
        // Wie ein Keystore-Schlüssel vor der Freigabe: sign() wirft.
        assertFalse(freigabe.gilt(Signature.getInstance(Schrittfreigabe.SIGNATURVERFAHREN)))
        assertFalse(freigabe.gilt(null))
    }

    @Test
    fun `mit Challenge geht es erst weiter, wenn der Server die Signatur annimmt`() = runBlocking {
        val server = Server(geraet.public, offen)
        val a = Schrittablauf(server, freigabe).bestaetige(Schrittaktion.GUTSCHEIN) { signatur(geraet.private) }
        assertEquals(Schrittablauf.Ausgang.Weiter, a)
        assertEquals(listOf("c1"), server.freigaben)
    }

    @Test
    fun `lehnt der Server die Signatur ab, geht es nicht weiter`() = runBlocking {
        // Der Server kennt einen anderen Schlüssel als das Gerät (neuer Fingerabdruck, fremdes Gerät).
        val server = Server(paar().public, offen)
        val a = Schrittablauf(server, Schrittfreigabe({ geraet.public })).bestaetige(Schrittaktion.GUTSCHEIN) { signatur(geraet.private) }
        assertEquals(Schrittablauf.Ausgang.Abgelehnt("abgelehnt"), a)
    }

    @Test
    fun `ein Rueckruf ohne CryptoObject laesst nicht weiter und fragt den Server nicht`() = runBlocking {
        val server = Server(geraet.public, offen)
        val a = Schrittablauf(server, freigabe).bestaetige(Schrittaktion.GUTSCHEIN) { null }
        assertEquals(Schrittablauf.Ausgang.Abgebrochen, a)
        assertEquals(emptyList<String>(), server.freigaben)
    }

    @Test
    fun `ohne Schluessel am Server fragt die App die Sperre gar nicht`() = runBlocking {
        val server = Server(geraet.public, Schrittantwort.Abgelehnt("Bitte neu anmelden."))
        var gefragt = 0
        val a = Schrittablauf(server, freigabe).bestaetige(Schrittaktion.VERWALTUNG) { gefragt++; signatur(geraet.private) }
        assertEquals(Schrittablauf.Ausgang.Abgelehnt("Bitte neu anmelden."), a)
        assertEquals(0, gefragt)
    }

    @Test
    fun `ein Server ohne Schrittschutz laesst die Pruefung im Geraet`() = runBlocking {
        val server = Server(geraet.public, Schrittantwort.NichtGebunden)
        assertEquals(Schrittablauf.Ausgang.Weiter,
            Schrittablauf(server, freigabe).bestaetige(Schrittaktion.LOKAL) { signatur(geraet.private) })
        assertEquals(Schrittablauf.Ausgang.Abgebrochen,
            Schrittablauf(server, freigabe).bestaetige(Schrittaktion.LOKAL) { signatur(paar().private) })
        assertEquals(emptyList<String>(), server.freigaben)
    }
}
